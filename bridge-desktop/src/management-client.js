'use strict';

const { request } = require('node:http');

const HOST = '127.0.0.1';
const PORT = 43127;
const MAX_LOG_BYTES = 1024 * 1024;

class ManagementError extends Error {
  constructor(status, code, message) {
    super(message || code || `Management API error (${status})`);
    this.name = 'ManagementError';
    this.status = status;
    this.code = code || 'management_error';
  }
}

function apiRequest(token, method, endpoint, { body, timeoutMs = 12_000, onProgress } = {}) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(String(token || ''))) throw new Error('Invalid management capability');
  if (!/^\/v1\/[a-z0-9/_-]*$/i.test(endpoint)) throw new Error('Invalid management endpoint');
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request({ host: HOST, port: PORT, path: endpoint, method, timeout: timeoutMs, headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
    } }, (res) => {
      const chunks = []; let received = 0;
      res.on('data', (chunk) => { received += chunk.length; if (received <= MAX_LOG_BYTES) chunks.push(chunk); onProgress?.({ received }); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8'); let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = { code: 'invalid_response' }; }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new ManagementError(res.statusCode, data.code || data.error, data.message));
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new ManagementError(504, 'timeout', 'הגשר לא הגיב בזמן.')));
    req.on('error', (error) => reject(error instanceof ManagementError ? error : new ManagementError(503, 'unreachable', 'לא ניתן להתחבר לגשר המקומי.')));
    if (payload) req.end(payload); else req.end();
  });
}

function importFile(token, filePath, onProgress) {
  // The renderer supplies a selected path only to main; bytes stream directly to
  // the loopback daemon and are never loaded into renderer memory.
  const fs = require('node:fs');
  const stat = fs.statSync(filePath);
  return new Promise((resolve, reject) => {
    const source = fs.createReadStream(filePath);
    let sent = 0;
    const req = request({ host: HOST, port: PORT, path: '/v1/library/import', method: 'POST', timeout: 15 * 60_000, headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size,
      'X-File-Name': Buffer.from(require('node:path').basename(filePath)).toString('base64url'),
    } }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => {
        let data = {}; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { data = {}; }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new ManagementError(res.statusCode, data.code || data.error, data.message));
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new ManagementError(504, 'import_timeout', 'ייבוא הקובץ ארך זמן רב מדי.')));
    req.on('error', () => reject(new ManagementError(503, 'unreachable', 'החיבור לגשר נותק בזמן הייבוא.')));
    source.on('data', (chunk) => { sent += chunk.length; onProgress?.({ sent, total: stat.size }); });
    source.on('error', reject); source.pipe(req);
  });
}

module.exports = { apiRequest, importFile, ManagementError, HOST, PORT };
