'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage, app } = require('electron');

const filePath = () => path.join(app.getPath('userData'), 'bridge-desktop-config.bin');
async function load() {
  try {
    const raw = await fs.readFile(filePath());
    return JSON.parse(safeStorage.decryptString(raw));
  } catch { return { version: 1, mode: 'local', configured: false, launch: {} }; }
}
async function save(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('secure_storage_unavailable');
  const safe = { version: 1, mode: 'local', configured: Boolean(value.configured), launch: value.launch || {} };
  const target = filePath(); const temp = `${target}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temp, safeStorage.encryptString(JSON.stringify(safe)), { mode: 0o600 });
  await fs.rename(temp, target);
  // This return value stays inside Electron main. The renderer receives only
  // the deliberately small bootstrap result from main.js.
  return safe;
}
module.exports = { load, save };
