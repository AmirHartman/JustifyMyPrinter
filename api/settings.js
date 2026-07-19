const { getSql } = require('./_db');
const { parseBody, requireAdmin } = require('./_middleware');
const { mergedSettings, editableSettings } = require('./_pricing');

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
      return res.json(mergedSettings(rows[0].value));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const body = await parseBody(req);
      let value;
      if (key === 'contact') {
        value = publicContact(body);
      } else {
        const marginPercent = Number(body.marginPercent);
        const minOrderPrice = Number(body.minOrderPrice);
        const riskPercentByLevel = body.riskPercentByLevel || body.riskPercents || {
          low: body.lowRiskPercent,
          medium: body.mediumRiskPercent,
          high: body.highRiskPercent,
        };
        if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent > 5) {
          return res.status(400).json({ error: 'אחוז הרווח חייב להיות בין 0% ל־500%' });
        }
        if (!Number.isFinite(minOrderPrice) || minOrderPrice < 0) {
          return res.status(400).json({ error: 'מחיר המינימום להזמנה חייב להיות מספר לא־שלילי' });
        }
        for (const level of ['low', 'medium', 'high']) {
          const risk = Number(riskPercentByLevel[level]);
          if (!Number.isFinite(risk) || risk < 0 || risk > 5) {
            return res.status(400).json({ error: 'אחוזי הסיכון חייבים להיות בין 0% ל־500%' });
          }
        }
        // Preserve independently managed wear/maintenance arrays when the
        // pricing form updates only margin, floor and risk percentages.
        value = editableSettings({
          ...(rows[0]?.value || {}),
          marginPercent,
          minOrderPrice,
          riskPercentByLevel,
        });
      }
      await sql`
        INSERT INTO settings (key, value)
        VALUES (${key}, ${JSON.stringify(value)})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      return res.json(key === 'pricing' ? mergedSettings(value) : value);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
