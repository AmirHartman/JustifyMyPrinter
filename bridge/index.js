'use strict';

// Outbound-only LAN bridge. Print bytes remain in the local library; the site
// receives inventory metadata and owns approval, allocation, and queue state.
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { FileLibrary, diskStatus } = require('./file-library');
const { loadConfig } = require('./config');
const { startManagementApi } = require('./management-api');

const FAILURE_CODES = new Set(['upload_failed', 'printer_error', 'printer_rejected', 'mqtt_disconnected']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let runtimeLog = (event, detail = '') => console.log(new Date().toISOString(), event, detail);

function errorCode(error, fallback = 'printer_error') {
  const code = String(error?.code || '');
  return FAILURE_CODES.has(code) ? code : fallback;
}

function codedError(code, message, extra = {}) {
  return Object.assign(new Error(message || code), { code, ...extra });
}

async function apiFetch(cfg, target, body) {
  let response;
  try {
    response = await fetch(cfg.siteUrl + target, {
      method: body === undefined ? 'GET' : (body._method || 'POST'),
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': cfg.secret, Authorization: `Bearer ${cfg.secret}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    const error = new Error('Site request failed');
    error.code = 'site_unavailable';
    throw error;
  }
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* response details are intentionally discarded */ }
  if (!response.ok) {
    const error = new Error('Site request rejected');
    error.code = /^[a-z0-9_:-]{1,64}$/i.test(String(data.error || '')) ? String(data.error) : 'site_rejected';
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function syncLibrary(cfg, library) {
  const files = await library.scan();
  const disk = await diskStatus(cfg.storageDir);
  await apiFetch(cfg, '/api/bridge-files?action=sync', { bridgeId: cfg.bridgeId, status: 'online', files, ...disk });
  return { files, disk, lowDisk: disk.diskFreeBytes != null && disk.diskFreeBytes < cfg.minFreeBytes };
}

const claimNext = (cfg) => apiFetch(cfg, '/api/print-jobs?action=claim-next', { bridgeId: cfg.bridgeId });

function report(cfg, job, status, extra = {}) {
  job.status = status;
  if (Number.isFinite(Number(extra.progress))) job.progress = Number(extra.progress);
  return apiFetch(cfg, `/api/print-jobs?id=${encodeURIComponent(job.id)}&action=report`, {
    _method: 'PUT', claimToken: job.claimToken, status, ...extra,
  });
}

function heartbeat(cfg, job) {
  return apiFetch(cfg, `/api/print-jobs?id=${encodeURIComponent(job.id)}&action=heartbeat`, { _method: 'PUT', claimToken: job.claimToken });
}

function reportBestEffort(cfg, job, status, extra) {
  return report(cfg, job, status, extra).catch((error) => runtimeLog('report_failed', String(error.code || 'site_error')));
}

async function keepClaimAlive(cfg, job, work) {
  const interval = setInterval(() => {
    heartbeat(cfg, job).catch((error) => runtimeLog('heartbeat_failed', String(error.code || 'site_error')));
  }, Math.min(Math.max(Math.floor(cfg.pollMs * 3), 10 * 1000), 25 * 1000));
  interval.unref?.();
  try { return await work(); } finally { clearInterval(interval); }
}

async function runSimulated(cfg, job) {
  runtimeLog('simulation_started', String(job.id));
  await report(cfg, job, 'uploading');
  await sleep(500);
  try {
    await report(cfg, job, 'printing', { progress: 0 });
  } catch (error) {
    if (error.code === 'cancel_requested') {
      await report(cfg, job, 'cancelled');
      return;
    }
    throw error;
  }
  for (const progress of [15, 40, 70, 95]) {
    await sleep(500);
    await report(cfg, job, 'printing', { progress });
  }
  await report(cfg, job, 'done', { progress: 100 });
}

async function uploadToPrinter(cfg, job, localPath) {
  const ftp = require('basic-ftp');
  const client = new ftp.Client(30000);
  try {
    await client.access({
      host: cfg.printer.ip,
      port: 990,
      user: 'bblp',
      password: cfg.printer.accessCode,
      secure: 'implicit',
      secureOptions: { rejectUnauthorized: false },
    });
    const remoteName = job.printFileName || `${job.id}.gcode.3mf`;
    await client.uploadFrom(localPath, remoteName);
    return remoteName;
  } catch {
    throw codedError('upload_failed', 'Printer upload failed', { phase: 'before_command' });
  } finally {
    client.close();
  }
}

function startAndMonitor(cfg, job, remoteName) {
  const mqtt = require('mqtt');
  const { serial, accessCode, ip } = cfg.printer;
  return new Promise((resolve, reject) => {
    const reconnectBackoff = [2000, 5000, 10000, 20000, 30000];
    const client = mqtt.connect(`mqtts://${ip}:8883`, {
      username: 'bblp', password: accessCode, rejectUnauthorized: false, reconnectPeriod: 0, connectTimeout: 15000,
    });
    const reportTopic = `device/${serial}/report`;
    const requestTopic = `device/${serial}/request`;
    let finished = false;
    let lastProgress = -1;
    let commandIssued = false;
    let reconnecting = false;
    let reconnectResolution = null;
    let guard;

    const finish = (callback, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      reconnectResolution?.(false);
      reconnectResolution = null;
      client.end(true);
      callback(value);
    };

    const attention = () => finish(reject, codedError('mqtt_disconnected', 'Printer connection became uncertain', {
      attentionRequired: true,
      phase: 'after_command',
    }));

    const reconnectAttempt = (timeoutMs) => new Promise((done) => {
      let settled = false;
      const complete = (connected) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reconnectResolution = null;
        done(connected);
      };
      const timer = setTimeout(() => complete(false), timeoutMs);
      reconnectResolution = complete;
      try { client.reconnect(); } catch { complete(false); }
    });

    const reconnect = async () => {
      if (finished || reconnecting) return;
      reconnecting = true;
      const deadline = Date.now() + 90_000;
      let attempt = 0;
      while (!finished && Date.now() < deadline) {
        const delay = reconnectBackoff[Math.min(attempt, reconnectBackoff.length - 1)];
        await sleep(Math.min(delay, Math.max(deadline - Date.now(), 0)));
        if (finished || Date.now() >= deadline) break;
        const connected = await reconnectAttempt(Math.min(5000, Math.max(deadline - Date.now(), 1)));
        if (connected) { reconnecting = false; return; }
        attempt += 1;
      }
      attention();
    };

    const connectionLost = () => {
      if (finished || reconnecting) return;
      if (!commandIssued) return finish(reject, codedError('printer_error', 'Printer connection failed', { phase: 'before_command' }));
      reconnect().catch(attention);
    };

    const publishCommand = async () => {
      try {
        // This site transition is the final cancellation gate immediately
        // before the physical MQTT command.
        await report(cfg, job, 'printing', { progress: 0 });
      } catch (error) {
        if (error.code === 'cancel_requested') {
          try { await report(cfg, job, 'cancelled'); finish(resolve, { cancelled: true }); }
          catch { finish(reject, codedError('printer_error', 'Cancellation acknowledgement failed', { phase: 'before_command' })); }
          return;
        }
        finish(reject, error);
        return;
      }
      const payload = JSON.stringify({ print: {
        sequence_id: String(Date.now()),
        command: 'project_file',
        param: cfg.printer.plateGcode,
        url: `file:///sdcard/${remoteName}`,
        subtask_name: (job.printFileName || 'print').replace(/\.gcode\.3mf$/i, ''),
        use_ams: cfg.printer.useAms,
        timelapse: false,
        bed_leveling: true,
        flow_cali: false,
        vibration_cali: true,
        layer_inspect: false,
      } });
      commandIssued = true;
      client.publish(requestTopic, payload, (error) => {
        if (error) finish(reject, codedError('printer_rejected', 'Printer command was rejected', { phase: 'after_command' }));
      });
    };

    client.on('connect', () => {
      client.subscribe(reportTopic, (error) => {
        if (error) {
          if (reconnectResolution) reconnectResolution(false);
          else connectionLost();
          return;
        }
        if (reconnectResolution) {
          reconnectResolution(true);
          return;
        }
        if (!commandIssued) publishCommand().catch(() => finish(reject, codedError('printer_error', 'Printer command failed', { phase: 'before_command' })));
      });
    });

    client.on('message', (_topic, payload) => {
      let message;
      try { message = JSON.parse(payload.toString('utf8')); } catch { return; }
      const print = message?.print;
      if (!print) return;
      if (print.command === 'project_file' && print.result && String(print.result).toLowerCase() !== 'success') {
        finish(reject, codedError('printer_rejected', 'Printer rejected the print command', { phase: 'after_command' }));
        return;
      }
      if (typeof print.mc_percent === 'number' && print.mc_percent !== lastProgress) {
        lastProgress = print.mc_percent;
        reportBestEffort(cfg, job, 'printing', { progress: print.mc_percent });
      }
      if (print.gcode_state === 'FINISH') finish(resolve, { cancelled: false });
      if (print.gcode_state === 'FAILED') finish(reject, codedError('printer_error', 'Printer reported failure', { phase: 'after_command' }));
    });
    client.on('error', connectionLost);
    client.on('close', connectionLost);

    const guardMs = Math.max((Number(job.printHours) || 2) * 5400 * 1000, 30 * 60 * 1000);
    guard = setTimeout(() => {
      if (commandIssued) attention();
      else finish(reject, codedError('printer_error', 'Printer connection timed out', { phase: 'before_command' }));
    }, guardMs);
    guard.unref?.();
  });
}

async function legacyTempDownload(job) {
  const url = job.legacyDownloadUrl || job.printFileUrl;
  if (!url) throw codedError('upload_failed', 'No print source is available', { phase: 'before_command' });
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(60_000) }); }
  catch { throw codedError('upload_failed', 'Legacy print download failed', { phase: 'before_command' }); }
  if (!response.ok || !response.body) throw codedError('upload_failed', 'Legacy print download failed', { phase: 'before_command' });
  const target = path.join(os.tmpdir(), `jmp-${job.id}.gcode.3mf`);
  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
      output.on('finish', resolve);
      output.on('error', reject);
      Readable.fromWeb(response.body).on('error', reject).pipe(output);
    });
  } catch {
    await fsp.rm(target, { force: true });
    throw codedError('upload_failed', 'Legacy print download failed', { phase: 'before_command' });
  }
  return { target, cleanup: () => fsp.rm(target, { force: true }) };
}

async function runReal(cfg, library, job) {
  await report(cfg, job, 'uploading');
  let temporary = null;
  let source = job.printFileChecksum ? library.localPath(job.printFileChecksum) : null;
  try {
    if (!source) {
      temporary = await legacyTempDownload(job);
      source = temporary.target;
    }
    const remoteName = await uploadToPrinter(cfg, job, source);
    const outcome = await startAndMonitor(cfg, job, remoteName);
    if (!outcome?.cancelled) await report(cfg, job, 'done', { progress: 100 });
  } catch (error) {
    if (!error.code || !FAILURE_CODES.has(error.code)) throw codedError('upload_failed', 'Print preparation failed', { phase: 'before_command' });
    throw error;
  } finally {
    if (temporary) await temporary.cleanup();
  }
}

async function processJob(cfg, library, job) {
  try {
    await keepClaimAlive(cfg, job, () => (cfg.simulate ? runSimulated(cfg, job) : runReal(cfg, library, job)));
  } catch (error) {
    const failureCode = errorCode(error, error?.phase === 'before_command' ? 'upload_failed' : 'printer_error');
    const status = error?.attentionRequired && failureCode === 'mqtt_disconnected' ? 'attention_required' : 'failed';
    runtimeLog('job_failed', `${job.id}:${failureCode}`);
    await reportBestEffort(cfg, job, status, { failureCode });
  }
}

async function main() {
  const cfg = await loadConfig();
  const library = new FileLibrary({ storageDir: cfg.storageDir, maxBytes: cfg.maxBytes, logger: { warn: () => runtimeLog('file_quarantined') } });
  await library.init();
  let stopping = false;
  let paused = false;
  let claiming = false;
  let current = null;
  let diskLow = false;
  const recentLogs = [];
  runtimeLog = (event, detail = '') => {
    const safeEvent = String(event).replace(/[^a-z0-9_:-]/gi, '_').slice(0, 64);
    const safeDetail = String(detail).replace(/[^a-z0-9_:-]/gi, '_').slice(0, 96);
    const line = `${new Date().toISOString()} ${safeEvent}${safeDetail ? ` ${safeDetail}` : ''}`;
    recentLogs.push(line);
    recentLogs.splice(0, Math.max(0, recentLogs.length - 500));
    console.log(line);
  };
  const state = {
    status: () => ({
      bridgeId: cfg.bridgeId,
      paused,
      currentJobId: current?.id || null,
      currentStatus: current?.status || null,
      files: library.inventory().length,
      libraryBusy: library.isBusy(),
      diskLow,
    }),
    currentJob: () => current ? { id: current.id, status: current.status, progress: current.progress || 0 } : null,
    libraryWorkAllowed: () => !claiming && !current,
    logs: () => recentLogs.slice(-100),
  };
  const scheduler = {
    pause: () => { paused = true; runtimeLog('scheduler_paused'); },
    resume: () => { paused = false; runtimeLog('scheduler_resumed'); },
    shutdown: () => { stopping = true; runtimeLog('shutdown_requested'); },
    siteDiagnostics: async () => {
      const queue = await apiFetch(cfg, '/api/print-jobs?action=bridge-queue');
      return { ok: true, queued: Array.isArray(queue.jobs) ? queue.jobs.length : 0 };
    },
    printerDiagnostics: async () => ({ ok: cfg.simulate, simulate: cfg.simulate }),
  };
  const managementServer = startManagementApi({ cfg, state, library, scheduler, logger: { warn: runtimeLog } });
  const stop = (signal) => { stopping = true; runtimeLog('signal_received', signal); };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  runtimeLog('bridge_started', cfg.simulate ? 'simulate' : 'printer');

  const initial = await syncLibrary(cfg, library);
  diskLow = initial.lowDisk;
  let nextScanAt = Date.now() + cfg.scanMs;
  while (!stopping) {
    try {
      if (Date.now() >= nextScanAt && !library.isBusy()) {
        const sync = await syncLibrary(cfg, library);
        diskLow = sync.lowDisk;
        nextScanAt = Date.now() + cfg.scanMs;
      }
      if (!paused && !diskLow && !library.isBusy()) {
        claiming = true;
        let job;
        try { ({ job } = await claimNext(cfg)); } finally { claiming = false; }
        if (job) {
          current = job;
          await processJob(cfg, library, job);
          current = null;
          continue;
        }
      }
    } catch (error) {
      claiming = false;
      runtimeLog('scheduler_error', String(error.code || 'operation_failed'));
    }
    await sleep(cfg.pollMs);
  }
  await new Promise((resolve) => managementServer.close(resolve));
  runtimeLog('bridge_stopped');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(new Date().toISOString(), 'bridge_fatal', String(error?.code || 'operation_failed'));
    process.exitCode = 1;
  });
}

module.exports = { apiFetch, codedError, main, processJob, startAndMonitor, syncLibrary };
