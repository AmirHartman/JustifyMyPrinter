const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { normalizeOrderStatus, parseBody, requireAdmin } = require('./_middleware');
const { canBridge } = require('./_bridge-auth');
const { calculateProductCost } = require('./_pricing');
const { finalizeOrder } = require('./_order-inventory');

const PRINTER_ID = 'p2s';

// Statuses the bridge may report. The server owns awaiting_approval/queued/
// claimed/cancelled (create, approve, claim-next, admin cancel).
const REPORTABLE_STATUSES = ['uploading', 'printing', 'done', 'failed'];
// Jobs a live bridge is holding are requeued if they go silent past this window.
const STALE_CLAIM_MINUTES = 10;

// Human-readable timeline messages (Hebrew, shown in the admin transparency panel).
const MSG = {
  created:   'בקשת ההדפסה נוצרה באתר',
  approved:  'אושרה ידנית ונשלחה לתור המדפסת',
  claimed:   'הגשר המקומי קיבל את הבקשה',
  uploading: 'הגשר מעביר את הקובץ למדפסת',
  printing:  'המדפסת התחילה להדפיס',
  done:      'ההדפסה הסתיימה',
  failed:    'ההדפסה נכשלה',
  cancelled: 'המשימה בוטלה',
};

// One timeline entry, ready to append with `events = events || <this>::jsonb`.
function evt(kind, message) {
  return JSON.stringify([{ at: new Date().toISOString(), kind, message }]);
}

function colorId(value) {
  if (typeof value === 'string') return value.trim();
  return String(value?.filamentId ?? value?.id ?? value?.value ?? '').trim();
}

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function normalizeJob(row) {
  return {
    id: row.id,
    source: row.source,
    orderId: row.order_id ?? null,
    productId: row.product_id,
    productName: row.product_name ?? null,
    quantity: Number(row.quantity),
    selectedColors: row.selected_colors ?? [],
    status: row.status,
    progress: Number(row.progress) || 0,
    errorReason: row.error_reason ?? '',
    events: Array.isArray(row.events) ? row.events : [],
    productionCost: numberOrNull(row.production_cost),
    materialGrams: numberOrNull(row.material_grams),
    printHours: numberOrNull(row.print_hours),
    printFileUrl: row.print_file_url ?? '',
    printFileName: row.print_file_name ?? '',
    printFileChecksum: row.print_file_checksum ?? '',
    approvedAt: row.approved_at ?? null,
    approvedBy: row.approved_by ?? null,
    claimedBy: row.claimed_by ?? null,
    claimedAt: row.claimed_at ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    printerName: row.printer_name ?? '',
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// A self-print builds stock: create an internal (margin-free) order so the whole
// existing cost/inventory/ledger path applies unchanged, then queue a job on it.
// The job starts in awaiting_approval — nothing reaches the bridge until the
// owner explicitly approves it.
async function createSelfPrint(sql, admin, body, res) {
  const productId = String(body.productId ?? '').trim();
  if (!productId) return res.status(400).json({ error: 'productId is required' });
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return res.status(400).json({ error: 'Quantity must be an integer between 1 and 50' });
  }

  const rows = await sql`
    SELECT id, name, print_hours, print_profile, materials, purge_grams, risk_percent,
           risk_level, catalog_kind, additional_copy_hours, minimum_unit_price,
           print_file_url, print_file_name, print_file_checksum
    FROM products WHERE id = ${productId}
  `;
  const product = rows[0];
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (!String(product.print_file_url || '').trim()) {
    return res.status(409).json({ error: 'למוצר זה אין קובץ הדפסה מוכן. יש להעלות קובץ slice לפני הדפסה אוטומטית.' });
  }

  const filamentRows = await sql`SELECT id, name, color_hex, price_per_kg, spool_price, spool_grams, remaining_grams, active FROM filaments`;
  const settingRows = await sql`SELECT value FROM settings WHERE key = 'pricing'`;
  const breakdown = calculateProductCost({
    printHours: Number(product.print_hours), printProfile: product.print_profile,
    materials: product.materials || [], purgeGrams: Number(product.purge_grams),
    riskPercent: product.risk_percent, riskLevel: product.risk_level,
    // An untested model carries its own risk tier here too, so a self-print of an
    // idea is costed the same way the catalog prices it.
    catalogKind: product.catalog_kind,
    additionalCopyHours: product.additional_copy_hours, minUnitPrice: product.minimum_unit_price,
  }, filamentRows.map((f) => ({
    id: f.id, pricePerKg: Number(f.price_per_kg), spoolPrice: Number(f.spool_price),
    spoolGrams: Number(f.spool_grams), remainingGrams: f.remaining_grams == null ? null : Number(f.remaining_grams),
    active: f.active !== false, name: f.name, colorHex: f.color_hex,
  })), settingRows[0]?.value || {}, { quantity, internal: true });

  const selectedColorsArray = Array.isArray(body.selectedColors)
    ? body.selectedColors.map(colorId).filter(Boolean) : [];
  const selectedColors = JSON.stringify(selectedColorsArray);
  const orderId = randomUUID();
  const jobId = randomUUID();
  const baseCost = breakdown.shopPrice;
  const productSnapshot = JSON.stringify({ id: product.id, name: product.name, selectedColors: selectedColorsArray });

  await sql`
    INSERT INTO orders (
      id, product_id, user_id, friend_name, order_type, quantity, selected_colors,
      product_snapshot, base_cost, support_amount, final_amount, price,
      requires_user_price_approval, user_approved_price,
      production_cost, print_hours, print_profile, material_grams, margin_percent,
      internal, status, paid, created_at, updated_at
    ) VALUES (
      ${orderId}, ${productId}, ${admin.id}, ${admin.name}, 'catalog', ${quantity}, ${selectedColors}::jsonb,
      ${productSnapshot}::jsonb, ${baseCost}, 0, ${baseCost}, ${baseCost},
      FALSE, TRUE,
      ${breakdown.productionCost}, ${breakdown.totalHours}, ${product.print_profile || 'regular'},
      ${breakdown.materialGrams}, ${breakdown.marginPercent},
      TRUE, 'waiting_print', FALSE, NOW(), NOW()
    )
  `;

  const jobRows = await sql`
    INSERT INTO print_jobs (
      id, source, order_id, product_id, quantity, selected_colors, status, events,
      production_cost, material_grams, print_hours,
      print_file_url, print_file_name, print_file_checksum, created_by, created_at, updated_at
    ) VALUES (
      ${jobId}, 'self', ${orderId}, ${productId}, ${quantity}, ${selectedColors}::jsonb, 'awaiting_approval', ${evt('created', MSG.created)}::jsonb,
      ${breakdown.productionCost}, ${breakdown.materialGrams}, ${breakdown.totalHours},
      ${product.print_file_url}, ${product.print_file_name || ''}, ${product.print_file_checksum || ''},
      ${admin.id}, NOW(), NOW()
    )
    RETURNING *
  `;
  return res.status(201).json(normalizeJob(jobRows[0]));
}

// An order-linked job fulfils an existing customer order: it reuses the order's
// cost/estimate snapshot and never creates a new order or deducts here.
async function createFromOrder(sql, admin, body, res) {
  const orderId = String(body.orderId ?? '').trim();
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  const orderRows = await sql`
    SELECT id, product_id, quantity, selected_colors, status, production_cost, print_hours, material_grams
    FROM orders WHERE id = ${orderId}
  `;
  const order = orderRows[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const status = normalizeOrderStatus(order.status);
  if (!['waiting_print', 'printing'].includes(status)) {
    return res.status(409).json({ error: 'ניתן להדפיס רק הזמנה שממתינה להדפסה' });
  }
  if (!order.product_id) return res.status(409).json({ error: 'להזמנה זו אין מוצר לקטלוג להדפסה אוטומטית' });

  const prodRows = await sql`SELECT id, name, print_file_url, print_file_name, print_file_checksum FROM products WHERE id = ${order.product_id}`;
  const product = prodRows[0];
  if (!product || !String(product.print_file_url || '').trim()) {
    return res.status(409).json({ error: 'למוצר של ההזמנה אין קובץ הדפסה מוכן.' });
  }

  const existing = await sql`SELECT id FROM print_jobs WHERE order_id = ${orderId} AND status IN ('awaiting_approval', 'queued', 'claimed', 'uploading', 'printing')`;
  if (existing.length) return res.status(409).json({ error: 'כבר קיימת משימת הדפסה פעילה להזמנה זו' });

  const jobId = randomUUID();
  const selectedColors = JSON.stringify(order.selected_colors ?? []);
  const jobRows = await sql`
    INSERT INTO print_jobs (
      id, source, order_id, product_id, quantity, selected_colors, status, events,
      production_cost, material_grams, print_hours,
      print_file_url, print_file_name, print_file_checksum, created_by, created_at, updated_at
    ) VALUES (
      ${jobId}, 'order', ${orderId}, ${order.product_id}, ${Number(order.quantity) || 1}, ${selectedColors}::jsonb, 'awaiting_approval', ${evt('created', MSG.created)}::jsonb,
      ${order.production_cost}, ${order.material_grams}, ${order.print_hours},
      ${product.print_file_url}, ${product.print_file_name || ''}, ${product.print_file_checksum || ''},
      ${admin.id}, NOW(), NOW()
    )
    RETURNING *
  `;
  return res.status(201).json(normalizeJob(jobRows[0]));
}

// Propagate a terminal/printing bridge report onto the linked order. Deduction
// runs through finalizeOrder so it happens in exactly one place, once.
async function propagateToOrder(sql, orderId, status) {
  if (!orderId) return;
  if (status === 'printing') {
    await sql`UPDATE orders SET status = 'printing', updated_at = NOW()
      WHERE id = ${orderId} AND status IN ('waiting_print', 'printing')`;
    return;
  }
  if (status !== 'done' && status !== 'failed') return;

  const orderRows = await sql`
    SELECT id, internal, product_id, quantity, production_cost, wasted_grams, waste_deducted_grams, inventory_deducted
    FROM orders WHERE id = ${orderId}
  `;
  const order = orderRows[0];
  if (!order) return;

  if (status === 'done') {
    if (order.internal) {
      await sql`UPDATE orders SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW() WHERE id = ${order.id}`;
      await finalizeOrder(sql, order, 'completed');
    } else {
      // Printed ≠ delivered: hand off to the existing manual "completed" step,
      // which is where a customer order's material is deducted (once).
      await sql`UPDATE orders SET status = 'ready_delivery', updated_at = NOW()
        WHERE id = ${order.id} AND status IN ('waiting_print', 'printing')`;
    }
    return;
  }

  // status === 'failed'
  if (order.internal) {
    await sql`UPDATE orders SET status = 'failed', updated_at = NOW() WHERE id = ${order.id}`;
    await finalizeOrder(sql, order, 'failed');
  } else {
    await sql`UPDATE orders SET status = 'failed', failed_attempts = failed_attempts + 1, updated_at = NOW()
      WHERE id = ${order.id}`;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const id = String(req.query.id ?? '').trim();
  const action = String(req.query.action ?? '');

  // ── Bridge: claim the next approved job (secret-authenticated, no cookie) ──
  if (action === 'claim-next') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!canBridge(req)) return res.status(403).json({ error: 'Forbidden' });
    try {
      const body = await parseBody(req);
      const bridgeId = String(body.bridgeId ?? 'bridge').slice(0, 120);
      const sql = getSql();
      // Heartbeat so the site can show the bridge online, regardless of work.
      await sql`UPDATE printers SET bridge_seen_at = NOW(), updated_at = NOW() WHERE id = ${PRINTER_ID}`;
      // Reaper: requeue jobs a dead bridge left hanging (before printing began).
      await sql`UPDATE print_jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
        WHERE status IN ('claimed', 'uploading')
          AND updated_at < NOW() - (${STALE_CLAIM_MINUTES} * INTERVAL '1 minute')`;
      // A requeued job frees the printer so it can be claimed again.
      await sql`UPDATE printers SET state = 'idle', current_job_id = NULL, updated_at = NOW()
        WHERE id = ${PRINTER_ID} AND current_job_id IN (SELECT id FROM print_jobs WHERE status = 'queued')`;
      // Atomic claim: only when the printer is idle. The global single-active
      // unique index guarantees at most one job on the printer even under races.
      const rows = await sql`
        WITH next AS (
          SELECT j.id FROM print_jobs j
          WHERE j.status = 'queued'
            AND EXISTS (SELECT 1 FROM printers WHERE id = ${PRINTER_ID} AND state = 'idle')
          ORDER BY j.created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        ),
        claim AS (
          UPDATE print_jobs p
          SET status = 'claimed', claimed_by = ${bridgeId}, claimed_at = NOW(), updated_at = NOW(),
              events = p.events || ${evt('claimed', MSG.claimed)}::jsonb
          FROM next WHERE p.id = next.id
          RETURNING p.*
        ),
        mark AS (
          UPDATE printers SET state = 'busy', current_job_id = (SELECT id FROM claim), updated_at = NOW()
          WHERE id = ${PRINTER_ID} AND state = 'idle' AND EXISTS (SELECT 1 FROM claim)
          RETURNING id
        )
        SELECT * FROM claim
      `;
      return res.json({ job: rows.length ? normalizeJob(rows[0]) : null });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Bridge: report status/progress for a claimed job ──
  if (action === 'report') {
    if (req.method !== 'PUT') return res.status(405).end();
    if (!canBridge(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const body = await parseBody(req);
      const status = String(body.status ?? '').trim();
      if (!REPORTABLE_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const progress = Math.min(Math.max(Number(body.progress) || 0, 0), 100);
      const errorReason = String(body.error ?? body.errorReason ?? '').slice(0, 500);
      const message = String(body.message ?? MSG[status] ?? status).slice(0, 300);
      const sql = getSql();
      await sql`UPDATE printers SET bridge_seen_at = NOW() WHERE id = ${PRINTER_ID}`;
      // Guard: once terminal, no further transitions and no re-finalization, so a
      // duplicated 'done' report is a no-op (never deducts twice). Only append an
      // event when the status actually advances.
      const rows = await sql`
        UPDATE print_jobs SET
          status = ${status},
          progress = ${progress},
          error_reason = ${errorReason},
          events = CASE WHEN status <> ${status} THEN events || ${evt(status, message)}::jsonb ELSE events END,
          started_at = CASE WHEN ${status} = 'printing' THEN COALESCE(started_at, NOW()) ELSE started_at END,
          finished_at = CASE WHEN ${status} IN ('done', 'failed') THEN NOW() ELSE finished_at END,
          updated_at = NOW()
        WHERE id = ${id}
          AND (
            (${status} = 'uploading' AND status IN ('claimed', 'uploading'))
            OR (${status} = 'printing' AND status IN ('claimed', 'uploading', 'printing'))
            OR (${status} IN ('done', 'failed') AND status IN ('claimed', 'uploading', 'printing'))
          )
        RETURNING *
      `;
      if (!rows.length) {
        const existing = await sql`SELECT * FROM print_jobs WHERE id = ${id}`;
        if (!existing.length) return res.status(404).json({ error: 'Not found' });
        // Repeated terminal reports are safe no-ops. Every other rejected
        // transition is explicit so a bridge cannot bypass manual approval or
        // continue after the owner cancelled a claimed/uploading job.
        if (['done', 'failed'].includes(existing[0].status)) {
          return res.json(normalizeJob(existing[0]));
        }
        return res.status(409).json({ error: `Invalid print-job transition from ${existing[0].status} to ${status}` });
      }
      await propagateToOrder(sql, rows[0].order_id, status);
      return res.json(normalizeJob(rows[0]));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Admin: approve a pending job → release it to the bridge queue ──
  if (action === 'approve') {
    if (req.method !== 'PUT') return res.status(405).end();
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const sql = getSql();
      const rows = await sql`
        UPDATE print_jobs SET
          status = 'queued', approved_at = NOW(), approved_by = ${admin.id}, updated_at = NOW(),
          events = events || ${evt('approved', MSG.approved)}::jsonb
        WHERE id = ${id} AND status = 'awaiting_approval'
        RETURNING *
      `;
      if (!rows.length) {
        const existing = await sql`SELECT id FROM print_jobs WHERE id = ${id}`;
        if (!existing.length) return res.status(404).json({ error: 'Not found' });
        return res.status(409).json({ error: 'המשימה כבר אושרה או שאינה ממתינה לאישור' });
      }
      return res.json(normalizeJob(rows[0]));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Admin: cancel a job that has not started printing ──
  if (action === 'cancel') {
    if (req.method !== 'PUT') return res.status(405).end();
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const sql = getSql();
      const rows = await sql`
        UPDATE print_jobs SET status = 'cancelled', updated_at = NOW(),
          events = events || ${evt('cancelled', MSG.cancelled)}::jsonb
        WHERE id = ${id} AND status IN ('awaiting_approval', 'queued', 'claimed', 'uploading')
        RETURNING *
      `;
      if (!rows.length) {
        const existing = await sql`SELECT id FROM print_jobs WHERE id = ${id}`;
        if (!existing.length) return res.status(404).json({ error: 'Not found' });
        return res.status(409).json({ error: 'לא ניתן לבטל משימה שכבר בהדפסה או שהסתיימה' });
      }
      const job = rows[0];
      // Cancelling a job the bridge already took frees the printer for the next one.
      await sql`UPDATE printers SET state = 'idle', current_job_id = NULL, updated_at = NOW()
        WHERE id = ${PRINTER_ID} AND current_job_id = ${job.id}`;
      if (job.order_id) {
        // A self-print's internal order is cancelled with it; a customer order is left as-is.
        await sql`UPDATE orders SET status = 'cancelled',
          cancellation_reason = COALESCE(NULLIF(cancellation_reason, ''), 'בוטל מהדפסה'), updated_at = NOW()
          WHERE id = ${job.order_id} AND internal = TRUE AND status NOT IN ('completed', 'failed')`;
      }
      return res.json(normalizeJob(job));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Admin: create a job (self-print from a product, or from an existing order) ──
  if (req.method === 'POST') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const body = await parseBody(req);
      const sql = getSql();
      if (String(body.orderId ?? '').trim()) return createFromOrder(sql, admin, body, res);
      return createSelfPrint(sql, admin, body, res);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Admin: list jobs (single or all) ──
  if (req.method === 'GET') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const sql = getSql();
      if (id) {
        const rows = await sql`
          SELECT pj.*, p.name AS product_name FROM print_jobs pj
          LEFT JOIN products p ON p.id = pj.product_id WHERE pj.id = ${id}
        `;
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        return res.json(normalizeJob(rows[0]));
      }
      const rows = await sql`
        SELECT pj.*, p.name AS product_name FROM print_jobs pj
        LEFT JOIN products p ON p.id = pj.product_id ORDER BY pj.created_at DESC
      `;
      return res.json(rows.map(normalizeJob));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
};
