const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const renderSource = fs.readFileSync(path.join(root, 'js/render.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const catalogSource = fs.readFileSync(path.join(root, 'catalog.html'), 'utf8');

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

// T2 source contracts only: these assertions lock the shipped URL, filtering,
// DOM, and event-listener shape. They do not execute the catalog in a browser.

test('an empty catalog hash keeps the category picker visible and category choices use the c hash key', () => {
  const selectedCategory = sourceSection(renderSource, 'function selectedCategoryId()', 'function selectCategory(');
  const selectCategory = sourceSection(renderSource, 'function selectCategory(', 'function clearCategoryHash(');
  const renderCatalog = sourceSection(renderSource, 'function renderCatalog()', 'function normalizedProductImages(');

  assert.match(
    selectedCategory,
    /new URLSearchParams\(location\.hash\.replace\(\/\^#\/, ["']{2}\)\)\.get\(["']c["']\)/,
    'the catalog selection must be read from the c hash parameter',
  );
  assert.match(selectCategory, /location\.hash = id \? `c=\$\{encodeURIComponent\(id\)\}` : ["']{2};/);
  assert.match(
    renderCatalog,
    /const showCategoryPicker = !useUncategorizedFallback && selectedId === null;/,
    'no category selection must show the picker while pickable categories exist',
  );
  assert.match(renderCatalog, /const visibleProducts = showCategoryPicker\s*\? \[\]/);
});

test('the all-categories hash and a selected category id retain distinct catalog views', () => {
  const renderCatalog = sourceSection(renderSource, 'function renderCatalog()', 'function normalizedProductImages(');

  assert.match(renderSource, /const ALL_CATEGORIES = ["']all["'];/);
  assert.match(
    renderCatalog,
    /selectedId === ALL_CATEGORIES\s*\? catalogProducts\s*:\s*catalogProducts\.filter\(\(product\) => product\.categoryIds\?\.includes\(selectedId\)\)/,
    '#c=all must show all category-backed catalog products while a category id shows only its matching products',
  );
});

test('catalog products require overlap with an active category', () => {
  const renderCatalog = sourceSection(renderSource, 'function renderCatalog()', 'function normalizedProductImages(');

  assert.match(renderCatalog, /const activeCategories = store\.categories\.filter\(\(category\) => category\.active !== false\);/);
  assert.match(renderCatalog, /const activeCategoryIds = new Set\(activeCategories\.map\(\(category\) => category\.id\)\);/);
  assert.match(
    renderCatalog,
    /const catalogProducts = eligibleProducts\.filter\(\(product\) =>\s*product\.categoryIds\?\.some\(\(id\) => activeCategoryIds\.has\(id\)\)\);/,
    'a product with no active category overlap must not become a category-backed catalog product',
  );
});

test('invalid hashes are removed and a zero-pickable catalog falls back to eligible products', () => {
  const renderCatalog = sourceSection(renderSource, 'function renderCatalog()', 'function normalizedProductImages(');

  assert.match(renderCatalog, /const useUncategorizedFallback = pickableCategories\.length === 0;/);
  assert.match(
    renderCatalog,
    /const invalidSelection = selectedId !== null\s*&& selectedId !== ALL_CATEGORIES\s*&& !pickableCategories\.some\(\(category\) => category\.id === selectedId\);/,
  );
  assert.match(
    renderCatalog,
    /if \(invalidSelection \|\| unrelatedHash \|\| \(useUncategorizedFallback && location\.hash\)\) \{\s*clearCategoryHash\(\);\s*selectedId = null;\s*\}/,
    'invalid or unrelated hashes must be cleaned up before rendering',
  );
  assert.match(renderCatalog, /useUncategorizedFallback\s*\? eligibleProducts/);
});

test('catalog markup places the picker and back action before product sections', () => {
  const picker = catalogSource.indexOf('id="category-picker-section"');
  const back = catalogSource.indexOf('id="category-back"');
  const printedProducts = catalogSource.indexOf('id="printed-products-section"');
  const ideaProducts = catalogSource.indexOf('id="idea-products-section"');

  assert.ok(picker >= 0, 'catalog must contain the category picker section');
  assert.ok(back >= 0, 'catalog must contain the category back button');
  assert.ok(printedProducts >= 0, 'catalog must contain the printed products section');
  assert.ok(ideaProducts >= 0, 'catalog must contain the idea products section');
  assert.ok(picker < back && back < printedProducts && printedProducts < ideaProducts);
});

test('catalog hash navigation rerenders the catalog', () => {
  const hashchangeHandler = sourceSection(appSource, 'window.addEventListener("hashchange"', '});\n');

  assert.match(hashchangeHandler, /if \(pageName === ["']catalog["']\) \{\s*render\(\);\s*\}/);
});
