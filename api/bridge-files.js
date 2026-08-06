'use strict';

// Registry for metadata held by an outbound-only bridge. No local path, file
// contents, or upload URL is accepted here: checksums identify plates and the
// bridge alone opens the corresponding file on its own disk.
const { getSql } = require('./_db');
const { parseBody, requireAdmin } = require('./_middleware');
const bridgeAuth = require('./_bridge-auth');

const CHECKSUM = /^[a-f0-9]{64}$/;
const MAX_FILES_PER_SYNC = 5000;

function positiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeFile(input) {
  const checksum = String(input?.checksum || '').trim().toLowerCase();
  if (!CHECKSUM.test(checksum)) return null;
  const fileName = String(input?.fileName || input?.name || '').trim().slice(0, 255);
  if (!fileName || !/\.gcode\.3mf$/i.test(fileName)) return null;
  const materialGrams = Array.isArray(input?.materialGrams)
    ? input.materialGrams.map((value) => finiteNumber(value, null)).filter((value) => value !== null).slice(0, 32)
    : [];
  return {
    checksum,
    fileName,
    byteSize: positiveInteger(input?.byteSize ?? input?.size),
    printHours: finiteNumber(input?.printHours),
    materialGrams,
    printProfile: String(input?.printProfile || 'regular').trim().slice(0, 120) || 'regular',
    purgeGrams: finiteNumber(input?.purgeGrams, 0),
  };
}

function normalizeBridge(row) {
  if (!row) return null;
  const seenAt = row.last_seen_at ?? null;
  const online = seenAt && Date.now() - new Date(seenAt).getTime() < 60 * 1000;
  return {
    id: row.id,
    status: row.status || 'offline',
    online: Boolean(online),
    diskFreeBytes: row.disk_free_bytes == null ? null : Number(row.disk_free_bytes),
    diskTotalBytes: row.disk_total_bytes == null ? null : Number(row.disk_total_bytes),
    lastSeenAt: seenAt,
    updatedAt: row.updated_at ?? null,
  };
}

function normalizeRow(row) {
  return {
    bridgeId: row.bridge_id,
    checksum: row.checksum,
    fileName: row.file_name,
    byteSize: Number(row.byte_size) || 0,
    printHours: row.print_hours == null ? null : Number(row.print_hours),
    materialGrams: Array.isArray(row.material_grams) ? row.material_grams.map(Number) : [],
    printProfile: row.print_profile || 'regular',
    purgeGrams: Number(row.purge_grams) || 0,
    available: row.available !== false,
    lastSeenAt: row.last_seen_at,
  };
}

function bridgeContext(req, legacyBridgeId = '') {
  // Production always has authenticateBridge(). This fallback only supports
  // isolated legacy handler tests which inject canBridge() by itself.
  if (typeof bridgeAuth.authenticateBridge === 'function') {
    return bridgeAuth.authenticateBridge(req);
  }
  if (!bridgeAuth.canBridge?.(req)) return null;
  const bridgeId = String(bridgeAuth.configuredBridgeId?.() || legacyBridgeId || 'bridge').trim().slice(0, 120);
  return bridgeId ? { bridgeId } : null;
}

async function sync(req, res) {
  const body = await parseBody(req);
  const bridge = bridgeContext(req, body.bridgeId);
  if (!bridge) return res.status(403).json({ error: 'Forbidden' });
  const { bridgeId } = bridge;
  if (!Array.isArray(body.files) || body.files.length > MAX_FILES_PER_SYNC) {
    return res.status(400).json({ error: `files must be an array of at most ${MAX_FILES_PER_SYNC} items` });
  }
  const files = body.files.map(normalizeFile);
  if (files.some((file) => !file)) return res.status(400).json({ error: 'Invalid bridge file metadata' });
  const unique = new Map(files.map((file) => [file.checksum, file]));
  if (unique.size !== files.length) return res.status(400).json({ error: 'Duplicate checksums are not allowed in one sync' });
  const status = ['online', 'degraded', 'offline'].includes(String(body.status || 'online'))
    ? String(body.status || 'online') : 'online';
  const diskFreeBytes = finiteNumber(body.diskFreeBytes, null);
  const diskTotalBytes = finiteNumber(body.diskTotalBytes, null);
  if (diskFreeBytes !== null && diskTotalBytes !== null && diskFreeBytes > diskTotalBytes) {
    return res.status(400).json({ error: 'diskFreeBytes cannot exceed diskTotalBytes' });
  }

  try {
    const sql = getSql();
    await sql`
      INSERT INTO bridges (id, status, disk_free_bytes, disk_total_bytes, last_seen_at, updated_at)
      VALUES (${bridgeId}, ${status}, ${diskFreeBytes}, ${diskTotalBytes}, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, disk_free_bytes = EXCLUDED.disk_free_bytes,
        disk_total_bytes = EXCLUDED.disk_total_bytes, last_seen_at = NOW(), updated_at = NOW()
    `;
    // Reconcile the full inventory in one PostgreSQL statement. Claimers see
    // either the previous full inventory or the new full inventory, never the
    // unsafe intermediate state where a partially failed sync hid all files.
    const inventory = JSON.stringify(files.map((file) => ({
      checksum: file.checksum, file_name: file.fileName, byte_size: file.byteSize,
      print_hours: file.printHours, material_grams: file.materialGrams,
      print_profile: file.printProfile, purge_grams: file.purgeGrams,
    })));
    await sql`
      WITH incoming AS (
        SELECT checksum, file_name, byte_size, print_hours, material_grams, print_profile, purge_grams
        FROM jsonb_to_recordset(${inventory}::jsonb) AS file(
          checksum TEXT, file_name TEXT, byte_size BIGINT, print_hours NUMERIC,
          material_grams JSONB, print_profile TEXT, purge_grams NUMERIC
        )
      ), upserted AS (
        INSERT INTO bridge_files (
          bridge_id, checksum, file_name, byte_size, print_hours, material_grams,
          print_profile, purge_grams, available, last_seen_at
        ) SELECT ${bridgeId}, checksum, file_name, byte_size, print_hours, material_grams,
          print_profile, purge_grams, TRUE, NOW() FROM incoming
        ON CONFLICT (bridge_id, checksum) DO UPDATE SET
          file_name = EXCLUDED.file_name, byte_size = EXCLUDED.byte_size,
          print_hours = EXCLUDED.print_hours, material_grams = EXCLUDED.material_grams,
          print_profile = EXCLUDED.print_profile, purge_grams = EXCLUDED.purge_grams,
          available = TRUE, last_seen_at = NOW()
        RETURNING checksum
      )
      UPDATE bridge_files SET available = FALSE
      WHERE bridge_id = ${bridgeId}
        AND NOT EXISTS (SELECT 1 FROM incoming WHERE incoming.checksum = bridge_files.checksum)
    `;
    return res.json({ ok: true, bridgeId, files: files.length });
  } catch (error) {
    return res.status(500).json({ error: 'Bridge sync failed' });
  }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const action = String(req.query.action || '');
  if (req.method === 'POST' && action === 'sync') return sync(req, res);
  if (req.method !== 'GET') return res.status(405).end();
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const sql = getSql();
    const [files, bridges] = await Promise.all([
      sql`SELECT * FROM bridge_files ORDER BY available DESC, last_seen_at DESC, file_name ASC`,
      sql`SELECT * FROM bridges ORDER BY last_seen_at DESC NULLS LAST, id ASC`,
    ]);
    return res.json({ files: files.map(normalizeRow), bridge: normalizeBridge(bridges[0]), bridges: bridges.map(normalizeBridge) });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load bridge inventory' });
  }
};
