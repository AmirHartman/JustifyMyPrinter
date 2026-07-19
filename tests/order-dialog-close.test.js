const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('order dialog X hookup is scoped past unrelated catalog close buttons', () => {
  const catalog = source('catalog.html');
  const app = source('js/app.js');
  const orderDialogStart = catalog.indexOf('<dialog id="order-dialog">');
  const firstCloseButton = catalog.indexOf('close-button');

  assert.notEqual(orderDialogStart, -1, 'catalog must contain the order dialog');
  assert.notEqual(firstCloseButton, -1, 'catalog must contain a close button');
  assert.ok(
    firstCloseButton < orderDialogStart,
    'fixture must keep an unrelated close button before the order dialog',
  );

  assert.match(
    app,
    /orderDialog\?\.querySelector\(["']\.close-button["']\)\?\.addEventListener\(["']click["'],\s*\(\)\s*=>\s*orderDialog\.close\(\)\)/,
    'the order X listener must be found within orderDialog',
  );
  assert.doesNotMatch(
    app,
    /document\.querySelector\(["']\.close-button["']\)\?\.addEventListener\(["']click["'],\s*\(\)\s*=>\s*orderDialog\?\.close\(\)\)/,
    'a document-wide selector would bind the first unrelated catalog close button',
  );
});
