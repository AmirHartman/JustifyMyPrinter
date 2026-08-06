const { timingSafeEqual } = require('crypto');

// Machine-to-machine auth for the local home bridge (the process on the owner's
// LAN that pushes sliced files to the Bambu P2S and reports job status back).
// Mirrors _init-auth.js: a shared BRIDGE_SECRET, compared in constant time,
// supplied via a Bearer token (preferred) or the legacy x-bridge-secret header
// — never a session cookie. BRIDGE_ID is required as well: one shared secret
// must not silently authenticate an unconfigured or replacement bridge.
function configuredBridgeId(env = process.env) {
  const bridgeId = String(env.BRIDGE_ID || '').trim();
  return bridgeId && bridgeId.length <= 120 ? bridgeId : null;
}

function authenticateBridge(req, env = process.env) {
  const expected = String(env.BRIDGE_SECRET || '');
  const bridgeId = configuredBridgeId(env);
  if (!expected || !bridgeId) return null;
  const headers = req.headers || {};
  const authorization = String(headers.authorization || '');
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || '';
  const supplied = String(bearer || headers['x-bridge-secret'] || '');
  if (!supplied) return null;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
  // Bridge identity is deployment-owned, not supplied in a request body.
  return { bridgeId };
}

function canBridge(req, env = process.env) {
  return Boolean(authenticateBridge(req, env));
}

module.exports = { authenticateBridge, canBridge, configuredBridgeId };
