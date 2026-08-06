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
  bridgeFiles:    [],        // admin only: metadata for files stored on the local bridge
  bridge:         null,      // admin only: last local bridge inventory/health state
  dataLoadFailures: [],      // labels for independently failed dashboard data sources
};

export const pageName = document.body.dataset.page || "app";

export async function loadData() {
  const isAdmin      = store.appMode === "admin";
  const isFriendMode = store.currentUser && !isAdmin;

  const failures = [];
  const safe = async (label, request, fallback) => {
    try {
      return await request;
    } catch (error) {
      failures.push(label);
      console.warn(`Failed to load ${label}:`, error);
      return fallback;
    }
  };

  const [products, categories, orders, users, myOrders, filaments, pricingSettings, contactSettings, expenses, insights, goals, ledger, transparency, feedback, printJobs, printer, bridgeFilesResponse] = await Promise.all([
    safe("מוצרים", api("/api/products"), []),
    safe("קטגוריות", api("/api/categories"), []),
    isAdmin      ? safe("הזמנות", api("/api/orders"), [])                       : Promise.resolve([]),
    isAdmin      ? safe("משתמשים", api("/api/users"), [])                       : Promise.resolve([]),
    isFriendMode ? safe("ההזמנות שלי", api("/api/orders?mine=true"), [])        : Promise.resolve([]),
    isAdmin      ? safe("פילמנטים", api("/api/filaments"), [])                  : Promise.resolve([]),
    isAdmin      ? safe("הגדרות תמחור", api("/api/settings?key=pricing"), null)  : Promise.resolve(null),
    store.currentUser ? safe("פרטי קשר", api("/api/settings?key=contact"), null) : Promise.resolve(null),
    isAdmin      ? safe("הוצאות", api("/api/expenses"), [])                     : Promise.resolve([]),
    isAdmin      ? safe("תובנות", api("/api/insights"), null)                   : Promise.resolve(null),
    isAdmin      ? safe("יעדים", api("/api/goals"), [])                         : Promise.resolve([]),
    isAdmin      ? safe("יומן כספי", api("/api/ledger"), [])                    : Promise.resolve([]),
    !isAdmin     ? safe("שקיפות", api("/api/transparency"), null)               : Promise.resolve(null),
    isAdmin      ? safe("משוב", api("/api/feedback"), [])                       : Promise.resolve([]),
    isAdmin      ? safe("משימות הדפסה", api("/api/print-jobs"), [])             : Promise.resolve([]),
    isAdmin      ? safe("מצב מדפסת", api("/api/printer"), null)                 : Promise.resolve(null),
    isAdmin      ? safe("קובצי הגשר", api("/api/bridge-files"), { files: [], bridge: null }) : Promise.resolve({ files: [], bridge: null }),
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
  store.bridgeFiles      = bridgeFilesResponse?.files ?? [];
  store.bridge           = bridgeFilesResponse?.bridge ?? null;
  store.dataLoadFailures = [...new Set(failures)];
}

export function findProduct(productId) {
  return store.products.find((p) => p.id === productId);
}
