'use strict';

// ── JustifyMyPrinter — local print bridge ──────────────────────────────────
// Runs on a machine on the same LAN as the Bambu P2S (a laptop, a Raspberry Pi).
// It never accepts inbound connections: it *pulls* approved jobs from the site
// and reports progress back, so the site (on Render) needs no route into your
// home network. Two modes:
//   • SIMULATE=true (default when PRINTER_IP is unset): fakes upload + print with
//     timed progress, so you can watch the whole flow light up on the site with
//     no printer attached.
//   • real: downloads the sliced file, uploads it to the P2S over FTPS, sends the
//     MQTT start command, and mirrors the printer's progress back to the site.
//
// mqtt + basic-ftp are only required in real mode, so SIMULATE mode runs with
// zero installed dependencies (Node's built-in fetch does the rest).

const fs = require('fs');
const os = require('os');
const path = require('path');

function loadConfig() {
  const env = process.env;
  const simulate = env.SIMULATE ? env.SIMULATE === 'true' : !env.PRINTER_IP;
  const cfg = {
    siteUrl: (env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    secret: env.BRIDGE_SECRET || '',
    bridgeId: env.BRIDGE_ID || os.hostname() || 'bridge',
    pollMs: Math.max(Number(env.POLL_INTERVAL_MS) || 5000, 1000),
    simulate,
    printer: {
      ip: env.PRINTER_IP || '',
      serial: env.PRINTER_SERIAL || '',
      accessCode: env.PRINTER_ACCESS_CODE || '',
      // Which plate's gcode inside the .3mf to print, and whether to use the AMS.
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

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function apiFetch(cfg, pathAndQuery, body) {
  const res = await fetch(cfg.siteUrl + pathAndQuery, {
    method: body === undefined ? 'GET' : (body._method || 'POST'),
    headers: { 'Content-Type': 'application/json', 'x-bridge-secret': cfg.secret },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status} ${json.error || res.statusText}`);
  return json;
}

const claimNext = (cfg) => apiFetch(cfg, '/api/print-jobs?action=claim-next', { bridgeId: cfg.bridgeId });

function report(cfg, jobId, status, extra = {}) {
  return apiFetch(cfg, `/api/print-jobs?id=${encodeURIComponent(jobId)}&action=report`, {
    _method: 'PUT', status, ...extra,
  });
}

function reportBestEffort(cfg, jobId, status, extra = {}) {
  return report(cfg, jobId, status, extra)
    .catch((err) => log(`  ! report(${status}) failed:`, err.message));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── SIMULATE: no printer, just walk the timeline so the site shows the flow ──
async function runSimulated(cfg, job) {
  log(`  [sim] uploading ${job.printFileName || job.printFileUrl}`);
  await report(cfg, job.id, 'uploading', { message: 'הגשר (סימולציה) מעביר את הקובץ למדפסת' });
  await sleep(1500);
  await report(cfg, job.id, 'printing', { progress: 0, message: 'המדפסת (סימולציה) התחילה להדפיס' });
  for (const pct of [15, 40, 70, 95]) { await sleep(1500); await report(cfg, job.id, 'printing', { progress: pct }); }
  await sleep(1000);
  await report(cfg, job.id, 'done', { progress: 100 });
  log('  [sim] done');
}

// ── REAL: FTPS upload + MQTT start + progress monitor ──
async function uploadToPrinter(cfg, job, localPath) {
  const ftp = require('basic-ftp');
  const client = new ftp.Client(30000);
  try {
    await client.access({
      host: cfg.printer.ip, port: 990, user: 'bblp', password: cfg.printer.accessCode,
      secure: 'implicit', secureOptions: { rejectUnauthorized: false },
    });
    const remoteName = job.printFileName || 'print.gcode.3mf';
    await client.uploadFrom(localPath, remoteName);
    return remoteName;
  } finally {
    client.close();
  }
}

function startAndMonitor(cfg, job, remoteName) {
  const mqtt = require('mqtt');
  const { serial, accessCode, ip } = cfg.printer;
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(`mqtts://${ip}:8883`, {
      username: 'bblp', password: accessCode, rejectUnauthorized: false, reconnectPeriod: 0, connectTimeout: 15000,
    });
    const reportTopic = `device/${serial}/report`;
    const requestTopic = `device/${serial}/request`;
    let lastPct = -1;
    let finished = false;
    const done = (fn, arg) => { if (finished) return; finished = true; clearTimeout(guard); client.end(true); fn(arg); };
    // Safety net: if the printer never reports a terminal state, don't hang forever.
    const guard = setTimeout(() => done(reject, new Error('printer did not report completion in time')), Math.max((Number(job.printHours) || 2) * 3600 * 1000 * 1.5, 30 * 60 * 1000));

    client.on('connect', () => {
      client.subscribe(reportTopic, async (subscribeError) => {
        if (subscribeError) return done(reject, subscribeError);
        try {
          // The site must accept the visible transition before the physical
          // start command is sent. This preserves the transparency guarantee.
          await report(cfg, job.id, 'printing', { progress: 0, message: 'הגשר שולח פקודת הדפסה למדפסת' });
          const startCmd = {
            print: {
              sequence_id: String(Date.now()),
              command: 'project_file',
              param: cfg.printer.plateGcode,
              url: `file:///sdcard/${remoteName}`,
              subtask_name: (job.printFileName || 'print').replace(/\.gcode\.3mf$/i, ''),
              use_ams: cfg.printer.useAms,
              timelapse: false, bed_leveling: true, flow_cali: false, vibration_cali: true, layer_inspect: false,
              // NOTE: ams_mapping / plate index may need tuning per model. selected_colors
              // (filament ids) are on the job for future AMS-slot mapping.
            },
          };
          client.publish(requestTopic, JSON.stringify(startCmd));
        } catch (err) {
          done(reject, err);
        }
      });
    });

    client.on('message', (_topic, buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      const p = msg.print;
      if (!p) return;
      if (typeof p.mc_percent === 'number' && p.mc_percent !== lastPct) {
        lastPct = p.mc_percent;
        reportBestEffort(cfg, job.id, 'printing', { progress: p.mc_percent });
      }
      const state = p.gcode_state;
      if (state === 'FINISH') done(resolve);
      else if (state === 'FAILED') done(reject, new Error('printer reported FAILED'));
    });

    client.on('error', (err) => done(reject, err));
  });
}

async function runReal(cfg, job) {
  await report(cfg, job.id, 'uploading', { message: 'מוריד את הקובץ ומעלה למדפסת' });
  const tmp = path.join(os.tmpdir(), `jmp-${job.id}.3mf`);
  const res = await fetch(job.printFileUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  try {
    const remoteName = await uploadToPrinter(cfg, job, tmp);
    log(`  uploaded as ${remoteName}; starting print`);
    await startAndMonitor(cfg, job, remoteName);
    await report(cfg, job.id, 'done', { progress: 100 });
    log('  print finished');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function processJob(cfg, job) {
  log(`claimed job ${job.id} (${job.source}) → ${job.productName || job.productId}`);
  try {
    if (cfg.simulate) await runSimulated(cfg, job);
    else await runReal(cfg, job);
  } catch (err) {
    log('  ! job failed:', err.message);
    await reportBestEffort(cfg, job.id, 'failed', { error: err.message });
  }
}

async function main() {
  const cfg = loadConfig();
  log(`bridge "${cfg.bridgeId}" → ${cfg.siteUrl}  (mode: ${cfg.simulate ? 'SIMULATE' : 'real ' + cfg.printer.ip})`);
  // Serial loop: claim one job, run it to completion, then poll again. One
  // printer means one job at a time — no concurrency needed.
  for (;;) {
    try {
      const { job } = await claimNext(cfg);
      if (job) { await processJob(cfg, job); continue; }
    } catch (err) {
      log('poll error:', err.message);
    }
    await sleep(cfg.pollMs);
  }
}

main().catch((err) => { console.error('bridge fatal:', err.message); process.exit(1); });
