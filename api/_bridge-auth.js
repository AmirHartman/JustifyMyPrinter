const { timingSafeEqual } = require('crypto');

// Machine-to-machine auth for the local home bridge (the process on the owner's
// LAN that pushes sliced files to the Bambu P2S and reports job status back).
// Mirrors _init-auth.js: a shared BRIDGE_SECRET, compared in constant time,
// supplied via the x-bridge-secret header or a Bearer token — never a session
// cookie. Open in development so a locally-run bridge can be tested end to end.
function canBridge(req, env = process.env) {
  if (env.NODE_ENV === 'development') return true;
  const expected = String(env.BRIDGE_SECRET || '');
  if (!expected) return false;
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const supplied = String(req.headers['x-bridge-secret'] || bearer);
  if (!supplied) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length
    && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

module.exports = { canBridge };
