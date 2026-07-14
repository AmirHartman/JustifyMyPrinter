'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { requireAdmin } = require('./_middleware');

const ROOT = path.resolve(__dirname, '..');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).end();
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'סנכרון תיקייה מקומית זמין רק בפיתוח' });
  const user = await requireAdmin(req, res);
  if (!user) return;
  if (String(req.query.action || '') === 'open-folder') {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    return execFile(opener, [path.join(ROOT, 'print-files')], { timeout: 10000 }, (error) => {
      if (error) return res.status(500).json({ error: 'לא ניתן לפתוח את תיקיית קבצי ההדפסה במחשב זה' });
      return res.json({ ok: true });
    });
  }
  const sessionCookie = String(req.headers.cookie || '').split(';')
    .map((item) => item.trim()).find((item) => item.startsWith('session=')) || '';

  execFile(process.execPath, ['scripts/sync-print-estimates.js'], {
    cwd: ROOT,
    env: { ...process.env, JMP_SESSION_COOKIE: sessionCookie },
    timeout: 60000,
    maxBuffer: 64 * 1024,
  }, (error, stdout, stderr) => {
    const output = `${stdout || ''}${stderr || ''}`.trim();
    if (error) return res.status(400).json({ error: output || error.message });
    return res.json({ ok: true, output: output || 'לא נמצאו שינויים לסנכרון.' });
  });
};
