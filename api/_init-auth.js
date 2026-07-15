const { timingSafeEqual } = require('crypto');

function canInitialize(req, env = process.env) {
  if (env.NODE_ENV === 'development') return true;
  const expected = String(env.INIT_SECRET || '');
  if (!expected) return false;
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const supplied = String(req.headers['x-init-secret'] || bearer);
  if (!supplied) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length
    && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

module.exports = { canInitialize };
