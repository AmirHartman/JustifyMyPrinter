import { store, findProduct } from "./state.js";
import { formatCurrency } from "./utils.js";

const orderDialog = document.querySelector("#order-dialog");
const orderForm   = document.querySelector("#order-form");

export function openOrderDialog(productId) {
  const product = findProduct(productId);
  if (!product || !orderForm || !orderDialog) return;

  orderForm.reset();
  orderForm.productId.value = product.id;
  orderForm.friendName.value = store.currentUser?.name ?? "";

  const greetingElement = document.querySelector("#order-greeting");
  if (greetingElement && store.currentUser) {
    greetingElement.textContent =
      `שמע ${store.currentUser.name}, איזה בחירה פגז!\n` +
      `זה הזמן להחליט כמה יחידות אתה רוצה, \n` +
      `וכמה נראה לך הוגן לשלם עבור ההדפסה.`;
  }

  orderForm.quantity.value = 1;
  orderForm.price.value = product.cost;
  orderForm.price.min = product.cost;
  document.querySelector("#order-product-name").textContent = product.name;
  document.querySelector("#order-product-description").textContent = product.description;
  updateOrderMinimum();
  orderDialog.showModal();
}

export function updateOrderMinimum() {
  if (!orderForm) return;
  const product = findProduct(orderForm.productId.value);
  if (!product) return;
  const quantity = Math.max(Number(orderForm.quantity.value) || 1, 1);
  const minimum = product.cost * quantity;
  orderForm.price.min = minimum;
  if (Number(orderForm.price.value) < minimum) orderForm.price.value = minimum;
  document.querySelector("#minimum-note").textContent =
    `מינימום להזמנה הזו: ${formatCurrency(minimum)}`;
}

export function getOrderFriendName(data) {
  return store.currentUser
    ? store.currentUser.name
    : String(data.get("friendName") ?? "").trim();
}
