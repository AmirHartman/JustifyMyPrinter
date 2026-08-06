import { api } from "./api.js";
import { store, pageName, loadData } from "./state.js";
import { render } from "./render.js";
import {
  openOrderDialog, updateReviewCosts, openCustomOrderDialog,
  goToStep, getOrderOptions, describeAddedLine,
} from "./orders.js";
import { addLine, addTip, resetTip, clearCart, checkoutPayload } from "./cart.js";
import { setAuthPanel, showRegisterError, showRegisterPending, showLoginStatus, applyAuth, applyMode, setView, viewFromHash } from "./auth.js";
import { formatCurrency, calculateProductCost, composeFilamentName } from "./utils.js";

// ── DOM references ────────────────────────────────────────────
const loginForm     = document.querySelector("#login-form");
const loginError    = document.querySelector("#login-error");
const registerForm  = document.querySelector("#register-form");
const registerError = document.querySelector("#register-error");
const orderDialog   = document.querySelector("#order-dialog");
const orderForm     = document.querySelector("#order-form");
const productForm   = document.querySelector("#product-form");
const orderDrawer   = document.querySelector("#order-drawer");
const DEFAULT_RISK_PERCENT_BY_LEVEL = Object.freeze({ low: 0.08, medium: 0.15, high: 0.25, untested: 0.35 });
let productFormDirty = false;

function riskPercentFromForm() {
  const level = productForm?.elements["riskLevel"]?.value ?? "medium";
  const configured = store.pricingSettings?.riskPercentByLevel ?? store.pricingSettings?.riskPercents;
  return Number(configured?.[level] ?? DEFAULT_RISK_PERCENT_BY_LEVEL[level] ?? DEFAULT_RISK_PERCENT_BY_LEVEL.medium);
}

function riskLevelFromPercent(value) {
  const risk = Number(value);
  if (risk <= 0.1) return "low";
  if (risk >= 0.2) return "high";
  return "medium";
}

function activateSubTab(subName) {
  document.querySelector(`.sub-tab[data-sub="${subName}"]`)?.click();
}

// ── Auth panel ────────────────────────────────────────────────
document.querySelectorAll(".auth-mode-button").forEach((button) => {
  button.addEventListener("click", () => setAuthPanel(button.dataset.authTarget));
});

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data       = new FormData(loginForm);
  const submitBtn  = loginForm.querySelector("[type=submit]");
  const origLabel  = submitBtn.textContent;

  loginError.classList.remove("is-visible");
  submitBtn.disabled    = true;
  submitBtn.textContent = "מתחבר...";

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
    submitBtn.disabled    = false;
    submitBtn.textContent = origLabel;
    return;
  }

  loginError.classList.remove("is-visible");
  loginForm.reset();
  store.currentUser = result;
  store.appMode = store.currentUser.role === "admin" ? "admin" : "friend";

  window.location.href = result.role === "admin" ? "dashboard.html" : "welcome.html";
});

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data                = new FormData(registerForm);
  const name                = String(data.get("name") ?? "").trim();
  const fullName            = String(data.get("fullName") ?? "").trim();
  const phone               = String(data.get("phone") ?? "").trim();
  const gender              = String(data.get("gender") ?? "").trim();
  const howYouKnowAdmin     = String(data.get("howYouKnowAdmin") ?? "").trim();
  const registrationMessage = String(data.get("registrationMessage") ?? "").trim();
  const password            = String(data.get("password") ?? "");
  const confirmPassword     = String(data.get("confirmPassword") ?? "");

  if (name.length < 2)             { showRegisterError("שם משתמש צריך להיות לפחות שני תווים."); return; }
  if (fullName.length < 2)         { showRegisterError("נא להזין שם מלא."); return; }
  if (phone.length < 7)            { showRegisterError("נא להזין מספר טלפון תקין."); return; }
  if (!["male", "female"].includes(gender)) { showRegisterError("נא לבחור מגדר."); return; }
  if (password.length < 4)         { showRegisterError("הסיסמה צריכה להיות לפחות 4 תווים."); return; }
  if (password !== confirmPassword) { showRegisterError("הסיסמאות לא תואמות."); return; }

  const submitBtn = registerForm.querySelector("[type=submit]");
  const origLabel = submitBtn.textContent;
  submitBtn.disabled    = true;
  submitBtn.textContent = "שולח...";

  let result;
  try {
    result = await api("/api/auth", {
      method: "POST",
      body: JSON.stringify({
        action: "register", name, fullName, phone, gender, howYouKnowAdmin, registrationMessage,
        password, confirmPassword,
      }),
    });
  } catch (err) {
    showRegisterError(err.message);
    submitBtn.disabled    = false;
    submitBtn.textContent = origLabel;
    return;
  }

  registerForm.reset();
  showRegisterPending(fullName);
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

// ── Global admin navigation ───────────────────────────────────
(() => {
  const menus = [...document.querySelectorAll(".admin-nav-menu")];
  const compactNav = window.matchMedia("(max-width: 1119px)");

  const setMenuOpen = (menu, open, { restoreFocus = false } = {}) => {
    const toggle = document.querySelector(`.admin-nav-toggle[aria-controls="${menu.id}"]`);
    const isOpen = !compactNav.matches || open;
    menu.hidden = !isOpen;
    toggle?.setAttribute("aria-expanded", isOpen && compactNav.matches ? "true" : "false");
    if (restoreFocus) toggle?.focus();
  };

  const syncMenusForViewport = () => menus.forEach((menu) => setMenuOpen(menu, false));
  syncMenusForViewport();
  compactNav.addEventListener("change", syncMenusForViewport);

  menus.forEach((menu) => {
    const toggle = document.querySelector(`.admin-nav-toggle[aria-controls="${menu.id}"]`);
    if (!toggle) return;

    toggle.addEventListener("click", () => setMenuOpen(menu, menu.hidden));
    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => setMenuOpen(menu, false));
    });
  });

  document.addEventListener("click", (event) => {
    if (!compactNav.matches) return;
    menus.forEach((menu) => {
      const toggle = document.querySelector(`.admin-nav-toggle[aria-controls="${menu.id}"]`);
      if (!menu.hidden && !menu.contains(event.target) && !toggle?.contains(event.target)) {
        setMenuOpen(menu, false);
      }
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !compactNav.matches) return;
    menus.forEach((menu) => {
      if (!menu.hidden) setMenuOpen(menu, false, { restoreFocus: true });
    });
  });
})();

// ── Sub-tabs (scoped to the enclosing view, so several views can each
// ── have their own independent group of sub-tabs) ──────────────
document.querySelectorAll(".sub-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.sub;
    const scope  = btn.closest(".view");
    if (!scope) return;
    scope.querySelectorAll(".sub-tab").forEach((t) => t.classList.toggle("is-active", t === btn));
    scope.querySelectorAll(".sub-view").forEach((v) => v.classList.toggle("is-active", v.id === `${target}-sub`));
  });
});

document.querySelector("#reset-demo")?.addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "מרענן...";
  try {
    await loadData();
    render();
    syncPricingRiskFields();
    btn.textContent = "✓ המחירים עודכנו";
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = origLabel; }, 1400);
  }
});

// ── Notification bell (top bar) ───────────────────────────────
// The panel's contents + row navigation are built in render.js; here we only
// handle opening/closing the dropdown. Rows live inside #notif-panel.
(() => {
  const bell  = document.querySelector("#notif-bell");
  const panel = document.querySelector("#notif-panel");
  if (!bell || !panel) return;

  const setOpen = (open) => {
    panel.hidden = !open;
    bell.setAttribute("aria-expanded", open ? "true" : "false");
  };

  bell.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(panel.hidden);
  });

  // Close on outside click or Escape.
  document.addEventListener("click", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !bell.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  });
})();

// ── Order dialog ──────────────────────────────────────────────
orderDialog?.querySelector(".close-button")?.addEventListener("click", () => orderDialog.close());
document.querySelector("#cancel-order")?.addEventListener("click", () => orderDialog?.close());
orderForm?.quantity?.addEventListener("input", updateReviewCosts);

orderForm?.querySelectorAll("[data-wizard-back]").forEach((button) => {
  button.addEventListener("click", () => goToStep(button.dataset.wizardBack));
});

document.querySelector("#continue-shopping")?.addEventListener("click", () => {
  orderDialog?.close();
});
document.querySelector("#go-to-cart")?.addEventListener("click", () => {
  window.location.href = "cart.html";
});

// Nothing is ordered here — the choice is recorded in the browser and the whole
// cart is sent once, from cart.html. The form's own validation still gates it,
// so a missing colour or quantity is caught before anything is stored.
orderForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data    = new FormData(orderForm);
  const product = store.products.find((p) => p.id === data.get("productId"));
  if (!product) return;

  addLine({
    productId: product.id,
    quantity: Number(data.get("quantity")),
    selectedColors: getOrderOptions().selectedColors,
  });

  const summary = document.querySelector("#added-to-cart-summary");
  if (summary) summary.textContent = describeAddedLine();
  goToStep("added");
  render();
});

// ── Cart page ─────────────────────────────────────────────────
document.querySelectorAll("[data-tip-add]").forEach((button) => {
  button.addEventListener("click", () => { addTip(Number(button.dataset.tipAdd)); render(); });
});
document.querySelector("#tip-reset")?.addEventListener("click", () => { resetTip(); render(); });

document.querySelector("#checkout-button")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const errorBox = document.querySelector("#cart-error");
  const payload = checkoutPayload();
  errorBox?.classList.remove("is-visible");
  if (payload.items.length === 0) return;

  // The whole cart is one request, so the button must not be able to fire twice
  // and create the order set twice.
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "שולח…";
  let orders;
  try {
    orders = await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = `שגיאה ביצירת ההזמנה: ${err.message}`;
      errorBox.classList.add("is-visible");
    }
    button.disabled = false;
    button.textContent = originalLabel;
    return;
  }

  // The orders exist from here on. Nothing below may make a failure look like
  // the checkout did not happen.
  clearCart();
  store.myOrders.unshift(...orders);
  const contents = document.querySelector("#cart-contents");
  const thanks   = document.querySelector("#cart-thanks");
  const summary  = document.querySelector("#cart-thanks-summary");
  if (summary) {
    const units = orders.reduce((sum, order) => sum + (Number(order.quantity) || 0), 0);
    summary.textContent = `נקלטו ${orders.length} מוצרים (${units} יחידות) בהזמנה אחת.`;
  }
  if (contents) contents.hidden = true;
  if (thanks) thanks.hidden = false;
  try {
    render();
  } catch (err) {
    // The orders already exist. A browser-specific repaint failure must not be
    // reported as a failed checkout and tempt the customer to submit it again.
    console.error("Cart checked out, but the UI refresh failed:", err);
  }
});

// ── Custom / external-link order dialog ────────────────────────
const customOrderDialog = document.querySelector("#custom-order-dialog");
const customOrderForm   = document.querySelector("#custom-order-form");
const customOrderError  = document.querySelector("#custom-order-error");

document.querySelectorAll("[data-open-custom-order]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!store.currentUser) { window.location.href = "dashboard.html"; return; }
    const eligible = store.currentUser.role === "admin" || store.currentUser.status === "active";
    if (!eligible) { alert("רק חברים פעילים יכולים להזמין. מחכים לאישור המנהל."); return; }
    openCustomOrderDialog();
  });
});

document.querySelectorAll("[data-close-custom-order]").forEach((btn) => {
  btn.addEventListener("click", () => customOrderDialog?.close());
});

customOrderForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(customOrderForm);
  const color = String(data.get("selectedColor") ?? "").trim();

  customOrderError.classList.remove("is-visible");
  try {
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        orderType: "external_link",
        externalModelLink: String(data.get("externalModelLink") ?? "").trim(),
        requestDescription: String(data.get("requestDescription") ?? "").trim(),
        userNotes: String(data.get("userNotes") ?? "").trim(),
        selectedColors: color ? [color] : [],
        quantity: Number(data.get("quantity")) || 1,
      }),
    });
    store.myOrders.unshift(order);
    customOrderDialog.close();
    window.location.href = "welcome.html";
  } catch (err) {
    customOrderError.textContent = err.message;
    customOrderError.classList.add("is-visible");
  }
});

// ── Global feedback / bug-report widget (injected on every page) ─
// There is no shared-chrome include, but app.js loads on every page, so we
// inject the launcher button + dialog once here. Name/phone fields show only
// when signed out; for logged-in users the server fills identity from the account.
(function setupFeedbackWidget() {
  if (document.querySelector("#feedback-fab")) return;

  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <button type="button" id="feedback-fab" class="feedback-fab" aria-haspopup="dialog" aria-label="דיווח על תקלה או הצעה לשיפור">
      <span aria-hidden="true">💬</span><span class="feedback-fab-text">דיווח / הצעה</span>
    </button>
    <dialog id="feedback-dialog" class="feedback-dialog" aria-labelledby="feedback-dialog-title">
      <form method="dialog" class="order-form" id="feedback-form">
        <button class="icon-button close-button" type="button" data-close-feedback aria-label="סגירה">×</button>
        <h2 id="feedback-dialog-title">דיווח על תקלה / הצעה לשיפור</h2>
        <fieldset class="feedback-kind">
          <legend>סוג הפנייה</legend>
          <label class="feedback-radio"><input type="radio" name="kind" value="bug" checked /> באג / תקלה</label>
          <label class="feedback-radio"><input type="radio" name="kind" value="improvement" /> הצעה לשיפור</label>
        </fieldset>
        <label>תיאור
          <textarea name="message" required rows="4" placeholder="ספרו לנו מה קרה או מה תרצו לשפר"></textarea>
        </label>
        <div class="feedback-contact-fields">
          <label>שם
            <input type="text" name="name" autocomplete="name" placeholder="השם שלך" />
          </label>
          <label>טלפון
            <input type="tel" name="phone" autocomplete="tel" placeholder="050-1234567" />
          </label>
        </div>
        <p class="form-error" id="feedback-error"></p>
        <p class="feedback-success" id="feedback-success" hidden>תודה! הפנייה נשלחה.</p>
        <menu>
          <button class="ghost-button" type="button" data-close-feedback>ביטול</button>
          <button class="primary-button" type="submit">שליחה</button>
        </menu>
      </form>
    </dialog>
  `,
  );

  const dialog  = document.querySelector("#feedback-dialog");
  const form    = document.querySelector("#feedback-form");
  const errorEl = document.querySelector("#feedback-error");
  const okEl    = document.querySelector("#feedback-success");

  document.querySelector("#feedback-fab").addEventListener("click", () => {
    form.reset();
    errorEl.classList.remove("is-visible");
    okEl.hidden = true;
    dialog.showModal();
  });

  document.querySelectorAll("[data-close-feedback]").forEach((btn) =>
    btn.addEventListener("click", () => dialog.close()),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const signedOut = document.body.dataset.auth === "signed-out";
    errorEl.classList.remove("is-visible");

    const payload = {
      kind: String(data.get("kind") || "bug"),
      message: String(data.get("message") ?? "").trim(),
      page: document.body.dataset.page || location.pathname,
    };
    // Name/phone are only relevant (and required) for signed-out visitors;
    // the server ignores them for logged-in users.
    if (signedOut) {
      payload.name = String(data.get("name") ?? "").trim();
      payload.phone = String(data.get("phone") ?? "").trim();
      if (!payload.name || !payload.phone) {
        errorEl.textContent = "יש למלא שם וטלפון.";
        errorEl.classList.add("is-visible");
        return;
      }
    }

    try {
      await api("/api/feedback", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      okEl.hidden = false;
      setTimeout(() => { okEl.hidden = true; dialog.close(); }, 1400);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.add("is-visible");
    }
  });
})();

// ── Product form (admin) ──────────────────────────────────────
productForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data      = new FormData(productForm);
  const editId    = String(data.get("editProductId") ?? "").trim();
  const isEdit    = Boolean(editId);

  const materials = collectMaterialRows();
  const images    = collectImageRows();
  const possibleColors = collectColorOptions("possible");
  const requiredColors = collectColorOptions("required");

  // If the legacy single-image field is filled but no gallery images added, treat it as gallery main image
  const legacyImage = String(data.get("image") ?? "").trim();
  if (legacyImage && images.length === 0) {
    images.push({ url: legacyImage, isMain: true });
  }
  const mainImageUrl = images.find((i) => i.isMain)?.url ?? images[0]?.url ?? legacyImage;

  const payload = {
    name:               String(data.get("name") ?? "").trim(),
    cost:               data.get("cost"),
    grams:              data.get("grams"),
    description:        String(data.get("description") ?? "").trim(),
    image:              mainImageUrl,
    sourceUrl:          String(data.get("sourceUrl") ?? "").trim(),
    categoryIds:        collectCategoryRows(),
    requiresAdminApproval: data.get("requiresAdminApproval") !== null,
    printHours:         Number(data.get("printHours")) || 0,
    printProfile:       String(data.get("printProfile") ?? "regular"),
    purgeGrams:         Number(data.get("purgeGrams")) || 0,
    riskLevel:          String(data.get("riskLevel") ?? "medium"),
    riskPercent:        riskPercentFromForm(),
    minUnitPrice:       data.get("minUnitPrice") === "" ? null : Number(data.get("minUnitPrice")),
    materials,
    images,
    catalogKind:        String(data.get("catalogKind") ?? "printed"),
    possibleColors,
    requiredColors,
    allowMultiple:      data.get("allowMultiple") !== null,
    internalPrintNotes: String(data.get("internalPrintNotes") ?? "").trim(),
    printFileUrl:       String(data.get("printFileUrl") ?? "").trim(),
    printFileName:      String(data.get("printFileName") ?? "").trim(),
    printFileChecksum:  String(data.get("printFileChecksum") ?? "").trim(),
    printFileUploadedAt: String(data.get("printFileUploadedAt") ?? "").trim() || null,
    manualPriceEnabled: data.get("manualPriceEnabled") !== null,
    manualPrice:        data.get("manualPriceEnabled") !== null ? Number(data.get("manualPrice")) || null : null,
    calculatedCost:     computedCostFromForm(),
  };
  // No coercion here: an idea with print data is priced and orderable, and the
  // approval checkbox stays whatever the admin set. The server still requires
  // approval for a product that has no price to show (api/products.js).
  payload.grams = materials.reduce((sum, material) => sum + Number(material.grams || 0), 0) + payload.purgeGrams;

  // Resolve effective cost
  if (payload.manualPriceEnabled && payload.manualPrice) {
    payload.cost = payload.manualPrice;
  } else if (payload.calculatedCost) {
    payload.cost = payload.calculatedCost;
  }

  try {
    if (isEdit) {
      const updated = await api(`/api/products?id=${encodeURIComponent(editId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const idx = store.products.findIndex((p) => p.id === editId);
      if (idx !== -1) store.products[idx] = updated;
      productFormDirty = false;
      resetProductForm();
      render();
      closeProductEditor();
    } else {
      const product = await api("/api/products", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      store.products.push(product);
      productFormDirty = false;
      resetProductForm();
      render();
      closeProductEditor();
    }
  } catch (err) {
    alert(`שגיאה ב${isEdit ? "עדכון" : "הוספת"} מוצר: ${err.message}`);
  }
});

// ── Product form helpers ──────────────────────────────────────

function collectMaterialRows() {
  const rows = document.querySelectorAll("#product-materials-rows .material-row");
  return Array.from(rows).map((row) => ({
    filamentId: row.querySelector("select")?.value ?? "",
    grams:      roundToTwoDecimals(row.querySelector("input[type='number']")?.value),
  })).filter((m) => m.filamentId);
}

function roundToTwoDecimals(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) / 100 : 0;
}

function renderCategoryCheckboxes(selectedIds = []) {
  const container = document.querySelector("#product-category-rows");
  if (!container) return;
  container.replaceChildren();

  if (store.categories.length === 0) {
    const note = document.createElement("span");
    note.style.cssText = "color:var(--muted);font-size:var(--text-sm)";
    note.textContent = "אין קטגוריות מוגדרות עדיין. אפשר להוסיף בלשונית \"קטגוריות\".";
    container.append(note);
    return;
  }

  store.categories.forEach((category) => {
    const label = document.createElement("label");
    label.className = "checkbox-label";
    const checkbox = document.createElement("input");
    checkbox.type    = "checkbox";
    checkbox.value   = category.id;
    checkbox.style.width = "auto";
    checkbox.checked = selectedIds.includes(category.id);
    label.append(checkbox, ` ${category.name}${category.active === false ? " (מושבתת)" : ""}`);
    container.append(label);
  });
}

function collectCategoryRows() {
  const boxes = document.querySelectorAll("#product-category-rows input[type='checkbox']:checked");
  return Array.from(boxes).map((box) => box.value);
}

function collectColorOptions(kind) {
  const selector = `#product-${kind}-colors input[data-color-option]:checked`;
  return Array.from(document.querySelectorAll(selector)).map((box) => box.value);
}

function renderColorOptions(possibleColors = [], requiredColors = []) {
  const selections = { possible: new Set(possibleColors), required: new Set(requiredColors) };
  for (const kind of ["possible", "required"]) {
    const container = document.querySelector(`#product-${kind}-colors`);
    if (!container) continue;
    container.replaceChildren();
    if (!store.filaments.length) {
      const note = document.createElement("span");
      note.className = "form-hint";
      note.textContent = "אין חומרים מוגדרים. אפשר להוסיף אותם בהגדרות החומרים.";
      container.append(note);
      continue;
    }
    let selectAllCheckbox = null;
    if (kind === "possible") {
      const selectAllLabel = document.createElement("label");
      selectAllLabel.className = "checkbox-label";
      selectAllCheckbox = document.createElement("input");
      selectAllCheckbox.type = "checkbox";
      selectAllCheckbox.style.width = "auto";
      selectAllCheckbox.dataset.colorSelectAll = "true";
      selectAllLabel.append(selectAllCheckbox, " בחר הכול");
      container.append(selectAllLabel);
    }
    const optionCheckboxes = [];
    store.filaments.forEach((filament) => {
      const label = document.createElement("label");
      label.className = "checkbox-label";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = filament.id;
      checkbox.dataset.colorOption = kind;
      checkbox.checked = selections[kind].has(filament.id) || selections[kind].has(filament.name);
      checkbox.style.width = "auto";
      optionCheckboxes.push(checkbox);
      const swatch = document.createElement("span");
      swatch.className = "color-swatch";
      swatch.style.background = filament.colorHex || "#ccc";
      swatch.style.border = "1px solid #777";
      label.append(checkbox, swatch, ` ${filament.name}${filament.active === false ? " (לא פעיל)" : ""}`);
      container.append(label);
    });
    if (selectAllCheckbox) {
      const updateSelectAllState = () => {
        const selectedCount = optionCheckboxes.filter((checkbox) => checkbox.checked).length;
        selectAllCheckbox.checked = selectedCount === optionCheckboxes.length;
        selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < optionCheckboxes.length;
      };
      optionCheckboxes.forEach((checkbox) => checkbox.addEventListener("change", updateSelectAllState));
      selectAllCheckbox.addEventListener("change", () => {
        optionCheckboxes.forEach((checkbox) => { checkbox.checked = selectAllCheckbox.checked; });
        selectAllCheckbox.indeterminate = false;
        productFormDirty = true;
        updateProductReadiness();
      });
      updateSelectAllState();
    }
  }
}

// The risk select stays enabled — a disabled field drops out of FormData and
// would silently rewrite risk_level — so the coercion is explained instead.
function syncUntestedRiskHint() {
  const note = document.querySelector("#product-risk-untested-note");
  if (note) note.hidden = productForm?.elements["catalogKind"]?.value !== "idea";
}

function updateProductReadiness(serverMissing = null) {
  const target = document.querySelector("#product-readiness-details");
  if (!target || !productForm) return;
  const kind = productForm.elements["catalogKind"]?.value ?? "printed";
  const materials = collectMaterialRows();
  const localChecks = [
    [String(productForm.elements["name"]?.value ?? "").trim(), "שם מוצר"],
    [String(productForm.elements["description"]?.value ?? "").trim(), "תיאור"],
    [collectImageRows().length > 0, "לפחות תמונה אחת"],
    [collectCategoryRows().length > 0, "קטגוריה פעילה"],
  ];
  // No price check: the computed cost is floored at the minimum order price and
  // is therefore never zero, so it can never fail. Mirrors api/products.js.
  if (kind === "printed") {
    localChecks.push(
      [Number(productForm.elements["printHours"]?.value) > 0, "זמן הדפסה"],
      [materials.length > 0 && materials.every((item) => item.filamentId && item.grams > 0), "חומר ומשקל חיובי"],
    );
  }
  const missing = localChecks.filter(([ready]) => !ready).map(([, label]) => label);
  if (Array.isArray(serverMissing)) {
    const labels = {
      name: "שם מוצר", description: "תיאור", image: "תמונה", category: "קטגוריה פעילה",
      printHours: "זמן הדפסה", materials: "חומר ומשקל", price: "מחיר תקין",
    };
    serverMissing.forEach((item) => {
      const key = typeof item === "string" ? item : item?.field;
      const label = labels[key] ?? (typeof item === "string" ? item : item?.label);
      if (label && !missing.includes(label)) missing.push(label);
    });
  }
  const ideaPriced = kind === "idea"
    && Number(productForm.elements["printHours"]?.value) > 0
    && materials.length > 0 && materials.every((item) => item.filamentId && item.grams > 0);
  const readyLabel = kind !== "idea"
    ? "המוצר מוכן לפרסום אוטומטי."
    : ideaPriced
      ? "הרעיון מוכן להצגה, עם מחיר לפי תעריף \"לא נוסה\"."
      : "הרעיון מוכן להצגה. בלי זמן הדפסה וחומרים הוא יוצג כ\"מחיר ייקבע לאחר בדיקה\".";
  target.innerHTML = missing.length
    ? `<p>הפריט יישמר כמוסתר עד להשלמת:</p><ul>${missing.map((item) => `<li>${item}</li>`).join("")}</ul>`
    : `<p>${readyLabel}</p>`;
}

function collectImageRows() {
  const rows = document.querySelectorAll("#product-image-rows .image-row");
  return Array.from(rows)
    .map((row) => String(row.querySelector("input[type='url']")?.value ?? "").trim())
    .filter(Boolean)
    .map((url, index) => ({ url, isMain: index === 0 }));
}

function computedCostFromForm() {
  const product = {
    printHours:   Number(document.querySelector("#product-form [name='printHours']")?.value) || 0,
    printProfile: document.querySelector("#product-form [name='printProfile']")?.value ?? "regular",
    materials:    collectMaterialRows(),
    purgeGrams: Number(document.querySelector("#product-form [name='purgeGrams']")?.value) || 0,
    additionalCopyHours: null,
    riskLevel: document.querySelector("#product-form [name='riskLevel']")?.value ?? "medium",
    riskPercent: riskPercentFromForm(),
    // An untested idea prices at its own tier, so the preview must see the kind.
    catalogKind: document.querySelector("#product-form [name='catalogKind']")?.value ?? "printed",
    minUnitPrice: document.querySelector("#product-form [name='minUnitPrice']")?.value === "" ? null : Number(document.querySelector("#product-form [name='minUnitPrice']")?.value),
  };
  if (!store.pricingSettings) return null;
  const { finalCost } = calculateProductCost(product, store.filaments, store.pricingSettings);
  return finalCost || null;
}

function resetProductForm() {
  productForm?.reset();
  document.querySelector("#edit-product-id").value = "";
  document.querySelector("#product-materials-rows").replaceChildren();
  document.querySelector("#product-image-rows").replaceChildren();
  document.querySelector("#cost-preview-before-profit").innerHTML = `<span class="form-hint">מלא זמן וחומרים כדי לראות חישוב.</span>`;
  document.querySelector("#cost-preview-after-profit").innerHTML = `<span class="form-hint">המחיר הסופי יוצג כאן.</span>`;
  document.querySelector("#manual-price-field")?.setAttribute("hidden", "");
  document.querySelector("#product-submit-btn").textContent = "הוספת מוצר";
  document.querySelector("#product-editor-title").textContent = "מוצר חדש";
  document.querySelector("#product-import-summary")?.setAttribute("hidden", "");
  const printFileStatus = document.querySelector("#print-file-status");
  if (printFileStatus) printFileStatus.textContent = "";
  renderBridgeFileOptions();
  renderCategoryCheckboxes([]);
  syncUntestedRiskHint();
  renderColorOptions([], []);
  productFormDirty = false;
  updateProductReadiness();
}

function openProductEditor() {
  activateSubTab("product-catalog");
  document.querySelector("#product-catalog-list")?.setAttribute("hidden", "");
  document.querySelector("#product-editor")?.removeAttribute("hidden");
  document.querySelector("#add-product-btn")?.setAttribute("hidden", "");
  document.querySelector("#product-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeProductEditor(force = false) {
  if (!force && productFormDirty && !confirm("יש שינויים שלא נשמרו. לצאת מהטופס?")) return false;
  productFormDirty = false;
  document.querySelector("#product-editor")?.setAttribute("hidden", "");
  document.querySelector("#product-catalog-list")?.removeAttribute("hidden");
  document.querySelector("#add-product-btn")?.removeAttribute("hidden");
  return true;
}

document.querySelector("#add-product-btn")?.addEventListener("click", () => {
  resetProductForm();
  addMaterialRow();
  addImageRow();
  openProductEditor();
});

// Exposed globally so render.js store-edit cards can call it
window.openProductEditForm = function openProductEditForm(product) {
  if (!productForm) return;
  resetProductForm();

  productForm.elements["name"].value        = product.name;
  productForm.elements["cost"].value        = product.cost;
  productForm.elements["grams"].value       = product.grams;
  productForm.elements["description"].value = product.description;
  productForm.elements["image"].value       = product.image ?? "";
  productForm.elements["sourceUrl"].value   = product.sourceUrl ?? "";
  productForm.elements["printHours"].value  = product.printHours ?? 0;
  productForm.elements["printProfile"].value = product.printProfile ?? "regular";
  productForm.elements["minUnitPrice"].value = product.minUnitPrice ?? "";
  productForm.elements["purgeGrams"].value = product.purgeGrams ?? 0;
  productForm.elements["riskLevel"].value = product.riskLevel ?? riskLevelFromPercent(product.riskPercent);
  productForm.elements["catalogKind"].value = product.catalogKind ?? "printed";
  productForm.elements["allowMultiple"].checked = product.allowMultiple !== false;
  productForm.elements["internalPrintNotes"].value = product.internalPrintNotes ?? "";
  productForm.elements["printFileUrl"].value        = product.printFileUrl ?? "";
  productForm.elements["printFileName"].value       = product.printFileName ?? "";
  productForm.elements["printFileChecksum"].value   = product.printFileChecksum ?? "";
  productForm.elements["printFileUploadedAt"].value = product.printFileUploadedAt ?? "";
  const printFileStatusEl = document.querySelector("#print-file-status");
  if (printFileStatusEl) {
    printFileStatusEl.textContent = product.printFileName
      ? `קובץ משויך: ${product.printFileName}${product.printFileChecksum ? " (מקומי בגשר)" : ""}.`
      : "";
  }
  renderBridgeFileOptions(product.printFileChecksum ?? "");
  document.querySelector("#edit-product-id").value = product.id;
  document.querySelector("#product-requires-approval").checked = Boolean(product.requiresAdminApproval);
  syncUntestedRiskHint();
  renderCategoryCheckboxes(product.categoryIds ?? []);
  renderColorOptions(product.possibleColors ?? [], product.requiredColors ?? []);

  if (product.manualPriceEnabled) {
    productForm.elements["manualPriceEnabled"].checked = true;
    document.querySelector("#manual-price-field")?.removeAttribute("hidden");
    productForm.elements["manualPrice"].value = product.manualPrice ?? "";
  }

  // Rebuild material rows
  const materialsContainer = document.querySelector("#product-materials-rows");
  materialsContainer.replaceChildren();
  if ((product.materials ?? []).length) {
    product.materials.forEach((m) => addMaterialRow(m.filamentId, m.grams));
  }

  // Rebuild image rows
  const imagesContainer = document.querySelector("#product-image-rows");
  imagesContainer.replaceChildren();
  const productImages = product.images?.length
    ? product.images.map((image) => typeof image === "string" ? { url: image, isMain: false } : { ...image })
    : product.image ? [{ url: product.image, isMain: true }] : [];
  const currentMainIndex = productImages.findIndex((image) => image.isMain || image.url === product.image);
  if (currentMainIndex > 0) productImages.unshift(...productImages.splice(currentMainIndex, 1));
  productImages.forEach((img) => addImageRow(img.url));

  document.querySelector("#product-submit-btn").textContent  = "שמור שינויים";
  document.querySelector("#product-editor-title").textContent = `עריכת מוצר: ${product.name}`;

  updateCostPreview();
  updateProductReadiness(product.missingRequirements);
  productFormDirty = false;
  openProductEditor();
};

document.querySelector("#product-editor-back")?.addEventListener("click", () => closeProductEditor());
document.querySelector("#product-editor-cancel")?.addEventListener("click", () => {
  if (closeProductEditor()) resetProductForm();
});

function bridgeFileLabel(file) {
  const filename = file.filename ?? file.fileName ?? file.printFileName ?? "קובץ ללא שם";
  const hours = Number(file.printHours || 0).toFixed(2);
  const grams = Array.isArray(file.materialGrams)
    ? file.materialGrams.reduce((sum, value) => sum + Number(value || 0), 0)
    : Number(file.materialGrams || 0);
  return `${filename} · ${hours} שעות · ${grams.toFixed(2)} גרם${file.available === false ? " (לא זמין כרגע)" : ""}`;
}

function renderBridgeFileOptions(selectedChecksum = "") {
  const select = document.querySelector("#bridge-file-select");
  if (!select) return;
  const current = selectedChecksum || select.value;
  select.replaceChildren(new Option("— בחירת קובץ שנסרק מהגשר —", ""));
  (store.bridgeFiles ?? []).forEach((file) => {
    const checksum = file.checksum ?? file.fileChecksum ?? file.printFileChecksum ?? "";
    if (!checksum) return;
    const option = new Option(bridgeFileLabel(file), checksum);
    option.disabled = file.available === false;
    option.selected = checksum === current;
    select.append(option);
  });
}

function applyBridgeFileToProduct(checksum) {
  const file = (store.bridgeFiles ?? []).find((candidate) => (candidate.checksum ?? candidate.fileChecksum ?? candidate.printFileChecksum) === checksum);
  const status = document.querySelector("#print-file-status");
  if (!file || !productForm) {
    if (status) status.textContent = "בחרו קובץ שזוהה בגשר, או השאירו ריק לטיוטה.";
    return;
  }
  productForm.elements["printHours"].value = Number(file.printHours ?? 0);
  productForm.elements["printProfile"].value = file.printProfile ?? "regular";
  productForm.elements["purgeGrams"].value = Number(file.purgeGrams ?? 0);
  productForm.elements["printFileUrl"].value = "";
  productForm.elements["printFileName"].value = file.filename ?? file.fileName ?? file.printFileName ?? "";
  productForm.elements["printFileChecksum"].value = file.checksum ?? file.fileChecksum ?? file.printFileChecksum ?? "";
  productForm.elements["printFileUploadedAt"].value = file.lastSeenAt ?? new Date().toISOString();
  const weights = Array.isArray(file.materialGrams) ? file.materialGrams : [file.materialGrams];
  document.querySelector("#product-materials-rows")?.replaceChildren();
  weights.filter((grams) => Number(grams) > 0).forEach((grams) => addMaterialRow("", grams));
  const updatedAt = file.lastSeenAt ? new Date(file.lastSeenAt).toLocaleString("he-IL") : "לא ידוע";
  if (status) status.textContent = `נבחר: ${file.filename ?? file.fileName ?? file.printFileName ?? "קובץ מקומי"}. הנתונים הטכניים עודכנו; יש לבחור פילמנט ידנית. נסרק לאחרונה: ${updatedAt}.`;
  productFormDirty = true;
  updateCostPreview();
  updateProductReadiness();
}

document.querySelector("#bridge-file-select")?.addEventListener("change", (event) => {
  applyBridgeFileToProduct(event.currentTarget.value);
});

window.addEventListener("beforeunload", (event) => {
  if (!productFormDirty || document.querySelector("#product-editor")?.hidden) return;
  event.preventDefault();
});

// ── Order drawer close ──────────────────────────────────────────
document.querySelector("#order-drawer-close")?.addEventListener("click", () => orderDrawer?.close());

// ── Material rows ─────────────────────────────────────────────
function addMaterialRow(filamentId = "", grams = "") {
  const container = document.querySelector("#product-materials-rows");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "material-row";

  const select = document.createElement("select");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— בחירת פילמנט —";
  placeholder.selected = !filamentId;
  select.append(placeholder);
  store.filaments.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = `${f.name}`;
    opt.selected = f.id === filamentId;
    select.append(opt);
  });
  if (!store.filaments.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— אין חומרים מוגדרים —";
    select.append(opt);
  }

  const swatch = document.createElement("span");
  swatch.className = "color-swatch";
  const updateSwatch = () => {
    const f = store.filaments.find((f) => f.id === select.value);
    swatch.style.background = f?.colorHex ?? "#ccc";
  };
  updateSwatch();
  select.addEventListener("change", () => {
    updateSwatch();
    autoSwitchProfileForMultiMaterial();
    updateCostPreview();
  });

  const gramsInput = document.createElement("input");
  gramsInput.type        = "number";
  gramsInput.min         = "0";
  gramsInput.step        = "0.01";
  gramsInput.placeholder = "גרם";
  gramsInput.value       = grams === "" ? "" : roundToTwoDecimals(grams).toFixed(2);
  gramsInput.addEventListener("input", () => {
    const decimalPart = gramsInput.value.split(".")[1] ?? "";
    if (decimalPart.length > 2) gramsInput.value = roundToTwoDecimals(gramsInput.value).toFixed(2);
    updateCostPreview();
  });
  gramsInput.addEventListener("blur", () => {
    if (gramsInput.value !== "") gramsInput.value = roundToTwoDecimals(gramsInput.value).toFixed(2);
    updateCostPreview();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
  deleteBtn.type        = "button";
  deleteBtn.textContent = "✕";
  deleteBtn.addEventListener("click", () => {
    row.remove();
    autoSwitchProfileForMultiMaterial();
    updateCostPreview();
  });

  row.append(swatch, select, gramsInput, deleteBtn);
  container.append(row);
  autoSwitchProfileForMultiMaterial();
  updateCostPreview();
}

document.querySelector("#add-material-row-btn")?.addEventListener("click", () => addMaterialRow());

function autoSwitchProfileForMultiMaterial() {
  const count   = document.querySelectorAll("#product-materials-rows .material-row").length;
  const select  = document.querySelector("#product-print-profile");
  if (!select) return;
  if (count > 1 && select.value === "regular") select.value = "ams";
  if (count <= 1 && select.value === "ams")   select.value = "regular";
}

// ── Image rows ────────────────────────────────────────────────
function refreshImageRowOrder() {
  const rows = Array.from(document.querySelectorAll("#product-image-rows .image-row"));
  rows.forEach((row, index) => {
    const primaryBadge = row.querySelector("[data-image-primary]");
    if (primaryBadge) primaryBadge.hidden = index !== 0;
    const moveUp = row.querySelector("[data-move-image='up']");
    const moveDown = row.querySelector("[data-move-image='down']");
    if (moveUp) moveUp.disabled = index === 0;
    if (moveDown) moveDown.disabled = index === rows.length - 1;
  });
}

function addImageRow(url = "") {
  const container = document.querySelector("#product-image-rows");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "image-row";

  const urlInput = document.createElement("input");
  urlInput.type        = "url";
  urlInput.placeholder = "https://example.com/image.jpg";
  urlInput.value       = url;
  urlInput.addEventListener("input", updateProductReadiness);

  const orderControls = document.createElement("div");
  orderControls.className = "image-order-controls";
  const primaryBadge = document.createElement("span");
  primaryBadge.className = "image-primary-badge";
  primaryBadge.dataset.imagePrimary = "true";
  primaryBadge.textContent = "ראשית";

  const moveButton = (direction, label, glyph) => {
    const button = document.createElement("button");
    button.className = "ghost-button btn-sm image-order-button";
    button.type = "button";
    button.dataset.moveImage = direction;
    button.textContent = glyph;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => {
      const sibling = direction === "up" ? row.previousElementSibling : row.nextElementSibling;
      if (!sibling) return;
      if (direction === "up") container.insertBefore(row, sibling);
      else container.insertBefore(sibling, row);
      productFormDirty = true;
      refreshImageRowOrder();
      updateProductReadiness();
    });
    return button;
  };
  const moveUp = moveButton("up", "העבר תמונה למעלה", "↑");
  const moveDown = moveButton("down", "העבר תמונה למטה", "↓");
  orderControls.append(primaryBadge, moveUp, moveDown);

  const deleteBtn = document.createElement("button");
  deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
  deleteBtn.type        = "button";
  deleteBtn.textContent = "✕";
  deleteBtn.addEventListener("click", () => {
    row.remove();
    productFormDirty = true;
    refreshImageRowOrder();
    updateProductReadiness();
  });

  row.append(urlInput, orderControls, deleteBtn);
  container.append(row);
  refreshImageRowOrder();
}

document.querySelector("#add-image-row-btn")?.addEventListener("click", () => addImageRow());

// ── Direct upload to Cloudinary ───────────────────────────────
// Server signs the request (admin-only); the file goes straight to Cloudinary,
// and the returned secure_url is added as a normal image row.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

async function uploadImageFile(file) {
  const sig = await api("/api/uploads");
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sig.apiKey);
  form.append("timestamp", sig.timestamp);
  form.append("folder", sig.folder);
  form.append("signature", sig.signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let message;
    try { message = (await res.json()).error?.message; } catch { message = res.statusText; }
    throw new Error(message || "העלאה נכשלה");
  }
  const data = await res.json();
  return data.secure_url;
}

const uploadImageBtn = document.querySelector("#upload-image-btn");
const imageFileInput = document.querySelector("#image-file-input");
uploadImageBtn?.addEventListener("click", () => imageFileInput?.click());
imageFileInput?.addEventListener("change", async () => {
  const file = imageFileInput.files?.[0];
  imageFileInput.value = ""; // allow re-selecting the same file later
  if (!file) return;
  if (file.size > MAX_UPLOAD_BYTES) {
    alert("הקובץ גדול מדי (מקסימום 10MB).");
    return;
  }

  const originalText = uploadImageBtn.textContent;
  uploadImageBtn.disabled = true;
  uploadImageBtn.textContent = "מעלה…";
  try {
    const url = await uploadImageFile(file);
    addImageRow(url);
    updateProductReadiness();
  } catch (err) {
    alert(`העלאת התמונה נכשלה: ${err.message}`);
  } finally {
    uploadImageBtn.disabled = false;
    uploadImageBtn.textContent = originalText;
  }
});

// ── Live cost preview ─────────────────────────────────────────
function updateCostPreview() {
  const beforePanel = document.querySelector("#cost-preview-before-profit");
  const afterPanel = document.querySelector("#cost-preview-after-profit");
  if (!beforePanel || !afterPanel || !store.pricingSettings) return;

  const product = {
    printHours:   Number(productForm?.elements["printHours"]?.value) || 0,
    printProfile: productForm?.elements["printProfile"]?.value ?? "regular",
    materials:    collectMaterialRows(),
    purgeGrams: Number(productForm?.elements["purgeGrams"]?.value) || 0,
    additionalCopyHours: null,
    riskLevel: productForm?.elements["riskLevel"]?.value ?? "medium",
    riskPercent: riskPercentFromForm(),
    catalogKind: productForm?.elements["catalogKind"]?.value ?? "printed",
    minUnitPrice: productForm?.elements["minUnitPrice"]?.value === "" ? null : Number(productForm?.elements["minUnitPrice"]?.value),
  };

  if (!product.printHours && !product.materials.length) {
    beforePanel.innerHTML = `<span class="form-hint">מלא זמן וחומרים כדי לראות חישוב.</span>`;
    afterPanel.innerHTML = `<span class="form-hint">המחיר הסופי יוצג כאן.</span>`;
    updateProductReadiness();
    return;
  }

  const b = calculateProductCost(product, store.filaments, store.pricingSettings);

  // Mirror the save/display logic (js/app.js submit handler, api/products.js withCurrentPrice):
  // a manual price overrides the formula-calculated price everywhere it's shown.
  const manualPriceEnabled = Boolean(productForm?.elements["manualPriceEnabled"]?.checked);
  const manualPrice = Number(productForm?.elements["manualPrice"]?.value) || null;
  const manualOverrideActive = manualPriceEnabled && manualPrice;
  const finalCost = manualOverrideActive ? manualPrice : b.finalCost;
  const marginAmount = manualOverrideActive ? manualPrice - b.costWithRisk : b.marginAmount;

  beforePanel.innerHTML = `
    <div class="cost-preview-row"><span>עלות חומרים</span><span>${formatCurrency(b.materialCost)}</span></div>
    <div class="cost-preview-row"><span>עלות חשמל</span><span>${formatCurrency(b.electricityCost)}</span></div>
    <div class="cost-preview-row"><span>בלאי ותחזוקה</span><span>${formatCurrency(b.wearCost)}</span></div>
    <div class="cost-preview-row"><span>סיכון (${Math.round(b.riskPercent * 100)}%)</span><span>${formatCurrency(b.riskCost)}</span></div>
    <div class="cost-preview-row"><span>עלות מדפסת (10%)</span><span>${formatCurrency(b.machineCost)}</span></div>
    <div class="cost-preview-final"><span>עלות ייצור לפני רווח</span><span>${formatCurrency(b.costWithRisk)}</span></div>
  `;
  afterPanel.innerHTML = `
    <div class="cost-preview-row"><span>רווח</span><span>${formatCurrency(marginAmount)}</span></div>
    <div class="cost-preview-row"><span>מינימום מוצר</span><span>${formatCurrency(b.productFloor)}</span></div>
    <div class="cost-preview-row"><span>מינימום הזמנה</span><span>${formatCurrency(b.minOrderPrice)}</span></div>
    ${manualOverrideActive ? `<div class="cost-preview-row"><span>מחיר ידני (דורס את החישוב)</span><span>${formatCurrency(manualPrice)}</span></div>` : ""}
    <div class="cost-preview-final"><span>${manualOverrideActive ? "מחיר סופי ידני" : "מחיר לאחר רווח, מעוגל מעלה"}</span><span>${formatCurrency(finalCost)}</span></div>
  `;
  updateProductReadiness();
}

// Wire live preview to form inputs (input covers number fields; change covers select)
productForm?.addEventListener("input",  (e) => {
  productFormDirty = true;
  if (e.target.matches("[name='printHours'], [name='minUnitPrice'], [name='manualPrice']")) updateCostPreview();
  else updateProductReadiness();
});
productForm?.addEventListener("change", (e) => {
  productFormDirty = true;
  if (e.target.closest("#product-required-colors") && e.target.checked) {
    const possible = document.querySelector(`#product-possible-colors input[value="${CSS.escape(e.target.value)}"]`);
    if (possible) possible.checked = true;
  }
  // Switching kind changes which risk tier prices the product, so the preview
  // and the explanation both have to follow it.
  if (e.target.matches("[name='catalogKind']")) {
    syncUntestedRiskHint();
    updateCostPreview();
  }
  if (e.target.matches("[name='printProfile'], [name='riskLevel']")) updateCostPreview();
  else updateProductReadiness();
});

// ── Manual price toggle ───────────────────────────────────────
document.querySelector("#manual-price-toggle")?.addEventListener("change", (e) => {
  const field = document.querySelector("#manual-price-field");
  if (field) field.hidden = !e.target.checked;
  updateCostPreview();
});

// ── Filament form ─────────────────────────────────────────────
document.querySelector("#add-filament-btn")?.addEventListener("click", () => {
  const form = document.querySelector("#filament-form");
  if (!form) return;
  form.reset();
  form.elements["filamentId"].value = "";
  form.elements["active"].checked = true;
  form.elements["materialType"].value = "PLA";
  form.hidden = false;
  syncManufacturerSuggestions();
  updateFilamentPreview();
  setView("materials");
  activateSubTab("materials-filaments");
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

document.querySelector("#filament-form-cancel")?.addEventListener("click", () => {
  const form = document.querySelector("#filament-form");
  if (form) { form.reset(); form.hidden = true; }
});

function updateFilamentPreview() {
  const form = document.querySelector("#filament-form");
  if (!form) return;
  const namePreview = document.querySelector("#filament-name-preview");
  if (namePreview) {
    const name = composeFilamentName(
      form.elements["manufacturer"]?.value,
      form.elements["materialType"]?.value,
      form.elements["colorName"]?.value,
    );
    namePreview.textContent = `שם החומר: ${name || "—"}`;
  }
  const spoolPrice = Number(form.elements["spoolPrice"]?.value);
  const spoolGrams = Number(form.elements["spoolGrams"]?.value);
  const target = document.querySelector("#filament-cost-per-gram");
  if (target) target.textContent = spoolPrice > 0 && spoolGrams > 0
    ? `עלות לגרם: ${formatCurrency(spoolPrice / spoolGrams)}`
    : "עלות לגרם: —";
}

function syncMaterialTypeSuggestions() {
  const list = document.querySelector("#material-type-suggestions");
  if (!list) return;
  const types = new Set(["PLA", "PETG", "TPU", "ABS", "ASA", "PC", "PA"]);
  store.filaments.forEach((filament) => {
    const type = String(filament.materialType ?? "").trim();
    if (type) types.add(type);
  });
  list.replaceChildren(...Array.from(types).sort().map((type) => {
    const option = document.createElement("option");
    option.value = type;
    return option;
  }));
}

function syncManufacturerSuggestions() {
  const list = document.querySelector("#manufacturer-suggestions");
  if (!list) return;
  const names = new Set();
  store.filaments.forEach((filament) => {
    const name = String(filament.manufacturer ?? "").trim();
    if (name) names.add(name);
  });
  list.replaceChildren(...Array.from(names).sort().map((name) => {
    const option = document.createElement("option");
    option.value = name;
    return option;
  }));
}

document.querySelector("#filament-form")?.addEventListener("input", (event) => {
  if (event.target.matches("[name='colorHex'], [name='spoolPrice'], [name='spoolGrams'], [name='manufacturer'], [name='materialType'], [name='colorName']")) updateFilamentPreview();
});

document.querySelector("#filament-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const id   = String(data.get("filamentId") ?? "").trim();
  const isEdit = Boolean(id);

  const payload = {
    manufacturer: String(data.get("manufacturer") ?? "").trim(),
    materialType: String(data.get("materialType") ?? "PLA").trim(),
    colorName:    String(data.get("colorName") ?? "").trim(),
    colorHex:     String(data.get("colorHex") ?? "#000000").trim(),
    spoolPrice:   Number(data.get("spoolPrice")),
    spoolGrams:   Number(data.get("spoolGrams")),
    remainingGrams: data.get("remainingGrams") === "" ? null : Number(data.get("remainingGrams")),
    note:         String(data.get("note") ?? "").trim(),
    active:       data.get("active") !== null,
  };

  const btn = form.querySelector("[type='submit']");
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "שומר...";

  try {
    if (isEdit) {
      const updated = await api(`/api/filaments?id=${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const idx = store.filaments.findIndex((f) => f.id === id);
      if (idx !== -1) store.filaments[idx] = updated;
    } else {
      const created = await api("/api/filaments", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      store.filaments.push(created);
    }
    form.reset();
    form.hidden = true;
    render();
    syncMaterialTypeSuggestions();
  } catch (err) {
    alert(`שגיאה בשמירת חומר: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
});

// ── Expense form (admin) ────────────────────────────────────────
document.querySelector("#add-expense-btn")?.addEventListener("click", () => {
  const form = document.querySelector("#expense-form");
  if (!form) return;
  form.reset();
  form.elements["expenseId"].value = "";
  form.elements["expenseDate"].value = new Date().toISOString().slice(0, 10);
  form.hidden = false;
  setView("finance");
  activateSubTab("finance-expenses");
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

document.querySelector("#expense-form-cancel")?.addEventListener("click", () => {
  const form = document.querySelector("#expense-form");
  if (form) { form.reset(); form.hidden = true; }
});

document.querySelector("#expense-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const id   = String(data.get("expenseId") ?? "").trim();
  const isEdit = Boolean(id);

  const payload = {
    description: String(data.get("description") ?? "").trim(),
    category:    String(data.get("category") ?? "general").trim(),
    amount:      Number(data.get("amount")) || 0,
    expenseDate: String(data.get("expenseDate") ?? "").trim(),
    notes:       String(data.get("notes") ?? "").trim(),
  };

  const btn = form.querySelector("[type='submit']");
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "שומר...";

  try {
    if (isEdit) {
      const updated = await api(`/api/expenses?id=${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const idx = store.expenses.findIndex((e) => e.id === id);
      if (idx !== -1) store.expenses[idx] = updated;
    } else {
      const created = await api("/api/expenses", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      store.expenses.unshift(created);
    }
    form.reset();
    form.hidden = true;
    render();
  } catch (err) {
    alert(`שגיאה בשמירת הוצאה: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
});

// ── Category form (admin) ──────────────────────────────────────
document.querySelector("#add-category-btn")?.addEventListener("click", () => {
  const form = document.querySelector("#category-form");
  if (!form) return;
  form.reset();
  form.elements["categoryId"].value = "";
  form.elements["active"].checked = true;
  form.hidden = false;
  setView("products");
  activateSubTab("product-categories");
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

document.querySelector("#category-form-cancel")?.addEventListener("click", () => {
  const form = document.querySelector("#category-form");
  if (form) { form.reset(); form.hidden = true; }
});

document.querySelector("#category-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const id   = String(data.get("categoryId") ?? "").trim();
  const isEdit = Boolean(id);

  const payload = {
    name:        String(data.get("name") ?? "").trim(),
    description: String(data.get("description") ?? "").trim(),
    sortOrder:   Number(data.get("sortOrder")) || 0,
    active:      data.get("active") !== null,
  };

  const btn = form.querySelector("[type='submit']");
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "שומר...";

  try {
    if (isEdit) {
      const updated = await api(`/api/categories?id=${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      const idx = store.categories.findIndex((c) => c.id === id);
      if (idx !== -1) store.categories[idx] = updated;
    } else {
      const created = await api("/api/categories", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      store.categories.push(created);
    }
    form.reset();
    form.hidden = true;
    render();
  } catch (err) {
    alert(`שגיאה בשמירת קטגוריה: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
});

window.openCategoryEditForm = function openCategoryEditForm(category) {
  const form = document.querySelector("#category-form");
  if (!form) return;
  form.elements["categoryId"].value  = category.id;
  form.elements["name"].value        = category.name;
  form.elements["description"].value = category.description ?? "";
  form.elements["sortOrder"].value   = category.sortOrder ?? 0;
  form.elements["active"].checked    = category.active !== false;
  form.hidden = false;
  setView("products");
  activateSubTab("product-categories");
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

// ── Pricing settings form ─────────────────────────────────────
document.querySelector("#pricing-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const btn  = event.target.querySelector("[type='submit']");
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "שומר...";

  const settings = {
    marginPercent: Number(data.get("marginPercent")) / 100,
    minOrderPrice: Number(data.get("minOrderPrice")),
    roundingMode: "ceil",
    riskPercentByLevel: {
      low: Number(data.get("riskLowPercent")) / 100,
      medium: Number(data.get("riskMediumPercent")) / 100,
      high: Number(data.get("riskHighPercent")) / 100,
      untested: Number(data.get("riskUntestedPercent")) / 100,
    },
    riskPercents: {
      low: Number(data.get("riskLowPercent")) / 100,
      medium: Number(data.get("riskMediumPercent")) / 100,
      high: Number(data.get("riskHighPercent")) / 100,
      untested: Number(data.get("riskUntestedPercent")) / 100,
    },
  };

  try {
    const saved = await api("/api/settings?key=pricing", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    store.pricingSettings = saved;
    render();
    syncPricingRiskFields();
    updateCostPreview();
    document.querySelector("#pricing-save-status").textContent = "ההגדרות נשמרו";
  } catch (err) {
    alert(`שגיאה בשמירת הגדרות: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
});

function syncPricingRiskFields() {
  const form = document.querySelector("#pricing-form");
  if (!form || !store.pricingSettings) return;
  const values = store.pricingSettings.riskPercentByLevel ?? store.pricingSettings.riskPercents ?? DEFAULT_RISK_PERCENT_BY_LEVEL;
  form.elements["riskLowPercent"].value = Number(values.low ?? DEFAULT_RISK_PERCENT_BY_LEVEL.low) * 100;
  form.elements["riskMediumPercent"].value = Number(values.medium ?? DEFAULT_RISK_PERCENT_BY_LEVEL.medium) * 100;
  form.elements["riskHighPercent"].value = Number(values.high ?? DEFAULT_RISK_PERCENT_BY_LEVEL.high) * 100;
  if (form.elements["riskUntestedPercent"]) {
    form.elements["riskUntestedPercent"].value = Number(values.untested ?? DEFAULT_RISK_PERCENT_BY_LEVEL.untested) * 100;
  }
}

async function submitManagedForm(form, request, errorLabel) {
  const button = form.querySelector("[type='submit']");
  const originalLabel = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "שומר...";
  }
  try {
    await api(request.url, request.options);
    form.reset();
    await loadData();
    render();
  } catch (err) {
    alert(`${errorLabel}: ${err.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

document.querySelector("#goal-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  await submitManagedForm(event.target, {
    url: "/api/goals",
    options: { method: "POST", body: JSON.stringify({ name: data.get("name"), targetAmount: Number(data.get("targetAmount")), publicVisible: data.get("publicVisible") === "on", publicLabel: data.get("publicLabel") }) },
  }, "שגיאה בשמירת היעד");
});

document.querySelector("#ledger-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  await submitManagedForm(event.target, {
    url: "/api/ledger",
    options: { method: "POST", body: JSON.stringify({ kind: data.get("kind"), description: data.get("description"), amount: Number(data.get("amount")), publicVisible: data.get("publicVisible") === "on", publicLabel: data.get("publicLabel") }) },
  }, "שגיאה בשמירת הרשומה");
});

// ── Contact settings form ─────────────────────────────────────
document.querySelector("#contact-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const btn  = event.target.querySelector("[type='submit']");
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "שומר...";

  try {
    const saved = await api("/api/settings?key=contact", {
      method: "PUT",
      body: JSON.stringify({
        whatsappPhone: String(data.get("whatsappPhone") ?? "").trim(),
        displayLabel:  String(data.get("displayLabel") ?? "").trim(),
      }),
    });
    store.contactSettings = saved;
    render();
  } catch (err) {
    alert(`שגיאה בשמירת פרטי קשר: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
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

  // Personal and catalog pages require a valid session. The server enforces the
  // catalog route too; this client guard also covers static-build deployments.
  if (["welcome", "catalog", "cart"].includes(pageName) && !store.currentUser) {
    window.location.href = "dashboard.html";
    return;
  }
  if (store.currentUser?.role === "friend" && pageName === "app") {
    window.location.href = "welcome.html";
    return;
  }

  // Admin visiting catalog or welcome is forced into friend mode so they see the friend UI.
  // Set this before loadData so admin data is not fetched needlessly on those pages.
  if (["catalog", "welcome", "cart"].includes(pageName) && store.currentUser?.role === "admin") {
    store.appMode = "friend";
    applyMode();
  }

  const shouldLoadData = store.currentUser && ["app", "welcome", "catalog", "cart"].includes(pageName);
  if (shouldLoadData) {
    try {
      await loadData();
    } catch (err) {
      console.error("Failed to load data:", err);
    }
  }

  if (pageName === "app" && store.currentUser) {
    document.body.dataset.entry = "app";
  }

  setView(store.appMode === "admin" ? viewFromHash() : "catalog", { updateHash: false });
  render();
  syncPricingRiskFields();
  syncMaterialTypeSuggestions();
})();

window.addEventListener("hashchange", () => {
  if (pageName === "app" && store.appMode === "admin") {
    setView(viewFromHash(), { updateHash: false });
  }
});
