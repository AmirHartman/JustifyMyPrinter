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
    tipTitle.textContent = store.currentUser.gender === "female"
      ? "האם תרצי לפרגן? 💛"
      : "האם תרצה לפרגן? 💛";
  }

  const hero  = document.querySelector("#landing-store-button-hero");
  const final = document.querySelector("#landing-store-button-final");
  const catalogHero = document.querySelector("#landing-catalog-button-hero");
  const catalogFinal = document.querySelector("#landing-catalog-button-final");
  if (store.currentUser) {
    hero?.setAttribute("href", "catalog.html");
    if (hero)  hero.textContent  = "חזרה לאזור האישי";
    final?.setAttribute("href", "catalog.html");
    if (final) final.textContent = "חזרה לאזור האישי";
    catalogHero?.setAttribute("href", "catalog.html");
    if (catalogHero) catalogHero.textContent = "לצפייה בקטלוג";
    catalogFinal?.setAttribute("href", "catalog.html");
    if (catalogFinal) catalogFinal.textContent = "לצפייה בקטלוג";
  } else {
    hero?.setAttribute("href", "dashboard.html");
    if (hero)  hero.textContent  = "כניסה / הרשמה";
    final?.setAttribute("href", "dashboard.html");
    if (final) final.textContent = "כניסה / הרשמה";
    catalogHero?.setAttribute("href", "dashboard.html");
    if (catalogHero) catalogHero.textContent = "כניסה לצפייה בקטלוג";
    catalogFinal?.setAttribute("href", "dashboard.html");
    if (catalogFinal) catalogFinal.textContent = "כניסה לצפייה בקטלוג";
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
      ? "בחרי מוצר וכמות. המחיר מכסה עלויות וכולל רווח מתון; פרגון הוא אופציונלי."
      : "בחר מוצר וכמות. המחיר מכסה עלויות וכולל רווח מתון; פרגון הוא אופציונלי.";
  } else {
    catalogTitle.textContent       = "קטלוג מוצרים";
    catalogDescription.textContent = "בחר מוצר וכמות. המחיר מכסה עלויות וכולל רווח מתון; פרגון הוא אופציונלי.";
  }
}

export function setView(viewName) {
  if (!document.querySelector(".view")) return;

  const friendViews = ["landing", "catalog"];
  const nextView =
    store.appMode === "friend"
      ? (friendViews.includes(viewName) ? viewName : "landing")
      : (friendViews.includes(viewName) ? "overview" : viewName);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === nextView);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `${nextView}-view`);
  });
}
