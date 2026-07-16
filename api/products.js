const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAuth, requireAdmin } = require('./_middleware');
const { calculateProductCost } = require('./_pricing');

function roundGrams(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function normalizedMaterials(value) {
  if (!Array.isArray(value)) return [];
  return value.map((material) => ({
    ...material,
    grams: roundGrams(material?.grams),
  }));
}

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
    purgeGrams:         Number(row.purge_grams) || 0,
    riskPercent:        row.risk_percent == null ? null : Number(row.risk_percent),
    riskLevel:          row.risk_level ?? 'medium',
    catalogKind:        row.catalog_kind ?? 'printed',
    additionalCopyHours: row.additional_copy_hours == null ? null : Number(row.additional_copy_hours),
    minUnitPrice:       row.minimum_unit_price == null ? null : Number(row.minimum_unit_price),
    possibleColors:     row.possible_colors ?? [],
    requiredColors:     row.required_colors ?? [],
    requiresAdminApproval: Boolean(row.requires_admin_approval),
    allowMultiple:      row.allow_multiple !== false,
    internalPrintNotes: row.internal_print_notes ?? '',
    printFileUrl:       row.print_file_url ?? '',
    printFileName:      row.print_file_name ?? '',
    printFileChecksum:  row.print_file_checksum ?? '',
    printFileUploadedAt: row.print_file_uploaded_at ?? null,
    printSync: row.print_sync_key ? {
      status: row.print_sync_status ?? '',
      filename: row.print_sync_filename ?? '',
      checksum: row.print_sync_checksum ?? '',
      materialGrams: row.print_sync_material_grams ?? [],
      warnings: row.print_sync_warnings ?? [],
      syncedAt: row.print_synced_at ?? null,
    } : null,
  };
}

// Friend shape — omits internal-only admin fields (pricing mechanics and
// internal print notes). Never returned to unauthenticated callers.
function missingRequirements(product) {
  const missing = [];
  const hasImage = Boolean(product.image || product.images?.length);
  const hasCategory = Boolean(product.category || product.categoryIds?.length);
  if (!product.name.trim()) missing.push('name');
  if (!product.description.trim()) missing.push('description');
  if (!hasImage) missing.push('image');
  if (!hasCategory) missing.push('category');
  if (product.catalogKind === 'printed') {
    if (!(product.printHours > 0)) missing.push('printHours');
    if (!product.materials.length || product.materials.some((item) => !item.filamentId || !(Number(item.grams) > 0))) missing.push('materials');
    if (!(product.cost > 0)) missing.push('price');
  }
  return missing;
}

function colorValue(value) {
  if (typeof value === 'string') return value;
  return String(value?.filamentId ?? value?.id ?? value?.value ?? '').trim();
}

function publicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    image: product.image,
    images: product.images,
    sourceUrl: product.sourceUrl,
    category: product.category,
    categoryIds: product.categoryIds,
    catalogKind: product.catalogKind,
    cost: product.cost,
    pricesByQuantity: product.pricesByQuantity,
    grams: product.grams,
    printHours: product.printHours,
    additionalCopyHours: product.additionalCopyHours,
    possibleColors: product.colorOptions.map((option) => option.name),
    requiredColors: product.requiredColorOptions.map((option) => option.name),
    colorOptions: product.colorOptions,
    requiredColorOptions: product.requiredColorOptions,
    requiresAdminApproval: product.requiresAdminApproval || product.catalogKind === 'idea',
    allowMultiple: product.allowMultiple,
    available: product.inventoryAvailable,
    inventoryAvailable: product.inventoryAvailable,
    availabilityReason: product.inventoryAvailable ? '' : 'לא זמין כרגע — ניתן לבקש חלופה',
    catalogStatus: 'published',
  };
}

async function pricingContext(sql) {
  const [filaments, settings] = await Promise.all([
    sql`SELECT id, name, material_type, color_hex, price_per_kg, spool_price, spool_grams, remaining_grams, active FROM filaments`,
    sql`SELECT value FROM settings WHERE key = 'pricing'`,
  ]);
  return {
    filaments: filaments.map((item) => ({
      id: item.id, name: item.name, materialType: item.material_type, colorHex: item.color_hex,
      pricePerKg: Number(item.price_per_kg),
      spoolPrice: item.spool_price == null ? null : Number(item.spool_price),
      spoolGrams: Number(item.spool_grams) || 1000,
      active: item.active !== false,
      remainingGrams: item.remaining_grams == null ? null : Number(item.remaining_grams),
    })),
    settings: settings[0]?.value || {},
  };
}

function withCurrentPrice(row, context) {
  const product = normalizeRow(row);
  const breakdown = calculateProductCost(product, context.filaments, context.settings);
  product.cost = product.manualPriceEnabled && product.manualPrice != null ? product.manualPrice : breakdown.shopPrice;
  product.pricesByQuantity = Object.fromEntries(Array.from({ length: 50 }, (_, index) => {
    const quantity = index + 1;
    const price = product.manualPriceEnabled && product.manualPrice != null
      ? product.manualPrice * quantity
      : calculateProductCost(product, context.filaments, context.settings, { quantity }).shopPrice;
    return [quantity, price];
  }));
  product.calculatedCost = breakdown.shopPrice;
  product.productionCost = breakdown.productionCost;
  const materials = product.materials || [];
  product.inventoryAvailable = product.printSync?.status !== 'needs_material' && (materials.length === 0 || materials.every((material) => {
    const filament = context.filaments.find((item) => item.id === material.filamentId);
    return Boolean(filament?.active) && (filament.remainingGrams == null || filament.remainingGrams >= Number(material.grams || 0));
  }));
  const filamentAvailable = (filament) => Boolean(filament?.active)
    && (filament.remainingGrams == null || filament.remainingGrams > 0);
  // Ordering requires picking a colour. A product with its own palette offers that
  // palette; one without can be printed in any colour currently on the shelf.
  product.colorOptions = product.possibleColors.length
    ? product.possibleColors.map((value) => {
      const id = colorValue(value);
      const filament = context.filaments.find((item) => item.id === id);
      return {
        value: id || colorValue(value),
        name: filament?.name || (typeof value === 'string' ? value : value?.name || id),
        colorHex: filament?.colorHex || (typeof value === 'object' ? value?.colorHex : null),
        available: filament ? filamentAvailable(filament) : true,
      };
    }).filter((item) => item.value)
    : context.filaments.filter(filamentAvailable).map((filament) => ({
      value: filament.id,
      name: filament.name,
      colorHex: filament.colorHex,
      available: true,
    }));
  product.requiredColorOptions = product.requiredColors.map((value) => {
    const id = colorValue(value);
    const filament = context.filaments.find((item) => item.id === id);
    return {
      value: id,
      name: filament?.name || (typeof value === 'string' ? value : value?.name || id),
      colorHex: filament?.colorHex || (typeof value === 'object' ? value?.colorHex : null),
      available: Boolean(filament?.active) && (filament?.remainingGrams == null || filament.remainingGrams > 0),
    };
  }).filter((item) => item.value);
  product.missingRequirements = missingRequirements(product);
  product.catalogStatus = product.missingRequirements.length ? 'incomplete' : product.inventoryAvailable ? 'published' : 'unavailable';
  return product;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const id = String(req.query.id ?? '').trim();
  const action = String(req.query.action ?? '').trim();

  // Local 3MF synchronizer. The file never reaches the server: it sends only
  // estimates and an opaque local sync key. Imported products stay inactive.
  if (!id && action === 'sync' && req.method === 'POST') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const body = await parseBody(req);
      const syncKey = String(body.syncKey ?? '').trim();
      const name = String(body.name ?? '').trim();
      const filename = String(body.filename ?? '').trim();
      const checksum = String(body.checksum ?? '').trim();
      const printHours = Math.max(Number(body.printHours) || 0, 0);
      const materialGrams = (Array.isArray(body.materialGrams) ? body.materialGrams : [])
        .map(roundGrams).filter((grams) => grams > 0);
      const warnings = Array.isArray(body.warnings) ? body.warnings.map(String).slice(0, 20) : [];
      const printProfile = ['regular', 'ams', 'complex'].includes(body.printProfile)
        ? body.printProfile : materialGrams.length > 1 ? 'ams' : 'regular';
      const purgeGrams = Math.max(roundGrams(body.purgeGrams), 0);
      if (!syncKey || syncKey.length > 200) return res.status(400).json({ error: 'Missing or invalid sync key' });
      if (!name || !filename || !printHours || !materialGrams.length) {
        return res.status(400).json({ error: 'Name, filename, print time, and material estimates are required' });
      }

      const sql = getSql();
      const existingRows = await sql`
        SELECT id, materials FROM products WHERE print_sync_key = ${syncKey} LIMIT 1
      `;
      const existing = existingRows[0];
      const totalGrams = Math.max(0.01, roundGrams(materialGrams.reduce((sum, grams) => sum + grams, 0)));
      const preservedMaterials = Array.isArray(existing?.materials) && existing.materials.length === materialGrams.length
        ? existing.materials.map((material, index) => ({ ...material, grams: materialGrams[index] }))
        : [];
      const syncStatus = preservedMaterials.length ? 'ready' : 'needs_material';
      const materials = JSON.stringify(preservedMaterials);
      const gramsJson = JSON.stringify(materialGrams);
      const warningsJson = JSON.stringify(warnings);
      let row;

      if (existing) {
        const rows = await sql`
          UPDATE products SET
            grams = ${totalGrams}, print_hours = ${printHours}, print_profile = ${printProfile}, purge_grams = ${purgeGrams},
            materials = ${materials}::jsonb,
            print_sync_filename = ${filename}, print_sync_checksum = ${checksum},
            print_sync_material_grams = ${gramsJson}::jsonb,
            print_sync_status = ${syncStatus}, print_sync_warnings = ${warningsJson}::jsonb,
            print_synced_at = NOW(), updated_at = NOW()
          WHERE id = ${existing.id}
          RETURNING *
        `;
        row = rows[0];
      } else {
        const productId = randomUUID();
        const rows = await sql`
          INSERT INTO products (
            id, name, cost, grams, description, image, active, print_hours, print_profile, purge_grams,
            materials, print_sync_key, print_sync_filename, print_sync_checksum,
            print_sync_material_grams, print_sync_status, print_sync_warnings, print_synced_at
          ) VALUES (
            ${productId}, ${name}, 0.01, ${totalGrams}, '', '', FALSE, ${printHours}, ${printProfile}, ${purgeGrams},
            ${materials}::jsonb, ${syncKey}, ${filename}, ${checksum},
            ${gramsJson}::jsonb, ${syncStatus}, ${warningsJson}::jsonb, NOW()
          ) RETURNING *
        `;
        row = rows[0];
      }

      const context = await pricingContext(sql);
      let product = withCurrentPrice(row, context);
      if (syncStatus === 'ready') {
        const saved = await sql`
          UPDATE products SET cost = ${product.cost}, calculated_cost = ${product.calculatedCost},
            production_cost = ${product.productionCost}, updated_at = NOW()
          WHERE id = ${row.id} RETURNING *
        `;
        product = withCurrentPrice(saved[0], context);
      }
      return res.status(existing ? 200 : 201).json(product);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── /api/products?id=:id — single-product operations ─────────
  if (id) {
    if (req.method === 'PUT') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      try {
        const body               = await parseBody(req);
        const sql                = getSql();
        const cost               = body.cost               !== undefined ? Math.max(Number(body.cost) || 0.01, 0.01)       : null;
        const grams              = body.grams              !== undefined ? Math.max(roundGrams(body.grams), 0.01)           : null;
        const printHours         = body.printHours         !== undefined ? Math.max(Number(body.printHours) || 0, 0)        : null;
        const calculatedCost     = body.calculatedCost     !== undefined ? Number(body.calculatedCost)                      : null;
        const manualPrice        = body.manualPrice        !== undefined ? Number(body.manualPrice)                         : null;
        const purgeGrams         = body.purgeGrams         !== undefined ? Math.max(roundGrams(body.purgeGrams), 0)         : null;
        const riskPercent        = body.riskPercent === '' ? null : body.riskPercent !== undefined ? Math.max(Number(body.riskPercent) || 0, 0) : undefined;
        const riskLevel          = body.riskLevel !== undefined ? String(body.riskLevel) : null;
        if (riskLevel !== null && !['low', 'medium', 'high'].includes(riskLevel)) return res.status(400).json({ error: 'Invalid risk level' });
        const catalogKind        = body.catalogKind !== undefined ? String(body.catalogKind) : null;
        if (catalogKind !== null && !['printed', 'idea'].includes(catalogKind)) return res.status(400).json({ error: 'Invalid catalog kind' });
        const additionalCopyHours = body.additionalCopyHours === '' ? null : body.additionalCopyHours !== undefined ? Math.max(Number(body.additionalCopyHours) || 0, 0) : undefined;
        const minUnitPrice       = body.minUnitPrice === '' ? null : body.minUnitPrice !== undefined ? Number(body.minUnitPrice) : undefined;
        if (minUnitPrice !== undefined && minUnitPrice !== null && (!Number.isFinite(minUnitPrice) || minUnitPrice < 0)) return res.status(400).json({ error: 'מחיר מינימום ליחידה חייב להיות לא־שלילי' });
        const active             = body.active             !== undefined ? Boolean(body.active)                             : null;
        const manualPriceEnabled = body.manualPriceEnabled !== undefined ? Boolean(body.manualPriceEnabled)                 : null;
        const images             = body.images             !== undefined ? JSON.stringify(body.images)                      : null;
        const materials          = body.materials          !== undefined ? JSON.stringify(normalizedMaterials(body.materials)) : null;
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
        const printFileUrl       = body.printFileUrl       !== undefined ? String(body.printFileUrl).trim()                  : null;
        const printFileName      = body.printFileName      !== undefined ? String(body.printFileName).trim()                 : null;
        const printFileChecksum  = body.printFileChecksum  !== undefined ? String(body.printFileChecksum).trim()              : null;
        const printFileUploadedAt = body.printFileUploadedAt !== undefined ? String(body.printFileUploadedAt).trim()          : null;
        const syncStatus         = body.materials !== undefined
          ? (Array.isArray(body.materials) && body.materials.length ? 'ready' : 'needs_material')
          : null;

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
            purge_grams         = COALESCE(${purgeGrams}, purge_grams),
            risk_percent        = CASE WHEN ${body.riskPercent !== undefined} THEN ${riskPercent} ELSE risk_percent END,
            risk_level          = COALESCE(${riskLevel}, risk_level),
            catalog_kind        = COALESCE(${catalogKind}, catalog_kind),
            additional_copy_hours = CASE WHEN ${body.additionalCopyHours !== undefined} THEN ${additionalCopyHours} ELSE additional_copy_hours END,
            minimum_unit_price  = CASE WHEN ${body.minUnitPrice !== undefined} THEN ${minUnitPrice} ELSE minimum_unit_price END,
            possible_colors     = COALESCE(${possibleColors}::jsonb, possible_colors),
            required_colors     = COALESCE(${requiredColors}::jsonb, required_colors),
            requires_admin_approval = COALESCE(${requiresApproval}, requires_admin_approval),
            allow_multiple      = COALESCE(${allowMultiple}, allow_multiple),
            internal_print_notes = COALESCE(${internalPrintNotes}, internal_print_notes),
            print_file_url      = COALESCE(${printFileUrl}, print_file_url),
            print_file_name     = COALESCE(${printFileName}, print_file_name),
            print_file_checksum = COALESCE(${printFileChecksum}, print_file_checksum),
            print_file_uploaded_at = COALESCE(${printFileUploadedAt}::timestamptz, print_file_uploaded_at),
            print_sync_status = CASE WHEN ${body.materials !== undefined} AND print_sync_key IS NOT NULL THEN ${syncStatus} ELSE print_sync_status END,
            updated_at          = NOW()
          WHERE id = ${id}
          RETURNING
            id, name, cost, grams, description, image, stl_url,
            source_url, category, category_ids, active, print_hours, print_profile,
            images, materials, calculated_cost, manual_price_enabled, manual_price,
            purge_grams, risk_percent, risk_level, catalog_kind, additional_copy_hours, minimum_unit_price,
            possible_colors, required_colors, requires_admin_approval,
            allow_multiple, internal_print_notes,
            print_file_url, print_file_name, print_file_checksum, print_file_uploaded_at,
            print_sync_key, print_sync_filename, print_sync_checksum,
            print_sync_material_grams, print_sync_status, print_sync_warnings, print_synced_at
        `;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const context = await pricingContext(sql);
        return res.json(withCurrentPrice(rows[0], context));
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
  // The catalog requires a valid session; admin sees drafts and internal fields.
  if (req.method === 'GET') {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;
      const isAdmin = user?.role === 'admin';
      const sql = getSql();
      const rows = isAdmin
        ? await sql`
            SELECT id, name, cost, grams, description, image, stl_url,
                   source_url, category, category_ids, active, print_hours, print_profile,
                   images, materials, calculated_cost, manual_price_enabled, manual_price,
                   purge_grams, risk_percent, risk_level, catalog_kind, additional_copy_hours, minimum_unit_price,
                   possible_colors, required_colors, requires_admin_approval,
                   allow_multiple, internal_print_notes,
                   print_file_url, print_file_name, print_file_checksum, print_file_uploaded_at,
                   print_sync_key, print_sync_filename, print_sync_checksum,
                   print_sync_material_grams, print_sync_status, print_sync_warnings, print_synced_at
            FROM products ORDER BY created_at ASC
          `
        : await sql`
            SELECT id, name, cost, grams, description, image, stl_url,
                   source_url, category, category_ids, active, print_hours, print_profile,
                   images, materials, calculated_cost, manual_price_enabled, manual_price,
                   purge_grams, risk_percent, risk_level, catalog_kind, additional_copy_hours, minimum_unit_price,
                   possible_colors, required_colors, requires_admin_approval,
                   allow_multiple, internal_print_notes,
                   print_file_url, print_file_name, print_file_checksum, print_file_uploaded_at,
                   print_sync_key, print_sync_filename, print_sync_checksum,
                   print_sync_material_grams, print_sync_status, print_sync_warnings, print_synced_at
            FROM products ORDER BY created_at ASC
          `;
      const context = await pricingContext(sql);
      const priced = rows.map((row) => withCurrentPrice(row, context));
      // Non-admins see only products the admin published: active and complete.
      // Inactive products are drafts (3MF imports land here) and must stay hidden.
      return res.json(isAdmin
        ? priced
        : priced.filter((row) => row.active && row.missingRequirements.length === 0).map(publicProduct));
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
      const grams              = Math.max(roundGrams(body.grams), 0.01);
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
      const materials          = JSON.stringify(normalizedMaterials(body.materials));
      const calculatedCost     = body.calculatedCost != null ? Number(body.calculatedCost) : null;
      const manualPriceEnabled = Boolean(body.manualPriceEnabled);
      const manualPrice        = body.manualPrice != null ? Number(body.manualPrice) : null;
      const purgeGrams         = Math.max(roundGrams(body.purgeGrams), 0);
      const riskPercent        = body.riskPercent === '' || body.riskPercent == null ? null : Math.max(Number(body.riskPercent) || 0, 0);
      const riskLevel          = String(body.riskLevel ?? 'medium');
      const catalogKind        = String(body.catalogKind ?? 'printed');
      if (!['low', 'medium', 'high'].includes(riskLevel)) return res.status(400).json({ error: 'Invalid risk level' });
      if (!['printed', 'idea'].includes(catalogKind)) return res.status(400).json({ error: 'Invalid catalog kind' });
      // NULL means pricing automatically uses the full print time per copy.
      const additionalCopyHours = null;
      const minUnitPrice       = body.minUnitPrice === '' || body.minUnitPrice == null ? null : Number(body.minUnitPrice);
      if (minUnitPrice !== null && (!Number.isFinite(minUnitPrice) || minUnitPrice < 0)) return res.status(400).json({ error: 'מחיר מינימום ליחידה חייב להיות לא־שלילי' });
      const possibleColors     = JSON.stringify(Array.isArray(body.possibleColors) ? body.possibleColors : []);
      const requiredColors     = JSON.stringify(Array.isArray(body.requiredColors) ? body.requiredColors : []);
      const requiresApproval   = Boolean(body.requiresAdminApproval);
      const allowMultiple      = body.allowMultiple !== false;
      const internalPrintNotes = String(body.internalPrintNotes ?? '').trim();
      const printFileUrl       = String(body.printFileUrl ?? '').trim();
      const printFileName      = String(body.printFileName ?? '').trim();
      const printFileChecksum  = String(body.printFileChecksum ?? '').trim();
      const printFileUploadedAt = body.printFileUploadedAt ? String(body.printFileUploadedAt).trim() : null;

      const rows = await sql`
        INSERT INTO products (
          id, name, cost, grams, description, image, stl_url,
          source_url, category, category_ids, active, print_hours, print_profile,
          images, materials, calculated_cost, manual_price_enabled, manual_price,
          purge_grams, risk_percent, risk_level, catalog_kind, additional_copy_hours, minimum_unit_price,
          possible_colors, required_colors, requires_admin_approval,
          allow_multiple, internal_print_notes,
          print_file_url, print_file_name, print_file_checksum, print_file_uploaded_at
        )
        VALUES (
          ${id}, ${name}, ${cost}, ${grams}, ${description}, ${image}, ${stlUrl},
          ${sourceUrl}, ${category}, ${categoryIds}, ${active}, ${printHours}, ${printProfile},
          ${images}, ${materials}, ${calculatedCost}, ${manualPriceEnabled}, ${manualPrice},
          ${purgeGrams}, ${riskPercent}, ${riskLevel}, ${catalogKind}, ${additionalCopyHours}, ${minUnitPrice},
          ${possibleColors}, ${requiredColors}, ${requiresApproval},
          ${allowMultiple}, ${internalPrintNotes},
          ${printFileUrl}, ${printFileName}, ${printFileChecksum}, ${printFileUploadedAt}::timestamptz
        ) RETURNING *
      `;
      const context = await pricingContext(sql);
      return res.status(201).json(withCurrentPrice(rows[0], context));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
