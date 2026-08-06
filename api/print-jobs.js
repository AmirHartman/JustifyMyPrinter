const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { normalizeOrderStatus, parseBody, requireAdmin } = require('./_middleware');
const { canBridge } = require('./_bridge-auth');
const { calculateProductCost } = require('./_pricing');
const { finalizeOrder } = require('./_order-inventory');

const PRINTER_ID = 'p2s';

// Statuses the bridge may report. The server owns awaiting_approval/queued/
// claimed/cancelled (create, approve, claim-next, admin cancel).
const REPORTABLE_STATUSES = ['uploading', 'printing', 'done', 'failed', 'cancelled'];
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
    bridgeId: row.bridge_id ?? null,
    claimToken: row.claim_token ?? null,
    cancelRequestedAt: row.cancel_requested_at ?? null,
    items: Array.isArray(row.items) ? row.items : [],
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

function validChecksum(value) {
  return /^[a-f0-9]{64}$/.test(String(value || '').trim().toLowerCase());
}

async function jobItems(sql, jobId) {
  const rows = await sql`
    SELECT i.order_id, i.product_id, i.quantity, i.item_snapshot,
           o.friend_name, o.selected_colors
    FROM print_job_items i LEFT JOIN orders o ON o.id = i.order_id
    WHERE i.print_job_id = ${jobId} ORDER BY i.created_at ASC
  `;
  return rows.map((row) => ({
    orderId: row.order_id ?? null, productId: row.product_id ?? null,
    quantity: Number(row.quantity) || 0, snapshot: row.item_snapshot ?? {},
    friendName: row.friend_name ?? null, selectedColors: row.selected_colors ?? [],
  }));
}

async function attachItems(sql, row) {
  if (!row) return row;
  return { ...row, items: await jobItems(sql, row.id) };
}

async function productFileReady(sql, product) {
  if (String(product?.print_file_url || '').trim()) return true;
  const checksum = String(product?.print_file_checksum || '').trim().toLowerCase();
  if (!validChecksum(checksum)) return false;
  const rows = await sql`SELECT 1 FROM bridge_files WHERE checksum = ${checksum} AND available = TRUE LIMIT 1`;
  return rows.length > 0;
}

async function completePlateItems(sql, jobId) {
  // Claim item completions and update every linked order in one statement. A
  // crash cannot mark an item applied without incrementing its order, while a
  // duplicate terminal report sees no rows in `completed` and is a safe no-op.
  await sql`
    WITH completed AS (
      UPDATE print_job_items SET completion_applied_at = NOW()
      WHERE print_job_id = ${jobId} AND completion_applied_at IS NULL
      RETURNING order_id, quantity
    ), totals AS (
      SELECT order_id, SUM(quantity)::INTEGER AS completed_quantity
      FROM completed WHERE order_id IS NOT NULL GROUP BY order_id
    )
    UPDATE orders AS customer_order SET
      printed_quantity = LEAST(customer_order.quantity, customer_order.printed_quantity + totals.completed_quantity),
      status = CASE
        WHEN customer_order.printed_quantity + totals.completed_quantity >= customer_order.quantity
          THEN CASE WHEN customer_order.internal THEN 'completed' ELSE 'ready_delivery' END
        WHEN customer_order.status IN ('waiting_print', 'printing') THEN 'waiting_print'
        ELSE customer_order.status
      END,
      updated_at = NOW()
    FROM totals
    WHERE customer_order.id = totals.order_id
      AND customer_order.status IN ('waiting_print', 'printing', 'ready_delivery')
  `;
}

async function markPlateItemsPrinting(sql, jobId) {
  await sql`
    UPDATE orders SET status = 'printing', updated_at = NOW()
    WHERE id IN (SELECT order_id FROM print_job_items WHERE print_job_id = ${jobId} AND order_id IS NOT NULL)
      AND status = 'waiting_print'
  `;
}

async function createApprovedPlate(sql, admin, body, res) {
  const checksum = String(body.fileChecksum || '').trim().toLowerCase();
  if (!validChecksum(checksum)) return res.status(400).json({ error: 'fileChecksum must be a SHA-256 checksum' });
  const suppliedItems = Array.isArray(body.items) ? body.items : null;
  const productId = String(body.productId || '').trim();
  if (Boolean(suppliedItems) === Boolean(productId)) {
    return res.status(400).json({ error: 'Provide either productId or items, but not both' });
  }
  const bridgeRows = await sql`
    SELECT bf.bridge_id, bf.file_name, bf.byte_size, bf.print_hours, bf.material_grams,
           bf.print_profile, bf.purge_grams
    FROM bridge_files bf JOIN bridges b ON b.id = bf.bridge_id
    WHERE bf.checksum = ${checksum} AND bf.available = TRUE
    ORDER BY b.last_seen_at DESC NULLS LAST LIMIT 1
  `;
  const bridgeFile = bridgeRows[0];
  if (!bridgeFile) return res.status(409).json({ error: 'הקובץ אינו זמין בגשר המקומי כרגע' });
  const jobId = randomUUID();

  if (productId) return createSelfPrint(sql, admin, {
    ...body, productId, quantity: 1, createApproved: true,
    resolvedBridgeFile: bridgeFile,
  }, res);

  if (!suppliedItems.length || suppliedItems.length > 100) return res.status(400).json({ error: 'items must contain 1 to 100 entries' });
  const quantities = new Map();
  for (const item of suppliedItems) {
    const orderId = String(item?.orderId || '').trim();
    const quantity = Number(item?.quantity);
    if (!orderId || !Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ error: 'Each item needs an orderId and positive integer quantity' });
    quantities.set(orderId, (quantities.get(orderId) || 0) + quantity);
  }
  const requestedItems = JSON.stringify([...quantities].map(([orderId, quantity]) => ({ order_id: orderId, quantity })));
  // This single statement locks all selected orders while it checks existing
  // allocations and creates the job/items. A pair of browser requests cannot
  // both reserve the final outstanding copy of the same order.
  const inserted = await sql`
    WITH requested AS (
      SELECT order_id, SUM(quantity)::INTEGER AS item_quantity
      FROM jsonb_to_recordset(${requestedItems}::jsonb) AS item(order_id TEXT, quantity INTEGER)
      GROUP BY order_id
    ), locked_orders AS (
      SELECT o.id, o.product_id, o.quantity, o.printed_quantity, o.status,
        o.friend_name, o.selected_colors, requested.item_quantity,
        COALESCE((SELECT SUM(i.quantity) FROM print_job_items i JOIN print_jobs active_job ON active_job.id = i.print_job_id
          WHERE i.order_id = o.id AND active_job.status IN ('awaiting_approval', 'queued', 'claimed', 'uploading', 'printing', 'attention_required')), 0) AS allocated_quantity
      FROM orders o JOIN requested ON requested.order_id = o.id
      FOR UPDATE OF o
    ), eligible AS (
      SELECT * FROM locked_orders
      WHERE product_id IS NOT NULL AND status IN ('waiting_print', 'printing')
        AND item_quantity <= quantity - printed_quantity - allocated_quantity
    ), guard AS (
      SELECT (SELECT COUNT(*) FROM requested) = (SELECT COUNT(*) FROM eligible) AS valid
    ), job AS (
      INSERT INTO print_jobs (
        id, source, product_id, quantity, selected_colors, status, events,
        material_grams, print_hours, print_file_name, print_file_checksum,
        bridge_id, approved_at, approved_by, created_by, created_at, updated_at
      ) SELECT
        ${jobId}, 'plate', (SELECT product_id FROM eligible ORDER BY id LIMIT 1), 1, '[]'::jsonb, 'queued', ${evt('approved', MSG.approved)}::jsonb,
        ${Array.isArray(bridgeFile.material_grams) ? bridgeFile.material_grams.reduce((sum, grams) => sum + Number(grams || 0), 0) : null},
        ${bridgeFile.print_hours}, ${bridgeFile.file_name}, ${checksum}, ${bridgeFile.bridge_id},
        NOW(), ${admin.id}, ${admin.id}, NOW(), NOW()
      FROM guard WHERE valid
      RETURNING *
    ), items AS (
      INSERT INTO print_job_items (id, print_job_id, order_id, product_id, quantity, item_snapshot)
      SELECT md5(${jobId} || ':' || eligible.id), job.id, eligible.id, eligible.product_id,
        eligible.item_quantity, jsonb_build_object('friendName', eligible.friend_name, 'selectedColors', eligible.selected_colors)
      FROM eligible CROSS JOIN job
      RETURNING id
    ) SELECT * FROM job
  `;
  if (!inserted.length) return res.status(409).json({ error: 'הפריטים אינם זמינים להקצאה לפלטה זו' });
  return res.status(201).json(normalizeJob(await attachItems(sql, inserted[0])));
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
           risk_level, additional_copy_hours, minimum_unit_price,
           print_file_url, print_file_name, print_file_checksum
    FROM products WHERE id = ${productId}
  `;
  const product = rows[0];
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const resolvedLocalFile = body.resolvedBridgeFile && validChecksum(body.fileChecksum);
  if (!resolvedLocalFile && !(await productFileReady(sql, product))) {
    return res.status(409).json({ error: 'למוצר זה אין קובץ הדפסה מוכן. יש להעלות קובץ slice לפני הדפסה אוטומטית.' });
  }

  const filamentRows = await sql`SELECT id, name, color_hex, price_per_kg, spool_price, spool_grams, remaining_grams, active FROM filaments`;
  const settingRows = await sql`SELECT value FROM settings WHERE key = 'pricing'`;
  const breakdown = calculateProductCost({
    printHours: Number(product.print_hours), printProfile: product.print_profile,
    materials: product.materials || [], purgeGrams: Number(product.purge_grams),
    riskPercent: product.risk_percent, riskLevel: product.risk_level,
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
  const approved = body.createApproved === true;
  const bridgeFile = body.resolvedBridgeFile || null;
  const printFileChecksum = String(bridgeFile?.checksum || body.fileChecksum || product.print_file_checksum || '').trim();
  const printFileName = String(bridgeFile?.file_name || product.print_file_name || '').trim();
  const printFileUrl = product.print_file_url || '';
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
      print_file_url, print_file_name, print_file_checksum, bridge_id,
      approved_at, approved_by, created_by, created_at, updated_at
    ) VALUES (
      ${jobId}, 'self', ${orderId}, ${productId}, ${quantity}, ${selectedColors}::jsonb,
      ${approved ? 'queued' : 'awaiting_approval'}, ${approved ? evt('approved', MSG.approved) : evt('created', MSG.created)}::jsonb,
      ${breakdown.productionCost}, ${breakdown.materialGrams}, ${breakdown.totalHours},
      ${printFileUrl}, ${printFileName}, ${printFileChecksum}, ${bridgeFile?.bridge_id || null},
      ${approved ? new Date().toISOString() : null}::timestamptz, ${approved ? admin.id : null}, ${admin.id}, NOW(), NOW()
    )
    RETURNING *
  `;
  await sql`
    INSERT INTO print_job_items (id, print_job_id, order_id, product_id, quantity, item_snapshot)
    VALUES (${randomUUID()}, ${jobId}, ${orderId}, ${productId}, ${quantity}, ${productSnapshot}::jsonb)
  `;
  return res.status(201).json(normalizeJob(await attachItems(sql, jobRows[0])));
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
  if (!product || !(await productFileReady(sql, product))) {
    return res.status(409).json({ error: 'למוצר של ההזמנה אין קובץ הדפסה מוכן.' });
  }

  const existing = await sql`SELECT id FROM print_jobs WHERE order_id = ${orderId} AND status IN ('awaiting_approval', 'queued', 'claimed', 'uploading', 'printing', 'attention_required')`;
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
      if (!bridgeId) return res.status(400).json({ error: 'bridgeId is required' });
      const sql = getSql();
      // Heartbeat so the site can show the bridge online, regardless of work.
      await sql`UPDATE printers SET bridge_seen_at = NOW(), updated_at = NOW() WHERE id = ${PRINTER_ID}`;
      // Reaper: requeue jobs a dead bridge left hanging (before printing began).
      await sql`UPDATE print_jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
        claim_token = NULL, bridge_id = NULL, updated_at = NOW()
        WHERE status = 'claimed'
          AND updated_at < NOW() - (${STALE_CLAIM_MINUTES} * INTERVAL '1 minute')`;
      // Uploading and printing are physically uncertain: do not auto-reprint.
      await sql`UPDATE print_jobs SET status = 'attention_required', updated_at = NOW(),
        events = events || ${evt('attention_required', 'הגשר נותק במהלך העברה; נדרשת בדיקה ידנית')}::jsonb
        WHERE status IN ('uploading', 'printing') AND updated_at < NOW() - (${STALE_CLAIM_MINUTES} * INTERVAL '1 minute')`;
      // A requeued job frees the printer so it can be claimed again.
      await sql`UPDATE printers SET state = 'idle', current_job_id = NULL, updated_at = NOW()
        WHERE id = ${PRINTER_ID} AND current_job_id IN (SELECT id FROM print_jobs WHERE status = 'queued')`;
      // Atomic claim: only when the printer is idle. The global single-active
      // unique index guarantees at most one job on the printer even under races.
      const claimToken = randomUUID();
      const rows = await sql`
        WITH next AS (
          SELECT j.id FROM print_jobs j
          WHERE j.status = 'queued'
            AND (j.print_file_checksum = '' OR EXISTS (
              SELECT 1 FROM bridge_files bf WHERE bf.bridge_id = ${bridgeId}
                AND bf.checksum = j.print_file_checksum AND bf.available = TRUE
            ))
            AND EXISTS (SELECT 1 FROM printers WHERE id = ${PRINTER_ID} AND state = 'idle')
          ORDER BY j.created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        ),
        claim AS (
          UPDATE print_jobs p
          SET status = 'claimed', claimed_by = ${bridgeId}, bridge_id = ${bridgeId}, claim_token = ${claimToken}, claimed_at = NOW(), updated_at = NOW(),
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
      return res.json({ job: rows.length ? normalizeJob(await attachItems(sql, rows[0])) : null });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Bridge: retain a claim while a long local transfer is in progress ──
  if (action === 'heartbeat') {
    if (req.method !== 'PUT') return res.status(405).end();
    if (!canBridge(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!id) return res.status(400).json({ error: 'id is required' });
    try {
      const body = await parseBody(req);
      const claimToken = String(body.claimToken ?? '').trim();
      const sql = getSql();
      const rows = await sql`
        UPDATE print_jobs SET updated_at = NOW()
        WHERE id = ${id} AND claim_token = ${claimToken}
          AND status IN ('claimed', 'uploading', 'printing')
        RETURNING *
      `;
      if (!rows.length) return res.status(409).json({ error: 'Claim is no longer active' });
      await sql`UPDATE printers SET bridge_seen_at = NOW(), updated_at = NOW() WHERE id = ${PRINTER_ID}`;
      return res.json(normalizeJob(rows[0]));
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
      const claimToken = String(body.claimToken ?? '').trim();
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
          upload_started_at = CASE WHEN ${status} = 'uploading' THEN COALESCE(upload_started_at, NOW()) ELSE upload_started_at END,
          finished_at = CASE WHEN ${status} IN ('done', 'failed', 'cancelled') THEN NOW() ELSE finished_at END,
          updated_at = NOW()
        WHERE id = ${id}
          AND claim_token = ${claimToken}
          AND NOT (${status} = 'printing' AND cancel_requested_at IS NOT NULL)
          AND (
            (${status} = 'uploading' AND status IN ('claimed', 'uploading'))
            OR (${status} = 'printing' AND status IN ('claimed', 'uploading', 'printing'))
            OR (${status} IN ('done', 'failed') AND status IN ('claimed', 'uploading', 'printing'))
            OR (${status} = 'cancelled' AND status IN ('claimed', 'uploading') AND cancel_requested_at IS NOT NULL)
          )
        RETURNING *
      `;
      if (!rows.length) {
        const existing = await sql`SELECT * FROM print_jobs WHERE id = ${id}`;
        if (!existing.length) return res.status(404).json({ error: 'Not found' });
        // Repeated terminal reports are safe no-ops. Every other rejected
        // transition is explicit so a bridge cannot bypass manual approval or
        // continue after the owner cancelled a claimed/uploading job.
        if (status === 'printing' && existing[0].cancel_requested_at) {
          return res.status(409).json({ error: 'Print cancellation requested', code: 'cancel_requested' });
        }
        if (['done', 'failed', 'cancelled'].includes(existing[0].status)
          && (!existing[0].claim_token || existing[0].claim_token === claimToken)) {
          // Recover safely if the terminal status committed but one of its
          // idempotent order side effects failed in the following statement.
          await propagateToOrder(sql, existing[0].order_id, existing[0].status);
          if (existing[0].status === 'done') await completePlateItems(sql, existing[0].id);
          return res.json(normalizeJob(await attachItems(sql, existing[0])));
        }
        return res.status(409).json({ error: `Invalid print-job transition from ${existing[0].status} to ${status}` });
      }
      await propagateToOrder(sql, rows[0].order_id, status);
      if (status === 'printing') await markPlateItemsPrinting(sql, rows[0].id);
      if (status === 'done') await completePlateItems(sql, rows[0].id);
      if (status === 'cancelled') {
        await sql`UPDATE printers SET state = 'idle', current_job_id = NULL, updated_at = NOW()
          WHERE id = ${PRINTER_ID} AND current_job_id = ${rows[0].id}`;
        if (rows[0].order_id) {
          await sql`UPDATE orders SET status = 'cancelled',
            cancellation_reason = COALESCE(NULLIF(cancellation_reason, ''), 'בוטל מהדפסה'), updated_at = NOW()
            WHERE id = ${rows[0].order_id} AND internal = TRUE AND status NOT IN ('completed', 'failed')`;
        }
      }
      return res.json(normalizeJob(await attachItems(sql, rows[0])));
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
      // Queued work can disappear immediately. A claimed/uploading job may
      // already be on the bridge, so keep its claim and ask the bridge to stop
      // before it issues MQTT; printing itself is intentionally never stopped
      // remotely from the website.
      const requested = await sql`
        UPDATE print_jobs SET cancel_requested_at = NOW(), updated_at = NOW(),
          events = events || ${evt('cancel_requested', 'בקשת הביטול נשלחה לגשר לפני תחילת ההדפסה')}::jsonb
        WHERE id = ${id} AND status IN ('claimed', 'uploading') AND cancel_requested_at IS NULL
        RETURNING *
      `;
      if (requested.length) return res.json(normalizeJob(requested[0]));
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
      if (action === 'create-approved') return createApprovedPlate(sql, admin, body, res);
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
        return res.json(normalizeJob(await attachItems(sql, rows[0])));
      }
      const rows = await sql`
        SELECT pj.*, p.name AS product_name FROM print_jobs pj
        LEFT JOIN products p ON p.id = pj.product_id ORDER BY pj.created_at DESC
      `;
      return res.json(await Promise.all(rows.map(async (row) => normalizeJob(await attachItems(sql, row)))));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
};
