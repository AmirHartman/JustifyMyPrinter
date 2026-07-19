const { randomUUID } = require('crypto');
const { getSql } = require('./_db');
const { parseBody, requireAdmin } = require('./_middleware');
const { editableSettings } = require('./_pricing');

const ARRAY_KEY = { wearPart: 'wearParts', task: 'maintenanceTasks' };

function itemTypeKey(itemType) {
  return ARRAY_KEY[itemType] || null;
}

function validateWearPart(body, current = {}) {
  const name = body.name !== undefined ? String(body.name).trim() : current.name;
  if (!name) throw { status: 400, message: 'שם הפריט נדרש' };

  const priceIls = body.priceIls !== undefined ? Number(body.priceIls) : current.priceIls;
  if (!Number.isFinite(priceIls) || priceIls <= 0) throw { status: 400, message: 'מחיר חייב להיות חיובי' };

  const lifetimeHours = body.lifetimeHours !== undefined ? Number(body.lifetimeHours) : current.lifetimeHours;
  if (!Number.isFinite(lifetimeHours) || lifetimeHours <= 0) throw { status: 400, message: 'משך חיים (שעות) חייב להיות חיובי' };

  const amsOnly = body.amsOnly !== undefined ? Boolean(body.amsOnly) : Boolean(current.amsOnly ?? false);
  const kind = body.kind !== undefined ? String(body.kind) : (current.kind || 'part');
  if (kind !== 'part' && kind !== 'accessory') throw { status: 400, message: 'סוג פריט לא תקין' };

  return { name, priceIls, lifetimeHours, amsOnly, kind };
}

function validateTask(body, current = {}) {
  const name = body.name !== undefined ? String(body.name).trim() : current.name;
  if (!name) throw { status: 400, message: 'שם הפריט נדרש' };

  const everyHours = body.everyHours !== undefined ? Number(body.everyHours) || 0 : Number(current.everyHours) || 0;
  const everyDays = body.everyDays !== undefined ? Number(body.everyDays) || 0 : Number(current.everyDays) || 0;
  if (!(everyHours > 0) && !(everyDays > 0)) throw { status: 400, message: 'יש להזין תדירות טיפול (שעות או ימים)' };

  return { name, everyHours, everyDays };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const user = await requireAdmin(req, res);
  if (!user) return;

  const sql = getSql();

  try {
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const key = itemTypeKey(body.itemType);
      if (!key) return res.status(400).json({ error: 'סוג פריט לא תקין' });

      let item;
      try {
        item = key === 'wearParts' ? validateWearPart(body) : validateTask(body);
      } catch (err) {
        if (err && err.status) return res.status(err.status).json({ error: err.message });
        throw err;
      }
      item.id = randomUUID();

      const rows = await sql`SELECT value FROM settings WHERE key = 'pricing'`;
      const current = editableSettings(rows[0]?.value || {});
      const nextValue = { ...current, [key]: [...current[key], item] };

      await sql`
        INSERT INTO settings (key, value)
        VALUES ('pricing', ${JSON.stringify(nextValue)})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      return res.status(201).json(item);
    }

    if (req.method === 'PUT') {
      const id = String(req.query.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const body = await parseBody(req);
      const key = itemTypeKey(body.itemType);
      if (!key) return res.status(400).json({ error: 'סוג פריט לא תקין' });

      const rows = await sql`SELECT value FROM settings WHERE key = 'pricing'`;
      const current = editableSettings(rows[0]?.value || {});
      const list = current[key];
      const index = list.findIndex((entry) => entry.id === id);
      if (index === -1) return res.status(404).json({ error: 'Not found' });

      let item;
      try {
        item = key === 'wearParts' ? validateWearPart(body, list[index]) : validateTask(body, list[index]);
      } catch (err) {
        if (err && err.status) return res.status(err.status).json({ error: err.message });
        throw err;
      }
      item.id = id;

      const nextList = [...list];
      nextList[index] = item;
      const nextValue = { ...current, [key]: nextList };

      await sql`
        INSERT INTO settings (key, value)
        VALUES ('pricing', ${JSON.stringify(nextValue)})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      return res.json(item);
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const key = itemTypeKey(req.query.itemType);
      if (!key) return res.status(400).json({ error: 'סוג פריט לא תקין' });

      const rows = await sql`SELECT value FROM settings WHERE key = 'pricing'`;
      const current = editableSettings(rows[0]?.value || {});
      const list = current[key];
      const nextList = list.filter((entry) => entry.id !== id);
      if (nextList.length === list.length) return res.status(404).json({ error: 'Not found' });

      const nextValue = { ...current, [key]: nextList };

      await sql`
        INSERT INTO settings (key, value)
        VALUES ('pricing', ${JSON.stringify(nextValue)})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
