'use strict';

const fs = require('fs/promises');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { extract3mfEstimates } = require('./lib/three-mf-estimates');

const root = path.resolve(__dirname, '..');
const printDir = path.resolve(process.env.PRINT_FILES_DIR || path.join(root, 'print-files'));
const manifestPath = path.resolve(process.env.PRINT_FILES_MANIFEST || path.join(printDir, 'manifest.json'));
const serverUrl = String(process.env.JMP_SERVER_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const username = process.env.JMP_ADMIN_USERNAME;
const password = process.env.JMP_ADMIN_PASSWORD;

function fail(message) {
  console.error(`Print sync failed: ${message}`);
  process.exitCode = 1;
}

async function request(url, options = {}, cookie = '') {
  const response = await fetch(`${serverUrl}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return { response, payload };
}

async function login() {
  const existingSession = String(process.env.JMP_SESSION_COOKIE || '').trim();
  if (existingSession.startsWith('session=')) return existingSession;
  if (!username || !password) throw new Error('Set JMP_ADMIN_USERNAME and JMP_ADMIN_PASSWORD in .env.local');
  const { response, payload } = await request('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'login', name: username, password }),
  });
  if (payload.role !== 'admin') throw new Error('The configured account is not an admin');
  const setCookie = response.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';', 1)[0];
  if (!cookie.startsWith('session=')) throw new Error('The server did not return an admin session');
  return cookie;
}

async function syncEntry(entry, products, cookie) {
  if (!entry.file || !entry.syncKey) throw new Error('Each manifest entry needs file and syncKey');
  const product = entry.productId ? products.find((item) => item.id === String(entry.productId)) : null;
  const filePath = path.resolve(printDir, entry.file);
  if (path.relative(printDir, filePath).startsWith('..')) throw new Error('File must be inside PRINT_FILES_DIR');

  const buffer = await fs.readFile(filePath);
  const estimates = await extract3mfEstimates(buffer);
  const totalGrams = estimates.materialGrams.reduce((sum, value) => sum + value, 0);
  const checksum = createHash('sha256').update(buffer).digest('hex');
  const result = await request('/api/products?action=sync', {
    method: 'POST',
    body: JSON.stringify({
      syncKey: entry.syncKey,
      name: String(entry.name || product?.name || estimates.productName || path.basename(entry.file, path.extname(entry.file))).replace(/\.gcode$/i, ''),
      filename: path.basename(entry.file), checksum,
      printHours: Math.round(estimates.printHours * 100) / 100,
      materialGrams: estimates.materialGrams,
      printProfile: estimates.printProfile,
      printProfileName: estimates.printProfileName,
      purgeGrams: estimates.purgeGrams,
      warnings: [],
    }),
  }, cookie);
  entry.productId = result.payload.id;
  const status = result.payload.printSync?.status === 'needs_material' ? 'ממתין לבחירת פילמנט' : `₪${Number(result.payload.cost).toFixed(2)}`;
  const purge = estimates.purgeGrams > 0 ? ` + ${estimates.purgeGrams.toFixed(2)}g purge` : '';
  console.log(`${entry.file}: ${estimates.printHours.toFixed(2)}h, ${totalGrams.toFixed(2)}g${purge}, ${status} -> ${result.payload.name}`);
}

async function main() {
  if (process.argv.includes('--inspect')) {
    const files = (await fs.readdir(printDir)).filter((file) => /\.3mf$/i.test(file));
    if (!files.length) throw new Error(`No 3MF files found in ${printDir}`);
    let failures = 0;
    for (const file of files) {
      try {
        const result = await extract3mfEstimates(await fs.readFile(path.join(printDir, file)));
        const grams = result.materialGrams.reduce((sum, value) => sum + value, 0);
        const purge = result.purgeGrams > 0 ? ` + ${result.purgeGrams.toFixed(2)}g purge` : '';
        console.log(`${file}: ${result.printHours.toFixed(2)}h, ${grams.toFixed(2)}g${purge}`);
      } catch (error) {
        failures += 1;
        console.error(`${file}: ${error.message}`);
      }
    }
    if (failures) throw new Error(`${failures} of ${files.length} files could not be read`);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const files = (await fs.readdir(printDir)).filter((file) => /\.3mf$/i.test(file));
    if (!files.length) throw new Error(`No 3MF files found in ${printDir}`);
    manifest = files.map((file) => ({ file, syncKey: randomUUID() }));
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Created local manifest: ${manifestPath}`);
  }
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('manifest.json must contain a non-empty array');
  for (const entry of manifest) {
    if (!entry.syncKey) entry.syncKey = randomUUID();
  }
  const cookie = await login();
  const { payload: products } = await request('/api/products', {}, cookie);
  let failures = 0;
  for (const entry of manifest) {
    try {
      await syncEntry(entry, products, cookie);
    } catch (error) {
      failures += 1;
      console.error(`${entry.file || '(unknown file)'}: ${error.message}`);
    }
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (failures) throw new Error(`${failures} of ${manifest.length} files failed`);
}

main().catch((error) => fail(error.message));
