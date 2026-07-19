const { getSql } = require('./_db');
const { requireAdmin } = require('./_middleware');

const PRINTER_ID = 'p2s';
// The bridge heartbeats on every poll; if we haven't heard from it recently we
// show it offline so the owner knows jobs won't move.
const BRIDGE_ONLINE_WINDOW_MS = 30 * 1000;

function normalizePrinter(row, currentJob) {
  const seenAt = row.bridge_seen_at ? new Date(row.bridge_seen_at) : null;
  const bridgeOnline = seenAt ? (Date.now() - seenAt.getTime()) < BRIDGE_ONLINE_WINDOW_MS : false;
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    currentJobId: row.current_job_id ?? null,
    currentJob: currentJob ?? null,
    bridgeOnline,
    bridgeSeenAt: row.bridge_seen_at ?? null,
    updatedAt: row.updated_at,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const action = String(req.query.action ?? '');

  if (req.method === 'GET') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const sql = getSql();
      const rows = await sql`SELECT * FROM printers WHERE id = ${PRINTER_ID}`;
      if (!rows.length) return res.json(null);
      let currentJob = null;
      if (rows[0].current_job_id) {
        const jr = await sql`
          SELECT pj.id, pj.status, pj.progress, pj.product_id, p.name AS product_name
          FROM print_jobs pj LEFT JOIN products p ON p.id = pj.product_id
          WHERE pj.id = ${rows[0].current_job_id}
        `;
        if (jr[0]) currentJob = { id: jr[0].id, status: jr[0].status, progress: Number(jr[0].progress) || 0, productName: jr[0].product_name || jr[0].product_id };
      }
      return res.json(normalizePrinter(rows[0], currentJob));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Admin: mark the printer free after clearing the bed for the next print ──
  if (req.method === 'PUT' && action === 'free') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      const sql = getSql();
      const rows = await sql`
        UPDATE printers SET state = 'idle', current_job_id = NULL, updated_at = NOW()
        WHERE id = ${PRINTER_ID}
          AND NOT EXISTS (
            SELECT 1 FROM print_jobs
            WHERE id = printers.current_job_id AND status IN ('claimed', 'uploading', 'printing')
          )
        RETURNING *
      `;
      if (!rows.length) return res.status(409).json({ error: 'לא ניתן לסמן כפנויה בזמן שההדפסה עדיין פעילה' });
      return res.json(normalizePrinter(rows[0], null));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
};
