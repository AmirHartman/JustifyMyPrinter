const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { checkRegressions } = require('../scripts/lib/regression-checks');

const root = path.resolve(__dirname, '..');

test('R1-R9 pass against the repository', () => {
  const failed = checkRegressions(root).filter((check) => !check.passed);
  assert.deepEqual(failed, []);
});

test('a virtual category regression fails R3 without changing the worktree', () => {
  const render = fs.readFileSync(path.join(root, 'js/render.js'), 'utf8');
  const checks = checkRegressions(root, {
    'js/render.js': `${render}\nconst newSpoolBtn = f.id;\n`,
  });
  assert.equal(checks.find((check) => check.id === 'R3').passed, false);
});
