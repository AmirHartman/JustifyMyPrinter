const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAuth } = require('./_middleware');

function normalize(r) {
  return {
    id:           r.id,
    userName:     r.user_name,
    sender:       r.sender,
    content:      r.content,
    readByAdmin:  Boolean(r.read_by_admin),
    readByUser:   Boolean(r.read_by_user),
    createdAt:    r.created_at,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const user = await requireAuth(req, res);
  if (!user) return;
  const sql = getSql();

  // ── GET ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      if (user.role === 'admin') {
        const targetUser = req.query.user || null;

        if (targetUser) {
          // Full thread for one user
          const rows = await sql`
            SELECT id, user_name, sender, content, read_by_admin, read_by_user, created_at
            FROM messages WHERE user_name = ${targetUser} ORDER BY created_at ASC
          `;
          await sql`
            UPDATE messages SET read_by_admin = TRUE
            WHERE user_name = ${targetUser} AND sender != 'admin' AND read_by_admin = FALSE
          `;
          return res.json(rows.map(normalize));
        }

        // Conversations list: latest message per user + unread count
        const convRows = await sql`
          SELECT DISTINCT ON (user_name) user_name, sender, content, created_at
          FROM messages ORDER BY user_name, created_at DESC
        `;
        const unreadRows = await sql`
          SELECT user_name, COUNT(*)::int AS cnt
          FROM messages
          WHERE sender != 'admin' AND read_by_admin = FALSE
          GROUP BY user_name
        `;
        const unreadMap = Object.fromEntries(unreadRows.map((r) => [r.user_name, r.cnt]));
        return res.json(
          convRows
            .map((r) => ({
              userName:      r.user_name,
              latestMessage: r.content,
              sender:        r.sender,
              createdAt:     r.created_at,
              unreadCount:   unreadMap[r.user_name] || 0,
            }))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        );
      }

      // Friend: own thread
      const rows = await sql`
        SELECT id, user_name, sender, content, read_by_admin, read_by_user, created_at
        FROM messages WHERE user_name = ${user.name} ORDER BY created_at ASC
      `;
      await sql`
        UPDATE messages SET read_by_user = TRUE
        WHERE user_name = ${user.name} AND sender = 'admin' AND read_by_user = FALSE
      `;
      return res.json(rows.map(normalize));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body    = await parseBody(req);
      const content = String(body.content ?? '').trim();
      if (!content) return res.status(400).json({ error: 'Content required' });

      const userName = user.role === 'admin'
        ? String(body.userName ?? '').trim()
        : user.name;
      if (!userName) return res.status(400).json({ error: 'User name required' });

      const sender    = user.role === 'admin' ? 'admin' : user.name;
      const id        = randomUUID();
      const createdAt = new Date().toISOString();

      await sql`
        INSERT INTO messages (id, user_name, sender, content, created_at)
        VALUES (${id}, ${userName}, ${sender}, ${content}, ${createdAt})
      `;

      if (user.role === 'admin') {
        await sql`
          INSERT INTO notifications (id, user_name, message, created_at)
          VALUES (${randomUUID()}, ${userName}, ${'יש תגובה חדשה ממני עליך 💬'}, NOW())
        `;
      }

      return res.status(201).json({ id, userName, sender, content, readByAdmin: false, readByUser: false, createdAt });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
