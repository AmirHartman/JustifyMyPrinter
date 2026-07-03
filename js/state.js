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
  filaments:      [],        // all authenticated users: filament reference data
  pricingSettings: null,     // admin: pricing config
};

export const pageName = document.body.dataset.page || "app";

export async function loadData() {
  const isAdmin      = store.appMode === "admin";
  const isFriendMode = store.currentUser && !isAdmin;
  const isRealFriend = isFriendMode && store.currentUser.role !== "admin";

  const [products, orders, users, notifications, myOrders, messages, conversations, filaments, pricingSettings] = await Promise.all([
    api("/api/products"),
    isAdmin      ? api("/api/orders")                  : Promise.resolve([]),
    isAdmin      ? api("/api/users")                   : Promise.resolve([]),
    store.currentUser ? api("/api/notifications")      : Promise.resolve([]),
    isFriendMode ? api("/api/orders?mine=true")         : Promise.resolve([]),
    isRealFriend ? api("/api/messages")                : Promise.resolve([]),
    isAdmin      ? api("/api/messages")                : Promise.resolve([]),
    store.currentUser ? api("/api/filaments")          : Promise.resolve([]),
    isAdmin      ? api("/api/settings?key=pricing")    : Promise.resolve(null),
  ]);
  store.products       = products;
  store.orders         = orders;
  store.users          = users;
  store.notifications  = notifications;
  store.myOrders       = myOrders;
  store.messages       = messages;
  store.conversations  = conversations;
  store.filaments      = filaments;
  store.pricingSettings = pricingSettings;
}

export function findProduct(productId) {
  return store.products.find((p) => p.id === productId);
}

export function getProductOrderedQuantity(productId) {
  return store.orders.reduce((total, order) => {
    return order.productId === productId ? total + order.quantity : total;
  }, 0);
}
