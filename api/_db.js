const { neon } = require('@neondatabase/serverless');

let _sql = null;
function getSql() {
  if (!_sql) {
    const url = process.env.DB_JMP_DATABASE_URL || process.env.DATABASE_URL;
    if (!url || url.length < 20) throw new Error('DATABASE_URL is not configured correctly');
    _sql = neon(url);
  }
  return _sql;
}

module.exports = { getSql };
