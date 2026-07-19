const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function sourceSection(contents, startMarker, endMarker) {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return contents.slice(start, end);
}

test('T2: renderCatalog tolerates blocked sessionStorage while reading reorder state', () => {
  const render = source('js/render.js');
  const readPendingReorder = sourceSection(
    render,
    'function readAndClearPendingReorder()',
    'function savePendingReorder(',
  );
  const renderCatalog = sourceSection(
    render,
    'function renderCatalog()',
    'function normalizedProductImages(',
  );

  assert.match(
    readPendingReorder,
    /try\s*\{[\s\S]*sessionStorage\.getItem\(["']pendingReorder["']\)[\s\S]*sessionStorage\.removeItem\(["']pendingReorder["']\)[\s\S]*\}\s*catch\s*\{\s*return null;/,
    'both read and clear operations must be contained by the storage guard',
  );
  assert.match(renderCatalog, /const pendingReorder = readAndClearPendingReorder\(\);/);
  assert.doesNotMatch(
    renderCatalog,
    /sessionStorage\./,
    'renderCatalog must not directly access storage outside the guarded helper',
  );
});

test('T2: order creation failure reporting is separate from post-success rendering', () => {
  const app = source('js/app.js');
  const orderSubmit = sourceSection(
    app,
    'orderForm?.addEventListener("submit", async (event) => {',
    '// ── Custom / external-link order dialog',
  );

  assert.match(
    orderSubmit,
    /let order;\s*try\s*\{[\s\S]*order = await api\(["']\/api\/orders["'][\s\S]*\}\s*catch \(err\) \{\s*alert\(`שגיאה ביצירת הזמנה: \$\{err\.message\}`\);\s*return;\s*\}/,
    'only a failed order API request may show the order-creation error',
  );
  assert.match(
    orderSubmit,
    /\}\s*\n\s*if \(store\.appMode === ["']admin["']\) store\.orders\.unshift\(order\);\s*else store\.myOrders\.unshift\(order\);\s*goToStep\(["']thanks["']\);\s*try \{\s*render\(\);\s*\} catch \(err\) \{[\s\S]*console\.error\(["']Order created, but the UI refresh failed:["'], err\);/,
    'after a successful API response, render failures must be handled without reusing the creation-error path',
  );
});
