const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function responseRecorder() {
  return {
    body: undefined,
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

function productRow() {
  return {
    id: 'product-1', name: 'Timestamp fixture', cost: 10, grams: 10,
    description: '', image: '', stl_url: '', source_url: '', category: '', category_ids: [],
    active: true, print_hours: 0, print_profile: 'regular', images: [], materials: [],
    manual_price_enabled: false, manual_price: null, purge_grams: 0,
    possible_colors: [], required_colors: [], requires_admin_approval: false, allow_multiple: true,
    print_file_uploaded_at: null,
  };
}

function loadHandler({ body, sql }) {
  const handlerPath = require.resolve(path.join(root, 'api/products.js'));
  const replacements = new Map([
    [require.resolve(path.join(root, 'api/_db.js')), { getSql: () => sql }],
    [require.resolve(path.join(root, 'api/_middleware.js')), {
      parseBody: async () => body,
      requireAuth: async () => ({ id: 'admin-1', role: 'admin' }),
      requireAdmin: async () => ({ id: 'admin-1', role: 'admin' }),
    }],
    // Only the price calculation is faked; the pure shape helpers stay real, so
    // the fake cannot drift from the module's actual contract.
    [require.resolve(path.join(root, 'api/_pricing.js')), {
      ...require(path.join(root, 'api/_pricing.js')),
      calculateProductCost: () => ({ productionCost: 5, shopPrice: 10 }),
    }],
  ]);
  const previous = new Map();
  for (const [modulePath, exports] of replacements) {
    previous.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports };
  }
  delete require.cache[handlerPath];
  try {
    return require(handlerPath);
  } finally {
    delete require.cache[handlerPath];
    for (const [modulePath, cached] of previous) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
}

function timestampParameter({ strings, values }) {
  const cast = strings.findIndex((part) => part.includes('::timestamptz'));
  assert.notEqual(cast, -1, 'product write must bind a timestamptz parameter');
  return values[cast - 1];
}

test('product writes normalize blank print-file upload timestamps before the timestamptz bind', async () => {
  for (const scenario of [
    { method: 'PUT', query: { id: 'product-1' }, body: { printFileUploadedAt: '' }, expectedStatus: 200 },
    { method: 'POST', query: {}, body: { name: 'Timestamp fixture', printFileUploadedAt: '   ' }, expectedStatus: 201 },
  ]) {
    const writes = [];
    const sql = async (strings, ...values) => {
      const query = strings.join(' ');
      if (/UPDATE products SET|INSERT INTO products/.test(query)) {
        writes.push({ strings, values });
        return [productRow()];
      }
      if (/FROM filaments|FROM settings/.test(query)) return [];
      throw new Error(`Unexpected SQL: ${query}`);
    };
    const handler = loadHandler({ body: scenario.body, sql });
    const res = responseRecorder();

    await handler({ method: scenario.method, query: scenario.query }, res);

    assert.equal(res.statusCode, scenario.expectedStatus, scenario.method);
    assert.equal(writes.length, 1, scenario.method);
    const value = timestampParameter(writes[0]);
    assert.equal(value, null, `${scenario.method} must bind blank timestamps as null`);
    assert.equal(typeof value === 'string' && value.trim() === '', false, `${scenario.method} must not bind an empty timestamp`);
  }
});
