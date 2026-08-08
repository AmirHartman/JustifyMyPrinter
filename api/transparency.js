const { getSql } = require('./_db');

const FILAMENT_LOW_RATIO = 0.1;
const PROJECT_STATUSES = new Set(['active', 'busy', 'paused', 'maintenance']);

function materialAvailability(row) {
  if (row.active === false) return 'unavailable';
  const remaining = row.remaining_grams == null ? null : Number(row.remaining_grams);
  if (remaining != null && remaining <= 0) return 'unavailable';
  const spool = Number(row.spool_grams) || 1000;
  if (remaining != null && remaining <= spool * FILAMENT_LOW_RATIO) return 'limited';
  return 'available';
}

function publicProject(value = {}) {
  const status = PROJECT_STATUSES.has(value.status) ? value.status : 'active';
  const updates = Array.isArray(value.updates)
    ? value.updates.slice(0, 12).map((item) => ({
        id: String(item?.id ?? '').slice(0, 80),
        title: String(item?.title ?? '').trim().slice(0, 100),
        body: String(item?.body ?? '').trim().slice(0, 500),
        publishedAt: String(item?.publishedAt ?? '').slice(0, 10),
      })).filter((item) => item.title)
    : [];
  return {
    status,
    statusMessage: String(value.statusMessage ?? '').trim().slice(0, 300),
    leadTime: String(value.leadTime ?? '').trim().slice(0, 100),
    updatedAt: value.updatedAt ? String(value.updatedAt).slice(0, 40) : null,
    updates,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const sql = getSql();
    const [summaryRows, goals, investments, filaments, projectRows] = await Promise.all([
      sql`SELECT
        COALESCE((
          SELECT SUM(final_amount - CEIL(production_cost))
          FROM orders
          WHERE paid = TRUE
            AND internal = FALSE
            AND production_cost IS NOT NULL
            AND final_amount IS NOT NULL
        ), 0) AS total_profit,
        COALESCE((SELECT SUM(ABS(amount)) FROM owner_ledger WHERE public_visible = TRUE AND amount < 0), 0) AS reinvested,
        COALESCE((SELECT COUNT(*) FROM orders WHERE status IN ('completed', 'delivered') AND internal = FALSE), 0) AS completed_prints,
        COALESCE((SELECT COUNT(*) FROM orders
          WHERE status IN ('completed', 'delivered') AND internal = FALSE
            AND completed_at >= DATE_TRUNC('month', CURRENT_DATE)), 0) AS completed_this_month`,
      sql`SELECT COALESCE(NULLIF(public_label, ''), name) AS label, target_amount, saved, achieved_at
          FROM goals WHERE public_visible = TRUE ORDER BY sort_order, created_at`,
      sql`SELECT COALESCE(NULLIF(public_label, ''), description) AS label, ABS(amount) AS amount, occurred_at
          FROM owner_ledger WHERE public_visible = TRUE ORDER BY occurred_at DESC, created_at DESC`,
      sql`SELECT name, material_type, color_hex, color_name, spool_grams, remaining_grams, active
          FROM filaments ORDER BY material_type, color_name, created_at`,
      sql`SELECT value FROM settings WHERE key = 'project'`,
    ]);
    const summary = summaryRows[0] || {};
    const materials = filaments.map((item) => ({
      materialType: String(item.material_type || 'PLA').trim(),
      colorName: String(item.color_name || item.name || 'צבע ללא שם').trim(),
      colorHex: String(item.color_hex || '#8b8b8b').trim(),
      availability: materialAvailability(item),
    }));
    return res.json({
      totalProfit: Number(summary.total_profit) || 0,
      reinvestedAmount: Number(summary.reinvested) || 0,
      completedPrints: Number(summary.completed_prints) || 0,
      completedThisMonth: Number(summary.completed_this_month) || 0,
      availableMaterialCount: materials.filter((item) => item.availability !== 'unavailable').length,
      materials,
      project: publicProject(projectRows[0]?.value),
      goals: goals.map((goal) => ({
        label: goal.label,
        targetAmount: Number(goal.target_amount),
        savedAmount: Number(goal.saved),
        saved: Number(goal.saved),
        currentAmount: Number(goal.saved),
        progressPercent: Number(goal.target_amount) > 0 ? Math.min(100, Number(goal.saved) / Number(goal.target_amount) * 100) : 0,
        achievedAt: goal.achieved_at,
      })),
      investments: investments.map((item) => ({ label: item.label, amount: Number(item.amount), occurredAt: item.occurred_at })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
