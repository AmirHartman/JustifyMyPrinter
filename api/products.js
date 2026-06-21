const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAuth, requireAdmin } = require('./_middleware');

function normalizeRow(row) {
  return {
    id: row.id,
    name: row.name,
    cost: Number(row.cost),
    grams: Number(row.grams),
    description: row.description ?? '',
    image: row.image ?? '',
    stlUrl: row.stl_url ?? '',
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return;
    try {
      const sql = getSql();
      const rows = await sql`
        SELECT id, name, cost, grams, description, image, stl_url FROM products ORDER BY created_at ASC
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
      const body = await parseBody(req);
      const sql = getSql();
      const id = randomUUID();
      const name = String(body.name ?? '').trim();
      const cost = Math.max(Number(body.cost) || 0.01, 0.01);
      const grams = Math.max(Number(body.grams) || 1, 1);
      const description = String(body.description ?? '').trim();
      const image = String(body.image ?? '').trim();
      const stlUrl = String(body.stlUrl ?? '').trim();

      await sql`
        INSERT INTO products (id, name, cost, grams, description, image, stl_url)
        VALUES (${id}, ${name}, ${cost}, ${grams}, ${description}, ${image}, ${stlUrl})
      `;
      return res.status(201).json({ id, name, cost, grams, description, image, stlUrl });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
