const { getSql } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const sql = getSql();
    const [summaryRows, goals, investments] = await Promise.all([
      sql`SELECT
        COALESCE((SELECT SUM(support_amount) FROM orders WHERE paid = TRUE), 0) AS total_support,
        COALESCE((SELECT SUM(ABS(amount)) FROM owner_ledger WHERE public_visible = TRUE AND amount < 0), 0) AS reinvested,
        COALESCE((SELECT COUNT(*) FROM orders WHERE status IN ('completed', 'delivered') AND internal = FALSE), 0) AS completed_prints`,
      sql`SELECT COALESCE(NULLIF(public_label, ''), name) AS label, target_amount, saved, achieved_at
          FROM goals WHERE public_visible = TRUE ORDER BY sort_order, created_at`,
      sql`SELECT COALESCE(NULLIF(public_label, ''), description) AS label, ABS(amount) AS amount, occurred_at
          FROM owner_ledger WHERE public_visible = TRUE ORDER BY occurred_at DESC, created_at DESC`,
    ]);
    const summary = summaryRows[0] || {};
    return res.json({
      totalSupport: Number(summary.total_support) || 0,
      reinvestedAmount: Number(summary.reinvested) || 0,
      completedPrints: Number(summary.completed_prints) || 0,
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
