'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { extract3mfEstimates } = require('../scripts/lib/three-mf-estimates');

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

function safeName(value) {
  const base = path.basename(String(value || ''));
  return base.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180) || 'print.gcode.3mf';
}

function isPlateFile(name) {
  return /\.gcode\.3mf$/i.test(name);
}

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function stableFile(target, waitMs) {
  const first = await fs.stat(target);
  if (!first.isFile()) return null;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const second = await fs.stat(target);
  return first.size === second.size && first.mtimeMs === second.mtimeMs ? second : null;
}

async function sha256File(target) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(target, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally { await handle.close(); }
  return hash.digest('hex');
}

class FileLibrary {
  constructor({ storageDir, maxBytes = DEFAULT_MAX_BYTES, stableWaitMs = 1500, logger = console } = {}) {
    if (!storageDir) throw new Error('STORAGE_DIR is required');
    this.storageDir = path.resolve(storageDir);
    this.incomingDir = path.join(this.storageDir, 'incoming');
    this.libraryDir = path.join(this.storageDir, 'library');
    this.quarantineDir = path.join(this.storageDir, 'quarantine');
    this.cachePath = path.join(this.storageDir, '.bridge-file-metadata.json');
    this.maxBytes = Math.max(Number(maxBytes) || DEFAULT_MAX_BYTES, 1024 * 1024);
    this.stableWaitMs = Math.max(Number(stableWaitMs) || 1500, 250);
    this.logger = logger;
    this.files = new Map();
    this.cacheLoaded = false;
  }

  async init() {
    for (const directory of [this.storageDir, this.incomingDir, this.libraryDir, this.quarantineDir]) {
      await fs.mkdir(directory, { recursive: true });
    }
    const test = path.join(this.storageDir, `.jmp-write-test-${process.pid}`);
    await fs.writeFile(test, 'ok', { flag: 'wx' });
    await fs.unlink(test);
    if (!this.cacheLoaded) {
      try {
        const parsed = JSON.parse(await fs.readFile(this.cachePath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          for (const [checksum, metadata] of Object.entries(parsed)) {
            if (/^[a-f0-9]{64}$/.test(checksum) && metadata && typeof metadata === 'object') this.files.set(checksum, metadata);
          }
        }
      } catch { /* first run or a corrupt cache: library scan rebuilds it */ }
      this.cacheLoaded = true;
    }
  }

  async saveCache() {
    const values = Object.fromEntries(this.files.entries());
    const temporary = `${this.cachePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(values), { mode: 0o600 });
    await fs.rename(temporary, this.cachePath);
  }

  async quarantine(source, reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(this.quarantineDir, `${stamp}-${safeName(path.basename(source))}`);
    try { await fs.rename(source, destination); } catch (error) {
      if (error.code === 'EXDEV') { await fs.copyFile(source, destination); await fs.unlink(source); }
      else throw error;
    }
    await fs.writeFile(`${destination}.error.txt`, `${String(reason).slice(0, 1000)}\n`, { flag: 'w' });
    return destination;
  }

  async inspect(target, fileName = path.basename(target)) {
    const stat = await fs.stat(target);
    if (!isPlateFile(fileName)) throw new Error('Only sliced .gcode.3mf files are accepted');
    if (stat.size <= 0) throw new Error('Print file is empty');
    if (stat.size > this.maxBytes) throw new Error(`Print file exceeds the ${Math.floor(this.maxBytes / 1024 / 1024)}MiB bridge limit`);
    const buffer = await fs.readFile(target);
    const estimates = await extract3mfEstimates(buffer, { requirePlateGcode: true });
    const checksum = await sha256File(target);
    return {
      checksum, fileName: safeName(fileName), byteSize: stat.size,
      printHours: estimates.printHours, materialGrams: estimates.materialGrams,
      printProfile: estimates.printProfile, purgeGrams: estimates.purgeGrams,
    };
  }

  async importIncoming(source) {
    const stat = await stableFile(source, this.stableWaitMs);
    if (!stat) return null;
    try {
      const metadata = await this.inspect(source);
      const destination = path.join(this.libraryDir, `${metadata.checksum}.gcode.3mf`);
      if (await exists(destination)) {
        await this.quarantine(source, `Duplicate plate already exists as ${metadata.checksum}.gcode.3mf`);
      } else await fs.rename(source, destination);
      this.files.set(metadata.checksum, metadata);
      return metadata;
    } catch (error) {
      await this.quarantine(source, error.message);
      this.logger.warn?.(`quarantined ${path.basename(source)}: ${error.message}`);
      return null;
    }
  }

  async scan() {
    await this.init();
    const incoming = await fs.readdir(this.incomingDir, { withFileTypes: true });
    for (const entry of incoming) {
      if (entry.isFile() && /\.3mf$/i.test(entry.name)) await this.importIncoming(path.join(this.incomingDir, entry.name));
    }
    const library = await fs.readdir(this.libraryDir, { withFileTypes: true });
    const seen = new Map();
    for (const entry of library) {
      if (!entry.isFile() || !isPlateFile(entry.name)) continue;
      const target = path.join(this.libraryDir, entry.name);
      try {
        const checksumFromName = entry.name.replace(/\.gcode\.3mf$/i, '');
        const cached = this.files.get(checksumFromName);
        const metadata = await this.inspect(target, cached?.fileName || entry.name);
        if (entry.name !== `${metadata.checksum}.gcode.3mf`) {
          // A file manually placed directly in library is normalized on the
          // same filesystem. Never overwrite a matching existing plate.
          const canonical = path.join(this.libraryDir, `${metadata.checksum}.gcode.3mf`);
          if (await exists(canonical)) {
            await this.quarantine(target, `Duplicate plate already exists as ${metadata.checksum}.gcode.3mf`);
          } else await fs.rename(target, canonical);
        }
        seen.set(metadata.checksum, metadata);
      } catch (error) {
        // Existing library data is never deleted. Invalid manual additions are
        // quarantined and omitted from the inventory until fixed.
        await this.quarantine(target, error.message);
      }
    }
    this.files = seen;
    await this.saveCache();
    return this.inventory();
  }

  inventory() { return [...this.files.values()].sort((a, b) => a.fileName.localeCompare(b.fileName)); }
  localPath(checksum) {
    if (!/^[a-f0-9]{64}$/.test(String(checksum))) return null;
    const target = path.join(this.libraryDir, `${checksum}.gcode.3mf`);
    return this.files.has(checksum) ? target : null;
  }
}

async function diskStatus(storageDir) {
  // Node has no cross-platform statvfs. `statfs` is available in Node 20+ and
  // gives only aggregate storage metadata, never a path outside STORAGE_DIR.
  try {
    const stat = await fs.statfs(storageDir);
    const total = Number(stat.blocks) * Number(stat.bsize);
    const free = Number(stat.bavail) * Number(stat.bsize);
    return { diskFreeBytes: Number.isSafeInteger(free) ? free : null, diskTotalBytes: Number.isSafeInteger(total) ? total : null };
  } catch { return { diskFreeBytes: null, diskTotalBytes: null }; }
}

module.exports = { DEFAULT_MAX_BYTES, FileLibrary, diskStatus, isPlateFile, sha256File };
