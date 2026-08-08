const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const renderSource = fs.readFileSync(path.join(root, 'js/render.js'), 'utf8');

function sourceSection(startMarker, endMarker) {
  const start = renderSource.indexOf(startMarker);
  const end = renderSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return renderSource.slice(start, end);
}

test('catalog ordering targets the product action without overwriting gallery navigation', () => {
  const renderCatalog = sourceSection('function renderCatalog()', 'function normalizedProductImages(');
  const createImageGallery = sourceSection('function createImageGallery(', 'let lightboxGallery = null;');

  assert.match(
    renderCatalog,
    /const orderBtn = card\.querySelector\(["']\.product-meta \.primary-button["']\);/,
    'the order action must target the primary button inside product-meta',
  );
  assert.doesNotMatch(
    renderCatalog,
    /const orderBtn = card\.querySelector\(["']button["']\);/,
    'a generic button selector can capture a gallery navigation button',
  );

  assert.match(createImageGallery, /button\.textContent = glyph;/);
  assert.match(
    createImageGallery,
    /button\.addEventListener\(["']click["'],\s*\(\) => go\(dir === ["']prev["'] \? -1 : 1\)\);/,
  );
  assert.match(createImageGallery, /makeNav\(["']prev["'],\s*["']התמונה הקודמת["'],\s*["']›["']\)/);
  assert.match(createImageGallery, /makeNav\(["']next["'],\s*["']התמונה הבאה["'],\s*["']‹["']\)/);
});

test('public catalog cards and product detail dialog do not expose print time, material weight, or source file', () => {
  const renderCatalog = sourceSection('function renderCatalog()', 'function normalizedProductImages(');
  const openProductDetail = sourceSection('function openProductDetail(', '// ── Cart');

  for (const section of [renderCatalog, openProductDetail]) {
    assert.doesNotMatch(section, /product\.printHours/);
    assert.doesNotMatch(section, /product\.grams/);
    assert.doesNotMatch(section, /product\.sourceUrl/);
    assert.doesNotMatch(section, /product\.stlUrl/);
  }
});
