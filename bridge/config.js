'use strict';

const os = require('os');
const path = require('path');

const HANDSHAKE_FLAG = '--launch-handshake';
const HANDSHAKE_MAX_BYTES = 64 * 1024;
const HANDSHAKE_TIMEOUT_MS = 5000;

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('Boolean configuration values must be true or false');
}

function positiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error('Numeric configuration value is out of range');
  }
  return number;
}

function loopbackHost(value) {
  const host = String(value || '127.0.0.1').trim();
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('MANAGEMENT_HOST must be a loopback address');
  return host;
}

function siteUrl(value) {
  const text = String(value || 'http://localhost:3000').trim().replace(/\/$/, '');
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error('SITE_URL must be a valid HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('SITE_URL must be a valid HTTP(S) URL');
  }
  return text;
}

function printerConfig(source = {}) {
  return {
    ip: String(source.ip ?? source.PRINTER_IP ?? '').trim(),
    serial: String(source.serial ?? source.PRINTER_SERIAL ?? '').trim(),
    accessCode: String(source.accessCode ?? source.PRINTER_ACCESS_CODE ?? ''),
    plateGcode: String(source.plateGcode ?? source.PRINTER_PLATE_GCODE ?? 'Metadata/plate_1.gcode').trim(),
    useAms: booleanValue(source.useAms ?? source.PRINTER_USE_AMS, true),
  };
}

function validateConfig(input) {
  const simulate = booleanValue(input.simulate, !input.printer?.ip);
  const cfg = {
    siteUrl: siteUrl(input.siteUrl),
    secret: String(input.secret || ''),
    bridgeId: String(input.bridgeId || 'home-bridge'),
    pollMs: positiveInteger(input.pollMs, 5000, 1000, 300000),
    scanMs: positiveInteger(input.scanMs, 30000, 1000, 24 * 60 * 60 * 1000),
    storageDir: path.resolve(String(input.storageDir || path.join(os.homedir(), 'JustifyMyPrinter-print-library'))),
    maxBytes: positiveInteger(input.maxBytes, 100 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024),
    minFreeBytes: positiveInteger(input.minFreeBytes, 1024 * 1024 * 1024, 0, Number.MAX_SAFE_INTEGER),
    simulate,
    managementHost: loopbackHost(input.managementHost),
    managementPort: positiveInteger(input.managementPort, 43127, 1, 65535),
    managementToken: String(input.managementToken || ''),
    printer: printerConfig(input.printer),
  };
  if (!cfg.secret) throw new Error('BRIDGE_SECRET is required');
  if (cfg.bridgeId !== 'home-bridge') throw new Error('BRIDGE_ID must be home-bridge');
  if (!cfg.managementToken) throw new Error('MANAGEMENT_TOKEN is required');
  if (!cfg.simulate && (!cfg.printer.ip || !cfg.printer.serial || !cfg.printer.accessCode)) {
    throw new Error('Real mode needs printer credentials');
  }
  return cfg;
}

function configFromEnvironment(env = process.env) {
  return validateConfig({
    siteUrl: env.SITE_URL,
    secret: env.BRIDGE_SECRET,
    bridgeId: env.BRIDGE_ID,
    pollMs: env.POLL_INTERVAL_MS,
    scanMs: env.SCAN_INTERVAL_MS,
    storageDir: env.STORAGE_DIR,
    maxBytes: env.MAX_FILE_BYTES,
    minFreeBytes: env.MIN_FREE_BYTES,
    simulate: env.SIMULATE,
    managementHost: env.MANAGEMENT_HOST,
    managementPort: env.MANAGEMENT_PORT,
    managementToken: env.MANAGEMENT_TOKEN,
    printer: printerConfig(env),
  });
}

function mapHandshake(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Launch handshake must be an object');
  const management = value.management;
  const config = value.config;
  if (!management || typeof management !== 'object' || Array.isArray(management)) throw new Error('Launch handshake management is required');
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Launch handshake config is required');
  const printer = config.printer;
  if (printer !== undefined && (!printer || typeof printer !== 'object' || Array.isArray(printer))) throw new Error('Launch handshake printer must be an object');

  // Explicit mapping is intentional: additional keys never become runtime or
  // environment configuration by accident.
  return validateConfig({
    siteUrl: config.siteUrl,
    secret: config.bridgeSecret,
    bridgeId: config.bridgeId,
    storageDir: config.storageDir,
    simulate: config.simulate,
    managementHost: management.host,
    managementPort: management.port,
    managementToken: management.capability,
    printer: printerConfig(printer || {}),
  });
}

function readHandshake(input = process.stdin, { timeoutMs = HANDSHAKE_TIMEOUT_MS, maxBytes = HANDSHAKE_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let bytes = 0;
    const chunks = [];
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) return done(new Error('Launch handshake exceeds size limit'));
      chunks.push(buffer);
    };
    const onEnd = () => {
      try {
        const text = Buffer.concat(chunks, bytes).toString('utf8').trim();
        if (!text) throw new Error('Launch handshake is empty');
        done(null, mapHandshake(JSON.parse(text)));
      } catch (error) { done(error); }
    };
    const onError = () => done(new Error('Could not read launch handshake'));
    const timer = setTimeout(() => done(new Error('Launch handshake timed out')), timeoutMs);
    timer.unref?.();
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onError);
    input.resume?.();
  });
}

async function loadConfig({ argv = process.argv.slice(2), env = process.env, stdin = process.stdin } = {}) {
  const handshake = argv.includes(HANDSHAKE_FLAG);
  const unknown = argv.filter((argument) => argument.startsWith('--') && argument !== HANDSHAKE_FLAG);
  if (unknown.length) throw new Error('Unknown bridge launch option');
  // Pi/systemd uses env mode and never reads stdin. Windows must opt into the
  // bounded handshake explicitly, so a headless service can never hang here.
  return handshake ? readHandshake(stdin) : configFromEnvironment(env);
}

module.exports = {
  HANDSHAKE_FLAG,
  HANDSHAKE_MAX_BYTES,
  HANDSHAKE_TIMEOUT_MS,
  configFromEnvironment,
  loadConfig,
  mapHandshake,
  readHandshake,
};
