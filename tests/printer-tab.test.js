const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// The printer panel used to live inside the orders view. Keeping it there mixes
// printer operations with order/money management, so its placement is pinned.
test('the print jobs panel lives in the printer view, not the orders view', () => {
  const dashboard = source('dashboard.html');

  const ordersStart  = dashboard.indexOf('id="orders-view"');
  const printerStart = dashboard.indexOf('id="printer-view"');
  const panel        = dashboard.indexOf('id="print-jobs-panel"');
  const queue        = dashboard.indexOf('id="print-queue-panel"');

  assert.notEqual(ordersStart, -1, 'dashboard must contain the orders view');
  assert.notEqual(printerStart, -1, 'dashboard must contain the printer view');
  assert.ok(ordersStart < printerStart, 'the printer view must follow the orders view');
  assert.ok(panel > printerStart, 'the print jobs panel must sit inside the printer view');
  assert.ok(queue > printerStart, 'the print queue must sit inside the printer view');
});

test('the printer view is a routable admin view with a nav link and badge', () => {
  const auth = source('js/auth.js');
  const dashboard = source('dashboard.html');
  const render = source('js/render.js');

  assert.match(
    auth,
    /const ADMIN_VIEWS = \[[^\]]*"printer"/,
    'ADMIN_VIEWS must include "printer" or #printer would fall back to the overview',
  );
  assert.match(
    dashboard,
    /admin-nav-link[^>]*href="dashboard\.html#printer"[^>]*data-view="printer"/,
    'the admin menu must link to the printer view',
  );
  assert.ok(
    dashboard.includes('id="print-jobs-badge"'),
    'the printer nav link must carry the awaiting-approval badge element',
  );
  assert.match(
    render,
    /printJobs:\s*\["print-jobs-badge"\]/,
    'the badge element must be wired to the printJobs notification category',
  );
});

test('the print queue renders waiting_print orders and is repainted on every render', () => {
  const render = source('js/render.js');

  assert.match(render, /function renderPrintQueue\(\)/, 'renderPrintQueue must exist');
  assert.match(
    render,
    /store\.orders\.filter\(\(order\) => order\.status === "waiting_print"\)/,
    'the queue must be driven by orders waiting to print',
  );
  assert.match(
    render,
    /renderPrintJobs\(\);\s*\n\s*renderPrintQueue\(\);/,
    'render() must repaint the queue alongside the job list',
  );
});

// "Partially ready" is derived from the per-product statuses. A stored boolean
// flag would be a second source of truth that could drift from the status. The
// bridge's printed_quantity counter is different: it records partial plate
// fulfilment and is intentionally allowed.
test('printed state is derived from order status, not a stored flag', () => {
  const render = source('js/render.js');
  const init = source('api/init.js');

  assert.match(
    render,
    /const PRINTED_STATUSES = new Set\(\["waiting_assembly", "ready_delivery", "completed"\]\)/,
    'PRINTED_STATUSES must define which statuses count as printed',
  );
  assert.match(render, /function groupReadiness\(/, 'group readiness must be computed from the lines');
  assert.match(render, /מוכן חלקית/, 'a partially ready group must say so in Hebrew');
  assert.doesNotMatch(
    init,
    /orders ADD COLUMN IF NOT EXISTS printed\s+BOOLEAN/,
    'no naive printed boolean may be added to orders',
  );
});

test('the orders tab groups by friend and opens on open orders', () => {
  const render = source('js/render.js');
  const dashboard = source('dashboard.html');

  assert.match(render, /function buildCustomerOrderGroup\(/, 'orders must be grouped per customer');
  assert.match(render, /function orderGroupKey\(/, 'the grouping key must resolve the user behind an order');
  assert.match(
    render,
    /let orderStatusFilter = "open"/,
    'the orders tab must default to open orders',
  );
  assert.match(
    dashboard,
    /class="filter-chip is-active" data-filter="open"/,
    'the open chip must be the active one on load',
  );
  assert.doesNotMatch(
    dashboard,
    /class="filter-chip is-active" data-filter="all"/,
    'the all chip must no longer be the default',
  );
});
