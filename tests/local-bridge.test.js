const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(process.env.JMP_TEST_ROOT || path.join(__dirname, '..'));
const frontendRoot = path.resolve(process.env.JMP_FRONTEND_TEST_ROOT || root);
const checksum = 'a'.repeat(64);

function responseRecorder() {
  return {
    body: undefined,
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function withReplacements(replacements, load) {
  const previous = new Map();
  for (const [modulePath, exports] of replacements) {
    previous.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  }
  try { return load(); }
  finally {
    for (const [modulePath, cached] of previous) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
}

function loadFileLibrary(extract3mfEstimates) {
  const libraryPath = require.resolve(path.join(root, 'bridge/file-library.js'));
  const estimatesPath = require.resolve(path.join(root, 'bridge/three-mf-lazy.js'));
  delete require.cache[libraryPath];
  return withReplacements(new Map([[estimatesPath, { extract3mfEstimates }]]), () => require(libraryPath));
}

function loadBridgeFiles({ admin = null, bridge = false, sql } = {}) {
  const handlerPath = require.resolve(path.join(root, 'api/bridge-files.js'));
  const replacements = new Map([
    [require.resolve(path.join(root, 'api/_db.js')), { getSql: () => sql }],
    [require.resolve(path.join(root, 'api/_middleware.js')), {
      parseBody: async (req) => req.body ?? {},
      requireAdmin: async (_req, res) => {
        if (admin) return admin;
        res.status(403).json({ error: 'Forbidden' });
        return null;
      },
    }],
    [require.resolve(path.join(root, 'api/_bridge-auth.js')), { canBridge: () => bridge }],
  ]);
  delete require.cache[handlerPath];
  return withReplacements(replacements, () => require(handlerPath));
}

function loadPrintJobs({ admin = null, bridge = false, sql } = {}) {
  const handlerPath = require.resolve(path.join(root, 'api/print-jobs.js'));
  const replacements = new Map([
    [require.resolve(path.join(root, 'api/_db.js')), { getSql: () => sql }],
    [require.resolve(path.join(root, 'api/_middleware.js')), {
      normalizeOrderStatus: (status) => status,
      parseBody: async (req) => req.body ?? {},
      requireAdmin: async (_req, res) => {
        if (admin) return admin;
        res.status(403).json({ error: 'Forbidden' });
        return null;
      },
    }],
    [require.resolve(path.join(root, 'api/_bridge-auth.js')), { canBridge: () => bridge }],
    [require.resolve(path.join(root, 'api/_pricing.js')), { calculateProductCost: () => ({}) }],
    [require.resolve(path.join(root, 'api/_order-inventory.js')), { finalizeOrder: async () => {} }],
  ]);
  delete require.cache[handlerPath];
  return withReplacements(replacements, () => require(handlerPath));
}

async function temporaryStorage() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'jmp-local-bridge-test-'));
}

function estimates() {
  return { printHours: 1.25, materialGrams: [10, 2], printProfile: 'standard', purgeGrams: 0.5 };
}

test('scanner preserves duplicate incoming plates in quarantine while keeping one canonical library entry', async (t) => {
  const storageDir = await temporaryStorage();
  t.after(() => fs.rm(storageDir, { recursive: true, force: true }));
  const calls = [];
  const { FileLibrary } = loadFileLibrary(async (target) => { calls.push(target); return estimates(); });
  const library = new FileLibrary({ storageDir, stableWaitMs: 1, logger: { warn() {} } });
  await library.init();
  await Promise.all([
    fs.writeFile(path.join(storageDir, 'incoming', 'plate-one.gcode.3mf'), 'same plate'),
    fs.writeFile(path.join(storageDir, 'incoming', 'plate-two.gcode.3mf'), 'same plate'),
  ]);

  const inventory = await library.scan();
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].checksum.length, 64);
  assert.equal(calls.length, 2, 'the bridge lazy extractor inspects both inputs, then cache size+mtime skips a redundant canonical re-read');
  assert.ok(calls.every((target) => String(target).endsWith('.gcode.3mf')));
  assert.equal((await fs.readdir(path.join(storageDir, 'incoming'))).length, 0);
  assert.equal((await fs.readdir(path.join(storageDir, 'library'))).filter((name) => name.endsWith('.gcode.3mf')).length, 1);
  const quarantined = await fs.readdir(path.join(storageDir, 'quarantine'));
  const duplicateNote = quarantined.find((name) => name.endsWith('.error.txt'));
  assert.ok(quarantined.some((name) => name.endsWith('.gcode.3mf')), 'duplicate source must be preserved in quarantine');
  assert.ok(duplicateNote, 'duplicate quarantine must explain why it was preserved');
  assert.match(await fs.readFile(path.join(storageDir, 'quarantine', duplicateNote), 'utf8'), /Duplicate plate already exists/);
  assert.match(library.localPath(inventory[0].checksum), new RegExp(`${inventory[0].checksum}\\.gcode\\.3mf$`));
});

test('scanner quarantines files that are not sliced Bambu plates and keeps them out of the inventory', async (t) => {
  const storageDir = await temporaryStorage();
  t.after(() => fs.rm(storageDir, { recursive: true, force: true }));
  const { FileLibrary } = loadFileLibrary(async () => { throw new Error('Metadata/plate_1.gcode is missing'); });
  const library = new FileLibrary({ storageDir, stableWaitMs: 1, logger: { warn() {} } });
  await library.init();
  await fs.writeFile(path.join(storageDir, 'incoming', 'project.gcode.3mf'), 'unsliced project');

  assert.deepEqual(await library.scan(), []);
  const quarantined = await fs.readdir(path.join(storageDir, 'quarantine'));
  assert.ok(quarantined.some((name) => name.endsWith('.gcode.3mf')));
  assert.ok(quarantined.some((name) => name.endsWith('.error.txt')));
});

test('scanner quarantines over-limit files before it attempts 3MF inspection', async (t) => {
  const storageDir = await temporaryStorage();
  t.after(() => fs.rm(storageDir, { recursive: true, force: true }));
  let inspections = 0;
  const { FileLibrary } = loadFileLibrary(async () => { inspections += 1; return estimates(); });
  const library = new FileLibrary({ storageDir, maxBytes: 1024 * 1024, stableWaitMs: 1, logger: { warn() {} } });
  await library.init();
  await fs.writeFile(path.join(storageDir, 'incoming', 'too-large.gcode.3mf'), Buffer.alloc(1024 * 1024 + 1));

  assert.deepEqual(await library.scan(), []);
  assert.equal(inspections, 0);
  assert.ok((await fs.readdir(path.join(storageDir, 'quarantine'))).some((name) => name.endsWith('.error.txt')));
});

test('bridge file sync is secret-only, validates complete metadata, and sends one full reconciliation without local paths', async () => {
  const denied = loadBridgeFiles({ bridge: false, sql: () => { throw new Error('DB must not be reached'); } });
  const deniedRes = responseRecorder();
  await denied({ method: 'POST', query: { action: 'sync' }, body: { bridgeId: 'mac', files: [] } }, deniedRes);
  assert.equal(deniedRes.statusCode, 403);

  const queries = [];
  const handler = loadBridgeFiles({
    bridge: true,
    sql: (strings, ...values) => { queries.push({ text: strings.join(' '), values }); return Promise.resolve([]); },
  });
  const res = responseRecorder();
  await handler({
    method: 'POST', query: { action: 'sync' }, body: {
      bridgeId: 'mac', status: 'online', diskFreeBytes: 20, diskTotalBytes: 100,
      files: [{ checksum, fileName: 'plate.gcode.3mf', byteSize: 42, printHours: 1, materialGrams: [8], printProfile: 'standard', purgeGrams: 0, path: '/private/never-send' }],
    },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, bridgeId: 'mac', files: 1 });
  assert.equal(queries.length, 2);
  assert.match(queries[1].text, /WITH incoming AS[\s\S]+ON CONFLICT[\s\S]+available = FALSE/);
  assert.equal(JSON.stringify(queries.flatMap((query) => query.values)).includes('/private/never-send'), false);
});

test('bridge inventory GET stays admin-only and normalizes availability for the UI', async () => {
  const denied = loadBridgeFiles({ admin: null, sql: () => { throw new Error('DB must not be reached'); } });
  const deniedRes = responseRecorder();
  await denied({ method: 'GET', query: {} }, deniedRes);
  assert.equal(deniedRes.statusCode, 403);

  let call = 0;
  const handler = loadBridgeFiles({
    admin: { id: 'admin' },
    sql: () => Promise.resolve(call++ === 0
      ? [{ bridge_id: 'mac', checksum, file_name: 'plate.gcode.3mf', byte_size: 42, print_hours: 1, material_grams: [8], print_profile: 'standard', purge_grams: 0, available: false, last_seen_at: '2026-08-06T10:00:00.000Z' }]
      : [{ id: 'mac', status: 'online', disk_free_bytes: 20, disk_total_bytes: 100, last_seen_at: new Date().toISOString(), updated_at: 'now' }]),
  });
  const res = responseRecorder();
  await handler({ method: 'GET', query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.files[0].available, false);
  assert.equal(res.body.bridge.id, 'mac');
  assert.equal(res.body.bridge.online, true);
});

test('approved custom plates reject exhausted allocations instead of queuing a duplicate order copy', async () => {
  const queries = [];
  const handler = loadPrintJobs({
    admin: { id: 'admin', name: 'Amir' },
    sql: (strings, ...values) => {
      const text = strings.join(' ');
      queries.push({ text, values });
      if (/FROM bridge_files bf JOIN bridges/.test(text)) return Promise.resolve([{ bridge_id: 'mac', file_name: 'plate.gcode.3mf', material_grams: [8], print_hours: 1 }]);
      if (/WITH requested AS/.test(text)) return Promise.resolve([]);
      return Promise.resolve([]);
    },
  });
  const res = responseRecorder();
  await handler({ method: 'POST', query: { action: 'create-approved' }, body: { fileChecksum: checksum, items: [{ orderId: 'order-1', quantity: 2 }] } }, res);
  assert.equal(res.statusCode, 409);
  const allocationQuery = queries.find((query) => /WITH requested AS/.test(query.text)).text;
  assert.match(allocationQuery, /active_job\.status IN \('awaiting_approval', 'queued', 'claimed', 'uploading', 'printing', 'attention_required'\)[\s\S]+allocated_quantity[\s\S]+FOR UPDATE OF o[\s\S]+quantity - printed_quantity - allocated_quantity/);
});

test('claim, heartbeat, and report enforce the per-claim token and stale work is made explicit', async () => {
  const queries = [];
  const claimedJob = { id: 'job-1', source: 'plate', product_id: 'p1', quantity: 1, selected_colors: [], status: 'claimed', progress: 0, error_reason: '', claim_token: 'token-1', created_at: 'now', updated_at: 'now' };
  const handler = loadPrintJobs({
    bridge: true,
    sql: (strings, ...values) => {
      const text = strings.join(' ');
      queries.push({ text, values });
      if (/FOR UPDATE SKIP LOCKED/.test(text)) return Promise.resolve([claimedJob]);
      if (/FROM print_job_items/.test(text)) return Promise.resolve([]);
      if (/UPDATE print_jobs SET updated_at = NOW\(\)/.test(text)) return Promise.resolve([]);
      return Promise.resolve([]);
    },
  });
  const claim = responseRecorder();
  await handler({ method: 'POST', query: { action: 'claim-next' }, body: { bridgeId: 'mac' } }, claim);
  assert.equal(claim.statusCode, 200);
  assert.equal(claim.body.job.claimToken, 'token-1');
  assert.ok(queries.some(({ text }) => /status = 'attention_required'/.test(text)));
  assert.ok(queries.some(({ text }) => /status = 'queued'[\s\S]+claim_token = NULL[\s\S]+WHERE status = 'claimed'/.test(text)));

  const heartbeat = responseRecorder();
  await handler({ method: 'PUT', query: { action: 'heartbeat', id: 'job-1' }, body: { claimToken: 'wrong-token' } }, heartbeat);
  assert.equal(heartbeat.statusCode, 409);
  assert.ok(queries.some(({ text, values }) => /UPDATE print_jobs SET updated_at = NOW\(\)[\s\S]+claim_token =/.test(text) && values.includes('wrong-token')));
});

test('done reports atomically apply plate allocations and safely retry the idempotent CTE after a duplicate terminal report', async () => {
  let terminal = false;
  const completionQueries = [];
  const job = { id: 'job-1', order_id: 'order-1', source: 'plate', product_id: 'p1', quantity: 1, selected_colors: [], status: 'done', progress: 100, error_reason: '', claim_token: 'token-1', created_at: 'now', updated_at: 'now' };
  const handler = loadPrintJobs({
    bridge: true,
    sql: (strings) => {
      const text = strings.join(' ');
      if (/events = CASE WHEN status/.test(text)) {
        if (terminal) return Promise.resolve([]);
        terminal = true;
        return Promise.resolve([job]);
      }
      if (/SELECT \* FROM print_jobs WHERE id =/.test(text)) return Promise.resolve([job]);
      if (/FROM orders WHERE id =/.test(text)) return Promise.resolve([{ id: 'order-1', internal: false }]);
      if (/WITH completed AS/.test(text)) { completionQueries.push(text); return Promise.resolve([]); }
      if (/FROM print_job_items/.test(text)) return Promise.resolve([]);
      return Promise.resolve([]);
    },
  });
  for (let i = 0; i < 2; i += 1) {
    const res = responseRecorder();
    await handler({ method: 'PUT', query: { action: 'report', id: 'job-1' }, body: { status: 'done', claimToken: 'token-1' } }, res);
    assert.equal(res.statusCode, 200);
  }
  assert.equal(completionQueries.length, 2, 'the duplicate report must safely retry after a post-terminal crash');
  for (const query of completionQueries) {
    assert.match(query, /WITH completed AS[\s\S]+UPDATE print_job_items SET completion_applied_at = NOW\(\)[\s\S]+totals AS[\s\S]+SUM\(quantity\)::INTEGER AS completed_quantity[\s\S]+UPDATE orders AS customer_order[\s\S]+FROM totals/);
  }
});

test('admin cancellation requests a bridge stop before printing, rather than force-cancelling a live claim', async () => {
  const handler = loadPrintJobs({
    admin: { id: 'admin' },
    sql: (strings) => {
      const text = strings.join(' ');
      if (/cancel_requested_at = NOW/.test(text)) return Promise.resolve([{ id: 'job-1', status: 'claimed', claim_token: 'token-1' }]);
      if (/FROM print_job_items/.test(text)) return Promise.resolve([]);
      if (/status = 'cancelled'/.test(text)) throw new Error('live claim must not be cancelled immediately');
      return Promise.resolve([]);
    },
  });
  const res = responseRecorder();
  await handler({ method: 'PUT', query: { action: 'cancel', id: 'job-1' }, body: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'claimed');
});

test('admin frontend source retains local-file selection, confirmation, custom-plate allocation, and legacy offline fallback contracts', () => {
  const app = require('node:fs').readFileSync(path.join(frontendRoot, 'js/app.js'), 'utf8');
  const render = require('node:fs').readFileSync(path.join(frontendRoot, 'js/render.js'), 'utf8');
  const state = require('node:fs').readFileSync(path.join(frontendRoot, 'js/state.js'), 'utf8');
  const html = require('node:fs').readFileSync(path.join(frontendRoot, 'dashboard.html'), 'utf8');
  assert.match(html, /id="bridge-file-select"[\s\S]+id="print-approval-dialog"[\s\S]+id="custom-plate-dialog"/);
  assert.match(state, /bridgeFiles[\s\S]+api\("\/api\/bridge-files"/);
  assert.match(app, /renderBridgeFileOptions[\s\S]+bridge-file-select[\s\S]+printFileChecksum/);
  assert.match(render, /create-approved[\s\S]+fileChecksum[\s\S]+items/);
  assert.match(render, /localFileChecksum\(product\) \|\| product\?\.printFileUrl/);
  assert.match(render, /fileAvailable === false[\s\S]+לא זמין כרגע/);
});

test('custom-plate suggestions gate same-checkout preselection on an exact color signature and keep manual planning explicit', () => {
  const render = require('node:fs').readFileSync(path.join(frontendRoot, 'js/render.js'), 'utf8');
  const html = require('node:fs').readFileSync(path.join(frontendRoot, 'dashboard.html'), 'utf8');

  assert.match(html, /id="custom-plate-suggestion"[\s\S]+hidden/);
  assert.match(render, /function orderColorSignature\(order\)[\s\S]+orderColorNames\(order\)[\s\S]+sort\(\)\.join/);
  assert.match(render, /const cartId = initialOrder\?\.cartId \?\? initialOrder\?\.cart_id[\s\S]+if \(!cartId \|\| !colorSignature\) return initialOrder \? \[initialOrder\] : \[\]/);
  assert.match(render, /\(order\.cartId \?\? order\.cart_id\) === cartId[\s\S]+orderColorSignature\(order\) === colorSignature/);
  assert.match(render, /const suggestedIds = new Set\(suggested\.map\(\(order\) => order\.id\)\)[\s\S]+isSuggested \? "checked" : ""/);
  assert.match(render, /suggestedPlateOrders\(order\)\.length > 1[\s\S]+needsCustomPlate[\s\S]+תכנן פלטה מותאמת[\s\S]+יש לסדר אותם ידנית על פלטה/);
  assert.match(render, /לא נמצאה הצעת קיבוץ בטוחה[\s\S]+אפשר לבחור פריטים ידנית/);
});
