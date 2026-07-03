import { api } from "./api.js";
import { store, pageName, loadData } from "./state.js";
import { render } from "./render.js";
import { openOrderDialog, updateOrderMinimum, getOrderFriendName, openCustomOrderDialog } from "./orders.js";
import { setAuthPanel, showRegisterError, showRegisterPending, showLoginStatus, applyAuth, applyMode, setView } from "./auth.js";
import { formatCurrency, createAiProductDraft, calculateProductCost } from "./utils.js";

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

  if (result.status === "rejected") {
    loginForm.reset();
    showLoginStatus(result.status, result.reason);
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
  const email               = String(data.get("email") ?? "").trim();
  const phone               = String(data.get("phone") ?? "").trim();
  const howYouKnowAdmin     = String(data.get("howYouKnowAdmin") ?? "").trim();
  const registrationMessage = String(data.get("registrationMessage") ?? "").trim();
  const password            = String(data.get("password") ?? "");
  const confirmPassword     = String(data.get("confirmPassword") ?? "");

  if (name.length < 2)             { showRegisterError("שם משתמש צריך להיות לפחות שני תווים."); return; }
  if (fullName.length < 2)         { showRegisterError("נא להזין שם מלא."); return; }
  if (!email.includes("@"))        { showRegisterError("נא להזין כתובת אימייל תקינה."); return; }
  if (phone.length < 7)            { showRegisterError("נא להזין מספר טלפון תקין."); return; }
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
        action: "register", name, fullName, email, phone, howYouKnowAdmin, registrationMessage,
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

// ── Users sub-tabs ────────────────────────────────────────────
document.querySelectorAll(".sub-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.sub;
    document.querySelectorAll(".sub-tab").forEach((t) => t.classList.toggle("is-active", t === btn));
    document.querySelectorAll(".sub-view").forEach((v) => v.classList.toggle("is-active", v.id === `${target}-sub`));
  });
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
  const data      = new FormData(productForm);
  const editId    = String(data.get("editProductId") ?? "").trim();
  const isEdit    = Boolean(editId);

  const materials = collectMaterialRows();
  const images    = collectImageRows();

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
    stlUrl:             String(data.get("stlUrl") ?? "").trim(),
    sourceUrl:          String(data.get("sourceUrl") ?? "").trim(),
    category:           String(data.get("category") ?? "").trim(),
    printHours:         Number(data.get("printHours")) || 0,
    printProfile:       String(data.get("printProfile") ?? "regular"),
    materials,
    images,
    active:             data.get("productActive") !== null,
    manualPriceEnabled: data.get("manualPriceEnabled") !== null,
    manualPrice:        data.get("manualPriceEnabled") !== null ? Number(data.get("manualPrice")) || null : null,
    calculatedCost:     computedCostFromForm(),
  };

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
      resetProductForm();
      render();
      setView("store-edit");
    } else {
      const product = await api("/api/products", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      store.products.push(product);
      resetProductForm();
      render();
      setView("items");
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

function collectImageRows() {
  const rows = document.querySelectorAll("#product-image-rows .image-row");
  const mainRadio = document.querySelector("#product-image-rows input[name='mainImage']:checked");
  const mainIdx   = mainRadio ? Number(mainRadio.dataset.idx) : 0;
  return Array.from(rows).map((row, i) => ({
    url:    String(row.querySelector("input[type='url']")?.value ?? "").trim(),
    isMain: i === mainIdx,
  })).filter((img) => img.url);
}

function computedCostFromForm() {
  const product = {
    printHours:   Number(document.querySelector("#product-form [name='printHours']")?.value) || 0,
    printProfile: document.querySelector("#product-form [name='printProfile']")?.value ?? "regular",
    materials:    collectMaterialRows(),
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
  document.querySelector("#cost-preview-breakdown").innerHTML =
    `<span style="color:var(--muted);font-size:var(--text-sm)">מלא שעות הדפסה וחומרים כדי לראות חישוב.</span>`;
  document.querySelector("#manual-price-field")?.setAttribute("hidden", "");
  document.querySelector("#product-submit-btn").textContent = "הוספת מוצר";
  document.querySelector("#product-edit-cancel")?.setAttribute("hidden", "");
  document.querySelector("#product-add-title").textContent = "הוספת מוצר";
  document.querySelector("#product-active-toggle").checked = true;
}

// Exposed globally so render.js store-edit cards can call it
window.openProductEditForm = function openProductEditForm(product) {
  if (!productForm) return;
  resetProductForm();

  productForm.elements["name"].value        = product.name;
  productForm.elements["cost"].value        = product.cost;
  productForm.elements["grams"].value       = product.grams;
  productForm.elements["description"].value = product.description;
  productForm.elements["image"].value       = product.image ?? "";
  productForm.elements["stlUrl"].value      = product.stlUrl ?? "";
  productForm.elements["sourceUrl"].value   = product.sourceUrl ?? "";
  productForm.elements["category"].value    = product.category ?? "";
  productForm.elements["printHours"].value  = product.printHours ?? 0;
  productForm.elements["printProfile"].value = product.printProfile ?? "regular";
  document.querySelector("#edit-product-id").value = product.id;
  document.querySelector("#product-active-toggle").checked = product.active !== false;

  if (product.manualPriceEnabled) {
    productForm.elements["manualPriceEnabled"].checked = true;
    document.querySelector("#manual-price-field")?.removeAttribute("hidden");
    productForm.elements["manualPrice"].value = product.manualPrice ?? "";
  }

  // Rebuild material rows
  const materialsContainer = document.querySelector("#product-materials-rows");
  materialsContainer.replaceChildren();
  (product.materials ?? []).forEach((m) => addMaterialRow(m.filamentId, m.grams));

  // Rebuild image rows
  const imagesContainer = document.querySelector("#product-image-rows");
  imagesContainer.replaceChildren();
  (product.images ?? []).forEach((img, i) => addImageRow(img.url, img.isMain, i));

  document.querySelector("#product-submit-btn").textContent  = "שמור שינויים";
  document.querySelector("#product-edit-cancel")?.removeAttribute("hidden");
  document.querySelector("#product-add-title").textContent  = `עריכת מוצר: ${product.name}`;

  updateCostPreview();
  setView("product-add");
  productForm.scrollIntoView({ behavior: "smooth", block: "start" });
};

// ── Product edit cancel ───────────────────────────────────────
document.querySelector("#product-edit-cancel")?.addEventListener("click", () => {
  resetProductForm();
  setView("store-edit");
});

// ── Material rows ─────────────────────────────────────────────
function addMaterialRow(filamentId = "", grams = "") {
  const container = document.querySelector("#product-materials-rows");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "material-row";

  const select = document.createElement("select");
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
  });

  row.append(urlInput, radioLabel, deleteBtn);
  container.append(row);
}

document.querySelector("#add-image-row-btn")?.addEventListener("click", () => addImageRow());

// ── Live cost preview ─────────────────────────────────────────
function updateCostPreview() {
  const panel = document.querySelector("#cost-preview-breakdown");
  if (!panel || !store.pricingSettings) return;

  const product = {
    printHours:   Number(productForm?.elements["printHours"]?.value) || 0,
    printProfile: productForm?.elements["printProfile"]?.value ?? "regular",
    materials:    collectMaterialRows(),
  };

  if (!product.printHours && !product.materials.length) {
    panel.innerHTML = `<span style="color:var(--muted);font-size:var(--text-sm)">מלא שעות הדפסה וחומרים כדי לראות חישוב.</span>`;
    return;
  }

  const b = calculateProductCost(product, store.filaments, store.pricingSettings);

  panel.innerHTML = `
    <div class="cost-preview-row"><span>עלות חומרים</span><span>${formatCurrency(b.materialCost)}</span></div>
    <div class="cost-preview-row"><span>עלות חשמל</span><span>${formatCurrency(b.electricityCost)}</span></div>
    <div class="cost-preview-row"><span>בלאי ציוד (שעתי)</span><span>${formatCurrency(b.hourlyWearCost)}</span></div>
    <div class="cost-preview-row"><span>בלאי קבוע</span><span>${formatCurrency(b.fixedWear)}</span></div>
    <div class="cost-preview-row"><span>סיכון (${Math.round((store.pricingSettings?.printProfiles?.[product.printProfile]?.riskPercent ?? 0) * 100)}%)</span><span>${formatCurrency(b.riskCost)}</span></div>
    <div class="cost-preview-final"><span>עלות מינימום מחושבת</span><span>${formatCurrency(b.finalCost)}</span></div>
  `;
}

// Wire live preview to form inputs (input covers number fields; change covers select)
productForm?.addEventListener("input",  (e) => {
  if (e.target.matches("[name='printHours']")) updateCostPreview();
});
productForm?.addEventListener("change", (e) => {
  if (e.target.matches("[name='printProfile']")) updateCostPreview();
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
  form.hidden = false;
  setView("filaments");
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

document.querySelector("#filament-form-cancel")?.addEventListener("click", () => {
  const form = document.querySelector("#filament-form");
  if (form) { form.reset(); form.hidden = true; }
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
    pricePerKg:   Number(data.get("pricePerKg")) || 0,
    note:         String(data.get("note") ?? "").trim(),
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
  } catch (err) {
    alert(`שגיאה בשמירת חומר: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
});

// ── Pricing settings form ─────────────────────────────────────
document.querySelector("#pricing-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const btn  = event.target.querySelector("[type='submit']");
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "שומר...";

  const buildProfile = (prefix) => ({
    label:       store.pricingSettings?.printProfiles?.[prefix]?.label ?? prefix,
    wearPerHour:  Number(data.get(`${prefix}_wearPerHour`))  || 0,
    fixedWear:    Number(data.get(`${prefix}_fixedWear`))    || 0,
    riskPercent:  Number(data.get(`${prefix}_riskPercent`))  || 0,
  });

  const settings = {
    electricityPerHour: Number(data.get("electricityPerHour")) || 0,
    roundingMode:       store.pricingSettings?.roundingMode ?? "ceil",
    printProfiles: {
      regular: buildProfile("regular"),
      ams:     buildProfile("ams"),
      complex: buildProfile("complex"),
    },
  };

  try {
    const saved = await api("/api/settings?key=pricing", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    store.pricingSettings = saved;
    render();
    updateCostPreview();
  } catch (err) {
    alert(`שגיאה בשמירת הגדרות: ${err.message}`);
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

  setView(store.appMode === "admin" ? "items" : "catalog");
  render();
})();
