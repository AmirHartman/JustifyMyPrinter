const { getSql } = require('./_db');
const { parseBody, requireAdmin } = require('./_middleware');

const ALLOWED_KEYS = ['pricing', 'contact'];

function publicContact(value = {}) {
  return {
    whatsappPhone: String(process.env.ADMIN_WHATSAPP_PHONE || value.whatsappPhone || '').trim(),
    displayLabel: String(process.env.ADMIN_WHATSAPP_LABEL || value.displayLabel || 'אמיר').trim(),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const key = String(req.query.key ?? '').trim();

  if (!ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Invalid settings key' });

  const sql = getSql();

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT value FROM settings WHERE key = ${key}`;
      if (key === 'contact') return res.json(publicContact(rows[0]?.value));
      const user = await requireAdmin(req, res);
      if (!user) return;
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.json(rows[0].value);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const body = await parseBody(req);
      const value = key === 'contact' ? publicContact(body) : body;
      await sql`
        INSERT INTO settings (key, value)
        VALUES (${key}, ${JSON.stringify(value)})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      return res.json(value);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
