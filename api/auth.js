const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, parseCookies, getSession, normalizeUserStatus } = require('./_middleware');
const { hashPassword, verifyPassword } = require('./_password');

const SESSION_MAX_AGE = 7 * 24 * 3600;
const SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : '';

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
      const name     = String(body.name ?? '').trim();
      const password = String(body.password ?? '');
      try {
        const rows = await sql`
          SELECT id, name, full_name, role, status, password AS pwd, rejection_reason
          FROM users WHERE name = ${name}
        `;
        if (rows.length === 0) return res.status(401).json({ error: 'שם המשתמש לא מוכר. בדוק שהקלדת נכון.' });

        const user = rows[0];

        const status = normalizeUserStatus(user.status);
        if (status === 'rejected') return res.json({ status: 'rejected', reason: user.rejection_reason ?? '' });
        if (status === 'inactive') return res.status(403).json({ error: 'החשבון אינו פעיל. אנא צור קשר עם המנהל.' });

        const passwordCheck = await verifyPassword(password, user.pwd);
        if (!passwordCheck.valid) return res.status(401).json({ error: 'הסיסמה שגויה.' });
        if (passwordCheck.needsUpgrade) {
          const passwordHash = await hashPassword(password);
          await sql`UPDATE users SET password = ${passwordHash}, updated_at = NOW() WHERE id = ${user.id}`;
        }

        // Pending users get a real session too — they can browse the catalog
        // but api/orders.js requireActiveUser still blocks them from ordering.
        const token     = randomUUID();
        const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
        await sql`
          INSERT INTO sessions (token, user_id, user_name, user_role, expires_at)
          VALUES (${token}, ${user.id}, ${user.name}, ${user.role}, ${expiresAt})
        `;
        res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${SECURE}`);
        return res.json({ id: user.id, name: user.name, role: user.role, status });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (action === 'register') {
      const name            = String(body.name ?? '').trim();
      const fullName        = String(body.fullName ?? '').trim();
      const email           = String(body.email ?? '').trim().toLowerCase();
      const phone           = String(body.phone ?? '').trim();
      const howYouKnowAdmin = String(body.howYouKnowAdmin ?? '').trim();
      const registrationMessage = String(body.registrationMessage ?? body.messageToAdmin ?? '').trim();
      const password        = String(body.password ?? '');
      const confirmPassword = String(body.confirmPassword ?? '');

      if (name.length < 2)             return res.status(400).json({ error: 'שם משתמש צריך להיות לפחות שני תווים.' });
      if (fullName.length < 2)         return res.status(400).json({ error: 'נא להזין שם מלא.' });
      if (!email.includes('@'))        return res.status(400).json({ error: 'נא להזין כתובת אימייל תקינה.' });
      if (password.length < 4)         return res.status(400).json({ error: 'הסיסמה צריכה להיות לפחות 4 תווים.' });
      if (password !== confirmPassword) return res.status(400).json({ error: 'הסיסמאות לא תואמות.' });

      try {
        const existing = await sql`SELECT id, status FROM users WHERE name = ${name}`;
        if (existing.length > 0) {
          if (existing[0].status === 'pending')  return res.status(400).json({ error: 'הבקשה שלך כבר נמצאת אצלנו ומחכה לאישור.' });
          if (existing[0].status === 'rejected') return res.status(400).json({ error: 'שם המשתמש הזה נדחה בעבר. אנא צור קשר עם המנהל.' });
          return res.status(400).json({ error: 'שם המשתמש הזה תפוס. נסה שם אחר.' });
        }

        const userId = `friend-${randomUUID()}`;
        const passwordHash = await hashPassword(password);
        await sql`
          INSERT INTO users (
            id, name, full_name, email, phone, how_you_know_admin,
            registration_message, role, password, status
          )
          VALUES (
            ${userId}, ${name}, ${fullName}, ${email}, ${phone}, ${howYouKnowAdmin},
            ${registrationMessage}, 'friend', ${passwordHash}, 'pending'
          )
        `;

        return res.json({ pending: true, name, fullName });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (action === 'logout') {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.session) {
        try { await sql`DELETE FROM sessions WHERE token = ${cookies.session}`; } catch { /* ignore */ }
      }
      res.setHeader('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE}`);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  res.status(405).end();
};
