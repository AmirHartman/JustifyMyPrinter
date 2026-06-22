import { api } from "./api.js";

// Single mutable store — all modules share this object reference.
// Mutate properties (store.currentUser = x), never replace the object itself.
export const store = {
  currentUser:    null,
  appMode:        "friend",
  products:       [],
  orders:         [],        // admin: all orders
  users:          [],        // admin: all users
  notifications:  [],        // all: inbox items
  myOrders:       [],        // friend: own orders
  messages:       [],        // friend: chat thread
  conversations:  [],        // admin: conversation list
  _activeThread:  null,      // admin: currently open thread { userName, messages }
};

export const pageName = document.body.dataset.page || "app";

export async function loadData() {
  const isAdmin  = store.appMode === "admin";
  const isFriend = store.currentUser && !isAdmin;

  const [products, orders, users, notifications, myOrders, messages, conversations] = await Promise.all([
    api("/api/products"),
    isAdmin  ? api("/api/orders")         : Promise.resolve([]),
    isAdmin  ? api("/api/users")          : Promise.resolve([]),
    store.currentUser ? api("/api/notifications") : Promise.resolve([]),
    isFriend ? api("/api/my-orders")      : Promise.resolve([]),
    isFriend ? api("/api/messages")       : Promise.resolve([]),
    isAdmin  ? api("/api/messages")       : Promise.resolve([]),
  ]);
  store.products      = products;
  store.orders        = orders;
  store.users         = users;
  store.notifications = notifications;
  store.myOrders      = myOrders;
  store.messages      = messages;
  store.conversations = conversations;
}

export function findProduct(productId) {
  return store.products.find((p) => p.id === productId);
}

export function getProductOrderedQuantity(productId) {
  return store.orders.reduce((total, order) => {
    return order.productId === productId ? total + order.quantity : total;
  }, 0);
}
