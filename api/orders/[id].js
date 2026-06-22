const { randomUUID } = require('crypto');
const { getSql } = require('../_db');
const { parseBody, requireAdmin } = require('../_middleware');

const VALID_STATUSES = ['new', 'printing', 'ready', 'delivered', 'rejected'];

const STATUS_NOTIFICATION = {
  printing:  (p) => `ההזמנה שלך ל${p} נמצאת כרגע בהדפסה 🖨️`,
  ready:     (p) => `ההזמנה שלך ל${p} מוכנה ומחכה לך! 📦`,
  delivered: (p) => `ההזמנה שלך ל${p} נמסרה — תהנה! ✅`,
  rejected:  (p) => `ההזמנה שלך ל${p} לא אושרה 🚫`,
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const body      = await parseBody(req);
      const sql       = getSql();
      const newStatus = body.status !== undefined && VALID_STATUSES.includes(body.status) ? body.status : null;
      const newPaid   = body.paid   !== undefined ? Boolean(body.paid)   : null;

      // Fetch current order to detect status changes and get friend/product info
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

      // Create inbox notification when status actually changes
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
      const r = rows[0];
      return res.json({
        id: r.id, productId: r.product_id, friendName: r.friend_name,
        quantity: Number(r.quantity), price: Number(r.price),
        status: r.status, paid: Boolean(r.paid), createdAt: r.created_at,
      });
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

  res.status(405).end();
};
