const { getSql } = require('./_db');
const { SEED_PRODUCTS, SEED_USERS, SEED_ORDERS } = require('./_seed');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

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
    await sql`UPDATE users SET status = 'approved' WHERE status = 'pending'`;

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
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_name TEXT NOT NULL,
        message TEXT NOT NULL,
        order_id TEXT,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    for (const u of SEED_USERS) {
      await sql`
        INSERT INTO users (id, name, full_name, email, role, password, status)
        VALUES (${u.id}, ${u.name}, ${u.fullName}, ${u.email}, ${u.role}, ${u.password}, ${u.status})
        ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              password = EXCLUDED.password,
              role = EXCLUDED.role,
              status = EXCLUDED.status
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

    res.json({ ok: true, tables: ['users', 'products', 'orders', 'sessions'], seeded: true });
  } catch (err) {
    console.error('init error:', err);
    res.status(500).json({ error: err.message });
  }
};
