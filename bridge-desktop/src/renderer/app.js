'use strict';

const $ = (selector) => document.querySelector(selector);
const notice = (value) => { $('#notice').textContent = value || ''; };
const text = (value) => String(value ?? 'לא ידוע');
let setupIsExisting = false;
let refreshInFlight = false;
const cleanup = [];

function list(node, values, mapper) {
  node.replaceChildren(...(values || []).map((value) => {
    const item = document.createElement('li');
    item.textContent = mapper(value);
    return item;
  }));
}

function setPrinterFields() {
  const simulated = $('#simulate').checked;
  $('#printer-fields').toggleAttribute('aria-disabled', simulated);
  for (const field of $('#printer-fields').querySelectorAll('input')) {
    field.disabled = simulated;
    field.required = !simulated && (
      ['printerIp', 'printerSerial'].includes(field.name)
      || (field.name === 'printerAccessCode' && !setupIsExisting)
    );
  }
}

function showSetup() {
  $('#wizard').hidden = false;
  $('#app').hidden = true;
  const secret = $('#bridgeSecret');
  secret.required = !setupIsExisting;
  secret.placeholder = setupIsExisting ? 'השאירו ריק לשמירת הסוד הקיים' : '';
  $('#setup-title').focus();
}

function showApp() {
  $('#wizard').hidden = true;
  $('#app').hidden = false;
}

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const [status, library, queue] = await Promise.all([
      window.bridgeDesktop.status(), window.bridgeDesktop.library(), window.bridgeDesktop.queue(),
    ]);
    if (!status.ok) return notice(status.message);
    const data = status.data;
    $('#daemon-state').textContent = text(data.state || data.daemon?.state);
    $('#printer-state').textContent = text(data.printer?.state);
    $('#site-state').textContent = text(data.site?.state);
    const job = data.currentJob || data.job;
    $('#job').textContent = job ? `${text(job.name || job.id)} · ${text(job.status)}` : 'אין משימה פעילה.';
    const progress = Math.max(0, Math.min(100, Number(job?.progress) || 0));
    $('#progress').style.width = `${progress}%`;
    $('.progress').setAttribute('aria-valuenow', String(progress));
    if (library.ok) list($('#library'), library.data.files || library.data.items, (file) => `${file.fileName || file.name} — ${file.state || 'תקין'}`);
    if (queue.ok) list($('#queue'), queue.data.jobs || queue.data.items, (jobItem) => `${jobItem.name || jobItem.id} — ${jobItem.status}`);
  } finally {
    refreshInFlight = false;
  }
}

async function action(call, message) {
  const result = await call();
  notice(result.ok ? message : result.message);
  if (result.ok) void refresh();
  return result;
}

function setupPayload(form) {
  return {
    mode: 'local',
    daemonExecutable: form.get('daemonExecutable'),
    daemonConfig: {
      siteUrl: form.get('siteUrl'),
      bridgeSecret: form.get('bridgeSecret'),
      bridgeId: 'home-bridge',
      storageDir: form.get('storageDir'),
      simulate: form.get('simulate') === 'on',
      printer: {
        ip: form.get('printerIp'),
        serial: form.get('printerSerial'),
        accessCode: form.get('printerAccessCode'),
        plateGcode: form.get('plateGcode'),
        useAms: form.get('useAms') === 'on',
      },
    },
  };
}

$('#setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = $('#save-setup');
  submit.disabled = true;
  const result = await window.bridgeDesktop.saveSetup(setupPayload(new FormData(event.currentTarget)));
  submit.disabled = false;
  if (!result.ok) return notice(result.message);
  // Never reset or render saved secrets: clearing the DOM is intentional.
  event.currentTarget.reset();
  setupIsExisting = true;
  setPrinterFields();
  showApp();
  notice(result.deferred ? 'ההגדרות נשמרו בהצפנה ויוחלו בהפעלה הבאה של הגשר.' : 'ההגדרות נשמרו בהצפנה. ממתינים לגשר המקומי.');
  void refresh();
});

$('#settings').addEventListener('click', showSetup);
$('#simulate').addEventListener('change', setPrinterFields);
$('#scan').addEventListener('click', () => action(window.bridgeDesktop.scan, 'הסריקה והסנכרון התחילו.'));
$('#pause').addEventListener('click', () => action(window.bridgeDesktop.pauseNewWork, 'קבלת עבודה חדשה הושהתה.'));
$('#resume').addEventListener('click', () => action(window.bridgeDesktop.resumeNewWork, 'קבלת עבודה חדשה חודשה.'));
$('#import').addEventListener('click', () => action(window.bridgeDesktop.importFile, 'הקובץ נשלח לגשר לעיבוד.'));
document.querySelectorAll('[data-diagnose]').forEach((button) => button.addEventListener('click', async () => {
  const result = await window.bridgeDesktop.diagnose(button.dataset.diagnose);
  $('#diagnostics').textContent = result.ok ? JSON.stringify(result.data, null, 2) : result.message;
}));
$('#logs').addEventListener('click', async () => {
  const result = await window.bridgeDesktop.logs();
  $('#diagnostics').textContent = result.ok ? JSON.stringify(result.data, null, 2) : result.message;
});
cleanup.push(window.bridgeDesktop.onImportProgress(({ sent, total }) => {
  $('#import-progress').textContent = `הועברו ${Math.round((sent / total) * 100)}% מהקובץ לגשר המקומי…`;
}));
cleanup.push(window.bridgeDesktop.onQuitBlocked(() => notice('אי אפשר לצאת בזמן הדפסה פעילה; הגשר ימשיך לנטר במגש המערכת.')));
cleanup.push(window.bridgeDesktop.onDaemonState((state) => { $('#daemon-state').textContent = text(state?.state); }));
window.addEventListener('beforeunload', () => cleanup.splice(0).forEach((unsubscribe) => unsubscribe()));
window.addEventListener('DOMContentLoaded', async () => {
  const boot = await window.bridgeDesktop.bootstrap();
  if (!boot.secureStorage) {
    showSetup();
    notice('הצפנת Windows אינה זמינה; אי אפשר להגדיר את הגשר.');
    return;
  }
  setupIsExisting = boot.configured;
  setPrinterFields();
  if (boot.configured) {
    showApp();
    void refresh();
  } else {
    showSetup();
  }
});
