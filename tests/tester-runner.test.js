const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  SCHEMA_VERSION,
  boundedText,
  exitCodeForReport,
  parseArgs,
  renderHuman,
  runSmoke,
  taskReminders,
  validateLocalBaseUrl,
} = require('../scripts/run-tester');

const root = path.resolve(__dirname, '..');

test('tester arguments keep JSON and smoke modes independent', () => {
  assert.deepEqual(parseArgs([]), { json: false, smoke: false });
  assert.deepEqual(parseArgs(['--json']), { json: true, smoke: false });
  assert.deepEqual(parseArgs(['--smoke', '--json']), { json: true, smoke: true });
});

test('smoke accepts only credential-free literal loopback base URLs', () => {
  assert.equal(validateLocalBaseUrl('http://127.0.0.1:3102').hostname, '127.0.0.1');
  assert.equal(validateLocalBaseUrl('http://[::1]:3102').hostname, '[::1]');
  assert.throws(() => validateLocalBaseUrl('http://localhost:3102'), /literal IPv4 or IPv6 loopback/);
  assert.throws(() => validateLocalBaseUrl('http://192.168.1.2:3102'), /literal IPv4 or IPv6 loopback/);
  assert.throws(() => validateLocalBaseUrl('http://user:secret@127.0.0.1:3102'), /credentials/);
  assert.throws(() => validateLocalBaseUrl('file:///tmp/server'), /http or https/);
  assert.throws(() => validateLocalBaseUrl('http://127.0.0.1:3102/path'), /path, query, or fragment/);
});

test('smoke uses bounded GET requests and refuses redirects', async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: false, status: 302 };
  };
  const results = await runSmoke('http://127.0.0.1:3102', fakeFetch, 25);
  assert.equal(results.length, 3);
  assert.equal(results.every((result) => !result.passed), true);
  assert.equal(results.every((result) => /redirects are refused/.test(result.detail)), true);
  assert.equal(requests.every(({ options }) => options.method === 'GET'), true);
  assert.equal(requests.every(({ options }) => options.redirect === 'manual'), true);
  assert.equal(requests.every(({ options }) => options.signal instanceof AbortSignal), true);
});

test('only executed failures determine the tester exit code', () => {
  const report = {
    checks: [{ status: 'passed' }],
    skipped: [{ status: 'skipped' }],
    taskReminders: [{ id: 'T1', status: 'later' }],
  };
  assert.equal(exitCodeForReport(report), 0);
  report.checks.push({ status: 'failed' });
  assert.equal(exitCodeForReport(report), 1);
});

test('task reminders include only open and later tasks', () => {
  assert.deepEqual(taskReminders({ tasks: [
    { id: 'T1', status: 'later', title: 'Later', acceptance: 'A' },
    { id: 'T2', status: 'open', title: 'Open', acceptance: 'B' },
    { id: 'T3', status: 'done', title: 'Done', acceptance: 'C' },
  ] }).map(({ id }) => id), ['T1', 'T2']);
});

test('human output separates task reminders and reports deterministic exit', () => {
  const lines = [];
  renderHuman({
    checks: [{ status: 'passed', tier: 'T1', label: 'unit', detail: 'ok' }],
    skipped: [{ tier: 'T4', label: 'browser', reason: 'not run' }],
    taskReminders: [{ id: 'T1', status: 'later', title: 'Task' }],
    summary: { passed: 1, failed: 0, skipped: 1, exitCode: 0 },
  }, (line) => lines.push(line));
  assert.match(lines.join('\n'), /TASK REMINDERS \(do not affect exit status\)/);
  assert.match(lines.at(-1), /exit=0/);
});

test('structured detail is bounded', () => {
  assert.equal(boundedText('x'.repeat(100), 20).length, 20);
});

test('manifest covers deterministic, regression, and optional evidence tiers', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'testing/test-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
  const ids = new Set(manifest.checks.map(({ id }) => id));
  for (const id of ['manifest-json', 'syntax-js', 'json-config', 'node-tests',
    'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9',
    'local-http-smoke', 'local-db-api', 'browser-workflows', 'remote-smoke']) {
    assert.equal(ids.has(id), true, `missing manifest check ${id}`);
  }
  assert.deepEqual(new Set(manifest.checks.map(({ tier }) => tier)), new Set(['T0', 'T1', 'T2', 'T3', 'T4', 'T5']));
});

test('runner source exposes bounded structured evidence and failure fields', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/run-tester.js'), 'utf8');
  assert.match(source, /schemaVersion: SCHEMA_VERSION/);
  assert.match(source, /evidenceTiers:/);
  assert.match(source, /failures: checks/);
  assert.match(source, /taskReminders:/);
  assert.match(source, /summary:/);
});
