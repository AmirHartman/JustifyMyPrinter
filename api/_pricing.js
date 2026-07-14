const config = require('../config/pricing.json');

const DEFAULT_SETTINGS = Object.freeze({
  marginPercent: 0.5,
  minOrderPrice: 5,
  roundingMode: 'ceil',
  riskPercentByLevel: Object.freeze({ low: 0.08, medium: 0.15, high: 0.25 }),
});

function normalizedRiskPercents(value = {}) {
  const source = value.riskPercentByLevel || value.riskPercents || {};
  const read = (level) => {
    const candidate = source[level] ?? value[`${level}RiskPercent`];
    const number = Number(candidate);
    return Number.isFinite(number) && number >= 0 ? number : DEFAULT_SETTINGS.riskPercentByLevel[level];
  };
  return { low: read('low'), medium: read('medium'), high: read('high') };
}

function editableSettings(value = {}) {
  return {
    marginPercent: value.marginPercent == null ? DEFAULT_SETTINGS.marginPercent : Number(value.marginPercent),
    minOrderPrice: value.minOrderPrice == null ? DEFAULT_SETTINGS.minOrderPrice : Number(value.minOrderPrice),
    roundingMode: 'ceil',
    riskPercentByLevel: normalizedRiskPercents(value),
  };
}

function mergedSettings(value = {}) {
  return { ...config, ...editableSettings(value) };
}

function wearPerHour(profileKey) {
  return config.wearParts
    .filter((part) => !part.amsOnly || profileKey === 'ams')
    .reduce((sum, part) => sum + Number(part.priceIls) / Number(part.lifetimeHours), 0);
}

function calculateProductCost(product = {}, filaments = [], settingsValue = {}, options = {}) {
  const settings = mergedSettings(settingsValue);
  const quantity = Math.max(Number(options.quantity ?? product.quantity) || 1, 1);
  const profileKey = product.printProfile || 'regular';
  const profile = settings.printProfiles[profileKey] || settings.printProfiles.regular;
  const additionalCopyHours = product.additionalCopyHours == null
    ? Number(product.printHours) || 0
    : Math.max(Number(product.additionalCopyHours) || 0, 0);
  const totalHours = (Number(product.printHours) || 0) + additionalCopyHours * (quantity - 1);
  const purgeGrams = Math.max(Number(product.purgeGrams) || 0, 0);
  let materialGrams = purgeGrams * quantity;
  let materialCost = 0;
  for (const material of product.materials || []) {
    const grams = Math.max(Number(material.grams) || 0, 0) * quantity;
    materialGrams += grams;
    const filament = filaments.find((item) => item.id === material.filamentId);
    const spoolPrice = Number(filament?.spoolPrice);
    const spoolGrams = Number(filament?.spoolGrams);
    const pricePerGram = Number.isFinite(spoolPrice) && spoolPrice > 0 && spoolGrams > 0
      ? spoolPrice / spoolGrams
      : (Number(filament?.pricePerKg) || 0) / 1000;
    materialCost += grams * pricePerGram;
  }
  const electricityCost = totalHours * Number(profile.wattsAvg) / 1000 * Number(settings.electricityPricePerKwh);
  const wearCost = totalHours * wearPerHour(profileKey);
  const machineCost = totalHours * Number(settings.machine.priceIls) / Number(settings.machine.lifeHours);
  const productionCost = materialCost + electricityCost + wearCost + machineCost;
  const riskLevel = ['low', 'medium', 'high'].includes(product.riskLevel) ? product.riskLevel : 'medium';
  const riskPercent = product.riskLevel
    ? Number(settings.riskPercentByLevel[riskLevel])
    : product.riskPercent == null
      ? Number(settings.riskPercentByLevel[riskLevel] ?? profile.riskPercent)
      : Math.max(Number(product.riskPercent) || 0, 0);
  const riskCost = productionCost * riskPercent;
  const costWithRisk = productionCost + riskCost;
  const internal = Boolean(options.internal);
  const marginPercent = internal ? 0 : options.marginPercent == null
    ? Number(settings.marginPercent)
    : Math.max(Number(options.marginPercent) || 0, 0);
  const pricedCost = costWithRisk * (1 + marginPercent);
  const minOrderPrice = internal ? 0 : Number(settings.minOrderPrice) || 0;
  const productFloor = internal ? 0 : (Number(product.minUnitPrice) || 0) * quantity;
  const maximum = Math.max(pricedCost, minOrderPrice, productFloor);
  const shopPrice = internal ? costWithRisk : Math.ceil(maximum);
  const floorApplied = internal || pricedCost >= minOrderPrice && pricedCost >= productFloor
    ? null : productFloor >= minOrderPrice ? 'product' : 'order';
  return {
    materialCost, electricityCost, wearCost, hourlyWearCost: wearCost, machineCost,
    productionCost, subtotal: productionCost, riskCost, riskPercent, costWithRisk,
    marginPercent, marginAmount: shopPrice - costWithRisk, pricedCost, productFloor,
    minOrderPrice, floorApplied, shopPrice, finalCost: shopPrice, totalHours, materialGrams,
  };
}

module.exports = { config, DEFAULT_SETTINGS, editableSettings, mergedSettings, wearPerHour, calculateProductCost };
