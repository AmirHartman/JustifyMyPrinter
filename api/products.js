const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, getSession, requireAdmin } = require('./_middleware');

// Full shape — admin only. Includes internal pricing mechanics and print notes.
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
    categoryIds:        row.category_ids ?? [],
    active:             row.active !== false,
    printHours:         Number(row.print_hours) || 0,
    printProfile:       row.print_profile ?? 'regular',
    images:             row.images ?? [],
    materials:          row.materials ?? [],
    calculatedCost:     row.calculated_cost != null ? Number(row.calculated_cost) : null,
    manualPriceEnabled: Boolean(row.manual_price_enabled),
    manualPrice:        row.manual_price != null ? Number(row.manual_price) : null,
    possibleColors:     row.possible_colors ?? [],
    requiredColors:     row.required_colors ?? [],
    requiresAdminApproval: Boolean(row.requires_admin_approval),
    allowMultiple:      row.allow_multiple !== false,
    internalPrintNotes: row.internal_print_notes ?? '',
  };
}

// Public/friend shape — omits internal-only admin fields (pricing mechanics,
// internal print notes). Never returned to unauthenticated/non-admin callers.
function normalizePublicRow(row) {
  const {
    calculatedCost, manualPriceEnabled, manualPrice, internalPrintNotes,
    ...publicFields
  } = normalizeRow(row);
  return publicFields;
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
        const categoryIds        = body.categoryIds        !== undefined ? JSON.stringify(Array.isArray(body.categoryIds) ? body.categoryIds : []) : null;
        const printProfile       = body.printProfile       !== undefined ? String(body.printProfile).trim()                : null;
        const possibleColors     = body.possibleColors     !== undefined ? JSON.stringify(body.possibleColors)              : null;
        const requiredColors     = body.requiredColors     !== undefined ? JSON.stringify(body.requiredColors)              : null;
        const requiresApproval   = body.requiresAdminApproval !== undefined ? Boolean(body.requiresAdminApproval)           : null;
        const allowMultiple      = body.allowMultiple      !== undefined ? Boolean(body.allowMultiple)                       : null;
        const internalPrintNotes = body.internalPrintNotes !== undefined ? String(body.internalPrintNotes).trim()            : null;

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
            category_ids        = COALESCE(${categoryIds}::jsonb, category_ids),
            active              = COALESCE(${active},             active),
            print_hours         = COALESCE(${printHours},         print_hours),
            print_profile       = COALESCE(${printProfile},       print_profile),
            images              = COALESCE(${images}::jsonb,      images),
            materials           = COALESCE(${materials}::jsonb,   materials),
            calculated_cost     = COALESCE(${calculatedCost},     calculated_cost),
            manual_price_enabled = COALESCE(${manualPriceEnabled}, manual_price_enabled),
            manual_price        = COALESCE(${manualPrice},        manual_price),
            possible_colors     = COALESCE(${possibleColors}::jsonb, possible_colors),
            required_colors     = COALESCE(${requiredColors}::jsonb, required_colors),
            requires_admin_approval = COALESCE(${requiresApproval}, requires_admin_approval),
            allow_multiple      = COALESCE(${allowMultiple}, allow_multiple),
            internal_print_notes = COALESCE(${internalPrintNotes}, internal_print_notes),
            updated_at          = NOW()
          WHERE id = ${id}
          RETURNING
            id, name, cost, grams, description, image, stl_url,
            source_url, category, category_ids, active, print_hours, print_profile,
            images, materials, calculated_cost, manual_price_enabled, manual_price,
            possible_colors, required_colors, requires_admin_approval,
            allow_multiple, internal_print_notes
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
        await sql`DELETE FROM products WHERE id = ${id}`;
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(405).end();
  }

  // ── /api/products — collection operations ─────────────────────
  // Active products are public (no login required); admin sees all.
  if (req.method === 'GET') {
    try {
      const user = await getSession(req);
      const isAdmin = user?.role === 'admin';
      const sql = getSql();
      const rows = isAdmin
        ? await sql`
            SELECT id, name, cost, grams, description, image, stl_url,
                   source_url, category, category_ids, active, print_hours, print_profile,
                   images, materials, calculated_cost, manual_price_enabled, manual_price,
                   possible_colors, required_colors, requires_admin_approval,
                   allow_multiple, internal_print_notes
            FROM products ORDER BY created_at ASC
          `
        : await sql`
            SELECT id, name, cost, grams, description, image, stl_url,
                   source_url, category, category_ids, active, print_hours, print_profile,
                   images, materials, calculated_cost, manual_price_enabled, manual_price,
                   possible_colors, required_colors, requires_admin_approval,
                   allow_multiple, internal_print_notes
            FROM products WHERE active = TRUE ORDER BY created_at ASC
          `;
      return res.json(rows.map(isAdmin ? normalizeRow : normalizePublicRow));
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
      const categoryIds        = JSON.stringify(Array.isArray(body.categoryIds) ? body.categoryIds : []);
      const active             = body.active !== false;
      const printHours         = Math.max(Number(body.printHours) || 0, 0);
      const printProfile       = String(body.printProfile ?? 'regular').trim();
      const images             = JSON.stringify(Array.isArray(body.images) ? body.images : []);
      const materials          = JSON.stringify(Array.isArray(body.materials) ? body.materials : []);
      const calculatedCost     = body.calculatedCost != null ? Number(body.calculatedCost) : null;
      const manualPriceEnabled = Boolean(body.manualPriceEnabled);
      const manualPrice        = body.manualPrice != null ? Number(body.manualPrice) : null;
      const possibleColors     = JSON.stringify(Array.isArray(body.possibleColors) ? body.possibleColors : []);
      const requiredColors     = JSON.stringify(Array.isArray(body.requiredColors) ? body.requiredColors : []);
      const requiresApproval   = Boolean(body.requiresAdminApproval);
      const allowMultiple      = body.allowMultiple !== false;
      const internalPrintNotes = String(body.internalPrintNotes ?? '').trim();

      await sql`
        INSERT INTO products (
          id, name, cost, grams, description, image, stl_url,
          source_url, category, category_ids, active, print_hours, print_profile,
          images, materials, calculated_cost, manual_price_enabled, manual_price,
          possible_colors, required_colors, requires_admin_approval,
          allow_multiple, internal_print_notes
        )
        VALUES (
          ${id}, ${name}, ${cost}, ${grams}, ${description}, ${image}, ${stlUrl},
          ${sourceUrl}, ${category}, ${categoryIds}, ${active}, ${printHours}, ${printProfile},
          ${images}, ${materials}, ${calculatedCost}, ${manualPriceEnabled}, ${manualPrice},
          ${possibleColors}, ${requiredColors}, ${requiresApproval},
          ${allowMultiple}, ${internalPrintNotes}
        )
      `;
      return res.status(201).json(normalizeRow({
        id, name, cost, grams, description, image, stl_url: stlUrl,
        source_url: sourceUrl, category, category_ids: body.categoryIds ?? [], active, print_hours: printHours,
        print_profile: printProfile, images: body.images ?? [], materials: body.materials ?? [],
        calculated_cost: calculatedCost, manual_price_enabled: manualPriceEnabled, manual_price: manualPrice,
        possible_colors: body.possibleColors ?? [], required_colors: body.requiredColors ?? [],
        requires_admin_approval: requiresApproval, allow_multiple: allowMultiple,
        internal_print_notes: internalPrintNotes,
      }));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
