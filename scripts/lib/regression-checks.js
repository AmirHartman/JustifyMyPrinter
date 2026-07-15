const fs = require('fs');
const path = require('path');

const read = (root, file) => {
  const full = path.join(root, file);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
};

function checkRegressions(root = process.cwd(), overrides = {}) {
  const source = (file) => Object.hasOwn(overrides, file) ? overrides[file] : read(root, file);
  const orders = source('api/orders.js');
  const products = source('api/products.js');
  const init = source('api/init.js');
  const app = source('js/app.js');
  const render = source('js/render.js');
  const spec = source('docs/PRODUCT_SPEC.md');
  const envExample = source('env.local.example');

  const checks = [
    ['R1', !/customText|custom_text/.test([orders, products, render, spec].join('\n')),
      'Custom-text product/order contract is fully removed outside DB compatibility columns'],
    ['R2', /waste_deducted_grams/.test(init) && /deductOrderInventory/.test(orders),
      'Waste and completion deductions use independent retryable accounting'],
    ['R3', !/newSpoolBtn/.test(render), 'Category rendering has no undefined filament action'],
    ['R4', /NODE_ENV\s*===\s*['"]development['"]/.test(source('api/_init-auth.js'))
      && /^NODE_ENV=development$/m.test(envExample), 'Init bypass is explicit-development only'],
    ['R5', /result\.role\s*===\s*['"]admin['"][\s\S]{0,100}dashboard\.html/.test(app),
      'Admin login redirects to dashboard'],
    ['R6', /submitManagedForm/.test(app)
      && /goal-form/.test(app) && /ledger-form/.test(app),
      'Goal and ledger submissions share guarded button/error handling'],
    ['R7', /PAST_STATUSES\s*=\s*new Set\(\[[^\]]*['"]failed['"]/.test(render)
      && /`failed`/.test(spec), 'Failed is documented and treated as closed'],
    ['R8', /status\s*===\s*'failed'[\s\S]{0,100}status\s*<>\s*'failed'/.test(orders),
      'Failure attempts increment only on transition into failed'],
    ['R9', /risk_level IS NULL OR risk_level NOT IN/.test(init)
      && !/risk_percent <= 0\.12|risk_percent >= 0\.20/.test(init),
      'Init repairs only missing/invalid risk levels'],
  ];

  return checks.map(([id, passed, description]) => ({ id, passed, description }));
}

module.exports = { checkRegressions };
