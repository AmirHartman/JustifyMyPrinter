const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAdmin } = require('./_middleware');
const { config } = require('./_pricing');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const body = await parseBody(req);
    const valid = [...config.wearParts, ...config.maintenanceTasks].some((item) => item.id === body.partId);
    if (!valid) return res.status(400).json({ error: 'Unknown maintenance item' });
    const sql = getSql();
    const hours = await sql`SELECT COALESCE(SUM(print_hours), 0) AS total FROM orders WHERE status = 'completed'`;
    const rows = await sql`INSERT INTO maintenance_events (id, part_id, event_type, hours_at_event, notes)
      VALUES (${randomUUID()}, ${body.partId}, ${body.eventType === 'service' ? 'service' : 'replace'}, ${Number(hours[0].total)}, ${String(body.notes || '').trim()}) RETURNING *`;
    return res.status(201).json(rows[0]);
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
