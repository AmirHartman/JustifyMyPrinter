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
const { calculateProductCost } = require('./_pricing');

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

function normalizeRow(row) {
  const finalAmount = numberOrNull(row.final_amount ?? row.price);
  return {
    id: row.id,
    productId: row.product_id,
    userId: row.user_id ?? null,
    friendName: row.friend_name,
    orderType: row.order_type ?? 'catalog',
    requestDescription: row.request_description ?? '',
    externalModelLink: row.external_model_link ?? '',
    quantity: Number(row.quantity),
    selectedColors: row.selected_colors ?? [],
    customText: row.custom_text ?? '',
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

const SELECT_COLUMNS = `
  id, product_id, user_id, friend_name, order_type, request_description,
  external_model_link, quantity, selected_colors, custom_text, product_snapshot,
  proposed_alternative_color, color_alternative_status, color_alternative_proposed_at,
  color_alternative_responded_at, user_notes, admin_notes,
  base_cost, support_amount, final_amount, price, estimated_material_weight,
  estimated_print_time, requires_user_price_approval, user_approved_price,
  cancellation_reason, status, paid, paid_at, production_cost, wear_component,
  machine_component, margin_component, print_hours, print_profile, material_grams, failed_attempts,
  wasted_grams, wasted_hours, margin_percent, internal, inventory_deducted, created_at, updated_at, completed_at
`;

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
      const result = await sql.query(
        `UPDATE orders SET paid = $1, paid_at = CASE WHEN $1 THEN NOW() ELSE NULL END, updated_at = NOW()
         WHERE id = ANY($2) RETURNING ${SELECT_COLUMNS}`,
        [paid, orderIds]
      );
      return res.json({ ok: true, orders: (result.rows ?? result).map(normalizeRow) });
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
          return updated.length ? res.json(normalizeRow(updated[0])) : res.status(400).json({ error: 'Order is not waiting for a color alternative' });
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
            return res.json(normalizeRow(updated[0]));
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
            return res.json(normalizeRow(updated[0]));
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
          return res.json(normalizeRow(updated[0]));
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
          const alternativeRows = await sql`SELECT color_alternative_status FROM orders WHERE id = ${id}`;
          if (alternativeRows[0] && ['needed', 'pending', 'rejected'].includes(alternativeRows[0].color_alternative_status)) {
            return res.status(409).json({ error: 'לא ניתן להתחיל הדפסה לפני אישור חלופת הצבע' });
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
            failed_attempts = CASE WHEN ${status === 'failed'} THEN failed_attempts + 1 ELSE failed_attempts END,
            wasted_grams = CASE WHEN ${body.wastedGrams !== undefined} THEN ${Math.max(Number(body.wastedGrams) || 0, 0)} ELSE wasted_grams END,
            wasted_hours = CASE WHEN ${body.wastedHours !== undefined} THEN ${Math.max(Number(body.wastedHours) || 0, 0)} ELSE wasted_hours END,
            completed_at = CASE WHEN ${status === 'completed'} THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING ${sql.unsafe(SELECT_COLUMNS)}
        `;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const updated = rows[0];
        if (status === 'completed' && updated.internal) {
          await sql`INSERT INTO owner_ledger (id, kind, description, amount, order_id)
            VALUES (${randomUUID()}, 'self_print', ${`הדפסה עצמית ${updated.id}`}, ${-Number(updated.production_cost || 0)}, ${updated.id})
            ON CONFLICT (order_id, kind) WHERE order_id IS NOT NULL DO NOTHING`;
        }
        if ((status === 'completed' || status === 'failed') && !updated.inventory_deducted) {
          const grams = status === 'completed'
            ? Number(updated.material_grams || 0) + Number(updated.wasted_grams || 0)
            : Number(updated.wasted_grams || 0);
          if (grams > 0 && updated.product_id) {
            await sql`UPDATE filaments SET remaining_grams = GREATEST(COALESCE(remaining_grams, spool_grams) - ${grams}, 0)
              WHERE id = (SELECT materials->0->>'filamentId' FROM products WHERE id = ${updated.product_id})`;
          }
          await sql`UPDATE orders SET inventory_deducted = TRUE WHERE id = ${updated.id}`;
        }
        return res.json(normalizeRow(updated));
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
      return res.json((result.rows ?? result).map(normalizeRow));
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
      return res.json((result.rows ?? result).map(normalizeRow));
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
      const orderType = String(body.orderType ?? 'catalog');
      if (!['catalog', 'external_link', 'custom', 'future_upload'].includes(orderType)) {
        return res.status(400).json({ error: 'Invalid order type' });
      }
      const productId = String(body.productId ?? '').trim() || null;
      const quantity = Number(body.quantity ?? 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) return res.status(400).json({ error: 'Quantity must be an integer between 1 and 50' });
      let product = null;
      if (productId) {
        const rows = await sql`
          SELECT id, name, description, image, images, source_url, category, category_ids,
                 catalog_kind, custom_text_enabled, possible_colors, required_colors,
                 allow_multiple, cost, grams, print_hours, print_profile, materials, requires_admin_approval,
                 manual_price_enabled, manual_price, purge_grams, risk_percent,
                 risk_level, additional_copy_hours, minimum_unit_price
          FROM products WHERE id = ${productId}
        `;
        product = rows[0] || null;
        if (!product) return res.status(404).json({ error: 'Product not found' });
        if (productMissingRequirements(product)) return res.status(409).json({ error: 'Product is not ready for catalog ordering' });
        if (!product.allow_multiple && quantity > 1) return res.status(400).json({ error: 'מוצר זה ניתן להזמנה ביחידה אחת בלבד' });
      }
      if (orderType === 'catalog' && !product) {
        return res.status(400).json({ error: 'Catalog orders require a product' });
      }

      let breakdown = null;
      if (product) {
        const filamentRows = await sql`SELECT id, name, color_hex, price_per_kg, spool_price, spool_grams, remaining_grams, active FROM filaments`;
        const settingRows = await sql`SELECT value FROM settings WHERE key = 'pricing'`;
        breakdown = calculateProductCost({
          printHours: Number(product.print_hours), printProfile: product.print_profile,
          materials: product.materials || [], purgeGrams: Number(product.purge_grams),
          riskPercent: product.risk_percent, riskLevel: product.risk_level, additionalCopyHours: product.additional_copy_hours,
          minUnitPrice: product.minimum_unit_price,
        }, filamentRows.map((f) => ({
          id: f.id, pricePerKg: Number(f.price_per_kg), spoolPrice: Number(f.spool_price),
          spoolGrams: Number(f.spool_grams), remainingGrams: f.remaining_grams == null ? null : Number(f.remaining_grams),
          active: f.active !== false, name: f.name, colorHex: f.color_hex,
        })), settingRows[0]?.value || {}, { quantity });
      }
      const baseCost = product
        ? product.manual_price_enabled && product.manual_price != null
          ? Number(product.manual_price) * quantity : breakdown.shopPrice
        : numberOrNull(body.baseCost);
      const supportAmount = Math.max(Number(body.supportAmount) || 0, 0);
      const finalAmount = baseCost == null ? numberOrNull(body.finalAmount ?? body.price) : baseCost + supportAmount;
      const selectedColorsArray = Array.isArray(body.selectedColors) ? body.selectedColors.map(colorValue).filter(Boolean) : [];
      const allowedColors = new Set((product?.possible_colors || []).map(colorValue).filter(Boolean));
      if (product && selectedColorsArray.some((value) => !allowedColors.has(value))) {
        return res.status(400).json({ error: 'Selected color is not available for this product' });
      }
      if (product && allowedColors.size > 0 && selectedColorsArray.length === 0) {
        return res.status(400).json({ error: 'Please select a product color' });
      }
      const customText = String(body.customText ?? '').trim();
      if (customText.length > 500) return res.status(400).json({ error: 'Custom text is too long' });
      if (customText && !product?.custom_text_enabled) return res.status(400).json({ error: 'This product does not accept custom text' });
      const availabilityRows = product ? await sql`SELECT id, name, color_hex, active, remaining_grams FROM filaments` : [];
      const unavailableSelection = selectedColorsArray.some((value) => {
        const filament = availabilityRows.find((item) => item.id === value);
        return filament && (!filament.active || Number(filament.remaining_grams ?? 1) <= 0);
      });
      const unavailableMaterials = product?.materials?.some((material) => {
        const filament = availabilityRows.find((item) => item.id === material.filamentId);
        return !filament || !filament.active || (filament.remaining_grams != null && Number(filament.remaining_grams) < Number(material.grams || 0) * quantity);
      });
      const needsColorAlternative = Boolean(unavailableSelection || unavailableMaterials);
      const requiresPriceApproval = orderType !== 'catalog' || Boolean(product?.requires_admin_approval) || product?.catalog_kind === 'idea';
      const requiresApproval = requiresPriceApproval || needsColorAlternative;
      const status = requiresApproval ? (needsColorAlternative ? 'waiting_approval' : 'new') : 'waiting_print';
      const id = randomUUID();
      const selectedColors = JSON.stringify(selectedColorsArray);
      const productSnapshot = product ? JSON.stringify({
        id: product.id, name: product.name, image: product.image, catalogKind: product.catalog_kind,
        possibleColors: product.possible_colors || [], allowMultiple: product.allow_multiple !== false,
        customTextEnabled: Boolean(product.custom_text_enabled), selectedColors: selectedColorsArray, customText,
      }) : null;

      const rows = await sql`
        INSERT INTO orders (
          id, product_id, user_id, friend_name, order_type, request_description,
          external_model_link, quantity, selected_colors, custom_text, product_snapshot,
          color_alternative_status, user_notes, admin_notes,
          base_cost, support_amount, final_amount, price, estimated_material_weight,
          estimated_print_time, requires_user_price_approval, user_approved_price,
          production_cost, wear_component, machine_component, margin_component,
          print_hours, print_profile, material_grams, margin_percent, internal,
          status, paid, created_at, updated_at
        ) VALUES (
          ${id}, ${productId}, ${user.id}, ${user.name}, ${orderType},
          ${String(body.requestDescription ?? '').trim()},
          ${String(body.externalModelLink ?? '').trim()}, ${quantity}, ${selectedColors}, ${customText}, ${productSnapshot}::jsonb,
          ${needsColorAlternative ? 'needed' : 'none'},
          ${String(body.userNotes ?? '').trim()}, '', ${baseCost},
          ${supportAmount}, ${finalAmount}, ${finalAmount ?? 0.01},
          ${numberOrNull(body.estimatedMaterialWeight ?? product?.grams)},
          ${numberOrNull(body.estimatedPrintTime ?? product?.print_hours)},
          ${requiresPriceApproval}, FALSE,
          ${breakdown?.productionCost ?? null}, ${breakdown?.wearCost ?? null},
          ${breakdown?.machineCost ?? null}, ${breakdown?.marginAmount ?? null},
          ${breakdown?.totalHours ?? null}, ${product?.print_profile || 'regular'}, ${breakdown?.materialGrams ?? null},
          ${breakdown?.marginPercent ?? null}, FALSE,
          ${status}, FALSE, NOW(), NOW()
        )
        RETURNING ${sql.unsafe(SELECT_COLUMNS)}
      `;
      return res.status(201).json(normalizeRow(rows[0]));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
