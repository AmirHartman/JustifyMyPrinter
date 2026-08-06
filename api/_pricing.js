const config = require('../config/pricing.json');

const DEFAULT_SETTINGS = Object.freeze({
  marginPercent: 0.5,
  minOrderPrice: 5,
  roundingMode: 'ceil',
  // "untested" is not a level the admin picks per product: it is the tier a model
  // that has never been printed is charged at, whatever level was chosen for it.
  riskPercentByLevel: Object.freeze({ low: 0.08, medium: 0.15, high: 0.25, untested: 0.35 }),
});

const RISK_LEVELS = ['low', 'medium', 'high'];

// Printer/machine recovery is a flat surcharge on top of the print cost,
// applied after the risk addition (not an hourly wear rate).
const MACHINE_RECOVERY_PERCENT = 0.10;

function normalizedRiskPercents(value = {}) {
  const source = value.riskPercentByLevel || value.riskPercents || {};
  const read = (level) => {
    const candidate = source[level] ?? value[`${level}RiskPercent`];
    const number = Number(candidate);
    return Number.isFinite(number) && number >= 0 ? number : DEFAULT_SETTINGS.riskPercentByLevel[level];
  };
  // Settings saved before the untested tier existed simply fall back to its
  // default, so no migration is needed.
  return { low: read('low'), medium: read('medium'), high: read('high'), untested: read('untested') };
}

// A model that has never been printed carries the full unknown-risk surcharge,
// whatever level the admin picked for it. The chosen level starts applying only
// once the product is a printed one, which makes promotion the single visible
// moment where its price can drop.
function effectiveRiskTier(product = {}) {
  if (product.catalogKind === 'idea') return 'untested';
  return RISK_LEVELS.includes(product.riskLevel) ? product.riskLevel : 'medium';
}

// Enough real data to price a print. Deliberately does not look at `cost`:
// withCurrentPrice overwrites it with shopPrice, which is floored at
// minOrderPrice, so cost is never 0 and a cost check would prove nothing.
function hasPrintData(product = {}) {
  const materials = Array.isArray(product.materials) ? product.materials : [];
  return Number(product.printHours) > 0
    && materials.length > 0
    && materials.every((material) => material?.filamentId && Number(material.grams) > 0);
}

function editableSettings(value = {}) {
  return {
    marginPercent: value.marginPercent == null ? DEFAULT_SETTINGS.marginPercent : Number(value.marginPercent),
    minOrderPrice: value.minOrderPrice == null ? DEFAULT_SETTINGS.minOrderPrice : Number(value.minOrderPrice),
    roundingMode: 'ceil',
    riskPercentByLevel: normalizedRiskPercents(value),
    wearParts: Array.isArray(value.wearParts) ? value.wearParts : config.wearParts,
    maintenanceTasks: Array.isArray(value.maintenanceTasks) ? value.maintenanceTasks : config.maintenanceTasks,
  };
}

function mergedSettings(value = {}) {
  return { ...config, ...editableSettings(value) };
}

function wearPerHour(profileKey, wearParts = config.wearParts) {
  return (Array.isArray(wearParts) ? wearParts : config.wearParts)
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
  const pricePerGram = (filamentId) => {
    const filament = filaments.find((item) => item.id === filamentId);
    const spoolPrice = Number(filament?.spoolPrice);
    const spoolGrams = Number(filament?.spoolGrams);
    return Number.isFinite(spoolPrice) && spoolPrice > 0 && spoolGrams > 0
      ? spoolPrice / spoolGrams
      : (Number(filament?.pricePerKg) || 0) / 1000;
  };
  let materialGrams = purgeGrams * quantity;
  let materialCost = 0;
  for (const material of product.materials || []) {
    const grams = Math.max(Number(material.grams) || 0, 0) * quantity;
    materialGrams += grams;
    materialCost += grams * pricePerGram(material.filamentId);
  }
  // Purge/flush waste is filament that really leaves the spool, so it is billed
  // like any other gram. It is priced with the first material's filament.
  materialCost += purgeGrams * quantity * pricePerGram(product.materials?.[0]?.filamentId);
  const electricityCost = totalHours * Number(profile.wattsAvg) / 1000 * Number(settings.electricityPricePerKwh);
  const wearCost = totalHours * wearPerHour(profileKey, settings.wearParts);
  const productionCost = materialCost + electricityCost + wearCost;
  // An untested model is coerced through both branches, so a stored risk_percent
  // cannot dodge the surcharge either.
  const riskTier = effectiveRiskTier(product);
  const riskPercent = riskTier === 'untested' || product.riskLevel
    ? Number(settings.riskPercentByLevel[riskTier])
    : product.riskPercent == null
      ? Number(settings.riskPercentByLevel[riskTier] ?? profile.riskPercent)
      : Math.max(Number(product.riskPercent) || 0, 0);
  const riskCost = productionCost * riskPercent;
  const costBeforeMachine = productionCost + riskCost;
  const machineCost = costBeforeMachine * MACHINE_RECOVERY_PERCENT;
  const costWithRisk = costBeforeMachine + machineCost;
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
    productionCost, subtotal: productionCost, riskCost, riskPercent, riskTier, costWithRisk,
    marginPercent, marginAmount: shopPrice - costWithRisk, pricedCost, productFloor,
    minOrderPrice, floorApplied, shopPrice, finalCost: shopPrice, totalHours, materialGrams,
  };
}

module.exports = {
  config, DEFAULT_SETTINGS, MACHINE_RECOVERY_PERCENT, RISK_LEVELS,
  editableSettings, mergedSettings, wearPerHour, calculateProductCost,
  effectiveRiskTier, hasPrintData,
};
