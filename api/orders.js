const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAuth, requireAdmin } = require('./_middleware');

function normalizeRow(row) {
  return {
    id: row.id,
    productId: row.product_id,
    friendName: row.friend_name,
    quantity: Number(row.quantity),
    price: Number(row.price),
    status: row.status,
    paid: Boolean(row.paid),
    createdAt: row.created_at,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

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
      // Compare in integer cents to avoid float precision issues (e.g. 2.7 * 3 = 8.100000000000001)
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
