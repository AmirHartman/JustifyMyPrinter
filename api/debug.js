const { neon } = require('@neondatabase/serverless');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const url = process.env.DATABASE_URL;
  const urlAlt = process.env.DB_JMP_DATABASE_URL;

  const info = {
    DATABASE_URL_set: Boolean(url),
    DATABASE_URL_prefix: url ? url.slice(0, 30) + '...' : null,
    DB_JMP_DATABASE_URL_set: Boolean(urlAlt),
    DB_JMP_DATABASE_URL_prefix: urlAlt ? urlAlt.slice(0, 30) + '...' : null,
  };

  try {
    const sql = neon(url || urlAlt);
    const rows = await sql`SELECT current_database() AS db, NOW() AS now`;
    return res.json({ ok: true, db: rows[0], env: info });
  } catch (err) {
    return res.json({ ok: false, error: err.message, env: info });
  }
};
