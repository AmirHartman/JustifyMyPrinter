const { getSql } = require('./_db');
const { parseBody, requireAdmin, USER_STATUSES, normalizeUserStatus } = require('./_middleware');
const { hashPassword } = require('./_password');

const VALID_ROLES    = ['admin', 'friend'];
const VALID_GENDERS  = ['male', 'female'];

function normalizeRow(r) {
  return {
    id:              r.id,
    name:            r.name,
    fullName:        r.full_name,
    gender:          r.gender,
    phone:           r.phone ?? '',
    howYouKnowAdmin: r.how_you_know_admin ?? '',
    registrationMessage: r.registration_message ?? '',
    role:            r.role,
    status:          normalizeUserStatus(r.status),
    rejectionReason: r.rejection_reason,
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const id = String(req.query.id ?? '').trim();

  // ── /api/users?id=:id — single-user operations ────────────────
  if (id) {
    if (req.method === 'PUT') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      try {
        const body   = await parseBody(req);
        const sql    = getSql();

        const updates = {};
        if (body.name     !== undefined) updates.name             = String(body.name).trim();
        if (body.fullName !== undefined) updates.full_name        = String(body.fullName).trim();
        if (body.phone    !== undefined) updates.phone            = String(body.phone).trim();
        if (body.gender   !== undefined && VALID_GENDERS.includes(body.gender)) updates.gender = body.gender;
        if (body.howYouKnowAdmin !== undefined) updates.how_you_know_admin = String(body.howYouKnowAdmin).trim();
        if (body.registrationMessage !== undefined) updates.registration_message = String(body.registrationMessage).trim();
        if (body.password !== undefined) updates.password         = await hashPassword(String(body.password));
        if (body.role     !== undefined && VALID_ROLES.includes(body.role))      updates.role   = body.role;
        if (body.status   !== undefined && USER_STATUSES.includes(body.status)) updates.status = body.status;
        if (body.status === 'rejected')  updates.rejection_reason = String(body.rejectionReason ?? '').trim() || null;
        if (body.status !== 'rejected' && body.status !== undefined) updates.rejection_reason = null;

        if (body.status !== undefined && !USER_STATUSES.includes(body.status)) {
          return res.status(400).json({ error: 'Invalid status' });
        }
        if (body.gender !== undefined && !VALID_GENDERS.includes(body.gender)) {
          return res.status(400).json({ error: 'Invalid gender' });
        }

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ error: 'No valid fields to update' });
        }

        const cols = Object.keys(updates);
        const vals = Object.values(updates);
        const setClause = cols.map((col, i) => `${col} = $${i + 1}`).join(', ');
        await sql.query(
          `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = $${vals.length + 1}`,
          [...vals, id]
        );

        const result = await sql.query(
          `SELECT id, name, full_name, phone, gender, how_you_know_admin, registration_message,
                  role, status, rejection_reason, created_at, updated_at
           FROM users WHERE id = $1`,
          [id]
        );
        const rows = result.rows ?? result;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.json(normalizeRow(rows[0]));
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === 'DELETE') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (admin.id === id) return res.status(400).json({ error: 'לא ניתן למחוק את המשתמש שלך.' });
      try {
        const sql = getSql();
        await sql`DELETE FROM sessions WHERE user_id = ${id}`;
        const result = await sql`DELETE FROM users WHERE id = ${id} RETURNING id`;
        if (result.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(405).end();
  }

  // ── /api/users — collection operations ───────────────────────
  if (req.method === 'GET') {
    const user = await requireAdmin(req, res);
    if (!user) return;
    try {
      const sql = getSql();
      const rows = await sql`
        SELECT id, name, full_name, phone, gender, how_you_know_admin, registration_message,
               role, status, rejection_reason, created_at, updated_at
        FROM users ORDER BY created_at DESC
      `;
      return res.json(rows.map(normalizeRow));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
