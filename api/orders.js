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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

const SELECT_COLUMNS = `
  id, product_id, user_id, friend_name, order_type, request_description,
  external_model_link, quantity, selected_colors, user_notes, admin_notes,
  base_cost, support_amount, final_amount, price, estimated_material_weight,
  estimated_print_time, requires_user_price_approval, user_approved_price,
  cancellation_reason, status, paid, created_at, updated_at, completed_at
`;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const id = String(req.query.id ?? '').trim();
  const mine = req.query.mine === 'true';

  if (id) {
    if (req.method === 'PUT') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      try {
        const body = await parseBody(req);
        const sql = getSql();
        const status = body.status === undefined ? null : canonicalStatus(body.status);
        if (body.status !== undefined && !status) {
          return res.status(400).json({ error: 'Invalid status' });
        }
        if (status === 'cancelled' && !String(body.cancellationReason ?? '').trim()) {
          return res.status(400).json({ error: 'Cancellation reason is required' });
        }

        const rows = await sql`
          UPDATE orders SET
            status = COALESCE(${status}, status),
            paid = CASE WHEN ${body.paid !== undefined} THEN ${Boolean(body.paid)} ELSE paid END,
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
            completed_at = CASE WHEN ${status === 'completed'} THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
            updated_at = NOW()
          WHERE id = ${id}
          RETURNING
            id, product_id, user_id, friend_name, order_type, request_description,
            external_model_link, quantity, selected_colors, user_notes, admin_notes,
            base_cost, support_amount, final_amount, price, estimated_material_weight,
            estimated_print_time, requires_user_price_approval, user_approved_price,
            cancellation_reason, status, paid, created_at, updated_at, completed_at
        `;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.json(normalizeRow(rows[0]));
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === 'DELETE') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      try {
        const sql = getSql();
        await sql`DELETE FROM notifications WHERE order_id = ${id}`;
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
      const quantity = Math.max(Number(body.quantity) || 1, 1);
      let product = null;
      if (productId) {
        const rows = await sql`
          SELECT cost, grams, print_hours, requires_admin_approval
          FROM products WHERE id = ${productId} AND active = TRUE
        `;
        product = rows[0] || null;
        if (!product) return res.status(404).json({ error: 'Product not found' });
      }
      if (orderType === 'catalog' && !product) {
        return res.status(400).json({ error: 'Catalog orders require a product' });
      }

      const baseCost = product ? Number(product.cost) * quantity : numberOrNull(body.baseCost);
      const finalAmount = numberOrNull(body.finalAmount ?? body.price ?? baseCost);
      if (baseCost != null && finalAmount != null
          && Math.round(finalAmount * 100) < Math.round(baseCost * 100)) {
        return res.status(400).json({ error: `המינימום להזמנה הזו הוא ${baseCost.toFixed(2)}` });
      }
      const requiresApproval = orderType !== 'catalog' || Boolean(product?.requires_admin_approval);
      const status = requiresApproval ? 'new' : 'waiting_print';
      const id = randomUUID();
      const selectedColors = JSON.stringify(Array.isArray(body.selectedColors) ? body.selectedColors : []);

      const rows = await sql`
        INSERT INTO orders (
          id, product_id, user_id, friend_name, order_type, request_description,
          external_model_link, quantity, selected_colors, user_notes, admin_notes,
          base_cost, support_amount, final_amount, price, estimated_material_weight,
          estimated_print_time, requires_user_price_approval, user_approved_price,
          status, paid, created_at, updated_at
        ) VALUES (
          ${id}, ${productId}, ${user.id}, ${user.name}, ${orderType},
          ${String(body.requestDescription ?? '').trim()},
          ${String(body.externalModelLink ?? '').trim()}, ${quantity}, ${selectedColors},
          ${String(body.userNotes ?? '').trim()}, '', ${baseCost},
          ${Number(body.supportAmount) || 0}, ${finalAmount}, ${finalAmount ?? 0.01},
          ${numberOrNull(body.estimatedMaterialWeight ?? product?.grams)},
          ${numberOrNull(body.estimatedPrintTime ?? product?.print_hours)},
          ${requiresApproval}, FALSE, ${status}, FALSE, NOW(), NOW()
        )
        RETURNING
          id, product_id, user_id, friend_name, order_type, request_description,
          external_model_link, quantity, selected_colors, user_notes, admin_notes,
          base_cost, support_amount, final_amount, price, estimated_material_weight,
          estimated_print_time, requires_user_price_approval, user_approved_price,
          cancellation_reason, status, paid, created_at, updated_at, completed_at
      `;
      return res.status(201).json(normalizeRow(rows[0]));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
