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

  const pricePerGram = (filament) => {
    const spoolPrice = Number(filament?.spoolPrice);
    const spoolGrams = Number(filament?.spoolGrams);
    if (Number.isFinite(spoolPrice) && spoolPrice >= 0 && spoolGrams > 0) return spoolPrice / spoolGrams;
    return (Number(filament?.pricePerKg) || 0) / 1000;
  };
  const materialCost = (product?.materials ?? []).reduce((sum, m) => {
    const f = (filaments ?? []).find((f) => f.id === m.filamentId);
    return sum + (Number(m.grams) || 0) * quantity * pricePerGram(f);
  }, (Number(product?.purgeGrams) || 0) * quantity * pricePerGram(filaments?.[0]));

  const electricityCost = totalHours * (Number(profile.wattsAvg) || 0) / 1000
    * (Number(pricingSettings?.electricityPricePerKwh) || 0);
  const wearRate = (pricingSettings?.wearParts ?? [])
    .filter((part) => !part.amsOnly || profileKey === 'ams')
    .reduce((sum, part) => sum + Number(part.priceIls) / Number(part.lifetimeHours), 0);
  const wearCost = totalHours * wearRate;
  const machineCost = totalHours * (Number(pricingSettings?.machine?.priceIls) || 0)
    / Math.max(Number(pricingSettings?.machine?.lifeHours) || 1, 1);
  const productionCost = materialCost + electricityCost + wearCost + machineCost;
  const riskPercent = product?.riskPercent == null ? Number(profile.riskPercent) || 0 : Number(product.riskPercent) || 0;
  const riskCost = productionCost * riskPercent;
  const costWithRisk = productionCost + riskCost;
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
