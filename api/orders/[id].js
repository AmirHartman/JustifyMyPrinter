const { getSql } = require('../_db');
const { parseBody, requireAdmin } = require('../_middleware');

const VALID_STATUSES = ['new', 'printing', 'ready', 'delivered'];

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const body = await parseBody(req);
      const sql = getSql();
      const newStatus = body.status !== undefined && VALID_STATUSES.includes(body.status) ? body.status : null;
      const newPaid = body.paid !== undefined ? Boolean(body.paid) : null;

      await sql`
        UPDATE orders SET
          status = COALESCE(${newStatus}, status),
          paid   = COALESCE(${newPaid}, paid)
        WHERE id = ${id}
      `;

      const rows = await sql`
        SELECT id, product_id, friend_name, quantity, price, status, paid, created_at
        FROM orders WHERE id = ${id}
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const r = rows[0];
      return res.json({ id: r.id, productId: r.product_id, friendName: r.friend_name, quantity: Number(r.quantity), price: Number(r.price), status: r.status, paid: Boolean(r.paid), createdAt: r.created_at });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
