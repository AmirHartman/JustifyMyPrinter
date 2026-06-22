import { api } from "./api.js";

// Single mutable store — all modules share this object reference.
// Mutate properties (store.currentUser = x), never replace the object itself.
export const store = {
  currentUser: null,
  appMode: "friend",
  products: [],
  orders: [],
  users: [],
  notifications: [],
};

export const pageName = document.body.dataset.page || "app";

export async function loadData() {
  const isAdmin = store.appMode === "admin";
  const [products, orders, users, notifications] = await Promise.all([
    api("/api/products"),
    isAdmin ? api("/api/orders")        : Promise.resolve([]),
    isAdmin ? api("/api/users")         : Promise.resolve([]),
    store.currentUser ? api("/api/notifications") : Promise.resolve([]),
  ]);
  store.products      = products;
  store.orders        = orders;
  store.users         = users;
  store.notifications = notifications;
}

export function findProduct(productId) {
  return store.products.find((p) => p.id === productId);
}

export function getProductOrderedQuantity(productId) {
  return store.orders.reduce((total, order) => {
    return order.productId === productId ? total + order.quantity : total;
  }, 0);
}
