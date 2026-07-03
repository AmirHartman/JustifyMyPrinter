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

export function calculateProductCost(product, filaments, pricingSettings) {
  const printHours = Number(product?.printHours) || 0;
  const profileKey = product?.printProfile ?? 'regular';
  const profile    = pricingSettings?.printProfiles?.[profileKey]
                  ?? pricingSettings?.printProfiles?.regular
                  ?? { wearPerHour: 0, fixedWear: 0, riskPercent: 0 };
  const electricityPerHour = Number(pricingSettings?.electricityPerHour) || 0;

  const materialCost = (product?.materials ?? []).reduce((sum, m) => {
    const f = (filaments ?? []).find((f) => f.id === m.filamentId);
    return sum + (Number(m.grams) || 0) * (Number(f?.pricePerKg) || 0) / 1000;
  }, 0);

  const electricityCost  = printHours * electricityPerHour;
  const hourlyWearCost   = printHours * (Number(profile.wearPerHour) || 0);
  const fixedWear        = Number(profile.fixedWear) || 0;
  const subtotal         = materialCost + electricityCost + hourlyWearCost + fixedWear;
  const riskCost         = subtotal * (Number(profile.riskPercent) || 0);
  const finalBeforeRound = subtotal + riskCost;
  const finalCost        = Math.ceil(finalBeforeRound);

  return { materialCost, electricityCost, hourlyWearCost, fixedWear, subtotal, riskCost, finalBeforeRound, finalCost };
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
