const PLA_COST_PER_KG = 60;

export function formatCurrency(value) {
  const numericValue = Number(value) || 0;
  const fractionDigits = Number.isInteger(numericValue) ? 0 : 2;
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numericValue);
}

export function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

export function estimatePlaCost(weightGrams) {
  return Math.ceil((weightGrams / 1000) * PLA_COST_PER_KG);
}

export function createAiProductDraft(idea) {
  const trimmedIdea = idea.trim();
  const estimatedWeightGrams = 120;
  return {
    name: trimmedIdea ? `פתרון מודפס - ${trimmedIdea}` : "ארגונית קטנה לבית",
    cost: estimatePlaCost(estimatedWeightGrams),
    grams: estimatedWeightGrams,
    description: trimmedIdea
      ? `מוצר פרקטי בהדפסת PLA עבור ${trimmedIdea}. העלות חושבה לפי הערכת משקל של כ-${estimatedWeightGrams} גרם.`
      : `מוצר קטן ושימושי לבית, מתאים לסידור יומיומי. העלות חושבה לפי הערכת משקל של כ-${estimatedWeightGrams} גרם.`,
    image: "",
    stlUrl: "",
  };
}
