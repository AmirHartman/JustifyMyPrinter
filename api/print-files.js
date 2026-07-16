'use strict';

const { createHash } = require('crypto');
const { requireAdmin, parseBody } = require('./_middleware');
const { extract3mfEstimates } = require('../scripts/lib/three-mf-estimates');

const MAX_BYTES = 60 * 1024 * 1024; // ~60MB cap on the downloaded sliced file.
const CLOUDINARY_URL_RE = /^https:\/\/res\.cloudinary\.com\//i;

// Admin-only. The browser uploads the raw sliced file directly to Cloudinary
// (see /api/uploads?type=print), then hands this endpoint the resulting
// secure_url + original filename. This endpoint downloads the file back into
// memory, extracts print-time/material estimates from it (the same logic the
// local `npm run sync:prints` script uses), and reports the results — it never
// writes to the database itself; the caller persists the fields via the normal
// POST/PUT /api/products flow.
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).end();
  if (!await requireAdmin(req, res)) return;

  try {
    const body = await parseBody(req);
    const url = String(body.url ?? '').trim();
    const filename = String(body.filename ?? '').trim();

    if (!url) return res.status(400).json({ error: 'Missing file URL' });
    if (!CLOUDINARY_URL_RE.test(url)) return res.status(400).json({ error: 'Invalid file URL' });

    let response;
    try {
      response = await fetch(url);
    } catch (err) {
      return res.status(400).json({ error: `Could not download the uploaded file: ${err.message}` });
    }
    if (!response.ok) {
      return res.status(400).json({ error: `Could not download the uploaded file: ${response.status} ${response.statusText}` });
    }

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength && declaredLength > MAX_BYTES) {
      return res.status(400).json({ error: 'The uploaded file is too large (limit 60MB)' });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.byteLength > MAX_BYTES) {
      return res.status(400).json({ error: 'The uploaded file is too large (limit 60MB)' });
    }

    const checksum = createHash('sha256').update(buffer).digest('hex');

    let estimates;
    try {
      estimates = await extract3mfEstimates(buffer);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    return res.json({
      printHours: Math.round(estimates.printHours * 100) / 100,
      materialGrams: estimates.materialGrams,
      printProfile: estimates.printProfile,
      purgeGrams: estimates.purgeGrams,
      warnings: [],
      checksum,
      url,
      filename,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
