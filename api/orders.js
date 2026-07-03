const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAuth, requireAdmin } = require('./_middleware');

const VALID_STATUSES = ['new', 'approved', 'printing', 'ready', 'delivered', 'rejected'];

const STATUS_NOTIFICATION = {
  approved:  (p) => `ההזמנה שלך ל${p} אושרה ועומדת בתור להדפסה ✔️`,
  printing:  (p) => `ההזמנה שלך ל${p} נמצאת כרגע בהדפסה 🖨️`,
  ready:     (p) => `ההזמנה שלך ל${p} מוכנה ומחכה לך! 📦`,
  delivered: (p) => `ההזמנה שלך ל${p} נמסרה — תהנה! ✅`,
  rejected:  (p) => `ההזמנה שלך ל${p} לא אושרה 🚫`,
};

function normalizeRow(r) {
  return {
    id:         r.id,
    productId:  r.product_id,
    friendName: r.friend_name,
    quantity:   Number(r.quantity),
    price:      Number(r.price),
    status:     r.status,
    paid:       Boolean(r.paid),
    createdAt:  r.created_at,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const id   = String(req.query.id   ?? '').trim();
  const mine = req.query.mine === 'true';

  // ── /api/orders?id=:id — single-order operations ─────────────
  if (id) {
    if (req.method === 'PUT') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      try {
        const body      = await parseBody(req);
        const sql       = getSql();
        const newStatus = body.status !== undefined && VALID_STATUSES.includes(body.status) ? body.status : null;
        const newPaid   = body.paid   !== undefined ? Boolean(body.paid)   : null;

        const currentRows = await sql`
          SELECT friend_name, product_id, status FROM orders WHERE id = ${id}
        `;
        if (currentRows.length === 0) return res.status(404).json({ error: 'Not found' });
        const { friend_name: friendName, product_id: productId, status: oldStatus } = currentRows[0];

        await sql`
          UPDATE orders SET
            status = COALESCE(${newStatus}, status),
            paid   = COALESCE(${newPaid},   paid)
          WHERE id = ${id}
        `;

        if (newStatus && newStatus !== oldStatus) {
          const productRows = await sql`SELECT name FROM products WHERE id = ${productId}`;
          const productName = productRows[0]?.name ?? 'המוצר';
          const msgFn = STATUS_NOTIFICATION[newStatus];
          if (msgFn) {
            await sql`
              INSERT INTO notifications (id, user_name, message, order_id, created_at)
              VALUES (${randomUUID()}, ${friendName}, ${msgFn(productName)}, ${id}, NOW())
            `;
          }
        }

        const rows = await sql`
          SELECT id, product_id, friend_name, quantity, price, status, paid, created_at
          FROM orders WHERE id = ${id}
        `;
        return res.json(normalizeRow(rows[0]));
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === 'DELETE') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      try {
        const sql = getSql();
        await sql`DELETE FROM notifications WHERE order_id = ${id}`;
        const result = await sql`DELETE FROM orders WHERE id = ${id} RETURNING id`;
        if (result.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(405).end();
  }

  // ── /api/orders?mine=true — friend's own orders ───────────────
  if (mine) {
    if (req.method !== 'GET') return res.status(405).end();
    const user = await requireAuth(req, res);
    if (!user) return;
    try {
      const sql = getSql();
      const rows = await sql`
        SELECT id, product_id, friend_name, quantity, price, status, paid, created_at
        FROM orders WHERE friend_name = ${user.name}
        ORDER BY created_at DESC
      `;
      return res.json(rows.map(normalizeRow));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── /api/orders — collection operations ───────────────────────
  if (req.method === 'GET') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const sql = getSql();
      const rows = await sql`
        SELECT id, product_id, friend_name, quantity, price, status, paid, created_at
        FROM orders ORDER BY created_at DESC
      `;
      return res.json(rows.map(normalizeRow));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return;
    try {
      const body = await parseBody(req);
      const sql = getSql();
      const productId = String(body.productId ?? '');
      const friendName = user.name || String(body.friendName ?? '').trim();
      const quantity = Math.max(Number(body.quantity) || 1, 1);
      const price = Math.max(Number(body.price) || 0.01, 0.01);

      const productRows = await sql`SELECT cost FROM products WHERE id = ${productId}`;
      if (productRows.length === 0) return res.status(404).json({ error: 'Product not found' });
      const minimum = Number(productRows[0].cost) * quantity;
      if (Math.round(price * 100) < Math.round(minimum * 100)) return res.status(400).json({ error: `המינימום להזמנה הזו הוא ${minimum.toFixed(2)}` });

      const id = randomUUID();
      const createdAt = new Date().toISOString();
      await sql`
        INSERT INTO orders (id, product_id, friend_name, quantity, price, status, paid, created_at)
        VALUES (${id}, ${productId}, ${friendName}, ${quantity}, ${price}, 'new', FALSE, ${createdAt})
      `;
      return res.status(201).json({ id, productId, friendName, quantity, price, status: 'new', paid: false, createdAt });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
