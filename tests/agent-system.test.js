const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const workers = [
  'project-mapper',
  'backend-security',
  'orders-pricing-inventory',
  'frontend-rtl',
  'tester',
  'quality-curator',
  'git-steward',
];

function frontmatter(file) {
  const match = read(file).match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${file} needs frontmatter`);
  return Object.fromEntries(match[1].split('\n').map((line) => {
    const separator = line.indexOf(':');
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  }));
}

test('canonical role and workflow paths are complete', () => {
  for (const role of ['coordinator', ...workers]) {
    assert.equal(exists(`agent-system/roles/${role}.md`), true);
  }
  for (const workflow of ['task-lifecycle', 'delegation-policy', 'context-packs',
    'git-integration', 'verification-matrix', 'learning-loop']) {
    assert.equal(exists(`agent-system/workflows/${workflow}.md`), true);
  }
  for (const contract of ['task-contract.schema.json', 'agent-handoff.schema.json']) {
    assert.doesNotThrow(() => JSON.parse(read(`agent-system/contracts/${contract}`)));
  }
});

test('Codex registers exactly seven workers with bounded depth and threads', () => {
  const config = read('.codex/config.toml');
  assert.match(config, /max_threads\s*=\s*4/);
  assert.match(config, /max_depth\s*=\s*1/);
  const registered = [...config.matchAll(/^\[agents\.([^\]]+)\]$/gm)].map((match) => match[1]);
  assert.deepEqual(registered, workers);
  for (const worker of workers) {
    assert.equal(exists(`.codex/agents/${worker}.toml`), true);
    assert.match(config, new RegExp(`config_file = "agents/${worker}\\.toml"`));
    assert.match(read(`.codex/agents/${worker}.toml`), /spawn|spawning/i);
  }
});

test('Codex model and permission allocation matches role risk', () => {
  const expected = {
    'project-mapper': ['gpt-5.6-luna', 'medium', 'read-only', 'never'],
    'backend-security': ['gpt-5.6-terra', 'high', 'workspace-write', 'on-request'],
    'orders-pricing-inventory': ['gpt-5.6-sol', 'high', 'workspace-write', 'on-request'],
    'frontend-rtl': ['gpt-5.6-terra', 'medium', 'workspace-write', 'on-request'],
    tester: ['gpt-5.6-luna', 'medium', 'read-only', 'never'],
    'quality-curator': ['gpt-5.6-terra', 'high', 'workspace-write', 'on-request'],
    'git-steward': ['gpt-5.6-sol', 'high', 'workspace-write', 'on-request'],
  };
  for (const [worker, [model, effort, sandbox, approval]] of Object.entries(expected)) {
    const config = read(`.codex/agents/${worker}.toml`);
    assert.match(config, new RegExp(`model = "${model}"`));
    assert.match(config, new RegExp(`model_reasoning_effort = "${effort}"`));
    assert.match(config, new RegExp(`sandbox_mode = "${sandbox}"`));
    assert.match(config, new RegExp(`approval_policy = "${approval}"`));
  }
});

test('Claude wrappers deny recursion and read-only roles have no write tools', () => {
  for (const worker of workers) {
    const metadata = frontmatter(`.claude/agents/${worker}.md`);
    assert.match(metadata.disallowedTools, /\bAgent\b/);
  }
  for (const worker of ['project-mapper', 'tester']) {
    const metadata = frontmatter(`.claude/agents/${worker}.md`);
    assert.equal(metadata.model, 'fable');
    assert.equal(metadata.effort, 'medium');
    assert.equal(metadata.permissionMode, 'plan');
    assert.doesNotMatch(metadata.tools, /\b(?:Write|Edit|NotebookEdit|Agent)\b/);
    assert.match(metadata.disallowedTools, /Write/);
    assert.match(metadata.disallowedTools, /Edit/);
  }
  assert.equal(frontmatter('.claude/agents/orders-pricing-inventory.md').model, 'opus');
  assert.equal(frontmatter('.claude/agents/git-steward.md').model, 'opus');
});

test('Tester wrappers are strict read-only pointers and Curator owns durable writes', () => {
  assert.match(read('.agents/skills/tester/SKILL.md'), /strictly read-only/i);
  assert.match(read('.agents/skills/tester/SKILL.md'), /Quality Curator/);
  assert.match(read('.codex/agents/tester.toml'), /sandbox_mode = "read-only"/);
  assert.doesNotMatch(frontmatter('.claude/agents/tester.md').tools, /Write|Edit/);
  const curator = read('agent-system/roles/quality-curator.md');
  assert.match(curator, /tests, test helpers, testing/);
  assert.match(curator, /remembered tasks/);
});

test('former Tester requirements have a complete owner/evidence migration', () => {
  const migration = read('agent-system/migrations/tester-requirements.md');
  const ids = [...migration.matchAll(/^\| (TR\d{2}) \|/gm)].map((match) => match[1]);
  assert.deepEqual(ids, Array.from({ length: 16 }, (_, index) => `TR${String(index + 1).padStart(2, '0')}`));
  assert.match(migration, /There are no unmapped former Tester requirements\./);
  assert.doesNotMatch(migration, /\|[^\n]*\|\s*(?:unmapped|none|TBD)\s*\|/i);
});
