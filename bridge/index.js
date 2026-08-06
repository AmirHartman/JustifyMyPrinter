'use strict';

// Outbound-only LAN bridge. It owns STORAGE_DIR and never uploads print bytes
// to the website: it scans local sliced plates, syncs metadata, claims a plate,
// and either uploads its local checksum match or (for a legacy job only)
// downloads the old Cloudinary URL to send straight to the LAN printer.
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { FileLibrary, diskStatus } = require('./file-library');

function loadConfig() {
  const env = process.env;
  const simulate = env.SIMULATE ? env.SIMULATE === 'true' : !env.PRINTER_IP;
  const storageDir = String(env.STORAGE_DIR || path.join(os.homedir(), 'JustifyMyPrinter-print-library')).trim();
  const cfg = {
    siteUrl: (env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    secret: env.BRIDGE_SECRET || '', bridgeId: (env.BRIDGE_ID || os.hostname() || 'bridge').slice(0, 120),
    pollMs: Math.max(Number(env.POLL_INTERVAL_MS) || 5000, 1000),
    scanMs: Math.max(Number(env.SCAN_INTERVAL_MS) || 15000, 1000),
    simulate, storageDir, maxBytes: Math.max(Number(env.MAX_FILE_BYTES) || 100 * 1024 * 1024, 1024 * 1024),
    printer: {
      ip: env.PRINTER_IP || '', serial: env.PRINTER_SERIAL || '', accessCode: env.PRINTER_ACCESS_CODE || '',
      plateGcode: env.PRINTER_PLATE_GCODE || 'Metadata/plate_1.gcode',
      useAms: env.PRINTER_USE_AMS ? env.PRINTER_USE_AMS === 'true' : true,
    },
  };
  if (!cfg.secret) throw new Error('BRIDGE_SECRET is required');
  if (!cfg.simulate && (!cfg.printer.ip || !cfg.printer.serial || !cfg.printer.accessCode)) {
    throw new Error('Real mode needs PRINTER_IP, PRINTER_SERIAL and PRINTER_ACCESS_CODE (or set SIMULATE=true)');
  }
  return cfg;
}

const log = (...args) => console.log(new Date().toISOString(), ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiFetch(cfg, target, body) {
  const response = await fetch(cfg.siteUrl + target, {
    method: body === undefined ? 'GET' : (body._method || 'POST'),
    headers: { 'Content-Type': 'application/json', 'x-bridge-secret': cfg.secret },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) throw new Error(`${response.status} ${data.error || response.statusText}`);
  return data;
}

async function syncLibrary(cfg, library) {
  const files = await library.scan();
  const disk = await diskStatus(cfg.storageDir);
  await apiFetch(cfg, '/api/bridge-files?action=sync', {
    bridgeId: cfg.bridgeId, status: 'online', files, ...disk,
  });
  return files;
}

const claimNext = (cfg) => apiFetch(cfg, '/api/print-jobs?action=claim-next', { bridgeId: cfg.bridgeId });
function report(cfg, job, status, extra = {}) {
  return apiFetch(cfg, `/api/print-jobs?id=${encodeURIComponent(job.id)}&action=report`, {
    _method: 'PUT', claimToken: job.claimToken, status, ...extra,
  });
}
function heartbeat(cfg, job) {
  return apiFetch(cfg, `/api/print-jobs?id=${encodeURIComponent(job.id)}&action=heartbeat`, {
    _method: 'PUT', claimToken: job.claimToken,
  });
}
function reportBestEffort(cfg, job, status, extra) {
  return report(cfg, job, status, extra).catch((error) => log(`  ! report(${status}) failed:`, error.message));
}

async function keepClaimAlive(cfg, job, work) {
  const interval = setInterval(() => {
    heartbeat(cfg, job).catch((error) => log(`  ! heartbeat failed: ${error.message}`));
  }, Math.min(Math.max(Math.floor(cfg.pollMs * 3), 10 * 1000), 25 * 1000));
  interval.unref?.();
  try { return await work(); } finally { clearInterval(interval); }
}

async function runSimulated(cfg, job) {
  log(`  [sim] ${job.printFileChecksum ? `local ${job.printFileChecksum.slice(0, 12)}` : job.printFileUrl}`);
  await report(cfg, job, 'uploading', { message: 'הגשר (סימולציה) מעביר את הקובץ למדפסת' });
  await sleep(500);
  try {
    await report(cfg, job, 'printing', { progress: 0, message: 'המדפסת (סימולציה) התחילה להדפיס' });
  } catch (error) {
    if (/cancel_requested|Print cancellation requested/i.test(String(error.message))) {
      await report(cfg, job, 'cancelled', { message: 'הגשר (סימולציה) אישר ביטול לפני ההדפסה' });
      return;
    }
    throw error;
  }
  for (const progress of [15, 40, 70, 95]) { await sleep(500); await report(cfg, job, 'printing', { progress }); }
  await report(cfg, job, 'done', { progress: 100 });
}

async function uploadToPrinter(cfg, job, localPath) {
  const ftp = require('basic-ftp');
  const client = new ftp.Client(30000);
  try {
    await client.access({ host: cfg.printer.ip, port: 990, user: 'bblp', password: cfg.printer.accessCode, secure: 'implicit', secureOptions: { rejectUnauthorized: false } });
    const remoteName = job.printFileName || `${job.id}.gcode.3mf`;
    await client.uploadFrom(localPath, remoteName);
    return remoteName;
  } finally { client.close(); }
}

function startAndMonitor(cfg, job, remoteName) {
  const mqtt = require('mqtt');
  const { serial, accessCode, ip } = cfg.printer;
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(`mqtts://${ip}:8883`, { username: 'bblp', password: accessCode, rejectUnauthorized: false, reconnectPeriod: 0, connectTimeout: 15000 });
    const reportTopic = `device/${serial}/report`, requestTopic = `device/${serial}/request`;
    let finished = false, lastProgress = -1;
    const guard = setTimeout(() => finish(reject, new Error('printer did not report completion in time')), Math.max((Number(job.printHours) || 2) * 5400 * 1000, 30 * 60 * 1000));
    const finish = (callback, value) => { if (finished) return; finished = true; clearTimeout(guard); client.end(true); callback(value); };
    client.on('connect', () => client.subscribe(reportTopic, async (error) => {
      if (error) return finish(reject, error);
      try {
        // This is deliberately immediately before MQTT. A cancel request after
        // claim is rejected by the server transition instead of starting print.
        await report(cfg, job, 'printing', { progress: 0, message: 'הגשר שולח פקודת הדפסה למדפסת' });
        client.publish(requestTopic, JSON.stringify({ print: {
          sequence_id: String(Date.now()), command: 'project_file', param: cfg.printer.plateGcode,
          url: `file:///sdcard/${remoteName}`, subtask_name: (job.printFileName || 'print').replace(/\.gcode\.3mf$/i, ''),
          use_ams: cfg.printer.useAms, timelapse: false, bed_leveling: true, flow_cali: false, vibration_cali: true, layer_inspect: false,
        } }));
      } catch (err) {
        // The cancellation request is visible only when the bridge asks to
        // begin printing. Acknowledge it instead of turning a pre-start owner
        // cancellation into a failed physical print.
        if (/cancel_requested|Print cancellation requested/i.test(String(err.message))) {
          try { await report(cfg, job, 'cancelled', { message: 'הגשר אישר ביטול לפני פקודת ההדפסה' }); finish(resolve); }
          catch (cancelError) { finish(reject, cancelError); }
          return;
        }
        finish(reject, err);
      }
    }));
    client.on('message', (_topic, payload) => {
      let message; try { message = JSON.parse(payload.toString()); } catch { return; }
      const print = message.print; if (!print) return;
      if (typeof print.mc_percent === 'number' && print.mc_percent !== lastProgress) {
        lastProgress = print.mc_percent; reportBestEffort(cfg, job, 'printing', { progress: print.mc_percent });
      }
      if (print.gcode_state === 'FINISH') finish(resolve);
      if (print.gcode_state === 'FAILED') finish(reject, new Error('printer reported FAILED'));
    });
    client.on('error', (error) => finish(reject, error));
  });
}

async function legacyTempDownload(job) {
  if (!job.printFileUrl) throw new Error('No local checksum and no legacy print URL are available');
  const response = await fetch(job.printFileUrl);
  if (!response.ok) throw new Error(`legacy print-file download failed: ${response.status}`);
  const target = path.join(os.tmpdir(), `jmp-${job.id}.gcode.3mf`);
  await fsp.writeFile(target, Buffer.from(await response.arrayBuffer()), { flag: 'w' });
  return { target, cleanup: () => fsp.rm(target, { force: true }) };
}

async function runReal(cfg, library, job) {
  await report(cfg, job, 'uploading', { message: 'הגשר מעביר את הקובץ המקומי למדפסת' });
  let temporary = null;
  let source = job.printFileChecksum ? library.localPath(job.printFileChecksum) : null;
  if (!source) {
    temporary = await legacyTempDownload(job);
    source = temporary.target;
  }
  try {
    const remoteName = await uploadToPrinter(cfg, job, source);
    await startAndMonitor(cfg, job, remoteName);
    await report(cfg, job, 'done', { progress: 100 });
  } finally { if (temporary) await temporary.cleanup(); }
}

async function processJob(cfg, library, job) {
  try {
    await keepClaimAlive(cfg, job, () => (cfg.simulate ? runSimulated(cfg, job) : runReal(cfg, library, job)));
  } catch (error) {
    log(`  ! job ${job.id} failed:`, error.message);
    await reportBestEffort(cfg, job, 'failed', { error: error.message });
  }
}

async function main() {
  const cfg = loadConfig();
  const library = new FileLibrary({ storageDir: cfg.storageDir, maxBytes: cfg.maxBytes, logger: console });
  let stopping = false;
  const stop = (signal) => { stopping = true; log(`${signal}: stopping after current request`); };
  process.once('SIGINT', () => stop('SIGINT')); process.once('SIGTERM', () => stop('SIGTERM'));
  log(`bridge "${cfg.bridgeId}" → ${cfg.siteUrl} (${cfg.simulate ? 'SIMULATE' : `printer ${cfg.printer.ip}`})`);
  await syncLibrary(cfg, library); // Never claim before the full inventory is known server-side.
  let nextScanAt = Date.now() + cfg.scanMs;
  while (!stopping) {
    try {
      if (Date.now() >= nextScanAt) { await syncLibrary(cfg, library); nextScanAt = Date.now() + cfg.scanMs; }
      const { job } = await claimNext(cfg);
      if (job) { await processJob(cfg, library, job); continue; }
    } catch (error) { log('poll/sync error:', error.message); }
    await sleep(cfg.pollMs);
  }
}

main().catch((error) => { console.error('bridge fatal:', error.message); process.exitCode = 1; });
