const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkRegressions } = require('./lib/regression-checks');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const SCHEMA_VERSION = '1.0.0';
const DEFAULT_SMOKE_TIMEOUT_MS = 3_000;

function parseArgs(argv = process.argv.slice(2)) {
  return {
    json: argv.includes('--json'),
    smoke: argv.includes('--smoke'),
  };
}

function boundedText(value, limit = 800) {
  const text = String(value || '').replace(/\u001b\[[0-9;]*m/g, '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function javascriptFiles(root, relativeTarget) {
  const full = path.resolve(root, relativeTarget);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return full.endsWith('.js') ? [full] : [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'public') return [];
    const child = path.join(full, entry.name);
    return entry.isDirectory()
      ? javascriptFiles(root, path.relative(root, child))
      : (entry.isFile() && entry.name.endsWith('.js') ? [child] : []);
  });
}

function loadJson(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

function manifestEntry(manifest, id) {
  return manifest?.checks?.find((entry) => entry.id === id) || {};
}

function executedCheck(manifest, values) {
  const metadata = manifestEntry(manifest, values.id);
  return {
    id: values.id,
    label: values.label || metadata.label || values.id,
    tier: values.tier || metadata.tier || 'T0',
    status: values.passed ? 'passed' : 'failed',
    command: values.command || metadata.command || null,
    detail: boundedText(values.detail),
    proves: values.proves || metadata.proves || '',
    doesNotProve: values.doesNotProve || metadata.doesNotProve || '',
  };
}

function skippedCheck(manifest, id, reason) {
  const metadata = manifestEntry(manifest, id);
  return {
    id,
    label: metadata.label || id,
    tier: metadata.tier || 'T0',
    status: 'skipped',
    reason: boundedText(reason || metadata.defaultSkipReason),
    proves: metadata.proves || '',
    doesNotProve: metadata.doesNotProve || '',
  };
}

function validateLocalBaseUrl(raw) {
  const base = new URL(raw);
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new Error('Smoke URL must use http or https');
  }
  if (base.username || base.password) {
    throw new Error('Smoke URL must not contain credentials');
  }
  const hostname = base.hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('Smoke URL must use a literal IPv4 or IPv6 loopback address');
  }
  if ((base.pathname && base.pathname !== '/') || base.search || base.hash) {
    throw new Error('Smoke base URL must not contain a path, query, or fragment');
  }
  base.pathname = '/';
  return base;
}

async function runSmoke(baseUrl, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS) {
  const base = validateLocalBaseUrl(baseUrl);
  const results = [];
  for (const endpoint of ['/healthz', '/', '/catalog.html']) {
    try {
      const response = await fetchImpl(new URL(endpoint, base), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const redirected = response.status >= 300 && response.status < 400;
      const location = response.headers?.get?.('location') || '';
      const redirectTarget = new URL(location, base);
      const catalogRedirect = endpoint === '/catalog.html'
        && response.status === 302
        && redirectTarget.origin === base.origin
        && redirectTarget.pathname === '/dashboard.html'
        && !redirectTarget.search
        && !redirectTarget.hash;
      results.push({
        endpoint,
        passed: endpoint === '/catalog.html' ? catalogRedirect : response.ok && !redirected,
        detail: redirected
          ? `HTTP ${response.status}${location ? ` -> ${location}` : '; missing Location'}`
          : `HTTP ${response.status}`,
      });
    } catch (error) {
      results.push({ endpoint, passed: false, detail: error.message });
    }
  }
  return results;
}

function taskReminders(tasks) {
  if (!Array.isArray(tasks?.tasks)) return [];
  return tasks.tasks
    .filter((task) => ['open', 'later'].includes(task.status))
    .map((task) => ({
      id: task.id,
      status: task.status,
      title: boundedText(task.title, 200),
      acceptance: boundedText(task.acceptance, 300),
    }));
}

function exitCodeForReport(report) {
  return report.checks.some((check) => check.status === 'failed') ? 1 : 0;
}

async function runTester({
  root = DEFAULT_ROOT,
  argv = process.argv.slice(2),
  spawn = spawnSync,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const args = parseArgs(argv);
  const manifestPath = path.join(root, 'testing/test-manifest.json');
  const manifestRead = loadJson(manifestPath);
  const manifest = manifestRead.value || { checks: [] };
  const checks = [];
  const skipped = [];

  checks.push(executedCheck(manifest, {
    id: 'manifest-json',
    tier: 'T0',
    passed: !manifestRead.error && manifest.schemaVersion === SCHEMA_VERSION,
    detail: manifestRead.error ? manifestRead.error.message : `schema ${manifest.schemaVersion}`,
  }));

  const syntaxTargets = ['server.js', 'api', 'js', 'scripts', 'tests'];
  const files = syntaxTargets.flatMap((target) => javascriptFiles(root, target));
  const syntaxFailures = [];
  for (const file of files) {
    const result = spawn(process.execPath, ['--check', file], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (result.status !== 0) {
      syntaxFailures.push(`${path.relative(root, file)}: ${boundedText(result.stderr || result.error?.message, 300)}`);
    }
  }
  checks.push(executedCheck(manifest, {
    id: 'syntax-js',
    tier: 'T0',
    passed: syntaxFailures.length === 0,
    detail: syntaxFailures.length ? syntaxFailures.join('; ') : `${files.length} JavaScript files`,
  }));

  const jsonFiles = [
    'config/pricing.json',
    'testing/tasks.json',
    'testing/test-manifest.json',
    'agent-system/contracts/task-contract.schema.json',
    'agent-system/contracts/agent-handoff.schema.json',
  ];
  const jsonFailures = [];
  for (const file of jsonFiles) {
    const parsed = loadJson(path.join(root, file));
    if (parsed.error) jsonFailures.push(`${file}: ${parsed.error.message}`);
  }
  checks.push(executedCheck(manifest, {
    id: 'json-config',
    tier: 'T0',
    passed: jsonFailures.length === 0,
    detail: jsonFailures.length ? jsonFailures.join('; ') : `${jsonFiles.length} JSON files`,
  }));

  const tests = spawn(process.execPath, ['--test'], {
    cwd: root,
    encoding: 'utf8',
    timeout: manifestEntry(manifest, 'node-tests').timeoutMs || 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const testCount = tests.stdout?.match(/# tests (\d+)/)?.[1];
  checks.push(executedCheck(manifest, {
    id: 'node-tests',
    tier: 'T1',
    passed: tests.status === 0,
    detail: tests.status === 0
      ? `${testCount || 'all'} tests; exit 0`
      : boundedText(tests.stderr || tests.stdout || tests.error?.message, 1_200),
  }));

  for (const regression of checkRegressions(root)) {
    checks.push(executedCheck(manifest, {
      id: regression.id,
      label: `regression ${regression.id}`,
      tier: regression.tier,
      passed: regression.passed,
      detail: regression.missingFiles.length
        ? `missing required source: ${regression.missingFiles.join(', ')}`
        : regression.description,
      proves: regression.proves,
      doesNotProve: regression.doesNotProve,
    }));
  }

  if (args.smoke) {
    const baseUrl = env.TEST_BASE_URL || 'http://127.0.0.1:3000';
    let smokeResults;
    try {
      smokeResults = await runSmoke(baseUrl, fetchImpl, manifestEntry(manifest, 'local-http-smoke').timeoutMs);
    } catch (error) {
      smokeResults = [{ endpoint: 'configuration', passed: false, detail: error.message }];
    }
    for (const smoke of smokeResults) {
      checks.push(executedCheck(manifest, {
        id: `local-http-smoke:${smoke.endpoint}`,
        label: `local smoke ${smoke.endpoint}`,
        tier: 'T3',
        passed: smoke.passed,
        detail: smoke.detail,
        command: `GET ${smoke.endpoint}`,
        proves: manifestEntry(manifest, 'local-http-smoke').proves,
        doesNotProve: manifestEntry(manifest, 'local-http-smoke').doesNotProve,
      }));
    }
  } else {
    skipped.push(skippedCheck(manifest, 'local-http-smoke', 'not requested; add --smoke with an isolated local server'));
  }

  skipped.push(skippedCheck(manifest, 'local-db-api'));
  skipped.push(skippedCheck(manifest, 'browser-workflows'));
  skipped.push(skippedCheck(manifest, 'remote-smoke'));

  const tasksRead = loadJson(path.join(root, 'testing/tasks.json'));
  const report = {
    schemaVersion: SCHEMA_VERSION,
    mode: args.smoke ? 'deterministic+local-smoke' : 'deterministic',
    checks,
    evidenceTiers: {
      executed: [...new Set(checks.map((check) => check.tier))],
      skipped: [...new Set(skipped.map((check) => check.tier))],
    },
    skipped,
    failures: checks
      .filter((check) => check.status === 'failed')
      .map(({ id, label, tier, detail }) => ({ id, label, tier, detail })),
    taskReminders: taskReminders(tasksRead.value),
    summary: {},
  };
  const exitCode = exitCodeForReport(report);
  report.summary = {
    executed: checks.length,
    passed: checks.filter((check) => check.status === 'passed').length,
    failed: checks.filter((check) => check.status === 'failed').length,
    skipped: skipped.length,
    taskReminders: report.taskReminders.length,
    exitCode,
  };
  return report;
}

function renderHuman(report, write = (line) => console.log(line)) {
  for (const check of report.checks) {
    const marker = check.status === 'passed' ? 'PASS' : 'FAIL';
    write(`${marker} ${check.tier} ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  for (const skip of report.skipped) {
    write(`SKIP ${skip.tier} ${skip.label} — ${skip.reason}`);
  }
  if (report.taskReminders.length) {
    write('TASK REMINDERS (do not affect exit status)');
    for (const task of report.taskReminders) {
      write(`- ${task.id} [${task.status}] ${task.title}`);
    }
  }
  const { passed, failed, skipped, exitCode } = report.summary;
  write(`SUMMARY passed=${passed} failed=${failed} skipped=${skipped} exit=${exitCode}`);
}

async function main() {
  const args = parseArgs();
  try {
    const report = await runTester();
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      renderHuman(report);
    }
    process.exitCode = report.summary.exitCode;
  } catch (error) {
    if (args.json) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        mode: 'fatal',
        checks: [{ id: 'tester-runtime', tier: 'T0', status: 'failed', detail: boundedText(error.message) }],
        evidenceTiers: { executed: ['T0'], skipped: [] },
        skipped: [],
        failures: [{ id: 'tester-runtime', tier: 'T0', detail: boundedText(error.message) }],
        taskReminders: [],
        summary: { executed: 1, passed: 0, failed: 1, skipped: 0, taskReminders: 0, exitCode: 1 },
      }, null, 2)}\n`);
    } else {
      console.error(`FAIL T0 tester runtime — ${boundedText(error.message)}`);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  SCHEMA_VERSION,
  boundedText,
  exitCodeForReport,
  parseArgs,
  renderHuman,
  runSmoke,
  runTester,
  taskReminders,
  validateLocalBaseUrl,
};
