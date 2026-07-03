import { store, loadData, findProduct } from "./state.js";
import { formatCurrency, escapeHtml, calculateProductCost } from "./utils.js";
import { api } from "./api.js";
import { openOrderDialog } from "./orders.js";
import { createWhatsAppLink, whatsappTemplates, STATUS_LABELS } from "./whatsapp.js";
import { setView } from "./auth.js";

// Canonical order, used to build status <select> options (STATUS_LABELS also
// carries legacy keys as a display fallback, which must not appear as choices).
const ORDER_STATUS_SEQUENCE = [
  "new", "waiting_approval", "waiting_print", "printing",
  "ready_delivery", "completed", "cancelled",
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

// ── Public entry point ────────────────────────────────────────

export function render() {
  renderCatalog();
  renderOrders();
  renderItemStats();
  renderUsersAdmin();
  renderStoreEdit();
  renderCategoriesAdmin();
  renderSummary();
  renderOverview();
  renderWelcome();
  renderFilaments();
  renderPricingForm();
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
  const cardTemplate = document.querySelector("#product-card-template");
  if (!catalogGrid || !cardTemplate) return;

  renderCategoryFilters();

  let visibleProducts = store.appMode === "admin"
    ? store.products
    : store.products.filter((p) => p.active !== false);

  if (selectedCategoryId) {
    visibleProducts = visibleProducts.filter((p) => p.categoryIds?.includes(selectedCategoryId));
  }

  const eligibility = getOrderEligibility();

  catalogGrid.replaceChildren();
  document.querySelector("#catalog-empty")
    ?.classList.toggle("is-visible", visibleProducts.length === 0);

  visibleProducts.forEach((product) => {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    renderProductImage(card.querySelector(".product-image"), product);
    card.querySelector("h3").textContent = product.name;
    card.querySelector("p").textContent  = product.description;
    card.querySelector(".cost").textContent = `עלות ייצור: ${formatCurrency(product.cost)}`;
    renderStlLink(card, product);
    renderProductBadges(card, product);
    renderProductFacts(card, product);

    const orderBtn = card.querySelector("button");
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
    catalogGrid.append(card);
  });
}

// ── Orders table (admin view) ─────────────────────────────────

const PAST_STATUSES = new Set(["completed", "cancelled"]);

function buildOrderRow(order) {
  const product = findProduct(order.productId);
  const user = store.users.find((candidate) =>
    candidate.id === order.userId || candidate.name === order.friendName);
  const recipientName = user?.fullName || order.friendName;
  const orderName = product?.name || order.requestDescription || "הבקשה שלך";
  const amount = Number(order.finalAmount ?? order.price);
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${escapeHtml(order.friendName)}</td>
    <td>${escapeHtml(product?.name ?? (order.requestDescription ? order.requestDescription : "בקשה מיוחדת"))}
      ${order.orderType && order.orderType !== "catalog"
        ? `<span class="status-badge status-pending">${escapeHtml(ORDER_TYPE_LABELS[order.orderType] ?? order.orderType)}</span>`
        : ""}
    </td>
    <td>${order.quantity}</td>
    <td>${formatCurrency(amount)}</td>
    <td></td>
    <td></td>
    <td></td>
  `;

  const statusSelect = document.createElement("select");
  ORDER_STATUS_SEQUENCE.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = STATUS_LABELS[value] ?? value;
    option.selected = order.status === value;
    statusSelect.append(option);
  });
  statusSelect.addEventListener("change", async () => {
    const previous = order.status;
    const next = statusSelect.value;
    let cancellationReason;
    if (next === "cancelled") {
      const reason = window.prompt("סיבת הביטול (תוצג ללקוח):");
      if (reason === null || !reason.trim()) { statusSelect.value = previous; return; }
      cancellationReason = reason.trim();
    }
    order.status = next;
    render();
    try {
      const updated = await api(`/api/orders?id=${encodeURIComponent(order.id)}`, {
        method: "PUT",
        body: JSON.stringify({ status: next, cancellationReason }),
      });
      Object.assign(order, updated);
      render();
    } catch (err) {
      order.status = previous;
      render();
      alert(`שגיאה בעדכון סטטוס: ${err.message}`);
    }
  });

  const paidLabel = document.createElement("label");
  paidLabel.className = "paid-toggle";
  paidLabel.innerHTML = `<input type="checkbox" ${order.paid ? "checked" : ""} /> שולם`;
  paidLabel.querySelector("input").addEventListener("change", async (event) => {
    order.paid = event.target.checked;
    render();
    try {
      await api(`/api/orders?id=${encodeURIComponent(order.id)}`, {
        method: "PUT",
        body: JSON.stringify({ paid: order.paid }),
      });
    } catch { /* paid already updated locally */ }
  });

  const detailsBtn = document.createElement("button");
  detailsBtn.className   = "ghost-button btn-sm";
  detailsBtn.type        = "button";
  detailsBtn.textContent = "פרטים ומחיר";

  const deleteBtn = document.createElement("button");
  deleteBtn.className   = "ghost-button btn-sm user-delete-btn order-delete-btn";
  deleteBtn.type        = "button";
  deleteBtn.textContent = "מחק";
  deleteBtn.title       = "מחק הזמנה";
  deleteBtn.setAttribute("aria-label", `מחק הזמנה של ${order.friendName}`);
  deleteBtn.addEventListener("click", () => deleteOrder(order.id));

  const actions = document.createElement("div");
  actions.className = "whatsapp-actions";
  actions.append(detailsBtn);
  actions.append(createWhatsAppLink({
    phone: user?.phone,
    message: whatsappTemplates.status({
      name: recipientName,
      product: orderName,
      status: order.status,
    }),
    label: "עדכון בוואטסאפ",
    className: "btn-sm",
  }));

  if (Number.isFinite(amount) && amount > 0) {
    actions.append(createWhatsAppLink({
      phone: user?.phone,
      message: whatsappTemplates.priceApproval({
        name: recipientName,
        product: orderName,
        amount: amount.toFixed(2),
      }),
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
  actions.append(deleteBtn);

  row.children[4].append(statusSelect);
  row.children[5].append(paidLabel);
  row.children[6].append(actions);

  const detailRow = buildOrderDetailRow(order);
  detailsBtn.addEventListener("click", () => {
    detailRow.hidden = !detailRow.hidden;
    detailsBtn.textContent = detailRow.hidden ? "פרטים ומחיר" : "סגירה";
  });

  return [row, detailRow];
}

function buildOrderDetailRow(order) {
  const detailRow = document.createElement("tr");
  detailRow.className = "user-edit-row";
  detailRow.hidden = true;

  const cell = document.createElement("td");
  cell.colSpan = 7;

  const readOnlyBits = [];
  if (order.requestDescription) readOnlyBits.push(`<div><strong>בקשה:</strong> ${escapeHtml(order.requestDescription)}</div>`);
  if (order.externalModelLink) readOnlyBits.push(`<div><strong>קישור:</strong> <a href="${escapeHtml(order.externalModelLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(order.externalModelLink)}</a></div>`);
  if (order.selectedColors?.length) readOnlyBits.push(`<div><strong>צבעים:</strong> ${escapeHtml(order.selectedColors.join(", "))}</div>`);
  if (order.userNotes) readOnlyBits.push(`<div><strong>הערות לקוח:</strong> ${escapeHtml(order.userNotes)}</div>`);
  if (order.cancellationReason) readOnlyBits.push(`<div><strong>סיבת ביטול:</strong> ${escapeHtml(order.cancellationReason)}</div>`);

  cell.innerHTML = `
    ${readOnlyBits.length ? `<div class="order-detail-readonly">${readOnlyBits.join("")}</div>` : ""}
    <form class="user-edit-form order-price-form">
      <div class="user-edit-fields">
        <label>עלות בסיס (₪)<input name="baseCost" type="number" min="0" step="0.01" value="${order.baseCost ?? ""}" /></label>
        <label>תוספת תמיכה (₪)<input name="supportAmount" type="number" min="0" step="0.01" value="${order.supportAmount ?? 0}" /></label>
        <label>סכום סופי (₪)<input name="finalAmount" type="number" min="0" step="0.01" value="${order.finalAmount ?? ""}" /></label>
        <label class="checkbox-label"><input name="requiresUserPriceApproval" type="checkbox" style="width:auto" ${order.requiresUserPriceApproval ? "checked" : ""} /> נדרש אישור מחיר מהלקוח</label>
        <label>הערות מנהל (פנימי)<textarea name="adminNotes" rows="2">${escapeHtml(order.adminNotes ?? "")}</textarea></label>
      </div>
      <div class="user-edit-actions">
        <button class="primary-button btn-sm" type="submit">שמירה</button>
      </div>
    </form>
  `;

  cell.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      baseCost: fd.get("baseCost") === "" ? null : Number(fd.get("baseCost")),
      supportAmount: Number(fd.get("supportAmount")) || 0,
      finalAmount: fd.get("finalAmount") === "" ? null : Number(fd.get("finalAmount")),
      adminNotes: String(fd.get("adminNotes") ?? "").trim(),
      requiresUserPriceApproval: fd.get("requiresUserPriceApproval") !== null,
    };
    try {
      const updated = await api(`/api/orders?id=${encodeURIComponent(order.id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      Object.assign(order, updated);
      render();
    } catch (err) {
      alert(`שגיאה בשמירת פרטי הזמנה: ${err.message}`);
    }
  });

  detailRow.append(cell);
  return detailRow;
}

function renderOrders() {
  const ordersTable     = document.querySelector("#orders-table");
  const pastOrdersTable = document.querySelector("#past-orders-table");
  if (!ordersTable) return;

  const openOrders = store.orders.filter((o) => !PAST_STATUSES.has(o.status));
  const pastOrders = store.orders.filter((o) => PAST_STATUSES.has(o.status));

  // Badge on the orders tab for unreviewed (new) orders
  const newOrdersBadge = document.querySelector("#new-orders-badge");
  if (newOrdersBadge) {
    const count = openOrders.filter((o) => o.status === "new").length;
    newOrdersBadge.textContent = count || "";
    newOrdersBadge.hidden = count === 0;
  }

  ordersTable.replaceChildren();
  document.querySelector("#orders-empty")
    ?.classList.toggle("is-visible", openOrders.length === 0);
  openOrders.forEach((order) => ordersTable.append(...buildOrderRow(order)));

  if (pastOrdersTable) {
    pastOrdersTable.replaceChildren();
    document.querySelector("#past-orders-empty")
      ?.classList.toggle("is-visible", pastOrders.length === 0);
    pastOrders.forEach((order) => pastOrdersTable.append(...buildOrderRow(order)));
  }
}

// ── Items stats table (admin view) ───────────────────────────

function renderItemStats() {
  const tbody = document.querySelector("#items-table-body");
  if (!tbody) return;

  tbody.replaceChildren();
  document.querySelector("#items-empty")
    ?.classList.toggle("is-visible", store.products.length === 0);

  store.products.forEach((product) => {
    const orders    = store.orders.filter((o) => o.productId === product.id);
    const completed = orders.filter((o) => o.status === "completed").length;
    const revenue   = orders.reduce((s, o) => s + o.price, 0);
    const cogs      = orders.reduce((s, o) => s + Number(product.cost) * o.quantity, 0);
    const profit    = revenue - cogs;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td></td>
      <td>${escapeHtml(product.name)}</td>
      <td class="stat-cell">${formatCurrency(product.cost)}</td>
      <td class="stat-cell stat-muted">${product.grams}g</td>
      <td class="stat-cell">${orders.length}</td>
      <td class="stat-cell stat-completed">${completed}</td>
      <td class="stat-cell stat-revenue">${formatCurrency(revenue)}</td>
      <td class="stat-cell stat-muted">${formatCurrency(cogs)}</td>
      <td class="stat-cell ${profit >= 0 ? "stat-positive" : "stat-negative"}">${formatCurrency(profit)}</td>
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

function getUserOrderStats(userName) {
  const orders  = store.orders.filter((o) => o.friendName === userName);
  const revenue = orders.reduce((s, o) => s + o.price, 0);
  const paid    = orders.reduce((s, o) => (o.paid ? s + o.price : s), 0);
  const cogs    = orders.reduce((s, o) => {
    const p = findProduct(o.productId);
    return s + (p ? Number(p.cost) * o.quantity : 0);
  }, 0);
  return { count: orders.length, revenue, paid, debt: revenue - paid, profit: revenue - cogs };
}

function renderUsersAdmin() {
  const active   = store.users.filter((u) => u.status === "active");
  const pending  = store.users.filter((u) => u.status === "pending");
  const inactive = store.users.filter((u) => u.status === "inactive");
  const rejected = store.users.filter((u) => u.status === "rejected");

  const count = pending.length;
  [document.querySelector("#pending-tab-badge"), document.querySelector("#pending-sub-badge")]
    .forEach((el) => { if (el) el.textContent = count || ""; });

  // ── Active users ──────────────────────────────────────────
  const activeTable = document.querySelector("#active-users-table");
  if (activeTable) {
    activeTable.replaceChildren();
    const activeList = [...active, ...inactive, ...rejected];
    document.querySelector("#active-users-empty")
      ?.classList.toggle("is-visible", activeList.length === 0);

    activeList.forEach((user) => {
      const stats = getUserOrderStats(user.name);

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
        <td>${escapeHtml(user.email ?? "")}</td>
        <td class="stat-cell">${stats.count}</td>
        <td class="stat-cell stat-revenue">${formatCurrency(stats.revenue)}</td>
        <td class="stat-cell">${formatCurrency(stats.paid)}</td>
        <td class="stat-cell ${stats.debt > 0 ? "stat-negative" : "stat-muted"}">${formatCurrency(stats.debt)}</td>
        <td class="stat-cell ${stats.profit >= 0 ? "stat-positive" : "stat-negative"}">${formatCurrency(stats.profit)}</td>
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
        markPaidBtn.addEventListener("click", () => markUserOrdersPaid(user.name));
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
      editCell.colSpan = 9;
      editCell.innerHTML = `
        <form class="user-edit-form">
          <div class="user-edit-fields">
            <label>שם משתמש<input name="name" value="${escapeHtml(user.name)}" required /></label>
            <label>שם מלא<input name="fullName" value="${escapeHtml(user.fullName ?? "")}" /></label>
            <label>אימייל<input name="email" type="email" value="${escapeHtml(user.email ?? "")}" /></label>
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

      const form = editCell.querySelector("form");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const status = fd.get("status");
        const payload = {
          name:     fd.get("name"),
          fullName: fd.get("fullName"),
          email:    fd.get("email"),
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
        <td>${escapeHtml(user.email ?? "")}</td>
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
      rejectBtn.addEventListener("click", () => promptReject(user.id));

      const deleteBtn = document.createElement("button");
      deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
      deleteBtn.type        = "button";
      deleteBtn.textContent = "מחק";
      deleteBtn.addEventListener("click", () => deleteUser(user.id));

      cell.append(whatsappBtn, approveBtn, rejectBtn, deleteBtn);
      pendingTable.append(row);
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
    const card = document.createElement("article");
    card.className = "store-edit-card";

    // ── Image section ──────────────────────────────────────
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

    const overlay = document.createElement("div");
    overlay.className = "store-edit-image-overlay";
    const changeImgBtn = document.createElement("button");
    changeImgBtn.className = "ghost-button";
    changeImgBtn.type = "button";
    changeImgBtn.textContent = "שנה תמונה";
    changeImgBtn.addEventListener("click", () => {
      const url = window.prompt("קישור לתמונה:", product.image ?? "");
      if (url !== null) updateProduct(product.id, { image: url.trim() });
    });
    overlay.append(changeImgBtn);
    imageWrap.append(overlay);

    // ── Card body ──────────────────────────────────────────
    const body = document.createElement("div");
    body.className = "store-edit-body";

    const nameInput = document.createElement("input");
    nameInput.className = "store-edit-name";
    nameInput.value = product.name;
    nameInput.placeholder = "שם מוצר";
    nameInput.addEventListener("change", () => updateProduct(product.id, { name: nameInput.value.trim() }));
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });

    const costRow = document.createElement("div");
    costRow.className = "store-edit-row";
    const costInput = document.createElement("input");
    costInput.type = "number"; costInput.min = "0.01"; costInput.step = "0.01";
    costInput.value = product.cost;
    costInput.addEventListener("change", () => {
      const val = Math.max(Number(costInput.value) || 0.01, 0.01);
      updateProduct(product.id, { cost: val });
    });
    costInput.addEventListener("keydown", (e) => { if (e.key === "Enter") costInput.blur(); });
    const costLabel = document.createElement("span");
    costLabel.textContent = "עלות: ₪";
    costRow.append(costLabel, costInput);

    const gramsRow = document.createElement("div");
    gramsRow.className = "store-edit-row";
    const gramsInput = document.createElement("input");
    gramsInput.type = "number"; gramsInput.min = "1"; gramsInput.step = "1";
    gramsInput.value = product.grams;
    gramsInput.addEventListener("change", () => {
      const val = Math.max(Number(gramsInput.value) || 1, 1);
      updateProduct(product.id, { grams: val });
    });
    gramsInput.addEventListener("keydown", (e) => { if (e.key === "Enter") gramsInput.blur(); });
    const gramsLabel = document.createElement("span");
    gramsLabel.textContent = "גרם: ";
    gramsRow.append(gramsLabel, gramsInput);

    const descInput = document.createElement("textarea");
    descInput.className = "store-edit-desc";
    descInput.value = product.description;
    descInput.rows = 3;
    descInput.placeholder = "תיאור המוצר";
    descInput.addEventListener("change", () => updateProduct(product.id, { description: descInput.value.trim() }));

    // ── Card footer ────────────────────────────────────────
    const footer = document.createElement("div");
    footer.className = "store-edit-footer";

    const stlInput = document.createElement("input");
    stlInput.type = "url";
    stlInput.className = "store-edit-stl";
    stlInput.value = product.stlUrl ?? "";
    stlInput.placeholder = "קישור STL";
    stlInput.addEventListener("change", () => updateProduct(product.id, { stlUrl: stlInput.value.trim() }));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost-button";
    deleteBtn.type = "button";
    deleteBtn.textContent = "מחיקה";
    deleteBtn.addEventListener("click", () => deleteProduct(product.id));

    // Active toggle
    const activeLabel    = document.createElement("label");
    activeLabel.className = "store-edit-active-toggle";
    const activeCheckbox = document.createElement("input");
    activeCheckbox.type    = "checkbox";
    activeCheckbox.checked = product.active !== false;
    activeCheckbox.addEventListener("change", () => updateProduct(product.id, { active: activeCheckbox.checked }));
    activeLabel.append(activeCheckbox, " פעיל");

    // Edit-details button (wired in app.js via window.openProductEditForm)
    const editDetailsBtn = document.createElement("button");
    editDetailsBtn.className   = "ghost-button btn-sm";
    editDetailsBtn.type        = "button";
    editDetailsBtn.textContent = "ערוך פרטים";
    editDetailsBtn.addEventListener("click", () => {
      if (typeof window.openProductEditForm === "function") window.openProductEditForm(product);
    });

    footer.append(activeLabel, stlInput, editDetailsBtn, deleteBtn);
    body.append(nameInput, costRow, gramsRow, descInput, footer);
    card.classList.toggle("store-edit-card--inactive", product.active === false);
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

// ── Summary strip (admin view) ────────────────────────────────

function renderSummary() {
  const summaryOrders = document.querySelector("#summary-orders");
  const summaryDebt   = document.querySelector("#summary-debt");
  if (!summaryOrders || !summaryDebt) return;

  const openOrders = store.orders.filter((o) => !o.paid).length;
  const totalDebt  = store.orders.reduce((sum, o) => sum + (o.paid ? 0 : o.price), 0);
  summaryOrders.textContent = openOrders;
  summaryDebt.textContent   = formatCurrency(totalDebt);
}

// ── Overview cards (admin dashboard) ──────────────────────────

const OVERVIEW_ORDER_CARDS = [
  { key: "new",              label: "הזמנות חדשות",        filter: (o) => o.status === "new" },
  { key: "waiting_approval", label: "ממתינות לאישור לקוח", filter: (o) => o.status === "waiting_approval" },
  { key: "waiting_print",    label: "ממתינות להדפסה",      filter: (o) => o.status === "waiting_print" },
  { key: "printing",         label: "בהדפסה עכשיו",        filter: (o) => o.status === "printing" },
  { key: "ready_delivery",   label: "מוכנות למסירה",       filter: (o) => o.status === "ready_delivery" },
  { key: "unpaid",           label: "הזמנות לא שולמו",     filter: (o) => !o.paid && o.status !== "cancelled" },
];

function renderOverview() {
  const grid = document.querySelector("#overview-grid");
  if (!grid) return;

  grid.replaceChildren();

  OVERVIEW_ORDER_CARDS.forEach(({ key, label, filter }) => {
    const count = store.orders.filter(filter).length;
    grid.append(buildOverviewCard(key, label, count, () => setView("orders")));
  });

  const pendingUsers = store.users.filter((u) => u.status === "pending").length;
  grid.append(buildOverviewCard("pending-users", "משתמשים ממתינים לאישור", pendingUsers, () => {
    setView("users");
    document.querySelector('.sub-tab[data-sub="pending-users"]')?.click();
  }));
}

function buildOverviewCard(key, label, count, onClick) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `overview-card overview-card-${key}${count > 0 ? " has-count" : ""}`;
  card.innerHTML = `
    <span class="overview-card-count">${count}</span>
    <span class="overview-card-label">${label}</span>
  `;
  card.addEventListener("click", onClick);
  return card;
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

async function markUserOrdersPaid(friendName) {
  const orderIds = store.orders.filter((o) => o.friendName === friendName && !o.paid).map((o) => o.id);
  if (orderIds.length === 0) return;
  if (!window.confirm(`לסמן ${orderIds.length} הזמנות של ${friendName} כשולמו?`)) return;
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

async function promptReject(userId) {
  const reason = window.prompt("סיבת הדחייה (תוצג למשתמש):");
  if (reason === null) return;
  await updateUserStatus(userId, "rejected", reason.trim());
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

  const pendingBanner = document.querySelector("#ws-pending-banner");
  if (pendingBanner) pendingBanner.hidden = store.currentUser?.status !== "pending";

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
    const title = product?.name ?? order.requestDescription ?? "בקשה מיוחדת";
    const amount = Number(order.finalAmount ?? order.price);
    const supportAmount = Number(order.supportAmount) || 0;

    const div = document.createElement("div");
    div.className = "ws-order-card";
    div.innerHTML = `
      <div class="ws-order-info">
        <span class="ws-order-product">${escapeHtml(title)}</span>
        <span class="ws-order-meta">כמות ${order.quantity} · לתשלום ${formatCurrency(amount)}</span>
        ${supportAmount > 0 ? `<span class="ws-order-meta">כולל ${formatCurrency(supportAmount)} פרגון — תודה! 💛</span>` : ""}
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

    container.append(div);
  });
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
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="color-swatch" style="background:${escapeHtml(f.colorHex)}"></span></td>
      <td>${escapeHtml(f.name)}</td>
      <td>${escapeHtml(f.materialType ?? '')}</td>
      <td>${formatCurrency(f.pricePerKg)}/ק״ג</td>
      <td class="actions-cell"></td>
    `;

    const cell = row.querySelector(".actions-cell");

    const editBtn = document.createElement("button");
    editBtn.className   = "ghost-button btn-sm";
    editBtn.type        = "button";
    editBtn.textContent = "ערוך";
    editBtn.addEventListener("click", () => openFilamentEditForm(f));

    const deleteBtn = document.createElement("button");
    deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
    deleteBtn.type        = "button";
    deleteBtn.textContent = "מחק";
    deleteBtn.addEventListener("click", () => deleteFilament(f.id));

    cell.append(editBtn, " ", deleteBtn);
    tbody.append(row);
  });
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
  form.elements["pricePerKg"].value  = f.pricePerKg;
  form.elements["note"].value        = f.note ?? "";
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Pricing settings form (admin view) ───────────────────────

function renderPricingForm() {
  const form = document.querySelector("#pricing-form");
  if (!form || !store.pricingSettings) return;
  const s = store.pricingSettings;

  if (form.elements.electricityPerHour)
    form.elements.electricityPerHour.value = s.electricityPerHour ?? "";

  ["regular", "ams", "complex"].forEach((p) => {
    const prof = s.printProfiles?.[p] ?? {};
    if (form.elements[`${p}_wearPerHour`])  form.elements[`${p}_wearPerHour`].value  = prof.wearPerHour  ?? "";
    if (form.elements[`${p}_fixedWear`])    form.elements[`${p}_fixedWear`].value    = prof.fixedWear    ?? "";
    if (form.elements[`${p}_riskPercent`])  form.elements[`${p}_riskPercent`].value  = prof.riskPercent  ?? "";
  });
}
