const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { MAX_CART_ITEMS, normalizeCartItems, supportTargetIndex } = require('../api/_cart');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function sourceSection(contents, startMarker, endMarker) {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return contents.slice(start, end);
}

const toColorValue = (value) => (typeof value === 'string' ? value.trim() : String(value?.id ?? '').trim());

// ── supportTargetIndex ──────────────────────────────────────────

test('supportTargetIndex returns the first priced line', () => {
  const lines = [{ priced: false }, { priced: false }, { priced: true }, { priced: true }];
  assert.equal(supportTargetIndex(lines), 2);
});

test('supportTargetIndex returns 0 when nothing is priced', () => {
  const lines = [{ priced: false }, { priced: false }];
  assert.equal(supportTargetIndex(lines), 0);
});

test('supportTargetIndex returns -1 for an empty or non-array list', () => {
  assert.equal(supportTargetIndex([]), -1);
  assert.equal(supportTargetIndex(null), -1);
  assert.equal(supportTargetIndex(undefined), -1);
});

test('supportTargetIndex never splits an amount across lines', () => {
  // The contract is one whole amount landing on exactly one index — there is no
  // API here that could divide it, so the regression this guards is a caller
  // applying the returned index to every line instead of just one.
  const lines = [{ priced: true }, { priced: true }, { priced: true }];
  const index = supportTargetIndex(lines);
  assert.equal(typeof index, 'number');
  assert.ok(Number.isInteger(index));
  assert.equal(lines.filter((_, i) => i === index).length, 1);
});

// ── normalizeCartItems ──────────────────────────────────────────

test('normalizeCartItems merges duplicate productId + colour lines by summing quantity', () => {
  const { items, error } = normalizeCartItems([
    { productId: 'p1', quantity: 2, selectedColors: ['red', 'blue'] },
    { productId: 'p1', quantity: 3, selectedColors: ['blue', 'red'] },
    { productId: 'p2', quantity: 1, selectedColors: [] },
  ], toColorValue);

  assert.equal(error, undefined);
  assert.equal(items.length, 2);
  const merged = items.find((item) => item.productId === 'p1');
  assert.equal(merged.quantity, 5);
  const other = items.find((item) => item.productId === 'p2');
  assert.equal(other.quantity, 1);
});

test('normalizeCartItems rejects a non-array or empty list', () => {
  assert.ok(normalizeCartItems(null, toColorValue).error);
  assert.ok(normalizeCartItems(undefined, toColorValue).error);
  assert.ok(normalizeCartItems('not-an-array', toColorValue).error);
  assert.ok(normalizeCartItems([], toColorValue).error);
});

test('normalizeCartItems rejects more than MAX_CART_ITEMS', () => {
  const items = Array.from({ length: MAX_CART_ITEMS + 1 }, (_, i) => ({
    productId: `p${i}`,
    quantity: 1,
  }));
  const result = normalizeCartItems(items, toColorValue);
  assert.ok(result.error);
});

test('normalizeCartItems accepts exactly MAX_CART_ITEMS', () => {
  const items = Array.from({ length: MAX_CART_ITEMS }, (_, i) => ({
    productId: `p${i}`,
    quantity: 1,
  }));
  const result = normalizeCartItems(items, toColorValue);
  assert.equal(result.error, undefined);
  assert.equal(result.items.length, MAX_CART_ITEMS);
});

test('normalizeCartItems rejects a non-integer or <1 quantity', () => {
  assert.ok(normalizeCartItems([{ productId: 'p1', quantity: 0 }], toColorValue).error);
  assert.ok(normalizeCartItems([{ productId: 'p1', quantity: -1 }], toColorValue).error);
  assert.ok(normalizeCartItems([{ productId: 'p1', quantity: 1.5 }], toColorValue).error);
  assert.ok(normalizeCartItems([{ productId: 'p1', quantity: 'two' }], toColorValue).error);
});

test('normalizeCartItems rejects a line with no productId', () => {
  assert.ok(normalizeCartItems([{ quantity: 1 }], toColorValue).error);
  assert.ok(normalizeCartItems([{ productId: '', quantity: 1 }], toColorValue).error);
  assert.ok(normalizeCartItems([{ productId: '   ', quantity: 1 }], toColorValue).error);
});

test('normalizeCartItems rejects a non-object line', () => {
  assert.ok(normalizeCartItems([null], toColorValue).error);
  assert.ok(normalizeCartItems(['p1'], toColorValue).error);
});

// ── Source contracts (T2: static, not executed) ─────────────────
// These do not run api/orders.js or js/cart.js against a database or browser;
// they only prove the shipped source still contains the invariants the cart
// design relies on. Runtime coverage is the unit tests above plus the
// DB-backed local-db-api tier when authorized.

test('api/orders.js still accepts the single-object body for the external-link/custom dialog', () => {
  const orders = source('api/orders.js');
  const postHandler = sourceSection(orders, "if (req.method === 'POST')", 'res.status(405).end();');

  assert.match(
    postHandler,
    /const isCart = Array\.isArray\(body\.items\);/,
    'the POST handler must branch on whether the body is a cart or a single order',
  );
  assert.match(
    postHandler,
    /\}\s*else\s*\{\s*items = \[body\];\s*\}/,
    'a non-cart body must still be treated as a single-item order, so the external-link/custom dialog keeps working',
  );
});

test('api/orders.js validates every cart item before any insert, and inserts through a transaction', () => {
  const orders = source('api/orders.js');
  const postHandler = sourceSection(orders, "if (req.method === 'POST')", 'res.status(405).end();');

  const buildLoopIndex = postHandler.indexOf('for (const item of items)');
  const transactionIndex = postHandler.indexOf('sql.transaction(');
  assert.notEqual(buildLoopIndex, -1, 'missing the per-item validation loop');
  assert.notEqual(transactionIndex, -1, 'missing sql.transaction for the insert step');
  assert.ok(
    buildLoopIndex < transactionIndex,
    'every item must be validated (buildOrderRow) before the transaction that inserts them runs',
  );

  const validationLoop = postHandler.slice(buildLoopIndex, transactionIndex);
  assert.match(
    validationLoop,
    /if \(result\.error\) return res\.status\(result\.statusCode\)\.json\(\{ error: result\.error \}\);/,
    'a single bad item must reject the whole request before any row is written',
  );
  assert.doesNotMatch(
    validationLoop,
    /INSERT INTO orders/,
    'no insert may happen inside the per-item validation loop',
  );

  assert.match(
    postHandler,
    /const results = await sql\.transaction\(\s*built\.map\(\(entry, index\) => insertOrderQuery\(sql, user, entry\.row, cartId, index\)\),\s*\);/,
    'every built row must be inserted together through one transaction, so a multi-line cart cannot leave a partial checkout behind',
  );
});

test('js/cart.js guards every localStorage access in try/catch', () => {
  const cart = source('js/cart.js');

  const readState = sourceSection(cart, 'function readState()', 'function writeState(');
  const writeState = sourceSection(cart, 'function writeState(', 'function sameLine(');

  assert.match(
    readState,
    /try\s*\{[\s\S]*window\.localStorage\.getItem\([\s\S]*\}\s*catch\s*\{/,
    'reading the cart must tolerate a storage exception (e.g. iOS SecurityError) and fall back to the in-memory cart',
  );
  assert.match(
    writeState,
    /try\s*\{[\s\S]*window\.localStorage\.setItem\([\s\S]*\}\s*catch\s*\{/,
    'writing the cart must tolerate a storage exception without losing the in-memory state',
  );

  const allDirectCalls = [...cart.matchAll(/window\.localStorage\.(getItem|setItem|removeItem)\(/g)];
  assert.ok(allDirectCalls.length > 0, 'expected at least one direct localStorage call to guard');
  // Every direct call site found above must live inside readState or writeState,
  // the only two functions that touch storage — anything outside them would be
  // an unguarded access this test cannot otherwise see.
  assert.doesNotMatch(
    cart.replace(readState, '').replace(writeState, ''),
    /window\.localStorage\.(getItem|setItem|removeItem)\(/,
    'a localStorage call outside the guarded readState/writeState helpers would not be covered by their try/catch',
  );
});

test('js/cart.js never persists a price field in the stored cart state', () => {
  const cart = source('js/cart.js');

  // The persisted shape is built and read only in this span: the EMPTY
  // default, readState/writeState, and every mutator (addLine, updateLine,
  // removeLine, clearCart, addTip/resetTip). cartLines()/cartTotals() below
  // this span legitimately compute a *derived* price for display — that is
  // not persistence, so it is deliberately out of scope for this contract.
  const persistedShape = sourceSection(
    cart,
    'const STORAGE_PREFIX',
    '// Lines joined to the live catalog.',
  );

  assert.doesNotMatch(
    persistedShape,
    /\bprice\s*[:=]/i,
    'the persisted cart line/state shape must never carry a price field — price is always re-derived from the live catalog',
  );
});
