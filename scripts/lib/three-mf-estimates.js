'use strict';

const { spawn, spawnSync } = require('child_process');
const readline = require('readline');

function parseDuration(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);

  let seconds = 0;
  let matched = false;
  const units = [
    [/([\d.]+)\s*d(?:ays?)?/g, 86400],
    [/([\d.]+)\s*h(?:ours?)?/g, 3600],
    [/([\d.]+)\s*m(?:in(?:utes?)?)?/g, 60],
    [/([\d.]+)\s*s(?:ec(?:onds?)?)?/g, 1],
  ];
  for (const [pattern, multiplier] of units) {
    for (const match of text.matchAll(pattern)) {
      seconds += Number(match[1]) * multiplier;
      matched = true;
    }
  }
  return matched ? seconds / 3600 : null;
}

function numberList(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .map((part) => Number(part))
    .filter((number) => Number.isFinite(number) && number >= 0);
}

function collectFromLine(line, result) {
  const timePatterns = [
    /total estimated time\s*[:=]\s*(.+)$/i,
    /estimated printing time[^:=]*[:=]\s*(.+)$/i,
    /(?:model )?printing time\s*[:=]\s*(.+)$/i,
  ];
  for (const pattern of timePatterns) {
    const match = line.match(pattern);
    const hours = match && parseDuration(match[1]);
    if (hours != null && hours > 0) result.printHours = hours;
  }

  const gramsMatch = line.match(/(?:total )?filament used\s*\[g\]\s*[:=]\s*(.+)$/i);
  if (gramsMatch) {
    const values = numberList(gramsMatch[1]);
    if (values.length) result.materialGrams = values;
  }

  const profileMatch = line.match(/default_print_profile\s*=\s*["']?(.+?)["']?\s*$/i);
  if (profileMatch && !result.printProfileName) result.printProfileName = profileMatch[1].trim();
}

function inferredProfile(result) {
  if (result.materialGrams.length > 1) return 'ams';
  const name = String(result.printProfileName || '').toLowerCase();
  return /0[.,](?:08|1[02])\s*mm|fine|extra.?fine|0[.,]2\s*nozzle/.test(name) ? 'complex' : 'regular';
}

function collectFromMetadata(text, result) {
  for (const line of text.split(/\r?\n/)) collectFromLine(line, result);

  try {
    const parsed = JSON.parse(text);
    const name = parsed?.bbox_objects?.[0]?.name;
    if (typeof name === 'string' && name.trim()) result.productName = name.trim();
  } catch {
    // Most metadata is XML or config text; JSON is optional.
  }

  const prediction = text.match(/\bprediction\s*=\s*["']([\d.]+)["']/i);
  if (prediction && !result.printHours) result.printHours = Number(prediction[1]) / 3600;

  const weights = [...text.matchAll(/\b(?:used_g|weight)\s*=\s*["']([\d.]+)["']/gi)]
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0);
  if (weights.length && !result.materialGrams.length) result.materialGrams = weights;
}

function archiveEntries(filePath) {
  const listed = spawnSync('unzip', ['-Z1', filePath], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (listed.error?.code === 'ENOENT') throw new Error('The unzip command is required but was not found');
  if (listed.status !== 0) throw new Error(`Invalid or unreadable 3MF archive: ${listed.stderr.trim()}`);
  return listed.stdout.split(/\r?\n/).filter(Boolean);
}

function readEntry(filePath, entry, maxBytes = 4 * 1024 * 1024) {
  const extracted = spawnSync('unzip', ['-p', filePath, entry], { encoding: 'utf8', maxBuffer: maxBytes });
  if (extracted.status !== 0) return '';
  return extracted.stdout;
}

async function scanGcode(filePath, entry, result) {
  const child = spawn('unzip', ['-p', filePath, entry], { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) collectFromLine(line, result);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (exitCode !== 0) throw new Error(`Could not inspect ${entry}`);
}

async function extract3mfEstimates(filePath) {
  const entries = archiveEntries(filePath);
  const gcodeEntries = entries.filter((name) => /\.gcode$/i.test(name));
  const result = {
    printHours: null, materialGrams: [], sources: [], productName: '',
    printProfile: 'regular', printProfileName: '', purgeGrams: 0,
  };
  const metadataEntries = entries.filter((entry) =>
    /(?:slice_info|project_settings|model_settings|metadata).*(?:\.config|\.xml|\.json)$/i.test(entry)
  );
  for (const entry of metadataEntries) {
    const text = readEntry(filePath, entry);
    if (!text) continue;
    collectFromMetadata(text, result);
    result.sources.push(entry);
  }

  for (const entry of gcodeEntries) {
    await scanGcode(filePath, entry, result);
    result.sources.push(entry);
  }

  result.materialGrams = result.materialGrams.filter((grams) => grams > 0);
  if (!result.printHours || !result.materialGrams.length) {
    if (!gcodeEntries.length) {
      throw new Error('This is a 3MF project without sliced output. In Bambu Studio use Export plate sliced file to create a .gcode.3mf file');
    }
    throw new Error('No sliced print-time and material estimates were found in the 3MF');
  }
  // Bambu's sliced "filament used [g]" is total consumption for the plate,
  // including purge/wipe. Adding purge again would overprice the item.
  result.printProfile = inferredProfile(result);
  return result;
}

module.exports = { extract3mfEstimates, parseDuration };
