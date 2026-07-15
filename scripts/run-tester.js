const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkRegressions } = require('./lib/regression-checks');

const root = path.resolve(__dirname, '..');
let failed = false;

function result(label, passed, detail = '') {
  const marker = passed ? 'PASS' : 'FAIL';
  console.log(`${marker} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failed = true;
}

function javascriptFiles(target) {
  const full = path.join(root, target);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return full.endsWith('.js') ? [full] : [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'public') return [];
    return javascriptFiles(path.join(target, entry.name));
  });
}

const syntaxTargets = ['server.js', 'api', 'js', 'scripts', 'tests'];
for (const file of syntaxTargets.flatMap(javascriptFiles)) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  result(`syntax ${path.relative(root, file)}`, check.status === 0, check.stderr.trim());
}

for (const file of ['config/pricing.json', 'testing/tasks.json']) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    result(`json ${file}`, true);
  } catch (error) {
    result(`json ${file}`, false, error.message);
  }
}

const tests = spawnSync(process.execPath, ['--test'], { cwd: root, encoding: 'utf8' });
process.stdout.write(tests.stdout);
process.stderr.write(tests.stderr);
result('node tests', tests.status === 0);

for (const check of checkRegressions(root)) {
  result(`regression ${check.id}`, check.passed, check.description);
}

async function smoke() {
  const base = new URL(process.env.TEST_BASE_URL || 'http://127.0.0.1:3000');
  if (!['localhost', '127.0.0.1', '::1'].includes(base.hostname)) {
    throw new Error('Smoke tests are restricted to localhost');
  }
  for (const endpoint of ['/healthz', '/', '/catalog.html']) {
    const response = await fetch(new URL(endpoint, base));
    result(`smoke ${endpoint}`, response.ok, `HTTP ${response.status}`);
  }
}

(async () => {
  if (process.argv.includes('--smoke')) {
    try {
      await smoke();
    } catch (error) {
      result('smoke', false, error.message);
    }
  }
  process.exitCode = failed ? 1 : 0;
})();
