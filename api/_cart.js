'use strict';

// Pure helpers for cart checkout. A cart is submitted as one request but stored
// as one orders row per line, joined by a shared cart_id — every downstream
// feature (inventory, print jobs, per-product stats, WhatsApp) stays
// single-product. Nothing here touches the database, so it is unit-testable.

const MAX_CART_ITEMS = 20;

// The client sends only identity and configuration — never a price. Duplicate
// lines (same product, same colours) are merged rather than rejected: two
// separate "1x black hook" lines are the same order, and merging keeps the
// quantity-based pricing table honest.
// toColorValue is injected so colours are coerced by exactly the same rule the
// caller uses for the rest of the order, with no second copy of it here.
function normalizeCartItems(rawItems, toColorValue) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'הזמנה חייבת לכלול לפחות מוצר אחד' };
  }
  if (rawItems.length > MAX_CART_ITEMS) {
    return { error: `אפשר להזמין עד ${MAX_CART_ITEMS} מוצרים שונים בבת אחת` };
  }

  const items = [];
  const byKey = new Map();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') return { error: 'פריט לא תקין בעגלה' };
    const productId = String(raw.productId ?? '').trim();
    if (!productId) return { error: 'פריט בעגלה ללא מוצר' };
    const quantity = Number(raw.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: 'הכמות בכל פריט חייבת להיות מספר שלם וחיובי' };
    }
    const selectedColors = Array.isArray(raw.selectedColors)
      ? raw.selectedColors.map(toColorValue).filter(Boolean)
      : [];

    const key = `${productId}::${[...selectedColors].sort().join('|')}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }
    const item = { productId, quantity, selectedColors };
    byKey.set(key, item);
    items.push(item);
  }
  return { items };
}

// One cart carries one optional support amount. It is recorded whole on a
// single row instead of split across the cart: any split needs rounding, and a
// rounded split makes the sum of the rows differ from what the friend was
// shown. The first priced line takes it; when the whole cart is awaiting a
// quote there is no priced line, so the first line takes it.
function supportTargetIndex(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return -1;
  const priced = lines.findIndex((line) => line?.priced);
  return priced === -1 ? 0 : priced;
}

module.exports = { MAX_CART_ITEMS, normalizeCartItems, supportTargetIndex };
