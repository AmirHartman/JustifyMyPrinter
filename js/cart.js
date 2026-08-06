import { store, findProduct } from "./state.js";
import { isUnpriced, isUntested, linePrice } from "./utils.js";

// The cart lives only in the browser. It holds what the friend chose — product,
// quantity, colour — and never a price: prices are recomputed from the catalog
// on every render, so a cart left open for a week can never check out at a
// stale amount. The server derives every price again at checkout regardless.

const STORAGE_PREFIX = "jmp:cart:v1:";
const EMPTY = { lines: [], tip: 0 };

// iOS in-app browsers throw SecurityError on storage access, so nothing here may
// depend on localStorage succeeding. When it fails the cart still works for the
// session and simply does not survive a reload. Mirrors the pendingReorder
// handling in js/render.js.
let memoryCart = null;

function storageKey() {
  return store.currentUser ? `${STORAGE_PREFIX}${store.currentUser.id}` : null;
}

function readState() {
  const key = storageKey();
  if (!key) return { ...EMPTY, lines: [] };
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        lines: Array.isArray(parsed?.lines) ? parsed.lines : [],
        tip: Math.max(Number(parsed?.tip) || 0, 0),
      };
    }
  } catch {
    if (memoryCart) return memoryCart;
  }
  return memoryCart ?? { ...EMPTY, lines: [] };
}

function writeState(state) {
  memoryCart = state;
  const key = storageKey();
  if (!key) return state;
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage is unavailable; memoryCart already holds the change.
  }
  return state;
}

function sameLine(line, productId, selectedColors) {
  if (line.productId !== productId) return false;
  const a = [...(line.selectedColors ?? [])].sort().join("|");
  const b = [...(selectedColors ?? [])].sort().join("|");
  return a === b;
}

export function readCart() {
  return readState();
}

export function cartCount() {
  return readState().lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
}

// The same product in the same colour is one line, not two — the quantity-based
// pricing only works out if the units are counted together.
export function addLine({ productId, quantity, selectedColors }) {
  const product = findProduct(productId);
  if (!product) return null;
  const units = product.allowMultiple === false ? 1 : Math.max(Number(quantity) || 1, 1);
  const colors = Array.isArray(selectedColors) ? selectedColors.filter(Boolean) : [];

  const state = readState();
  const existing = state.lines.find((line) => sameLine(line, productId, colors));
  if (existing) {
    existing.quantity = product.allowMultiple === false
      ? 1 : Math.min(existing.quantity + units, 50);
  } else {
    state.lines.push({
      lineId: `${productId}-${Date.now()}-${state.lines.length}`,
      productId,
      quantity: units,
      selectedColors: colors,
      addedAt: new Date().toISOString(),
    });
  }
  writeState(state);
  return existing ?? state.lines[state.lines.length - 1];
}

export function updateLine(lineId, patch) {
  const state = readState();
  const line = state.lines.find((entry) => entry.lineId === lineId);
  if (!line) return;
  if (patch.quantity != null) {
    const product = findProduct(line.productId);
    const requested = Math.max(Number(patch.quantity) || 1, 1);
    line.quantity = product?.allowMultiple === false ? 1 : Math.min(requested, 50);
  }
  writeState(state);
}

export function removeLine(lineId) {
  const state = readState();
  state.lines = state.lines.filter((entry) => entry.lineId !== lineId);
  if (state.lines.length === 0) state.tip = 0;
  writeState(state);
}

export function clearCart() {
  writeState({ lines: [], tip: 0 });
}

// Lines joined to the live catalog. A product that was removed or hidden since
// it was added is reported rather than silently priced or silently dropped.
export function cartLines() {
  const state = readState();
  return state.lines.map((line) => {
    const product = findProduct(line.productId);
    return {
      ...line,
      product: product ?? null,
      missing: !product,
      unpriced: Boolean(product) && isUnpriced(product),
      untested: Boolean(product) && isUntested(product),
      price: linePrice(product, line.quantity),
    };
  });
}

export function cartTotals() {
  const lines = cartLines();
  const available = lines.filter((line) => !line.missing);
  return {
    lines,
    itemCount: available.reduce((sum, line) => sum + line.quantity, 0),
    base: available.reduce((sum, line) => sum + line.price, 0),
    // A cart of unpriced ideas has no total yet; the admin quotes each one after
    // review. A priced idea does count, but is still flagged as never printed.
    hasUnpriced: available.some((line) => line.unpriced),
    hasUntested: available.some((line) => line.untested),
    hasMissing: lines.some((line) => line.missing),
    tip: getTip(),
    get total() { return this.base + this.tip; },
  };
}

// ── Support for the project (tip) ─────────────────────────────
// One amount per cart, chosen at checkout, persisted with the cart so it
// survives a reload the same way the lines do.

export function getTip() {
  return readState().tip;
}

export function addTip(amount) {
  const state = readState();
  state.tip = Math.max(state.tip + (Number(amount) || 0), 0);
  writeState(state);
  return state.tip;
}

export function resetTip() {
  const state = readState();
  state.tip = 0;
  writeState(state);
}

// The payload the server accepts for a cart checkout: identity and choices only.
export function checkoutPayload() {
  const state = readState();
  return {
    items: state.lines
      .filter((line) => findProduct(line.productId))
      .map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        selectedColors: line.selectedColors ?? [],
      })),
    supportAmount: state.tip,
  };
}
