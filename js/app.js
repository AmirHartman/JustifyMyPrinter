import { api } from "./api.js";
import { store, pageName, loadData } from "./state.js";
import { render } from "./render.js";
import {
  openOrderDialog, updateReviewCosts, getOrderFriendName, openCustomOrderDialog,
  addTip, resetTip, goToStep, getTipAmount, getOrderTotal, getOrderOptions,
} from "./orders.js";
import { setAuthPanel, showRegisterError, showRegisterPending, showLoginStatus, applyAuth, applyMode, setView } from "./auth.js";
import { formatCurrency, calculateProductCost } from "./utils.js";

// ── DOM references ────────────────────────────────────────────
const loginForm     = document.querySelector("#login-form");
const loginError    = document.querySelector("#login-error");
const registerForm  = document.querySelector("#register-form");
const registerError = document.querySelector("#register-error");
const orderDialog   = document.querySelector("#order-dialog");
const orderForm     = document.querySelector("#order-form");
const productForm   = document.querySelector("#product-form");
const orderDrawer   = document.querySelector("#order-drawer");
const DEFAULT_RISK_PERCENT_BY_LEVEL = Object.freeze({ low: 0.08, medium: 0.15, high: 0.25 });
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

  window.location.href = "welcome.html";
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

// ── Admin tabs ────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

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

document.querySelector("#reset-demo")?.addEventListener("click", async () => {
  await loadData();
  render();
  syncPricingRiskFields();
});

// ── Order dialog ──────────────────────────────────────────────
document.querySelector(".close-button")?.addEventListener("click", () => orderDialog?.close());
document.querySelector("#cancel-order")?.addEventListener("click", () => orderDialog?.close());
orderForm?.quantity?.addEventListener("input", updateReviewCosts);

orderForm?.querySelectorAll("[data-wizard-next]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.wizardNext === "tip" && !orderForm.reportValidity()) return;
    goToStep(button.dataset.wizardNext);
  });
});
orderForm?.querySelectorAll("[data-wizard-back]").forEach((button) => {
  button.addEventListener("click", () => goToStep(button.dataset.wizardBack));
});
orderForm?.querySelectorAll("[data-tip-add]").forEach((button) => {
  button.addEventListener("click", () => addTip(Number(button.dataset.tipAdd)));
});
document.querySelector("#tip-reset")?.addEventListener("click", () => resetTip());

document.querySelector("#close-thanks")?.addEventListener("click", () => {
  orderDialog?.close();
  setView(store.appMode === "admin" ? "orders" : "catalog");
});

orderForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data    = new FormData(orderForm);
  const product = store.products.find((p) => p.id === data.get("productId"));
  if (!product) return;

  const quantity     = Number(data.get("quantity"));
  const supportAmount = getTipAmount();
  const price         = getOrderTotal();
  const orderOptions  = getOrderOptions();

  try {
    const order = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        productId:  product.id,
        friendName: getOrderFriendName(data),
        quantity,
        price,
        baseCost: product.cost * quantity,
        supportAmount,
        selectedColors: orderOptions.selectedColors,
        customText: orderOptions.customText,
      }),
    });
    if (store.appMode === "admin") store.orders.unshift(order);
    else store.myOrders.unshift(order);
    render();
    goToStep("thanks");
  } catch (err) {
    alert(`שגיאה ביצירת הזמנה: ${err.message}`);
  }
});

// ── Custom / external-link order dialog ────────────────────────
const customOrderDialog = document.querySelector("#custom-order-dialog");
const customOrderForm   = document.querySelector("#custom-order-form");
const customOrderError  = document.querySelector("#custom-order-error");

document.querySelector("#custom-order-button")?.addEventListener("click", () => {
  if (!store.currentUser) { window.location.href = "dashboard.html"; return; }
  const eligible = store.currentUser.role === "admin" || store.currentUser.status === "active";
  if (!eligible) { alert("רק חברים פעילים יכולים להזמין. מחכים לאישור המנהל."); return; }
  openCustomOrderDialog();
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

// ── Product form (admin) ──────────────────────────────────────
document.querySelector("#sync-print-files-btn")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "מסנכרן...";
  try {
    const result = await api("/api/print-sync", { method: "POST", body: "{}" });
    await loadData();
    render();
    const draft = store.products.find((product) => product.printSync?.status === "needs_material");
    if (draft && typeof window.openProductEditForm === "function") {
      window.openProductEditForm(draft);
      return;
    }
    alert(result.output || "הסנכרון הסתיים.");
  } catch (err) {
    alert(`הסנכרון נכשל: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

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
    additionalCopyHours: data.get("additionalCopyHours") === "" ? null : Number(data.get("additionalCopyHours")),
    riskLevel:          String(data.get("riskLevel") ?? "medium"),
    riskPercent:        riskPercentFromForm(),
    minUnitPrice:       data.get("minUnitPrice") === "" ? null : Number(data.get("minUnitPrice")),
    materials,
    images,
    catalogKind:        String(data.get("catalogKind") ?? "printed"),
    possibleColors,
    requiredColors,
    allowMultiple:      data.get("allowMultiple") !== null,
    customTextEnabled:  data.get("customTextEnabled") !== null,
    internalPrintNotes: String(data.get("internalPrintNotes") ?? "").trim(),
    manualPriceEnabled: data.get("manualPriceEnabled") !== null,
    manualPrice:        data.get("manualPriceEnabled") !== null ? Number(data.get("manualPrice")) || null : null,
    calculatedCost:     computedCostFromForm(),
  };
  if (payload.catalogKind === "idea") payload.requiresAdminApproval = true;
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
    grams:      Number(row.querySelector("input[type='number']")?.value) || 0,
  })).filter((m) => m.filamentId);
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
  const selector = `#product-${kind}-colors input[type='checkbox']:checked`;
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
    store.filaments.forEach((filament) => {
      const label = document.createElement("label");
      label.className = "checkbox-label";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = filament.id;
      checkbox.checked = selections[kind].has(filament.id) || selections[kind].has(filament.name);
      checkbox.style.width = "auto";
      const swatch = document.createElement("span");
      swatch.className = "color-swatch";
      swatch.style.background = filament.colorHex || "#ccc";
      swatch.style.border = "1px solid #777";
      label.append(checkbox, swatch, ` ${filament.name}${filament.active === false ? " (לא פעיל)" : ""}`);
      container.append(label);
    });
  }
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
  if (kind === "printed") {
    localChecks.push(
      [Number(productForm.elements["printHours"]?.value) > 0, "זמן הדפסה"],
      [materials.length > 0 && materials.every((item) => item.filamentId && item.grams > 0), "חומר ומשקל חיובי"],
      [Boolean(computedCostFromForm()) || (productForm.elements["manualPriceEnabled"]?.checked && Number(productForm.elements["manualPrice"]?.value) > 0), "מחיר תקין"],
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
  const readyLabel = kind === "idea" ? "הרעיון מוכן להצגה ויופיע כפריט הדורש בדיקה ואישור מחיר." : "המוצר מוכן לפרסום אוטומטי.";
  target.innerHTML = missing.length
    ? `<p>הפריט יישמר כמוסתר עד להשלמת:</p><ul>${missing.map((item) => `<li>${item}</li>`).join("")}</ul>`
    : `<p>${readyLabel}</p>`;
}

function collectImageRows() {
  const rows = document.querySelectorAll("#product-image-rows .image-row");
  return Array.from(rows).map((row, i) => ({
    url:    String(row.querySelector("input[type='url']")?.value ?? "").trim(),
    isMain: row.querySelector("input[name='mainImage']")?.checked || (i === 0 && !document.querySelector("#product-image-rows input[name='mainImage']:checked")),
  })).filter((img) => img.url);
}

function computedCostFromForm() {
  const product = {
    printHours:   Number(document.querySelector("#product-form [name='printHours']")?.value) || 0,
    printProfile: document.querySelector("#product-form [name='printProfile']")?.value ?? "regular",
    materials:    collectMaterialRows(),
    purgeGrams: Number(document.querySelector("#product-form [name='purgeGrams']")?.value) || 0,
    additionalCopyHours: document.querySelector("#product-form [name='additionalCopyHours']")?.value === "" ? null : Number(document.querySelector("#product-form [name='additionalCopyHours']")?.value),
    riskLevel: document.querySelector("#product-form [name='riskLevel']")?.value ?? "medium",
    riskPercent: riskPercentFromForm(),
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
  renderCategoryCheckboxes([]);
  renderColorOptions([], []);
  productFormDirty = false;
  updateProductReadiness();
}

function openProductEditor() {
  activateSubTab("product-catalog");
  document.querySelector("#product-catalog-list")?.setAttribute("hidden", "");
  document.querySelector("#product-editor")?.removeAttribute("hidden");
  document.querySelector("#add-product-btn")?.setAttribute("hidden", "");
  document.querySelector("#sync-print-files-btn")?.setAttribute("hidden", "");
  document.querySelector("#product-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeProductEditor(force = false) {
  if (!force && productFormDirty && !confirm("יש שינויים שלא נשמרו. לצאת מהטופס?")) return false;
  productFormDirty = false;
  document.querySelector("#product-editor")?.setAttribute("hidden", "");
  document.querySelector("#product-catalog-list")?.removeAttribute("hidden");
  document.querySelector("#add-product-btn")?.removeAttribute("hidden");
  document.querySelector("#sync-print-files-btn")?.removeAttribute("hidden");
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
  productForm.elements["additionalCopyHours"].value = product.additionalCopyHours ?? "";
  productForm.elements["riskLevel"].value = product.riskLevel ?? riskLevelFromPercent(product.riskPercent);
  productForm.elements["catalogKind"].value = product.catalogKind ?? "printed";
  productForm.elements["allowMultiple"].checked = product.allowMultiple !== false;
  productForm.elements["customTextEnabled"].checked = Boolean(product.customTextEnabled);
  productForm.elements["internalPrintNotes"].value = product.internalPrintNotes ?? "";
  document.querySelector("#edit-product-id").value = product.id;
  document.querySelector("#product-requires-approval").checked = Boolean(product.requiresAdminApproval);
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
  const syncedGrams = product.printSync?.materialGrams ?? [];
  if ((product.materials ?? []).length) {
    product.materials.forEach((m) => addMaterialRow(m.filamentId, m.grams));
  } else {
    syncedGrams.forEach((grams) => addMaterialRow("", grams));
  }

  // Rebuild image rows
  const imagesContainer = document.querySelector("#product-image-rows");
  imagesContainer.replaceChildren();
  const productImages = product.images?.length ? product.images : product.image ? [{ url: product.image, isMain: true }] : [];
  productImages.forEach((img, i) => addImageRow(img.url, img.isMain, i));

  const importSummary = document.querySelector("#product-import-summary");
  if (importSummary && product.printSync) {
    const grams = syncedGrams.reduce((sum, value) => sum + Number(value || 0), 0);
    importSummary.textContent = `נקלט מ־3MF מקומי: ${Number(product.printHours || 0).toFixed(2)} שעות, ${grams.toFixed(2)} גרם. בחר פילמנט והשלם את פרטי הפרסום.`;
    importSummary.hidden = false;
  }

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
  gramsInput.step        = "1";
  gramsInput.placeholder = "גרם";
  gramsInput.value       = grams;
  gramsInput.addEventListener("input", updateCostPreview);

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
function addImageRow(url = "", isMain = false, idx = null) {
  const container = document.querySelector("#product-image-rows");
  if (!container) return;

  const rowIdx = idx ?? container.children.length;

  const row = document.createElement("div");
  row.className = "image-row";

  const urlInput = document.createElement("input");
  urlInput.type        = "url";
  urlInput.placeholder = "https://example.com/image.jpg";
  urlInput.value       = url;
  urlInput.addEventListener("input", updateProductReadiness);

  const radioLabel = document.createElement("label");
  radioLabel.className = "radio-label";
  const radio = document.createElement("input");
  radio.type    = "radio";
  radio.name    = "mainImage";
  radio.dataset.idx = String(rowIdx);
  radio.checked = isMain || rowIdx === 0;
  radioLabel.append(radio, " ראשי");

  const deleteBtn = document.createElement("button");
  deleteBtn.className   = "ghost-button btn-sm user-delete-btn";
  deleteBtn.type        = "button";
  deleteBtn.textContent = "✕";
  deleteBtn.addEventListener("click", () => {
    row.remove();
    // Make first remaining row's radio checked
    const firstRadio = document.querySelector("#product-image-rows input[type='radio']");
    if (firstRadio) firstRadio.checked = true;
    updateProductReadiness();
  });

  row.append(urlInput, radioLabel, deleteBtn);
  container.append(row);
}

document.querySelector("#add-image-row-btn")?.addEventListener("click", () => addImageRow());

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
    additionalCopyHours: productForm?.elements["additionalCopyHours"]?.value === "" ? null : Number(productForm?.elements["additionalCopyHours"]?.value),
    riskLevel: productForm?.elements["riskLevel"]?.value ?? "medium",
    riskPercent: riskPercentFromForm(),
    minUnitPrice: productForm?.elements["minUnitPrice"]?.value === "" ? null : Number(productForm?.elements["minUnitPrice"]?.value),
  };

  if (!product.printHours && !product.materials.length) {
    beforePanel.innerHTML = `<span class="form-hint">מלא זמן וחומרים כדי לראות חישוב.</span>`;
    afterPanel.innerHTML = `<span class="form-hint">המחיר הסופי יוצג כאן.</span>`;
    updateProductReadiness();
    return;
  }

  const b = calculateProductCost(product, store.filaments, store.pricingSettings);

  beforePanel.innerHTML = `
    <div class="cost-preview-row"><span>עלות חומרים</span><span>${formatCurrency(b.materialCost)}</span></div>
    <div class="cost-preview-row"><span>עלות חשמל</span><span>${formatCurrency(b.electricityCost)}</span></div>
    <div class="cost-preview-row"><span>בלאי ותחזוקה</span><span>${formatCurrency(b.wearCost)}</span></div>
    <div class="cost-preview-row"><span>עלות מדפסת</span><span>${formatCurrency(b.machineCost)}</span></div>
    <div class="cost-preview-row"><span>סיכון (${Math.round(b.riskPercent * 100)}%)</span><span>${formatCurrency(b.riskCost)}</span></div>
    <div class="cost-preview-final"><span>עלות ייצור לפני רווח</span><span>${formatCurrency(b.costWithRisk)}</span></div>
  `;
  afterPanel.innerHTML = `
    <div class="cost-preview-row"><span>רווח</span><span>${formatCurrency(b.marginAmount)}</span></div>
    <div class="cost-preview-row"><span>מינימום מוצר</span><span>${formatCurrency(b.productFloor)}</span></div>
    <div class="cost-preview-row"><span>מינימום הזמנה</span><span>${formatCurrency(b.minOrderPrice)}</span></div>
    <div class="cost-preview-final"><span>מחיר לאחר רווח, מעוגל מעלה</span><span>${formatCurrency(b.finalCost)}</span></div>
  `;
  updateProductReadiness();
}

// Wire live preview to form inputs (input covers number fields; change covers select)
productForm?.addEventListener("input",  (e) => {
  productFormDirty = true;
  if (e.target.matches("[name='printHours'], [name='additionalCopyHours'], [name='purgeGrams'], [name='minUnitPrice'], [name='manualPrice']")) updateCostPreview();
  else updateProductReadiness();
});
productForm?.addEventListener("change", (e) => {
  productFormDirty = true;
  if (e.target.closest("#product-required-colors") && e.target.checked) {
    const possible = document.querySelector(`#product-possible-colors input[value="${CSS.escape(e.target.value)}"]`);
    if (possible) possible.checked = true;
  }
  if (e.target.matches("[name='catalogKind']") && e.target.value === "idea") {
    productForm.elements["requiresAdminApproval"].checked = true;
  }
  if (e.target.matches("[name='printProfile'], [name='riskLevel']")) updateCostPreview();
  else updateProductReadiness();
});

// ── Manual price toggle ───────────────────────────────────────
document.querySelector("#manual-price-toggle")?.addEventListener("change", (e) => {
  const field = document.querySelector("#manual-price-field");
  if (field) field.hidden = !e.target.checked;
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
  updateFilamentPreview();
  setView("settings");
  activateSubTab("settings-filaments");
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

document.querySelector("#filament-form-cancel")?.addEventListener("click", () => {
  const form = document.querySelector("#filament-form");
  if (form) { form.reset(); form.hidden = true; }
});

function updateFilamentPreview() {
  const form = document.querySelector("#filament-form");
  if (!form) return;
  const swatch = document.querySelector("#filament-color-preview");
  if (swatch) {
    swatch.style.background = form.elements["colorHex"]?.value || "#000000";
    swatch.style.border = "1px solid #777";
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

document.querySelector("#filament-form")?.addEventListener("input", (event) => {
  if (event.target.matches("[name='colorHex'], [name='spoolPrice'], [name='spoolGrams']")) updateFilamentPreview();
});

document.querySelector("#filament-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const id   = String(data.get("filamentId") ?? "").trim();
  const isEdit = Boolean(id);

  const payload = {
    name:         String(data.get("name") ?? "").trim(),
    materialType: String(data.get("materialType") ?? "PLA").trim(),
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
    },
    riskPercents: {
      low: Number(data.get("riskLowPercent")) / 100,
      medium: Number(data.get("riskMediumPercent")) / 100,
      high: Number(data.get("riskHighPercent")) / 100,
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
}

document.querySelector("#goal-form")?.addEventListener("submit", async (event) => {
  event.preventDefault(); const data = new FormData(event.target);
  await api("/api/goals", { method: "POST", body: JSON.stringify({ name: data.get("name"), targetAmount: Number(data.get("targetAmount")), publicVisible: data.get("publicVisible") === "on", publicLabel: data.get("publicLabel") }) });
  event.target.reset(); await loadData(); render();
});

document.querySelector("#ledger-form")?.addEventListener("submit", async (event) => {
  event.preventDefault(); const data = new FormData(event.target);
  await api("/api/ledger", { method: "POST", body: JSON.stringify({ kind: data.get("kind"), description: data.get("description"), amount: Number(data.get("amount")), publicVisible: data.get("publicVisible") === "on", publicLabel: data.get("publicLabel") }) });
  event.target.reset(); await loadData(); render();
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

  // welcome.html is the personal area — it requires a session.
  // catalog.html is public: active products are visible without login.
  if (pageName === "welcome" && !store.currentUser) {
    window.location.href = "dashboard.html";
    return;
  }
  if (store.currentUser?.role === "friend" && pageName === "app") {
    window.location.href = "welcome.html";
    return;
  }

  // Admin visiting catalog or welcome is forced into friend mode so they see the friend UI.
  // Set this before loadData so admin data is not fetched needlessly on those pages.
  if (["catalog", "welcome"].includes(pageName) && store.currentUser?.role === "admin") {
    store.appMode = "friend";
    applyMode();
  }

  const shouldLoadData =
    pageName === "catalog" || (store.currentUser && ["app", "welcome"].includes(pageName));
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

  setView(store.appMode === "admin" ? "overview" : "catalog");
  render();
  syncPricingRiskFields();
  syncMaterialTypeSuggestions();
})();
