const { getSql } = require('../_db');
const { parseBody, requireAdmin } = require('../_middleware');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id } = req.query;

  if (req.method === 'PUT') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const body = await parseBody(req);
      const sql = getSql();
      const cost = body.cost !== undefined ? Math.max(Number(body.cost) || 0.01, 0.01) : null;
      const grams = body.grams !== undefined ? Math.max(Number(body.grams) || 1, 1) : null;

      const rows = await sql`
        UPDATE products SET
          name        = COALESCE(${body.name !== undefined ? String(body.name).trim() : null}, name),
          cost        = COALESCE(${cost}, cost),
          grams       = COALESCE(${grams}, grams),
          description = COALESCE(${body.description !== undefined ? String(body.description).trim() : null}, description),
          image       = COALESCE(${body.image !== undefined ? String(body.image).trim() : null}, image),
          stl_url     = COALESCE(${body.stlUrl !== undefined ? String(body.stlUrl).trim() : null}, stl_url)
        WHERE id = ${id}
        RETURNING id, name, cost, grams, description, image, stl_url
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const r = rows[0];
      return res.json({ id: r.id, name: r.name, cost: Number(r.cost), grams: Number(r.grams), description: r.description, image: r.image, stlUrl: r.stl_url });
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

  res.status(405).end();
};
