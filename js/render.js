import { store, loadData, findProduct } from "./state.js";
import { formatCurrency, escapeHtml, calculateProductCost } from "./utils.js";
import { api } from "./api.js";
import { openOrderDialog, openCustomOrderDialog } from "./orders.js";
import { createWhatsAppLink, whatsappTemplates, STATUS_LABELS } from "./whatsapp.js";
import { setView } from "./auth.js";

// Canonical order, used to build status <select> options (STATUS_LABELS also
// carries legacy keys as a display fallback, which must not appear as choices).
const ORDER_STATUS_SEQUENCE = [
  "new", "waiting_approval", "waiting_print", "printing",
  "ready_delivery", "completed", "failed", "cancelled",
];

const ORDER_TYPE_LABELS = {
  catalog: "מהקטלוג",
  external_link: "קישור חיצוני",
  custom: "בקשה מיוחדת",
  future_upload: "העלאת קובץ",
};

const USER_STATUS_LABELS = {
  pending:  "ממתין לאישור",
  active:   "פעיל",
  inactive: "לא פעיל",
  rejected: "נדחה",
};

const EXPENSE_CATEGORY_LABELS = {
  filament:           "פילמנט",
  parts_maintenance:  "חלקים / תחזוקה",
  accessories:        "אביזרים",
  paid_models:        "מודלים בתשלום",
  electricity:        "חשמל",
  general:            "כללי",
};

const NO_PRICE_YET = "מחיר ייקבע לאחר בדיקה";

// Ideas, external links and custom requests have no agreed price until the admin
// quotes one. Such an order must never be shown as an amount, nor summed into
// income or debt — it would invent money that nobody agreed to.
function orderAmount(order) {
  const amount = Number(order.finalAmount ?? order.price);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function orderAmountLabel(order) {
  const amount = orderAmount(order);
  return amount == null ? NO_PRICE_YET : formatCurrency(amount);
}

function sumOrderAmounts(orders) {
  return orders.reduce((total, order) => total + (orderAmount(order) ?? 0), 0);
}

// The server resolves filament ids to names; fall back to the raw value only for
// legacy rows so a friend never sees a bare uuid.
function orderColorNames(order) {
  const names = order.selectedColorNames?.length ? order.selectedColorNames : order.selectedColors;
  return (names ?? []).filter(Boolean);
}

// ── Public entry point ────────────────────────────────────────

export function render() {
  renderCatalog();
  renderOrders();
  renderItemStats();
  renderUsersAdmin();
  renderStoreEdit();
  renderCategoriesAdmin();
  renderActionQueue();
  renderWelcome();
  renderFilaments();
  renderPricingForm();
  renderContactSettingsForm();
  renderExpenses();
  renderBusinessInsights();
  renderFeedback();
  renderNotifications();
}

// ── Admin notifications (tab badges + top-bar bell) ───────────
// Derived "needs action" counts: each number reflects items that currently
// require the admin's attention and drops as they are handled (order promoted,
// registration approved, filament refilled, maintenance done). No unread state.
const FILAMENT_LOW_RATIO = 0.1; // ≤10% of a full spool counts as "running low"

function isFilamentLow(filament) {
  if (!filament || filament.active === false) return false;
  const remaining = filament.remainingGrams;
  if (remaining == null) return false; // untracked spools are ignored
  const spool = Number(filament.spoolGrams) || 1000;
  return Number(remaining) <= spool * FILAMENT_LOW_RATIO;
}

function maintenanceAttentionCount(insights) {
  if (!insights) return 0;
  const partsDue = (insights.partsHealth || []).filter((p) => p.warning).length;
  const tasksDue = (insights.maintenanceTasks || []).filter((t) => t.dueSoon).length;
  return partsDue + tasksDue;
}

// Every admin notification category in one place. `view`/`sub` drive navigation
// when a bell-panel row is clicked; adding a category is a single entry here.
function computeAdminNotifications() {
  return [
    { key: "orders",      label: "הזמנות חדשות",      view: "orders",   count: store.orders.filter((o) => o.status === "new").length },
    { key: "users",       label: "הרשמות ממתינות",    view: "users",    sub: "pending-users",       count: store.users.filter((u) => u.status === "pending").length },
    { key: "feedback",    label: "משוב חדש",           view: "feedback", count: (store.feedback || []).filter((f) => f.status !== "resolved").length },
    { key: "filaments",   label: "חומר עומד להיגמר",   view: "settings", sub: "settings-filaments",   count: store.filaments.filter(isFilamentLow).length },
    { key: "maintenance", label: "טיפול או חלק שמתקרב", view: "finance",  sub: "finance-business",     count: maintenanceAttentionCount(store.insights) },
  ];
}

// A category can drive several badge elements (e.g. tab + matching sub-tab).
const NOTIF_BADGE_IDS = {
  orders:      ["new-orders-badge"],
  users:       ["pending-tab-badge", "pending-sub-badge"],
  feedback:    ["feedback-tab-badge"],
  filaments:   ["low-filaments-badge"],
  maintenance: ["maintenance-badge"],
};

function goToNotification(entry) {
  setView(entry.view);
  if (entry.sub) document.querySelector(`.sub-tab[data-sub="${entry.sub}"]`)?.click();
}

// Single source of truth for every admin badge + the top-bar bell, so the tab
// counts and the aggregate bell count can never drift apart.
function renderNotifications() {
  const categories = computeAdminNotifications();

  categories.forEach((entry) => {
    (NOTIF_BADGE_IDS[entry.key] || []).forEach((id) => {
      const el = document.querySelector(`#${id}`);
      if (!el) return;
      el.textContent = entry.count || "";
      el.hidden = entry.count === 0;
    });
  });

  const total = categories.reduce((sum, entry) => sum + entry.count, 0);
  const bellCount = document.querySelector("#notif-bell-count");
  if (bellCount) {
    bellCount.textContent = total || "";
    bellCount.hidden = total === 0;
  }
  document.querySelector("#notif-bell")?.classList.toggle("has-notifications", total > 0);

  const panel = document.querySelector("#notif-panel");
  if (!panel) return;
  panel.replaceChildren();

  const active = categories.filter((entry) => entry.count > 0);
  if (active.length === 0) {
    const empty = document.createElement("p");
    empty.className = "notif-panel-empty";
    empty.textContent = "אין התראות חדשות 🎉";
    panel.append(empty);
    return;
  }

  active.forEach((entry) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "notif-panel-row";
    row.setAttribute("role", "menuitem");
    row.innerHTML = `<span class="notif-panel-label">${escapeHtml(entry.label)}</span><span class="notif-panel-count">${entry.count}</span>`;
    row.addEventListener("click", () => {
      goToNotification(entry);
      panel.hidden = true;
      document.querySelector("#notif-bell")?.setAttribute("aria-expanded", "false");
    });
    panel.append(row);
  });
}

const FEEDBACK_KIND_LABELS = { bug: "באג / תקלה", improvement: "הצעה לשיפור" };

function renderFeedback() {
  const list = document.querySelector("#feedback-list");
  if (!list) return;

  const items = store.feedback || [];
  // #feedback-tab-badge is owned centrally by renderNotifications().

  document.querySelector("#feedback-empty")
    ?.classList.toggle("is-visible", items.length === 0);

  list.replaceChildren();
  items.forEach((item) => {
    const resolved = item.status === "resolved";
    const loggedIn = Boolean(item.user_id);
    const when = item.created_at ? new Date(item.created_at).toLocaleString("he-IL") : "";
    const card = document.createElement("article");
    card.className = `feedback-card${resolved ? " is-resolved" : ""}`;
    card.innerHTML = `
      <div class="feedback-card-head">
        <span class="feedback-kind-badge feedback-kind-${escapeHtml(item.kind)}">${escapeHtml(FEEDBACK_KIND_LABELS[item.kind] ?? item.kind)}</span>
        <span class="feedback-source-badge ${loggedIn ? "is-member" : "is-external"}">${loggedIn ? "משתמש מחובר" : "חיצוני / לא מחובר"}</span>
        ${resolved ? '<span class="feedback-status-badge">טופל</span>' : ""}
      </div>
      <p class="feedback-message">${escapeHtml(item.message ?? "")}</p>
      <div class="feedback-meta">
        <span>${escapeHtml(item.name || "ללא שם")}</span>
        ${item.phone ? `<span>${escapeHtml(item.phone)}</span>` : ""}
        ${item.page ? `<span>עמוד: ${escapeHtml(item.page)}</span>` : ""}
        <span>${escapeHtml(when)}</span>
      </div>
      <div class="feedback-actions"></div>
    `;

    const actions = card.querySelector(".feedback-actions");

    const toggleBtn = document.createElement("button");
    toggleBtn.className   = "ghost-button btn-sm";
    toggleBtn.type        = "button";
    toggleBtn.textContent = resolved ? "החזר לפתוח" : "סמן כטופל";
    toggleBtn.addEventListener("click", () => setFeedbackStatus(item.id, resolved ? "new" : "resolved"));

    const deleteBtn = document.createElement("button");
    deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
    deleteBtn.type        = "button";
    deleteBtn.textContent = "מחק";
    deleteBtn.addEventListener("click", () => deleteFeedback(item.id));

    actions.append(toggleBtn, " ", deleteBtn);
    list.append(card);
  });
}

async function setFeedbackStatus(id, status) {
  try {
    await api(`/api/feedback?id=${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
    const item = (store.feedback || []).find((f) => f.id === id);
    if (item) item.status = status;
    render();
  } catch (err) {
    alert(`שגיאה בעדכון הפנייה: ${err.message}`);
  }
}

async function deleteFeedback(id) {
  if (!window.confirm("למחוק פנייה זו? פעולה זו אינה הפיכה.")) return;
  try {
    await api(`/api/feedback?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    store.feedback = (store.feedback || []).filter((f) => f.id !== id);
    render();
  } catch (err) {
    alert(`שגיאה במחיקת הפנייה: ${err.message}`);
  }
}

function renderBusinessInsights() {
  const insights = store.insights;
  const grid = document.querySelector("#business-summary-grid");
  if (!grid || !insights) return;
  const ownerText = insights.owner.balance >= 0 ? `העסק חייב לך ${formatCurrency(insights.owner.balance)}` : `אתה חייב לעסק ${formatCurrency(Math.abs(insights.owner.balance))}`;
  grid.innerHTML = [
    ["קופת תחזוקה", insights.maintenance.balance], ["קופה פנויה", insights.business.available],
    ["רווח והפסד", insights.pnl.profit],
  ].map(([label, value]) => `<article class="finance-card"><span>${label}</span><strong>${formatCurrency(value)}</strong></article>`).join("") + `<article class="finance-card"><span>חשבון בעלים</span><strong>${ownerText}</strong></article>`;
  const parts = document.querySelector("#parts-health-list");
  parts.innerHTML = insights.partsHealth.map((part) => `<article class="business-row"><span>${escapeHtml(part.name)}</span><progress max="100" value="${Math.min(part.percent, 100)}"></progress><strong>${Math.round(part.percent)}%</strong><button class="ghost-button btn-sm" data-maintenance-id="${escapeHtml(part.id)}">החלפתי</button></article>`).join("");
  parts.querySelectorAll("[data-maintenance-id]").forEach((button) => button.addEventListener("click", async () => {
    await api("/api/maintenance", { method: "POST", body: JSON.stringify({ partId: button.dataset.maintenanceId, eventType: "replace" }) });
    await loadData(); render();
  }));
  const tasks = document.querySelector("#maintenance-tasks-list");
  tasks.innerHTML = insights.maintenanceTasks.map((task) => `<article class="business-row"><span>${escapeHtml(task.name)}</span><strong>כל ${task.everyHours} שעות / ${task.everyDays} ימים</strong><button class="ghost-button btn-sm" data-service-id="${escapeHtml(task.id)}">טיפלתי</button></article>`).join("");
  tasks.querySelectorAll("[data-service-id]").forEach((button) => button.addEventListener("click", async () => {
    await api("/api/maintenance", { method: "POST", body: JSON.stringify({ partId: button.dataset.serviceId, eventType: "service" }) }); await loadData(); render();
  }));
  document.querySelector("#risk-list").innerHTML = insights.risk.map((item) => `<article class="business-row"><span>${escapeHtml(item.label)}</span><strong>${item.enoughData ? `${Math.round(item.actualPercent * 100)}% בפועל מול ${Math.round(item.configuredPercent * 100)}%` : `אין מספיק נתונים (${item.samples}/10)`}</strong></article>`).join("");
  const goalsList = document.querySelector("#goals-list");
  goalsList.innerHTML = store.goals.map((goal) => `<article class="business-row"><span>${escapeHtml(goal.name)}<small>${goal.public_visible ? `מוצג לציבור כ־${escapeHtml(goal.public_label || goal.name)}` : "פרטי למנהל"}</small></span><progress max="${Number(goal.target_amount)}" value="${Number(goal.saved)}"></progress><strong>${formatCurrency(goal.saved)} / ${formatCurrency(goal.target_amount)}</strong><button type="button" class="ghost-button btn-sm" data-goal-public="${escapeHtml(goal.id)}" data-public-visible="${goal.public_visible ? "true" : "false"}">${goal.public_visible ? "הסתר" : "פרסם"}</button></article>`).join("") || "אין יעדים עדיין";
  goalsList.querySelectorAll("[data-goal-public]").forEach((button) => button.addEventListener("click", async () => {
    await api(`/api/goals?id=${encodeURIComponent(button.dataset.goalPublic)}`, { method: "PUT", body: JSON.stringify({ publicVisible: button.dataset.publicVisible !== "true" }) });
    await loadData(); render();
  }));
  const ledgerList = document.querySelector("#ledger-list");
  ledgerList.innerHTML = store.ledger.map((entry) => `<article class="business-row"><span>${escapeHtml(entry.description)}<small>${entry.public_visible ? `מוצג לציבור כ־${escapeHtml(entry.public_label || entry.description)}` : "פרטי למנהל"}</small></span><strong>${formatCurrency(entry.amount)}</strong><button type="button" class="ghost-button btn-sm" data-ledger-public="${escapeHtml(entry.id)}" data-public-visible="${entry.public_visible ? "true" : "false"}">${entry.public_visible ? "הסתר" : "פרסם"}</button></article>`).join("");
  ledgerList.querySelectorAll("[data-ledger-public]").forEach((button) => button.addEventListener("click", async () => {
    await api(`/api/ledger?id=${encodeURIComponent(button.dataset.ledgerPublic)}`, { method: "PUT", body: JSON.stringify({ publicVisible: button.dataset.publicVisible !== "true" }) });
    await loadData(); render();
  }));
}

// ── Shared: resolve the user behind an order ──────────────────
// An order's user_id is authoritative; friend_name is only a fallback for
// legacy rows created before user_id existed. Renaming a user must not
// orphan their orders, so name is never used when user_id is present.
function findOrderUser(order) {
  if (order.userId) return store.users.find((u) => u.id === order.userId);
  return store.users.find((u) => u.name === order.friendName);
}

function ordersForUser(user) {
  return store.orders.filter((o) =>
    o.userId != null ? o.userId === user.id : o.friendName === user.name);
}

// ── Catalog (friend view) ─────────────────────────────────────

// Transient UI state — which category chip is selected. Not persisted in
// store since it's a local view filter, not app data.
let selectedCategoryId = null;

function renderCategoryFilters() {
  const container = document.querySelector("#category-filters");
  if (!container) return;

  const activeCategories = store.categories.filter((c) => c.active !== false);
  if (activeCategories.length === 0) { container.replaceChildren(); return; }

  // Selected category may have been deactivated/deleted since last render.
  if (selectedCategoryId && !activeCategories.some((c) => c.id === selectedCategoryId)) {
    selectedCategoryId = null;
  }

  container.replaceChildren();

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = `category-chip${selectedCategoryId === null ? " is-active" : ""}`;
  allChip.textContent = "הכל";
  allChip.addEventListener("click", () => { selectedCategoryId = null; render(); });
  container.append(allChip);

  activeCategories.forEach((category) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `category-chip${selectedCategoryId === category.id ? " is-active" : ""}`;
    chip.textContent = category.name;
    chip.addEventListener("click", () => { selectedCategoryId = category.id; render(); });
    container.append(chip);
  });
}

function getOrderEligibility() {
  const user = store.currentUser;
  if (!user) return { canOrder: false, label: "התחבר כדי להזמין", clickable: true };
  if (user.role === "admin" || user.status === "active") return { canOrder: true };
  if (user.status === "pending") {
    return { canOrder: false, label: "ממתין לאישור מנהל", clickable: false };
  }
  return { canOrder: false, label: "לא ניתן להזמין כרגע", clickable: false };
}

function renderCatalog() {
  const catalogGrid  = document.querySelector("#catalog-grid");
  const ideasGrid    = document.querySelector("#ideas-grid");
  const cardTemplate = document.querySelector("#product-card-template");
  if (!catalogGrid || !cardTemplate) return;

  renderCategoryFilters();

  let visibleProducts = store.products.filter((product) => product.catalogStatus !== "incomplete");

  if (selectedCategoryId) {
    visibleProducts = visibleProducts.filter((p) => p.categoryIds?.includes(selectedCategoryId));
  }

  const eligibility = getOrderEligibility();

  catalogGrid.replaceChildren();
  ideasGrid?.replaceChildren();
  document.querySelector("#catalog-empty")
    ?.classList.toggle("is-visible", visibleProducts.length === 0);

  visibleProducts.forEach((product) => {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    renderProductImage(card.querySelector(".product-image"), product);
    card.querySelector("h3").textContent = product.name;
    card.querySelector("p").textContent  = product.description;
    const isIdea = product.catalogKind === "idea" || (product.catalogKind == null && product.requiresAdminApproval);
    card.querySelector(".cost").textContent = isIdea
      ? "מחיר לאחר בדיקה"
      : product.requiresAdminApproval
        ? `מחיר משוער ${formatCurrency(product.cost)}`
        : formatCurrency(product.cost);
    renderStlLink(card, product);
    renderProductBadges(card, product);
    renderProductFacts(card, product);

    const orderBtn = card.querySelector("button");
    orderBtn.textContent = product.inventoryAvailable === false ? "בקשת חלופה" : isIdea ? "בקשת בדיקה" : "הזמנה";
    if (eligibility.canOrder) {
      orderBtn.addEventListener("click", () => openOrderDialog(product.id));
    } else {
      orderBtn.textContent = eligibility.label;
      orderBtn.classList.add("order-btn-disabled");
      orderBtn.disabled = !eligibility.clickable;
      if (eligibility.clickable) {
        orderBtn.addEventListener("click", () => { window.location.href = "dashboard.html"; });
      }
    }
    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.className = "ghost-button btn-sm";
    detailBtn.textContent = "פרטים נוספים";
    detailBtn.setAttribute("aria-label", `פרטים נוספים על ${product.name}`);
    detailBtn.addEventListener("click", () => openProductDetail(product, eligibility));
    card.querySelector(".product-meta")?.prepend(detailBtn);
    (isIdea && ideasGrid ? ideasGrid : catalogGrid).append(card);
  });

  const hasIdeas = visibleProducts.some((product) => product.catalogKind === "idea" || (product.catalogKind == null && product.requiresAdminApproval));
  const hasPrinted = visibleProducts.some((product) => !(product.catalogKind === "idea" || (product.catalogKind == null && product.requiresAdminApproval)));
  const ideasSection = document.querySelector("#idea-products-section");
  const printedSection = document.querySelector("#printed-products-section");
  if (ideasSection) ideasSection.hidden = !hasIdeas;
  if (printedSection) printedSection.hidden = !hasPrinted;

  const pendingReorder = sessionStorage.getItem("pendingReorder");
  if (pendingReorder) {
    sessionStorage.removeItem("pendingReorder");
    try {
      const previous = JSON.parse(pendingReorder);
      const currentProduct = findProduct(previous.productId);
      if (currentProduct && currentProduct.catalogStatus !== "incomplete") {
        openOrderDialog(currentProduct.id, previous);
      } else {
        openCustomOrderDialog();
        const form = document.querySelector("#custom-order-form");
        if (form) {
          form.elements.requestDescription.value = `בקשה להדפסה חוזרת: ${previous.productName || "מוצר שאינו זמין עוד"}`;
          form.elements.userNotes.value = previous.selectedColor ? `צבע קודם: ${previous.selectedColor}` : "";
          form.elements.quantity.value = Math.max(Number(previous.quantity) || 1, 1);
        }
      }
    } catch { /* Ignore malformed local UI state. */ }
  }
}

function normalizedProductImages(product) {
  const images = (product.images ?? [])
    .map((image) => typeof image === "string" ? { url: image, isMain: false } : image)
    .filter((image) => image?.url);
  if (product.image && !images.some((image) => image.url === product.image)) {
    images.unshift({ url: product.image, isMain: images.length === 0 });
  }
  return images.sort((a, b) => Number(Boolean(b.isMain)) - Number(Boolean(a.isMain)));
}

function publicColorOptions(product) {
  if (Array.isArray(product.colorOptions) && product.colorOptions.length) return product.colorOptions;
  return (product.possibleColors ?? []).map((color) => ({ value: color, label: color, available: true }));
}

function openProductDetail(product, eligibility = getOrderEligibility()) {
  const dialog = document.querySelector("#product-detail-dialog");
  if (!dialog) return;
  document.querySelector("#product-detail-title").textContent = product.name;
  document.querySelector("#product-detail-description").textContent = product.description || "אין תיאור נוסף למוצר.";
  const isIdea = product.catalogKind === "idea" || (product.catalogKind == null && product.requiresAdminApproval);
  document.querySelector("#product-detail-price").textContent = isIdea
    ? "המחיר ייקבע לאחר בדיקה"
    : product.requiresAdminApproval
      ? `מחיר משוער ${formatCurrency(product.cost)} — ייקבע סופית לאחר בדיקה`
      : formatCurrency(product.cost);

  const facts = [];
  if (Number(product.printHours) > 0) facts.push(`זמן הדפסה משוער: כ־${product.printHours} שעות`);
  if (Number(product.grams) > 0) facts.push(`משקל משוער: כ־${product.grams} גרם`);
  if (product.allowMultiple === false) facts.push("ניתן להזמין יחידה אחת בלבד");
  if (product.requiredColors?.length) facts.push(`צבעים נדרשים: ${product.requiredColors.join(", ")}`);
  const factsContainer = document.querySelector("#product-detail-facts");
  factsContainer.replaceChildren(...facts.map((text) => {
    const span = document.createElement("span"); span.className = "product-fact"; span.textContent = text; return span;
  }));

  const colorsContainer = document.querySelector("#product-detail-colors");
  colorsContainer.replaceChildren();
  publicColorOptions(product).forEach((raw) => {
    const option = typeof raw === "string" ? { label: raw, value: raw, available: true } : raw;
    const item = document.createElement("span");
    item.className = `product-fact${option.available === false ? " is-unavailable" : ""}`;
    item.textContent = `${option.label ?? option.name ?? option.value}${option.available === false ? " — לא זמין כרגע" : ""}`;
    colorsContainer.append(item);
  });
  const availability = document.querySelector("#product-detail-availability");
  availability.textContent = product.inventoryAvailable === false
    ? "לא זמין כרגע במלאי. אפשר לשלוח בקשה לחלופה; ההדפסה לא תתחיל ללא אישורך."
      : isIdea || product.requiresAdminApproval ? "נדרשים בדיקה ואישור מחיר לפני תחילת ההדפסה." : "זמין להזמנה.";
  const badges = document.querySelector("#product-detail-badges");
  badges.replaceChildren();
  if (isIdea || product.requiresAdminApproval) {
    const badge = document.createElement("span");
    badge.className = "product-badge product-badge-idea";
    badge.textContent = isIdea ? "רעיון לבדיקה" : "דורש אישור מנהל";
    badges.append(badge);
  }
  if (product.inventoryAvailable === false) {
    const badge = document.createElement("span");
    badge.className = "product-badge";
    badge.textContent = "לא זמין כרגע";
    badges.append(badge);
  }

  const source = document.querySelector("#product-detail-source");
  const sourceUrl = product.sourceUrl || product.stlUrl;
  source.hidden = !sourceUrl;
  if (sourceUrl) source.href = sourceUrl;

  const images = normalizedProductImages(product);
  const main = document.querySelector("#product-detail-main-image");
  const thumbs = document.querySelector("#product-detail-thumbnails");
  const showImage = (image) => {
    main.replaceChildren();
    if (!image) { main.textContent = "אין תמונה זמינה"; return; }
    const img = document.createElement("img"); img.src = image.url; img.alt = product.name; main.append(img);
  };
  showImage(images[0]);
  thumbs.replaceChildren();
  images.forEach((image, index) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "product-thumb";
    button.setAttribute("aria-label", `הצגת תמונה ${index + 1} מתוך ${images.length}`);
    const img = document.createElement("img"); img.src = image.url; img.alt = ""; button.append(img);
    button.addEventListener("click", () => showImage(image)); thumbs.append(button);
  });

  const orderButton = document.querySelector("#product-detail-order");
  orderButton.disabled = !eligibility.canOrder && !eligibility.clickable;
  orderButton.textContent = eligibility.canOrder ? (product.inventoryAvailable === false ? "בקשת חלופה" : "מעבר להזמנה") : eligibility.label;
  orderButton.onclick = () => {
    dialog.close();
    if (eligibility.canOrder) openOrderDialog(product.id);
    else if (eligibility.clickable) window.location.href = "dashboard.html";
  };
  dialog.showModal();
}

document.querySelectorAll("[data-close-product-detail]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector("#product-detail-dialog")?.close());
});

// ── Orders (admin view): grouped cards, filter bar, drawer ────

const PAST_STATUSES = new Set(["completed", "failed", "cancelled"]);
const FORWARD_STATUS_SEQUENCE = ["new", "waiting_approval", "waiting_print", "printing", "ready_delivery", "completed"];

let orderSearchQuery = "";
let orderStatusFilter = "all"; // all | unpaid | open | done

document.querySelector("#orders-search")?.addEventListener("input", (e) => {
  orderSearchQuery = e.target.value.trim().toLowerCase();
  renderOrders();
});
document.querySelectorAll("#orders-filter-chips .filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    orderStatusFilter = chip.dataset.filter;
    document.querySelectorAll("#orders-filter-chips .filter-chip")
      .forEach((c) => c.classList.toggle("is-active", c === chip));
    renderOrders();
  });
});

function nextOrderStatus(status) {
  const idx = FORWARD_STATUS_SEQUENCE.indexOf(status);
  if (idx === -1 || idx === FORWARD_STATUS_SEQUENCE.length - 1) return null;
  return FORWARD_STATUS_SEQUENCE[idx + 1];
}

function matchesOrderFilter(order) {
  if (orderStatusFilter === "unpaid" && (order.paid || order.status === "cancelled")) return false;
  if (orderStatusFilter === "open" && PAST_STATUSES.has(order.status)) return false;
  if (orderStatusFilter === "done" && !PAST_STATUSES.has(order.status)) return false;
  if (!orderSearchQuery) return true;
  const product = findProduct(order.productId);
  const haystack = `${order.friendName} ${product?.name ?? order.requestDescription ?? ""}`.toLowerCase();
  return haystack.includes(orderSearchQuery);
}

async function setOrderStatus(order, next, cancellationReason) {
  const previous = order.status;
  order.status = next;
  render();
  try {
    const updated = await api(`/api/orders?id=${encodeURIComponent(order.id)}`, {
      method: "PUT",
      body: JSON.stringify({ status: next, cancellationReason }),
    });
    Object.assign(order, updated);
    render();
    return true;
  } catch (err) {
    order.status = previous;
    render();
    alert(`שגיאה בעדכון סטטוס: ${err.message}`);
    return false;
  }
}

function buildOrderCard(order) {
  const product = findProduct(order.productId);
  const user = findOrderUser(order);
  const recipientName = user?.fullName || order.friendName;
  const orderName = product?.name || order.requestDescription || "הבקשה שלך";
  const amount = orderAmount(order);
  const amountLabel = orderAmountLabel(order);

  const card = document.createElement("article");
  card.className = "order-card";
  card.innerHTML = `
    <div class="order-card-header">
      <div class="order-card-title">
        <strong>${escapeHtml(order.friendName)}</strong>
        <span class="order-card-product">${escapeHtml(orderName)} ×${order.quantity}</span>
      </div>
      <div class="order-card-amount">${escapeHtml(amountLabel)}</div>
    </div>
    <div class="order-card-badges">
      <span class="ws-status-chip ws-status-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABELS[order.status] ?? order.status)}</span>
      ${order.paid ? '<span class="status-badge status-active">שולם</span>' : '<span class="status-badge status-pending">לא שולם</span>'}
      ${order.orderType && order.orderType !== "catalog"
        ? `<span class="status-badge status-inactive">${escapeHtml(ORDER_TYPE_LABELS[order.orderType] ?? order.orderType)}</span>`
        : ""}
    </div>
    <div class="order-card-actions"></div>
  `;

  const actions = card.querySelector(".order-card-actions");

  const next = nextOrderStatus(order.status);
  if (next) {
    const promoteBtn = document.createElement("button");
    promoteBtn.className   = "primary-button btn-sm";
    promoteBtn.type        = "button";
    promoteBtn.textContent = `קדם ל${STATUS_LABELS[next] ?? next} ←`;
    promoteBtn.addEventListener("click", () => setOrderStatus(order, next));
    actions.append(promoteBtn);
  }

  const statusSelect = document.createElement("select");
  statusSelect.className = "order-status-jump";
  statusSelect.setAttribute("aria-label", "מעבר לסטטוס אחר או ביטול");
  const placeholderOpt = document.createElement("option");
  placeholderOpt.value = "";
  placeholderOpt.textContent = "סטטוס אחר…";
  placeholderOpt.disabled = true;
  placeholderOpt.selected = true;
  statusSelect.append(placeholderOpt);
  ORDER_STATUS_SEQUENCE.forEach((value) => {
    if (value === order.status) return;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = STATUS_LABELS[value] ?? value;
    statusSelect.append(option);
  });
  statusSelect.addEventListener("change", () => {
    const value = statusSelect.value;
    statusSelect.value = "";
    if (!value) return;
    if (value === "cancelled") {
      openOrderDrawer(order, { focusCancel: true });
      return;
    }
    setOrderStatus(order, value);
  });
  actions.append(statusSelect);

  const paidLabel = document.createElement("label");
  paidLabel.className = "paid-toggle";
  paidLabel.innerHTML = `<input type="checkbox" ${order.paid ? "checked" : ""} /> שולם`;
  paidLabel.querySelector("input").addEventListener("change", async (event) => {
    const nextPaid = event.target.checked;
    const previous = order.paid;
    order.paid = nextPaid;
    render();
    try {
      const updated = await api(`/api/orders?id=${encodeURIComponent(order.id)}`, {
        method: "PUT",
        body: JSON.stringify({ paid: nextPaid }),
      });
      Object.assign(order, updated);
      render();
    } catch (err) {
      order.paid = previous;
      render();
      alert(`שגיאה בעדכון תשלום: ${err.message}`);
    }
  });
  actions.append(paidLabel);

  const detailsBtn = document.createElement("button");
  detailsBtn.className   = "ghost-button btn-sm";
  detailsBtn.type        = "button";
  detailsBtn.textContent = "פרטים";
  detailsBtn.addEventListener("click", () => openOrderDrawer(order));
  actions.append(detailsBtn);

  actions.append(createWhatsAppLink({
    phone: user?.phone,
    message: whatsappTemplates.status({ name: recipientName, product: orderName, status: order.status }),
    label: "עדכון בוואטסאפ",
    className: "btn-sm",
  }));

  if (amount != null) {
    actions.append(createWhatsAppLink({
      phone: user?.phone,
      message: whatsappTemplates.priceApproval({ name: recipientName, product: orderName, amount: amount.toFixed(2) }),
      label: "אישור מחיר",
      className: "btn-sm",
    }));
  }

  if (order.status === "ready_delivery") {
    actions.append(createWhatsAppLink({
      phone: user?.phone,
      message: whatsappTemplates.delivery({ name: recipientName }),
      label: "תיאום מסירה",
      className: "btn-sm",
    }));
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.className   = "ghost-button btn-sm user-delete-btn order-delete-btn";
  deleteBtn.type        = "button";
  deleteBtn.textContent = "מחק";
  deleteBtn.title       = "מחק הזמנה";
  deleteBtn.setAttribute("aria-label", `מחק הזמנה של ${order.friendName}`);
  deleteBtn.addEventListener("click", () => deleteOrder(order.id));
  actions.append(deleteBtn);

  return card;
}

// Live "my cost / total cost / profit" summary inside the order drawer.
// My cost = actual production cost (materials + electricity + wear); total cost
// = what the friend is being charged (base cost + support); profit is the gap.
function renderOrderCostSummary(order, form) {
  const body = document.querySelector("#order-drawer-cost-summary-body");
  if (!body) return;
  const myCost = order.productionCost;
  if (myCost == null) {
    body.innerHTML = `<span class="form-hint">אין נתוני עלות (הזמנה ללא מוצר מהקטלוג).</span>`;
    return;
  }
  const totalCost = form ? Number(form.elements.finalAmount.value) || 0 : Number(order.finalAmount) || 0;
  const profit = totalCost - myCost;
  body.innerHTML = `
    <div class="cost-preview-row"><span>העלות שלי (חומרים, חשמל, בלאי)</span><span>${formatCurrency(myCost)}</span></div>
    <div class="cost-preview-row"><span>עלות כוללת (מה שהחבר משלם)</span><span>${formatCurrency(totalCost)}</span></div>
    <div class="cost-preview-final"><span>רווח</span><span>${formatCurrency(profit)}</span></div>
  `;
}

// Order details / price editing / cancellation — all in one reusable drawer.
function openOrderDrawer(order, opts = {}) {
  const dialog     = document.querySelector("#order-drawer");
  const titleEl    = document.querySelector("#order-drawer-title");
  const readonlyEl = document.querySelector("#order-drawer-readonly");
  const form       = document.querySelector("#order-drawer-form");
  if (!dialog || !form) return;

  const product = findProduct(order.productId);
  titleEl.textContent = `${order.friendName} · ${product?.name || order.requestDescription || "הזמנה"}`;

  const readOnlyBits = [];
  if (order.requestDescription) readOnlyBits.push(`<div><strong>בקשה:</strong> ${escapeHtml(order.requestDescription)}</div>`);
  if (order.externalModelLink) readOnlyBits.push(`<div><strong>קישור:</strong> <a href="${escapeHtml(order.externalModelLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(order.externalModelLink)}</a></div>`);
  const colorNames = orderColorNames(order);
  if (colorNames.length) readOnlyBits.push(`<div><strong>צבעים:</strong> ${escapeHtml(colorNames.join(", "))}</div>`);
  if (order.colorAlternativeStatus && order.colorAlternativeStatus !== "none") {
    readOnlyBits.push(`<div><strong>חלופת צבע:</strong> ${escapeHtml(colorAlternativeLabel(order))}</div>`);
  }
  if (order.userNotes) readOnlyBits.push(`<div><strong>הערות לקוח:</strong> ${escapeHtml(order.userNotes)}</div>`);
  if (order.cancellationReason) readOnlyBits.push(`<div><strong>סיבת ביטול:</strong> ${escapeHtml(order.cancellationReason)}</div>`);
  readonlyEl.innerHTML = readOnlyBits.length ? `<div class="order-detail-readonly">${readOnlyBits.join("")}</div>` : "";

  if (["needed", "pending", "rejected"].includes(order.colorAlternativeStatus)) {
    const alternative = document.createElement("div");
    alternative.className = "order-color-alternative-admin";
    const heading = document.createElement("strong");
    heading.textContent = order.colorAlternativeStatus === "pending" ? "עדכון חלופת הצבע" : "הצעת צבע חלופי";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "צבע חלופי זמין");
    const availableFilaments = store.filaments.filter((filament) =>
      filament.active !== false && (filament.remainingGrams == null || Number(filament.remainingGrams) > 0));
    availableFilaments.forEach((filament) => {
      const option = document.createElement("option");
      option.value = filament.id;
      option.textContent = `${filament.name}${filament.remainingGrams == null ? "" : ` · ${Math.round(filament.remainingGrams)} גרם`}`;
      if (filament.id === order.proposedAlternativeColorValue) option.selected = true;
      select.append(option);
    });
    const propose = document.createElement("button");
    propose.type = "button";
    propose.className = "primary-button btn-sm";
    propose.textContent = "שליחת הצעה לחבר";
    propose.disabled = availableFilaments.length === 0;
    propose.addEventListener("click", async () => {
      propose.disabled = true;
      try {
        const updated = await api(`/api/orders?id=${encodeURIComponent(order.id)}`, {
          method: "PUT",
          body: JSON.stringify({ action: "propose-color-alternative", proposedAlternativeColor: select.value }),
        });
        Object.assign(order, updated);
        render();
        dialog.close();
      } catch (err) {
        alert(`שגיאה בשליחת החלופה: ${err.message}`);
        propose.disabled = availableFilaments.length === 0;
      }
    });
    if (availableFilaments.length === 0) {
      const empty = document.createElement("small");
      empty.textContent = "אין כרגע פילמנט פעיל וזמין להצעה.";
      alternative.append(heading, empty);
    } else {
      alternative.append(heading, select, propose);
    }
    readonlyEl.append(alternative);
  }

  form.elements.baseCost.value    = order.baseCost ?? "";
  form.elements.supportAmount.value = order.supportAmount ?? 0;
  form.elements.finalAmount.value = order.finalAmount ?? "";
  form.elements.requiresUserPriceApproval.checked = Boolean(order.requiresUserPriceApproval);
  form.elements.adminNotes.value  = order.adminNotes ?? "";
  form.elements.marginPercent.value = order.marginPercent == null ? "" : order.marginPercent * 100;
  form.elements.internal.checked = Boolean(order.internal);
  form.elements.wastedGrams.value = order.wastedGrams ?? 0;
  form.elements.wastedHours.value = order.wastedHours ?? 0;

  renderOrderCostSummary(order, form);
  form.oninput = () => renderOrderCostSummary(order, form);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      baseCost: fd.get("baseCost") === "" ? null : Number(fd.get("baseCost")),
      supportAmount: Number(fd.get("supportAmount")) || 0,
      finalAmount: fd.get("finalAmount") === "" ? null : Number(fd.get("finalAmount")),
      adminNotes: String(fd.get("adminNotes") ?? "").trim(),
      requiresUserPriceApproval: fd.get("requiresUserPriceApproval") !== null,
      marginPercent: fd.get("marginPercent") === "" ? null : Number(fd.get("marginPercent")) / 100,
      internal: fd.get("internal") !== null,
      wastedGrams: Number(fd.get("wastedGrams")) || 0,
      wastedHours: Number(fd.get("wastedHours")) || 0,
    };
    try {
      const updated = await api(`/api/orders?id=${encodeURIComponent(order.id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      Object.assign(order, updated);
      render();
      dialog.close();
    } catch (err) {
      alert(`שגיאה בשמירת פרטי הזמנה: ${err.message}`);
    }
  };

  const cancelSection    = document.querySelector("#order-drawer-cancel-section");
  const cancelToggle     = document.querySelector("#order-drawer-cancel-toggle");
  const cancelForm       = document.querySelector("#order-cancel-form");
  const cancelReasonInput = document.querySelector("#order-cancel-reason");
  const cancelConfirmBtn = document.querySelector("#order-cancel-confirm");
  const cancelAbortBtn   = document.querySelector("#order-cancel-abort");

  const canCancel = !PAST_STATUSES.has(order.status);
  cancelSection.hidden = !canCancel;
  cancelForm.hidden = !opts.focusCancel;
  cancelReasonInput.value = "";

  cancelToggle.onclick = () => { cancelForm.hidden = false; cancelReasonInput.focus(); };
  cancelAbortBtn.onclick = () => { cancelForm.hidden = true; };
  cancelConfirmBtn.onclick = async () => {
    const reason = cancelReasonInput.value.trim();
    if (!reason) { cancelReasonInput.focus(); return; }
    const ok = await setOrderStatus(order, "cancelled", reason);
    if (ok) dialog.close();
  };

  if (typeof dialog.showModal === "function") dialog.showModal();
}

function renderOrders() {
  const groupsContainer = document.querySelector("#orders-groups");
  if (!groupsContainer) return;

  const filtered = store.orders.filter(matchesOrderFilter);

  // Tab badge counts are owned centrally by renderNotifications().
  groupsContainer.replaceChildren();
  document.querySelector("#orders-empty")?.classList.toggle("is-visible", filtered.length === 0);

  ORDER_STATUS_SEQUENCE.forEach((status) => {
    const ordersInGroup = filtered.filter((o) => o.status === status);
    if (ordersInGroup.length === 0) return;

    const group = document.createElement("section");
    group.className = "order-status-group";
    const isCollapsedByDefault = PAST_STATUSES.has(status);

    const header = document.createElement("button");
    header.type = "button";
    header.className = "order-status-group-header";
    header.innerHTML = `
      <span>${escapeHtml(STATUS_LABELS[status] ?? status)}</span>
      <span class="order-status-group-count">${ordersInGroup.length}</span>
    `;

    const list = document.createElement("div");
    list.className = "order-status-group-list";
    list.hidden = isCollapsedByDefault;
    header.classList.toggle("is-collapsed", isCollapsedByDefault);
    header.addEventListener("click", () => {
      list.hidden = !list.hidden;
      header.classList.toggle("is-collapsed", list.hidden);
    });

    ordersInGroup.forEach((order) => list.append(buildOrderCard(order)));

    group.append(header, list);
    groupsContainer.append(group);
  });
}

// ── Items stats table (admin view) ───────────────────────────

function renderItemStats() {
  const tbody = document.querySelector("#items-table-body");
  if (!tbody) return;

  tbody.replaceChildren();
  document.querySelector("#items-empty")
    ?.classList.toggle("is-visible", store.products.length === 0);

  store.products.forEach((product) => {
    const orders    = store.orders.filter((o) => o.productId === product.id && o.status !== "cancelled");
    const completed = orders.filter((o) => o.status === "completed").length;
    const paidTotal   = sumOrderAmounts(orders.filter((o) => o.paid));
    const debtTotal   = sumOrderAmounts(orders.filter((o) => !o.paid));
    const supportTotal = orders.reduce((s, o) => s + (Number(o.supportAmount) || 0), 0);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td></td>
      <td>${escapeHtml(product.name)}</td>
      <td class="stat-cell">${formatCurrency(product.cost)}</td>
      <td class="stat-cell stat-muted">${product.grams}g</td>
      <td class="stat-cell">${orders.length}</td>
      <td class="stat-cell stat-completed">${completed}</td>
      <td class="stat-cell stat-revenue">${formatCurrency(paidTotal)}</td>
      <td class="stat-cell ${debtTotal > 0 ? "stat-negative" : "stat-muted"}">${formatCurrency(debtTotal)}</td>
      <td class="stat-cell ${supportTotal >= 0 ? "stat-positive" : "stat-negative"}">${formatCurrency(supportTotal)}</td>
    `;

    const imgCell = document.createElement("td");
    const thumb   = document.createElement("div");
    thumb.className = "product-thumb items-thumb";
    if (product.image) {
      const img = document.createElement("img");
      img.src             = product.image;
      img.alt             = product.name;
      img.loading         = "lazy";
      img.referrerPolicy  = "no-referrer";
      img.crossOrigin     = "anonymous";
      thumb.append(img);
    }
    imgCell.append(thumb);
    row.children[0].replaceWith(imgCell);

    tbody.append(row);
  });
}

// ── Users admin view (active + pending sub-tabs) ──────────────

function getUserOrderStats(user) {
  const orders  = ordersForUser(user).filter((o) => o.status !== "cancelled");
  const revenue = sumOrderAmounts(orders);
  const paid    = sumOrderAmounts(orders.filter((o) => o.paid));
  const support = orders.reduce((s, o) => s + (Number(o.supportAmount) || 0), 0);
  return { count: orders.length, revenue, paid, debt: revenue - paid, support };
}

function renderUsersAdmin() {
  const active   = store.users.filter((u) => u.status === "active");
  const pending  = store.users.filter((u) => u.status === "pending");
  const inactive = store.users.filter((u) => u.status === "inactive");
  const rejected = store.users.filter((u) => u.status === "rejected");

  // Pending-count badges (tab + sub-tab) are owned by renderNotifications().

  // ── Active users ──────────────────────────────────────────
  const activeTable = document.querySelector("#active-users-table");
  if (activeTable) {
    activeTable.replaceChildren();
    const activeList = [...active, ...inactive, ...rejected];
    document.querySelector("#active-users-empty")
      ?.classList.toggle("is-visible", activeList.length === 0);

    activeList.forEach((user) => {
      const stats = getUserOrderStats(user);

      // ── Display row ──────────────────────────────────────
      const row = document.createElement("tr");
      row.dataset.userId = user.id;
      row.innerHTML = `
        <td>
          ${escapeHtml(user.name)}
          ${user.role === "admin" ? `<span class="status-badge status-active">מנהל</span>` : ""}
          ${user.status !== "active" ? `<span class="status-badge status-${escapeHtml(user.status)}">${USER_STATUS_LABELS[user.status] ?? user.status}</span>` : ""}
        </td>
        <td>${escapeHtml(user.fullName ?? "")}</td>
        <td class="stat-cell">${stats.count}</td>
        <td class="stat-cell stat-revenue">${formatCurrency(stats.revenue)}</td>
        <td class="stat-cell">${formatCurrency(stats.paid)}</td>
        <td class="stat-cell ${stats.debt > 0 ? "stat-negative" : "stat-muted"}">${formatCurrency(stats.debt)}</td>
        <td class="stat-cell ${stats.support >= 0 ? "stat-positive" : "stat-negative"}">${formatCurrency(stats.support)}</td>
        <td class="actions-cell"></td>
      `;

      // WhatsApp / edit / delete buttons
      const actionsCell = row.querySelector(".actions-cell");
      const whatsappBtn = createWhatsAppLink({
        phone: user.phone,
        message: whatsappTemplates.general(user.fullName || user.name),
        label: "וואטסאפ",
        className: "btn-sm",
      });
      const editBtn = document.createElement("button");
      editBtn.className   = "ghost-button btn-sm";
      editBtn.type        = "button";
      editBtn.textContent = "ערוך";

      const deleteBtn = document.createElement("button");
      deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
      deleteBtn.type        = "button";
      deleteBtn.textContent = "מחק";
      deleteBtn.addEventListener("click", () => deleteUser(user.id));

      actionsCell.append(whatsappBtn);
      if (stats.debt > 0) {
        actionsCell.append(createWhatsAppLink({
          phone: user.phone,
          message: whatsappTemplates.paymentSummary({
            name: user.fullName || user.name,
            amount: stats.debt.toFixed(2),
          }),
          label: "סיכום תשלום",
          className: "btn-sm",
        }));
        const markPaidBtn = document.createElement("button");
        markPaidBtn.className   = "ghost-button btn-sm";
        markPaidBtn.type        = "button";
        markPaidBtn.textContent = "סמן הכל כשולם";
        markPaidBtn.addEventListener("click", () => markUserOrdersPaid(user));
        actionsCell.append(markPaidBtn);
      }
      actionsCell.append(editBtn, deleteBtn);

      // ── Edit row (hidden by default) ──────────────────────
      const editRow = document.createElement("tr");
      editRow.className = "user-edit-row";
      editRow.hidden    = true;

      const ROLE_OPTIONS = `
        <option value="friend">לקוח</option>
        <option value="admin">מנהל</option>
      `;
      const STATUS_OPTIONS = `
        <option value="active">פעיל</option>
        <option value="pending">ממתין לאישור</option>
        <option value="inactive">לא פעיל</option>
        <option value="rejected">נדחה</option>
      `;

      const editCell = document.createElement("td");
      editCell.colSpan = 8;
      editCell.innerHTML = `
        <form class="user-edit-form">
          <div class="user-edit-fields">
            <label>שם משתמש<input name="name" value="${escapeHtml(user.name)}" required /></label>
            <label>שם מלא<input name="fullName" value="${escapeHtml(user.fullName ?? "")}" /></label>
            <label>טלפון<input name="phone" type="tel" value="${escapeHtml(user.phone ?? "")}" placeholder="050-1234567" /></label>
            <label>מגדר<select name="gender"><option value="male">גבר</option><option value="female">אישה</option></select></label>
            <label>סיסמה חדשה (השאר ריק כדי לשמור על הקיימת)<input name="password" type="password" placeholder="סיסמה חדשה" autocomplete="new-password" /></label>
            <label>תפקיד<select name="role">${ROLE_OPTIONS}</select></label>
            <label>סטטוס<select name="status">${STATUS_OPTIONS}</select></label>
          </div>
          <div class="user-edit-actions">
            <button class="primary-button btn-sm" type="submit">שמור</button>
            <button class="ghost-button btn-sm" type="button" data-cancel>ביטול</button>
          </div>
        </form>
      `;

      // Set select values
      editCell.querySelector("[name=role]").value   = user.role   ?? "friend";
      editCell.querySelector("[name=status]").value = user.status ?? "active";
      editCell.querySelector("[name=gender]").value = user.gender ?? "male";

      const form = editCell.querySelector("form");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const status = fd.get("status");
        const payload = {
          name:     fd.get("name"),
          fullName: fd.get("fullName"),
          phone:    fd.get("phone"),
          gender:   fd.get("gender"),
          role:     fd.get("role"),
          status,
        };
        const password = String(fd.get("password") ?? "").trim();
        if (password) payload.password = password;
        if (status === "rejected" && user.status !== "rejected") {
          const reason = window.prompt("סיבת הדחייה (תוצג למשתמש):") ?? "";
          payload.rejectionReason = reason.trim();
        }
        await saveUserEdit(user.id, payload);
      });
      editCell.querySelector("[data-cancel]").addEventListener("click", () => {
        editRow.hidden = true;
        editBtn.textContent = "ערוך";
      });

      editRow.append(editCell);

      // Toggle edit row on edit button click
      editBtn.addEventListener("click", () => {
        const isOpen = !editRow.hidden;
        // Close any other open edit rows first
        activeTable.querySelectorAll(".user-edit-row").forEach((r) => { r.hidden = true; });
        activeTable.querySelectorAll(".ghost-button[data-editing]").forEach((b) => {
          b.textContent = "ערוך"; b.removeAttribute("data-editing");
        });
        if (!isOpen) {
          editRow.hidden = false;
          editBtn.textContent = "סגור";
          editBtn.dataset.editing = "1";
        }
      });

      activeTable.append(row, editRow);
    });
  }

  // ── Pending users ──────────────────────────────────────────
  const pendingTable = document.querySelector("#pending-users-table");
  if (pendingTable) {
    pendingTable.replaceChildren();
    document.querySelector("#pending-users-empty")
      ?.classList.toggle("is-visible", pending.length === 0);

    pending.forEach((user) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(user.name)}</td>
        <td>${escapeHtml(user.fullName ?? "")}</td>
        <td>${escapeHtml(user.howYouKnowAdmin ?? "")}</td>
        <td>${escapeHtml(user.registrationMessage ?? "")}</td>
        <td>${new Date(user.createdAt).toLocaleDateString("he-IL")}</td>
        <td class="actions-cell"></td>
      `;

      const cell = row.querySelector(".actions-cell");
      const whatsappBtn = createWhatsAppLink({
        phone: user.phone,
        message: whatsappTemplates.general(user.fullName || user.name),
        label: "וואטסאפ",
        className: "btn-sm",
      });

      const approveBtn = document.createElement("button");
      approveBtn.className   = "primary-button btn-sm";
      approveBtn.type        = "button";
      approveBtn.textContent = "אשר";
      approveBtn.addEventListener("click", () => updateUserStatus(user.id, "active"));

      const rejectBtn = document.createElement("button");
      rejectBtn.className   = "ghost-button btn-sm";
      rejectBtn.type        = "button";
      rejectBtn.textContent = "דחה";

      const deleteBtn = document.createElement("button");
      deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
      deleteBtn.type        = "button";
      deleteBtn.textContent = "מחק";
      deleteBtn.addEventListener("click", () => deleteUser(user.id));

      cell.append(whatsappBtn, approveBtn, rejectBtn, deleteBtn);
      pendingTable.append(row);

      // ── Reject-reason row (replaces window.prompt) ─────────
      const rejectRow = document.createElement("tr");
      rejectRow.className = "user-edit-row";
      rejectRow.hidden = true;
      const rejectCell = document.createElement("td");
      rejectCell.colSpan = 6;
      rejectCell.innerHTML = `
        <form class="user-edit-form">
          <div class="user-edit-fields">
            <label>סיבת הדחייה (תוצג למשתמש)<textarea name="reason" rows="2" required></textarea></label>
          </div>
          <div class="user-edit-actions">
            <button class="primary-button btn-sm" type="submit">אישור דחייה</button>
            <button class="ghost-button btn-sm" type="button" data-cancel>ביטול</button>
          </div>
        </form>
      `;
      rejectCell.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const reason = String(new FormData(e.target).get("reason") ?? "").trim();
        if (!reason) return;
        await updateUserStatus(user.id, "rejected", reason);
      });
      rejectCell.querySelector("[data-cancel]").addEventListener("click", () => {
        rejectRow.hidden = true;
      });
      rejectRow.append(rejectCell);
      rejectBtn.addEventListener("click", () => { rejectRow.hidden = !rejectRow.hidden; });
      pendingTable.append(rejectRow);
    });
  }
}

// ── Store edit grid (admin view) ──────────────────────────────

function renderStoreEdit() {
  const grid = document.querySelector("#store-edit-grid");
  if (!grid) return;

  grid.replaceChildren();
  document.querySelector("#store-edit-empty")
    ?.classList.toggle("is-visible", store.products.length === 0);

  store.products.forEach((product) => {
    const orders = store.orders.filter((o) => o.productId === product.id && o.status !== "cancelled");
    const supportTotal = orders.reduce((s, o) => s + (Number(o.supportAmount) || 0), 0);

    const card = document.createElement("article");
    card.className = "store-edit-card";
    card.classList.toggle("store-edit-card--inactive", product.catalogStatus === "incomplete");

    // ── Image ────────────────────────────────────────────
    const imageWrap = document.createElement("div");
    imageWrap.className = "store-edit-image";
    if (product.image) {
      const img = document.createElement("img");
      img.src = product.image;
      img.alt = product.name;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      imageWrap.append(img);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "store-edit-placeholder";
      placeholder.textContent = "אין תמונה";
      imageWrap.append(placeholder);
    }

    // ── Body ─────────────────────────────────────────────
    const body = document.createElement("div");
    body.className = "store-edit-body";
    const syncNotice = product.printSync?.status === "needs_material"
      ? '<p class="store-edit-sync-notice">טיוטה מסנכרון 3MF — בחר פילמנט והשלם פרטים לפני פרסום.</p>'
      : product.printSync?.status === "ready"
        ? '<p class="store-edit-sync-notice">נתוני ההדפסה עודכנו מקובץ 3MF מקומי.</p>'
        : '';
    const stockNotice = product.inventoryAvailable === false
      ? '<p class="store-edit-sync-notice">מוצג בקטלוג כ״לא זמין כרגע״ — הזמנה תדרוש בדיקה או חלופה.</p>'
      : '';
    const readinessNotice = product.catalogStatus === "incomplete"
      ? `<p class="store-edit-sync-notice">טיוטה מוסתרת — חסר: ${escapeHtml((product.missingRequirements ?? []).join(", ") || "פרטי חובה")}</p>`
      : '';
    body.innerHTML = `
      <h3 class="store-edit-name">${escapeHtml(product.name)}</h3>
      <div class="store-edit-facts">
        <span>${formatCurrency(product.cost)}</span>
        <span class="stat-muted">${product.grams}g</span>
      </div>
      ${syncNotice}
      ${readinessNotice}
      ${stockNotice}
      <div class="store-edit-live-stats">
        <span>${orders.length} הזמנות</span>
        <span class="${supportTotal > 0 ? "stat-positive" : "stat-muted"}">${formatCurrency(supportTotal)} תמיכה</span>
      </div>
    `;

    // ── Footer ───────────────────────────────────────────
    const footer = document.createElement("div");
    footer.className = "store-edit-footer";

    const editDetailsBtn = document.createElement("button");
    editDetailsBtn.className   = "ghost-button btn-sm";
    editDetailsBtn.type        = "button";
    editDetailsBtn.textContent = "עריכה";
    editDetailsBtn.addEventListener("click", () => {
      if (typeof window.openProductEditForm === "function") window.openProductEditForm(product);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost-button btn-sm user-delete-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "מחיקה";
    deleteBtn.addEventListener("click", () => deleteProduct(product.id));

    footer.append(editDetailsBtn, deleteBtn);
    body.append(footer);
    card.append(imageWrap, body);
    grid.append(card);
  });
}

// ── Categories admin table ─────────────────────────────────────

function renderCategoriesAdmin() {
  const tbody = document.querySelector("#categories-table-body");
  if (!tbody) return;

  document.querySelector("#categories-empty")
    ?.classList.toggle("is-visible", store.categories.length === 0);

  tbody.replaceChildren();
  store.categories.forEach((category) => {
    const productCount = store.products.filter((p) => p.categoryIds?.includes(category.id)).length;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(category.name)}</td>
      <td>${escapeHtml(category.description ?? "")}</td>
      <td class="stat-cell">${category.sortOrder ?? 0}</td>
      <td>${category.active !== false
        ? '<span class="status-badge status-active">פעילה</span>'
        : '<span class="status-badge status-inactive">מושבתת</span>'}
        ${productCount ? `<span class="status-badge status-pending">${productCount} מוצרים</span>` : ""}
      </td>
      <td class="actions-cell"></td>
    `;

    const cell = row.querySelector(".actions-cell");

    const editBtn = document.createElement("button");
    editBtn.className   = "ghost-button btn-sm";
    editBtn.type        = "button";
    editBtn.textContent = "ערוך";
    editBtn.addEventListener("click", () => {
      if (typeof window.openCategoryEditForm === "function") window.openCategoryEditForm(category);
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.className   = "ghost-button btn-sm";
    toggleBtn.type        = "button";
    toggleBtn.textContent = category.active !== false ? "השבתה" : "הפעלה";
    toggleBtn.addEventListener("click", () => toggleCategoryActive(category));

    const deleteBtn = document.createElement("button");
    deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
    deleteBtn.type        = "button";
    deleteBtn.textContent = "מחק";
    deleteBtn.addEventListener("click", () => deleteCategory(category));

    cell.append(editBtn, toggleBtn, deleteBtn);
    tbody.append(row);
  });
}

async function toggleCategoryActive(category) {
  try {
    const updated = await api(`/api/categories?id=${encodeURIComponent(category.id)}`, {
      method: "PUT",
      body: JSON.stringify({ active: category.active === false }),
    });
    const idx = store.categories.findIndex((c) => c.id === category.id);
    if (idx !== -1) store.categories[idx] = updated;
    render();
  } catch (err) {
    alert(`שגיאה בעדכון קטגוריה: ${err.message}`);
  }
}

async function deleteCategory(category) {
  if (!window.confirm(`למחוק את הקטגוריה "${category.name}"? פעולה זו אינה הפיכה.`)) return;
  try {
    await api(`/api/categories?id=${encodeURIComponent(category.id)}`, { method: "DELETE" });
    store.categories = store.categories.filter((c) => c.id !== category.id);
    render();
  } catch (err) {
    alert(`שגיאה במחיקת קטגוריה: ${err.message}`);
  }
}

// ── Action queue (overview) ────────────────────────────────────

function buildQueueSection(title, rows) {
  const section = document.createElement("section");
  section.className = "queue-section";
  const heading = document.createElement("h3");
  heading.textContent = `${title} (${rows.length})`;
  section.append(heading);
  const list = document.createElement("div");
  list.className = "queue-rows";
  rows.forEach((row) => list.append(row));
  section.append(list);
  return section;
}

function buildQueueRow(title, subtitle, actions) {
  const row = document.createElement("div");
  row.className = "queue-row";
  row.innerHTML = `
    <div class="queue-row-info">
      <strong>${escapeHtml(title)}</strong>
      ${subtitle ? `<span class="queue-row-subtitle">${escapeHtml(subtitle)}</span>` : ""}
    </div>
    <div class="queue-row-actions"></div>
  `;
  const actionsEl = row.querySelector(".queue-row-actions");
  actions.forEach((a) => actionsEl.append(a));
  return row;
}

function renderActionQueue() {
  const container = document.querySelector("#action-queue");
  if (!container) return;
  container.replaceChildren();

  const sections = [];

  // ── Pending registrations ────────────────────────────────
  const pendingUsers = store.users.filter((u) => u.status === "pending");
  if (pendingUsers.length > 0) {
    const rows = pendingUsers.map((user) => {
      const bits = [user.howYouKnowAdmin, user.registrationMessage].filter(Boolean).join(" · ");
      const approveBtn = document.createElement("button");
      approveBtn.className = "primary-button btn-sm";
      approveBtn.type = "button";
      approveBtn.textContent = "אשר";
      approveBtn.addEventListener("click", () => updateUserStatus(user.id, "active"));

      const jumpBtn = document.createElement("button");
      jumpBtn.className = "ghost-button btn-sm";
      jumpBtn.type = "button";
      jumpBtn.textContent = "פרטים";
      jumpBtn.addEventListener("click", () => {
        setView("users");
        document.querySelector('.sub-tab[data-sub="pending-users"]')?.click();
      });

      return buildQueueRow(`${user.fullName || user.name}`, bits, [
        approveBtn,
        jumpBtn,
        createWhatsAppLink({
          phone: user.phone,
          message: whatsappTemplates.general(user.fullName || user.name),
          label: "וואטסאפ",
          className: "btn-sm",
        }),
      ]);
    });
    sections.push(buildQueueSection("הרשמות ממתינות", rows));
  }

  // ── New orders ────────────────────────────────────────────
  const newOrders = store.orders.filter((o) => o.status === "new");
  if (newOrders.length > 0) {
    const rows = newOrders.map((order) => {
      const product = findProduct(order.productId);
      const promoteBtn = document.createElement("button");
      promoteBtn.className = "primary-button btn-sm";
      promoteBtn.type = "button";
      promoteBtn.textContent = "קדם";
      promoteBtn.addEventListener("click", () => setOrderStatus(order, nextOrderStatus(order.status)));
      const detailsBtn = document.createElement("button");
      detailsBtn.className = "ghost-button btn-sm";
      detailsBtn.type = "button";
      detailsBtn.textContent = "פרטים";
      detailsBtn.addEventListener("click", () => openOrderDrawer(order));
      return buildQueueRow(
        `${order.friendName} · ${product?.name || order.requestDescription || "בקשה מיוחדת"}`,
        `כמות ${order.quantity} · ${orderAmountLabel(order)}`,
        [promoteBtn, detailsBtn]
      );
    });
    sections.push(buildQueueSection("הזמנות חדשות", rows));
  }

  // ── Waiting for price approval ───────────────────────────
  const waitingApproval = store.orders.filter((o) => o.status === "waiting_approval");
  if (waitingApproval.length > 0) {
    const rows = waitingApproval.map((order) => {
      const product = findProduct(order.productId);
      const detailsBtn = document.createElement("button");
      detailsBtn.className = "ghost-button btn-sm";
      detailsBtn.type = "button";
      detailsBtn.textContent = "פרטים";
      detailsBtn.addEventListener("click", () => openOrderDrawer(order));
      return buildQueueRow(
        `${order.friendName} · ${product?.name || order.requestDescription || "בקשה מיוחדת"}`,
        orderAmountLabel(order),
        [detailsBtn]
      );
    });
    sections.push(buildQueueSection("ממתינות לאישור מחיר", rows));
  }

  // ── Ready for delivery ────────────────────────────────────
  const readyForDelivery = store.orders.filter((o) => o.status === "ready_delivery");
  if (readyForDelivery.length > 0) {
    const rows = readyForDelivery.map((order) => {
      const product = findProduct(order.productId);
      const user = findOrderUser(order);
      return buildQueueRow(
        `${order.friendName} · ${product?.name || order.requestDescription || "בקשה מיוחדת"}`,
        "",
        [createWhatsAppLink({
          phone: user?.phone,
          message: whatsappTemplates.delivery({ name: user?.fullName || order.friendName }),
          label: "תיאום מסירה",
          className: "btn-sm",
        })]
      );
    });
    sections.push(buildQueueSection("מוכנות למסירה", rows));
  }

  // ── Open debt ─────────────────────────────────────────────
  const debtors = store.users
    .map((user) => ({ user, stats: getUserOrderStats(user) }))
    .filter(({ stats }) => stats.debt > 0);
  if (debtors.length > 0) {
    const rows = debtors.map(({ user, stats }) => {
      const markPaidBtn = document.createElement("button");
      markPaidBtn.className = "ghost-button btn-sm";
      markPaidBtn.type = "button";
      markPaidBtn.textContent = "סמן הכל כשולם";
      markPaidBtn.addEventListener("click", () => markUserOrdersPaid(user));
      return buildQueueRow(user.fullName || user.name, formatCurrency(stats.debt), [
        markPaidBtn,
        createWhatsAppLink({
          phone: user.phone,
          message: whatsappTemplates.paymentSummary({ name: user.fullName || user.name, amount: stats.debt.toFixed(2) }),
          label: "סיכום תשלום",
          className: "btn-sm",
        }),
      ]);
    });
    sections.push(buildQueueSection("חוב פתוח", rows));
  }

  if (sections.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state is-visible";
    empty.textContent = "הכל מטופל כרגע. אין פעולות ממתינות.";
    container.append(empty);
  } else {
    sections.forEach((s) => container.append(s));
  }

  // ── This month, quietly ───────────────────────────────────
  const s = computeFinanceSummary();
  const monthLine = document.createElement("p");
  monthLine.className = "queue-month-line";
  monthLine.textContent =
    `החודש: ${formatCurrency(s.monthIncome)} נכנס · ${formatCurrency(s.monthExpenses)} יצא · יתרה ${formatCurrency(s.monthBalance)}`;
  container.append(monthLine);
}

// ── Finance / expenses (admin view) ───────────────────────────
// All figures here are estimates from order/expense data, not a formal
// accounting report — labels must say so ("משוערת") per product spec.

function isSameMonth(dateValue, ref) {
  if (!dateValue) return false;
  const d = new Date(dateValue);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

function computeFinanceSummary() {
  const now = new Date();
  const liveOrders   = store.orders.filter((o) => o.status !== "cancelled");
  const paidOrders   = liveOrders.filter((o) => o.paid);
  const unpaidOrders = liveOrders.filter((o) => !o.paid);

  const paidIncome    = sumOrderAmounts(paidOrders);
  const unpaidTotal   = sumOrderAmounts(unpaidOrders);
  const supportTotal  = paidOrders.reduce((s, o) => s + (Number(o.supportAmount) || 0), 0);
  const totalExpenses = store.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const reinvestmentBalance = paidIncome - totalExpenses;

  // Income is counted the month money actually arrived (paidAt), not the
  // month the order was opened — an order placed in May and paid in July
  // must land in July's figures.
  const monthIncome = paidOrders
    .filter((o) => isSameMonth(o.paidAt, now))
    .reduce((s, o) => s + (orderAmount(o) ?? 0), 0);
  const monthExpenses = store.expenses
    .filter((e) => isSameMonth(e.expenseDate, now))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const monthBalance = monthIncome - monthExpenses;

  return {
    paidIncome, unpaidTotal, supportTotal, totalExpenses, reinvestmentBalance,
    monthIncome, monthExpenses, monthBalance,
  };
}

function buildFinanceCard(label, value, tone) {
  const card = document.createElement("div");
  card.className = "finance-card";
  const toneClass = tone === "positive" ? "stat-positive" : tone === "negative" ? "stat-negative" : "";
  card.innerHTML = `
    <span class="finance-card-value ${toneClass}">${formatCurrency(value)}</span>
    <span class="finance-card-label">${label}</span>
  `;
  return card;
}

function renderFinanceCards(containerId, cards) {
  const grid = document.querySelector(`#${containerId}`);
  if (!grid) return;
  grid.replaceChildren();
  cards.forEach(({ label, value, tone }) => grid.append(buildFinanceCard(label, value, tone)));
}

function renderFinanceSummary() {
  if (!document.querySelector("#finance-summary-grid")) return;
  const s = computeFinanceSummary();
  renderFinanceCards("finance-summary-grid", [
    { label: "נכנס החודש", value: s.monthIncome, tone: "positive" },
    { label: "הוצאות החודש", value: s.monthExpenses, tone: "negative" },
    { label: "יתרה החודש", value: s.monthBalance, tone: s.monthBalance >= 0 ? "positive" : "negative" },
    { label: "חוב פתוח", value: s.unpaidTotal, tone: s.unpaidTotal > 0 ? "negative" : undefined },
    { label: "יתרת השקעה חוזרת (משוערת)", value: s.reinvestmentBalance, tone: s.reinvestmentBalance >= 0 ? "positive" : "negative" },
    { label: "תמיכה שהתקבלה", value: s.supportTotal, tone: "positive" },
  ]);
}

function renderExpenses() {
  renderFinanceSummary();

  const tbody = document.querySelector("#expenses-table-body");
  if (!tbody) return;

  document.querySelector("#expenses-empty")
    ?.classList.toggle("is-visible", store.expenses.length === 0);

  tbody.replaceChildren();
  store.expenses.forEach((expense) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${expense.expenseDate ? new Date(expense.expenseDate).toLocaleDateString("he-IL") : ""}</td>
      <td>${escapeHtml(expense.description)}</td>
      <td>${escapeHtml(EXPENSE_CATEGORY_LABELS[expense.category] ?? expense.category)}</td>
      <td class="stat-cell stat-negative">${formatCurrency(expense.amount)}</td>
      <td>${escapeHtml(expense.notes ?? "")}</td>
      <td class="actions-cell"></td>
    `;

    const cell = row.querySelector(".actions-cell");

    const editBtn = document.createElement("button");
    editBtn.className   = "ghost-button btn-sm";
    editBtn.type        = "button";
    editBtn.textContent = "ערוך";
    editBtn.addEventListener("click", () => openExpenseEditForm(expense));

    const deleteBtn = document.createElement("button");
    deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
    deleteBtn.type        = "button";
    deleteBtn.textContent = "מחק";
    deleteBtn.addEventListener("click", () => deleteExpense(expense.id));

    cell.append(editBtn, " ", deleteBtn);
    tbody.append(row);
  });
}

async function deleteExpense(expenseId) {
  if (!window.confirm("למחוק הוצאה זו? פעולה זו אינה הפיכה.")) return;
  try {
    await api(`/api/expenses?id=${encodeURIComponent(expenseId)}`, { method: "DELETE" });
    store.expenses = store.expenses.filter((e) => e.id !== expenseId);
    render();
  } catch (err) {
    alert(`שגיאה במחיקת הוצאה: ${err.message}`);
  }
}

function openExpenseEditForm(expense) {
  const form = document.querySelector("#expense-form");
  if (!form) return;
  form.elements["expenseId"].value   = expense.id;
  form.elements["description"].value = expense.description;
  form.elements["category"].value    = expense.category ?? "general";
  form.elements["amount"].value      = expense.amount;
  form.elements["expenseDate"].value = expense.expenseDate ? String(expense.expenseDate).slice(0, 10) : "";
  form.elements["notes"].value       = expense.notes ?? "";
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Shared rendering helpers ──────────────────────────────────

function renderProductImage(container, product) {
  const mainUrl = product.images?.find((i) => i.isMain)?.url || product.image || "";
  container.replaceChildren();
  container.classList.toggle("has-image", Boolean(mainUrl));
  if (!mainUrl) return;
  const img = document.createElement("img");
  img.src = mainUrl;
  img.alt = product.name;
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  container.append(img);
}

function renderStlLink(card, product) {
  const stlLink = card.querySelector(".stl-link");
  if (!product.stlUrl) { stlLink?.remove(); return; }
  if (stlLink) stlLink.href = product.stlUrl;
}

function renderProductBadges(card, product) {
  const container = card.querySelector(".product-badges");
  if (!container) return;
  container.replaceChildren();
  if (product.requiresAdminApproval) {
    const badge = document.createElement("span");
    badge.className = "product-badge product-badge-idea";
    badge.textContent = "רעיון — דורש אישור מחיר לפני הדפסה";
    container.append(badge);
  }
}

function renderProductFacts(card, product) {
  const container = card.querySelector(".product-facts");
  if (!container) return;
  container.replaceChildren();

  const facts = [];
  if (product.printHours) facts.push(`⏱️ כ־${product.printHours} שעות הדפסה`);
  if (product.grams) facts.push(`🧵 כ־${product.grams} גרם חומר`);
  if (product.possibleColors?.length) facts.push(`🎨 ${product.possibleColors.join(", ")}`);

  if (facts.length === 0) { container.remove(); return; }
  facts.forEach((fact) => {
    const span = document.createElement("span");
    span.className = "product-fact";
    span.textContent = fact;
    container.append(span);
  });
}

// ── Product interactions ──────────────────────────────────────

async function updateProduct(productId, updates) {
  const product = findProduct(productId);
  if (!product) return;

  Object.assign(product, updates);
  render();

  try {
    await api(`/api/products?id=${encodeURIComponent(productId)}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  } catch (err) {
    alert(`שגיאה בעדכון מוצר: ${err.message}`);
    await loadData();
    render();
  }
}

async function deleteProduct(productId) {
  if (!window.confirm("למחוק את המוצר מהקטלוג?")) return;

  store.products = store.products.filter((p) => p.id !== productId);
  render();

  try {
    await api(`/api/products?id=${encodeURIComponent(productId)}`, { method: "DELETE" });
  } catch (err) {
    alert(`שגיאה במחיקת מוצר: ${err.message}`);
    await loadData();
    render();
  }
}

// ── Order interactions ────────────────────────────────────────────

async function deleteOrder(orderId) {
  const order = store.orders.find((item) => item.id === orderId);
  const product = findProduct(order?.productId);
  const description = product?.name
    ? `ההזמנה של ${order.friendName} עבור ${product.name}`
    : "ההזמנה";
  if (!window.confirm(`למחוק את ${description}? פעולה זו אינה הפיכה.`)) return;
  try {
    await api(`/api/orders?id=${encodeURIComponent(orderId)}`, { method: "DELETE" });
    store.orders = store.orders.filter((o) => o.id !== orderId);
    render();
  } catch (err) {
    alert(`שגיאה במחיקת הזמנה: ${err.message}`);
  }
}

async function markUserOrdersPaid(user) {
  const orderIds = ordersForUser(user).filter((o) => !o.paid).map((o) => o.id);
  if (orderIds.length === 0) return;
  if (!window.confirm(`לסמן ${orderIds.length} הזמנות של ${user.fullName || user.name} כשולמו?`)) return;
  try {
    const { orders: updated } = await api(`/api/orders?action=mark-paid`, {
      method: "PUT",
      body: JSON.stringify({ orderIds, paid: true }),
    });
    updated.forEach((u) => {
      const order = store.orders.find((o) => o.id === u.id);
      if (order) Object.assign(order, u);
    });
    render();
  } catch (err) {
    alert(`שגיאה בסימון הזמנות כשולמו: ${err.message}`);
  }
}

// ── User interactions ─────────────────────────────────────────────

async function saveUserEdit(userId, updates) {
  try {
    const updated = await api(`/api/users?id=${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    const idx = store.users.findIndex((u) => u.id === userId);
    if (idx !== -1) store.users[idx] = updated;
    render();
  } catch (err) {
    alert(`שגיאה בשמירת פרטי משתמש: ${err.message}`);
  }
}

async function deleteUser(userId) {
  const user  = store.users.find((u) => u.id === userId);
  const label = user ? `${user.name}${user.fullName ? ` (${user.fullName})` : ""}` : userId;
  if (!window.confirm(`למחוק את המשתמש ${label}? פעולה זו אינה הפיכה.`)) return;
  try {
    await api(`/api/users?id=${encodeURIComponent(userId)}`, { method: "DELETE" });
    store.users = store.users.filter((u) => u.id !== userId);
    render();
  } catch (err) {
    alert(`שגיאה במחיקת משתמש: ${err.message}`);
  }
}

async function updateUserStatus(userId, status, rejectionReason = "") {
  try {
    const updated = await api(`/api/users?id=${encodeURIComponent(userId)}`, {
      method: "PUT",
      body: JSON.stringify({ status, rejectionReason }),
    });
    const idx = store.users.findIndex((u) => u.id === userId);
    if (idx !== -1) store.users[idx] = updated;
    render();
  } catch (err) {
    alert(`שגיאה בעדכון משתמש: ${err.message}`);
  }
}

// ── Personal workspace (welcome.html) ────────────────────────

function renderWelcome() {
  if (!document.querySelector("#ws-open-orders")) return;

  const nameEl = document.querySelector("#ws-user-name");
  if (nameEl && store.currentUser) nameEl.textContent = store.currentUser.name;

  renderAccountStatus();
  renderTransparency();

  const open = store.myOrders.filter((o) => !["completed", "cancelled"].includes(o.status));
  const past = store.myOrders.filter((o) => ["completed", "cancelled"].includes(o.status));

  const openCount = document.querySelector("#ws-open-count");
  if (openCount) {
    openCount.textContent = open.length || "";
    openCount.hidden = open.length === 0;
  }

  renderWsOrderList(document.querySelector("#ws-open-orders"), open, "אין לך הזמנות פתוחות כרגע");
  renderWsOrderList(document.querySelector("#ws-past-orders"), past, "אין לך הזמנות שהסתיימו עדיין");

  const whatsappContainer = document.querySelector("#ws-whatsapp-action");
  if (whatsappContainer) {
    const adminPhone = store.contactSettings?.whatsappPhone ?? "";
    const adminLabel = store.contactSettings?.displayLabel || "המנהל";
    const whatsappLink = createWhatsAppLink({
      phone: adminPhone,
      message: `היי ${adminLabel}, רציתי לדבר איתך על הדפסה 😊`,
      label: `פתיחת WhatsApp עם ${adminLabel}`,
    });
    if (whatsappLink.disabled) {
      whatsappLink.textContent = "הוואטסאפ של המנהל עדיין לא הוגדר";
    }
    whatsappContainer.replaceChildren(whatsappLink);
    const note = document.querySelector("#ws-whatsapp-note");
    if (note) note.hidden = !whatsappLink.disabled;
  }
}

function renderWsOrderList(container, orders, emptyMsg) {
  if (!container) return;
  container.replaceChildren();
  if (orders.length === 0) {
    const p = document.createElement("p");
    p.className = "ws-empty";
    p.textContent = emptyMsg;
    container.append(p);
    return;
  }
  orders.forEach((order) => {
    const product = store.products.find((p) => p.id === order.productId);
    const snapshot = order.productSnapshot ?? {};
    const title = product?.name ?? snapshot.name ?? order.requestDescription ?? "בקשה מיוחדת";
    const amount = orderAmount(order);
    const awaitingApproval = order.requiresUserPriceApproval && !order.userApprovedPrice;
    const amountLabel = amount == null
      ? NO_PRICE_YET
      : awaitingApproval
        ? `מחיר משוער ${formatCurrency(amount)} — ממתין לאישורך`
        : `לתשלום ${formatCurrency(amount)}`;
    const supportAmount = Number(order.supportAmount) || 0;

    const div = document.createElement("div");
    div.className = "ws-order-card";
    div.innerHTML = `
      <div class="ws-order-info">
        <span class="ws-order-product">${escapeHtml(title)}</span>
        <span class="ws-order-meta">כמות ${order.quantity} · ${escapeHtml(amountLabel)}</span>
        ${supportAmount > 0 ? `<span class="ws-order-meta">כולל ${formatCurrency(supportAmount)} פרגון — תודה! 💛</span>` : ""}
        ${orderColorNames(order).length ? `<span class="ws-order-meta">צבע: ${escapeHtml(orderColorNames(order).join(", "))}</span>` : ""}
        ${order.colorAlternativeStatus && order.colorAlternativeStatus !== "none"
          ? `<span class="ws-order-meta">חלופת צבע: ${escapeHtml(colorAlternativeLabel(order))}</span>` : ""}
        ${order.adminNotes ? `<span class="ws-order-meta">הערת אמיר: ${escapeHtml(order.adminNotes)}</span>` : ""}
        ${order.cancellationReason ? `<span class="ws-order-meta">סיבת ביטול: ${escapeHtml(order.cancellationReason)}</span>` : ""}
      </div>
      <div class="ws-order-right">
        <span class="ws-status-chip ws-status-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABELS[order.status] ?? order.status)}</span>
        ${order.paid
          ? '<span class="ws-paid-chip">שולם ✓</span>'
          : '<span class="ws-unpaid-chip">ממתין לתשלום</span>'}
        <div class="ws-order-actions"></div>
      </div>
    `;

    const actions = div.querySelector(".ws-order-actions");
    if (order.status === "waiting_approval" && order.requiresUserPriceApproval && !order.userApprovedPrice) {
      const approveBtn = document.createElement("button");
      approveBtn.className   = "primary-button btn-sm";
      approveBtn.type        = "button";
      approveBtn.textContent = "אשר מחיר";
      approveBtn.addEventListener("click", () => approveOrderPrice(order.id));
      actions.append(approveBtn);
    }
    if (order.colorAlternativeStatus === "pending" && order.proposedAlternativeColor) {
      const approveColor = document.createElement("button");
      approveColor.className = "primary-button btn-sm";
      approveColor.type = "button";
      approveColor.textContent = `אישור ${order.proposedAlternativeColor}`;
      approveColor.addEventListener("click", () => respondToColorAlternative(order.id, true));
      const rejectColor = document.createElement("button");
      rejectColor.className = "ghost-button btn-sm";
      rejectColor.type = "button";
      rejectColor.textContent = "דחיית החלופה";
      rejectColor.addEventListener("click", () => respondToColorAlternative(order.id, false));
      actions.append(approveColor, rejectColor);
    }
    if (["new", "waiting_approval", "waiting_print"].includes(order.status)) {
      const cancelBtn = document.createElement("button");
      cancelBtn.className   = "ghost-button btn-sm";
      cancelBtn.type        = "button";
      cancelBtn.textContent = "ביטול הזמנה";
      cancelBtn.title       = "אפשר לבטל רק לפני שמתחילים להדפיס";
      cancelBtn.addEventListener("click", () => cancelOwnOrder(order.id));
      actions.append(cancelBtn);

      const cancelHint = document.createElement("small");
      cancelHint.className = "ws-cancel-hint";
      cancelHint.textContent = "אפשר לבטל רק לפני שההדפסה מתחילה";
      actions.append(cancelHint);
    }

    const reorderBtn = document.createElement("button");
    reorderBtn.className = "ghost-button btn-sm";
    reorderBtn.type = "button";
    reorderBtn.textContent = "להזמין שוב";
    reorderBtn.addEventListener("click", () => reorder(order, product, title));
    actions.append(reorderBtn);

    container.append(div);
  });
}

function renderAccountStatus() {
  const banner = document.querySelector("#ws-account-banner");
  const title = document.querySelector("#ws-account-title");
  const message = document.querySelector("#ws-account-message");
  if (!banner || !title || !message || !store.currentUser) return;
  const status = store.currentUser.status ?? "pending";
  const content = {
    pending: ["החשבון שלך ממתין לאישור מנהל", "אפשר לעיין בקטלוג, אך אי אפשר להזמין עד שהבקשה תאושר."],
    active: ["החשבון שלך פעיל", "אפשר להזמין מוצרים ולעקוב אחר ההזמנות מכאן."],
    inactive: ["החשבון שלך אינו פעיל", "אפשר לעיין בקטלוג, אך לא ניתן לבצע הזמנות כרגע."],
    rejected: ["בקשת ההצטרפות נדחתה", store.currentUser.rejectionReason ? `סיבת הדחייה: ${store.currentUser.rejectionReason}` : "לא ניתן לבצע הזמנות מחשבון זה."],
  }[status] ?? ["מצב החשבון אינו ידוע", "אפשר לפנות למנהל ב־WhatsApp לקבלת עזרה."];
  title.textContent = content[0];
  message.textContent = content[1];
  banner.dataset.status = status;
  banner.hidden = false;
}

function renderTransparency() {
  const card = document.querySelector("#ws-transparency-card");
  const content = document.querySelector("#ws-transparency-content");
  const data = store.transparency;
  if (!card || !content || !data) return;
  card.hidden = false;
  const metrics = [
    ["סך התמיכה שנאספה", formatCurrency(data.totalSupport ?? 0)],
    ["הושקע מחדש בפרויקט", formatCurrency(data.reinvestedAmount ?? 0)],
    ["הדפסות שהושלמו", String(data.completedPrints ?? 0)],
  ];
  content.innerHTML = `<div class="business-summary-grid">${metrics.map(([label, value]) => `<article class="finance-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("")}</div>`;
  (data.goals ?? []).forEach((goal) => {
    const row = document.createElement("article"); row.className = "business-row";
    row.innerHTML = `<span>${escapeHtml(goal.label ?? goal.name ?? "יעד")}</span><progress max="${Number(goal.targetAmount ?? goal.target ?? 0)}" value="${Number(goal.currentAmount ?? goal.saved ?? 0)}"></progress><strong>${formatCurrency(goal.currentAmount ?? goal.saved ?? 0)} / ${formatCurrency(goal.targetAmount ?? goal.target ?? 0)}</strong>`;
    content.append(row);
  });
  if ((data.investments ?? []).length) {
    const heading = document.createElement("h3"); heading.textContent = "רכישות והשקעות שפורסמו"; content.append(heading);
    (data.investments ?? []).forEach((investment) => {
      const row = document.createElement("article"); row.className = "business-row";
      row.innerHTML = `<span>${escapeHtml(investment.label ?? "השקעה בפרויקט")}</span><strong>${formatCurrency(investment.amount ?? 0)}</strong>`;
      content.append(row);
    });
  }
}

function colorAlternativeLabel(order) {
  const labels = { needed: "ממתינה להצעת המנהל", pending: `הוצעה החלופה ${order.proposedAlternativeColor ?? ""}`, approved: "החלופה אושרה", rejected: "החלופה נדחתה" };
  return labels[order.colorAlternativeStatus] ?? order.colorAlternativeStatus;
}

async function respondToColorAlternative(orderId, approve) {
  try {
    const updated = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, {
      method: "PUT", body: JSON.stringify({ action: approve ? "approve-color-alternative" : "reject-color-alternative" }),
    });
    const index = store.myOrders.findIndex((order) => order.id === orderId);
    if (index !== -1) store.myOrders[index] = updated;
    render();
  } catch (err) { alert(`לא ניתן לעדכן את חלופת הצבע: ${err.message}`); }
}

function reorder(order, product, title) {
  const previous = {
    productId: order.productId,
    productName: title,
    quantity: order.quantity,
    selectedColor: order.selectedColors?.[0] ?? "",
  };
  sessionStorage.setItem("pendingReorder", JSON.stringify(previous));
  window.location.href = "catalog.html";
}

async function approveOrderPrice(orderId) {
  try {
    const updated = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, {
      method: "PUT",
      body: JSON.stringify({ action: "approve-price" }),
    });
    const idx = store.myOrders.findIndex((o) => o.id === orderId);
    if (idx !== -1) store.myOrders[idx] = updated;
    render();
  } catch (err) {
    alert(`שגיאה באישור מחיר: ${err.message}`);
  }
}

async function cancelOwnOrder(orderId) {
  const reason = window.prompt("סיבת הביטול:");
  if (reason === null || !reason.trim()) return;
  try {
    const updated = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, {
      method: "PUT",
      body: JSON.stringify({ action: "cancel", cancellationReason: reason.trim() }),
    });
    const idx = store.myOrders.findIndex((o) => o.id === orderId);
    if (idx !== -1) store.myOrders[idx] = updated;
    render();
  } catch (err) {
    alert(`שגיאה בביטול הזמנה: ${err.message}`);
  }
}

// ── Filaments (admin view) ────────────────────────────────────

function renderFilaments() {
  const tbody = document.querySelector("#filaments-table-body");
  if (!tbody) return;

  document.querySelector("#filaments-empty")
    ?.classList.toggle("is-visible", store.filaments.length === 0);

  tbody.replaceChildren();
  store.filaments.forEach((f) => {
    const spoolPrice = Number(f.spoolPrice);
    const spoolGrams = Number(f.spoolGrams);
    const costPerGram = spoolPrice > 0 && spoolGrams > 0 ? spoolPrice / spoolGrams : Number(f.pricePerKg) / 1000;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="color-swatch" style="background:${escapeHtml(f.colorHex)}"></span></td>
      <td>${escapeHtml(f.name)}</td>
      <td>${escapeHtml(f.materialType ?? '')}</td>
      <td>${spoolPrice > 0 ? formatCurrency(spoolPrice) : "—"}</td>
      <td>${spoolGrams > 0 ? `${Math.round(spoolGrams)} גרם` : "—"}</td>
      <td>${Number.isFinite(costPerGram) ? `${formatCurrency(costPerGram)}/גרם` : "—"}</td>
      <td>${f.remainingGrams == null ? "—" : `${Math.round(f.remainingGrams)} גרם${spoolGrams > 0 ? ` (${Math.round(f.remainingGrams / spoolGrams * 100)}%)` : ""}`}</td>
      <td>${f.active !== false
        ? '<span class="status-badge status-active">פעיל</span>'
        : '<span class="status-badge status-inactive">מושבת</span>'}</td>
      <td class="actions-cell"></td>
    `;

    const cell = row.querySelector(".actions-cell");

    const editBtn = document.createElement("button");
    editBtn.className   = "ghost-button btn-sm";
    editBtn.type        = "button";
    editBtn.textContent = "ערוך";
    editBtn.addEventListener("click", () => openFilamentEditForm(f));

    const toggleBtn = document.createElement("button");
    toggleBtn.className   = "ghost-button btn-sm";
    toggleBtn.type        = "button";
    toggleBtn.textContent = f.active !== false ? "השבתה" : "הפעלה";
    toggleBtn.addEventListener("click", () => toggleFilamentActive(f));

    const deleteBtn = document.createElement("button");
    deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
    deleteBtn.type        = "button";
    deleteBtn.textContent = "מחק";
    deleteBtn.addEventListener("click", () => deleteFilament(f.id));

    cell.append(editBtn, toggleBtn, deleteBtn);
    tbody.append(row);
  });
}

async function toggleFilamentActive(f) {
  try {
    const updated = await api(`/api/filaments?id=${encodeURIComponent(f.id)}`, {
      method: "PUT",
      body: JSON.stringify({ active: f.active === false }),
    });
    const idx = store.filaments.findIndex((x) => x.id === f.id);
    if (idx !== -1) store.filaments[idx] = updated;
    render();
  } catch (err) {
    alert(`שגיאה בעדכון חומר: ${err.message}`);
  }
}

async function deleteFilament(filamentId) {
  if (!window.confirm("למחוק חומר זה? פעולה זו אינה הפיכה.")) return;
  try {
    await api(`/api/filaments?id=${encodeURIComponent(filamentId)}`, { method: "DELETE" });
    store.filaments = store.filaments.filter((f) => f.id !== filamentId);
    render();
  } catch (err) {
    alert(`שגיאה במחיקת חומר: ${err.message}`);
  }
}

function openFilamentEditForm(f) {
  const form = document.querySelector("#filament-form");
  if (!form) return;
  form.elements["filamentId"].value  = f.id;
  form.elements["name"].value        = f.name;
  form.elements["materialType"].value = f.materialType ?? "PLA";
  form.elements["colorHex"].value    = f.colorHex;
  form.elements["spoolPrice"].value = f.spoolPrice ?? "";
  form.elements["spoolGrams"].value = f.spoolGrams ?? 1000;
  form.elements["remainingGrams"].value = f.remainingGrams ?? "";
  form.elements["note"].value        = f.note ?? "";
  form.elements["active"].checked    = f.active !== false;
  const preview = document.querySelector("#filament-color-preview");
  if (preview) preview.style.backgroundColor = f.colorHex;
  const cost = Number(f.spoolPrice) > 0 && Number(f.spoolGrams) > 0 ? Number(f.spoolPrice) / Number(f.spoolGrams) : null;
  const costLabel = document.querySelector("#filament-cost-per-gram");
  if (costLabel) costLabel.textContent = cost == null ? "עלות לגרם: —" : `עלות לגרם: ${formatCurrency(cost)}`;
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Pricing settings form (admin view) ───────────────────────

function renderPricingForm() {
  const form = document.querySelector("#pricing-form");
  if (!form || !store.pricingSettings) return;
  const s = store.pricingSettings;

  form.elements.marginPercent.value = (Number(s.marginPercent) || 0) * 100;
  form.elements.minOrderPrice.value = Number(s.minOrderPrice) || 0;
  const risk = s.riskPercentByLevel ?? s.riskPercents ?? { low: 0.08, medium: 0.15, high: 0.25 };
  if (form.elements.riskLowPercent) form.elements.riskLowPercent.value = Number(risk.low) * 100;
  if (form.elements.riskMediumPercent) form.elements.riskMediumPercent.value = Number(risk.medium) * 100;
  if (form.elements.riskHighPercent) form.elements.riskHighPercent.value = Number(risk.high) * 100;
  const wear = (s.wearParts ?? []).filter((p) => !p.amsOnly).reduce((sum, p) => sum + Number(p.priceIls) / Number(p.lifetimeHours), 0);
  const target = document.querySelector("#pricing-readonly-breakdown");
  if (target) target.innerHTML = `<div class="cost-preview-row"><span>בלאי ותחזוקה</span><span>${formatCurrency(wear)}/שעה</span></div><div class="cost-preview-row"><span>עלות מדפסת</span><span>תוספת של 10% על עלות ההדפסה (לאחר סיכון)</span></div>`;
}

// ── Contact settings form (admin view) ────────────────────────

function renderContactSettingsForm() {
  const form = document.querySelector("#contact-form");
  if (!form) return;
  const s = store.contactSettings;
  if (form.elements.whatsappPhone) form.elements.whatsappPhone.value = s?.whatsappPhone ?? "";
  if (form.elements.displayLabel)  form.elements.displayLabel.value  = s?.displayLabel ?? "";
}
