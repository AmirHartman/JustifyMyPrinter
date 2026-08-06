const { getSql } = require('./_db');
const { SEED_PRODUCTS, SEED_USERS, SEED_ORDERS } = require('./_seed');
const { hashPassword } = require('./_password');
const { canInitialize } = require('./_init-auth');

function enabled(name) {
  return process.env[name] === 'true';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!canInitialize(req)) {
    const status = process.env.INIT_SECRET ? 403 : 503;
    return res.status(status).json({ error: status === 503 ? 'Database initialization is not configured' : 'Forbidden' });
  }

  const sql = getSql();
  const isProduction = process.env.NODE_ENV === 'production';
  const seedDemoData = enabled('SEED_DEMO_DATA');
  const bootstrapName = String(process.env.ADMIN_BOOTSTRAP_NAME || '').trim();
  const bootstrapPassword = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '');
  const canBootstrapAdmin = Boolean(bootstrapName && bootstrapPassword);
  const canSeedProductionDemoUsers = isProduction
    && seedDemoData
    && enabled('SEED_DEMO_USERS')
    && Boolean(process.env.DEMO_USER_PASSWORD);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        full_name TEXT NOT NULL DEFAULT '',
        gender TEXT NOT NULL DEFAULT 'male',
        role TEXT NOT NULL DEFAULT 'friend',
        password TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        rejection_reason TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'male'`;
    await sql`ALTER TABLE users DROP COLUMN IF EXISTS email`;
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
        grams NUMERIC(10,2) NOT NULL,
        description TEXT DEFAULT '',
        image TEXT DEFAULT '',
        stl_url TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Product material totals may come from slicers with decimal gram values.
    // Widen legacy INTEGER columns in place while preserving all existing data.
    await sql`ALTER TABLE products ALTER COLUMN grams TYPE NUMERIC(10,2) USING grams::NUMERIC(10,2)`;

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
    // Orders awaiting a quote used to be stored with a 0.01 placeholder to satisfy
    // the NOT NULL price column, which surfaced to friends as "₪0.01". Unpriced
    // orders now carry 0, and the UI shows "price to be set" instead of a number.
    await sql`UPDATE orders SET price = 0 WHERE final_amount IS NULL AND price = 0.01`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_material_weight NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_print_time NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS requires_user_price_approval BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_approved_price BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_cost NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS wear_component NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS machine_component NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS margin_component NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS print_hours NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS print_profile TEXT NOT NULL DEFAULT 'regular'`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS material_grams NUMERIC(10,2)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS wasted_grams NUMERIC(10,2) NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS wasted_hours NUMERIC(10,2) NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS waste_deducted_grams NUMERIC(10,2) NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS margin_percent NUMERIC(5,3)`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS internal BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_deducted BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_text TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_snapshot JSONB`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS proposed_alternative_color JSONB`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS color_alternative_status TEXT NOT NULL DEFAULT 'none'`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS color_alternative_proposed_at TIMESTAMPTZ`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS color_alternative_responded_at TIMESTAMPTZ`;
    // A cart checkout writes one order row per line, joined by a shared cart_id.
    // Every order placed before the cart existed keeps cart_id NULL and renders
    // exactly as it always did.
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cart_id TEXT`;
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cart_position INTEGER NOT NULL DEFAULT 0`;
    await sql`UPDATE orders SET color_alternative_status = 'none'
      WHERE color_alternative_status IS NULL OR color_alternative_status NOT IN ('none', 'needed', 'pending', 'approved', 'rejected')`;
    await sql`UPDATE orders SET paid_at = created_at WHERE paid = TRUE AND paid_at IS NULL`;
    // The friend area groups a checkout back together by cart_id on every load.
    await sql`CREATE INDEX IF NOT EXISTS orders_cart_id_idx ON orders(cart_id)`;

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
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS production_cost NUMERIC(10,2)`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS purge_grams NUMERIC(10,2) NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS risk_percent NUMERIC(4,3)`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS additional_copy_hours NUMERIC(6,2)`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS minimum_unit_price NUMERIC(10,2)`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS possible_colors JSONB NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS required_colors JSONB NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_admin_approval BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS allow_multiple BOOLEAN NOT NULL DEFAULT TRUE`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS internal_print_notes TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_ids JSONB NOT NULL DEFAULT '[]'`;
    // Retain the retired local-sync columns as database compatibility data. The
    // runtime no longer reads or writes them, but migrations stay additive and
    // never destroy existing product metadata.
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_sync_key TEXT`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_sync_filename TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_sync_checksum TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_sync_material_grams JSONB NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_sync_status TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_sync_warnings JSONB NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_synced_at TIMESTAMPTZ`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_file_url TEXT DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_file_name TEXT DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_file_checksum TEXT DEFAULT ''`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS print_file_uploaded_at TIMESTAMPTZ`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_kind TEXT NOT NULL DEFAULT 'printed'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'medium'`;
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS custom_text_enabled BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`UPDATE products SET risk_level = 'medium'
      WHERE risk_level IS NULL OR risk_level NOT IN ('low', 'medium', 'high')`;
    await sql`UPDATE products SET catalog_kind = 'printed' WHERE catalog_kind NOT IN ('printed', 'idea') OR catalog_kind IS NULL`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS products_print_sync_key_unique ON products (print_sync_key) WHERE print_sync_key IS NOT NULL`;

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
    if (seedDemoData) {
      for (const c of SEED_CATEGORIES) {
        await sql`
          INSERT INTO categories (id, name, sort_order)
          VALUES (${c.id}, ${c.name}, ${c.sortOrder})
          ON CONFLICT (id) DO NOTHING
        `;
      }
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
    await sql`ALTER TABLE filaments ADD COLUMN IF NOT EXISTS manufacturer TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE filaments ADD COLUMN IF NOT EXISTS color_name TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE filaments ADD COLUMN IF NOT EXISTS spool_price NUMERIC(10,2)`;
    await sql`ALTER TABLE filaments ADD COLUMN IF NOT EXISTS spool_grams INTEGER NOT NULL DEFAULT 1000`;
    await sql`ALTER TABLE filaments ADD COLUMN IF NOT EXISTS remaining_grams NUMERIC(10,2)`;
    await sql`UPDATE filaments SET spool_price = price_per_kg * spool_grams / 1000 WHERE spool_price IS NULL`;
    await sql`UPDATE filaments SET price_per_kg = spool_price * 1000 / spool_grams WHERE spool_price IS NOT NULL AND spool_grams > 0`;

    await sql`CREATE TABLE IF NOT EXISTS owner_ledger (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, description TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL, occurred_at DATE NOT NULL DEFAULT CURRENT_DATE,
      order_id TEXT, expense_id TEXT, notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    await sql`ALTER TABLE owner_ledger ADD COLUMN IF NOT EXISTS public_visible BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE owner_ledger ADD COLUMN IF NOT EXISTS public_label TEXT NOT NULL DEFAULT ''`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS owner_ledger_order_kind_idx ON owner_ledger(order_id, kind) WHERE order_id IS NOT NULL`;
    await sql`CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, target_amount NUMERIC(10,2) NOT NULL,
      saved NUMERIC(10,2) NOT NULL DEFAULT 0, achieved_at TIMESTAMPTZ,
      sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
    await sql`ALTER TABLE goals ADD COLUMN IF NOT EXISTS public_visible BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE goals ADD COLUMN IF NOT EXISTS public_label TEXT NOT NULL DEFAULT ''`;
    await sql`CREATE TABLE IF NOT EXISTS maintenance_events (
      id TEXT PRIMARY KEY, part_id TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'replace',
      hours_at_event NUMERIC(10,2) NOT NULL, performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expense_id TEXT, notes TEXT NOT NULL DEFAULT ''
    )`;
    await sql`INSERT INTO owner_ledger (id, kind, description, amount)
      VALUES ('initial-printer-investment', 'investment', 'מדפסת Bambu Lab P2S', 4300)
      ON CONFLICT (id) DO NOTHING`;

    // ── Print jobs (one-click print) ──────────────────────────
    // The printer/bridge state machine layered on top of an order. Every job is
    // backed by an order (customer order, or an internal order auto-created for a
    // self-print), so all filament deduction stays on the single order owner and
    // this table never touches the filaments table directly.
    await sql`
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'self',
        order_id TEXT,
        product_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        selected_colors JSONB NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'queued',
        progress NUMERIC(5,2) NOT NULL DEFAULT 0,
        error_reason TEXT NOT NULL DEFAULT '',
        production_cost NUMERIC(10,2),
        material_grams NUMERIC(10,2),
        print_hours NUMERIC(10,2),
        print_file_url TEXT NOT NULL DEFAULT '',
        print_file_name TEXT NOT NULL DEFAULT '',
        print_file_checksum TEXT NOT NULL DEFAULT '',
        claimed_by TEXT,
        claimed_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        printer_name TEXT NOT NULL DEFAULT '',
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    // Manual approval gate + a per-job event timeline for full transparency.
    await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`;
    await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS approved_by TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS print_jobs_status_created_idx ON print_jobs(status, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS print_jobs_order_id_idx ON print_jobs(order_id)`;
    // At most one live job per order (double-print guard). Includes the new
    // awaiting_approval state, so a job pending approval already reserves the order.
    await sql`DROP INDEX IF EXISTS print_jobs_active_order_idx`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_active_order_idx ON print_jobs(order_id)
      WHERE order_id IS NOT NULL AND status IN ('awaiting_approval', 'queued', 'claimed', 'uploading', 'printing')`;
    // Global guard: at most one job may occupy the single printer at a time.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_single_active_idx ON print_jobs((1))
      WHERE status IN ('claimed', 'uploading', 'printing')`;

    // ── Printer state (single physical Bambu P2S) ─────────────
    // Operational state the owner controls: the printer goes busy when the bridge
    // takes a job and is returned to idle manually after the bed is cleared. The
    // bridge heartbeats bridge_seen_at on every poll so the site can show it online.
    await sql`
      CREATE TABLE IF NOT EXISTS printers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'Bambu Lab P2S',
        state TEXT NOT NULL DEFAULT 'idle',
        current_job_id TEXT,
        bridge_seen_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`INSERT INTO printers (id, name, state) VALUES ('p2s', 'Bambu Lab P2S', 'idle')
      ON CONFLICT (id) DO NOTHING`;

    const SEED_FILAMENTS = [
      { id: 'filament-black-pla', manufacturer: 'eSun', materialType: 'PLA', colorName: 'Black', colorHex: '#111111', pricePerKg: 80 },
      { id: 'filament-white-pla', manufacturer: 'eSun', materialType: 'PLA', colorName: 'White', colorHex: '#ffffff', pricePerKg: 80 },
      { id: 'filament-red-pla',   manufacturer: 'eSun', materialType: 'PLA', colorName: 'Red',   colorHex: '#ff0000', pricePerKg: 80 },
    ];
    if (seedDemoData) {
      for (const f of SEED_FILAMENTS) {
        const name = [f.manufacturer, f.materialType, f.colorName].filter(Boolean).join(' ');
        await sql`
          INSERT INTO filaments (id, name, manufacturer, material_type, color_hex, color_name, price_per_kg)
          VALUES (${f.id}, ${name}, ${f.manufacturer}, ${f.materialType}, ${f.colorHex}, ${f.colorName}, ${f.pricePerKg})
          ON CONFLICT (id) DO NOTHING
        `;
      }
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

    await sql`
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'bug',
        message TEXT NOT NULL,
        page TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    const DEFAULT_PRICING = { marginPercent: 0.50, minOrderPrice: 5, roundingMode: 'ceil', riskPercentByLevel: { low: 0.08, medium: 0.15, high: 0.25 } };
    await sql`
      INSERT INTO settings (key, value)
      VALUES ('pricing', ${JSON.stringify(DEFAULT_PRICING)})
      ON CONFLICT (key) DO NOTHING
    `;
    await sql`UPDATE settings SET value = jsonb_build_object(
      'marginPercent', COALESCE(value->'marginPercent', '0.5'::jsonb),
      'minOrderPrice', COALESCE(value->'minOrderPrice', value->'minPrice', '5'::jsonb),
      'roundingMode', '"ceil"'::jsonb,
      'riskPercentByLevel', COALESCE(value->'riskPercentByLevel', value->'riskPercents', '{"low":0.08,"medium":0.15,"high":0.25}'::jsonb)
    ) WHERE key = 'pricing'`;

    let adminCreated = false;
    if (canBootstrapAdmin) {
      const passwordHash = await hashPassword(bootstrapPassword);
      const inserted = await sql`
        INSERT INTO users (id, name, full_name, gender, role, password, status)
        VALUES (
          ${String(process.env.ADMIN_BOOTSTRAP_ID || 'bootstrap-admin').trim()},
          ${bootstrapName},
          ${String(process.env.ADMIN_BOOTSTRAP_FULL_NAME || bootstrapName).trim()},
          'male',
          'admin',
          ${passwordHash},
          'active'
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      adminCreated = inserted.length > 0;
    }

    const demoUsers = isProduction
      ? (canSeedProductionDemoUsers ? SEED_USERS.filter((u) => u.role !== 'admin') : [])
      : (seedDemoData ? SEED_USERS : []);
    for (const u of demoUsers) {
      const password = isProduction ? process.env.DEMO_USER_PASSWORD : u.password;
      const passwordHash = await hashPassword(password);
      await sql`
        INSERT INTO users (id, name, full_name, gender, role, password, status)
        VALUES (${u.id}, ${u.name}, ${u.fullName}, ${u.gender}, ${u.role}, ${passwordHash}, ${u.status})
        ON CONFLICT (id) DO NOTHING
      `;
    }

    if (seedDemoData) {
      for (const p of SEED_PRODUCTS) {
        await sql`
          INSERT INTO products (id, name, cost, grams, description, image, stl_url)
          VALUES (${p.id}, ${p.name}, ${p.cost}, ${p.grams}, ${p.description}, ${p.image}, ${p.stlUrl})
          ON CONFLICT (id) DO NOTHING
        `;
      }
    }

    if (demoUsers.length > 0) {
      for (const o of SEED_ORDERS) {
        await sql`
          INSERT INTO orders (id, product_id, friend_name, quantity, price, status, paid)
          VALUES (${o.id}, ${o.productId}, ${o.friendName}, ${o.quantity}, ${o.price}, ${o.status}, ${o.paid})
          ON CONFLICT (id) DO NOTHING
        `;
      }
    }

    res.json({
      ok: true,
      tables: ['users', 'products', 'orders', 'sessions', 'filaments', 'settings', 'expenses', 'categories', 'feedback', 'print_jobs', 'printers'],
      demoDataSeeded: seedDemoData,
      demoUsersSeeded: demoUsers.length > 0,
      adminBootstrap: canBootstrapAdmin ? (adminCreated ? 'created' : 'already-exists') : 'skipped',
    });
  } catch (err) {
    console.error('init error:', err);
    res.status(500).json({ error: err.message });
  }
};
