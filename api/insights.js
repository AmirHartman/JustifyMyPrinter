const { getSql } = require('./_db');
const { requireAdmin } = require('./_middleware');
const { config, mergedSettings } = require('./_pricing');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const sql = getSql();
    const [orders, expenses, ledger, goals, events, settingsRows] = await Promise.all([
      sql`SELECT status, paid, internal, final_amount, support_amount, wear_component, machine_component, margin_component, production_cost, print_hours, print_profile, completed_at, created_at FROM orders`,
      sql`SELECT amount, category, expense_date FROM expenses`, sql`SELECT * FROM owner_ledger ORDER BY occurred_at`,
      sql`SELECT * FROM goals ORDER BY sort_order`, sql`SELECT * FROM maintenance_events ORDER BY performed_at DESC`,
      sql`SELECT value FROM settings WHERE key = 'pricing'`,
    ]);
    const pricing = mergedSettings(settingsRows[0]?.value || {});
    const completed = orders.filter((o) => o.status === 'completed');
    const totalHours = completed.reduce((s, o) => s + Number(o.print_hours || 0), 0);
    const maintenanceAccrued = completed.reduce((s, o) => s + Number(o.wear_component || 0), 0);
    const maintenanceSpent = expenses.filter((e) => e.category === 'parts_maintenance').reduce((s, e) => s + Number(e.amount), 0);
    const businessAccrued = orders.filter((o) => o.paid).reduce((s, o) => s + Number(o.machine_component || 0) + Number(o.margin_component || 0), 0);
    const allocated = goals.reduce((s, g) => s + Number(g.saved), 0);
    const withdrawals = ledger.filter((e) => e.kind === 'withdrawal').reduce((s, e) => s + Math.abs(Number(e.amount)), 0);
    const latest = new Map(); events.forEach((event) => { if (!latest.has(`${event.part_id}:${event.event_type}`)) latest.set(`${event.part_id}:${event.event_type}`, event); });
    const partsHealth = pricing.wearParts.map((part) => { const event = latest.get(`${part.id}:replace`); const used = Math.max(totalHours - Number(event?.hours_at_event || 0), 0); return { ...part, usedHours: used, percent: used / part.lifetimeHours * 100, warning: used / part.lifetimeHours >= 0.8 }; });
    const pnlRevenue = orders.filter((o) => o.paid && !o.internal).reduce((s, o) => s + Number(o.final_amount || 0), 0);
    const pnlExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const ownerBalance = ledger.reduce((s, e) => s + Number(e.amount), 0);
    let credits = ledger.filter((entry) => Number(entry.amount) < 0).reduce((sum, entry) => sum + Math.abs(Number(entry.amount)), 0);
    const investments = ledger.filter((entry) => entry.kind === 'investment').map((entry) => {
      const amount = Number(entry.amount); const repaid = Math.min(amount, credits); credits = Math.max(credits - repaid, 0);
      return { ...entry, repaid, percent: amount > 0 ? repaid / amount * 100 : 0 };
    });
    const monthlyMap = new Map();
    orders.filter((o) => o.paid && !o.internal).forEach((o) => { const month = String(o.created_at).slice(0, 7); monthlyMap.set(month, { month, revenue: (monthlyMap.get(month)?.revenue || 0) + Number(o.final_amount || 0), expenses: monthlyMap.get(month)?.expenses || 0 }); });
    expenses.forEach((e) => { const month = String(e.expense_date).slice(0, 7); monthlyMap.set(month, { month, revenue: monthlyMap.get(month)?.revenue || 0, expenses: (monthlyMap.get(month)?.expenses || 0) + Number(e.amount) }); });
    const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month)).map((item) => ({ ...item, profit: item.revenue - item.expenses }));
    const risk = Object.entries(config.printProfiles).map(([profile, profileConfig]) => { const relevant = orders.filter((o) => o.print_profile === profile && ['completed', 'failed'].includes(o.status)); const failed = relevant.filter((o) => o.status === 'failed').length; return { profile, label: profileConfig.label, samples: relevant.length, failed, actualPercent: relevant.length ? failed / relevant.length : null, configuredPercent: profileConfig.riskPercent, enoughData: relevant.length >= 10 }; });
    return res.json({
      maintenance: { accrued: maintenanceAccrued, spent: maintenanceSpent, balance: maintenanceAccrued - maintenanceSpent },
      partsHealth, maintenanceTasks: pricing.maintenanceTasks.map((task) => {
        const lastEvent = latest.get(`${task.id}:service`) || null;
        const hoursSince = totalHours - Number(lastEvent?.hours_at_event || 0);
        const daysSince = lastEvent?.performed_at ? (Date.now() - new Date(lastEvent.performed_at).getTime()) / 86400000 : null;
        const dueSoon = !lastEvent
          || (Number(task.everyHours) > 0 && hoursSince >= Number(task.everyHours) * 0.8)
          || (Number(task.everyDays) > 0 && daysSince != null && daysSince >= Number(task.everyDays) * 0.8);
        return { ...task, lastEvent, hoursSince, daysSince, dueSoon: Boolean(dueSoon) };
      }),
      business: { accrued: businessAccrued, allocated, withdrawals, available: businessAccrued - allocated - withdrawals },
      owner: { entries: ledger, investments, balance: ownerBalance }, goals,
      pnl: { revenue: pnlRevenue, expenses: pnlExpenses, profit: pnlRevenue - pnlExpenses, monthly, internalConsumption: orders.filter((o) => o.internal).reduce((s, o) => s + Number(o.production_cost || 0), 0) }, risk,
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
