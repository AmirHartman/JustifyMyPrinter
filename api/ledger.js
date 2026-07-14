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
      const rows = await sql`INSERT INTO owner_ledger (id, kind, description, amount, occurred_at, notes, public_visible, public_label)
        VALUES (${randomUUID()}, ${kind}, ${String(body.description || '').trim()}, ${amount}, ${body.occurredAt || new Date().toISOString().slice(0, 10)}, ${String(body.notes || '').trim()}, ${Boolean(body.publicVisible)}, ${String(body.publicLabel || '').trim()}) RETURNING *`;
      return res.status(201).json(rows[0]);
    }
    if (req.method === 'PUT' && id) {
      const body = await parseBody(req);
      const rows = await sql`UPDATE owner_ledger SET
        public_visible = CASE WHEN ${body.publicVisible !== undefined} THEN ${Boolean(body.publicVisible)} ELSE public_visible END,
        public_label = CASE WHEN ${body.publicLabel !== undefined} THEN ${String(body.publicLabel || '').trim()} ELSE public_label END
        WHERE id = ${id} RETURNING *`;
      return rows.length ? res.json(rows[0]) : res.status(404).json({ error: 'Not found' });
    }
    if (req.method === 'DELETE' && id) {
      const rows = await sql`DELETE FROM owner_ledger WHERE id = ${id} AND kind <> 'self_print' RETURNING id`;
      return rows.length ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
    }
    return res.status(405).end();
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
