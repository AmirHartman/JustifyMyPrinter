import { store, findProduct } from "./state.js";
import { formatCurrency } from "./utils.js";

const orderDialog = document.querySelector("#order-dialog");
const orderForm   = document.querySelector("#order-form");

let tipAmount = 0;

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
  tipAmount = 0;

  const greetingElement = document.querySelector("#order-greeting");
  if (greetingElement && store.currentUser) {
    const isFemale = store.currentUser.gender === "female";
    greetingElement.textContent = isFemale
      ? `שמעי ${store.currentUser.name}, איזו בחירה פגז!\n` +
        `זה הזמן להחליט כמה יחידות את רוצה, \n` +
        `וכמה נראה לך הוגן לשלם עבור ההדפסה.`
      : `שמע ${store.currentUser.name}, איזו בחירה פגז!\n` +
        `זה הזמן להחליט כמה יחידות אתה רוצה, \n` +
        `וכמה נראה לך הוגן לשלם עבור ההדפסה.`;
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
  const colors = productColorOptions(product);
  colorContainer?.replaceChildren();
  if (colorFieldset) colorFieldset.hidden = colors.length === 0;
  colors.forEach((option, index) => {
    const label = document.createElement("label");
    label.className = `color-option${option.available ? "" : " is-unavailable"}`;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "selectedColor";
    input.value = option.value;
    input.required = colors.length > 0;
    input.checked = previousOptions.selectedColor
      ? previousOptions.selectedColor === option.value
      : index === 0;
    input.dataset.available = String(option.available);
    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    if (option.colorHex) swatch.style.backgroundColor = option.colorHex;
    const text = document.createElement("span");
    text.textContent = `${option.label}${option.available ? "" : " — לא זמין, אפשר לבקש חלופה"}`;
    label.append(input, swatch, text);
    colorContainer?.append(label);
  });

  const customTextField = document.querySelector("#order-custom-text-field");
  const customTextInput = orderForm.elements.customText;
  if (customTextField) customTextField.hidden = !product.customTextEnabled;
  if (customTextInput) {
    customTextInput.disabled = !product.customTextEnabled;
    customTextInput.value = product.customTextEnabled ? String(previousOptions.customText ?? "") : "";
  }
  const availability = document.querySelector("#order-availability-note");
  if (availability) availability.textContent = product.inventoryAvailable === false
    ? "המוצר אינו זמין בצבעים הרגילים כרגע. אפשר לשלוח בקשה, והמנהל יציע חלופה לפני תחילת ההדפסה."
    : product.requiresAdminApproval || product.catalogKind === "idea"
      ? "ההזמנה דורשת בדיקה ואישור מחיר לפני ההדפסה."
      : "";

  updateReviewCosts();
  updateTipBreakdown();
  goToStep("review");
  orderDialog.showModal();
}

function getBaseCost() {
  const product = findProduct(orderForm?.productId.value);
  if (!product) return 0;
  const quantity = product.allowMultiple === false ? 1 : Math.max(Number(orderForm.quantity.value) || 1, 1);
  return Number(product.pricesByQuantity?.[quantity] ?? product.cost * quantity);
}

export function updateReviewCosts() {
  const product = findProduct(orderForm?.productId.value);
  if (!product || !orderForm) return;
  const quantity = product.allowMultiple === false ? 1 : Math.max(Number(orderForm.quantity.value) || 1, 1);
  if (product.allowMultiple === false) orderForm.quantity.value = 1;
  document.querySelector("#review-unit-cost").textContent = formatCurrency(product.cost);
  document.querySelector("#review-total-cost").textContent = formatCurrency(getBaseCost());
}

export function addTip(amount) {
  tipAmount += Number(amount) || 0;
  updateTipBreakdown();
}

export function resetTip() {
  tipAmount = 0;
  updateTipBreakdown();
}

export function updateTipBreakdown() {
  const base = getBaseCost();
  document.querySelector("#tip-base-cost").textContent  = formatCurrency(base);
  document.querySelector("#tip-extra-cost").textContent = formatCurrency(tipAmount);
  document.querySelector("#tip-total-cost").textContent = formatCurrency(base + tipAmount);
}

export function updateSummary() {
  const product  = findProduct(orderForm?.productId.value);
  const quantity = Math.max(Number(orderForm?.quantity.value) || 1, 1);
  const base     = getBaseCost();
  document.querySelector("#summary-product-name").textContent = product?.name ?? "";
  document.querySelector("#summary-quantity").textContent     = String(quantity);
  const selectedColor = orderForm?.querySelector('[name="selectedColor"]:checked');
  const colorRow = document.querySelector("#summary-color-row");
  const colorValue = document.querySelector("#summary-color");
  if (colorRow) colorRow.hidden = !selectedColor;
  if (colorValue) colorValue.textContent = selectedColor?.closest("label")?.textContent?.trim() ?? "";
  const customText = String(orderForm?.elements.customText?.value ?? "").trim();
  const customRow = document.querySelector("#summary-custom-text-row");
  if (customRow) customRow.hidden = !customText;
  if (document.querySelector("#summary-custom-text")) document.querySelector("#summary-custom-text").textContent = customText;
  document.querySelector("#summary-base-cost").textContent    = formatCurrency(base);
  document.querySelector("#summary-tip-cost").textContent     = formatCurrency(tipAmount);
  document.querySelector("#summary-total-cost").textContent   = formatCurrency(base + tipAmount);
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
  if (step === "review")  updateReviewCosts();
  if (step === "tip")     updateTipBreakdown();
  if (step === "summary") updateSummary();
}

export function getTipAmount() {
  return tipAmount;
}

export function getOrderTotal() {
  return getBaseCost() + tipAmount;
}

export function getOrderFriendName(data) {
  return store.currentUser
    ? store.currentUser.name
    : String(data.get("friendName") ?? "").trim();
}

export function getOrderOptions() {
  const selected = orderForm?.querySelector('[name="selectedColor"]:checked');
  return {
    selectedColors: selected ? [selected.value] : [],
    selectedColorAvailable: selected?.dataset.available !== "false",
    customText: String(orderForm?.elements.customText?.value ?? "").trim(),
  };
}

// ── External-link / custom order dialog ────────────────────────

const customOrderDialog = document.querySelector("#custom-order-dialog");
const customOrderForm   = document.querySelector("#custom-order-form");

export function openCustomOrderDialog() {
  if (!customOrderForm || !customOrderDialog) return;
  customOrderForm.reset();
  customOrderDialog.showModal();
}
