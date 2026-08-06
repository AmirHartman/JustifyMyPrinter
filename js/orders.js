import { store, findProduct } from "./state.js";
import { formatCurrency, isUnpriced, linePrice, NO_PRICE_YET } from "./utils.js";

const orderDialog = document.querySelector("#order-dialog");
const orderForm   = document.querySelector("#order-form");

function productColorOptions(product) {
  if (Array.isArray(product?.colorOptions) && product.colorOptions.length) {
    return product.colorOptions.map((option) => typeof option === "string"
      ? { value: option, label: option, available: true }
      : {
          value: String(option.value ?? option.id ?? option.name ?? ""),
          label: String(option.label ?? option.name ?? option.value ?? ""),
          colorHex: option.colorHex ?? option.hex ?? "",
          available: option.available !== false,
        }).filter((option) => option.value);
  }
  return (product?.possibleColors ?? []).map((color) => ({
    value: String(color), label: String(color), available: true,
  }));
}

export function openOrderDialog(productId, previousOptions = {}) {
  const product = findProduct(productId);
  if (!product || !orderForm || !orderDialog) return;

  orderForm.reset();
  orderForm.productId.value = product.id;
  orderForm.friendName.value = store.currentUser?.name ?? "";

  const greetingElement = document.querySelector("#order-greeting");
  if (greetingElement && store.currentUser) {
    const isFemale = store.currentUser.gender === "female";
    greetingElement.textContent = isFemale
      ? `איזו החלטה נהדרת, ${store.currentUser.name}! 🎉\n` +
        `נשאר רק לבחור כמה יחידות את רוצה ובאיזה צבע, \n` +
        `ואפשר להוסיף לעגלה ולהמשיך לבחור.`
      : `איזו החלטה נהדרת, ${store.currentUser.name}! 🎉\n` +
        `נשאר רק לבחור כמה יחידות אתה רוצה ובאיזה צבע, \n` +
        `ואפשר להוסיף לעגלה ולהמשיך לבחור.`;
  }

  const quantityInput = orderForm.elements.quantity;
  const allowsMultiple = product.allowMultiple !== false;
  quantityInput.max = allowsMultiple ? "" : "1";
  quantityInput.readOnly = !allowsMultiple;
  quantityInput.value = allowsMultiple ? Math.max(Number(previousOptions.quantity) || 1, 1) : 1;
  document.querySelector("#order-product-name").textContent = product.name;
  document.querySelector("#order-product-description").textContent = product.description;

  const colorFieldset = document.querySelector("#order-color-fieldset");
  const colorContainer = document.querySelector("#order-color-options");
  const colorHelp = document.querySelector("#order-color-help");
  const colors = productColorOptions(product);
  // A colour must be chosen, and only from what is actually in stock. Sold-out
  // colours stay visible — greyed out — so the choice is understandable.
  const selectable = colors.filter((option) => option.available);
  colorContainer?.replaceChildren();
  if (colorFieldset) colorFieldset.hidden = colors.length === 0;
  colors.forEach((option) => {
    const label = document.createElement("label");
    label.className = `color-option${option.available ? "" : " is-unavailable"}`;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "selectedColor";
    input.value = option.value;
    input.required = selectable.length > 0;
    input.disabled = !option.available;
    // Nothing is preselected: the friend states the colour deliberately. A reorder
    // restores the previous colour, unless it has since sold out.
    input.checked = option.available && previousOptions.selectedColor === option.value;
    input.dataset.available = String(option.available);
    input.addEventListener("invalid", () => input.setCustomValidity("נא לבחור צבע להזמנה"));
    // Validity is per-input but the message belongs to the whole group: clearing
    // only the clicked radio would leave the others invalid and block the form.
    input.addEventListener("change", () => {
      colorContainer?.querySelectorAll('[name="selectedColor"]')
        .forEach((radio) => radio.setCustomValidity(""));
    });
    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    if (option.colorHex) swatch.style.backgroundColor = option.colorHex;
    const text = document.createElement("span");
    text.textContent = `${option.label}${option.available ? "" : " — אזל מהמלאי"}`;
    label.append(input, swatch, text);
    colorContainer?.append(label);
  });
  if (colorHelp) colorHelp.textContent = selectable.length > 0
    ? "בחירת צבע היא חובה. אפשר לבחור רק מהצבעים שיש כרגע במלאי."
    : "כל הצבעים אזלו כרגע. אפשר לשלוח את הבקשה, והמנהל יציע צבע חלופי לפני ההדפסה.";

  const availability = document.querySelector("#order-availability-note");
  if (availability) availability.textContent = product.inventoryAvailable === false
    ? "המוצר אינו זמין בצבעים הרגילים כרגע. אפשר לשלוח בקשה, והמנהל יציע חלופה לפני תחילת ההדפסה."
    : product.requiresAdminApproval || product.catalogKind === "idea"
      ? "ההזמנה דורשת בדיקה ואישור מחיר לפני ההדפסה."
      : "";

  updateReviewCosts();
  goToStep("review");
  orderDialog.showModal();
}

function getBaseCost() {
  const product = findProduct(orderForm?.productId.value);
  if (!product) return 0;
  const quantity = product.allowMultiple === false ? 1 : Math.max(Number(orderForm.quantity.value) || 1, 1);
  return linePrice(product, quantity);
}

export function updateReviewCosts() {
  const product = findProduct(orderForm?.productId.value);
  if (!product || !orderForm) return;
  const quantity = product.allowMultiple === false ? 1 : Math.max(Number(orderForm.quantity.value) || 1, 1);
  if (product.allowMultiple === false) orderForm.quantity.value = 1;
  const total = getBaseCost();
  const unpriced = isUnpriced(product);
  document.querySelector("#review-unit-cost").textContent = unpriced ? NO_PRICE_YET : formatCurrency(product.cost);
  document.querySelector("#review-total-cost").textContent = unpriced ? NO_PRICE_YET : formatCurrency(total);
  // Print time is mostly fixed per job, so the total is below unit price x quantity.
  // Without a word of explanation that reads like an arithmetic error.
  const note = document.querySelector("#review-quantity-note");
  if (note) note.hidden = unpriced || !(quantity > 1 && total < Number(product.cost) * quantity);
}

export function goToStep(step) {
  if (!orderForm) return;
  orderForm.dataset.step = step;
  orderForm.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== step;
  });
  orderForm.querySelectorAll("[data-step-dot]").forEach((dot) => {
    dot.classList.toggle("is-active", dot.dataset.stepDot === step);
  });
  if (step === "review") updateReviewCosts();
}

// What was just put in the cart, for the confirmation panel.
export function describeAddedLine() {
  const product  = findProduct(orderForm?.productId.value);
  const quantity = Math.max(Number(orderForm?.quantity.value) || 1, 1);
  const color    = orderForm?.querySelector('[name="selectedColor"]:checked');
  const colorText = color?.closest("label")?.textContent?.trim();
  const price = isUnpriced(product) ? NO_PRICE_YET : formatCurrency(getBaseCost());
  return [product?.name ?? "", `כמות ${quantity}`, colorText, price]
    .filter(Boolean)
    .join(" · ");
}

export function getOrderOptions() {
  const selected = orderForm?.querySelector('[name="selectedColor"]:checked');
  return { selectedColors: selected ? [selected.value] : [] };
}

// ── External-link / custom order dialog ────────────────────────

const customOrderDialog = document.querySelector("#custom-order-dialog");
const customOrderForm   = document.querySelector("#custom-order-form");

export function openCustomOrderDialog() {
  if (!customOrderForm || !customOrderDialog) return;
  customOrderForm.reset();
  customOrderDialog.showModal();
}
