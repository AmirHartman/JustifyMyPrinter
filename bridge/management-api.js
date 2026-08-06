'use strict';

const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');

function safeErrorCode(error) {
  const code = String(error?.code || 'operation_failed').toLowerCase();
  return /^[a-z0-9_:-]{1,64}$/.test(code) ? code : 'operation_failed';
}

function equalToken(value, expected) {
  const left = crypto.createHash('sha256').update(String(value || ''), 'utf8').digest();
  const right = crypto.createHash('sha256').update(String(expected || ''), 'utf8').digest();
  return crypto.timingSafeEqual(left, right);
}

function requestError(code, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function decodeFileName(value) {
  const encoded = String(value || '');
  if (!encoded || encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw requestError('invalid_file_name', 400);
  const bytes = Buffer.from(encoded, 'base64url');
  if (!bytes.length || bytes.toString('base64url') !== encoded) throw requestError('invalid_file_name', 400);
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw requestError('invalid_file_name', 400); }
  const name = path.basename(decoded);
  if (name !== decoded || path.win32.basename(decoded) !== decoded || Buffer.byteLength(name, 'utf8') > 240 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw requestError('invalid_file_name', 400);
  }
  if (!/\.gcode\.3mf$/i.test(name)) throw requestError('invalid_file_name', 400);
  return name;
}

function startManagementApi({ cfg, state, library, scheduler, logger = console }) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    const send = (status, body) => {
      if (res.headersSent || res.writableEnded) return;
      res.writeHead(status).end(JSON.stringify(body));
    };
    if (!req.url?.startsWith('/v1/')) return send(404, { error: 'not_found' });
    if (!cfg.managementToken || !equalToken(req.headers.authorization, `Bearer ${cfg.managementToken}`)) {
      return send(401, { error: 'unauthorized' });
    }

    try {
      if (req.method === 'GET' && req.url === '/v1/status') return send(200, state.status());
      if (req.method === 'GET' && req.url === '/v1/queue') return send(200, { current: state.currentJob() });
      if (req.method === 'GET' && req.url === '/v1/library') return send(200, { files: library.inventory() });
      if (req.method === 'GET' && req.url === '/v1/logs') return send(200, { logs: state.logs() });
      if (req.method === 'POST' && req.url === '/v1/library/import') {
        if (!state.libraryWorkAllowed()) throw requestError('active_job', 409);
        const declared = Number(req.headers['content-length']);
        if (!Number.isSafeInteger(declared) || declared <= 0) throw requestError('content_length_required', 411);
        if (declared > cfg.maxBytes) throw requestError('file_too_large', 413);
        const disk = await fs.statfs(library.storageDir);
        if (Number(disk.bavail) * Number(disk.bsize) < cfg.minFreeBytes + declared) throw requestError('insufficient_storage', 507);
        const name = decodeFileName(req.headers['x-file-name']);
        const destination = path.join(library.incomingDir, name);
        const partial = path.join(library.incomingDir, `.${process.pid}-${crypto.randomUUID()}.partial`);
        let handle;
        let importStarted = false;
        try {
          library.beginImport();
          importStarted = true;
          handle = await fs.open(partial, 'wx', 0o640);
          let received = 0;
          for await (const chunk of req) {
            received += chunk.length;
            if (received > declared || received > cfg.maxBytes) throw requestError('file_too_large', 413);
            await handle.write(chunk);
          }
          if (received !== declared) throw requestError('incomplete_upload', 400);
          await handle.sync();
          await handle.close();
          handle = null;
          try { await fs.link(partial, destination); } catch (error) {
            if (error?.code === 'EEXIST') throw requestError('file_already_exists', 409);
            throw error;
          }
          await fs.unlink(partial);
          return send(202, { accepted: true, fileName: name });
        } finally {
          if (handle) await handle.close().catch(() => {});
          await fs.unlink(partial).catch(() => {});
          if (importStarted) library.endImport();
        }
      }
      if (req.method === 'POST' && req.url === '/v1/library/scan') {
        if (!state.libraryWorkAllowed()) throw requestError('active_job', 409);
        return send(200, { files: await library.scan(true) });
      }
      if (req.method === 'POST' && req.url === '/v1/lifecycle/pause') { scheduler.pause(); return send(200, { paused: true }); }
      if (req.method === 'POST' && req.url === '/v1/lifecycle/resume') { scheduler.resume(); return send(200, { paused: false }); }
      if (req.method === 'POST' && req.url === '/v1/diagnostics/site') return send(200, await scheduler.siteDiagnostics());
      if (req.method === 'POST' && req.url === '/v1/diagnostics/printer') return send(200, await scheduler.printerDiagnostics());
      if (req.method === 'POST' && req.url === '/v1/lifecycle/shutdown') {
        if (state.currentJob()) throw requestError('active_job', 409);
        send(200, { stopping: true });
        return scheduler.shutdown();
      }
      return send(404, { error: 'not_found' });
    } catch (error) {
      const code = safeErrorCode(error);
      logger.warn?.('management_operation_failed', code);
      return send(Number(error?.statusCode) || (code === 'library_busy' ? 409 : 500), { error: code === 'library_busy' ? code : (Number(error?.statusCode) ? code : 'operation_failed') });
    }
  });
  server.listen(cfg.managementPort, cfg.managementHost);
  return server;
}

module.exports = { decodeFileName, equalToken, startManagementApi };
