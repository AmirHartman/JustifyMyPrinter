import { api } from "./api.js";
import { store, pageName, loadData } from "./state.js";
import { render } from "./render.js";
import { openOrderDialog, updateOrderMinimum, getOrderFriendName } from "./orders.js";
import { setAuthPanel, showRegisterError, showRegisterPending, showLoginStatus, applyAuth, applyMode, setView } from "./auth.js";
import { formatCurrency, createAiProductDraft } from "./utils.js";

// ── DOM references ────────────────────────────────────────────
const loginForm     = document.querySelector("#login-form");
const loginError    = document.querySelector("#login-error");
const registerForm  = document.querySelector("#register-form");
const registerError = document.querySelector("#register-error");
const orderDialog   = document.querySelector("#order-dialog");
const orderForm     = document.querySelector("#order-form");
const productForm   = document.querySelector("#product-form");
const aiProductIdea = document.querySelector("#ai-product-idea");

// ── Auth panel ────────────────────────────────────────────────
document.querySelectorAll(".auth-mode-button").forEach((button) => {
  button.addEventListener("click", () => setAuthPanel(button.dataset.authTarget));
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(loginForm);

  let result;
  try {
    result = await api("/api/auth", {
      method: "POST",
      body: JSON.stringify({
        action: "login",
        name: String(data.get("loginName") ?? "").trim(),
        password: data.get("password"),
      }),
    });
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.add("is-visible");
    return;
  }

  if (result.status === "pending" || result.status === "rejected") {
    loginForm.reset();
    showLoginStatus(result.status, result.reason);
    return;
  }

  loginError.classList.remove("is-visible");
  loginForm.reset();
  store.currentUser = result;
  store.appMode = store.currentUser.role === "admin" ? "admin" : "friend";

  if (store.currentUser.role === "friend") {
    window.location.href = "welcome.html";
    return;
  }

  document.body.dataset.entry = "app";
  applyAuth();
  applyMode();
  await loadData();
  setView("product-list");
  render();
});

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data            = new FormData(registerForm);
  const name            = String(data.get("name") ?? "").trim();
  const fullName        = String(data.get("fullName") ?? "").trim();
  const email           = String(data.get("email") ?? "").trim();
  const password        = String(data.get("password") ?? "");
  const confirmPassword = String(data.get("confirmPassword") ?? "");

  if (name.length < 2)             { showRegisterError("שם משתמש צריך להיות לפחות שני תווים."); return; }
  if (fullName.length < 2)         { showRegisterError("נא להזין שם מלא."); return; }
  if (!email.includes("@"))        { showRegisterError("נא להזין כתובת אימייל תקינה."); return; }
  if (password.length < 4)         { showRegisterError("הסיסמה צריכה להיות לפחות 4 תווים."); return; }
  if (password !== confirmPassword) { showRegisterError("הסיסמאות לא תואמות."); return; }

  let result;
  try {
    result = await api("/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "register", name, fullName, email, password, confirmPassword }),
    });
  } catch (err) {
    showRegisterError(err.message);
    return;
  }

  registerForm.reset();
  showRegisterPending(fullName, email);
});

document.querySelector("#logout-button")?.addEventListener("click", async () => {
  if (orderDialog?.open) orderDialog.close();

  try {
    await api("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) });
  } catch { /* ignore */ }

  store.currentUser = null;
  store.appMode = "friend";

  if (pageName !== "app") {
    window.location.href = "dashboard.html";
    return;
  }

  document.body.dataset.entry = "login";
  applyAuth();
  setView("landing");
});

// ── Admin tabs ────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

document.querySelector("#reset-demo")?.addEventListener("click", async () => {
  await loadData();
  render();
});

// ── Order dialog ──────────────────────────────────────────────
document.querySelector(".close-button")?.addEventListener("click", () => orderDialog?.close());
document.querySelector("#cancel-order")?.addEventListener("click", () => orderDialog?.close());
orderForm?.quantity?.addEventListener("input", updateOrderMinimum);

orderForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data    = new FormData(orderForm);
  const product = store.products.find((p) => p.id === data.get("productId"));
  if (!product) return;

  const quantity = Number(data.get("quantity"));
  const price    = Number(data.get("price"));
  const minimum  = product.cost * quantity;

  if (Math.round(price * 100) < Math.round(minimum * 100)) {
    orderForm.price.setCustomValidity(`המינימום להזמנה הזו הוא ${formatCurrency(minimum)}`);
    orderForm.reportValidity();
    return;
  }
  orderForm.price.setCustomValidity("");

  try {
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        productId:  product.id,
        friendName: getOrderFriendName(data),
        quantity,
        price,
      }),
    });
    store.orders.unshift(order);
    render();
    orderDialog.close();
    setView(store.appMode === "admin" ? "orders" : "catalog");
  } catch (err) {
    alert(`שגיאה ביצירת הזמנה: ${err.message}`);
  }
});

// ── Product form (admin) ──────────────────────────────────────
document.querySelector("#ai-draft-button")?.addEventListener("click", () => {
  const draft = createAiProductDraft(aiProductIdea.value);
  productForm.elements["name"].value        = draft.name;
  productForm.elements["cost"].value        = draft.cost;
  productForm.elements["grams"].value       = draft.grams;
  productForm.elements["description"].value = draft.description;
  productForm.elements["image"].value       = draft.image;
  productForm.elements["stlUrl"].value      = draft.stlUrl;
});

productForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(productForm);

  try {
    const product = await api("/api/products", {
      method: "POST",
      body: JSON.stringify({
        name:        String(data.get("name") ?? "").trim(),
        cost:        data.get("cost"),
        grams:       data.get("grams"),
        description: String(data.get("description") ?? "").trim(),
        image:       String(data.get("image") ?? "").trim(),
        stlUrl:      String(data.get("stlUrl") ?? "").trim(),
      }),
    });
    store.products.push(product);
    productForm.reset();
    render();
    setView("product-list");
  } catch (err) {
    alert(`שגיאה בהוספת מוצר: ${err.message}`);
  }
});

// ── Boot ──────────────────────────────────────────────────────
(async function init() {
  try {
    store.currentUser = await api("/api/auth");
    store.appMode = store.currentUser?.role === "admin" ? "admin" : "friend";
  } catch {
    store.currentUser = null;
    store.appMode = "friend";
  }

  applyAuth();
  applyMode();

  if (["catalog", "welcome"].includes(pageName) && !store.currentUser) {
    window.location.href = "dashboard.html";
    return;
  }
  if (store.currentUser?.role === "friend" && pageName === "app") {
    window.location.href = "welcome.html";
    return;
  }
  if (store.currentUser?.role === "admin" && pageName === "welcome") {
    window.location.href = "dashboard.html";
    return;
  }

  // Admin visiting catalog.html is forced into friend mode so they see the friend UI.
  // Set this before loadData so orders are not fetched needlessly on that page.
  if (pageName === "catalog" && store.currentUser?.role === "admin") {
    store.appMode = "friend";
    applyMode();
  }

  if (store.currentUser && ["app", "catalog"].includes(pageName)) {
    try {
      await loadData();
    } catch (err) {
      console.error("Failed to load data:", err);
    }
  }

  if (pageName === "app" && store.currentUser) {
    document.body.dataset.entry = "app";
  }

  setView(store.appMode === "admin" ? "product-list" : "catalog");
  render();
})();
