const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, getSession, requireAdmin } = require('./_middleware');

function normalizeRow(row) {
  return {
    id:          row.id,
    name:        row.name,
    description: row.description ?? '',
    active:      row.active !== false,
    sortOrder:   Number(row.sort_order) || 0,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const id = String(req.query.id ?? '').trim();

  // ── /api/categories?id=:id — single-category operations ───────
  if (id) {
    if (req.method === 'PUT') {
      const user = await requireAdmin(req, res);
      if (!user) return;
      try {
        const body        = await parseBody(req);
        const sql          = getSql();
        const name        = body.name        !== undefined ? String(body.name).trim()        : null;
        const description = body.description !== undefined ? String(body.description).trim() : null;
        const active      = body.active      !== undefined ? Boolean(body.active)             : null;
        const sortOrder   = body.sortOrder   !== undefined ? Number(body.sortOrder) || 0       : null;

        const rows = await sql`
          UPDATE categories SET
            name        = COALESCE(${name},        name),
            description = COALESCE(${description}, description),
            active      = COALESCE(${active},       active),
            sort_order  = COALESCE(${sortOrder},    sort_order)
          WHERE id = ${id}
          RETURNING id, name, description, active, sort_order
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
        const inUse = await sql`
          SELECT id FROM products WHERE category_ids @> ${JSON.stringify([id])}::jsonb LIMIT 1
        `;
        if (inUse.length > 0) {
          return res.status(409).json({ error: 'הקטגוריה משויכת למוצרים. יש להשבית אותה במקום למחוק.' });
        }
        const rows = await sql`DELETE FROM categories WHERE id = ${id} RETURNING id`;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(405).end();
  }

  // ── /api/categories — collection operations ────────────────────
  // Active categories are public (needed for the catalog filter); admin sees all.
  if (req.method === 'GET') {
    try {
      const user = await getSession(req);
      const sql = getSql();
      const rows = user?.role === 'admin'
        ? await sql`SELECT id, name, description, active, sort_order FROM categories ORDER BY sort_order ASC, name ASC`
        : await sql`SELECT id, name, description, active, sort_order FROM categories WHERE active = TRUE ORDER BY sort_order ASC, name ASC`;
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
      const sql          = getSql();
      const id          = randomUUID();
      const name        = String(body.name ?? '').trim();
      const description = String(body.description ?? '').trim();
      const active      = body.active !== false;
      const sortOrder   = Number(body.sortOrder) || 0;

      if (!name) return res.status(400).json({ error: 'Name required' });

      await sql`
        INSERT INTO categories (id, name, description, active, sort_order)
        VALUES (${id}, ${name}, ${description}, ${active}, ${sortOrder})
      `;
      return res.status(201).json(normalizeRow({ id, name, description, active, sort_order: sortOrder }));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
