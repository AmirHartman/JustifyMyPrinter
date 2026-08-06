export const STATUS_LABELS = {
  failed: "נכשלה",
  new: "הזמנה חדשה",
  waiting_approval: "ממתין לאישור",
  waiting_print: "ממתין להדפסה",
  printing: "בהדפסה",
  waiting_assembly: "ממתין להרכבה",
  ready_delivery: "מוכן למסירה",
  completed: "הסתיים",
  cancelled: "בוטל",
  // Legacy values, kept in case old rows ever reach the client unnormalized.
  approved: "ממתין להדפסה",
  ready: "מוכן למסירה",
  delivered: "הסתיים",
  rejected: "בוטל",
};

export function normalizeIsraeliPhone(phone) {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  if (!digits.startsWith("972") || digits.length < 11 || digits.length > 12) return "";
  return digits;
}

export function whatsappUrl(phone, message = "") {
  const normalized = normalizeIsraeliPhone(phone);
  if (!normalized) return "";
  const text = String(message).trim();
  return `https://wa.me/${normalized}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export const whatsappTemplates = {
  general: (name) => `היי ${name}, כאן אמיר ממדפסת חברים 😊`,
  status: ({ name, product, status }) =>
    `היי ${name}, עדכון לגבי ההזמנה שלך: ${product}. הסטטוס כרגע: ${STATUS_LABELS[status] ?? status}.`,
  priceApproval: ({ name, product, amount }) =>
    `היי ${name}, חישבתי מחיר להזמנה שלך: ${product}. המחיר הוא ${amount}₪. אפשר לאשר לפני שאני מדפיס?`,
  delivery: ({ name }) =>
    `היי ${name}, ההזמנה שלך מוכנה למסירה 😊 מתי נוח לך לתאם איסוף?`,
  paymentSummary: ({ name, amount }) =>
    `היי ${name}, ההזמנות שלך מוכנות. הסכום לתשלום הוא ${amount}₪. אפשר לתאם מסירה?`,
};

const WHATSAPP_ICON_SVG = `<svg viewBox="0 0 32 32" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16.004 3C9.377 3 4 8.373 4 15c0 2.34.657 4.523 1.796 6.386L4 29l7.79-1.755A11.94 11.94 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3Zm6.997 16.646c-.29.816-1.44 1.52-2.36 1.716-.628.13-1.448.234-4.204-.902-3.53-1.454-5.8-5.038-5.977-5.27-.17-.232-1.42-1.89-1.42-3.605 0-1.715.9-2.556 1.22-2.906.32-.35.7-.437.933-.437.233 0 .467.002.67.012.216.01.505-.082.79.603.29.7.985 2.415 1.07 2.59.086.176.144.38.028.612-.116.233-.174.378-.343.582-.17.204-.357.456-.51.612-.17.174-.348.363-.15.712.2.35.885 1.462 1.9 2.368 1.306 1.164 2.407 1.524 2.756 1.696.35.174.554.146.758-.086.203-.233.87-1.014 1.103-1.363.233-.35.466-.291.786-.175.32.117 2.033.96 2.382 1.134.35.174.582.262.67.408.087.147.087.845-.203 1.66Z"/></svg>`;

export function createWhatsAppLink({ phone, message, label, className = "", iconOnly = false }) {
  const url = whatsappUrl(phone, message);
  const element = document.createElement(url ? "a" : "button");
  element.className = `whatsapp-button ${iconOnly ? "whatsapp-button-icon-only" : ""} ${className}`.trim();
  const icon = document.createElement("span");
  icon.className = "whatsapp-button-icon";
  icon.innerHTML = WHATSAPP_ICON_SVG;
  element.append(icon);
  if (iconOnly) {
    element.setAttribute("aria-label", label);
    element.title = label;
  } else {
    const text = document.createElement("span");
    text.textContent = label;
    element.append(text);
  }
  if (url) {
    element.href = url;
    element.target = "_blank";
    element.rel = "noopener noreferrer";
  } else {
    element.type = "button";
    element.disabled = true;
    element.title = "לא הוגדר מספר טלפון תקין";
  }
  return element;
}
