import { store, loadData, findProduct } from "./state.js";
import { formatCurrency, escapeHtml, calculateProductCost, composeFilamentName, isUnpriced, isUntested, UNTESTED_PRICE_NOTE, NO_PRICE_YET as UNPRICED_LABEL } from "./utils.js";
import { api } from "./api.js";
import { openOrderDialog, openCustomOrderDialog } from "./orders.js";
import { cartCount, cartTotals, updateLine, removeLine } from "./cart.js";
import { createWhatsAppLink, whatsappTemplates, STATUS_LABELS } from "./whatsapp.js";
import { setView } from "./auth.js";

// Canonical order, used to build status <select> options (STATUS_LABELS also
// carries legacy keys as a display fallback, which must not appear as choices).
// "failed" is deliberately absent from the manual workflow. Existing failed
// orders still render with their legacy label and chip.
const ORDER_STATUS_SEQUENCE = [
  "new", "waiting_approval", "waiting_print", "printing",
  "waiting_assembly", "ready_delivery", "completed", "cancelled",
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

// ── Public entry point ───────────────────────────────────────

export function render() {
  renderCatalog();
  renderCart();
  renderCartBadge();
  renderOrders();
  renderItemStats();
  renderUsersAdmin();
  renderStoreEdit();
  renderCategoriesAdmin();
  renderActionQueue();
  renderWelcome();
  renderTransparencyPage();
  renderFilaments();
  renderPricingForm();
  renderContactSettingsForm();
  renderExpenses();
  renderBusinessInsights();
  renderProjectSettingsForm();
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
    { key: "filaments",   label: "חומר עומד להיגמר",   view: "materials", sub: "materials-filaments",   count: store.filaments.filter(isFilamentLow).length },
    { key: "maintenance", label: "טיפול או חלק שמתקרב", view: "materials", sub: "materials-maintenance", count: maintenanceAttentionCount(store.insights) },
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

// The category choice lives in the URL so refreshes, cart round-trips and the
// browser back button preserve the catalog context.
const ALL_CATEGORIES = "all";

function selectedCategoryId() {
  const value = new URLSearchParams(location.hash.replace(/^#/, "")).get("c");
  return value || null;
}

function selectCategory(id) {
  location.hash = id ? `c=${encodeURIComponent(id)}` : "";
}

function clearCategoryHash() {
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
}

// Some iOS in-app browsers and restricted WebKit contexts deny Web Storage
// access by throwing a SecurityError. Reorder state is a convenience only, so
// a blocked sessionStorage must never prevent the catalog from rendering.
function readAndClearPendingReorder() {
  try {
    const pendingReorder = sessionStorage.getItem("pendingReorder");
    if (pendingReorder) sessionStorage.removeItem("pendingReorder");
    return pendingReorder;
  } catch {
    return null;
  }
}

function savePendingReorder(previous) {
  try {
    sessionStorage.setItem("pendingReorder", JSON.stringify(previous));
  } catch {
    // Keep navigation usable even when the browser blocks session storage.
  }
}

function renderCategoryPicker(categories) {
  const container = document.querySelector("#category-picker");
  if (!container) return;

  container.replaceChildren(...categories.map((category) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "category-picker-card";

    const name = document.createElement("strong");
    name.textContent = category.name;
    const count = document.createElement("span");
    count.className = "category-picker-count";
    count.textContent = category.count === 1 ? "מוצר אחד" : `${category.count} מוצרים`;
    card.append(name);

    if (category.description) {
      const description = document.createElement("p");
      description.textContent = category.description;
      card.append(description);
    }

    card.append(count);
    card.addEventListener("click", () => selectCategory(category.id));
    return card;
  }));
}

function renderCategoryFilters(categories, selectedId) {
  const container = document.querySelector("#category-filters");
  if (!container) return;

  container.replaceChildren();
  if (categories.length === 0) return;

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = `category-chip${selectedId === ALL_CATEGORIES ? " is-active" : ""}`;
  allChip.setAttribute("role", "tab");
  allChip.setAttribute("aria-selected", String(selectedId === ALL_CATEGORIES));
  allChip.textContent = "הכל";
  allChip.addEventListener("click", () => selectCategory(ALL_CATEGORIES));
  container.append(allChip);

  categories.forEach((category) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `category-chip${selectedId === category.id ? " is-active" : ""}`;
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", String(selectedId === category.id));
    chip.textContent = category.name;
    chip.addEventListener("click", () => selectCategory(category.id));
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

  const activeCategories = store.categories.filter((category) => category.active !== false);
  const activeCategoryIds = new Set(activeCategories.map((category) => category.id));
  const eligibleProducts = store.products.filter((product) => product.catalogStatus !== "incomplete");
  const catalogProducts = eligibleProducts.filter((product) =>
    product.categoryIds?.some((id) => activeCategoryIds.has(id)));
  const pickableCategories = activeCategories
    .map((category) => ({
      ...category,
      count: catalogProducts.filter((product) => product.categoryIds?.includes(category.id)).length,
    }))
    .filter((category) => category.count > 0);
  const useUncategorizedFallback = pickableCategories.length === 0;

  let selectedId = selectedCategoryId();
  const invalidSelection = selectedId !== null
    && selectedId !== ALL_CATEGORIES
    && !pickableCategories.some((category) => category.id === selectedId);
  const unrelatedHash = location.hash && selectedId === null;
  if (invalidSelection || unrelatedHash || (useUncategorizedFallback && location.hash)) {
    clearCategoryHash();
    selectedId = null;
  }

  const showCategoryPicker = !useUncategorizedFallback && selectedId === null;
  const visibleProducts = showCategoryPicker
    ? []
    : useUncategorizedFallback
      ? eligibleProducts
      : selectedId === ALL_CATEGORIES
        ? catalogProducts
        : catalogProducts.filter((product) => product.categoryIds?.includes(selectedId));

  renderCategoryPicker(pickableCategories);
  renderCategoryFilters(pickableCategories, selectedId);

  const pickerSection = document.querySelector("#category-picker-section");
  const filters = document.querySelector("#category-filters");
  const backButton = document.querySelector("#category-back");
  if (pickerSection) pickerSection.hidden = !showCategoryPicker;
  if (filters) filters.hidden = showCategoryPicker || useUncategorizedFallback;
  if (backButton) {
    backButton.hidden = showCategoryPicker || useUncategorizedFallback;
    backButton.onclick = () => selectCategory(null);
  }

  const eligibility = getOrderEligibility();

  catalogGrid.replaceChildren();
  ideasGrid?.replaceChildren();
  document.querySelector("#catalog-empty")
    ?.classList.toggle("is-visible", !showCategoryPicker && visibleProducts.length === 0);

  visibleProducts.forEach((product) => {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    const cardImage = card.querySelector(".product-image");
    const cardImages = normalizedProductImages(product);
    if (cardImages.length) {
      cardImage.classList.add("is-clickable");
      cardImage.removeAttribute("aria-hidden");
      createImageGallery(cardImage, {
        images: cardImages,
        altText: product.name,
        activateLabel: `פתיחת פרטי ${product.name}`,
        onActivate: () => openProductDetail(product, eligibility),
        lazy: true,
      });
    }
    card.querySelector("h3").textContent = product.name;
    card.querySelector("p").textContent  = product.description;
    // Two independent facts: whether the model was ever printed, and whether its
    // price is known. An idea with print data is priced; one without is not.
    const untested = isUntested(product);
    card.querySelector(".cost").textContent = isUnpriced(product)
      ? "מחיר לאחר בדיקה"
      : untested
        ? `${formatCurrency(product.cost)} · טרם הודפס`
        : product.requiresAdminApproval
          ? `מחיר משוער ${formatCurrency(product.cost)}`
          : formatCurrency(product.cost);
    renderProductBadges(card, product);

    const orderBtn = card.querySelector(".product-meta .primary-button");
    orderBtn.textContent = product.inventoryAvailable === false
      ? "בקשת חלופה"
      : isUnpriced(product) ? "בקשת בדיקה" : "הוספה לעגלה";
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
    // Grid placement follows "was it ever printed", never the price.
    (untested && ideasGrid ? ideasGrid : catalogGrid).append(card);
  });

  const hasIdeas = visibleProducts.some(isUntested);
  const hasPrinted = visibleProducts.some((product) => !isUntested(product));
  const ideasSection = document.querySelector("#idea-products-section");
  const printedSection = document.querySelector("#printed-products-section");
  if (ideasSection) ideasSection.hidden = showCategoryPicker || !hasIdeas;
  if (printedSection) printedSection.hidden = showCategoryPicker || !hasPrinted;

  const pendingReorder = readAndClearPendingReorder();
  if (pendingReorder) {
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
  const legacyMainIndex = images.findIndex((image) => image.isMain || image.url === product.image);
  if (legacyMainIndex > 0) images.unshift(...images.splice(legacyMainIndex, 1));
  return images;
}

function publicColorOptions(product) {
  if (Array.isArray(product.colorOptions) && product.colorOptions.length) return product.colorOptions;
  return (product.possibleColors ?? []).map((color) => ({ value: color, label: color, available: true }));
}

// Tap-vs-swipe detection on a single element using Pointer Events.
// Swipe toward the reading-forward side (left, in RTL) advances to the next image.
function attachSwipe(element, { onNext, onPrev, onTap } = {}) {
  let startX = 0;
  let startY = 0;
  let active = false;
  element.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    active = true; startX = event.clientX; startY = event.clientY;
    try { element.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
  });
  element.addEventListener("pointerup", (event) => {
    if (!active) return;
    active = false;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      (dx < 0 ? onNext : onPrev)?.();
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      onTap?.();
    }
  });
  element.addEventListener("pointercancel", () => { active = false; });
}

// Renders a swipeable single-image gallery into `container` (an array of
// { url, isMain }). Returns a controller { go, set, index } or null when empty.
function createImageGallery(container, { images, altText, startIndex = 0, onActivate, activateLabel, onChange, lazy = false } = {}) {
  container.replaceChildren();
  container.classList.remove("is-zoomable");
  if (!images?.length) return null;
  let index = Math.min(Math.max(startIndex, 0), images.length - 1);

  const img = document.createElement("img");
  img.alt = altText || "";
  img.referrerPolicy = "no-referrer";
  img.loading = lazy ? "lazy" : "eager";
  img.draggable = false;
  if (onActivate && activateLabel) {
    img.setAttribute("role", "button");
    img.setAttribute("tabindex", "0");
    img.setAttribute("aria-label", activateLabel);
    img.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(index); }
    });
  }
  container.append(img);

  let counter = null;
  if (images.length > 1) {
    const makeNav = (dir, label, glyph) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `gallery-nav gallery-nav-${dir}`;
      button.setAttribute("aria-label", label);
      button.textContent = glyph;
      button.addEventListener("click", () => go(dir === "prev" ? -1 : 1));
      return button;
    };
    counter = document.createElement("span");
    counter.className = "gallery-counter";
    container.append(
      makeNav("prev", "התמונה הקודמת", "›"),
      makeNav("next", "התמונה הבאה", "‹"),
      counter,
    );
  }

  function update() {
    img.src = images[index]?.url || "";
    if (counter) counter.textContent = `${index + 1} / ${images.length}`;
    onChange?.(index);
  }
  function go(delta) {
    index = (index + delta + images.length) % images.length;
    update();
  }
  function set(next) {
    index = Math.min(Math.max(next, 0), images.length - 1);
    update();
  }

  attachSwipe(img, {
    onNext: () => go(1),
    onPrev: () => go(-1),
    onTap: onActivate ? () => onActivate(index) : undefined,
  });
  if (onActivate) container.classList.add("is-zoomable");

  update();
  return { go, set, get index() { return index; } };
}

let lightboxGallery = null;
function openImageLightbox(images, altText, startIndex = 0) {
  const dialog = document.querySelector("#image-lightbox-dialog");
  const stage = document.querySelector("#lightbox-stage");
  if (!dialog || !stage || !images?.length) return;
  lightboxGallery = createImageGallery(stage, { images, altText, startIndex });
  dialog.showModal();
}

(function initImageLightbox() {
  const dialog = document.querySelector("#image-lightbox-dialog");
  if (!dialog) return;
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") { event.preventDefault(); lightboxGallery?.go(-1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); lightboxGallery?.go(1); }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.hasAttribute?.("data-close-lightbox")) dialog.close();
  });
})();

function openProductDetail(product, eligibility = getOrderEligibility()) {
  const dialog = document.querySelector("#product-detail-dialog");
  if (!dialog) return;
  document.querySelector("#product-detail-title").textContent = product.name;
  document.querySelector("#product-detail-description").textContent = product.description || "אין תיאור נוסף למוצר.";
  const untested = isUntested(product);
  document.querySelector("#product-detail-price").textContent = isUnpriced(product)
    ? "המחיר ייקבע לאחר בדיקה"
    : untested
      ? `${formatCurrency(product.cost)} — דגם שטרם הודפס`
      : product.requiresAdminApproval
        ? `מחיר משוער ${formatCurrency(product.cost)} — ייקבע סופית לאחר בדיקה`
        : formatCurrency(product.cost);

  const facts = [];
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
    : isUnpriced(product) ? "נדרשים בדיקה ואישור מחיר לפני תחילת ההדפסה."
      : untested ? UNTESTED_PRICE_NOTE
        : product.requiresAdminApproval ? "נדרש אישור מחיר לפני תחילת ההדפסה." : "זמין להזמנה.";
  const badges = document.querySelector("#product-detail-badges");
  badges.replaceChildren();
  if (untested || product.requiresAdminApproval) {
    const badge = document.createElement("span");
    badge.className = "product-badge product-badge-idea";
    badge.textContent = untested ? "טרם הודפס" : "דורש אישור מחיר";
    badges.append(badge);
  }
  if (product.inventoryAvailable === false) {
    const badge = document.createElement("span");
    badge.className = "product-badge";
    badge.textContent = "לא זמין כרגע";
    badges.append(badge);
  }

  const images = normalizedProductImages(product);
  const main = document.querySelector("#product-detail-main-image");
  const thumbs = document.querySelector("#product-detail-thumbnails");
  thumbs.replaceChildren();
  main.classList.remove("is-empty");
  if (!images.length) {
    main.replaceChildren();
    main.classList.add("is-empty");
    main.textContent = "אין תמונה זמינה";
  } else {
    const thumbButtons = images.length > 1
      ? images.map((image, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "product-thumb";
          button.setAttribute("aria-label", `הצגת תמונה ${index + 1} מתוך ${images.length}`);
          const thumbImg = document.createElement("img");
          thumbImg.src = image.url; thumbImg.alt = ""; thumbImg.referrerPolicy = "no-referrer";
          button.append(thumbImg);
          return button;
        })
      : [];
    const gallery = createImageGallery(main, {
      images,
      altText: product.name,
      onActivate: (index) => openImageLightbox(images, product.name, index),
      onChange: (index) => thumbButtons.forEach((btn, i) => btn.classList.toggle("is-active", i === index)),
    });
    thumbButtons.forEach((button, index) => {
      button.addEventListener("click", () => gallery.set(index));
      thumbs.append(button);
    });
  }

  const orderButton = document.querySelector("#product-detail-order");
  orderButton.disabled = !eligibility.canOrder && !eligibility.clickable;
  orderButton.textContent = eligibility.canOrder ? (product.inventoryAvailable === false ? "בקשת חלופה" : "הוספה לעגלה") : eligibility.label;
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

// ── Cart ──────────────────────────────────────────────────────

// The count sits in the global nav on every page, so it is refreshed by the
// same render() pass as everything else.
export function renderCartBadge() {
  const count = store.currentUser ? cartCount() : 0;
  document.querySelectorAll("[data-cart-count]").forEach((badge) => {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  });
  // The tab is an icon, so its accessible name is the only thing a screen
  // reader gets — it has to carry the count the badge shows visually.
  document.querySelectorAll(".global-tab[data-tab='cart']").forEach((tab) => {
    tab.setAttribute("aria-label", count === 0
      ? "עגלת קניות — ריקה"
      : `עגלת קניות — ${count} פריטים`);
  });
}

// Colour ids only mean something next to the product that offers them, so the
// label comes from the product's own palette rather than the filament list
// (which friends never receive).
function cartLineColorLabels(line) {
  const options = line.product?.colorOptions ?? [];
  return (line.selectedColors ?? []).map((value) => {
    const option = options.find((entry) => String(entry.value ?? entry) === value);
    return String(option?.label ?? option?.name ?? value);
  });
}

function buildCartLineRow(line) {
  const row = document.createElement("article");
  row.className = `cart-line${line.missing ? " is-missing" : ""}`;
  const name = line.product?.name ?? "מוצר שאינו זמין עוד";
  const colors = cartLineColorLabels(line);
  const image = line.product?.image;

  row.innerHTML = `
    <div class="cart-line-image">${image
      ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" />` : ""}</div>
    <div class="cart-line-info">
      <strong class="cart-line-name">${escapeHtml(name)}</strong>
      ${colors.length ? `<span class="cart-line-meta">צבע: ${escapeHtml(colors.join(", "))}</span>` : ""}
      ${line.unpriced ? `<span class="cart-line-meta">${escapeHtml(UNPRICED_LABEL)} — נדרשת בדיקה לפני ההדפסה</span>` : ""}
      ${line.untested && !line.unpriced ? '<span class="cart-line-meta">דגם שטרם הודפס — מחיר לפי תוספת סיכון</span>' : ""}
      ${line.missing ? '<span class="cart-line-meta">המוצר ירד מהקטלוג ולא יישלח בהזמנה.</span>' : ""}
    </div>
    <div class="cart-line-controls"></div>
    <div class="cart-line-price">${line.unpriced || line.missing
      ? escapeHtml(UNPRICED_LABEL) : formatCurrency(line.price)}</div>
  `;

  const controls = row.querySelector(".cart-line-controls");
  if (!line.missing) {
    const label = document.createElement("label");
    label.className = "cart-line-quantity";
    label.textContent = "כמות";
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = line.product?.allowMultiple === false ? "1" : "50";
    input.value = String(line.quantity);
    input.readOnly = line.product?.allowMultiple === false;
    input.setAttribute("aria-label", `כמות עבור ${name}`);
    input.addEventListener("change", () => {
      updateLine(line.lineId, { quantity: Number(input.value) });
      render();
    });
    label.append(input);
    controls.append(label);
  }

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "ghost-button btn-sm";
  removeBtn.textContent = "הסרה";
  removeBtn.setAttribute("aria-label", `הסרת ${name} מהעגלה`);
  removeBtn.addEventListener("click", () => { removeLine(line.lineId); render(); });
  controls.append(removeBtn);

  return row;
}

function renderCart() {
  const list = document.querySelector("#cart-lines");
  if (!list) return;
  // After a successful checkout the page shows the thank-you panel; a later
  // render pass must not put the (now empty) cart back on screen over it.
  const thanks = document.querySelector("#cart-thanks");
  if (thanks && !thanks.hidden) return;

  const totals = cartTotals();
  const contents = document.querySelector("#cart-contents");
  const empty = document.querySelector("#cart-empty");
  if (contents) contents.hidden = totals.lines.length === 0;
  if (empty) empty.hidden = totals.lines.length > 0;

  list.replaceChildren(...totals.lines.map(buildCartLineRow));

  const missingNote = document.querySelector("#cart-missing-note");
  if (missingNote) missingNote.hidden = !totals.hasMissing;

  document.querySelector("#cart-base-cost").textContent = totals.hasUnpriced && totals.base === 0
    ? UNPRICED_LABEL : formatCurrency(totals.base);
  document.querySelector("#cart-tip-cost").textContent = formatCurrency(totals.tip);
  document.querySelector("#cart-total-cost").textContent = totals.hasUnpriced && totals.base === 0
    ? formatCurrency(totals.tip) : formatCurrency(totals.total);
  const unpricedNote = document.querySelector("#cart-unpriced-note");
  if (unpricedNote) unpricedNote.hidden = !totals.hasUnpriced;
  const untestedNote = document.querySelector("#cart-untested-note");
  if (untestedNote) untestedNote.hidden = !totals.hasUntested;

  const checkout = document.querySelector("#checkout-button");
  // A cart of nothing but unavailable products has nothing to send.
  if (checkout) checkout.disabled = totals.lines.every((line) => line.missing);
}

// ── Orders (admin view): grouped cards, filter bar, drawer ────

const PAST_STATUSES = new Set(["completed", "failed", "cancelled"]);
const FORWARD_STATUS_SEQUENCE = ["new", "waiting_approval", "waiting_print", "printing", "ready_delivery", "completed"];
// Assembly is an optional detour after printing — most prints ship as-is, so it
// stays out of the default chain and is picked from the status <select>. Once an
// order is there, the promote button still leads on to delivery.
const FORWARD_STATUS_DETOURS = { waiting_assembly: "ready_delivery" };

// An order line counts as printed once the physical part exists — whether it is
// still waiting for assembly, ready to hand over, or already delivered. This is
// derived from the status rather than stored, so there is no second source of
// truth that could drift from it.
const PRINTED_STATUSES = new Set(["waiting_assembly", "ready_delivery", "completed"]);

let orderSearchQuery = "";
// The tab is an open-work queue, so it opens on the open orders. "הכל"/"הושלמו"
// stay available as chips so nothing becomes unreachable.
let orderStatusFilter = "open"; // all | unpaid | open | done

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

function nextOrderStatus(order) {
  const status = order?.status;
  // A priced untested model stops at "new" for the admin's first-print review,
  // but the friend has already accepted the catalog price. After the admin
  // reviews it, there is no price-approval step to wait for.
  if (status === "new" && !order.requiresUserPriceApproval) return "waiting_print";
  if (FORWARD_STATUS_DETOURS[status]) return FORWARD_STATUS_DETOURS[status];
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

// A cart checkout is several orders that arrived together. Each card still
// stands alone — one product, one status, one print job — so the cart only adds
// a badge saying which purchase this line came from.
function cartBadgeLabel(order) {
  if (!order.cartId) return "";
  const siblings = store.orders.filter((entry) => entry.cartId === order.cartId);
  if (siblings.length < 2) return "";
  return `<span class="status-badge status-pending">🛒 פריט ${
    (Number(order.cartPosition) || 0) + 1} מתוך ${siblings.length}</span>`;
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
      ${cartBadgeLabel(order)}
    </div>
    <div class="order-card-actions"></div>
  `;

  const actions = card.querySelector(".order-card-actions");

  const next = nextOrderStatus(order);
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

  // Per-product print marker: this is what makes a customer's order "partially
  // ready". It only moves the status, so the existing status <select> stays the
  // way to reach the finer states (e.g. assembly) and nothing is stored twice.
  if (!PAST_STATUSES.has(order.status)) {
    const printedLabel = document.createElement("label");
    printedLabel.className = "paid-toggle printed-toggle";
    printedLabel.innerHTML = `<input type="checkbox" ${PRINTED_STATUSES.has(order.status) ? "checked" : ""} /> הודפס`;
    printedLabel.querySelector("input").addEventListener("change", (event) => {
      setOrderStatus(order, event.target.checked ? "ready_delivery" : "waiting_print");
    });
    actions.append(printedLabel);
  }

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
  const profit = totalCost - Number(myCost);
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

// Every status/payment change re-renders the whole list, so which groups the
// admin collapsed must live outside the DOM to survive it. Mirrors the
// expandedCustomers pattern in the users table.
const collapsedOrderGroups = new Set();

// Orders are stored one row per product, so a customer's order is the set of
// their rows. user_id is authoritative; legacy rows without a matching user
// fall back to the name they were placed under.
function orderGroupKey(order) {
  const user = findOrderUser(order);
  return user ? `user:${user.id}` : `name:${order.friendName ?? ""}`;
}

// "Partially ready" in one place: how many of a customer's product lines
// already exist physically. Cancelled and failed lines are not owed to anyone,
// so they neither count as printed nor as still missing.
function groupReadiness(orders) {
  const owed    = orders.filter((o) => o.status !== "cancelled" && o.status !== "failed");
  const printed = owed.filter((o) => PRINTED_STATUSES.has(o.status)).length;
  if (owed.length === 0) return null;
  if (printed === 0) return { state: "none", label: "טרם הודפס" };
  if (printed === owed.length) return { state: "all", label: "הכל הודפס" };
  return { state: "partial", label: `מוכן חלקית · ${printed} מתוך ${owed.length} הודפסו` };
}

// One customer's open work: what they owe money for, what already came off the
// printer, and the individual product cards underneath.
function buildCustomerOrderGroup(key, user, orders) {
  const displayName = user?.fullName || user?.name || orders[0]?.friendName || "ללא שם";
  const priced   = orders.filter((o) => o.status !== "cancelled");
  const total    = sumOrderAmounts(priced);
  const debt     = sumOrderAmounts(priced.filter((o) => !o.paid));
  let sumCost = 0, sumProfit = 0;
  priced.forEach((order) => {
    const { cost, profit } = orderCostBreakdown(order);
    if (cost != null)   sumCost   += cost;
    if (profit != null) sumProfit += profit;
  });

  const readiness = groupReadiness(orders);
  const collapsed = collapsedOrderGroups.has(key);

  const group = document.createElement("section");
  group.className = "order-status-group customer-order-group";

  const header = document.createElement("button");
  header.type = "button";
  header.className = "order-status-group-header customer-order-group-header";
  header.setAttribute("aria-expanded", String(!collapsed));
  header.innerHTML = `
    <span class="customer-order-group-name">${escapeHtml(displayName)}</span>
    ${readiness ? `<span class="order-readiness-chip order-readiness-${readiness.state}">${escapeHtml(readiness.label)}</span>` : ""}
    <span class="order-status-group-count">${orders.length}</span>
  `;

  const summary = document.createElement("div");
  summary.className = "customer-order-group-summary";
  summary.innerHTML = `
    <div class="customer-order-figures">
      <span>עלות ${figureLabel(sumCost)}</span>
      <span>רווח ${figureLabel(sumProfit)}</span>
      ${debt > 0 ? `<span class="stat-negative">חוב ${formatCurrency(debt)}</span>` : ""}
      <span class="customer-order-total">סה"כ ${figureLabel(total)}</span>
    </div>
  `;

  // Money actions need a real user row (phone number, bulk mark-paid), so they
  // are only offered for groups that resolved to one.
  if (user && debt > 0) {
    const groupActions = document.createElement("div");
    groupActions.className = "customer-order-group-actions";

    const paidBtn = document.createElement("button");
    paidBtn.className   = "ghost-button btn-sm";
    paidBtn.type        = "button";
    paidBtn.textContent = "סמן הכל כשולם";
    paidBtn.addEventListener("click", () => markUserOrdersPaid(user));
    groupActions.append(paidBtn);

    groupActions.append(createWhatsAppLink({
      phone: user.phone,
      message: whatsappTemplates.paymentSummary({ name: displayName, amount: debt.toFixed(2) }),
      label: "סיכום לתשלום",
      className: "btn-sm",
    }));
    summary.append(groupActions);
  }

  const list = document.createElement("div");
  list.className = "order-status-group-list";
  list.hidden = collapsed;
  header.classList.toggle("is-collapsed", collapsed);
  header.addEventListener("click", () => {
    const nowCollapsed = !list.hidden;
    list.hidden = nowCollapsed;
    header.classList.toggle("is-collapsed", nowCollapsed);
    header.setAttribute("aria-expanded", String(!nowCollapsed));
    if (nowCollapsed) collapsedOrderGroups.add(key);
    else collapsedOrderGroups.delete(key);
  });

  orders.forEach((order) => list.append(buildOrderCard(order)));

  group.append(header, summary, list);
  return group;
}

function renderOrders() {
  const groupsContainer = document.querySelector("#orders-groups");
  if (!groupsContainer) return;

  const filtered = store.orders.filter(matchesOrderFilter);

  // Tab badge counts are owned centrally by renderNotifications().
  groupsContainer.replaceChildren();
  document.querySelector("#orders-empty")?.classList.toggle("is-visible", filtered.length === 0);

  const groups = new Map(); // key -> orders[], insertion order is irrelevant (sorted below)
  filtered.forEach((order) => {
    const key = orderGroupKey(order);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  });

  const newestAt = (orders) => Math.max(...orders.map((o) => new Date(o.createdAt).getTime() || 0));

  [...groups.entries()]
    .sort(([, a], [, b]) => newestAt(b) - newestAt(a))
    .forEach(([key, orders]) => {
      // Within a customer, walk the lines along the production pipeline so the
      // work that still needs doing sits above what is already printed.
      orders.sort((a, b) =>
        (ORDER_STATUS_SEQUENCE.indexOf(a.status) - ORDER_STATUS_SEQUENCE.indexOf(b.status)) ||
        (new Date(a.createdAt) - new Date(b.createdAt)));
      groupsContainer.append(buildCustomerOrderGroup(key, findOrderUser(orders[0]), orders));
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
    const profitTotal = orders.reduce((s, o) => s + (orderCostBreakdown(o).profit ?? 0), 0);

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
      <td class="stat-cell ${profitTotal >= 0 ? "stat-positive" : "stat-negative"}">${formatCurrency(profitTotal)}</td>
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

// Per-customer order breakdown is expandable inline. render() rebuilds the
// users table on every data change (replaceChildren), so the open/closed state
// and the open-vs-all scope must live outside the DOM to survive a re-render
// (e.g. after "סמן הכל כשולם"). Mirrors selectedCategoryId's module-state pattern.
const expandedCustomers  = new Set(); // user.id values currently expanded
const customerOrderScope = new Map(); // user.id -> "open" | "all" (default "open")

function getUserOrderStats(user) {
  const orders  = ordersForUser(user).filter((o) => o.status !== "cancelled");
  const revenue = sumOrderAmounts(orders);
  const paid    = sumOrderAmounts(orders.filter((o) => o.paid));
  const profit = orders.reduce((s, o) => s + (orderCostBreakdown(o).profit ?? 0), 0);
  return { count: orders.length, revenue, paid, debt: revenue - paid, profit };
}

// One order's money split, matching renderOrderCostSummary's meanings:
// total = what the customer pays (finalAmount), cost = my production cost
// (materials + electricity + wear), profit = the gap. Any of these is null when
// the underlying figure is missing (unpriced idea, or non-catalog order without
// a cost) so it can be shown as "—" and excluded from sums — never invent money.
// Admin views show the exact profit (unrounded); rounding the cost up is only
// applied to the public-facing total on the transparency page, to avoid
// confusing customers with fractional shekels.
function orderCostBreakdown(order) {
  const total  = orderAmount(order);
  const cost   = order.productionCost != null ? Number(order.productionCost) : null;
  const profit = (total != null && cost != null) ? total - cost : null;
  return { total, cost, profit };
}

// One figure ("עלות"/"רווח"/"סה\"כ") cell content: "—" when the number is
// missing so it is never mistaken for ₪0, and NO_PRICE_YET for a missing total.
function figureLabel(value, { missing = "—" } = {}) {
  return value == null ? missing : formatCurrency(value);
}

// Expandable inline row under a customer showing their individual orders with
// עלות / רווח / סה"כ each, plus a per-customer subtotal. Scope defaults to open
// orders with a toggle to all-time (both always exclude cancelled, matching
// getUserOrderStats). Returns the <tr>, hidden unless the customer is expanded.
function buildCustomerOrdersRow(user) {
  const scope = customerOrderScope.get(user.id) === "all" ? "all" : "open";
  const orders = ordersForUser(user)
    .filter((o) => o.status !== "cancelled")
    .filter((o) => scope === "all" || !PAST_STATUSES.has(o.status))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const detailRow = document.createElement("tr");
  detailRow.className = "customer-orders-row";
  detailRow.hidden = !expandedCustomers.has(user.id);

  const cell = document.createElement("td");
  // Span the full row regardless of how many columns the header currently has
  // (it varies as columns like "ווטסאפ" are added), so the breakdown never
  // leaves a stray empty cell.
  cell.colSpan = document.querySelector("#active-users-sub thead tr")?.children.length || 9;

  // Running subtotals — only priced/known figures contribute (null is skipped),
  // so unpriced ideas never inflate the totals.
  let sumCost = 0, sumProfit = 0;
  const sumTotal = sumOrderAmounts(orders);
  const debt = sumOrderAmounts(orders.filter((o) => !o.paid));

  const lines = orders.map((order) => {
    const product = findProduct(order.productId);
    const name    = product?.name || order.requestDescription || "הבקשה שלך";
    const { total, cost, profit } = orderCostBreakdown(order);
    if (cost != null)   sumCost   += cost;
    if (profit != null) sumProfit += profit;
    const typeBadge = order.orderType && order.orderType !== "catalog"
      ? `<span class="status-badge status-inactive">${escapeHtml(ORDER_TYPE_LABELS[order.orderType] ?? order.orderType)}</span>`
      : "";
    return `
      <div class="customer-order-line">
        <div class="customer-order-main">
          <span class="customer-order-name">${escapeHtml(name)} ×${order.quantity}</span>
          <span class="ws-status-chip ws-status-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABELS[order.status] ?? order.status)}</span>
          ${order.paid ? '<span class="status-badge status-active">שולם</span>' : '<span class="status-badge status-pending">לא שולם</span>'}
          ${typeBadge}
        </div>
        <div class="customer-order-figures">
          <span>עלות ${figureLabel(cost)}</span>
          <span>רווח ${figureLabel(profit)}</span>
          <span class="customer-order-total">סה"כ ${figureLabel(total, { missing: NO_PRICE_YET })}</span>
        </div>
      </div>`;
  }).join("");

  const emptyLabel = scope === "all" ? "אין הזמנות." : "אין הזמנות פתוחות.";
  const listMarkup = orders.length
    ? lines
    : `<p class="empty-state is-visible">${emptyLabel}</p>`;

  cell.innerHTML = `
    <div class="customer-orders-detail">
      <div class="customer-orders-scope filter-chips">
        <button type="button" class="filter-chip ${scope === "open" ? "is-active" : ""}" data-scope="open">פתוחות</button>
        <button type="button" class="filter-chip ${scope === "all" ? "is-active" : ""}" data-scope="all">כל ההזמנות</button>
      </div>
      <div class="customer-orders-list">${listMarkup}</div>
      <div class="customer-orders-subtotal">
        <span class="customer-orders-count">${orders.length} הזמנות</span>
        <div class="customer-order-figures">
          <span>עלות ${figureLabel(sumCost)}</span>
          <span>רווח ${figureLabel(sumProfit)}</span>
          ${debt > 0 ? `<span class="stat-negative">חוב ${formatCurrency(debt)}</span>` : ""}
          <span class="customer-order-total">סה"כ ${figureLabel(sumTotal)}</span>
        </div>
      </div>
    </div>
  `;

  cell.querySelectorAll("[data-scope]").forEach((btn) => {
    btn.addEventListener("click", () => {
      customerOrderScope.set(user.id, btn.dataset.scope);
      render();
    });
  });

  detailRow.append(cell);
  return detailRow;
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
        <td class="whatsapp-col"></td>
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
        <td class="stat-cell ${stats.profit >= 0 ? "stat-positive" : "stat-negative"}">${formatCurrency(stats.profit)}</td>
        <td class="actions-cell"></td>
      `;

      // WhatsApp icon (rightmost column, next to the name) + edit / delete buttons
      row.querySelector(".whatsapp-col").append(createWhatsAppLink({
        phone: user.phone,
        message: whatsappTemplates.general(user.fullName || user.name),
        label: "וואטסאפ",
        className: "btn-sm",
        iconOnly: true,
      }));
      const actionsCell = row.querySelector(".actions-cell");
      const editBtn = document.createElement("button");
      editBtn.className   = "ghost-button btn-sm";
      editBtn.type        = "button";
      editBtn.textContent = "ערוך";

      const deleteBtn = document.createElement("button");
      deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
      deleteBtn.type        = "button";
      deleteBtn.textContent = "מחק";
      deleteBtn.addEventListener("click", () => deleteUser(user.id));

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

      const isExpanded = expandedCustomers.has(user.id);
      const detailsBtn = document.createElement("button");
      detailsBtn.className   = "ghost-button btn-sm";
      detailsBtn.type        = "button";
      detailsBtn.textContent = isExpanded ? "הסתר הזמנות" : "פירוט הזמנות";
      detailsBtn.setAttribute("aria-expanded", String(isExpanded));
      detailsBtn.addEventListener("click", () => {
        if (expandedCustomers.has(user.id)) expandedCustomers.delete(user.id);
        else expandedCustomers.add(user.id);
        render();
      });
      actionsCell.append(detailsBtn);

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
      editCell.colSpan = 9;
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

      activeTable.append(row, buildCustomerOrdersRow(user), editRow);
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
        <td class="whatsapp-col"></td>
        <td>${escapeHtml(user.name)}</td>
        <td>${escapeHtml(user.fullName ?? "")}</td>
        <td>${escapeHtml(user.howYouKnowAdmin ?? "")}</td>
        <td>${escapeHtml(user.registrationMessage ?? "")}</td>
        <td>${new Date(user.createdAt).toLocaleDateString("he-IL")}</td>
        <td class="actions-cell"></td>
      `;

      row.querySelector(".whatsapp-col").append(createWhatsAppLink({
        phone: user.phone,
        message: whatsappTemplates.general(user.fullName || user.name),
        label: "וואטסאפ",
        className: "btn-sm",
        iconOnly: true,
      }));

      const cell = row.querySelector(".actions-cell");
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

      cell.append(approveBtn, rejectBtn, deleteBtn);
      pendingTable.append(row);

      // ── Reject-reason row (replaces window.prompt) ─────────
      const rejectRow = document.createElement("tr");
      rejectRow.className = "user-edit-row";
      rejectRow.hidden = true;
      const rejectCell = document.createElement("td");
      rejectCell.colSpan = 7;
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
    const profitTotal = orders.reduce((s, o) => s + (orderCostBreakdown(o).profit ?? 0), 0);

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
      ${readinessNotice}
      ${stockNotice}
      <div class="store-edit-live-stats">
        <span>${orders.length} הזמנות</span>
        <span class="${profitTotal > 0 ? "stat-positive" : "stat-muted"}">${formatCurrency(profitTotal)} רווח</span>
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
      promoteBtn.addEventListener("click", () => setOrderStatus(order, nextOrderStatus(order)));
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
  const profitTotal   = paidOrders.reduce((s, o) => s + (orderCostBreakdown(o).profit ?? 0), 0);
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
    paidIncome, unpaidTotal, profitTotal, totalExpenses, reinvestmentBalance,
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
    { label: "רווח שהתקבל", value: s.profitTotal, tone: "positive" },
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

function renderProductBadges(card, product) {
  const container = card.querySelector(".product-badges");
  if (!container) return;
  container.replaceChildren();
  // Two independent badges. A model that was never printed always says so, even
  // when it already has a price and needs no approval.
  const badges = [];
  if (isUntested(product)) badges.push("טרם הודפס");
  if (product.requiresAdminApproval) badges.push("דורש אישור מחיר לפני הדפסה");
  badges.forEach((text) => {
    const badge = document.createElement("span");
    badge.className = "product-badge product-badge-idea";
    badge.textContent = text;
    container.append(badge);
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

  const open = store.myOrders.filter((o) => !["completed", "cancelled"].includes(o.status));
  const past = store.myOrders.filter((o) => ["completed", "cancelled"].includes(o.status));

  renderWelcomeSummary(open);

  const openCount = document.querySelector("#ws-open-count");
  if (openCount) {
    openCount.textContent = open.length || "";
    openCount.hidden = open.length === 0;
  }

  renderWsOrderList(document.querySelector("#ws-open-orders"), open, "אין לך הזמנות פתוחות כרגע", { allowReorder: false });
  renderWsOrderList(document.querySelector("#ws-past-orders"), past, "אין לך הזמנות שהסתיימו עדיין", { allowReorder: true });

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

function renderWelcomeSummary(openOrders) {
  const unpaidOpen = openOrders.filter((order) => !order.paid);
  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };
  setText("#ws-summary-open", String(openOrders.length));
  setText("#ws-summary-due", formatCurrency(sumOrderAmounts(unpaidOpen)));
  setText("#ws-summary-ready", String(openOrders.filter((order) => order.status === "ready_delivery").length));
  setText("#ws-summary-support", formatCurrency(store.myOrders
    .filter((order) => order.paid)
    .reduce((total, order) => total + (Number(order.supportAmount) || 0), 0)));

  const attentionCard = document.querySelector("#ws-attention-card");
  const attentionList = document.querySelector("#ws-attention-list");
  if (!attentionCard || !attentionList) return;
  const items = [
    {
      count: openOrders.filter((order) => order.status === "waiting_approval" && order.requiresUserPriceApproval && !order.userApprovedPrice).length,
      label: "מחיר שממתין לאישור שלך",
    },
    {
      count: openOrders.filter((order) => order.colorAlternativeStatus === "pending").length,
      label: "חלופת צבע שממתינה לאישור שלך",
    },
    {
      count: openOrders.filter((order) => order.status === "ready_delivery").length,
      label: "הזמנה שמוכנה לאיסוף",
    },
    {
      count: unpaidOpen.filter((order) => order.status === "ready_delivery" && orderAmount(order) != null).length,
      label: "הזמנה מוכנה עם תשלום פתוח",
    },
  ].filter((item) => item.count > 0);

  attentionCard.hidden = items.length === 0;
  attentionList.replaceChildren();
  items.forEach((item) => {
    const link = document.createElement("a");
    link.className = "ws-attention-item";
    link.href = "#ws-orders-card";
    link.innerHTML = `<strong>${item.count}</strong><span>${escapeHtml(item.label)}</span><span aria-hidden="true">←</span>`;
    attentionList.append(link);
  });
}

// Totals span the whole checkout, so they are taken from store.myOrders rather
// than from whichever sublist (active / past) is being rendered right now.
function buildCartGroupHeader(cartId) {
  const siblings = store.myOrders.filter((entry) => entry.cartId === cartId);
  const items = siblings.reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
  const support = siblings.reduce((sum, entry) => sum + (Number(entry.supportAmount) || 0), 0);
  const amounts = siblings.map(orderAmount);
  const known = amounts.filter((value) => value != null);
  const total = known.reduce((sum, value) => sum + value, 0);
  const partial = known.length < amounts.length;

  const header = document.createElement("div");
  header.className = "ws-cart-group";
  const totalText = known.length === 0
    ? NO_PRICE_YET
    : `${partial ? "עד כה " : ""}${formatCurrency(total)}`;
  header.innerHTML = `
    <span class="ws-cart-group-title">הזמנה אחת · ${siblings.length} מוצרים (${items} יחידות)</span>
    <span class="ws-cart-group-total">סה"כ ${escapeHtml(totalText)}${
      support > 0 ? ` · כולל ${formatCurrency(support)} תמיכה 💛` : ""}</span>
  `;
  return header;
}

function renderWsOrderList(container, orders, emptyMsg, { allowReorder = true } = {}) {
  if (!container) return;
  container.replaceChildren();
  if (orders.length === 0) {
    const p = document.createElement("p");
    p.className = "ws-empty";
    p.textContent = emptyMsg;
    container.append(p);
    return;
  }
  // Orders placed in one cart checkout arrive adjacent (same created_at, sorted
  // newest first), so a header when the cart id changes is enough to read them
  // as one purchase. Each line stays its own card: price approval, colour
  // alternatives and cancellation are decided per item, not per cart.
  let lastCartId = null;
  orders.forEach((order) => {
    if (order.cartId && order.cartId !== lastCartId) {
      container.append(buildCartGroupHeader(order.cartId));
    }
    lastCartId = order.cartId ?? null;

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
        ${supportAmount > 0 && !order.cartId ? `<span class="ws-order-meta">כולל ${formatCurrency(supportAmount)} תמיכה בפרויקט — תודה! 💛</span>` : ""}
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

    if (allowReorder) {
      const reorderBtn = document.createElement("button");
      reorderBtn.className = "ghost-button btn-sm";
      reorderBtn.type = "button";
      reorderBtn.textContent = "להזמין שוב";
      reorderBtn.addEventListener("click", () => reorder(order, product, title));
      actions.append(reorderBtn);
    }

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

function formatPublicDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
}

function renderTransparencyPage() {
  const metrics = document.querySelector("#project-metrics");
  if (!metrics) return;
  const data = store.transparency;
  const error = document.querySelector("#transparency-error");
  if (!data) {
    if (error) error.hidden = false;
    return;
  }
  if (error) error.hidden = true;

  const project = data.project ?? {};
  const statusLabels = { active: "הפרויקט פעיל", busy: "יש כרגע עומס", paused: "הפרויקט בהפסקה", maintenance: "המדפסת בתחזוקה" };
  const statusChip = document.querySelector("#project-status-chip");
  if (statusChip) {
    statusChip.textContent = statusLabels[project.status] ?? statusLabels.active;
    statusChip.dataset.status = project.status ?? "active";
  }
  const statusMessage = document.querySelector("#project-status-message");
  if (statusMessage && project.statusMessage) statusMessage.textContent = project.statusMessage;
  const leadTime = document.querySelector("#project-lead-time");
  if (leadTime) {
    leadTime.textContent = project.leadTime ? `זמן טיפול משוער: ${project.leadTime}` : "";
    leadTime.hidden = !project.leadTime;
  }
  const updatedAt = document.querySelector("#project-updated-at");
  const updatedLabel = formatPublicDate(project.updatedAt);
  if (updatedAt) {
    updatedAt.textContent = updatedLabel ? `עודכן לאחרונה: ${updatedLabel}` : "";
    updatedAt.hidden = !updatedLabel;
  }
  const catalogLink = document.querySelector("#transparency-catalog-link");
  if (catalogLink) {
    catalogLink.href = store.currentUser ? "catalog.html" : "dashboard.html";
    catalogLink.textContent = store.currentUser ? "לקטלוג המוצרים" : "כניסה לקטלוג";
  }

  const summaryMetrics = [
    ["הדפסות שהושלמו", String(data.completedPrints ?? 0)],
    ["הושלמו החודש", String(data.completedThisMonth ?? 0)],
    ["צבעים זמינים", String(data.availableMaterialCount ?? 0)],
    ["רווח שנאסף", formatCurrency(data.totalProfit ?? 0)],
    ["הושקע מחדש", formatCurrency(data.reinvestedAmount ?? 0)],
  ];
  metrics.innerHTML = summaryMetrics.map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");

  const materialsGrid = document.querySelector("#public-materials-grid");
  const materialsEmpty = document.querySelector("#public-materials-empty");
  const availabilityLabels = { available: "זמין", limited: "כמות מוגבלת", unavailable: "לא זמין כרגע" };
  const materialDescriptions = { PLA: "מתאים לרוב ההדפסות", PETG: "עמיד יותר לחום ולשימוש", TPU: "גמיש", ABS: "חזק ועמיד" };
  if (materialsGrid) {
    materialsGrid.replaceChildren();
    (data.materials ?? []).forEach((material) => {
      const card = document.createElement("article");
      card.className = "public-material-card";
      card.dataset.availability = material.availability ?? "unavailable";
      const safeColor = /^#[0-9a-f]{6}$/i.test(material.colorHex ?? "") ? material.colorHex : "#8b8b8b";
      card.innerHTML = `
        <span class="public-material-swatch" style="--material-color:${safeColor}" aria-hidden="true"></span>
        <div><strong>${escapeHtml(material.colorName ?? "צבע ללא שם")}</strong><span>${escapeHtml(material.materialType ?? "חומר")}</span></div>
        <p>${escapeHtml(materialDescriptions[material.materialType] ?? "חומר זמין לפי התאמה למוצר")}</p>
        <span class="public-material-status">${escapeHtml(availabilityLabels[material.availability] ?? availabilityLabels.unavailable)}</span>
      `;
      materialsGrid.append(card);
    });
  }
  if (materialsEmpty) materialsEmpty.hidden = (data.materials ?? []).length > 0;

  const goalsContainer = document.querySelector("#public-goals");
  if (goalsContainer) {
    goalsContainer.replaceChildren();
    if ((data.goals ?? []).length) {
      const heading = document.createElement("h3"); heading.textContent = "יעדים בתהליך"; goalsContainer.append(heading);
    }
  (data.goals ?? []).forEach((goal) => {
      const target = Math.max(Number(goal.targetAmount ?? goal.target ?? 0), 0);
      const current = Math.max(Number(goal.currentAmount ?? goal.saved ?? 0), 0);
      const row = document.createElement("article"); row.className = "public-goal-card";
      row.innerHTML = `<div><strong>${escapeHtml(goal.label ?? goal.name ?? "יעד")}</strong><span>${formatCurrency(current)} מתוך ${formatCurrency(target)}</span></div><progress max="${target || 1}" value="${Math.min(current, target || 1)}" aria-label="התקדמות יעד"></progress>`;
      goalsContainer.append(row);
  });
  }

  const investmentsContainer = document.querySelector("#public-investments");
  if (investmentsContainer) investmentsContainer.replaceChildren();
  if ((data.investments ?? []).length) {
    const heading = document.createElement("h3"); heading.textContent = "רכישות והשקעות שפורסמו"; investmentsContainer?.append(heading);
    (data.investments ?? []).forEach((investment) => {
      const row = document.createElement("article"); row.className = "public-investment-row";
      row.innerHTML = `<div><strong>${escapeHtml(investment.label ?? "השקעה בפרויקט")}</strong><span>${escapeHtml(formatPublicDate(investment.occurredAt))}</span></div><strong>${formatCurrency(investment.amount ?? 0)}</strong>`;
      investmentsContainer?.append(row);
    });
  }

  const updatesSection = document.querySelector("#project-updates-section");
  const updatesContainer = document.querySelector("#project-updates");
  const updates = project.updates ?? [];
  if (updatesSection) updatesSection.hidden = updates.length === 0;
  if (updatesContainer) {
    updatesContainer.replaceChildren();
    updates.forEach((update) => {
      const article = document.createElement("article");
      article.innerHTML = `<time datetime="${escapeHtml(update.publishedAt ?? "")}">${escapeHtml(formatPublicDate(update.publishedAt))}</time><h3>${escapeHtml(update.title)}</h3>${update.body ? `<p>${escapeHtml(update.body)}</p>` : ""}`;
      updatesContainer.append(article);
    });
  }
}

function renderProjectSettingsForm() {
  const form = document.querySelector("#project-settings-form");
  if (!form || !store.projectSettings) return;
  form.elements.status.value = store.projectSettings.status ?? "active";
  form.elements.leadTime.value = store.projectSettings.leadTime ?? "";
  form.elements.statusMessage.value = store.projectSettings.statusMessage ?? "";

  const updateForm = document.querySelector("#project-update-form");
  if (updateForm && !updateForm.elements.publishedAt.value) {
    updateForm.elements.publishedAt.value = new Date().toISOString().slice(0, 10);
  }
  const list = document.querySelector("#project-updates-admin-list");
  const empty = document.querySelector("#project-updates-admin-empty");
  const updates = store.projectSettings.updates ?? [];
  if (empty) empty.classList.toggle("is-visible", updates.length === 0);
  if (!list) return;
  list.replaceChildren();
  updates.forEach((update) => {
    const row = document.createElement("article");
    row.className = "business-row project-update-admin-row";
    row.innerHTML = `<div><strong>${escapeHtml(update.title)}</strong><span>${escapeHtml(update.body ?? "")}</span></div><time datetime="${escapeHtml(update.publishedAt ?? "")}">${escapeHtml(formatPublicDate(update.publishedAt))}</time>`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost-button btn-sm user-delete-btn";
    remove.textContent = "הסרה";
    remove.addEventListener("click", () => deleteProjectUpdate(update.id));
    row.append(remove);
    list.append(row);
  });
}

async function deleteProjectUpdate(updateId) {
  if (!window.confirm("להסיר את העדכון מהעמוד הציבורי?")) return;
  try {
    store.projectSettings = await api("/api/settings?key=project", {
      method: "PUT",
      body: JSON.stringify({
        ...store.projectSettings,
        updates: (store.projectSettings?.updates ?? []).filter((update) => update.id !== updateId),
      }),
    });
    render();
  } catch (err) {
    alert(`שגיאה בהסרת העדכון: ${err.message}`);
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
  savePendingReorder(previous);
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
      <td>${escapeHtml(f.manufacturer ?? '')}</td>
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
  form.elements["manufacturer"].value = f.manufacturer ?? "";
  form.elements["materialType"].value = f.materialType ?? "PLA";
  form.elements["colorName"].value   = f.colorName ?? "";
  form.elements["colorHex"].value    = f.colorHex;
  form.elements["spoolPrice"].value = f.spoolPrice ?? "";
  form.elements["spoolGrams"].value = f.spoolGrams ?? 1000;
  form.elements["remainingGrams"].value = f.remainingGrams ?? "";
  form.elements["note"].value        = f.note ?? "";
  form.elements["active"].checked    = f.active !== false;
  const namePreview = document.querySelector("#filament-name-preview");
  if (namePreview) namePreview.textContent = `שם החומר: ${composeFilamentName(f.manufacturer, f.materialType, f.colorName) || "—"}`;
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
  const risk = s.riskPercentByLevel ?? s.riskPercents ?? { low: 0.08, medium: 0.15, high: 0.25, untested: 0.35 };
  if (form.elements.riskLowPercent) form.elements.riskLowPercent.value = Number(risk.low) * 100;
  if (form.elements.riskMediumPercent) form.elements.riskMediumPercent.value = Number(risk.medium) * 100;
  if (form.elements.riskHighPercent) form.elements.riskHighPercent.value = Number(risk.high) * 100;
  if (form.elements.riskUntestedPercent) form.elements.riskUntestedPercent.value = Number(risk.untested ?? 0.35) * 100;
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
