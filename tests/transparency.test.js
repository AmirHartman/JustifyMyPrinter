const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

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

function loadHandler(sql) {
  const handlerPath = require.resolve(path.join(root, 'api/transparency.js'));
  const dbPath = require.resolve(path.join(root, 'api/_db.js'));
  const previous = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getSql: () => sql } };
  delete require.cache[handlerPath];
  try {
    return require(handlerPath);
  } finally {
    delete require.cache[handlerPath];
    if (previous) require.cache[dbPath] = previous;
    else delete require.cache[dbPath];
  }
}

function assertPrivateFieldsAbsent(value) {
  const forbidden = new Set([
    'filamentPrice', 'pricePerKg', 'spoolPrice', 'spool_grams',
    'remainingGrams', 'remaining_grams', 'notes', 'internalNotes',
    'memberOrders', 'orders', 'personalPayments', 'payments',
    'ownerLedger', 'ledgerEntries', 'internalLedgerDetails',
  ]);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, `public transparency must omit ${key}`);
    assertPrivateFieldsAbsent(child);
  }
}

// T1: mocked handler behavior. The real endpoint DTO is exercised, while Neon
// results are fixtures so this does not claim database or browser coverage.
test('GET transparency returns public aggregates, project status, and material availability without private records', async () => {
  let summaryQuery = '';
  const sql = async (strings) => {
    const query = strings.join(' ');
    if (query.includes('total_profit')) {
      summaryQuery = query;
      return [{ total_profit: '275', reinvested: '80', completed_prints: '7', completed_this_month: '2' }];
    }
    if (query.includes('FROM goals')) {
      return [{ label: 'New nozzle', target_amount: '400', saved: '275', achieved_at: null, internal_notes: 'private' }];
    }
    if (query.includes('FROM owner_ledger')) {
      return [{ label: 'Publicly marked upgrade', amount: '80', occurred_at: '2026-08-01', internal_account: 'secret' }];
    }
    if (query.includes('FROM filaments')) {
      return [
        { name: 'Blue PLA', material_type: 'PLA', color_name: 'Blue', color_hex: '#123456', spool_grams: 1000, remaining_grams: 501, active: true, price_per_kg: 90, notes: 'private' },
        { name: 'Orange PETG', material_type: 'PETG', color_name: 'Orange', color_hex: '#ff8800', spool_grams: 1000, remaining_grams: 100, active: true, price_per_kg: 120 },
        { name: 'Empty PLA', material_type: 'PLA', color_name: 'Empty', color_hex: '#000000', spool_grams: 1000, remaining_grams: 0, active: true, price_per_kg: 70 },
      ];
    }
    if (query.includes("FROM settings WHERE key = 'project'")) {
      return [{ value: {
        status: 'busy',
        statusMessage: 'Current queue is full',
        leadTime: 'About one week',
        updatedAt: '2026-08-06T12:00:00.000Z',
        notes: 'Do not publish this',
        updates: [{ id: 'update-1', title: 'Printer maintenance', body: 'Back on Monday', publishedAt: '2026-08-05', internalNotes: 'private' }],
      } }];
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  const handler = loadHandler(sql);
  const res = responseRecorder();

  await handler({ method: 'GET' }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.equal(res.body.totalProfit, 275);
  assert.match(summaryQuery, /CEIL\(production_cost\)/);
  assert.match(summaryQuery, /internal = FALSE/);
  assert.match(summaryQuery, /production_cost IS NOT NULL/);
  assert.equal(res.body.reinvestedAmount, 80);
  assert.equal(res.body.completedPrints, 7);
  assert.equal(res.body.completedThisMonth, 2);
  assert.equal(res.body.availableMaterialCount, 2);
  assert.deepEqual(res.body.materials, [
    { materialType: 'PLA', colorName: 'Blue', colorHex: '#123456', availability: 'available' },
    { materialType: 'PETG', colorName: 'Orange', colorHex: '#ff8800', availability: 'limited' },
    { materialType: 'PLA', colorName: 'Empty', colorHex: '#000000', availability: 'unavailable' },
  ]);
  assert.deepEqual(res.body.project, {
    status: 'busy',
    statusMessage: 'Current queue is full',
    leadTime: 'About one week',
    updatedAt: '2026-08-06T12:00:00.000Z',
    updates: [{ id: 'update-1', title: 'Printer maintenance', body: 'Back on Monday', publishedAt: '2026-08-05' }],
  });
  assert.deepEqual(res.body.goals, [{
    label: 'New nozzle', targetAmount: 400, savedAmount: 275, saved: 275,
    currentAmount: 275, progressPercent: 68.75, achievedAt: null,
  }]);
  assert.deepEqual(res.body.investments, [{ label: 'Publicly marked upgrade', amount: 80, occurredAt: '2026-08-01' }]);
  assertPrivateFieldsAbsent(res.body);
});
