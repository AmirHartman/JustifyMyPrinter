import { store, findProduct } from "./state.js";
import { formatCurrency } from "./utils.js";

const orderDialog = document.querySelector("#order-dialog");
const orderForm   = document.querySelector("#order-form");

let tipAmount = 0;

export function openOrderDialog(productId) {
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

  orderForm.quantity.value = 1;
  document.querySelector("#order-product-name").textContent = product.name;
  document.querySelector("#order-product-description").textContent = product.description;

  updateReviewCosts();
  updateTipBreakdown();
  goToStep("review");
  orderDialog.showModal();
}

function getBaseCost() {
  const product = findProduct(orderForm?.productId.value);
  if (!product) return 0;
  const quantity = Math.max(Number(orderForm.quantity.value) || 1, 1);
  return product.cost * quantity;
}

export function updateReviewCosts() {
  const product = findProduct(orderForm?.productId.value);
  if (!product || !orderForm) return;
  const quantity = Math.max(Number(orderForm.quantity.value) || 1, 1);
  document.querySelector("#review-unit-cost").textContent = formatCurrency(product.cost);
  document.querySelector("#review-total-cost").textContent = formatCurrency(product.cost * quantity);
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

// ── External-link / custom order dialog ────────────────────────

const customOrderDialog = document.querySelector("#custom-order-dialog");
const customOrderForm   = document.querySelector("#custom-order-form");

export function openCustomOrderDialog() {
  if (!customOrderForm || !customOrderDialog) return;
  customOrderForm.reset();
  customOrderDialog.showModal();
}
