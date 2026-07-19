import { api } from "./api.js";

// Single mutable store — all modules share this object reference.
// Mutate properties (store.currentUser = x), never replace the object itself.
export const store = {
  currentUser:    null,
  appMode:        "friend",
  products:       [],
  categories:     [],        // authenticated friends: active only; admin: all
  orders:         [],        // admin: all orders
  users:          [],        // admin: all users
  myOrders:       [],        // friend: own orders
  filaments:      [],        // all authenticated users: filament reference data
  pricingSettings: null,     // admin: pricing config
  contactSettings: null,     // public-safe admin WhatsApp contact
  expenses:       [],        // admin only: business expenses
  insights:       null,
  goals:          [],
  ledger:         [],
  transparency:   null,      // aggregate public-safe project data, when the endpoint is available
  feedback:       [],        // admin only: bug reports & improvement suggestions
  printJobs:      [],        // admin only: live one-click print jobs (bridge state)
  printer:        null,      // admin only: P2S state + bridge heartbeat
};

export const pageName = document.body.dataset.page || "app";

export async function loadData() {
  const isAdmin      = store.appMode === "admin";
  const isFriendMode = store.currentUser && !isAdmin;

  const [products, categories, orders, users, myOrders, filaments, pricingSettings, contactSettings, expenses, insights, goals, ledger, transparency, feedback, printJobs, printer] = await Promise.all([
    api("/api/products"),
    api("/api/categories"),
    isAdmin      ? api("/api/orders")                  : Promise.resolve([]),
    isAdmin      ? api("/api/users")                   : Promise.resolve([]),
    isFriendMode ? api("/api/orders?mine=true")         : Promise.resolve([]),
    isAdmin      ? api("/api/filaments")                  : Promise.resolve([]),
    isAdmin      ? api("/api/settings?key=pricing")    : Promise.resolve(null),
    store.currentUser ? api("/api/settings?key=contact") : Promise.resolve(null),
    isAdmin      ? api("/api/expenses")                : Promise.resolve([]),
    isAdmin      ? api("/api/insights")                : Promise.resolve(null),
    isAdmin      ? api("/api/goals")                   : Promise.resolve([]),
    isAdmin      ? api("/api/ledger")                  : Promise.resolve([]),
    !isAdmin     ? api("/api/transparency").catch(() => null) : Promise.resolve(null),
    isAdmin      ? api("/api/feedback")                : Promise.resolve([]),
    isAdmin      ? api("/api/print-jobs")              : Promise.resolve([]),
    isAdmin      ? api("/api/printer")                 : Promise.resolve(null),
  ]);
  store.products       = products;
  store.categories     = categories;
  store.orders         = orders;
  store.users          = users;
  store.myOrders       = myOrders;
  store.filaments      = filaments;
  store.pricingSettings = pricingSettings;
  store.contactSettings = contactSettings;
  store.expenses        = expenses;
  store.insights         = insights;
  store.goals            = goals;
  store.ledger           = ledger;
  store.transparency     = transparency;
  store.feedback         = feedback;
  store.printJobs        = printJobs;
  store.printer          = printer;
}

export function findProduct(productId) {
  return store.products.find((p) => p.id === productId);
}
