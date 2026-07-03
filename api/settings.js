const { getSql } = require('./_db');
const { parseBody, requireAdmin } = require('./_middleware');

const ALLOWED_KEYS = ['pricing'];

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const key = String(req.query.key ?? '').trim();

  if (!ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Invalid settings key' });

  const user = await requireAdmin(req, res);
  if (!user) return;

  const sql = getSql();

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.json(rows[0].value);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = await parseBody(req);
      await sql`
        INSERT INTO settings (key, value)
        VALUES (${key}, ${JSON.stringify(body)})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      return res.json(body);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
