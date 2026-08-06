const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function responseRecorder() {
  return {
    body: undefined,
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function loadHandler({ body, requireAdmin, sql }) {
  const handlerPath = require.resolve(path.join(root, 'api/settings.js'));
  const dbPath = require.resolve(path.join(root, 'api/_db.js'));
  const middlewarePath = require.resolve(path.join(root, 'api/_middleware.js'));
  const pricingPath = require.resolve(path.join(root, 'api/_pricing.js'));
  const replacements = new Map([
    [dbPath, { getSql: () => sql }],
    [middlewarePath, { parseBody: async () => body, requireAdmin }],
    [pricingPath, require(pricingPath)],
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

// T1: mocked handler behavior. The authorization branch is real and proves an
// anonymous project write cannot reach a persistence query.
test('anonymous project settings PUT is forbidden before persistence', async () => {
  let databaseCalls = 0;
  const handler = loadHandler({
    body: { status: 'busy' },
    requireAdmin: async (_req, res) => {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    },
    sql: () => {
      databaseCalls += 1;
      throw new Error('database must not be reached');
    },
  });
  const res = responseRecorder();

  await handler({ method: 'PUT', query: { key: 'project' } }, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden' });
  assert.equal(databaseCalls, 0);
});

test('admin project settings PUT sanitizes status, text, and update payloads before saving', async () => {
  let saved;
  const longStatus = `  ${'s'.repeat(305)}  `;
  const longLeadTime = `  ${'l'.repeat(105)}  `;
  const body = {
    status: 'not-a-project-status',
    statusMessage: longStatus,
    leadTime: longLeadTime,
    updates: Array.from({ length: 13 }, (_, index) => ({
      id: index === 0 ? '  update-1  ' : `update-${index + 1}`,
      title: index === 0 ? '  First public update  ' : `Update ${index + 1}`,
      body: index === 0 ? `  ${'b'.repeat(505)}  ` : 'Public progress',
      publishedAt: index === 0 ? 'invalid-date' : '2026-08-01',
      internalNotes: 'must not persist',
      memberOrders: [{ id: 'private-order' }],
    })),
    notes: 'must not persist',
  };
  const handler = loadHandler({
    body,
    requireAdmin: async () => ({ id: 'admin-1', role: 'admin' }),
    sql: async (strings, ...values) => {
      const query = strings.join(' ');
      assert.match(query, /INSERT INTO settings/);
      assert.equal(values[0], 'project');
      saved = JSON.parse(values[1]);
      return [];
    },
  });
  const res = responseRecorder();

  await handler({ method: 'PUT', query: { key: 'project' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, saved);
  assert.equal(saved.status, 'active');
  assert.equal(saved.statusMessage, 's'.repeat(300));
  assert.equal(saved.leadTime, 'l'.repeat(100));
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(saved.updates.length, 12);
  assert.deepEqual(saved.updates[0], {
    id: 'update-1',
    title: 'First public update',
    body: 'b'.repeat(500),
    publishedAt: new Date().toISOString().slice(0, 10),
  });
  assert.equal(saved.updates.some((update) => Object.hasOwn(update, 'internalNotes')), false);
  assert.equal(saved.updates.some((update) => Object.hasOwn(update, 'memberOrders')), false);
  assert.equal(Object.hasOwn(saved, 'notes'), false);
});
