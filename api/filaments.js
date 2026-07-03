const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAuth, requireAdmin } = require('./_middleware');

function normalizeRow(row) {
  return {
    id:          row.id,
    name:        row.name,
    materialType: row.material_type,
    colorHex:    row.color_hex,
    pricePerKg:  Number(row.price_per_kg),
    active:      Boolean(row.active),
    note:        row.note ?? '',
    createdAt:   row.created_at,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return;
    try {
      const sql = getSql();
      const rows = await sql`SELECT * FROM filaments ORDER BY created_at ASC`;
      return res.json(rows.map(normalizeRow));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const body        = await parseBody(req);
      const sql         = getSql();
      const id          = randomUUID();
      const name        = String(body.name ?? '').trim();
      const materialType = String(body.materialType ?? 'PLA').trim();
      const colorHex    = String(body.colorHex ?? '#000000').trim();
      const pricePerKg  = Math.max(Number(body.pricePerKg) || 0, 0);
      const note        = String(body.note ?? '').trim();

      if (!name) return res.status(400).json({ error: 'Name required' });

      await sql`
        INSERT INTO filaments (id, name, material_type, color_hex, price_per_kg, note)
        VALUES (${id}, ${name}, ${materialType}, ${colorHex}, ${pricePerKg}, ${note})
      `;
      return res.status(201).json(normalizeRow({ id, name, material_type: materialType, color_hex: colorHex, price_per_kg: pricePerKg, active: true, note, created_at: new Date().toISOString() }));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
