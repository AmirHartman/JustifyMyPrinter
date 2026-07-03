import { api } from "./api.js";

// Single mutable store — all modules share this object reference.
// Mutate properties (store.currentUser = x), never replace the object itself.
export const store = {
  currentUser:    null,
  appMode:        "friend",
  products:       [],
  categories:     [],        // dynamic product categories (public: active only, admin: all)
  orders:         [],        // admin: all orders
  users:          [],        // admin: all users
  myOrders:       [],        // friend: own orders
  filaments:      [],        // all authenticated users: filament reference data
  pricingSettings: null,     // admin: pricing config
  contactSettings: null,     // public-safe admin WhatsApp contact
};

export const pageName = document.body.dataset.page || "app";

export async function loadData() {
  const isAdmin      = store.appMode === "admin";
  const isFriendMode = store.currentUser && !isAdmin;

  const [products, categories, orders, users, myOrders, filaments, pricingSettings, contactSettings] = await Promise.all([
    api("/api/products"),
    api("/api/categories"),
    isAdmin      ? api("/api/orders")                  : Promise.resolve([]),
    isAdmin      ? api("/api/users")                   : Promise.resolve([]),
    isFriendMode ? api("/api/orders?mine=true")         : Promise.resolve([]),
    store.currentUser ? api("/api/filaments")          : Promise.resolve([]),
    isAdmin      ? api("/api/settings?key=pricing")    : Promise.resolve(null),
    isFriendMode ? api("/api/settings?key=contact")    : Promise.resolve(null),
  ]);
  store.products       = products;
  store.categories     = categories;
  store.orders         = orders;
  store.users          = users;
  store.myOrders       = myOrders;
  store.filaments      = filaments;
  store.pricingSettings = pricingSettings;
  store.contactSettings = contactSettings;
}

export function findProduct(productId) {
  return store.products.find((p) => p.id === productId);
}

export function findCategory(categoryId) {
  return store.categories.find((c) => c.id === categoryId);
}

export function getProductOrderedQuantity(productId) {
  return store.orders.reduce((total, order) => {
    return order.productId === productId ? total + order.quantity : total;
  }, 0);
}
