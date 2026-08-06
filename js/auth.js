import { store } from "./state.js";

export function setAuthPanel(panelName) {
  document.querySelectorAll(".auth-form").forEach((form) => {
    form.classList.toggle("is-active", form.dataset.authForm === panelName);
  });
  document.querySelectorAll(".auth-mode-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.authTarget === panelName);
  });
  document.querySelector("#login-error")?.classList.remove("is-visible");
  document.querySelector("#register-error")?.classList.remove("is-visible");
  document.querySelector("#login-status")?.classList.remove("is-visible");
  document.querySelector("#register-pending")?.classList.remove("is-visible");
}

export function showRegisterError(message) {
  const el = document.querySelector("#register-error");
  if (!el) return;
  el.textContent = message;
  el.classList.add("is-visible");
}

export function showRegisterPending(fullName) {
  const el = document.querySelector("#register-pending");
  if (!el) return;
  el.innerHTML = `
    <strong>תודה ${fullName}!</strong><br>
    הבקשה שלך נשלחה בהצלחה ומחכה לאישור המנהל.<br>
    אפשר להתחבר ולצפות בקטלוג כבר עכשיו. נעדכן אותך כשהחשבון יאושר.
  `;
  el.classList.add("is-visible");
  document.querySelector("#register-form")?.classList.remove("is-active");
  document.querySelector(".auth-mode-button[data-auth-target='register']")?.classList.remove("is-active");
}

export function showLoginStatus(status, reason) {
  const el = document.querySelector("#login-status");
  if (!el) return;

  if (status === 'pending') {
    el.innerHTML = `
      <strong>הבקשה שלך בטיפול</strong><br>
      החשבון שלך עדיין ממתין לאישור המנהל.<br>
      תקבל הודעה כשהכל יהיה מוכן — אפשר לנסות להתחבר שוב אחרי שתקבל אישור.
    `;
  } else if (status === 'rejected') {
    el.innerHTML = `
      <strong>הבקשה לא אושרה</strong><br>
      ${reason ? `סיבה: ${reason}` : 'צור קשר עם המנהל לפרטים נוספים.'}
    `;
    el.classList.add("is-rejected");
  }

  el.classList.add("is-visible");
  document.querySelector("#login-form")?.classList.remove("is-active");
  document.querySelector(".auth-mode-button[data-auth-target='login']")?.classList.remove("is-active");
}

export function applyAuth() {
  document.body.dataset.auth = store.currentUser ? "signed-in" : "signed-out";
  document.body.dataset.role = store.currentUser?.role ?? "friend";
  document.body.dataset.gender = store.currentUser?.gender ?? "";

  document.querySelectorAll(".global-tab[data-tab='catalog']").forEach((link) => {
    link.setAttribute("href", store.currentUser ? "catalog.html" : "dashboard.html");
  });
  // The cart is per signed-in friend, so signed out the tab leads to the login page.
  document.querySelectorAll(".global-tab[data-tab='cart']").forEach((link) => {
    link.setAttribute("href", store.currentUser ? "cart.html" : "dashboard.html");
  });

  const userLabel = document.querySelector("#current-user");
  if (userLabel && store.currentUser) {
    userLabel.innerHTML = `שלום <strong>${store.currentUser.name}</strong> 👋`;
  }

  const welcomeEyebrow = document.querySelector("#ws-welcome-eyebrow");
  if (welcomeEyebrow && store.currentUser) {
    welcomeEyebrow.textContent = store.currentUser.gender === "female"
      ? "ברוכה הבאה פנימה"
      : "ברוך הבא פנימה";
  }

  const tipTitle = document.querySelector("#tip-title");
  if (tipTitle && store.currentUser) {
    tipTitle.textContent = "רוצה לעזור לפרויקט לגדול? 💛";
  }

  const hero  = document.querySelector("#landing-store-button-hero");
  const final = document.querySelector("#landing-store-button-final");
  const catalogHero = document.querySelector("#landing-catalog-button-hero");
  const catalogFinal = document.querySelector("#landing-catalog-button-final");
  const ideaButton = document.querySelector("#landing-idea-button");
  if (store.currentUser) {
    hero?.setAttribute("href", "welcome.html");
    if (hero)  hero.textContent  = "לאזור האישי";
    final?.setAttribute("href", "welcome.html");
    if (final) final.textContent = "לאזור האישי";
    catalogHero?.setAttribute("href", "catalog.html");
    if (catalogHero) catalogHero.textContent = "לצפייה בקטלוג";
    catalogFinal?.setAttribute("href", "catalog.html");
    if (catalogFinal) catalogFinal.textContent = "לצפייה בקטלוג";
    ideaButton?.setAttribute("href", "catalog.html");
  } else {
    hero?.setAttribute("href", "dashboard.html");
    if (hero)  hero.textContent  = "כניסה / הרשמה";
    final?.setAttribute("href", "dashboard.html");
    if (final) final.textContent = "כניסה / הרשמה";
    catalogHero?.setAttribute("href", "dashboard.html");
    if (catalogHero) catalogHero.textContent = "כניסה לצפייה בקטלוג";
    catalogFinal?.setAttribute("href", "dashboard.html");
    if (catalogFinal) catalogFinal.textContent = "כניסה לצפייה בקטלוג";
    ideaButton?.setAttribute("href", "dashboard.html");
  }
}

export function applyMode() {
  if (!store.currentUser || store.currentUser.role !== "admin") {
    store.appMode = "friend";
  }
  document.body.dataset.mode = store.appMode;

  const catalogTitle       = document.querySelector("#catalog-title");
  const catalogDescription = document.querySelector("#catalog-view > div > p:not(.eyebrow)");
  if (!catalogTitle || !catalogDescription) return;

  if (store.appMode === "friend") {
    catalogTitle.textContent       = "מה אפשר להדפיס?";
    catalogDescription.textContent = store.currentUser?.gender === "female"
      ? "בחרי מוצר וכמות. המחיר החברי מכסה את ההדפסה ותומך בצמיחה; תמיכה נוספת היא לא חובה."
      : "בחר מוצר וכמות. המחיר החברי מכסה את ההדפסה ותומך בצמיחה; תמיכה נוספת היא לא חובה.";
  } else {
    catalogTitle.textContent       = "קטלוג מוצרים";
    catalogDescription.textContent = "בחר מוצר וכמות. המחיר החברי מכסה את ההדפסה ותומך בצמיחה; תמיכה נוספת היא לא חובה.";
  }
}

const ADMIN_VIEWS = ["overview", "orders", "products", "users", "finance", "materials", "feedback", "settings"];

export function viewFromHash() {
  const view = window.location.hash.slice(1);
  return ADMIN_VIEWS.includes(view) ? view : "overview";
}

export function setView(viewName, { updateHash = true } = {}) {
  if (!document.querySelector(".view")) return;

  const friendViews = ["landing", "catalog"];
  const nextView =
    store.appMode === "friend"
      ? (friendViews.includes(viewName) ? viewName : "landing")
      : (ADMIN_VIEWS.includes(viewName) ? viewName : "overview");

  document.querySelectorAll(".admin-nav-link").forEach((link) => {
    const isActive = link.dataset.view === nextView;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `${nextView}-view`);
  });

  if (updateHash && store.appMode === "admin" && window.location.hash !== `#${nextView}`) {
    window.history.pushState(null, "", `#${nextView}`);
  }
}
