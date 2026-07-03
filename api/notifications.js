const { requireAuth } = require('./_middleware');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const user = await requireAuth(req, res);
  if (!user) return;
  return res.status(410).json({
    error: 'Internal notifications were removed. Updates are sent manually via WhatsApp.',
    code: 'INTERNAL_NOTIFICATIONS_REMOVED',
  });
};
