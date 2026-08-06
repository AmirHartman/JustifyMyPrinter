const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const {
  ORDER_STATUSES,
  normalizeOrderStatus,
  parseBody,
  requireAuth,
  requireActiveUser,
  requireAdmin,
} = require('./_middleware');
const { calculateProductCost, hasPrintData } = require('./_pricing');
const { finalizeOrder } = require('./_order-inventory');
const { normalizeCartItems, supportTargetIndex } = require('./_cart');

const LEGACY_WRITE_STATUS = {
  approved: 'waiting_print',
  ready: 'ready_delivery',
  delivered: 'completed',
  rejected: 'cancelled',
};

function canonicalStatus(value) {
  const status = LEGACY_WRITE_STATUS[value] || value;
  return ORDER_STATUSES.includes(status) ? status : null;
}

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function colorValue(value) {
  if (typeof value === 'string') return value.trim();
  return String(value?.filamentId ?? value?.id ?? value?.value ?? '').trim();
}

function productMissingRequirements(product) {
  const hasImage = Boolean(product.image || product.images?.length);
  const hasCategory = Boolean(product.category || product.category_ids?.length);
  if (!String(product.name || '').trim() || !String(product.description || '').trim() || !hasImage || !hasCategory) return true;
  if ((product.catalog_kind || 'printed') === 'idea') return false;
  return !(Number(product.print_hours) > 0)
    || !Array.isArray(product.materials)
    || !product.materials.length
    || product.materials.some((item) => !item.filamentId || !(Number(item.grams) > 0));
}

// Orders store filament ids in selected_colors. Callers resolve them to names
// once per request so the UI never has to render a raw id.
async function filamentNames(sql) {
  const rows = await sql`SELECT id, name FROM filaments`;
  return new Map(rows.map((row) => [row.id, row.name]));
}

function normalizeRow(row, colorNames = null) {
  // An order awaiting a quote has no amount at all. price is only a legacy mirror
  // of final_amount, so it is used as a fallback but never as a stand-in for "no price".
  const finalAmount = row.final_amount != null
    ? Number(row.final_amount)
    : Number(row.price) > 0 ? Number(row.price) : null;
  const selectedColors = row.selected_colors ?? [];
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id ?? null,
    friendName: row.friend_name,
    orderType: row.order_type ?? 'catalog',
    requestDescription: row.request_description ?? '',
    externalModelLink: row.external_model_link ?? '',
    quantity: Number(row.quantity),
    selectedColors,
    selectedColorNames: selectedColors.map((value) => {
      const id = colorValue(value);
      return colorNames?.get(id) || (typeof value === 'string' ? value : value?.name || id);
    }).filter(Boolean),
    productSnapshot: row.product_snapshot ?? null,
    proposedAlternativeColor: typeof row.proposed_alternative_color === 'object'
      ? row.proposed_alternative_color?.name || row.proposed_alternative_color?.value || null
      : row.proposed_alternative_color ?? null,
    proposedAlternativeColorValue: typeof row.proposed_alternative_color === 'object'
      ? row.proposed_alternative_color?.value || null : null,
    colorAlternativeStatus: row.color_alternative_status ?? 'none',
    colorAlternativeProposedAt: row.color_alternative_proposed_at ?? null,
    colorAlternativeRespondedAt: row.color_alternative_responded_at ?? null,
    userNotes: row.user_notes ?? '',
    adminNotes: row.admin_notes ?? '',
    baseCost: numberOrNull(row.base_cost),
    supportAmount: Number(row.support_amount) || 0,
    finalAmount,
    price: finalAmount,
    estimatedMaterialWeight: numberOrNull(row.estimated_material_weight),
    estimatedPrintTime: numberOrNull(row.estimated_print_time),
    requiresUserPriceApproval: Boolean(row.requires_user_price_approval),
    userApprovedPrice: Boolean(row.user_approved_price),
    cancellationReason: row.cancellation_reason ?? '',
    status: normalizeOrderStatus(row.status),
    paid: Boolean(row.paid),
    paidAt: row.paid_at,
    productionCost: numberOrNull(row.production_cost),
    wearComponent: numberOrNull(row.wear_component),
    machineComponent: numberOrNull(row.machine_component),
    marginComponent: numberOrNull(row.margin_component),
    printHours: numberOrNull(row.print_hours),
    printProfile: row.print_profile || 'regular',
    materialGrams: numberOrNull(row.material_grams),
    failedAttempts: Number(row.failed_attempts) || 0,
    wastedGrams: Number(row.wasted_grams) || 0,
    wastedHours: Number(row.wasted_hours) || 0,
    marginPercent: numberOrNull(row.margin_percent),
    internal: Boolean(row.internal),
    // Orders placed in one cart checkout share a cartId; a standalone order has
    // none. The UI groups by it, but every row still stands on its own.
    cartId: row.cart_id ?? null,
    cartPosition: Number(row.cart_position) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

const SELECT_COLUMNS = `
  id, product_id, user_id, friend_name, order_type, request_description,
  external_model_link, quantity, selected_colors, product_snapshot,
  proposed_alternative_color, color_alternative_status, color_alternative_proposed_at,
  color_alternative_responded_at, user_notes, admin_notes,
  base_cost, support_amount, final_amount, price, estimated_material_weight,
  estimated_print_time, requires_user_price_approval, user_approved_price,
  cancellation_reason, status, paid, paid_at, production_cost, wear_component,
  machine_component, margin_component, print_hours, print_profile, material_grams, failed_attempts,
  wasted_grams, wasted_hours, waste_deducted_grams, margin_percent, internal,
  inventory_deducted, cart_id, cart_position, created_at, updated_at, completed_at
`;

const ORDER_TYPES = ['catalog', 'external_link', 'custom', 'future_upload'];

// Filaments and pricing settings are the same for every line of a checkout, so
// they are read once per request. Without this a ten-item cart would issue
// thirty filament queries against a free-tier Neon instance.
async function loadOrderContext(sql) {
  const filaments = await sql`
    SELECT id, name, color_hex, price_per_kg, spool_price, spool_grams, remaining_grams, active
    FROM filaments
  `;
  const settingRows = await sql`SELECT value FROM settings WHERE key = 'pricing'`;
  return {
    filaments,
    pricingSettings: settingRows[0]?.value || {},
    colorNames: new Map(filaments.map((row) => [row.id, row.name])),
  };
}

// Everything one order row needs, derived entirely on the server. The single
// order path runs this once; cart checkout runs it per line. It only reads and
// validates — nothing is written until every line has passed.
async function buildOrderRow(sql, user, item, ctx) {
  const reject = (error, statusCode = 400) => ({ error, statusCode });

  const orderType = String(item.orderType ?? 'catalog');
  if (!ORDER_TYPES.includes(orderType)) return reject('Invalid order type');

  const productId = String(item.productId ?? '').trim() || null;
  const quantity = Number(item.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return reject('Quantity must be an integer between 1 and 50');
  }

  let product = null;
  if (productId) {
    const rows = await sql`
      SELECT id, name, description, image, images, source_url, category, category_ids,
             catalog_kind, possible_colors, required_colors,
             allow_multiple, active, cost, grams, print_hours, print_profile, materials, requires_admin_approval,
             manual_price_enabled, manual_price, purge_grams, risk_percent,
             risk_level, additional_copy_hours, minimum_unit_price
      FROM products WHERE id = ${productId}
    `;
    product = rows[0] || null;
    if (!product) return reject('Product not found', 404);
    // Inactive products are drafts. They are hidden from the public catalog,
    // so a friend must not be able to order one by guessing its id.
    if (product.active === false && user.role !== 'admin') {
      return reject('המוצר אינו זמין להזמנה כרגע', 409);
    }
    if (productMissingRequirements(product)) return reject('Product is not ready for catalog ordering', 409);
    if (!product.allow_multiple && quantity > 1) return reject('מוצר זה ניתן להזמנה ביחידה אחת בלבד');
  }
  if (orderType === 'catalog' && !product) {
    return reject('Catalog orders require a product');
  }

  // catalogKind must travel with the pricing input: an untested model is charged
  // the untested risk tier, and that coercion lives inside calculateProductCost.
  const productForPricing = product ? {
    printHours: Number(product.print_hours), printProfile: product.print_profile,
    materials: product.materials || [], purgeGrams: Number(product.purge_grams),
    riskPercent: product.risk_percent, riskLevel: product.risk_level, additionalCopyHours: product.additional_copy_hours,
    minUnitPrice: product.minimum_unit_price, catalogKind: product.catalog_kind,
  } : null;
  let breakdown = null;
  if (product) {
    breakdown = calculateProductCost(productForPricing, ctx.filaments.map((f) => ({
      id: f.id, pricePerKg: Number(f.price_per_kg), spoolPrice: Number(f.spool_price),
      spoolGrams: Number(f.spool_grams), remainingGrams: f.remaining_grams == null ? null : Number(f.remaining_grams),
      active: f.active !== false, name: f.name, colorHex: f.color_hex,
    })), ctx.pricingSettings, { quantity });
  }
  // An idea with print time and materials is priced like anything else, at the
  // untested risk tier. Only an idea without that data, or an external/custom
  // request, still waits for the admin to quote. A price is never taken from the
  // client: it is derived from the catalog product.
  const priced = Boolean(product) && (product.catalog_kind !== 'idea' || hasPrintData(productForPricing));
  const baseCost = priced
    ? product.manual_price_enabled && product.manual_price != null
      ? Number(product.manual_price) * quantity
      : breakdown.shopPrice
    : null;
  const marginComponent = baseCost == null || !breakdown
    ? null
    : baseCost - breakdown.costWithRisk;
  const selectedColorsArray = Array.isArray(item.selectedColors) ? item.selectedColors.map(colorValue).filter(Boolean) : [];
  const filamentAvailable = (filament) => Boolean(filament)
    && filament.active !== false && Number(filament.remaining_grams ?? 1) > 0;
  const availableColors = new Set(ctx.filaments.filter(filamentAvailable).map((entry) => entry.id));
  const configuredColors = (product?.possible_colors || []).map(colorValue).filter(Boolean);
  // A product with its own palette offers that palette; one without can be
  // printed in any colour on the shelf. Mirrors colorOptions in api/products.js.
  const allowedColors = new Set(configuredColors.length
    ? configuredColors
    : ctx.filaments.map((entry) => entry.id));
  const selectableColors = [...allowedColors].filter((value) => availableColors.has(value));

  if (product) {
    if (selectedColorsArray.some((value) => !allowedColors.has(value))) {
      return reject('הצבע שנבחר אינו מוצע למוצר הזה');
    }
    // Every order states its colour. The only exception is a total stock-out,
    // where there is nothing to choose from and the admin proposes an alternative.
    if (selectableColors.length > 0) {
      if (selectedColorsArray.length === 0) {
        return reject('נא לבחור צבע להזמנה');
      }
      if (selectedColorsArray.some((value) => !availableColors.has(value))) {
        return reject('הצבע שנבחר אזל מהמלאי. נא לבחור מהצבעים הזמינים.');
      }
    }
  }

  const noColorAvailable = Boolean(product) && selectedColorsArray.length === 0;
  const unavailableMaterials = product?.materials?.some((material) => {
    const filament = ctx.filaments.find((entry) => entry.id === material.filamentId);
    return !filament || !filament.active || (filament.remaining_grams != null && Number(filament.remaining_grams) < Number(material.grams || 0) * quantity);
  });
  const needsColorAlternative = Boolean(noColorAvailable || unavailableMaterials);
  // What forces the friend to approve a price is not having one, plus whatever
  // the admin marked by hand. A priced idea is ordered at the price shown.
  const requiresPriceApproval = orderType !== 'catalog' || Boolean(product?.requires_admin_approval) || !priced;
  // A model that has never been printed still lands in the admin's queue rather
  // than straight in the print queue, so a first print is never claimed by the
  // bridge unseen. The friend is asked for nothing: this only sets the status.
  const untestedFirstPrint = product?.catalog_kind === 'idea';
  const requiresApproval = requiresPriceApproval || needsColorAlternative || untestedFirstPrint;

  return {
    priced,
    row: {
      id: randomUUID(),
      productId,
      orderType,
      quantity,
      requestDescription: String(item.requestDescription ?? '').trim(),
      externalModelLink: String(item.externalModelLink ?? '').trim(),
      userNotes: String(item.userNotes ?? '').trim(),
      selectedColors: JSON.stringify(selectedColorsArray),
      productSnapshot: product ? JSON.stringify({
        id: product.id, name: product.name, image: product.image, catalogKind: product.catalog_kind,
        priceStatus: priced ? (product.catalog_kind === 'idea' ? 'estimated' : 'firm') : 'pending',
        possibleColors: product.possible_colors || [], allowMultiple: product.allow_multiple !== false,
        selectedColors: selectedColorsArray,
      }) : null,
      colorAlternativeStatus: needsColorAlternative ? 'needed' : 'none',
      baseCost,
      marginComponent,
      requiresPriceApproval,
      status: requiresApproval ? (needsColorAlternative ? 'waiting_approval' : 'new') : 'waiting_print',
      estimatedMaterialWeight: product ? numberOrNull(product.grams) : null,
      estimatedPrintTime: product ? numberOrNull(product.print_hours) : null,
      productionCost: breakdown?.productionCost ?? null,
      wearComponent: breakdown?.wearCost ?? null,
      machineComponent: breakdown?.machineCost ?? null,
      printHours: breakdown?.totalHours ?? null,
      printProfile: product?.print_profile || 'regular',
      materialGrams: breakdown?.materialGrams ?? null,
      marginPercent: breakdown?.marginPercent ?? null,
    },
  };
}

function insertOrderQuery(sql, user, row, cartId, cartPosition) {
  const finalAmount = row.baseCost == null ? null : row.baseCost + row.supportAmount;
  return sql`
    INSERT INTO orders (
      id, product_id, user_id, friend_name, order_type, request_description,
      external_model_link, quantity, selected_colors, product_snapshot,
      color_alternative_status, user_notes, admin_notes,
      base_cost, support_amount, final_amount, price, estimated_material_weight,
      estimated_print_time, requires_user_price_approval, user_approved_price,
      production_cost, wear_component, machine_component, margin_component,
      print_hours, print_profile, material_grams, margin_percent, internal,
      cart_id, cart_position,
      status, paid, created_at, updated_at
    ) VALUES (
      ${row.id}, ${row.productId}, ${user.id}, ${user.name}, ${row.orderType},
      ${row.requestDescription},
      ${row.externalModelLink}, ${row.quantity}, ${row.selectedColors}, ${row.productSnapshot}::jsonb,
      ${row.colorAlternativeStatus},
      ${row.userNotes}, '', ${row.baseCost},
      ${row.supportAmount}, ${finalAmount}, ${finalAmount ?? 0},
      ${row.estimatedMaterialWeight},
      ${row.estimatedPrintTime},
      ${row.requiresPriceApproval}, FALSE,
      ${row.productionCost}, ${row.wearComponent},
      ${row.machineComponent}, ${row.marginComponent},
      ${row.printHours}, ${row.printProfile}, ${row.materialGrams},
      ${row.marginPercent}, FALSE,
      ${cartId}, ${cartPosition},
      ${row.status}, FALSE, NOW(), NOW()
    )
    RETURNING ${sql.unsafe(SELECT_COLUMNS)}
  `;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const id = String(req.query.id ?? '').trim();
  const mine = req.query.mine === 'true';
  const action = String(req.query.action ?? '');

  if (action === 'mark-paid') {
    if (req.method !== 'PUT') return res.status(405).end();
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const body = await parseBody(req);
      const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String).filter(Boolean) : [];
      if (orderIds.length === 0) return res.status(400).json({ error: 'orderIds is required' });
      const paid = body.paid === undefined ? true : Boolean(body.paid);
      const sql = getSql();
      // A cancelled order is never owed, so it must not be swept into a bulk payment.
      const result = await sql.query(
        `UPDATE orders SET paid = $1, paid_at = CASE WHEN $1 THEN NOW() ELSE NULL END, updated_at = NOW()
         WHERE id = ANY($2) AND status <> 'cancelled' RETURNING ${SELECT_COLUMNS}`,
        [paid, orderIds]
      );
      const colorNames = await filamentNames(sql);
      return res.json({ ok: true, orders: (result.rows ?? result).map((row) => normalizeRow(row, colorNames)) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (id) {
    if (req.method === 'PUT') {
      const body = await parseBody(req);

      if (body.action === 'propose-color-alternative') {
        const admin = await requireAdmin(req, res);
        if (!admin) return;
        try {
          const sql = getSql();
          const proposal = body.proposedAlternativeColor;
          const proposalId = colorValue(proposal);
          if (!proposalId) return res.status(400).json({ error: 'Alternative color is required' });
          const filamentRows = await sql`SELECT id, name, color_hex, active, remaining_grams FROM filaments WHERE id = ${proposalId}`;
          const filament = filamentRows[0];
          if (!filament || !filament.active || Number(filament.remaining_grams ?? 1) <= 0) {
            return res.status(400).json({ error: 'Alternative color must be an available filament' });
          }
          const safeProposal = JSON.stringify({ value: filament.id, name: filament.name, colorHex: filament.color_hex });
          const updated = await sql`UPDATE orders SET
            proposed_alternative_color = ${safeProposal}::jsonb,
            color_alternative_status = 'pending',
            color_alternative_proposed_at = NOW(), color_alternative_responded_at = NULL,
            status = CASE WHEN status IN ('waiting_print', 'printing') THEN 'waiting_approval' ELSE status END,
            updated_at = NOW()
            WHERE id = ${id} AND color_alternative_status IN ('needed', 'pending', 'rejected')
            RETURNING ${sql.unsafe(SELECT_COLUMNS)}`;
          if (!updated.length) return res.status(400).json({ error: 'Order is not waiting for a color alternative' });
          return res.json(normalizeRow(updated[0], await filamentNames(sql)));
        } catch (err) {
          return res.status(500).json({ error: err.message });
        }
      }

      if (['cancel', 'approve-price', 'approve-color-alternative', 'reject-color-alternative'].includes(body.action)) {
        const user = await requireAuth(req, res);
        if (!user) return;
        try {
          const sql = getSql();
          const rows = await sql`
            SELECT user_id, friend_name, status, requires_user_price_approval, color_alternative_status
            FROM orders WHERE id = ${id}
          `;
          const order = rows[0];
          if (!order) return res.status(404).json({ error: 'Not found' });
          const owns = user.role === 'admin'
            || order.user_id === user.id
            || (order.user_id == null && order.friend_name === user.name);
          if (!owns) return res.status(403).json({ error: 'Forbidden' });
          const currentStatus = normalizeOrderStatus(order.status);

          if (body.action === 'cancel') {
            if (!['new', 'waiting_approval', 'waiting_print'].includes(currentStatus)) {
              return res.status(400).json({ error: 'לא ניתן לבטל הזמנה שכבר בהדפסה או שהסתיימה' });
            }
            const reason = String(body.cancellationReason ?? '').trim();
            if (!reason) return res.status(400).json({ error: 'Cancellation reason is required' });
            const updated = await sql`
              UPDATE orders SET status = 'cancelled', cancellation_reason = ${reason}, updated_at = NOW()
              WHERE id = ${id}
              RETURNING ${sql.unsafe(SELECT_COLUMNS)}
            `;
            return res.json(normalizeRow(updated[0], await filamentNames(sql)));
          }

          if (body.action === 'approve-color-alternative' || body.action === 'reject-color-alternative') {
            if (order.color_alternative_status !== 'pending') return res.status(400).json({ error: 'אין הצעת צבע שממתינה לתגובה' });
            const approved = body.action === 'approve-color-alternative';
            const updated = await sql`UPDATE orders SET
              color_alternative_status = ${approved ? 'approved' : 'rejected'},
              selected_colors = CASE WHEN ${approved} THEN jsonb_build_array(proposed_alternative_color->>'value') ELSE selected_colors END,
              color_alternative_responded_at = NOW(),
              status = CASE WHEN ${approved} AND requires_user_price_approval = FALSE THEN 'waiting_print' ELSE 'waiting_approval' END,
              updated_at = NOW()
              WHERE id = ${id} RETURNING ${sql.unsafe(SELECT_COLUMNS)}`;
            return res.json(normalizeRow(updated[0], await filamentNames(sql)));
          }

          // approve-price
          if (currentStatus !== 'waiting_approval' || !order.requires_user_price_approval) {
            return res.status(400).json({ error: 'הזמנה זו אינה ממתינה לאישור מחיר' });
          }
          const updated = await sql`
            UPDATE orders SET
              user_approved_price = TRUE,
              status = CASE WHEN color_alternative_status IN ('needed', 'pending', 'rejected') THEN 'waiting_approval' ELSE 'waiting_print' END,
              updated_at = NOW()
            WHERE id = ${id}
            RETURNING ${sql.unsafe(SELECT_COLUMNS)}
          `;
          return res.json(normalizeRow(updated[0], await filamentNames(sql)));
        } catch (err) {
          return res.status(500).json({ error: err.message });
        }
      }

      const admin = await requireAdmin(req, res);
      if (!admin) return;
      try {
        const sql = getSql();
        const status = body.status === undefined ? null : canonicalStatus(body.status);
        if (body.status !== undefined && !status) {
          return res.status(400).json({ error: 'Invalid status' });
        }
        if (status === 'cancelled' && !String(body.cancellationReason ?? '').trim()) {
          return res.status(400).json({ error: 'Cancellation reason is required' });
        }
        const marginPercent = body.marginPercent === '' || body.marginPercent == null ? null : Number(body.marginPercent);
        if (marginPercent != null && (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent > 5)) {
          return res.status(400).json({ error: 'אחוז הרווח חייב להיות בין 0% ל־500%' });
        }
        if (['waiting_print', 'printing'].includes(status)) {
          const guardRows = await sql`
            SELECT color_alternative_status, requires_user_price_approval, user_approved_price
            FROM orders WHERE id = ${id}
          `;
          const guard = guardRows[0];
          if (guard && ['needed', 'pending', 'rejected'].includes(guard.color_alternative_status)) {
            return res.status(409).json({ error: 'לא ניתן להתחיל הדפסה לפני אישור חלופת הצבע' });
          }
          // Special orders must be approved by the customer before printing.
          // The price may be set in this same request, so honour the incoming values too.
          const stillNeedsPrice = body.requiresUserPriceApproval !== undefined
            ? Boolean(body.requiresUserPriceApproval) : guard?.requires_user_price_approval;
          const alreadyApproved = body.userApprovedPrice !== undefined
            ? Boolean(body.userApprovedPrice) : guard?.user_approved_price;
          if (guard && stillNeedsPrice && !alreadyApproved) {
            return res.status(409).json({ error: 'לא ניתן להתחיל הדפסה לפני שהלקוח אישר את המחיר' });
          }
        }

        const rows = await sql`
          UPDATE orders SET
            status = COALESCE(${status}, status),
            paid = CASE WHEN ${body.paid !== undefined} THEN ${Boolean(body.paid)} ELSE paid END,
            paid_at = CASE WHEN ${body.paid !== undefined}
              THEN (CASE WHEN ${Boolean(body.paid)} THEN NOW() ELSE NULL END) ELSE paid_at END,
            admin_notes = CASE WHEN ${body.adminNotes !== undefined} THEN ${String(body.adminNotes ?? '').trim()} ELSE admin_notes END,
            base_cost = CASE WHEN ${body.baseCost !== undefined} THEN ${numberOrNull(body.baseCost)} ELSE base_cost END,
            support_amount = CASE WHEN ${body.supportAmount !== undefined} THEN ${Number(body.supportAmount) || 0} ELSE support_amount END,
            final_amount = CASE WHEN ${body.finalAmount !== undefined || body.price !== undefined}
              THEN ${numberOrNull(body.finalAmount ?? body.price)} ELSE final_amount END,
            price = CASE WHEN ${body.finalAmount !== undefined || body.price !== undefined}
              THEN ${numberOrNull(body.finalAmount ?? body.price)} ELSE price END,
            estimated_material_weight = CASE WHEN ${body.estimatedMaterialWeight !== undefined}
              THEN ${numberOrNull(body.estimatedMaterialWeight)} ELSE estimated_material_weight END,
            estimated_print_time = CASE WHEN ${body.estimatedPrintTime !== undefined}
              THEN ${numberOrNull(body.estimatedPrintTime)} ELSE estimated_print_time END,
            requires_user_price_approval = CASE WHEN ${body.requiresUserPriceApproval !== undefined}
              THEN ${Boolean(body.requiresUserPriceApproval)} ELSE requires_user_price_approval END,
            user_approved_price = CASE WHEN ${body.userApprovedPrice !== undefined}
              THEN ${Boolean(body.userApprovedPrice)} ELSE user_approved_price END,
            cancellation_reason = CASE WHEN ${status === 'cancelled'}
              THEN ${String(body.cancellationReason ?? '').trim()} ELSE cancellation_reason END,
            margin_percent = CASE WHEN ${body.marginPercent !== undefined} THEN ${marginPercent} ELSE margin_percent END,
            internal = CASE WHEN ${body.internal !== undefined} THEN ${Boolean(body.internal)} ELSE internal END,
            failed_attempts = CASE WHEN ${status === 'failed'} AND status <> 'failed'
              THEN failed_attempts + 1 ELSE failed_attempts END,
            wasted_grams = CASE WHEN ${body.wastedGrams !== undefined} THEN ${Math.max(Number(body.wastedGrams) || 0, 0)} ELSE wasted_grams END,
            wasted_hours = CASE WHEN ${body.wastedHours !== undefined} THEN ${Math.max(Number(body.wastedHours) || 0, 0)} ELSE wasted_hours END,
            completed_at = CASE WHEN ${status === 'completed'} THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING ${sql.unsafe(SELECT_COLUMNS)}
        `;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const updated = rows[0];
        await finalizeOrder(sql, updated, status);
        return res.json(normalizeRow(updated, await filamentNames(sql)));
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === 'DELETE') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      try {
        const sql = getSql();
        const rows = await sql`DELETE FROM orders WHERE id = ${id} RETURNING id`;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
    return res.status(405).end();
  }

  if (mine) {
    if (req.method !== 'GET') return res.status(405).end();
    const user = await requireAuth(req, res);
    if (!user) return;
    try {
      const sql = getSql();
      const result = await sql.query(
        `SELECT ${SELECT_COLUMNS} FROM orders
         WHERE user_id = $1 OR (user_id IS NULL AND friend_name = $2)
         ORDER BY created_at DESC`,
        [user.id, user.name]
      );
      const colorNames = await filamentNames(sql);
      return res.json((result.rows ?? result).map((row) => normalizeRow(row, colorNames)));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'GET') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const sql = getSql();
      const result = await sql.query(`SELECT ${SELECT_COLUMNS} FROM orders ORDER BY created_at DESC`);
      const colorNames = await filamentNames(sql);
      return res.json((result.rows ?? result).map((row) => normalizeRow(row, colorNames)));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const user = await requireActiveUser(req, res);
    if (!user) return;
    try {
      const body = await parseBody(req);
      const sql = getSql();

      // Two shapes on one endpoint: a cart checkout sends { items: [...] } and
      // becomes one order row per line joined by a shared cart_id; everything
      // else — the external-link / custom request dialog — still sends a single
      // order at the top level and is treated as a cart of one.
      const isCart = Array.isArray(body.items);
      let items;
      if (isCart) {
        const normalized = normalizeCartItems(body.items, colorValue);
        if (normalized.error) return res.status(400).json({ error: normalized.error });
        items = normalized.items;
      } else {
        items = [body];
      }

      const ctx = await loadOrderContext(sql);

      // Every line is validated before a single row is written, so one bad item
      // never leaves half a cart behind for the admin to clean up.
      const built = [];
      for (const item of items) {
        const result = await buildOrderRow(sql, user, item, ctx);
        if (result.error) return res.status(result.statusCode).json({ error: result.error });
        built.push(result);
      }

      // One optional support amount per checkout, recorded whole on one row so
      // the cart total stays exactly what the friend was shown.
      const supportAmount = Math.max(Number(body.supportAmount) || 0, 0);
      const supportIndex = supportTargetIndex(built);
      built.forEach((entry, index) => {
        entry.row.supportAmount = index === supportIndex ? supportAmount : 0;
      });

      const cartId = isCart ? randomUUID() : null;
      const results = await sql.transaction(
        built.map((entry, index) => insertOrderQuery(sql, user, entry.row, cartId, index)),
      );
      const orders = results.map((rows) => normalizeRow(rows[0], ctx.colorNames));
      return res.status(201).json(isCart ? orders : orders[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
