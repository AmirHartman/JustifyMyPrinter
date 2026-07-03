const { timingSafeEqual } = require('crypto');
const { getSql } = require('./_db');
const { SEED_PRODUCTS, SEED_USERS, SEED_ORDERS } = require('./_seed');
const { hashPassword } = require('./_password');

function canInitialize(req) {
  if (process.env.NODE_ENV !== 'production') return true;
  const expected = process.env.INIT_SECRET;
  if (!expected) return false;
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const supplied = String(req.headers['x-init-secret'] || bearer);
  if (!supplied) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length
    && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!canInitialize(req)) {
    const status = process.env.INIT_SECRET ? 403 : 503;
    return res.status(status).json({ error: status === 503 ? 'Database initialization is not configured' : 'Forbidden' });
  }

  const sql = getSql();

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        full_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'friend',
        password TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        rejection_reason TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT NULL`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS how_you_know_admin TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_message TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;

    await sql`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cost NUMERIC(10,2) NOT NULL,
        grams INTEGER NOT NULL,
        description TEXT DEFAULT '',
        image TEXT DEFAULT '',
        stl_url TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        product_id TEXT,
        friend_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        price NUMERIC(10,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        paid BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_role TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        user_name TEXT NOT NULL,
        sender TEXT NOT NULL,
        content TEXT NOT NULL,
        read_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
        read_by_user  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_name TEXT NOT NULL,
        message TEXT NOT NULL,
        order_id TEXT,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    // messages and notifications are legacy MVP tables, retained for backward compatibility.

    // ── Extended order columns ────────────────────────────────
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id TEXT`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'catalog'`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_description TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_model_link TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS selected_colors JSONB NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_notes TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_notes TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS base_cost NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS support_amount NUMERIC(10,2) NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_amount NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_material_weight NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_print_time NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS requires_user_price_approval BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_approved_price BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;

    // ── Extended product columns ──────────────────────────────
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS source_url TEXT DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_hours NUMERIC(6,2) DEFAULT 0`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_profile TEXT DEFAULT 'regular'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS materials JSONB DEFAULT '[]'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS calculated_cost NUMERIC(10,2)`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS manual_price_enabled BOOLEAN DEFAULT FALSE`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS manual_price NUMERIC(10,2)`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS possible_colors JSONB NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS required_colors JSONB NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_admin_approval BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS allow_multiple BOOLEAN NOT NULL DEFAULT TRUE`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS internal_print_notes TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_ids JSONB NOT NULL DEFAULT '[]'`;

    // ── Categories table (dynamic, admin-managed) ─────────────
    await sql`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    const SEED_CATEGORIES = [
      { id: 'cat-kitchen',  name: 'מטבח',        sortOrder: 1 },
      { id: 'cat-kids',     name: 'ילדים',        sortOrder: 2 },
      { id: 'cat-office',   name: 'עבודה / משרד', sortOrder: 3 },
      { id: 'cat-car',      name: 'רכב',          sortOrder: 4 },
      { id: 'cat-garden',   name: 'גינה',         sortOrder: 5 },
      { id: 'cat-bathroom', name: 'אמבטיה',       sortOrder: 6 },
      { id: 'cat-ideas',    name: 'רעיונות עתידיים', sortOrder: 7 },
    ];
    for (const c of SEED_CATEGORIES) {
      await sql`
        INSERT INTO categories (id, name, sort_order)
        VALUES (${c.id}, ${c.name}, ${c.sortOrder})
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // ── Filaments table ───────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS filaments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        material_type TEXT NOT NULL DEFAULT 'PLA',
        color_hex TEXT NOT NULL DEFAULT '#000000',
        price_per_kg NUMERIC(10,2) NOT NULL DEFAULT 80,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        note TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    const SEED_FILAMENTS = [
      { id: 'filament-black-pla', name: 'שחור PLA',  materialType: 'PLA', colorHex: '#111111', pricePerKg: 80 },
      { id: 'filament-white-pla', name: 'לבן PLA',   materialType: 'PLA', colorHex: '#ffffff', pricePerKg: 80 },
      { id: 'filament-red-pla',   name: 'אדום PLA',  materialType: 'PLA', colorHex: '#ff0000', pricePerKg: 80 },
    ];
    for (const f of SEED_FILAMENTS) {
      await sql`
        INSERT INTO filaments (id, name, material_type, color_hex, price_per_kg)
        VALUES (${f.id}, ${f.name}, ${f.materialType}, ${f.colorHex}, ${f.pricePerKg})
        ON CONFLICT (id) DO NOTHING
      `;
    }

    // ── Settings table ────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        amount NUMERIC(10,2) NOT NULL,
        expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    const DEFAULT_PRICING = {
      electricityPerHour: 0.13,
      roundingMode: 'ceil',
      printProfiles: {
        regular: { label: 'רגיל',               wearPerHour: 1.5, fixedWear: 2, riskPercent: 0.12 },
        ams:     { label: 'AMS / ריבוי צבעים',  wearPerHour: 2.0, fixedWear: 3, riskPercent: 0.15 },
        complex: { label: 'הדפסה מורכבת',        wearPerHour: 2.5, fixedWear: 5, riskPercent: 0.20 },
      },
    };
    await sql`
      INSERT INTO settings (key, value)
      VALUES ('pricing', ${JSON.stringify(DEFAULT_PRICING)})
      ON CONFLICT (key) DO NOTHING
    `;

    for (const u of SEED_USERS) {
      const passwordHash = await hashPassword(u.password);
      await sql`
        INSERT INTO users (id, name, full_name, email, role, password, status)
        VALUES (${u.id}, ${u.name}, ${u.fullName}, ${u.email}, ${u.role}, ${passwordHash}, ${u.status})
        ON CONFLICT (id) DO NOTHING
      `;
    }

    for (const p of SEED_PRODUCTS) {
      await sql`
        INSERT INTO products (id, name, cost, grams, description, image, stl_url)
        VALUES (${p.id}, ${p.name}, ${p.cost}, ${p.grams}, ${p.description}, ${p.image}, ${p.stlUrl})
        ON CONFLICT (id) DO NOTHING
      `;
    }

    for (const o of SEED_ORDERS) {
      await sql`
        INSERT INTO orders (id, product_id, friend_name, quantity, price, status, paid)
        VALUES (${o.id}, ${o.productId}, ${o.friendName}, ${o.quantity}, ${o.price}, ${o.status}, ${o.paid})
        ON CONFLICT (id) DO NOTHING
      `;
    }

    res.json({ ok: true, tables: ['users', 'products', 'orders', 'sessions', 'filaments', 'settings', 'expenses', 'categories'], seeded: true });
  } catch (err) {
    console.error('init error:', err);
    res.status(500).json({ error: err.message });
  }
};
