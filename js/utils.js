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

// Filament display name is derived, not entered: manufacturer + type + color,
// e.g. "eSun PLA Black". Mirrors composeFilamentName in api/filaments.js.
export function composeFilamentName(manufacturer, materialType, colorName) {
  return [manufacturer, materialType, colorName]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// Printer/machine recovery is a flat surcharge on top of the print cost,
// applied after the risk addition (not an hourly wear rate). Mirrors api/_pricing.js.
const MACHINE_RECOVERY_PERCENT = 0.10;

export function calculateProductCost(product, filaments, pricingSettings, options = {}) {
  const quantity = Math.max(Number(options.quantity ?? product?.quantity) || 1, 1);
  const printHours = Number(product?.printHours) || 0;
  const additionalCopyHours = product?.additionalCopyHours == null
    ? printHours : Math.max(Number(product.additionalCopyHours) || 0, 0);
  const totalHours = printHours + additionalCopyHours * (quantity - 1);
  const profileKey = product?.printProfile ?? 'regular';
  const profile    = pricingSettings?.printProfiles?.[profileKey]
                  ?? pricingSettings?.printProfiles?.regular
                  ?? { wattsAvg: 0, riskPercent: 0 };

  const pricePerGram = (filamentId) => {
    const filament = (filaments ?? []).find((item) => item.id === filamentId);
    const spoolPrice = Number(filament?.spoolPrice);
    const spoolGrams = Number(filament?.spoolGrams);
    if (Number.isFinite(spoolPrice) && spoolPrice > 0 && spoolGrams > 0) return spoolPrice / spoolGrams;
    return (Number(filament?.pricePerKg) || 0) / 1000;
  };
  // Mirrors api/_pricing.js: purge waste is billed, priced with the first material's filament.
  const materialCost = (product?.materials ?? []).reduce(
    (sum, m) => sum + (Number(m.grams) || 0) * quantity * pricePerGram(m.filamentId),
    (Number(product?.purgeGrams) || 0) * quantity * pricePerGram(product?.materials?.[0]?.filamentId),
  );

  const electricityCost = totalHours * (Number(profile.wattsAvg) || 0) / 1000
    * (Number(pricingSettings?.electricityPricePerKwh) || 0);
  const wearRate = (pricingSettings?.wearParts ?? [])
    .filter((part) => !part.amsOnly || profileKey === 'ams')
    .reduce((sum, part) => sum + Number(part.priceIls) / Number(part.lifetimeHours), 0);
  const wearCost = totalHours * wearRate;
  const productionCost = materialCost + electricityCost + wearCost;
  // Risk follows the configured level, as in api/_pricing.js. profile.riskPercent
  // is only a last-resort fallback for settings that predate riskPercentByLevel.
  const riskByLevel = pricingSettings?.riskPercentByLevel ?? pricingSettings?.riskPercents ?? {};
  const riskLevel = ['low', 'medium', 'high'].includes(product?.riskLevel) ? product.riskLevel : 'medium';
  const riskPercent = product?.riskLevel != null && riskByLevel[riskLevel] != null
    ? Number(riskByLevel[riskLevel])
    : product?.riskPercent == null
      ? Number(riskByLevel[riskLevel] ?? profile.riskPercent) || 0
      : Math.max(Number(product.riskPercent) || 0, 0);
  const riskCost = productionCost * riskPercent;
  const costBeforeMachine = productionCost + riskCost;
  const machineCost = costBeforeMachine * MACHINE_RECOVERY_PERCENT;
  const costWithRisk = costBeforeMachine + machineCost;
  const internal = Boolean(options.internal);
  const marginPercent = internal ? 0 : options.marginPercent == null
    ? Number(pricingSettings?.marginPercent) || 0 : Number(options.marginPercent) || 0;
  const pricedCost = costWithRisk * (1 + marginPercent);
  const minOrderPrice = internal ? 0 : Number(pricingSettings?.minOrderPrice) || 0;
  const productFloor = internal ? 0 : (Number(product?.minUnitPrice) || 0) * quantity;
  const shopPrice = internal ? costWithRisk : Math.ceil(Math.max(pricedCost, minOrderPrice, productFloor));
  const floorApplied = internal || (pricedCost >= minOrderPrice && pricedCost >= productFloor)
    ? null : productFloor >= minOrderPrice ? 'product' : 'order';

  return { materialCost, electricityCost, wearCost, hourlyWearCost: wearCost, machineCost,
    productionCost, subtotal: productionCost, riskCost, riskPercent, costWithRisk,
    marginPercent, marginAmount: shopPrice - costWithRisk, pricedCost, productFloor,
    minOrderPrice, floorApplied, shopPrice, finalCost: shopPrice, totalHours };
}
