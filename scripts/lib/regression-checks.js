const fs = require('fs');
const path = require('path');

function authenticatedCollectionContract(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return false;
  const end = source.indexOf("if (req.method === 'POST')", start);
  const block = source.slice(start, end < 0 ? undefined : end);
  const guard = block.indexOf('await requireAuth(req, res)');
  const stop = block.indexOf('if (!user) return');
  const database = block.indexOf('const sql = getSql()');
  return guard >= 0 && stop > guard && database > stop && !/getSession/.test(block);
}

const DEFINITIONS = [
  {
    id: 'R1',
    description: 'Custom-text product/order contract is fully removed outside DB compatibility columns',
    requiredFiles: ['api/orders.js', 'api/products.js', 'js/render.js', 'docs/PRODUCT_SPEC.md'],
    relatedEvidence: [],
    evaluate: ({ sources }) => !/customText|custom_text/.test([
      sources['api/orders.js'],
      sources['api/products.js'],
      sources['js/render.js'],
      sources['docs/PRODUCT_SPEC.md'],
    ].join('\n')),
  },
  {
    id: 'R2',
    description: 'Waste and completion deductions use independent retryable accounting',
    requiredFiles: ['api/init.js', 'api/orders.js'],
    relatedEvidence: ['T1 tests/order-inventory.test.js'],
    evaluate: ({ sources }) => /waste_deducted_grams/.test(sources['api/init.js'])
      && /deductOrderInventory/.test(sources['api/orders.js']),
  },
  {
    id: 'R3',
    description: 'Category rendering has no undefined filament action',
    requiredFiles: ['js/render.js'],
    relatedEvidence: [],
    evaluate: ({ sources }) => !/newSpoolBtn/.test(sources['js/render.js']),
  },
  {
    id: 'R4',
    description: 'Init bypass is explicit-development only',
    requiredFiles: ['api/_init-auth.js', 'env.local.example'],
    relatedEvidence: ['T1 tests/init-auth.test.js'],
    evaluate: ({ sources }) => /NODE_ENV\s*===\s*['"]development['"]/.test(sources['api/_init-auth.js'])
      && /^NODE_ENV=development$/m.test(sources['env.local.example']),
  },
  {
    id: 'R5',
    description: 'Admin login redirects to dashboard',
    requiredFiles: ['js/app.js'],
    relatedEvidence: [],
    evaluate: ({ sources }) => /result\.role\s*===\s*['"]admin['"][\s\S]{0,100}dashboard\.html/.test(sources['js/app.js']),
  },
  {
    id: 'R6',
    description: 'Goal and ledger submissions share guarded button/error handling',
    requiredFiles: ['js/app.js'],
    relatedEvidence: [],
    evaluate: ({ sources }) => /submitManagedForm/.test(sources['js/app.js'])
      && /goal-form/.test(sources['js/app.js'])
      && /ledger-form/.test(sources['js/app.js']),
  },
  {
    id: 'R7',
    description: 'Failed is documented and treated as closed',
    requiredFiles: ['js/render.js', 'docs/PRODUCT_SPEC.md'],
    relatedEvidence: [],
    evaluate: ({ sources }) => /PAST_STATUSES\s*=\s*new Set\(\[[^\]]*['"]failed['"]/.test(sources['js/render.js'])
      && /`failed`/.test(sources['docs/PRODUCT_SPEC.md']),
  },
  {
    id: 'R8',
    description: 'Failure attempts increment only on transition into failed',
    requiredFiles: ['api/orders.js'],
    relatedEvidence: [],
    evaluate: ({ sources }) => /status\s*===\s*'failed'[\s\S]{0,100}status\s*<>\s*'failed'/.test(sources['api/orders.js']),
  },
  {
    id: 'R9',
    description: 'Init repairs only missing or invalid risk levels',
    requiredFiles: ['api/init.js'],
    relatedEvidence: [],
    evaluate: ({ sources }) => /risk_level IS NULL OR risk_level NOT IN/.test(sources['api/init.js'])
      && !/risk_percent <= 0\.12|risk_percent >= 0\.20/.test(sources['api/init.js']),
  },
  {
    id: 'R10',
    description: 'Catalog page and collection data require authentication',
    requiredFiles: ['api/products.js', 'api/categories.js', 'server.js', 'js/app.js', 'docs/PRODUCT_SPEC.md'],
    relatedEvidence: ['T1 tests/catalog-auth.test.js', 'T3 optional isolated local HTTP smoke'],
    evaluate: ({ sources }) => {
      const serverRoute = sources['server.js'].match(/app\.get\(['"]\/catalog\.html['"][\s\S]*?\n\}\);/)?.[0] || '';
      const clientGuard = sources['js/app.js'].match(/if \(\[[\s\S]{0,80}\.includes\(pageName\) && !store\.currentUser\)[\s\S]{0,120}\n\s*\}/)?.[0] || '';
      return authenticatedCollectionContract(sources['api/products.js'], '/api/products — collection operations')
        && authenticatedCollectionContract(sources['api/categories.js'], '/api/categories — collection operations')
        && /await getSession\(req\)/.test(serverRoute)
        && /if \(!user\) return res\.redirect\(302, ['"]\/dashboard\.html['"]\)/.test(serverRoute)
        && /sendFile\([\s\S]*['"]catalog\.html['"]/.test(serverRoute)
        && /["']welcome["'][\s\S]{0,40}["']catalog["']/.test(clientGuard)
        && /dashboard\.html/.test(clientGuard)
        && /const shouldLoadData\s*=\s*store\.currentUser\s*&&/.test(sources['js/app.js'])
        && /Cannot view the catalog without registering and logging in/.test(sources['docs/PRODUCT_SPEC.md'])
        && /Published products are visible only to authenticated users/.test(sources['docs/PRODUCT_SPEC.md']);
    },
  },
];

function loadSource(root, file, overrides) {
  if (Object.hasOwn(overrides, file)) {
    return { exists: true, content: String(overrides[file]) };
  }
  const full = path.join(root, file);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return { exists: false, content: '' };
  }
  return { exists: true, content: fs.readFileSync(full, 'utf8') };
}

function checkRegressions(root = process.cwd(), overrides = {}) {
  return DEFINITIONS.map((definition) => {
    const loaded = Object.fromEntries(definition.requiredFiles.map((file) => [
      file,
      loadSource(root, file, overrides),
    ]));
    const missingFiles = definition.requiredFiles.filter((file) => !loaded[file].exists);
    const sources = Object.fromEntries(Object.entries(loaded).map(([file, value]) => [
      file,
      value.content,
    ]));
    let matchesContract = false;
    if (missingFiles.length === 0) {
      try {
        matchesContract = Boolean(definition.evaluate({ sources }));
      } catch {
        matchesContract = false;
      }
    }
    return {
      id: definition.id,
      tier: 'T2',
      passed: missingFiles.length === 0 && matchesContract,
      description: definition.description,
      requiredFiles: [...definition.requiredFiles],
      missingFiles,
      relatedEvidence: [...definition.relatedEvidence],
      proves: 'The required repository sources currently match this static regression contract.',
      doesNotProve: 'Runtime reachability, database behavior, or browser behavior.',
    };
  });
}

module.exports = { DEFINITIONS, checkRegressions };
