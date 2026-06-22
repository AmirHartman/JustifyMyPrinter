const { getSql } = require('./_db');
const { requireAuth } = require('./_middleware');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const user = await requireAuth(req, res);
  if (!user) return;
  const sql = getSql();

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT id, message, order_id, read, created_at
        FROM notifications
        WHERE user_name = ${user.name}
        ORDER BY created_at DESC
        LIMIT 30
      `;
      return res.json(rows.map((r) => ({
        id:        r.id,
        message:   r.message,
        orderId:   r.order_id,
        read:      Boolean(r.read),
        createdAt: r.created_at,
      })));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PUT — mark all as read
  if (req.method === 'PUT') {
    try {
      await sql`UPDATE notifications SET read = TRUE WHERE user_name = ${user.name}`;
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
