const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DEFINITIONS, checkRegressions } = require('../scripts/lib/regression-checks');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('R1-R10 pass against the repository with honest T2 metadata', () => {
  const checks = checkRegressions(root);
  assert.deepEqual(checks.map((check) => check.id), DEFINITIONS.map((definition) => definition.id));
  assert.equal(checks.length, 10);
  assert.deepEqual(checks.filter((check) => !check.passed), []);
  for (const check of checks) {
    assert.equal(check.tier, 'T2');
    assert.ok(check.requiredFiles.length > 0);
    assert.deepEqual(check.missingFiles, []);
    assert.match(check.doesNotProve, /Runtime|database|browser/i);
  }
});

const negativeFixtures = {
  R1: { 'api/orders.js': `${source('api/orders.js')}\nconst customText = true;\n` },
  R2: { 'api/init.js': '' },
  R3: { 'js/render.js': `${source('js/render.js')}\nconst newSpoolBtn = f.id;\n` },
  R4: { 'api/_init-auth.js': '' },
  R5: { 'js/app.js': '' },
  R6: { 'js/app.js': '' },
  R7: { 'js/render.js': '' },
  R8: { 'api/orders.js': '' },
  R9: { 'api/init.js': '' },
  R10: { 'api/products.js': '' },
};

for (const [id, overrides] of Object.entries(negativeFixtures)) {
  test(`${id} fails its negative sensitivity fixture`, () => {
    const check = checkRegressions(root, overrides).find((candidate) => candidate.id === id);
    assert.equal(check.passed, false);
    assert.deepEqual(check.missingFiles, []);
  });
}

test('all regressions fail honestly when required source files are absent', () => {
  const missingRoot = path.join(root, '.definitely-missing-regression-fixture');
  const checks = checkRegressions(missingRoot);
  assert.equal(checks.every((check) => !check.passed), true);
  assert.equal(checks.every((check) => check.missingFiles.length > 0), true);
});
