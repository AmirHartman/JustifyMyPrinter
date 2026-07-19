const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAdmin } = require('./_middleware');

// Filament names are derived, not entered: manufacturer + type + color, e.g. "eSun PLA Black".
function composeFilamentName(manufacturer, materialType, colorName) {
  return [manufacturer, materialType, colorName]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

function normalizeRow(row) {
  return {
    id:           row.id,
    name:         row.name,
    manufacturer: row.manufacturer ?? '',
    materialType: row.material_type,
    colorHex:     row.color_hex,
    colorName:    row.color_name ?? '',
    pricePerKg:   Number(row.price_per_kg),
    spoolPrice:   row.spool_price == null ? null : Number(row.spool_price),
    spoolGrams:   Number(row.spool_grams) || 1000,
    costPerGram:  row.spool_price == null ? 0 : Number(row.spool_price) / (Number(row.spool_grams) || 1000),
    remainingGrams: row.remaining_grams == null ? null : Number(row.remaining_grams),
    active:       Boolean(row.active),
    note:         row.note ?? '',
    createdAt:    row.created_at,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const id = String(req.query.id ?? '').trim();

  // ── /api/filaments?id=:id — single-filament operations ───────
  if (id) {
    if (req.method === 'PUT') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      try {
        const body        = await parseBody(req);
        const sql         = getSql();
        const currentRows = await sql`SELECT spool_price, spool_grams, manufacturer, material_type, color_name FROM filaments WHERE id = ${id}`;
        if (!currentRows.length) return res.status(404).json({ error: 'Not found' });
        const current     = currentRows[0];
        const manufacturer = body.manufacturer !== undefined ? String(body.manufacturer).trim() : null;
        const materialType = body.materialType !== undefined ? String(body.materialType).trim() : null;
        const colorName   = body.colorName   !== undefined ? String(body.colorName).trim()   : null;
        const colorHex    = body.colorHex    !== undefined ? String(body.colorHex).trim()    : null;
        if (manufacturer !== null && !manufacturer) return res.status(400).json({ error: 'שם יצרן נדרש' });
        if (colorName !== null && !colorName) return res.status(400).json({ error: 'שם צבע נדרש' });
        // Recompute the derived name whenever any of its inputs change.
        const name = (manufacturer !== null || materialType !== null || colorName !== null)
          ? composeFilamentName(
              manufacturer ?? current.manufacturer,
              materialType ?? current.material_type,
              colorName ?? current.color_name,
            )
          : null;
        const spoolPrice = body.spoolPrice !== undefined ? Number(body.spoolPrice) : null;
        const spoolGrams = body.spoolGrams !== undefined ? Math.round(Number(body.spoolGrams)) : null;
        if (spoolPrice !== null && (!Number.isFinite(spoolPrice) || spoolPrice <= 0)) return res.status(400).json({ error: 'מחיר גליל חייב להיות חיובי' });
        if (spoolGrams !== null && (!Number.isFinite(spoolGrams) || spoolGrams <= 0)) return res.status(400).json({ error: 'משקל גליל חייב להיות חיובי' });
        const effectivePrice = spoolPrice ?? Number(currentRows[0].spool_price);
        const effectiveGrams = spoolGrams ?? Number(currentRows[0].spool_grams);
        const pricePerKg = effectivePrice / effectiveGrams * 1000;
        const remainingGrams = body.newSpool ? effectiveGrams
          : body.remainingGrams !== undefined ? Math.max(Number(body.remainingGrams) || 0, 0) : null;
        const active      = body.active      !== undefined ? Boolean(body.active)             : null;
        const note        = body.note        !== undefined ? String(body.note).trim()        : null;

        const rows = await sql`
          UPDATE filaments SET
            name          = COALESCE(${name},        name),
            manufacturer  = COALESCE(${manufacturer}, manufacturer),
            material_type = COALESCE(${materialType}, material_type),
            color_hex     = COALESCE(${colorHex},    color_hex),
            color_name    = COALESCE(${colorName},   color_name),
            price_per_kg  = COALESCE(${pricePerKg},  price_per_kg),
            spool_price   = COALESCE(${spoolPrice}, spool_price),
            spool_grams   = COALESCE(${spoolGrams}, spool_grams),
            remaining_grams = COALESCE(${remainingGrams}, remaining_grams),
            active        = COALESCE(${active},       active),
            note          = COALESCE(${note},         note)
          WHERE id = ${id}
          RETURNING *
        `;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        if (body.newSpool && spoolPrice > 0) {
          await sql`INSERT INTO expenses (id, description, category, amount, expense_date, notes)
            VALUES (${randomUUID()}, ${`גליל חדש: ${rows[0].name}`}, 'filament', ${spoolPrice}, CURRENT_DATE, 'נוצר אוטומטית ממלאי הפילמנט')`;
        }
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

    return res.status(405).end();
  }

  // ── /api/filaments — collection operations ────────────────────
  if (req.method === 'GET') {
    const user = await requireAdmin(req, res);
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
      const manufacturer = String(body.manufacturer ?? '').trim();
      const materialType = String(body.materialType ?? 'PLA').trim();
      const colorName   = String(body.colorName ?? '').trim();
      const colorHex    = String(body.colorHex ?? '#000000').trim();
      const spoolPrice = Number(body.spoolPrice);
      const spoolGrams = Math.round(Number(body.spoolGrams));
      if (!manufacturer) return res.status(400).json({ error: 'שם יצרן נדרש' });
      if (!colorName) return res.status(400).json({ error: 'שם צבע נדרש' });
      if (!Number.isFinite(spoolPrice) || spoolPrice <= 0) return res.status(400).json({ error: 'מחיר גליל חייב להיות חיובי' });
      if (!Number.isFinite(spoolGrams) || spoolGrams <= 0) return res.status(400).json({ error: 'משקל גליל חייב להיות חיובי' });
      const pricePerKg = spoolPrice / spoolGrams * 1000;
      const note        = String(body.note ?? '').trim();
      const name        = composeFilamentName(manufacturer, materialType, colorName);

      await sql`
        INSERT INTO filaments (id, name, manufacturer, material_type, color_hex, color_name, price_per_kg, spool_price, spool_grams, remaining_grams, note)
        VALUES (${id}, ${name}, ${manufacturer}, ${materialType}, ${colorHex}, ${colorName}, ${pricePerKg}, ${spoolPrice}, ${spoolGrams}, ${spoolGrams}, ${note})
      `;
      return res.status(201).json(normalizeRow({ id, name, manufacturer, material_type: materialType, color_hex: colorHex, color_name: colorName, price_per_kg: pricePerKg, spool_price: spoolPrice, spool_grams: spoolGrams, remaining_grams: spoolGrams, active: true, note, created_at: new Date().toISOString() }));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
