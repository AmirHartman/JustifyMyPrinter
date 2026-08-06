'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the main-site workflow has no bridge or print-job surface', () => {
  const dashboard = read('dashboard.html');
  const state = read('js/state.js');
  const render = read('js/render.js');
  const server = read('server.js');

  for (const source of [dashboard, state, render, server]) {
    assert.doesNotMatch(source, /\/api\/(?:print-jobs|printer)/);
    assert.doesNotMatch(source, /צור משימת הדפסה|אשר ושלח למדפסת/);
  }
  assert.doesNotMatch(dashboard, /id="printer-view"|data-view="printer"/);
  assert.doesNotMatch(state, /\bprintJobs\b|bridgeOnline/);
  assert.equal(fs.existsSync(path.join(root, 'api', '_bridge-auth.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'api', 'print-jobs.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'api', 'printer.js')), false);
  const bridgeDir = path.join(root, 'bridge');
  assert.deepEqual(fs.existsSync(bridgeDir) ? fs.readdirSync(bridgeDir) : [], []);
});

test('orders retain the manual print-status workflow', () => {
  const render = read('js/render.js');
  assert.match(render, /"waiting_print", "printing"/);
  assert.match(render, /className = "order-status-jump"/);
  assert.match(render, /setOrderStatus\(order, next\)/);
});
