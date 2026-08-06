'use strict';

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, shell, session } = require('electron');
const crypto = require('node:crypto'); const path = require('node:path'); const { spawn } = require('node:child_process');
const { apiRequest, importFile, ManagementError } = require('./management-client'); const configStore = require('./config-store');

let win; let tray; let daemon; let capability; let config; let quitting = false; let latestStatus = { state: 'starting' };
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const SAFE_ERRORS = Object.freeze({
  cancelled: 'הפעולה בוטלה.', secure_storage_unavailable: 'הצפנת Windows אינה זמינה; ההגדרה נחסמה.',
  invalid_setup: 'יש לבדוק את פרטי ההגדרה המקומית.', invalid_diagnostic: 'בקשת האבחון אינה תקינה.',
  daemon_not_ready: 'הגשר המקומי עדיין אינו מוכן.', unreachable: 'לא ניתן להתחבר לגשר המקומי.',
  timeout: 'הגשר לא הגיב בזמן.', import_timeout: 'ייבוא הקובץ ארך זמן רב מדי.',
  printing_active: 'אי אפשר לצאת בזמן הדפסה פעילה.',
});
function publicError(error) {
  const code = error?.status === 409 ? 'printing_active' : (SAFE_ERRORS[error?.code] ? error.code : 'desktop_error');
  return { ok: false, code, message: SAFE_ERRORS[code] || 'הפעולה נכשלה. נסו שוב או פתחו אבחון.' };
}
function redact(value, key = '') {
  if (/secret|token|password|access.?code|authorization/i.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, redact(entry, name)]));
  return value;
}
function createWindow() {
  win = new BrowserWindow({ width: 1120, height: 760, minWidth: 400, minHeight: 560, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  win.removeMenu(); win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => { if (!config.configured) win.show(); });
  win.on('close', (event) => { if (!quitting) { event.preventDefault(); win.hide(); } });
}
function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'tray-icon.svg'));
  const show = () => { win.show(); win.focus(); };
  tray.setToolTip('מדפסת חברים – גשר מקומי'); tray.on('click', show);
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'פתיחה', click: show }, { label: 'סריקה וסנכרון', click: () => safeApi('POST', '/v1/library/scan') }, { type: 'separator' }, { label: 'יציאה', click: quitGracefully }]));
}
function launchDaemon() {
  if (!config?.configured || daemon) return;
  capability = crypto.randomBytes(32).toString('base64url');
  // The selected executable receives an encrypted-at-rest configuration and the
  // per-launch capability over stdin, never argv, env, logs, or renderer IPC.
  const executable = config.launch?.daemonExecutable;
  if (!executable || !path.isAbsolute(executable)) return;
  daemon = spawn(executable, [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  daemon.stdin.end(JSON.stringify({
    management: { host: '127.0.0.1', port: 43127, capability },
    config: config.launch.daemonConfig,
  }));
  daemon.once('exit', () => { daemon = null; capability = null; latestStatus = { state: 'daemon_stopped' }; win?.webContents.send('desktop:daemon-state', latestStatus); });
  daemon.once('error', () => { latestStatus = { state: 'daemon_failed' }; });
}
async function safeApi(method, endpoint, opts) { if (!capability) throw new ManagementError(503, 'daemon_not_ready', 'הגשר המקומי עדיין אינו מוכן.'); return apiRequest(capability, method, endpoint, opts); }
function validateSetup(value, previous = {}) {
  const bounded = (item, min, max) => typeof item === 'string' && item.length >= min && item.length <= max;
  if (!isPlainObject(value) || value.mode !== 'local' || !bounded(value.daemonExecutable, 1, 500) || !path.isAbsolute(value.daemonExecutable)) throw new Error('invalid_setup');
  const raw = value.daemonConfig;
  if (!isPlainObject(raw)) throw new Error('invalid_setup');
  if (!bounded(raw.siteUrl, 1, 2048)) throw new Error('invalid_setup');
  let url; try { url = new URL(raw.siteUrl); } catch { throw new Error('invalid_setup'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || raw.bridgeId !== 'home-bridge' || !bounded(raw.storageDir, 1, 500) || !path.isAbsolute(raw.storageDir) || typeof raw.simulate !== 'boolean' || !isPlainObject(raw.printer)) throw new Error('invalid_setup');
  const old = previous.launch?.daemonConfig || {};
  const printer = raw.printer;
  const oldPrinter = old.printer || {};
  const bridgeSecret = raw.bridgeSecret || old.bridgeSecret;
  const accessCode = printer.accessCode || oldPrinter.accessCode || '';
  if (!bounded(bridgeSecret, 16, 512) || !bounded(printer.ip || '', 0, 120) || !bounded(printer.serial || '', 0, 160) || !bounded(accessCode, 0, 512) || !bounded(printer.plateGcode || 'Metadata/plate_1.gcode', 1, 240) || typeof printer.useAms !== 'boolean') throw new Error('invalid_setup');
  if (!raw.simulate && (!bounded(printer.ip, 1, 120) || !bounded(printer.serial, 1, 160) || !bounded(accessCode, 1, 512))) throw new Error('invalid_setup');
  const daemonConfig = { siteUrl: url.toString().replace(/\/$/, ''), bridgeSecret, bridgeId: 'home-bridge', storageDir: raw.storageDir, simulate: raw.simulate, printer: { ip: printer.ip || '', serial: printer.serial || '', accessCode, plateGcode: printer.plateGcode || 'Metadata/plate_1.gcode', useAms: printer.useAms } };
  return { configured: true, launch: { daemonExecutable: value.daemonExecutable, daemonConfig } };
}
ipcMain.handle('desktop:bootstrap', () => ({ configured: config.configured, mode: 'local', secureStorage: require('electron').safeStorage.isEncryptionAvailable(), status: latestStatus }));
ipcMain.handle('desktop:save-setup', async (_event, value) => { try { if (!require('electron').safeStorage.isEncryptionAvailable()) throw new Error('secure_storage_unavailable'); const deferred = Boolean(daemon); config = await configStore.save(validateSetup(value, config)); app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true }); launchDaemon(); return { ok: true, deferred }; } catch (e) { return publicError(e); } });
for (const [channel, method, endpoint] of [['desktop:status', 'GET', '/v1/status'], ['desktop:queue', 'GET', '/v1/queue'], ['desktop:library', 'GET', '/v1/library'], ['desktop:scan', 'POST', '/v1/library/scan'], ['desktop:pause', 'POST', '/v1/lifecycle/pause'], ['desktop:resume', 'POST', '/v1/lifecycle/resume'], ['desktop:logs', 'GET', '/v1/logs']]) ipcMain.handle(channel, async () => { try { const data = redact(await safeApi(method, endpoint)); if (endpoint === '/v1/status') latestStatus = data; return { ok: true, data }; } catch (e) { return publicError(e); } });
ipcMain.handle('desktop:diagnose', async (_event, kind) => { if (!['site', 'printer'].includes(kind)) return publicError(new Error('invalid_diagnostic')); try { return { ok: true, data: redact(await safeApi('POST', `/v1/diagnostics/${kind}`)) }; } catch (e) { return publicError(e); } });
ipcMain.handle('desktop:import', async () => { try { const picked = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Bambu plate', extensions: ['3mf'] }] }); if (picked.canceled) return { ok: false, code: 'cancelled' }; return { ok: true, data: await importFile(capability, picked.filePaths[0], (p) => win.webContents.send('desktop:import-progress', { sent: p.sent, total: p.total })) }; } catch (e) { return publicError(e); } });
ipcMain.handle('desktop:show-settings', () => { win.show(); win.webContents.send('desktop:navigate', 'settings'); });
async function quitGracefully() { try { await safeApi('POST', '/v1/lifecycle/shutdown', { timeoutMs: 15_000 }); } catch (e) { if (e.status === 409) { win?.show(); win?.webContents.send('desktop:quit-blocked'); return; } } quitting = true; tray?.destroy(); app.quit(); }
app.whenReady().then(async () => { config = await configStore.load(); session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false)); createWindow(); createTray(); launchDaemon(); app.setLoginItemSettings({ openAtLogin: Boolean(config.configured), openAsHidden: true }); });
app.on('window-all-closed', (event) => event.preventDefault()); app.on('before-quit', (event) => { if (!quitting) { event.preventDefault(); quitGracefully(); } }); app.on('activate', () => win?.show());
