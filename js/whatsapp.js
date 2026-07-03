export const STATUS_LABELS = {
  new: "הזמנה חדשה",
  waiting_approval: "ממתין לאישור",
  waiting_print: "ממתין להדפסה",
  printing: "בהדפסה",
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

export function createWhatsAppLink({ phone, message, label, className = "" }) {
  const url = whatsappUrl(phone, message);
  const element = document.createElement(url ? "a" : "button");
  element.className = `whatsapp-button ${className}`.trim();
  element.textContent = label;
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
