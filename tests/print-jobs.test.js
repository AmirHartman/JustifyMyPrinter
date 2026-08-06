const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(process.env.JMP_TEST_ROOT || path.join(__dirname, '..'));

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

// Loads api/print-jobs.js with its dependencies swapped for test doubles, using
// the same require.cache injection pattern as tests/catalog-auth.test.js.
function loadHandler({ admin = null, bridge = false, sql, finalize } = {}) {
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
    [require.resolve(path.join(root, 'api/_pricing.js')), {
      calculateProductCost: () => ({ productionCost: 5, shopPrice: 5, totalHours: 2, materialGrams: 20, marginPercent: 0 }),
    }],
    [require.resolve(path.join(root, 'api/_order-inventory.js')), {
      finalizeOrder: finalize ?? (async () => {}),
    }],
  ]);
  const previous = new Map();
  for (const [modulePath, exports] of replacements) {
    previous.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  }
  delete require.cache[handlerPath];
  try {
    return require(handlerPath);
  } finally {
    delete require.cache[handlerPath];
    for (const [modulePath, cached] of previous) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
}

test('creating a print job requires an admin session', async () => {
  const handler = loadHandler({ admin: null, sql: () => { throw new Error('db must not be reached'); } });
  const res = responseRecorder();
  await handler({ method: 'POST', query: {}, headers: {}, body: { productId: 'p1' } }, res);
  assert.equal(res.statusCode, 403);
});

test('bridge actions reject requests without the bridge secret before any db access', async () => {
  for (const [method, action] of [['POST', 'claim-next'], ['PUT', 'heartbeat'], ['PUT', 'report']]) {
    const handler = loadHandler({ bridge: false, sql: () => { throw new Error('db must not be reached'); } });
    const res = responseRecorder();
    await handler({ method, query: { action, id: 'job-1' }, headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 403, action);
  }
});

test('claim-next atomically returns a single job, or null when the queue is empty', async () => {
  const withQueue = loadHandler({
    bridge: true,
    sql: (strings) => {
      const q = strings.join(' ');
      if (/SKIP LOCKED/.test(q)) return Promise.resolve([{
        id: 'job-1', order_id: null, source: 'self', product_id: 'p1', quantity: 1,
        selected_colors: [], status: 'claimed', progress: 0, error_reason: '',
        claim_token: 'claim-1', print_file_url: 'https://res.cloudinary.com/x.3mf', created_at: 'now', updated_at: 'now',
      }]);
      return Promise.resolve([]); // reaper
    },
  });
  const res1 = responseRecorder();
  await withQueue({ method: 'POST', query: { action: 'claim-next' }, headers: {}, body: { bridgeId: 'pi' } }, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.job.id, 'job-1');
  assert.equal(res1.body.job.status, 'claimed');
  assert.equal(res1.body.job.claimToken, 'claim-1');

  const empty = loadHandler({ bridge: true, sql: () => Promise.resolve([]) });
  const res2 = responseRecorder();
  await empty({ method: 'POST', query: { action: 'claim-next' }, headers: {}, body: {} }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.job, null);
});

test('self-print terminal side effects are safe to retry after a duplicate done report', async () => {
  let finalizeCalls = 0;
  let inventoryApplications = 0;
  let inventoryFinalized = false;
  let jobTerminal = false;
  const doneJob = {
    id: 'job-1', order_id: 'order-1', source: 'self', product_id: 'p1', quantity: 1,
    selected_colors: [], status: 'done', progress: 100, error_reason: '',
    claim_token: 'claim-1', print_file_url: '', created_at: 'now', updated_at: 'now',
  };
  const sql = (strings) => {
    const q = strings.join(' ');
    if (/UPDATE print_jobs SET\s+status =/.test(q)) {
      if (jobTerminal) return Promise.resolve([]); // already terminal → guard blocks re-transition
      jobTerminal = true;
      return Promise.resolve([doneJob]);
    }
    if (/SELECT \* FROM print_jobs WHERE id =/.test(q)) return Promise.resolve([doneJob]);
    if (/FROM orders WHERE id =/.test(q)) return Promise.resolve([{
      id: 'order-1', internal: true, product_id: 'p1', quantity: 1,
      production_cost: 5, wasted_grams: 0, waste_deducted_grams: 0, inventory_deducted: false,
    }]);
    return Promise.resolve([]);
  };
  const handler = loadHandler({ bridge: true, sql, finalize: async () => {
    finalizeCalls += 1;
    if (!inventoryFinalized) {
      inventoryFinalized = true;
      inventoryApplications += 1;
    }
  } });

  const res1 = responseRecorder();
  await handler({ method: 'PUT', query: { action: 'report', id: 'job-1' }, headers: {}, body: { status: 'done', progress: 100, claimToken: 'claim-1' } }, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(finalizeCalls, 1);
  assert.equal(inventoryApplications, 1);

  const res2 = responseRecorder();
  await handler({ method: 'PUT', query: { action: 'report', id: 'job-1' }, headers: {}, body: { status: 'done', progress: 100, claimToken: 'claim-1' } }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(finalizeCalls, 2, 'duplicate reports may safely replay terminal side effects');
  assert.equal(inventoryApplications, 1, 'the idempotent inventory helper must not deduct twice');
});

test('customer-order done advances the order to ready_delivery without deducting inventory', async () => {
  let finalizeCalls = 0;
  const queries = [];
  const doneJob = {
    id: 'job-2', order_id: 'order-2', source: 'order', product_id: 'p1', quantity: 1,
    selected_colors: [], status: 'done', progress: 100, error_reason: '',
    claim_token: 'claim-2', print_file_url: '', created_at: 'now', updated_at: 'now',
  };
  const sql = (strings) => {
    const q = strings.join(' ');
    queries.push(q);
    if (/UPDATE print_jobs SET\s+status =/.test(q)) return Promise.resolve([doneJob]);
    if (/FROM orders WHERE id =/.test(q)) return Promise.resolve([{
      id: 'order-2', internal: false, product_id: 'p1', quantity: 1,
      production_cost: 12, wasted_grams: 0, waste_deducted_grams: 0, inventory_deducted: false,
    }]);
    return Promise.resolve([]);
  };
  const handler = loadHandler({ bridge: true, sql, finalize: async () => { finalizeCalls += 1; } });
  const res = responseRecorder();
  await handler({ method: 'PUT', query: { action: 'report', id: 'job-2' }, headers: {}, body: { status: 'done', claimToken: 'claim-2' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(finalizeCalls, 0, 'customer order must not deduct on print done');
  assert.ok(queries.some((q) => /status = 'ready_delivery'/.test(q)), 'order must advance to ready_delivery');
});

test('self-print create rejects a product with no sliced file', async () => {
  const handler = loadHandler({
    admin: { id: 'admin-1', name: 'amir' },
    sql: (strings) => {
      const q = strings.join(' ');
      if (/FROM products WHERE id =/.test(q)) return Promise.resolve([{ id: 'p1', name: 'x', print_file_url: '' }]);
      return Promise.resolve([]);
    },
  });
  const res = responseRecorder();
  await handler({ method: 'POST', query: {}, headers: {}, body: { productId: 'p1' } }, res);
  assert.equal(res.statusCode, 409);
});

test('self-print create makes an internal order and a job awaiting approval', async () => {
  const inserts = [];
  const handler = loadHandler({
    admin: { id: 'admin-1', name: 'amir' },
    sql: (strings) => {
      const q = strings.join(' ');
      if (/FROM products WHERE id =/.test(q)) return Promise.resolve([{
        id: 'p1', name: 'Widget', print_hours: 2, print_profile: 'regular', materials: [{ filamentId: 'f1', grams: 20 }],
        purge_grams: 1, print_file_url: 'https://res.cloudinary.com/x.3mf', print_file_name: 'x.3mf', print_file_checksum: 'abc',
      }]);
      if (/FROM filaments/.test(q)) return Promise.resolve([{ id: 'f1', name: 'black', price_per_kg: 80, spool_price: 80, spool_grams: 1000, remaining_grams: 500, active: true }]);
      if (/FROM settings WHERE key/.test(q)) return Promise.resolve([{ value: {} }]);
      if (/INSERT INTO orders/.test(q)) { inserts.push('order'); return Promise.resolve([]); }
      if (/INSERT INTO print_jobs/.test(q)) {
        inserts.push('job');
        return Promise.resolve([{
          id: 'job-9', order_id: 'order-9', source: 'self', product_id: 'p1', quantity: 1,
          selected_colors: [], status: 'awaiting_approval', progress: 0, error_reason: '', events: [],
          print_file_url: 'https://res.cloudinary.com/x.3mf', created_at: 'now', updated_at: 'now',
        }]);
      }
      return Promise.resolve([]);
    },
  });
  const res = responseRecorder();
  await handler({ method: 'POST', query: {}, headers: {}, body: { productId: 'p1', quantity: 1 } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.status, 'awaiting_approval', 'a new job must await manual approval, not auto-queue');
  assert.deepEqual(inserts, ['order', 'job'], 'must create the internal order before the job');
});

test('approve releases a pending job to the queue; a non-pending job is rejected', async () => {
  const okHandler = loadHandler({
    admin: { id: 'admin-1', name: 'amir' },
    sql: (strings) => {
      const q = strings.join(' ');
      if (/UPDATE print_jobs SET\s+status = 'queued'/.test(q)) return Promise.resolve([{
        id: 'job-1', order_id: 'o1', source: 'self', product_id: 'p1', quantity: 1,
        selected_colors: [], status: 'queued', progress: 0, error_reason: '', events: [],
        print_file_url: '', created_at: 'now', updated_at: 'now',
      }]);
      return Promise.resolve([]);
    },
  });
  const ok = responseRecorder();
  await okHandler({ method: 'PUT', query: { action: 'approve', id: 'job-1' }, headers: {}, body: {} }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.status, 'queued');

  // Guarded UPDATE returns nothing (already approved) but the job exists → 409.
  const conflictHandler = loadHandler({
    admin: { id: 'admin-1', name: 'amir' },
    sql: (strings) => {
      const q = strings.join(' ');
      if (/UPDATE print_jobs SET\s+status = 'queued'/.test(q)) return Promise.resolve([]);
      if (/SELECT id FROM print_jobs WHERE id =/.test(q)) return Promise.resolve([{ id: 'job-1' }]);
      return Promise.resolve([]);
    },
  });
  const conflict = responseRecorder();
  await conflictHandler({ method: 'PUT', query: { action: 'approve', id: 'job-1' }, headers: {}, body: {} }, conflict);
  assert.equal(conflict.statusCode, 409);
});

test('approve requires an admin session', async () => {
  const handler = loadHandler({ admin: null, sql: () => { throw new Error('db must not be reached'); } });
  const res = responseRecorder();
  await handler({ method: 'PUT', query: { action: 'approve', id: 'job-1' }, headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 403);
});
