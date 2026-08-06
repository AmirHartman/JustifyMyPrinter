'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const zlib = require('zlib');
const { Readable } = require('stream');
const { StringDecoder } = require('string_decoder');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_BYTES = 65_557;
const MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 2048;
const MAX_METADATA_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_METADATA_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_GCODE_ENTRY_BYTES = 1024 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
const NUMBER = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';

function archiveError(message) {
  const error = new Error(message);
  error.code = 'invalid_3mf';
  return error;
}

async function readExact(handle, position, length) {
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length < 0) {
    throw archiveError('Malformed 3MF archive offsets');
  }
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) throw archiveError('Unexpected end of 3MF archive');
    offset += bytesRead;
  }
  return buffer;
}

function safeEntryName(buffer, flags) {
  const encoding = flags & 0x0800 ? 'utf8' : 'utf8';
  const name = buffer.toString(encoding);
  if (!name || name.includes('\0') || name.startsWith('/') || name.startsWith('\\') || name.includes('\\')) {
    throw archiveError('Unsafe 3MF archive entry name');
  }
  if (name.split('/').some((component) => component === '..')) throw archiveError('Unsafe 3MF archive entry name');
  return name;
}

async function readArchiveEntries(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 22) throw archiveError('Invalid 3MF archive');
    const tailLength = Math.min(stat.size, MAX_EOCD_BYTES);
    const tail = await readExact(handle, stat.size - tailLength, tailLength);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === EOCD_SIGNATURE) { eocd = index; break; }
    }
    if (eocd < 0 || eocd + 22 > tail.length) throw archiveError('Invalid 3MF archive directory');
    const commentLength = tail.readUInt16LE(eocd + 20);
    if (eocd + 22 + commentLength !== tail.length) throw archiveError('Malformed 3MF archive trailer');

    const diskNumber = tail.readUInt16LE(eocd + 4);
    const directoryDisk = tail.readUInt16LE(eocd + 6);
    const diskEntries = tail.readUInt16LE(eocd + 8);
    const totalEntries = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (diskNumber || directoryDisk || diskEntries !== totalEntries) throw archiveError('Multi-disk 3MF archives are not supported');
    if (totalEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw archiveError('ZIP64 3MF archives are not supported');
    }
    if (!totalEntries || totalEntries > MAX_ENTRIES) throw archiveError('3MF archive entry count is out of range');
    if (directorySize <= 0 || directorySize > MAX_CENTRAL_DIRECTORY_BYTES) throw archiveError('3MF archive directory is too large');
    if (directoryOffset + directorySize > stat.size - 22) throw archiveError('Malformed 3MF archive directory bounds');

    const directory = await readExact(handle, directoryOffset, directorySize);
    const entries = new Map();
    let cursor = 0;
    for (let index = 0; index < totalEntries; index += 1) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
        throw archiveError('Malformed 3MF archive entry');
      }
      const flags = directory.readUInt16LE(cursor + 8);
      const method = directory.readUInt16LE(cursor + 10);
      const compressedSize = directory.readUInt32LE(cursor + 20);
      const uncompressedSize = directory.readUInt32LE(cursor + 24);
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const entryCommentLength = directory.readUInt16LE(cursor + 32);
      const startDisk = directory.readUInt16LE(cursor + 34);
      const localOffset = directory.readUInt32LE(cursor + 42);
      const recordLength = 46 + nameLength + extraLength + entryCommentLength;
      if (!nameLength || cursor + recordLength > directory.length) throw archiveError('Malformed 3MF archive entry lengths');
      if (flags & 0x0001) throw archiveError('Encrypted 3MF entries are not supported');
      if (method !== 0 && method !== 8) throw archiveError('Unsupported 3MF compression method');
      if (startDisk || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw archiveError('ZIP64 3MF entries are not supported');
      }
      if (localOffset + 30 > directoryOffset) throw archiveError('Malformed 3MF local entry offset');
      const name = safeEntryName(directory.subarray(cursor + 46, cursor + 46 + nameLength), flags);
      if (entries.has(name)) throw archiveError('Duplicate 3MF archive entry');
      entries.set(name, { name, flags, method, compressedSize, uncompressedSize, localOffset });
      cursor += recordLength;
    }
    if (cursor !== directory.length) throw archiveError('Malformed 3MF archive directory length');
    return { entries, fileSize: stat.size };
  } finally {
    await handle.close();
  }
}

async function entryDataOffset(file, entry, fileSize) {
  const handle = await fsp.open(file, 'r');
  try {
    const header = await readExact(handle, entry.localOffset, 30);
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw archiveError('Malformed 3MF local entry');
    const flags = header.readUInt16LE(6);
    const method = header.readUInt16LE(8);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    if (flags & 0x0001 || flags !== entry.flags || method !== entry.method || !nameLength) {
      throw archiveError('3MF local entry does not match directory');
    }
    const name = safeEntryName(await readExact(handle, entry.localOffset + 30, nameLength), flags);
    if (name !== entry.name) throw archiveError('3MF local entry name does not match directory');
    const start = entry.localOffset + 30 + nameLength + extraLength;
    if (start > fileSize || start + entry.compressedSize > fileSize) throw archiveError('Malformed 3MF entry bounds');
    return start;
  } finally {
    await handle.close();
  }
}

async function streamEntryLines(file, archive, entry, onLine, maxBytes) {
  if (entry.uncompressedSize > maxBytes) throw archiveError(`3MF entry ${entry.name} exceeds decompressed size limit`);
  const start = await entryDataOffset(file, entry, archive.fileSize);
  const compressed = entry.compressedSize
    ? fs.createReadStream(file, { start, end: start + entry.compressedSize - 1, highWaterMark: 64 * 1024 })
    : Readable.from([]);
  const output = entry.method === 8 ? compressed.pipe(zlib.createInflateRaw()) : compressed;
  const decoder = new StringDecoder('utf8');
  let carry = '';
  let decompressedBytes = 0;

  const acceptText = (text) => {
    carry += text;
    if (Buffer.byteLength(carry, 'utf8') > MAX_LINE_BYTES && !carry.includes('\n')) throw archiveError('3MF entry contains an overlong line');
    let newline;
    while ((newline = carry.indexOf('\n')) >= 0) {
      let line = carry.slice(0, newline);
      carry = carry.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) throw archiveError('3MF entry contains an overlong line');
      onLine(line);
    }
  };

  try {
    for await (const chunk of output) {
      decompressedBytes += chunk.length;
      if (decompressedBytes > maxBytes || decompressedBytes > entry.uncompressedSize) {
        throw archiveError(`3MF entry ${entry.name} exceeds decompressed size limit`);
      }
      acceptText(decoder.write(chunk));
    }
    acceptText(decoder.end());
  } catch (error) {
    if (error?.code === 'invalid_3mf') throw error;
    throw archiveError(`Could not inspect 3MF entry ${entry.name}`);
  }
  if (decompressedBytes !== entry.uncompressedSize) throw archiveError(`3MF entry ${entry.name} has an invalid decompressed size`);
  if (carry) {
    if (Buffer.byteLength(carry, 'utf8') > MAX_LINE_BYTES) throw archiveError('3MF entry contains an overlong line');
    onLine(carry.endsWith('\r') ? carry.slice(0, -1) : carry);
  }
}

function parseDuration(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  let seconds = 0;
  let matched = false;
  const units = [
    [/(\d+(?:\.\d+)?)\s*d(?:ays?)?\b/g, 86400],
    [/(\d+(?:\.\d+)?)\s*h(?:ours?)?\b/g, 3600],
    [/(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?\b/g, 60],
    [/(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\b/g, 1],
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
  return String(value || '').split(/[,;\s]+/).map(Number).filter((number) => Number.isFinite(number) && number >= 0);
}

function average(values, fallback) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function filamentLengthToGrams(lengthMm, densities, diameters) {
  const volumeMm3 = Math.max(Number(lengthMm) || 0, 0) * Math.PI * (average(diameters, 1.75) / 2) ** 2;
  return volumeMm3 / 1000 * average(densities, 1.24);
}

function createGcodeState() {
  return { inFlush: false, relativeExtrusion: true, lastExtrusion: 0, explicitFlushMm: 0, commandFlushMm: 0, densities: [], diameters: [] };
}

function collectPurgeFromGcodeLine(line, state) {
  const text = String(line || '').trim();
  const density = text.match(/^;\s*filament_density\s*[:=]\s*(.+)$/i);
  if (density) state.densities = numberList(density[1]);
  const diameter = text.match(/^;\s*filament_diameter\s*[:=]\s*(.+)$/i);
  if (diameter) state.diameters = numberList(diameter[1]);
  if (/^;\s*V?FLUSH_START\b/i.test(text)) { state.inFlush = true; return; }
  if (/^;\s*V?FLUSH_END\b/i.test(text)) { state.inFlush = false; return; }
  if (/^M82\b/i.test(text)) state.relativeExtrusion = false;
  if (/^M83\b/i.test(text)) state.relativeExtrusion = true;

  const reset = text.match(new RegExp(`^G92\\b[^;]*\\bE(${NUMBER})`, 'i'));
  if (reset) state.lastExtrusion = Number(reset[1]) || 0;
  const extrusion = text.match(new RegExp(`^G(?:0?1)\\b[^;]*\\bE(${NUMBER})`, 'i'));
  if (extrusion) {
    const next = Number(extrusion[1]);
    const delta = state.relativeExtrusion ? next : next - state.lastExtrusion;
    if (state.inFlush && Number.isFinite(delta) && delta > 0) state.explicitFlushMm += delta;
    if (!state.relativeExtrusion && Number.isFinite(next)) state.lastExtrusion = next;
  }

  if (/^M620\.10\b/i.test(text)) {
    const action = text.match(/\bA(\d+)\b/i);
    const length = text.match(new RegExp(`\\bL(${NUMBER})`, 'i'));
    if (action?.[1] === '1' && length) state.commandFlushMm += Math.max(Number(length[1]) || 0, 0);
  }
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
    if (hours != null && hours > 0) { result.printHours = hours; break; }
  }
  const grams = line.match(/(?:total )?filament used\s*\[g\]\s*[:=]\s*(.+)$/i);
  if (grams) {
    const values = numberList(grams[1]);
    if (values.some((number) => number > 0)) result.materialGrams = values;
  }
  const profile = line.match(/default_print_profile\s*=\s*["']?(.+?)["']?\s*(?:[>;]|$)/i);
  if (profile && !result.printProfileName) result.printProfileName = profile[1].trim();
}

function collectMetadataLine(line, result) {
  collectFromLine(line, result);
  const prediction = line.match(/\bprediction\s*=\s*["']([\d.]+)["']/i);
  if (prediction && !result.printHours) result.printHours = Number(prediction[1]) / 3600;
  for (const match of line.matchAll(/\b(?:used_g|weight)\s*=\s*["']([\d.]+)["']/gi)) {
    const grams = Number(match[1]);
    if (Number.isFinite(grams) && grams > 0) result.metadataWeights.push(grams);
  }
  if (!result.productName) {
    const name = line.match(/["']name["']\s*:\s*["']([^"']+)["']/i);
    if (name) result.productName = name[1].trim();
  }
}

function inferredProfile(result) {
  if (result.materialGrams.length > 1) return 'ams';
  const name = String(result.printProfileName || '').toLowerCase();
  return /0[.,](?:08|1[02])\s*mm|fine|extra.?fine|0[.,]2\s*nozzle/.test(name) ? 'complex' : 'regular';
}

async function extract3mfEstimates(file) {
  const archive = await readArchiveEntries(file);
  const plate = archive.entries.get('Metadata/plate_1.gcode');
  if (!plate) throw archiveError('This is not a sliced Bambu plate: Metadata/plate_1.gcode is missing');
  if (plate.uncompressedSize > MAX_GCODE_ENTRY_BYTES) throw archiveError('Plate G-code exceeds decompressed size limit');

  const result = {
    printHours: null,
    materialGrams: [],
    sources: [],
    productName: '',
    printProfile: 'regular',
    printProfileName: '',
    purgeGrams: 0,
    metadataWeights: [],
  };
  const metadata = [...archive.entries.values()].filter((entry) =>
    entry.name !== plate.name && /(?:slice_info|project_settings|model_settings|metadata).*(?:\.config|\.xml|\.json)$/i.test(entry.name)
  );
  const metadataBytes = metadata.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (metadataBytes > MAX_METADATA_TOTAL_BYTES) throw archiveError('3MF metadata exceeds decompressed size limit');
  for (const entry of metadata) {
    await streamEntryLines(file, archive, entry, (line) => collectMetadataLine(line, result), MAX_METADATA_ENTRY_BYTES);
    result.sources.push(entry.name);
  }

  const gcodeState = createGcodeState();
  await streamEntryLines(file, archive, plate, (line) => {
    collectFromLine(line, result);
    collectPurgeFromGcodeLine(line, gcodeState);
  }, MAX_GCODE_ENTRY_BYTES);
  result.sources.push(plate.name);
  if (!result.materialGrams.length && result.metadataWeights.length) result.materialGrams = result.metadataWeights;
  result.materialGrams = result.materialGrams.filter((grams) => grams > 0);
  if (!result.printHours || !result.materialGrams.length) {
    throw archiveError('No sliced print-time and material estimates were found in the 3MF');
  }
  const purgeLengthMm = gcodeState.explicitFlushMm || gcodeState.commandFlushMm;
  result.purgeGrams = Math.round(filamentLengthToGrams(purgeLengthMm, gcodeState.densities, gcodeState.diameters) * 100) / 100;
  result.printProfile = inferredProfile(result);
  delete result.metadataWeights;
  return result;
}

module.exports = {
  MAX_CENTRAL_DIRECTORY_BYTES,
  MAX_GCODE_ENTRY_BYTES,
  MAX_LINE_BYTES,
  extract3mfEstimates,
  parseDuration,
};
