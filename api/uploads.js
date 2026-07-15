const { createHash } = require('crypto');
const { requireAdmin } = require('./_middleware');

// Signs a direct browser→Cloudinary image upload. The file itself never passes
// through this server (avoids body-size limits and Neon transfer); the browser
// POSTs the file plus these signed params straight to the Cloudinary upload API.
// Admin-only so the signing secret is never exposed and only admins can upload.
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') return res.status(405).end();
  if (!await requireAdmin(req, res)) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Upload not configured' });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'products';

  // Cloudinary signature: signed params sorted alphabetically as key=value&...,
  // then api_secret appended, hashed with SHA-1.
  const toSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = createHash('sha1').update(toSign + apiSecret).digest('hex');

  return res.json({ cloudName, apiKey, timestamp, folder, signature });
};
