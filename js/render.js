import { store, loadData, findProduct } from "./state.js";
import { formatCurrency, escapeHtml, calculateProductCost } from "./utils.js";
import { api } from "./api.js";
import { openOrderDialog } from "./orders.js";

const STATUS_LABELS = {
  new:       "חדש",
  approved:  "אושר - ממתין להדפסה",
  printing:  "בהדפסה",
  ready:     "מוכן",
  delivered: "נמסר",
  rejected:  "נדחה",
};

const USER_STATUS_LABELS = {
  pending:  "ממתין לאישור",
  approved: "מאושר",
  rejected: "נדחה",
};

// ── Public entry point ────────────────────────────────────────

export function render() {
  renderCatalog();
  renderOrders();
  renderItemStats();
  renderUsersAdmin();
  renderStoreEdit();
  renderSummary();
  renderInbox();
  renderWelcome();
  renderAdminMessages();
  renderFilaments();
  renderPricingForm();
}

// ── Catalog (friend view) ─────────────────────────────────────

function renderCatalog() {
  const catalogGrid  = document.querySelector("#catalog-grid");
  const cardTemplate = document.querySelector("#product-card-template");
  if (!catalogGrid || !cardTemplate) return;

  const visibleProducts = store.appMode === "admin"
    ? store.products
    : store.products.filter((p) => p.active !== false);

  catalogGrid.replaceChildren();
  visibleProducts.forEach((product) => {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    renderProductImage(card.querySelector(".product-image"), product);
    card.querySelector("h3").textContent = product.name;
    card.querySelector("p").textContent  = product.description;
    card.querySelector(".cost").textContent = `עלות ייצור: ${formatCurrency(product.cost)}`;
    renderStlLink(card, product);
    card.querySelector("button").addEventListener("click", () => openOrderDialog(product.id));
    catalogGrid.append(card);
  });
}

// ── Orders table (admin view) ─────────────────────────────────

function renderOrders() {
  const ordersTable = document.querySelector("#orders-table");
  if (!ordersTable) return;
  const pastOrdersTable = document.querySelector("#past-orders-table");
  const isPastOrder = (order) => ["delivered", "rejected"].includes(order.status);
  const openOrders = store.orders.filter((order) => !isPastOrder(order));
  const pastOrders = store.orders.filter(isPastOrder);

  // Badge on the orders tab for unreviewed (new) orders
  const newOrdersBadge = document.querySelector("#new-orders-badge");
  if (newOrdersBadge) {
    const count = store.orders.filter((o) => o.status === "new").length;
    newOrdersBadge.textContent = count || "";
    newOrdersBadge.hidden = count === 0;
  }

  ordersTable.replaceChildren();
  document.querySelector("#orders-empty")
    ?.classList.toggle("is-visible", openOrders.length === 0);
  if (pastOrdersTable) {
    pastOrdersTable.replaceChildren();
    document.querySelector("#past-orders-empty")
      ?.classList.toggle("is-visible", pastOrders.length === 0);
  }

  const renderOrderRows = (orders, table, allowDelete) => orders.forEach((order) => {
    const product = findProduct(order.productId);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(order.friendName)}</td>
      <td>${escapeHtml(product?.name ?? "מוצר שנמחק")}</td>
      <td>${order.quantity}</td>
      <td>${formatCurrency(order.price)}</td>
      <td></td>
      <td></td>
      <td></td>
    `;

    const statusSelect = document.createElement("select");
    Object.entries(STATUS_LABELS).forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = order.status === value;
      statusSelect.append(option);
    });
    statusSelect.addEventListener("change", async () => {
      order.status = statusSelect.value;
      render();
      try {
        await api(`/api/orders/${order.id}`, {
          method: "PUT",
          body: JSON.stringify({ status: order.status }),
        });
      } catch { /* status already updated locally */ }
    });

    const paidLabel = document.createElement("label");
    paidLabel.className = "paid-toggle";
    paidLabel.innerHTML = `<input type="checkbox" ${order.paid ? "checked" : ""} /> שולם`;
    paidLabel.querySelector("input").addEventListener("change", async (event) => {
      order.paid = event.target.checked;
      render();
      try {
        await api(`/api/orders/${order.id}`, {
          method: "PUT",
          body: JSON.stringify({ paid: order.paid }),
        });
      } catch { /* paid already updated locally */ }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className   = "ghost-button btn-sm user-delete-btn order-delete-btn";
    deleteBtn.type        = "button";
    deleteBtn.textContent = allowDelete ? "מחק" : "✕";
    deleteBtn.title       = "מחק הזמנה";
    deleteBtn.addEventListener("click", () => deleteOrder(order.id));

    row.children[4].append(statusSelect);
    row.children[5].append(paidLabel);
    row.children[6].append(deleteBtn);
    table.append(row);
  });

  renderOrderRows(openOrders, ordersTable, false);
  if (pastOrdersTable) renderOrderRows(pastOrders, pastOrdersTable, true);
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
    const completed = orders.filter((o) => o.status === "delivered").length;
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
  const approved = store.users.filter((u) => u.status === "approved");
  const pending  = store.users.filter((u) => u.status === "pending");
  const rejected = store.users.filter((u) => u.status === "rejected");

  const count = pending.length;
  [document.querySelector("#pending-tab-badge"), document.querySelector("#pending-sub-badge")]
    .forEach((el) => { if (el) el.textContent = count || ""; });

  // ── Active users ──────────────────────────────────────────
  const activeTable = document.querySelector("#active-users-table");
  if (activeTable) {
    activeTable.replaceChildren();
    const activeList = [...approved, ...rejected];
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
          ${user.role === "admin" ? `<span class="status-badge status-approved">מנהל</span>` : ""}
          ${user.status === "rejected" ? `<span class="status-badge status-rejected">${USER_STATUS_LABELS.rejected}</span>` : ""}
        </td>
        <td>${escapeHtml(user.fullName ?? "")}</td>
        <td>${escapeHtml(user.email ?? "")}</td>
        <td class="pwd-cell">
          <div class="pwd-cell-inner">
            <span class="pwd-dots">••••••</span>
            <span class="pwd-text" hidden>${escapeHtml(user.password ?? "")}</span>
            <button class="ghost-button btn-sm pwd-toggle" type="button">הצג</button>
          </div>
        </td>
        <td class="stat-cell">${stats.count}</td>
        <td class="stat-cell stat-revenue">${formatCurrency(stats.revenue)}</td>
        <td class="stat-cell">${formatCurrency(stats.paid)}</td>
        <td class="stat-cell ${stats.debt > 0 ? "stat-negative" : "stat-muted"}">${formatCurrency(stats.debt)}</td>
        <td class="stat-cell ${stats.profit >= 0 ? "stat-positive" : "stat-negative"}">${formatCurrency(stats.profit)}</td>
        <td class="actions-cell"></td>
      `;

      // Password toggle
      const toggle = row.querySelector(".pwd-toggle");
      const dots   = row.querySelector(".pwd-dots");
      const text   = row.querySelector(".pwd-text");
      toggle.addEventListener("click", () => {
        const showing  = !text.hidden;
        dots.hidden    = !showing;
        text.hidden    = showing;
        toggle.textContent = showing ? "הצג" : "הסתר";
      });

      // Edit / Delete buttons
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

      actionsCell.append(editBtn, " ", deleteBtn);

      // ── Edit row (hidden by default) ──────────────────────
      const editRow = document.createElement("tr");
      editRow.className = "user-edit-row";
      editRow.hidden    = true;

      const ROLE_OPTIONS = `
        <option value="friend">לקוח</option>
        <option value="admin">מנהל</option>
      `;
      const STATUS_OPTIONS = `
        <option value="approved">מאושר</option>
        <option value="rejected">נדחה</option>
      `;

      const editCell = document.createElement("td");
      editCell.colSpan = 10;
      editCell.innerHTML = `
        <form class="user-edit-form">
          <div class="user-edit-fields">
            <label>שם משתמש<input name="name" value="${escapeHtml(user.name)}" required /></label>
            <label>שם מלא<input name="fullName" value="${escapeHtml(user.fullName ?? "")}" /></label>
            <label>אימייל<input name="email" type="email" value="${escapeHtml(user.email ?? "")}" /></label>
            <label>סיסמה<input name="password" value="${escapeHtml(user.password ?? "")}" /></label>
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
      editCell.querySelector("[name=status]").value = user.status ?? "approved";

      const form = editCell.querySelector("form");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        await saveUserEdit(user.id, {
          name:     fd.get("name"),
          fullName: fd.get("fullName"),
          email:    fd.get("email"),
          password: fd.get("password"),
          role:     fd.get("role"),
          status:   fd.get("status"),
        });
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

      const approveBtn = document.createElement("button");
      approveBtn.className   = "primary-button btn-sm";
      approveBtn.type        = "button";
      approveBtn.textContent = "אשר";
      approveBtn.addEventListener("click", () => updateUserStatus(user.id, "approved"));

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

      cell.append(approveBtn, " ", rejectBtn, " ", deleteBtn);
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

// ── Product interactions ──────────────────────────────────────

async function updateProduct(productId, updates) {
  const product = findProduct(productId);
  if (!product) return;

  Object.assign(product, updates);
  render();

  try {
    await api(`/api/products/${productId}`, {
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
    await api(`/api/products/${productId}`, { method: "DELETE" });
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
    await api(`/api/orders/${orderId}`, { method: "DELETE" });
    store.orders = store.orders.filter((o) => o.id !== orderId);
    render();
  } catch (err) {
    alert(`שגיאה במחיקת הזמנה: ${err.message}`);
  }
}

// ── User interactions ─────────────────────────────────────────────

async function saveUserEdit(userId, updates) {
  try {
    const updated = await api(`/api/users/${userId}`, {
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
    await api(`/api/users/${userId}`, { method: "DELETE" });
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
    const updated = await api(`/api/users/${userId}`, {
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

  const open = store.myOrders.filter((o) => !["delivered", "rejected"].includes(o.status));
  const past = store.myOrders.filter((o) => ["delivered", "rejected"].includes(o.status));

  const openCount = document.querySelector("#ws-open-count");
  if (openCount) {
    openCount.textContent = open.length || "";
    openCount.hidden = open.length === 0;
  }

  renderWsOrderList(document.querySelector("#ws-open-orders"), open, "אין לך הזמנות פתוחות כרגע");
  renderWsOrderList(document.querySelector("#ws-past-orders"), past, "אין לך הזמנות שהסתיימו עדיין");
  renderWsNotifications();
  renderWsChat();
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
    const div = document.createElement("div");
    div.className = "ws-order-card";
    div.innerHTML = `
      <div class="ws-order-info">
        <span class="ws-order-product">${escapeHtml(product?.name ?? "מוצר")}</span>
        <span class="ws-order-meta">כמות ${order.quantity} · ₪${order.price}</span>
      </div>
      <div class="ws-order-right">
        <span class="ws-status-chip ws-status-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABELS[order.status] ?? order.status)}</span>
        ${order.paid
          ? '<span class="ws-paid-chip">שולם ✓</span>'
          : '<span class="ws-unpaid-chip">ממתין לתשלום</span>'}
      </div>
    `;
    container.append(div);
  });
}

function renderWsNotifications() {
  const list = document.querySelector("#ws-notif-list");
  if (!list) return;
  list.replaceChildren();
  if (store.notifications.length === 0) {
    const li = document.createElement("li");
    li.className = "ws-notif-empty";
    li.textContent = "אין עדכונים";
    list.append(li);
    return;
  }
  store.notifications.slice(0, 15).forEach((n) => {
    const li = document.createElement("li");
    li.className = `ws-notif-item${n.read ? "" : " unread"}`;
    const msg = document.createElement("span");
    msg.textContent = n.message;
    const time = document.createElement("time");
    time.textContent = new Date(n.createdAt).toLocaleDateString("he-IL");
    li.append(msg, time);
    list.append(li);
  });
}

function renderWsChat() {
  const thread = document.querySelector("#ws-chat-thread");
  if (!thread) return;
  thread.replaceChildren();
  if (store.messages.length === 0) {
    const p = document.createElement("p");
    p.className = "ws-empty";
    p.textContent = "עדיין אין הודעות — שלח משהו 👋";
    thread.append(p);
  } else {
    store.messages.forEach((msg) => buildChatBubble(thread, msg.sender, msg.content, msg.createdAt));
    thread.scrollTop = thread.scrollHeight;
  }
}

function buildChatBubble(container, sender, content, createdAt) {
  const isAdmin = sender === "admin";
  const div = document.createElement("div");
  div.className = `chat-bubble ${isAdmin ? "chat-bubble-admin" : "chat-bubble-user"}`;
  const p = document.createElement("p");
  p.textContent = content;
  const time = document.createElement("time");
  time.className = "chat-time";
  time.textContent = new Date(createdAt).toLocaleString("he-IL", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  div.append(p, time);
  container.append(div);
}

// ── Admin messages view ───────────────────────────────────────

function renderAdminMessages() {
  const convList = document.querySelector("#conversations-list");
  if (!convList) return;

  document.querySelector("#messages-empty")
    ?.classList.toggle("is-visible", store.conversations.length === 0);

  const unreadTotal = store.conversations.filter((c) => c.unreadCount > 0).length;
  const badge = document.querySelector("#messages-badge");
  if (badge) {
    badge.textContent = unreadTotal || "";
    badge.hidden = unreadTotal === 0;
  }

  convList.replaceChildren();
  store.conversations.forEach((conv) => {
    const card = document.createElement("div");
    card.className = `conv-card${conv.unreadCount > 0 ? " conv-unread" : ""}`;
    card.innerHTML = `
      <div class="conv-info">
        <strong class="conv-user">${escapeHtml(conv.userName)}</strong>
        <span class="conv-preview">${escapeHtml(conv.latestMessage)}</span>
      </div>
      <div class="conv-meta">
        ${conv.unreadCount > 0 ? `<span class="conv-badge">${conv.unreadCount}</span>` : ""}
        <span class="conv-time">${new Date(conv.createdAt).toLocaleDateString("he-IL")}</span>
      </div>
    `;
    card.addEventListener("click", () => openAdminConversation(conv.userName));
    convList.append(card);
  });
}

async function openAdminConversation(userName) {
  const threadPanel = document.querySelector("#admin-thread-panel");
  const threadEl    = document.querySelector("#admin-chat-thread");
  const nameEl      = document.querySelector("#thread-user-name");
  if (!threadPanel || !threadEl) return;

  if (nameEl) nameEl.textContent = userName;
  threadPanel.hidden = false;

  try {
    const messages = await api(`/api/messages?user=${encodeURIComponent(userName)}`);
    const conv = store.conversations.find((c) => c.userName === userName);
    if (conv) conv.unreadCount = 0;
    renderAdminMessages();

    store._activeThread = { userName, messages };
    refreshAdminThread(threadEl, messages);

    // Wire reply form fresh each time (clone removes old listeners)
    const oldForm = document.querySelector("#admin-chat-form");
    if (oldForm) {
      const newForm = oldForm.cloneNode(true);
      oldForm.parentNode.replaceChild(newForm, oldForm);
      newForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const textarea = e.target.elements.content;
        const content  = textarea.value.trim();
        if (!content) return;
        const btn = e.target.querySelector("[type=submit]");
        btn.disabled = true;
        try {
          const msg = await api("/api/messages", {
            method: "POST",
            body: JSON.stringify({ content, userName }),
          });
          store._activeThread.messages.push(msg);
          textarea.value = "";
          refreshAdminThread(threadEl, store._activeThread.messages);
        } catch (err) {
          alert(`שגיאה: ${err.message}`);
        } finally {
          btn.disabled = false;
        }
      });
    }
  } catch (err) {
    alert(`שגיאה בטעינת השיחה: ${err.message}`);
  }
}

function refreshAdminThread(container, messages) {
  container.replaceChildren();
  if (messages.length === 0) {
    const p = document.createElement("p");
    p.className = "ws-empty";
    p.textContent = "עדיין אין הודעות בשיחה זו.";
    container.append(p);
    return;
  }
  messages.forEach((msg) => buildChatBubble(container, msg.sender, msg.content, msg.createdAt));
  container.scrollTop = container.scrollHeight;
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
    await api(`/api/filaments/${filamentId}`, { method: "DELETE" });
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

// ── Inbox / notifications ─────────────────────────────────────

function renderInbox() {
  const unread = store.notifications.filter((n) => !n.read).length;

  const badge = document.querySelector("#inbox-badge");
  if (badge) {
    badge.textContent = unread || "";
    badge.hidden = unread === 0;
  }

  const list = document.querySelector("#inbox-list");
  if (!list) return;
  list.replaceChildren();

  if (store.notifications.length === 0) {
    const li = document.createElement("li");
    li.className = "inbox-empty";
    li.textContent = "אין עדכונים להצגה";
    list.append(li);
    return;
  }

  store.notifications.forEach((notif) => {
    const li = document.createElement("li");
    li.className = `inbox-item${notif.read ? "" : " unread"}`;
    const msg = document.createElement("span");
    msg.className = "inbox-msg";
    msg.textContent = notif.message;
    const time = document.createElement("span");
    time.className = "inbox-time";
    time.textContent = new Date(notif.createdAt).toLocaleDateString("he-IL");
    li.append(msg, time);
    list.append(li);
  });
}
