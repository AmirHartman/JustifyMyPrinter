import { store, loadData, findProduct } from "./state.js";
import { formatCurrency, escapeHtml } from "./utils.js";
import { api } from "./api.js";
import { openOrderDialog } from "./orders.js";

const STATUS_LABELS = {
  new:       "חדש",
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
}

// ── Catalog (friend view) ─────────────────────────────────────

function renderCatalog() {
  const catalogGrid  = document.querySelector("#catalog-grid");
  const cardTemplate = document.querySelector("#product-card-template");
  if (!catalogGrid || !cardTemplate) return;

  catalogGrid.replaceChildren();
  store.products.forEach((product) => {
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

  // Badge on the orders tab for unreviewed (new) orders
  const newOrdersBadge = document.querySelector("#new-orders-badge");
  if (newOrdersBadge) {
    const count = store.orders.filter((o) => o.status === "new").length;
    newOrdersBadge.textContent = count || "";
    newOrdersBadge.hidden = count === 0;
  }

  ordersTable.replaceChildren();
  document.querySelector("#orders-empty")
    ?.classList.toggle("is-visible", store.orders.length === 0);

  store.orders.forEach((order) => {
    const product = findProduct(order.productId);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(order.friendName)}</td>
      <td>${escapeHtml(product?.name ?? "מוצר שנמחק")}</td>
      <td>${order.quantity}</td>
      <td>${formatCurrency(order.price)}</td>
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

    row.children[4].append(statusSelect);
    row.children[5].append(paidLabel);
    ordersTable.append(row);
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

    footer.append(stlInput, deleteBtn);
    body.append(nameInput, costRow, gramsRow, descInput, footer);
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
  container.replaceChildren();
  container.classList.toggle("has-image", Boolean(product.image));
  if (!product.image) return;
  const img = document.createElement("img");
  img.src = product.image;
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
