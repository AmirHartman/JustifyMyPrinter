const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAuth, requireAdmin } = require('./_middleware');

function normalizeRow(row) {
  return {
    id:                 row.id,
    name:               row.name,
    cost:               Number(row.cost),
    grams:              Number(row.grams),
    description:        row.description ?? '',
    image:              row.image ?? '',
    stlUrl:             row.stl_url ?? '',
    sourceUrl:          row.source_url ?? '',
    category:           row.category ?? '',
    active:             row.active !== false,
    printHours:         Number(row.print_hours) || 0,
    printProfile:       row.print_profile ?? 'regular',
    images:             row.images ?? [],
    materials:          row.materials ?? [],
    calculatedCost:     row.calculated_cost != null ? Number(row.calculated_cost) : null,
    manualPriceEnabled: Boolean(row.manual_price_enabled),
    manualPrice:        row.manual_price != null ? Number(row.manual_price) : null,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return;
    try {
      const sql = getSql();
      const rows = user.role === 'admin'
        ? await sql`
            SELECT id, name, cost, grams, description, image, stl_url,
                   source_url, category, active, print_hours, print_profile,
                   images, materials, calculated_cost, manual_price_enabled, manual_price
            FROM products ORDER BY created_at ASC
          `
        : await sql`
            SELECT id, name, cost, grams, description, image, stl_url,
                   source_url, category, active, print_hours, print_profile,
                   images, materials, calculated_cost, manual_price_enabled, manual_price
            FROM products WHERE active = TRUE ORDER BY created_at ASC
          `;
      return res.json(rows.map(normalizeRow));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const body               = await parseBody(req);
      const sql                = getSql();
      const id                 = randomUUID();
      const name               = String(body.name ?? '').trim();
      const cost               = Math.max(Number(body.cost) || 0.01, 0.01);
      const grams              = Math.max(Number(body.grams) || 1, 1);
      const description        = String(body.description ?? '').trim();
      const image              = String(body.image ?? '').trim();
      const stlUrl             = String(body.stlUrl ?? '').trim();
      const sourceUrl          = String(body.sourceUrl ?? '').trim();
      const category           = String(body.category ?? '').trim();
      const active             = body.active !== false;
      const printHours         = Math.max(Number(body.printHours) || 0, 0);
      const printProfile       = String(body.printProfile ?? 'regular').trim();
      const images             = JSON.stringify(Array.isArray(body.images) ? body.images : []);
      const materials          = JSON.stringify(Array.isArray(body.materials) ? body.materials : []);
      const calculatedCost     = body.calculatedCost != null ? Number(body.calculatedCost) : null;
      const manualPriceEnabled = Boolean(body.manualPriceEnabled);
      const manualPrice        = body.manualPrice != null ? Number(body.manualPrice) : null;

      await sql`
        INSERT INTO products (
          id, name, cost, grams, description, image, stl_url,
          source_url, category, active, print_hours, print_profile,
          images, materials, calculated_cost, manual_price_enabled, manual_price
        )
        VALUES (
          ${id}, ${name}, ${cost}, ${grams}, ${description}, ${image}, ${stlUrl},
          ${sourceUrl}, ${category}, ${active}, ${printHours}, ${printProfile},
          ${images}, ${materials}, ${calculatedCost}, ${manualPriceEnabled}, ${manualPrice}
        )
      `;
      return res.status(201).json(normalizeRow({
        id, name, cost, grams, description, image, stl_url: stlUrl,
        source_url: sourceUrl, category, active, print_hours: printHours,
        print_profile: printProfile, images: body.images ?? [], materials: body.materials ?? [],
        calculated_cost: calculatedCost, manual_price_enabled: manualPriceEnabled, manual_price: manualPrice,
      }));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
