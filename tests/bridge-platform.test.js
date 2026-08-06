const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const checksum = 'a'.repeat(64);

function response() {
  return { statusCode: 200, body: undefined, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}

function withReplacements(replacements, load) {
  const previous = new Map();
  for (const [modulePath, exports] of replacements) {
    previous.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  }
  try { return load(); } finally {
    for (const [modulePath, cached] of previous) { if (cached) require.cache[modulePath] = cached; else delete require.cache[modulePath]; }
  }
}

function loadPrintJobs({ bridge = null, admin = null, sql }) {
  const handlerPath = require.resolve(path.join(root, 'api/print-jobs.js'));
  const replacements = new Map([
    [require.resolve(path.join(root, 'api/_db.js')), { getSql: () => sql }],
    [require.resolve(path.join(root, 'api/_middleware.js')), {
      normalizeOrderStatus: (value) => value, parseBody: async (req) => req.body || {},
      requireAdmin: async (_req, res) => { if (admin) return admin; res.status(403).json({ error: 'Forbidden' }); return null; },
    }],
    [require.resolve(path.join(root, 'api/_bridge-auth.js')), { authenticateBridge: () => bridge, canBridge: () => Boolean(bridge), configuredBridgeId: () => bridge?.bridgeId || null }],
    [require.resolve(path.join(root, 'api/_pricing.js')), { calculateProductCost: () => ({}) }],
    [require.resolve(path.join(root, 'api/_order-inventory.js')), { finalizeOrder: async () => {} }],
  ]);
  delete require.cache[handlerPath];
  return withReplacements(replacements, () => require(handlerPath));
}

function zip(entries) {
  const locals = []; const central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const body = Buffer.from(entry.body || '');
    const flags = entry.flags || 0; const method = entry.method || 0;
    const compressedSize = entry.compressedSize ?? body.length; const uncompressedSize = entry.uncompressedSize ?? body.length;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(compressedSize, 18); local.writeUInt32LE(uncompressedSize, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(flags, 8); record.writeUInt16LE(method, 10); record.writeUInt32LE(compressedSize, 20); record.writeUInt32LE(uncompressedSize, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, name); offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central); const trailer = Buffer.alloc(22);
  trailer.writeUInt32LE(0x06054b50, 0); trailer.writeUInt16LE(entries.length, 8); trailer.writeUInt16LE(entries.length, 10); trailer.writeUInt32LE(directory.length, 12); trailer.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, trailer]);
}

async function tempArchive(entries) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jmp-3mf-'));
  const file = path.join(dir, 'plate.gcode.3mf');
  await fsp.writeFile(file, zip(entries));
  return { dir, file };
}

test('bridge auth requires configured secret and identity, prefers Bearer, and retains legacy header compatibility', () => {
  const { authenticateBridge, canBridge, configuredBridgeId } = require('../api/_bridge-auth');
  const env = { BRIDGE_SECRET: 's'.repeat(32), BRIDGE_ID: 'home-bridge' };
  assert.equal(configuredBridgeId({}), null);
  assert.equal(authenticateBridge({ headers: {} }, env), null);
  assert.equal(canBridge({ headers: { authorization: 'Bearer wrong' } }, env), false);
  assert.equal(authenticateBridge({ headers: { authorization: `Bearer ${env.BRIDGE_SECRET}`, 'x-bridge-secret': 'wrong' } }, env).bridgeId, 'home-bridge');
  assert.equal(authenticateBridge({ headers: { authorization: 'Bearer wrong', 'x-bridge-secret': env.BRIDGE_SECRET } }, env), null, 'Bearer must win over a legacy header');
  assert.equal(authenticateBridge({ headers: { 'x-bridge-secret': env.BRIDGE_SECRET } }, env).bridgeId, 'home-bridge');
  assert.equal(authenticateBridge({ headers: { authorization: `Bearer ${env.BRIDGE_SECRET}` } }, { BRIDGE_SECRET: env.BRIDGE_SECRET }), null);
  assert.equal(authenticateBridge({ headers: { authorization: `Bearer ${env.BRIDGE_SECRET}` }, body: { bridgeId: 'attacker' } }, env).bridgeId, 'home-bridge');
});

test('bridge queue is bridge-only, read-only, bounded, and returns a sanitized advisory DTO', async () => {
  const queries = [];
  const rows = [
    { id: 'good', status: 'queued', print_hours: 2, print_file_checksum: checksum, print_file_name: 'good.gcode.3mf', print_file_url: 'https://secret.example/a', product_name: 'Product', quantity: 2, selected_colors: [{ name: 'red', private: 'no' }], created_at: 'now', file_available: true, printer_state: 'idle', order_id: 'order-private', friend_name: 'Friend Private', claim_token: 'secret-token' },
    { id: 'busy', status: 'queued', print_file_checksum: checksum, print_file_name: 'busy.gcode.3mf', file_available: true, printer_state: 'busy', quantity: 1 },
    { id: 'missing', status: 'queued', print_file_checksum: checksum, print_file_name: 'missing.gcode.3mf', file_available: false, printer_state: 'idle', quantity: 1 },
    { id: 'legacy', status: 'queued', print_file_checksum: '', print_file_name: 'legacy.gcode.3mf', print_file_url: 'https://legacy.example/private', file_available: true, printer_state: 'idle', quantity: 1 },
    { id: 'no-source', status: 'queued', print_file_checksum: '', print_file_name: '', print_file_url: '', file_available: false, printer_state: 'idle', quantity: 1 },
  ];
  const handler = loadPrintJobs({ bridge: { bridgeId: 'home-bridge' }, sql: (strings) => {
    const text = strings.join(' '); queries.push(text);
    if (/FROM print_jobs pj/.test(text)) return Promise.resolve(rows);
    if (/FROM print_job_items/.test(text)) return Promise.resolve([{ quantity: 2, item_snapshot: { name: 'Product', orderId: 'never' }, selected_colors: [{ name: 'red' }], product_name: 'Product' }]);
    throw new Error(`unexpected query: ${text}`);
  } });
  const res = response();
  await handler({ method: 'GET', query: { action: 'bridge-queue' }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.jobs.length, 5);
  assert.deepEqual(res.body.jobs.map((job) => [job.id, job.claimable, job.blockedReason]), [['good', true, null], ['busy', false, 'printer_busy'], ['missing', false, 'file_unavailable'], ['legacy', true, null], ['no-source', false, 'file_unavailable']]);
  assert.equal(res.body.jobs.find((job) => job.id === 'legacy').printFile.source, 'legacy_cloudinary');
  assert.equal(Object.hasOwn(res.body.jobs[0], 'claimToken'), false);
  const output = JSON.stringify(res.body);
  for (const privateValue of ['order-private', 'Friend Private', 'secret-token', 'https://secret.example/a', 'https://legacy.example/private', 'never']) assert.equal(output.includes(privateValue), false, privateValue);
  assert.ok(queries.every((text) => /^\s*SELECT/i.test(text)), 'bridge-queue must not write');
  assert.match(queries[0], /LIMIT/);

  const forbidden = loadPrintJobs({ bridge: null, sql: () => { throw new Error('DB must not be reached'); } });
  const denied = response(); await forbidden({ method: 'GET', query: { action: 'bridge-queue' } }, denied); assert.equal(denied.statusCode, 403);
  const adminOnly = loadPrintJobs({ bridge: { bridgeId: 'home-bridge' }, admin: null, sql: () => { throw new Error('DB must not be reached'); } });
  const adminDenied = response(); await adminOnly({ method: 'GET', query: {} }, adminDenied); assert.equal(adminDenied.statusCode, 403);
});

test('claim tokens are emitted only by successful claim-next and reports reject malformed progress/failure input before SQL', async () => {
  const claimQueries = [];
  const claimed = { id: 'job-1', status: 'claimed', source: 'self', product_id: 'p', quantity: 1, selected_colors: [], print_file_checksum: checksum, print_file_name: 'p.gcode.3mf', claim_token: 'token-1' };
  const handler = loadPrintJobs({ bridge: { bridgeId: 'home-bridge' }, sql: (strings) => {
    const text = strings.join(' '); claimQueries.push(text);
    if (/FOR UPDATE SKIP LOCKED/.test(text)) return Promise.resolve([claimed]);
    if (/FROM print_job_items/.test(text)) return Promise.resolve([]);
    return Promise.resolve([]);
  } });
  const claim = response(); await handler({ method: 'POST', query: { action: 'claim-next' }, body: {} }, claim);
  assert.equal(claim.statusCode, 200); assert.equal(claim.body.job.claimToken, 'token-1');
  const invalid = loadPrintJobs({ bridge: { bridgeId: 'home-bridge' }, sql: () => { throw new Error('invalid report must not access DB'); } });
  for (const body of [{ status: 'printing', progress: 101 }, { status: 'failed', progress: 'NaN' }, { status: 'failed', failureCode: 'raw_printer_stack' }, { status: 'printing', failureCode: 'printer_error' }]) {
    const res = response(); await invalid({ method: 'PUT', query: { action: 'report', id: 'job-1' }, body: { ...body, claimToken: 'token-1', error: 'raw secret', message: 'raw secret' } }, res); assert.equal(res.statusCode, 400);
  }
  const source = fs.readFileSync(path.join(root, 'api/print-jobs.js'), 'utf8');
  assert.match(source, /Legacy message\/error input is ignored deliberately/);
  assert.match(source, /attention_required' AND status IN \('uploading', 'printing'\)/);
  assert.match(source, /cancelled' AND status IN \('claimed', 'uploading'\) AND cancel_requested_at IS NOT NULL/);
  assert.match(source, /status IN \('awaiting_approval', 'queued', 'claimed', 'uploading', 'printing', 'attention_required'\)/);
});

test('bounded lazy 3MF parser extracts duration, metadata, profile, material, and purge under the Pi heap setting', async (t) => {
  const { dir, file } = await tempArchive([
    { name: 'Metadata/plate_1.gcode', body: '; total estimated time: 1 day 2 hours 30 minutes 15 seconds\n; total filament used [g] : 10, 5\n; default_print_profile = "0.12mm Fine @BBL P2S"\n; filament_density = 1.24\n; filament_diameter = 1.75\n; FLUSH_START\nG1 E20\n; FLUSH_END\nM620.10 A1 L10\n' },
    { name: 'Metadata/slice_info.config', body: '<meta prediction="95415" weight="10" />\n' },
  ]);
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const { extract3mfEstimates, parseDuration } = require('../bridge/three-mf-lazy');
  assert.ok(Math.abs(parseDuration('2 days 3 hours 4 minutes 5 seconds') - (51 + 4 / 60 + 5 / 3600)) < 1e-12);
  const result = await extract3mfEstimates(file);
  assert.equal(result.printHours, 26 + 30 / 60 + 15 / 3600);
  assert.deepEqual(result.materialGrams, [10, 5]); assert.equal(result.printProfile, 'ams'); assert.ok(result.purgeGrams > 0);
  const script = `require(${JSON.stringify(path.join(root, 'bridge/three-mf-lazy.js'))}).extract3mfEstimates(process.argv[1]).then(x=>process.stdout.write(JSON.stringify(x)))`;
  const output = childProcess.execFileSync(process.execPath, ['-e', script, file], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=192' }, encoding: 'utf8' });
  assert.equal(JSON.parse(output).printHours, result.printHours);
});

test('lazy 3MF parser rejects missing plate, encrypted/unsupported/bounded archives, and overlong G-code lines', async (t) => {
  const { extract3mfEstimates } = require('../bridge/three-mf-lazy');
  const cases = [
    { entries: [{ name: 'Metadata/slice_info.config', body: 'prediction="3600" weight="1"' }], pattern: /plate_1\.gcode/ },
    { entries: [{ name: 'Metadata/plate_1.gcode', body: 'x', flags: 1 }], pattern: /Encrypted/ },
    { entries: [{ name: 'Metadata/plate_1.gcode', body: 'x', method: 99 }], pattern: /Unsupported/ },
    { entries: [{ name: 'Metadata/plate_1.gcode', body: 'x', compressedSize: 999999 }], pattern: /bounds/ },
    { entries: [{ name: 'Metadata/plate_1.gcode', body: Buffer.alloc(1024 * 1024 + 1, 'X') }], pattern: /overlong line/ },
  ];
  for (const scenario of cases) {
    const { dir, file } = await tempArchive(scenario.entries); t.after(() => fsp.rm(dir, { recursive: true, force: true }));
    await assert.rejects(extract3mfEstimates(file), scenario.pattern);
  }
});

test('runtime configuration and handshake preserve bounded local-only capability contracts', async () => {
  const config = require('../bridge/config'); const management = require('../bridge/management-api');
  assert.throws(() => config.configFromEnvironment({ BRIDGE_SECRET: 'x', BRIDGE_ID: 'home-bridge', MANAGEMENT_TOKEN: 'x', MANAGEMENT_HOST: '0.0.0.0' }), /loopback/);
  assert.throws(() => config.configFromEnvironment({ BRIDGE_SECRET: 'x', BRIDGE_ID: 'other', MANAGEMENT_TOKEN: 'x' }), /home-bridge/);
  assert.equal(management.decodeFileName(Buffer.from('plate.gcode.3mf').toString('base64url')), 'plate.gcode.3mf');
  for (const name of ['../escape.gcode.3mf', 'plate.3mf', 'plate.gcode.3mf\u0000x']) assert.throws(() => management.decodeFileName(Buffer.from(name).toString('base64url')));
  const mapped = config.mapHandshake({ management: { host: '127.0.0.1', port: 43127, capability: 'm'.repeat(32), injected: 'ignore' }, config: { siteUrl: 'https://example.test', bridgeSecret: 's'.repeat(16), bridgeId: 'home-bridge', storageDir: '/tmp/jmp', simulate: true, injected: 'ignore', printer: {} } });
  assert.equal(mapped.managementHost, '127.0.0.1'); assert.equal(Object.hasOwn(mapped, 'injected'), false);
  assert.throws(() => config.mapHandshake({ management: { host: '0.0.0.0', port: 1, capability: 'm'.repeat(32) }, config: { siteUrl: 'https://example.test', bridgeSecret: 's'.repeat(16), bridgeId: 'home-bridge', storageDir: '/tmp/jmp', simulate: true } }), /loopback/);
  await assert.rejects(config.loadConfig({ argv: ['--unexpected'], env: {} }), /Unknown bridge launch option/);
  const silent = new PassThrough();
  const keepAlive = setInterval(() => {}, 50);
  try { await assert.rejects(config.readHandshake(silent, { timeoutMs: 5, maxBytes: 64 }), /timed out/); }
  finally { clearInterval(keepAlive); }
  const source = Object.fromEntries(['bridge/three-mf-lazy.js', 'bridge/file-library.js', 'bridge/management-api.js', 'bridge/index.js', 'bridge/jmp-print-bridge.service', 'bridge-desktop/src/main.js', 'bridge-desktop/src/preload.js', 'bridge-desktop/src/renderer/index.html', 'bridge-desktop/src/renderer/app.js', 'bridge-desktop/package.json'].map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  assert.match(source['bridge/file-library.js'], /cached\.byteSize === stat\.size && cached\.mtimeMs === stat\.mtimeMs/);
  assert.match(source['bridge/file-library.js'], /scanInFlight[\s\S]+return this\.scanInFlight/);
  assert.match(source['bridge/management-api.js'], /base64url[\s\S]+X-File-Name|decodeFileName[\s\S]+base64url/);
  assert.match(source['bridge/management-api.js'], /partial[\s\S]+finally[\s\S]+unlink\(partial\)/);
  assert.match(source['bridge/index.js'], /bridge-queue/); assert.doesNotMatch(source['bridge/index.js'], /siteDiagnostics[\s\S]{0,250}claim-next/);
  assert.doesNotMatch(source['bridge/three-mf-lazy.js'] || '', /readFile\(/);
  for (const file of ['bridge/three-mf-lazy.js', 'bridge/file-library.js', 'bridge/index.js']) assert.doesNotMatch(source[file], /adm-zip|require\(['"]electron['"]\)/i);
  assert.doesNotMatch(source['bridge/index.js'], /0\.0\.0\.0/);
  for (const setting of ['NoNewPrivileges=true', 'ProtectSystem=strict', 'ProtectHome=true', 'PrivateDevices=true', 'MemoryMax=320M']) assert.match(source['bridge/jmp-print-bridge.service'], new RegExp(setting));
  assert.match(source['bridge-desktop/src/main.js'], /nodeIntegration: false[\s\S]+contextIsolation: true[\s\S]+sandbox: true/);
  assert.match(source['bridge-desktop/src/main.js'], /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)[\s\S]+will-navigate/);
  assert.match(source['bridge-desktop/src/main.js'], /setPermissionRequestHandler[\s\S]+callback\(false\)/);
  assert.match(source['bridge-desktop/src/main.js'], /safeStorage\.isEncryptionAvailable/);
  assert.match(source['bridge-desktop/src/preload.js'], /contextBridge\.exposeInMainWorld[\s\S]+Object\.freeze/);
  assert.doesNotMatch(source['bridge-desktop/src/renderer/app.js'], /require\(|process\.|ipcRenderer|child_process/);
  assert.match(source['bridge-desktop/src/renderer/index.html'], /lang="he" dir="rtl"[\s\S]+Content-Security-Policy[\s\S]+aria-live[\s\S]+progressbar/);
  assert.match(source['bridge-desktop/src/renderer/index.html'], /האישור והביטול מנוהלים באתר/);
  assert.doesNotMatch(source['bridge-desktop/src/preload.js'], /approve|cancel|stop.*print|physical.*pause/i);
  assert.match(source['bridge-desktop/package.json'], /"perMachine": false[\s\S]+"allowElevation": false[\s\S]+"deleteAppDataOnUninstall": false/);
});
