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

test('T2: cart checkout failure reporting is separate from post-success rendering, and the button locks in flight', () => {
  // The single-order submit this test used to protect no longer exists: the
  // product dialog only calls addLine() (see the adjoining "nothing is ordered
  // here" comment above orderForm's submit handler) and the API call moved to
  // the cart page's checkout button. The invariant — a failed request reports
  // an error, and a post-success render failure is never mistaken for a failed
  // order — now lives there, plus a new one: the button must not be clickable
  // twice while the request is in flight (task T3's concern for this flow).
  const app = source('js/app.js');
  assert.doesNotMatch(
    sourceSection(app, 'orderForm?.addEventListener("submit"', '// ── Cart page'),
    /await api\(/,
    'the product dialog must only queue a local cart line, never call the API directly',
  );

  const checkout = sourceSection(
    app,
    'document.querySelector("#checkout-button")?.addEventListener("click", async (event) => {',
    '// ── Custom / external-link order dialog',
  );

  assert.match(
    checkout,
    /button\.disabled = true;[\s\S]*button\.textContent = ["']שולח…["'];/,
    'the checkout button must be disabled before the request is sent, so a repeated click cannot double-submit the cart',
  );
  assert.match(
    checkout,
    /let orders;\s*try\s*\{[\s\S]*orders = await api\(["']\/api\/orders["'][\s\S]*\}\s*catch \(err\) \{\s*if \(errorBox\) \{[\s\S]*errorBox\.classList\.add\(["']is-visible["']\);\s*\}\s*button\.disabled = false;\s*button\.textContent = originalLabel;\s*return;\s*\}/,
    'only a failed checkout API request may show the cart error, and it must restore the button so the friend can retry',
  );
  assert.doesNotMatch(
    checkout,
    /alert\(/,
    'checkout failures must use the inline cart error box, not the legacy alert-based reporting',
  );

  const afterSuccess = checkout.slice(checkout.indexOf('clearCart();'));
  assert.match(
    afterSuccess,
    /clearCart\(\);\s*store\.myOrders\.unshift\(\.\.\.orders\);/,
    'the cart must only be cleared and the orders recorded after a successful API response',
  );
  assert.match(
    afterSuccess,
    /try \{\s*render\(\);\s*\} catch \(err\) \{[\s\S]*console\.error\(["']Cart checked out, but the UI refresh failed:["'], err\);/,
    'after a successful checkout, render failures must be handled without reusing the checkout-error path',
  );
  assert.doesNotMatch(
    afterSuccess,
    /errorBox/,
    'a post-success render failure must never be surfaced through the cart error box, which would look like the checkout itself failed',
  );
});
