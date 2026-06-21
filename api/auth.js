const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, parseCookies, getSession } = require('./_middleware');

const SESSION_MAX_AGE = 7 * 24 * 3600;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    try {
      const user = await getSession(req);
      if (!user) return res.status(401).json(null);
      return res.json(user);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    let body;
    try { body = await parseBody(req); } catch { return res.status(400).json({ error: 'Invalid request body' }); }

    const sql = getSql();
    const { action } = body;

    if (action === 'login') {
      const name = String(body.name ?? '').trim();
      const password = String(body.password ?? '');
      try {
        const rows = await sql`
          SELECT id, name, role, status FROM users WHERE name = ${name} AND password = ${password}
        `;
        if (rows.length === 0) return res.status(401).json({ error: 'שם המשתמש או הסיסמה לא נכונים.' });
        const user = rows[0];
        if (user.status === 'pending') return res.status(403).json({ error: 'הבקשה שלך עדיין ממתינה לאישור מנהל. נסה שוב אחרי שתקבל אישור.' });
        if (user.status === 'rejected') return res.status(403).json({ error: 'הבקשה שלך לא אושרה. צור קשר עם מנהל האתר.' });
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
        await sql`
          INSERT INTO sessions (token, user_id, user_name, user_role, expires_at)
          VALUES (${token}, ${user.id}, ${user.name}, ${user.role}, ${expiresAt})
        `;
        res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`);
        return res.json({ id: user.id, name: user.name, role: user.role });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (action === 'register') {
      const name = String(body.name ?? '').trim();
      const password = String(body.password ?? '');
      const confirmPassword = String(body.confirmPassword ?? '');

      if (name.length < 2) return res.status(400).json({ error: 'שם צריך להיות לפחות שני תווים, בכל זאת אנחנו לא מדפיסים משתמש בלי שם.' });
      if (password.length < 4) return res.status(400).json({ error: 'הסיסמה צריכה להיות לפחות 4 תווים.' });
      if (password !== confirmPassword) return res.status(400).json({ error: 'הסיסמאות לא תואמות.' });

      try {
        const existing = await sql`SELECT id, status FROM users WHERE name = ${name}`;
        if (existing.length > 0) {
          if (existing[0].status === 'pending') return res.status(400).json({ error: 'הבקשה שלך כבר נמצאת אצלנו ומחכה לאישור. ניצור איתך קשר בקרוב.' });
          return res.status(400).json({ error: 'כבר יש משתמש בשם הזה. נסה שם קצת יותר ספציפי.' });
        }

        const userId = `friend-${randomUUID()}`;
        await sql`INSERT INTO users (id, name, role, password, status) VALUES (${userId}, ${name}, 'friend', ${password}, 'pending')`;

        return res.json({ pending: true, name });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (action === 'logout') {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.session) {
        try { await sql`DELETE FROM sessions WHERE token = ${cookies.session}`; } catch { /* ignore */ }
      }
      res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  res.status(405).end();
};
