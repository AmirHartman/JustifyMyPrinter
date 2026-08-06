const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function responseRecorder() {
  return {
    body: undefined,
    headers: {},
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

function loadHandler(relativeFile, { user, sql }) {
  const handlerPath = require.resolve(path.join(root, relativeFile));
  const dbPath = require.resolve(path.join(root, 'api/_db.js'));
  const middlewarePath = require.resolve(path.join(root, 'api/_middleware.js'));
  const pricingPath = require.resolve(path.join(root, 'api/_pricing.js'));
  const replacements = new Map([
    [dbPath, { getSql: () => sql }],
    [middlewarePath, {
      parseBody: async () => ({}),
      requireAdmin: async () => null,
      requireAuth: async (_req, res) => {
        if (user) return user;
        res.status(401).json({ error: 'Authentication required' });
        return null;
      },
    }],
    // Only the price calculation is faked; the pure shape helpers stay real, so
    // the fake cannot drift from the module's actual contract.
    [pricingPath, {
      ...require(pricingPath),
      calculateProductCost: () => ({ productionCost: 8, shopPrice: 12 }),
    }],
  ]);
  const previous = new Map();

  for (const [modulePath, exports] of replacements) {
    previous.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports,
    };
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

test('catalog collection handlers deny anonymous reads before database access', async () => {
  for (const relativeFile of ['api/products.js', 'api/categories.js']) {
    let databaseCalls = 0;
    const handler = loadHandler(relativeFile, {
      user: null,
      sql: () => {
        databaseCalls += 1;
        throw new Error('database must not be reached');
      },
    });
    const res = responseRecorder();

    await handler({ method: 'GET', query: {} }, res);

    assert.equal(res.statusCode, 401, relativeFile);
    assert.deepEqual(res.body, { error: 'Authentication required' }, relativeFile);
    assert.equal(databaseCalls, 0, relativeFile);
  }
});

test('catalog collection handlers allow authenticated friend reads', async () => {
  const categorySql = async () => [{
    id: 'category-1',
    name: 'Useful prints',
    description: 'Published category',
    active: true,
    sort_order: 1,
  }];
  const categories = loadHandler('api/categories.js', {
    user: { id: 'friend-1', role: 'friend' },
    sql: categorySql,
  });
  const categoryResponse = responseRecorder();
  await categories({ method: 'GET', query: {} }, categoryResponse);
  assert.equal(categoryResponse.statusCode, 200);
  assert.deepEqual(categoryResponse.body, [{
    id: 'category-1',
    name: 'Useful prints',
    description: 'Published category',
    active: true,
    sortOrder: 1,
  }]);

  const productSql = async (strings) => {
    const query = strings.join(' ');
    if (/FROM products ORDER BY/.test(query)) {
      return [{
        id: 'product-1',
        name: 'Authenticated product',
        description: 'Visible only after login',
        image: '/image.jpg',
        category: 'Useful prints',
        active: true,
        catalog_kind: 'idea',
        possible_colors: [],
        required_colors: [],
      }];
    }
    return [];
  };
  const products = loadHandler('api/products.js', {
    user: { id: 'friend-1', role: 'friend' },
    sql: productSql,
  });
  const productResponse = responseRecorder();
  await products({ method: 'GET', query: {} }, productResponse);
  assert.equal(productResponse.statusCode, 200);
  assert.equal(productResponse.body.length, 1);
  assert.equal(productResponse.body[0].id, 'product-1');
  assert.equal(Object.hasOwn(productResponse.body[0], 'internalPrintNotes'), false);
});
