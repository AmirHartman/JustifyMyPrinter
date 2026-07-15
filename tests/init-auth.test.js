const assert = require('node:assert/strict');
const test = require('node:test');
const { canInitialize } = require('../api/_init-auth');

const request = (headers = {}) => ({ headers });

test('explicit development permits local initialization without a secret', () => {
  assert.equal(canInitialize(request(), { NODE_ENV: 'development' }), true);
});

test('missing NODE_ENV does not bypass initialization protection', () => {
  assert.equal(canInitialize(request(), {}), false);
});

test('production or other environments require the configured secret', () => {
  const env = { NODE_ENV: 'production', INIT_SECRET: 'correct-secret' };
  assert.equal(canInitialize(request(), env), false);
  assert.equal(canInitialize(request({ 'x-init-secret': 'wrong' }), env), false);
  assert.equal(canInitialize(request({ 'x-init-secret': 'correct-secret' }), env), true);
  assert.equal(canInitialize(request({ authorization: 'Bearer correct-secret' }), env), true);
});
