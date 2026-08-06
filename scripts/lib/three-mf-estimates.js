'use strict';

const AdmZip = require('adm-zip');

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

function average(values, fallback) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

function filamentLengthToGrams(lengthMm, densities, diameters) {
  const density = average(densities, 1.24);
  const diameter = average(diameters, 1.75);
  const volumeMm3 = Math.max(Number(lengthMm) || 0, 0) * Math.PI * (diameter / 2) ** 2;
  return volumeMm3 / 1000 * density;
}

function createGcodeState() {
  return {
    inFlush: false,
    relativeExtrusion: true,
    lastExtrusion: 0,
    explicitFlushMm: 0,
    commandFlushMm: 0,
    densities: [],
    diameters: [],
  };
}

function collectPurgeFromGcodeLine(line, state) {
  const text = String(line || '').trim();
  const densityMatch = text.match(/^;\s*filament_density\s*[:=]\s*(.+)$/i);
  if (densityMatch) state.densities = numberList(densityMatch[1]);
  const diameterMatch = text.match(/^;\s*filament_diameter\s*[:=]\s*(.+)$/i);
  if (diameterMatch) state.diameters = numberList(diameterMatch[1]);

  if (/^;\s*V?FLUSH_START\b/i.test(text)) {
    state.inFlush = true;
    return;
  }
  if (/^;\s*V?FLUSH_END\b/i.test(text)) {
    state.inFlush = false;
    return;
  }
  if (/^M82\b/i.test(text)) state.relativeExtrusion = false;
  if (/^M83\b/i.test(text)) state.relativeExtrusion = true;

  const resetMatch = text.match(/^G92\b[^;]*\bE(-?[\d.]+)/i);
  if (resetMatch) state.lastExtrusion = Number(resetMatch[1]) || 0;

  if (state.inFlush) {
    const extrusionMatch = text.match(/^G(?:0?1)\b[^;]*\bE(-?[\d.]+)/i);
    if (extrusionMatch) {
      const extrusion = Number(extrusionMatch[1]);
      const delta = state.relativeExtrusion ? extrusion : extrusion - state.lastExtrusion;
      if (Number.isFinite(delta) && delta > 0) state.explicitFlushMm += delta;
      if (!state.relativeExtrusion && Number.isFinite(extrusion)) state.lastExtrusion = extrusion;
    }
  }

  // Newer Bambu G-code delegates the flush movement to firmware. A1 selects
  // the incoming-filament command; counting only it avoids counting A0 twice.
  const commandMatch = text.match(/^M620\.10\b(?=[^;]*\bA1\b)[^;]*\bL([\d.]+)/i);
  if (commandMatch) state.commandFlushMm += Number(commandMatch[1]) || 0;
}

function collectFromLine(line, result) {
  const timePatterns = [
    /total estimated time\s*[:=]\s*([^;]+)/i,
    /estimated printing time[^:=]*[:=]\s*([^;]+)/i,
    /(?:model )?printing time\s*[:=]\s*([^;]+)/i,
  ];
  for (const pattern of timePatterns) {
    const match = line.match(pattern);
    const hours = match && parseDuration(match[1]);
    if (hours != null && hours > 0) {
      result.printHours = hours;
      break;
    }
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

function openArchive(buffer) {
  try {
    return new AdmZip(buffer);
  } catch (err) {
    throw new Error(`Invalid or unreadable 3MF archive: ${err.message}`);
  }
}

function archiveEntries(zip) {
  return zip.getEntries().map((entry) => entry.entryName).filter(Boolean);
}

function readEntry(zip, entry, maxBytes = 4 * 1024 * 1024) {
  const zipEntry = zip.getEntry(entry);
  if (!zipEntry) return '';
  const data = zipEntry.getData();
  if (!data || !data.length) return '';
  return data.subarray(0, maxBytes).toString('utf8');
}

async function scanGcode(zip, entry, result) {
  const zipEntry = zip.getEntry(entry);
  if (!zipEntry) throw new Error(`Could not inspect ${entry}`);
  let data;
  try {
    data = zipEntry.getData();
  } catch {
    throw new Error(`Could not inspect ${entry}`);
  }
  const state = createGcodeState();
  for (const line of data.toString('utf8').split(/\r?\n/)) {
    collectFromLine(line, result);
    collectPurgeFromGcodeLine(line, state);
  }
  const purgeLengthMm = state.explicitFlushMm || state.commandFlushMm;
  result.purgeGrams += filamentLengthToGrams(purgeLengthMm, state.densities, state.diameters);
}

async function extract3mfEstimates(buffer, { requirePlateGcode = false } = {}) {
  const zip = openArchive(buffer);
  const entries = archiveEntries(zip);
  const gcodeEntries = entries.filter((name) => /\.gcode$/i.test(name));
  if (requirePlateGcode && !entries.includes('Metadata/plate_1.gcode')) {
    throw new Error('This is not a sliced Bambu plate: Metadata/plate_1.gcode is missing');
  }
  const result = {
    printHours: null, materialGrams: [], sources: [], productName: '',
    printProfile: 'regular', printProfileName: '', purgeGrams: 0,
  };
  const metadataEntries = entries.filter((entry) =>
    /(?:slice_info|project_settings|model_settings|metadata).*(?:\.config|\.xml|\.json)$/i.test(entry)
  );
  for (const entry of metadataEntries) {
    const text = readEntry(zip, entry);
    if (!text) continue;
    collectFromMetadata(text, result);
    result.sources.push(entry);
  }

  for (const entry of gcodeEntries) {
    await scanGcode(zip, entry, result);
    result.sources.push(entry);
  }

  result.materialGrams = result.materialGrams.filter((grams) => grams > 0);
  if (!result.printHours || !result.materialGrams.length) {
    if (!gcodeEntries.length) {
      throw new Error('This is a 3MF project without sliced output. In Bambu Studio use Export plate sliced file to create a .gcode.3mf file');
    }
    throw new Error('No sliced print-time and material estimates were found in the 3MF');
  }
  result.purgeGrams = Math.round(result.purgeGrams * 100) / 100;
  result.printProfile = inferredProfile(result);
  return result;
}

module.exports = { extract3mfEstimates, parseDuration };
