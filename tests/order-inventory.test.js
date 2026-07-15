const assert = require('node:assert/strict');
const test = require('node:test');
const {
  completedUsage,
  mergeUsage,
  outstandingWaste,
} = require('../api/_order-inventory');
const fs = require('node:fs');
const path = require('node:path');

test('completed usage multiplies material and purge by quantity and merges filaments', () => {
  const usage = completedUsage({
    materials: [
      { filamentId: 'pla-red', grams: 12 },
      { filamentId: 'pla-red', grams: 3 },
      { filamentId: 'pla-blue', grams: 5 },
    ],
    purge_grams: 2,
  }, 2);
  assert.deepEqual(usage, [
    { filamentId: 'pla-red', grams: 34 },
    { filamentId: 'pla-blue', grams: 10 },
  ]);
});

test('waste accounting deducts only the cumulative outstanding delta', () => {
  assert.equal(outstandingWaste(18, 5), 13);
  assert.equal(outstandingWaste(18, 18), 0);
  assert.equal(outstandingWaste(12, 18), 0);
});

test('usage normalization ignores invalid entries', () => {
  assert.deepEqual(mergeUsage([
    { filamentId: '', grams: 5 },
    { filamentId: 'pla', grams: -2 },
    { filamentId: 'pla', grams: 4 },
  ]), [{ filamentId: 'pla', grams: 4 }]);
});

test('inventory SQL claims the order and deducts filaments in the same statement', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/_order-inventory.js'), 'utf8');
  assert.match(source, /jsonb_to_recordset/);
  assert.match(source, /filament_id: item\.filamentId/);
  assert.match(source, /WITH usage AS[\s\S]+eligible AS[\s\S]+claimed AS[\s\S]+UPDATE filaments/);
  assert.match(source, /WITH current_order AS[\s\S]+claimed AS[\s\S]+UPDATE filaments/);
});
