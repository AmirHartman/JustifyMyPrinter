const { getSql } = require('../_db');
const { parseBody, requireAdmin } = require('../_middleware');

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
  const { id } = req.query;

  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const body        = await parseBody(req);
      const sql         = getSql();
      const name        = body.name        !== undefined ? String(body.name).trim()        : null;
      const materialType = body.materialType !== undefined ? String(body.materialType).trim() : null;
      const colorHex    = body.colorHex    !== undefined ? String(body.colorHex).trim()    : null;
      const pricePerKg  = body.pricePerKg  !== undefined ? Math.max(Number(body.pricePerKg) || 0, 0) : null;
      const active      = body.active      !== undefined ? Boolean(body.active)             : null;
      const note        = body.note        !== undefined ? String(body.note).trim()        : null;

      const rows = await sql`
        UPDATE filaments SET
          name          = COALESCE(${name},        name),
          material_type = COALESCE(${materialType}, material_type),
          color_hex     = COALESCE(${colorHex},    color_hex),
          price_per_kg  = COALESCE(${pricePerKg},  price_per_kg),
          active        = COALESCE(${active},       active),
          note          = COALESCE(${note},         note)
        WHERE id = ${id}
        RETURNING *
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.json(normalizeRow(rows[0]));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const sql = getSql();
      const result = await sql`DELETE FROM filaments WHERE id = ${id} RETURNING id`;
      if (result.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
