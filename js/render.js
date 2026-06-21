import { store, loadData, findProduct, getProductOrderedQuantity } from "./state.js";
import { formatCurrency, escapeHtml } from "./utils.js";
import { api } from "./api.js";
import { openOrderDialog } from "./orders.js";

const STATUS_LABELS = {
  new:       "חדש",
  printing:  "בהדפסה",
  ready:     "מוכן",
  delivered: "נמסר",
};

// ── Public entry point ────────────────────────────────────────

export function render() {
  renderCatalog();
  renderOrders();
  renderDebts();
  renderProducts();
  renderUsers();
  renderSummary();
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

// ── Debts grid (admin view) ───────────────────────────────────

function renderDebts() {
  const debtGrid = document.querySelector("#debt-grid");
  if (!debtGrid) return;

  debtGrid.replaceChildren();
  const debts = store.orders.reduce((totals, order) => {
    if (!order.paid) {
      totals[order.friendName] = (totals[order.friendName] ?? 0) + order.price;
    }
    return totals;
  }, {});

  const entries = Object.entries(debts).sort((a, b) => b[1] - a[1]);
  document.querySelector("#debts-empty")
    ?.classList.toggle("is-visible", entries.length === 0);

  entries.forEach(([friendName, total]) => {
    const card = document.createElement("article");
    card.className = "debt-card";
    card.innerHTML = `<strong>${escapeHtml(friendName)}</strong><span>${formatCurrency(total)}</span>`;
    debtGrid.append(card);
  });
}

// ── Products table (admin view) ───────────────────────────────

function renderProducts() {
  const productsTable = document.querySelector("#products-table");
  if (!productsTable) return;

  productsTable.replaceChildren();
  document.querySelector("#products-empty")
    ?.classList.toggle("is-visible", store.products.length === 0);

  store.products.forEach((product) => {
    const row = document.createElement("tr");
    row.className = "product-edit-row";

    const imageCell = document.createElement("td");
    const thumb = document.createElement("div");
    thumb.className = "product-thumb";
    renderProductImage(thumb, product);
    imageCell.append(thumb);

    const nameCell = document.createElement("td");
    nameCell.append(createEditableInput(product, "name", "text"));

    const orderedCell = document.createElement("td");
    orderedCell.className = "ordered-count";
    orderedCell.textContent = getProductOrderedQuantity(product.id);

    const costCell = document.createElement("td");
    costCell.append(createEditableInput(product, "cost", "number"));

    const gramsCell = document.createElement("td");
    gramsCell.append(createEditableInput(product, "grams", "number"));

    const descriptionCell = document.createElement("td");
    const descriptionInput = document.createElement("textarea");
    descriptionInput.value = product.description;
    descriptionInput.rows = 3;
    descriptionInput.addEventListener("change", () =>
      updateProduct(product.id, { description: descriptionInput.value.trim() })
    );
    descriptionCell.append(descriptionInput);

    const imageUrlCell = document.createElement("td");
    imageUrlCell.append(createEditableInput(product, "image", "text"));

    const stlCell = document.createElement("td");
    stlCell.append(createEditableInput(product, "stlUrl", "url"));

    const actionsCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.className = "ghost-button";
    deleteButton.type = "button";
    deleteButton.textContent = "מחיקה";
    deleteButton.addEventListener("click", () => deleteProduct(product.id));
    actionsCell.append(deleteButton);

    row.append(imageCell, nameCell, orderedCell, costCell, gramsCell, descriptionCell, imageUrlCell, stlCell, actionsCell);
    productsTable.append(row);
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

// ── Users table (admin view) ──────────────────────────────────

const USER_STATUS_LABELS = {
  pending:  "ממתין לאישור",
  approved: "מאושר",
  rejected: "נדחה",
};

function renderUsers() {
  const usersTable = document.querySelector("#users-table");
  if (!usersTable) return;

  usersTable.replaceChildren();
  document.querySelector("#users-empty")
    ?.classList.toggle("is-visible", store.users.length === 0);

  store.users.forEach((user) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(user.name)}</td>
      <td><span class="status-badge status-${user.status}">${USER_STATUS_LABELS[user.status] ?? user.status}</span></td>
      <td>${new Date(user.createdAt).toLocaleDateString("he-IL")}</td>
      <td></td>
    `;

    if (user.status === "pending") {
      const actionsCell = row.children[3];
      const approveBtn = document.createElement("button");
      approveBtn.className = "primary-button";
      approveBtn.type = "button";
      approveBtn.textContent = "אשר";
      approveBtn.addEventListener("click", () => updateUserStatus(user.id, "approved"));

      const rejectBtn = document.createElement("button");
      rejectBtn.className = "ghost-button";
      rejectBtn.type = "button";
      rejectBtn.textContent = "דחה";
      rejectBtn.addEventListener("click", () => updateUserStatus(user.id, "rejected"));

      actionsCell.append(approveBtn, " ", rejectBtn);
    }

    usersTable.append(row);
  });
}

async function updateUserStatus(userId, status) {
  try {
    await api(`/api/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
    const user = store.users.find((u) => u.id === userId);
    if (user) user.status = status;
    render();
  } catch (err) {
    alert(`שגיאה בעדכון משתמש: ${err.message}`);
  }
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
  if (!product.stlUrl) { stlLink.remove(); return; }
  stlLink.href = product.stlUrl;
}

// ── Product table interactions ────────────────────────────────

function createEditableInput(product, field, type) {
  const input = document.createElement("input");
  input.type  = type;
  input.value = product[field] ?? "";

  if (field === "cost")  { input.min = 0.01; input.step = 0.01; }
  if (field === "grams") { input.min = 1;    input.step = 1;    }

  input.addEventListener("change", () => {
    const value =
      field === "cost"  ? Math.max(Number(input.value) || 0.01, 0.01) :
      field === "grams" ? Math.max(Number(input.value) || 1, 1) :
      input.value.trim();
    updateProduct(product.id, { [field]: value });
  });

  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });

  return input;
}

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
