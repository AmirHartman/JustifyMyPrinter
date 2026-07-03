const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAdmin } = require('./_middleware');

const EXPENSE_CATEGORIES = ['filament', 'parts_maintenance', 'accessories', 'paid_models', 'electricity', 'general'];

function normalizeCategory(value) {
  const category = String(value ?? '').trim();
  return EXPENSE_CATEGORIES.includes(category) ? category : 'general';
}

function normalizeRow(row) {
  return {
    id:          row.id,
    description: row.description,
    category:    row.category,
    amount:      Number(row.amount) || 0,
    expenseDate: row.expense_date,
    notes:       row.notes ?? '',
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

// Admin-only: expenses are internal finance data, never exposed to friends/public.
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id  = String(req.query.id ?? '').trim();
  const sql = getSql();

  if (id) {
    if (req.method === 'PUT') {
      try {
        const body        = await parseBody(req);
        const description = body.description !== undefined ? String(body.description).trim() : null;
        const category    = body.category    !== undefined ? normalizeCategory(body.category) : null;
        const amount      = body.amount      !== undefined ? Number(body.amount) || 0          : null;
        const expenseDate = body.expenseDate !== undefined ? String(body.expenseDate)          : null;
        const notes       = body.notes       !== undefined ? String(body.notes).trim()         : null;

        const rows = await sql`
          UPDATE expenses SET
            description  = COALESCE(${description}, description),
            category     = COALESCE(${category},    category),
            amount       = COALESCE(${amount},       amount),
            expense_date = COALESCE(${expenseDate},  expense_date),
            notes        = COALESCE(${notes},        notes),
            updated_at   = NOW()
          WHERE id = ${id}
          RETURNING id, description, category, amount, expense_date, notes, created_at, updated_at
        `;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.json(normalizeRow(rows[0]));
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (req.method === 'DELETE') {
      try {
        const rows = await sql`DELETE FROM expenses WHERE id = ${id} RETURNING id`;
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(405).end();
  }

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT id, description, category, amount, expense_date, notes, created_at, updated_at
        FROM expenses ORDER BY expense_date DESC, created_at DESC
      `;
      return res.json(rows.map(normalizeRow));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body        = await parseBody(req);
      const description = String(body.description ?? '').trim();
      if (!description) return res.status(400).json({ error: 'Description required' });
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Amount must be greater than 0' });
      }
      const category    = normalizeCategory(body.category);
      const expenseDate = body.expenseDate ? String(body.expenseDate) : new Date().toISOString().slice(0, 10);
      const notes       = String(body.notes ?? '').trim();
      const id          = randomUUID();

      const rows = await sql`
        INSERT INTO expenses (id, description, category, amount, expense_date, notes)
        VALUES (${id}, ${description}, ${category}, ${amount}, ${expenseDate}, ${notes})
        RETURNING id, description, category, amount, expense_date, notes, created_at, updated_at
      `;
      return res.status(201).json(normalizeRow(rows[0]));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).end();
};
