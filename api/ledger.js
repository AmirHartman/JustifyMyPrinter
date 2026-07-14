const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAdmin } = require('./_middleware');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!await requireAdmin(req, res)) return;
  const sql = getSql();
  const id = String(req.query.id || '');
  try {
    if (req.method === 'GET') return res.json(await sql`SELECT * FROM owner_ledger ORDER BY occurred_at DESC, created_at DESC`);
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const kind = String(body.kind || 'investment');
      if (!['investment', 'withdrawal'].includes(kind)) return res.status(400).json({ error: 'Invalid ledger kind' });
      const raw = Number(body.amount);
      if (!Number.isFinite(raw) || raw <= 0) return res.status(400).json({ error: 'Amount must be positive' });
      const amount = kind === 'investment' ? raw : -raw;
      const rows = await sql`INSERT INTO owner_ledger (id, kind, description, amount, occurred_at, notes)
        VALUES (${randomUUID()}, ${kind}, ${String(body.description || '').trim()}, ${amount}, ${body.occurredAt || new Date().toISOString().slice(0, 10)}, ${String(body.notes || '').trim()}) RETURNING *`;
      return res.status(201).json(rows[0]);
    }
    if (req.method === 'DELETE' && id) {
      const rows = await sql`DELETE FROM owner_ledger WHERE id = ${id} AND kind <> 'self_print' RETURNING id`;
      return rows.length ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
    }
    return res.status(405).end();
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
