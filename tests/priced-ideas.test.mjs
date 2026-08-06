import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The pricing kernel exists twice — CommonJS on the server, an ES module in the
// browser — so this file is .mjs: it is the only way to load both and compare
// them for real instead of regex-matching their sources.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const server = require(path.join(root, 'api/_pricing.js'));
const client = await import(path.join(root, 'js/utils.js'));

const FILAMENTS = [
  { id: 'fil-1', name: 'PLA Black', pricePerKg: 80, spoolPrice: 80, spoolGrams: 1000, active: true, remainingGrams: 900 },
];
const SETTINGS = {
  marginPercent: 0.5,
  minOrderPrice: 5,
  riskPercentByLevel: { low: 0.08, medium: 0.15, high: 0.25, untested: 0.35 },
};
const PRINTABLE = { printHours: 4, printProfile: 'regular', materials: [{ filamentId: 'fil-1', grams: 120 }], purgeGrams: 0 };

// The client kernel needs the file constants the server merges in from
// config/pricing.json; the server reads them itself.
const clientSettings = { ...require(path.join(root, 'config/pricing.json')), ...SETTINGS };

function responseRecorder() {
  return {
    body: undefined,
    statusCode: 200,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

// This is deliberately a small CommonJS loader rather than an integration DB:
// the regression is the handler's ordering and merge contract, not Neon.
function loadSettingsHandler({ body, sql, editableSettings }) {
  const handlerPath = require.resolve(path.join(root, 'api/settings.js'));
  const dbPath = require.resolve(path.join(root, 'api/_db.js'));
  const middlewarePath = require.resolve(path.join(root, 'api/_middleware.js'));
  const pricingPath = require.resolve(path.join(root, 'api/_pricing.js'));
  const pricing = require(pricingPath);
  const replacements = new Map([
    [dbPath, { getSql: () => sql }],
    [middlewarePath, {
      parseBody: async () => body,
      requireAdmin: async () => ({ id: 'admin-1', role: 'admin' }),
    }],
    [pricingPath, { ...pricing, editableSettings }],
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

test('an untested model is priced at the untested tier, whatever level it carries', () => {
  const idea = server.calculateProductCost({ ...PRINTABLE, riskLevel: 'low', catalogKind: 'idea' }, FILAMENTS, SETTINGS);
  const printed = server.calculateProductCost({ ...PRINTABLE, riskLevel: 'low', catalogKind: 'printed' }, FILAMENTS, SETTINGS);

  assert.equal(idea.riskTier, 'untested');
  assert.equal(idea.riskPercent, 0.35);
  assert.equal(printed.riskTier, 'low');
  assert.equal(printed.riskPercent, 0.08);
  assert.ok(idea.shopPrice > printed.shopPrice, 'the untested surcharge must raise the price');
});

test('a stored risk_percent cannot dodge the untested tier', () => {
  // riskLevel absent is the branch where a raw risk_percent used to win.
  const idea = server.calculateProductCost(
    { ...PRINTABLE, riskLevel: undefined, riskPercent: 0.01, catalogKind: 'idea' }, FILAMENTS, SETTINGS,
  );
  assert.equal(idea.riskPercent, 0.35);
});

test('effectiveRiskTier falls back to medium for an unknown level', () => {
  assert.equal(server.effectiveRiskTier({ catalogKind: 'printed', riskLevel: 'nonsense' }), 'medium');
  assert.equal(server.effectiveRiskTier({ catalogKind: 'idea', riskLevel: 'high' }), 'untested');
  assert.equal(client.effectiveRiskTier({ catalogKind: 'idea', riskLevel: 'high' }), 'untested');
});

test('hasPrintData accepts only a product a print can actually be costed from', () => {
  for (const impl of [server.hasPrintData, client.hasPrintData]) {
    assert.equal(impl(PRINTABLE), true);
    assert.equal(impl({ ...PRINTABLE, printHours: 0 }), false);
    assert.equal(impl({ ...PRINTABLE, materials: [] }), false);
    assert.equal(impl({ ...PRINTABLE, materials: [{ filamentId: 'fil-1', grams: 0 }] }), false);
    assert.equal(impl({ ...PRINTABLE, materials: [{ grams: 10 }] }), false);
    // cost is deliberately ignored: the server floors it at minOrderPrice, so a
    // cost check would pass for an entirely empty product.
    assert.equal(impl({ printHours: 0, materials: [], cost: 99 }), false);
  }
});

test('both pricing kernels agree, tier by tier', () => {
  const cases = [
    { ...PRINTABLE, riskLevel: 'low', catalogKind: 'printed' },
    { ...PRINTABLE, riskLevel: 'high', catalogKind: 'printed' },
    { ...PRINTABLE, riskLevel: 'low', catalogKind: 'idea' },
    { ...PRINTABLE, riskLevel: undefined, riskPercent: 0.4, catalogKind: 'printed' },
    { ...PRINTABLE, riskLevel: undefined, riskPercent: 0.4, catalogKind: 'idea' },
    { ...PRINTABLE, printProfile: 'ams', riskLevel: 'medium', catalogKind: 'idea', purgeGrams: 30 },
  ];
  for (const product of cases) {
    const a = server.calculateProductCost(product, FILAMENTS, SETTINGS, { quantity: 2 });
    const b = client.calculateProductCost(product, FILAMENTS, clientSettings, { quantity: 2 });
    const label = `${product.catalogKind}/${product.riskLevel ?? 'no-level'}/${product.printProfile}`;
    assert.equal(b.riskTier, a.riskTier, `riskTier drifted for ${label}`);
    assert.equal(b.riskPercent, a.riskPercent, `riskPercent drifted for ${label}`);
    assert.equal(b.shopPrice, a.shopPrice, `shopPrice drifted for ${label}`);
  }
});

// T1: mocked handler behavior. The PUT form changes only the editable pricing
// fields; maintenance data must survive the round trip from the stored row.
test('pricing settings PUT loads stored settings before preserving them through editableSettings', async () => {
  const stored = {
    value: {
      marginPercent: 0.2,
      minOrderPrice: 7,
      riskPercentByLevel: { low: 0.02, medium: 0.03, high: 0.04, untested: 0.05 },
      wearParts: [{ id: 'custom-nozzle', lifetimeHours: 333, priceIls: 111 }],
      maintenanceTasks: [{ id: 'custom-clean', everyHours: 12 }],
    },
  };
  const calls = [];
  const editableInputs = [];
  let inserted;
  const sql = async (strings, ...values) => {
    const query = strings.join(' ');
    calls.push(query);
    if (/SELECT value FROM settings/.test(query)) return [stored];
    if (/INSERT INTO settings/.test(query)) {
      inserted = JSON.parse(values[1]);
      return [];
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  const pricing = require(path.join(root, 'api/_pricing.js'));
  const handler = loadSettingsHandler({
    body: {
      marginPercent: 0.6,
      minOrderPrice: 13,
      riskPercentByLevel: { low: 0.11, medium: 0.22, high: 0.33, untested: 0.44 },
    },
    sql,
    editableSettings(value) {
      editableInputs.push({ value, queriesBeforeCall: calls.length });
      return pricing.editableSettings(value);
    },
  });
  const res = responseRecorder();

  await handler({ method: 'PUT', query: { key: 'pricing' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.filter((query) => /SELECT value FROM settings/.test(query)).length, 1);
  assert.equal(editableInputs.length, 1);
  assert.equal(editableInputs[0].queriesBeforeCall, 1, 'the stored settings must load before editableSettings');
  assert.deepEqual(editableInputs[0].value, {
    ...stored.value,
    marginPercent: 0.6,
    minOrderPrice: 13,
    riskPercentByLevel: { low: 0.11, medium: 0.22, high: 0.33, untested: 0.44 },
  });
  assert.deepEqual(inserted.wearParts, stored.value.wearParts);
  assert.deepEqual(inserted.maintenanceTasks, stored.value.maintenanceTasks);
});

// ── Source contracts (T2) ─────────────────────────────────────
// The coercion lives inside calculateProductCost, so it is a no-op at any call
// site that builds its own product object without the catalog kind.
test('every pricing call site passes the catalog kind through', () => {
  const sources = {
    'api/orders.js': readFileSync(path.join(root, 'api/orders.js'), 'utf8'),
    'api/print-jobs.js': readFileSync(path.join(root, 'api/print-jobs.js'), 'utf8'),
    'js/app.js': readFileSync(path.join(root, 'js/app.js'), 'utf8'),
  };
  assert.match(sources['api/orders.js'], /catalogKind: product\.catalog_kind/);
  assert.match(sources['api/print-jobs.js'], /catalogKind: product\.catalog_kind/);
  // computedCostFromForm and updateCostPreview both feed the admin preview.
  assert.equal((sources['js/app.js'].match(/catalogKind:\s*(document\.querySelector\("#product-form \[name='catalogKind'\]"\)|productForm\?\.elements\["catalogKind"\])/g) || []).length, 2);
});

test('idea readiness stays relaxed so a dataless idea remains publishable', () => {
  const source = readFileSync(path.join(root, 'api/products.js'), 'utf8');
  // Removing this guard would drop every idea without print data out of the
  // public catalog, which is the visibility invariant in AGENTS.md.
  assert.match(source, /catalogKind === 'printed' && !hasPrintData\(product\)/);
  assert.doesNotMatch(source, /missing\.push\('price'\)/);
});

test('cart imports isUntested before it calls it for priced model status', () => {
  const source = readFileSync(path.join(root, 'js/cart.js'), 'utf8');
  assert.match(source, /\bisUntested\s*\(/);
  assert.match(source, /import\s*\{[^}]*\bisUntested\b[^}]*\}\s*from\s*["']\.\/utils\.js["']/);
});

test('priced untested orders skip customer approval in both admin promotion paths', () => {
  const source = readFileSync(path.join(root, 'js/render.js'), 'utf8');
  // A priced idea still begins at "new" for first-print review, but its catalog
  // price was accepted at checkout and therefore must go straight to printing.
  assert.match(
    source,
    /function nextOrderStatus\(order\)\s*\{[\s\S]*?if \(status === "new" && !order\.requiresUserPriceApproval\) return "waiting_print";/,
  );
  // The order card and the new-orders queue must both provide the order that
  // carries requiresUserPriceApproval; omitting it silently restores the old
  // new -> waiting_approval transition.
  assert.match(source, /const next = nextOrderStatus\(order\);/);
  assert.match(source, /setOrderStatus\(order, nextOrderStatus\(order\)\)/);
});
