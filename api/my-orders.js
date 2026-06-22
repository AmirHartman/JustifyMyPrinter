const { getSql } = require('./_db');
const { requireAuth } = require('./_middleware');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
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
    return res.json(rows.map((r) => ({
      id:         r.id,
      productId:  r.product_id,
      friendName: r.friend_name,
      quantity:   Number(r.quantity),
      price:      Number(r.price),
      status:     r.status,
      paid:       Boolean(r.paid),
      createdAt:  r.created_at,
    })));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
