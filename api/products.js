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
  const id = String(req.query.id ?? '').trim();

  // ── /api/products?id=:id — single-product operations ─────────
  if (id) {
    if (req.method === 'PUT') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      try {
        const body               = await parseBody(req);
        const sql                = getSql();
        const cost               = body.cost               !== undefined ? Math.max(Number(body.cost) || 0.01, 0.01)       : null;
        const grams              = body.grams              !== undefined ? Math.max(Number(body.grams) || 1, 1)             : null;
        const printHours         = body.printHours         !== undefined ? Math.max(Number(body.printHours) || 0, 0)        : null;
        const calculatedCost     = body.calculatedCost     !== undefined ? Number(body.calculatedCost)                      : null;
        const manualPrice        = body.manualPrice        !== undefined ? Number(body.manualPrice)                         : null;
        const active             = body.active             !== undefined ? Boolean(body.active)                             : null;
        const manualPriceEnabled = body.manualPriceEnabled !== undefined ? Boolean(body.manualPriceEnabled)                 : null;
        const images             = body.images             !== undefined ? JSON.stringify(body.images)                      : null;
        const materials          = body.materials          !== undefined ? JSON.stringify(body.materials)                   : null;
        const name               = body.name               !== undefined ? String(body.name).trim()                        : null;
        const description        = body.description        !== undefined ? String(body.description).trim()                 : null;
        const image              = body.image              !== undefined ? String(body.image).trim()                       : null;
        const stlUrl             = body.stlUrl             !== undefined ? String(body.stlUrl).trim()                      : null;
        const sourceUrl          = body.sourceUrl          !== undefined ? String(body.sourceUrl).trim()                   : null;
        const category           = body.category           !== undefined ? String(body.category).trim()                    : null;
        const printProfile       = body.printProfile       !== undefined ? String(body.printProfile).trim()                : null;

        const rows = await sql`
          UPDATE products SET
            name                = COALESCE(${name},               name),
            cost                = COALESCE(${cost},               cost),
            grams               = COALESCE(${grams},              grams),
            description         = COALESCE(${description},        description),
            image               = COALESCE(${image},              image),
            stl_url             = COALESCE(${stlUrl},             stl_url),
            source_url          = COALESCE(${sourceUrl},          source_url),
            category            = COALESCE(${category},           category),
            active              = COALESCE(${active},             active),
            print_hours         = COALESCE(${printHours},         print_hours),
            print_profile       = COALESCE(${printProfile},       print_profile),
            images              = COALESCE(${images}::jsonb,      images),
            materials           = COALESCE(${materials}::jsonb,   materials),
            calculated_cost     = COALESCE(${calculatedCost},     calculated_cost),
            manual_price_enabled = COALESCE(${manualPriceEnabled}, manual_price_enabled),
            manual_price        = COALESCE(${manualPrice},        manual_price)
          WHERE id = ${id}
          RETURNING
            id, name, cost, grams, description, image, stl_url,
            source_url, category, active, print_hours, print_profile,
            images, materials, calculated_cost, manual_price_enabled, manual_price
        `;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const r = rows[0];
        return res.json({
          id: r.id, name: r.name, cost: Number(r.cost), grams: Number(r.grams),
          description: r.description, image: r.image, stlUrl: r.stl_url,
          sourceUrl: r.source_url ?? '', category: r.category ?? '',
          active: r.active !== false,
          printHours: Number(r.print_hours) || 0, printProfile: r.print_profile ?? 'regular',
          images: r.images ?? [], materials: r.materials ?? [],
          calculatedCost: r.calculated_cost != null ? Number(r.calculated_cost) : null,
          manualPriceEnabled: Boolean(r.manual_price_enabled),
          manualPrice: r.manual_price != null ? Number(r.manual_price) : null,
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === 'DELETE') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      try {
        const sql = getSql();
        await sql`DELETE FROM products WHERE id = ${id}`;
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(405).end();
  }

  // ── /api/products — collection operations ─────────────────────
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
