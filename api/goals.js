const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAdmin } = require('./_middleware');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!await requireAdmin(req, res)) return;
  const sql = getSql();
  const id = String(req.query.id || '');
  try {
    if (req.method === 'GET') return res.json(await sql`SELECT * FROM goals ORDER BY sort_order, created_at`);
    if (req.method === 'POST') {
      const body = await parseBody(req); const target = Number(body.targetAmount);
      if (!String(body.name || '').trim() || !Number.isFinite(target) || target <= 0) return res.status(400).json({ error: 'Name and positive target required' });
      const rows = await sql`INSERT INTO goals (id, name, target_amount, sort_order) VALUES (${randomUUID()}, ${String(body.name).trim()}, ${target}, ${Number(body.sortOrder) || 0}) RETURNING *`;
      return res.status(201).json(rows[0]);
    }
    if (req.method === 'PUT' && id) {
      const body = await parseBody(req); const saved = Number(body.saved);
      if (!Number.isFinite(saved) || saved < 0) return res.status(400).json({ error: 'Saved must be non-negative' });
      const funds = await sql`SELECT
        COALESCE((SELECT SUM(COALESCE(machine_component,0) + COALESCE(margin_component,0)) FROM orders WHERE paid = TRUE), 0)
        - COALESCE((SELECT SUM(saved) FROM goals WHERE id <> ${id}), 0)
        - COALESCE((SELECT SUM(ABS(amount)) FROM owner_ledger WHERE kind = 'withdrawal'), 0) AS available`;
      if (saved > Number(funds[0].available)) return res.status(400).json({ error: 'ההקצאה חורגת מהיתרה הפנויה בקופת העסק' });
      const rows = await sql`UPDATE goals SET saved = LEAST(${saved}, target_amount), achieved_at = CASE WHEN ${saved} >= target_amount THEN COALESCE(achieved_at, NOW()) ELSE NULL END WHERE id = ${id} RETURNING *`;
      return rows.length ? res.json(rows[0]) : res.status(404).json({ error: 'Not found' });
    }
    if (req.method === 'DELETE' && id) { await sql`DELETE FROM goals WHERE id = ${id}`; return res.json({ ok: true }); }
    return res.status(405).end();
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
