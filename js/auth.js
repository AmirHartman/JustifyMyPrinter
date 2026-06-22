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

export function showRegisterPending(fullName, email) {
  const el = document.querySelector("#register-pending");
  if (!el) return;
  el.innerHTML = `
    <strong>תודה ${fullName}!</strong><br>
    הבקשה שלך נשלחה בהצלחה ומחכה לאישור המנהל.<br>
    תקבל עדכון לכתובת <strong>${email}</strong> כשהחשבון שלך יאושר.
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

  const userLabel = document.querySelector("#current-user");
  if (userLabel && store.currentUser) {
    userLabel.innerHTML = `שלום <strong>${store.currentUser.name}</strong> 👋`;
  }

  const hero  = document.querySelector("#landing-store-button-hero");
  const final = document.querySelector("#landing-store-button-final");
  if (store.currentUser) {
    hero?.setAttribute("href", "catalog.html");
    if (hero)  hero.textContent  = "חזרה לאזור האישי";
    final?.setAttribute("href", "catalog.html");
    if (final) final.textContent = "חזרה לאזור האישי";
  } else {
    hero?.setAttribute("href", "dashboard.html");
    if (hero)  hero.textContent  = "מעבור לחנות";
    final?.setAttribute("href", "dashboard.html");
    if (final) final.textContent = "מעבור לחנות";
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
    catalogDescription.textContent = "בחר מוצר, כמות וסכום שנראה לך הוגן. המינימום הוא עלות ההדפסה.";
  } else {
    catalogTitle.textContent       = "קטלוג מוצרים";
    catalogDescription.textContent = "בחר מוצר, כמות וסכום לתשלום. המינימום הוא עלות ההדפסה.";
  }
}

export function setView(viewName) {
  if (!document.querySelector(".view")) return;

  const friendViews = ["landing", "catalog"];
  const nextView =
    store.appMode === "friend"
      ? (friendViews.includes(viewName) ? viewName : "landing")
      : (friendViews.includes(viewName) ? "items" : viewName);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === nextView);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `${nextView}-view`);
  });
}
