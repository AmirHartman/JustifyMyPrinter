const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function loadFreshState(api) {
  const stateSource = source('js/state.js').replace(
    'import { api } from "./api.js";',
    'const { api } = globalThis.__jmpDashboardPartialLoadTest;',
  );
  globalThis.__jmpDashboardPartialLoadTest = { api };
  return import(`data:text/javascript;base64,${Buffer.from(stateSource).toString('base64')}#${Date.now()}-${Math.random()}`);
}

test('admin loadData preserves successful products and users when orders and bridge data fail independently', async () => {
  const calls = [];
  const api = async (endpoint) => {
    calls.push(endpoint);
    if (endpoint === '/api/products') return [{ id: 'product-1', name: 'Visible product' }];
    if (endpoint === '/api/users') return [{ id: 'user-1', name: 'Visible user' }];
    if (endpoint === '/api/orders' || endpoint === '/api/bridge-files') throw new Error(`failed: ${endpoint}`);
    if (endpoint.includes('settings') || endpoint === '/api/insights' || endpoint === '/api/printer') return null;
    return [];
  };
  const oldWarn = console.warn;
  const oldDocument = globalThis.document;
  console.warn = () => {};
  globalThis.document = { body: { dataset: { page: 'app' } } };
  try {
    const { store, loadData } = await loadFreshState(api);
    store.appMode = 'admin';
    store.currentUser = { id: 'admin', role: 'admin' };
    await loadData();

    assert.deepEqual(store.products, [{ id: 'product-1', name: 'Visible product' }]);
    assert.deepEqual(store.users, [{ id: 'user-1', name: 'Visible user' }]);
    assert.deepEqual(store.orders, []);
    assert.deepEqual(store.bridgeFiles, []);
    assert.equal(store.bridge, null);
    assert.deepEqual(store.dataLoadFailures, ['הזמנות', 'קובצי הגשר']);
    assert.equal(new Set(store.dataLoadFailures).size, store.dataLoadFailures.length);
    assert.ok(calls.includes('/api/products') && calls.includes('/api/users'));
  } finally {
    console.warn = oldWarn;
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    delete globalThis.__jmpDashboardPartialLoadTest;
  }
});

test('partial-load labels stay deduplicated and bounded, while the dashboard exposes an accessible Hebrew warning', () => {
  const state = source('js/state.js');
  const render = source('js/render.js');
  const html = source('dashboard.html');
  const labels = [...state.matchAll(/safe\("([^"]+)"/g)].map((match) => match[1]);

  assert.ok(labels.length > 0 && labels.length <= 17, 'the fixed endpoint list bounds user-visible failure labels');
  assert.equal(new Set(labels).size, labels.length, 'endpoint labels must not duplicate before rendering');
  assert.match(state, /const failures = \[\];[\s\S]+failures\.push\(label\)[\s\S]+dataLoadFailures = \[\.\.\.new Set\(failures\)\]/);
  assert.match(html, /id="data-load-warning"[^>]*role="alert"[^>]*hidden/);
  assert.match(render, /function renderDataLoadWarning\(\)[\s\S]+warning\.hidden = failures\.length === 0[\s\S]+חלק מהמידע לא נטען כרגע:[\s\S]+הנתונים הזמינים מוצגים כרגיל/);
  assert.match(render, /function render\(\)[\s\S]+renderDataLoadWarning\(\)/);
});
