import pg from 'pg';
import { config } from './config.js';
import { computeAuditHash, GENESIS_HASH, hashPassword, signQrPayload } from './security.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  idle_in_transaction_session_timeout: 60000,
});

const AUDIT_LOCK_ID = 90421;

export async function appendAuditLog(client, {
  itemId,
  userId = null,
  actionType,
  quantityChange,
  previousQuantity,
  newQuantity,
  notes = '',
  timestampIso = new Date().toISOString()
}) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK_ID]);
  const lastRow = await client.query(
    'SELECT record_hash FROM transaction_logs ORDER BY id DESC LIMIT 1'
  );
  const prevHash = lastRow.rows[0]?.record_hash || GENESIS_HASH;
  const recordHash = computeAuditHash({
    prevHash,
    itemId,
    userId,
    actionType,
    quantityChange,
    previousQuantity,
    newQuantity,
    notes,
    timestampIso
  });

  const inserted = await client.query(
    `INSERT INTO transaction_logs
      (item_id, user_id, action_type, quantity_change, previous_quantity, new_quantity, notes, prev_hash, record_hash, timestamp_iso, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      itemId,
      userId,
      actionType,
      quantityChange,
      previousQuantity,
      newQuantity,
      notes,
      prevHash,
      recordHash,
      timestampIso,
      timestampIso
    ]
  );
  return inserted.rows[0];
}

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        color VARCHAR(7) NOT NULL DEFAULT '#0ea5e9',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        threshold INTEGER NOT NULL DEFAULT 5 CHECK (threshold >= 0),
        unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
        unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
        description TEXT NOT NULL DEFAULT '',
        sku VARCHAR(64) NOT NULL DEFAULT '',
        qr_data TEXT NOT NULL DEFAULT '',
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transaction_logs (
        id SERIAL PRIMARY KEY,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action_type VARCHAR(32) NOT NULL,
        quantity_change INTEGER NOT NULL DEFAULT 0,
        previous_quantity INTEGER NOT NULL DEFAULT 0,
        new_quantity INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        prev_hash CHAR(64) NOT NULL,
        record_hash CHAR(64) NOT NULL,
        timestamp_iso TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS alert_logs (
        id SERIAL PRIMARY KEY,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        alert_type VARCHAR(32) NOT NULL,
        message TEXT NOT NULL,
        sent_via VARCHAR(32) NOT NULL DEFAULT 'system',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE OR REPLACE FUNCTION prevent_audit_tampering()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Audit ledger records are append-only and immutable';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_transaction_logs_immutable ON transaction_logs;
      CREATE TRIGGER trg_transaction_logs_immutable
        BEFORE UPDATE OR DELETE ON transaction_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_tampering();

      CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id) WHERE is_deleted = FALSE;
      CREATE INDEX IF NOT EXISTS idx_items_active ON items(is_deleted, name);
      CREATE INDEX IF NOT EXISTS idx_txns_item_created ON transaction_logs(item_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_alerts_item_created ON alert_logs(item_id, created_at DESC);
    `);

    const userCount = Number((await client.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c);
    if (userCount === 0 && config.adminSeed.email && config.adminSeed.password.length >= 12) {
      const pwHash = await hashPassword(config.adminSeed.password);
      await client.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        [config.adminSeed.name, config.adminSeed.email, pwHash, 'admin']
      );
    }

    const catCount = Number((await client.query('SELECT COUNT(*)::int AS c FROM categories')).rows[0].c);
    if (catCount === 0) {
      await seedInitialInventory(client);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function seedInitialInventory(client) {
  const categories = [
    ['Electronics', 'Electronic components and devices', '#8b5cf6'],
    ['Office Supplies', 'Stationery and office equipment', '#06b6d4'],
    ['Kitchen', 'Kitchen supplies and utensils', '#f59e0b'],
    ['Cleaning', 'Cleaning products and tools', '#10b981'],
    ['Hardware', 'Tools and hardware supplies', '#ef4444']
  ];

  const catIds = [];
  for (const [name, description, color] of categories) {
    const res = await client.query(
      'INSERT INTO categories (name, description, color) VALUES ($1, $2, $3) RETURNING id',
      [name, description, color]
    );
    catIds.push(res.rows[0].id);
  }

  const items = [
    ['USB-C Cables', catIds[0], 45, 10, 12.50, 'pcs', 'ELC-USBC-001', 'High-speed USB-C charging cables'],
    ['Wireless Mouse', catIds[0], 3, 5, 29.00, 'pcs', 'ELC-MOUS-002', 'Ergonomic silent wireless mouse'],
    ['HDMI Adapters', catIds[0], 8, 10, 18.00, 'pcs', 'ELC-HDMI-003', 'HDMI to USB-C 4K adapters'],
    ['A4 Paper Reams', catIds[1], 25, 8, 6.50, 'reams', 'OFF-PAPR-004', 'White 80gsm A4 printer paper'],
    ['Ballpoint Pens', catIds[1], 150, 30, 0.75, 'pcs', 'OFF-PENS-005', 'Blue smooth-flow ballpoint pens'],
    ['Sticky Notes', catIds[1], 2, 15, 3.25, 'packs', 'OFF-NOTE-006', '3x3 inch adhesive sticky note pads'],
    ['Paper Towels', catIds[2], 12, 5, 2.40, 'rolls', 'KIT-TOWL-007', 'Absorbent multi-ply paper towels'],
    ['Dish Soap', catIds[2], 4, 3, 4.80, 'bottles', 'KIT-SOAP-008', 'Concentrated lemon dish soap'],
    ['Floor Cleaner', catIds[3], 1, 3, 7.90, 'bottles', 'CLN-FLOR-009', 'Multi-surface disinfectant cleaner'],
    ['Screwdriver Set', catIds[4], 7, 2, 24.00, 'sets', 'HRD-SCRW-010', 'Magnetic Phillips and flathead set'],
    ['Batteries AA', catIds[0], 6, 20, 1.10, 'pcs', 'ELC-BATT-011', 'Long-life AA alkaline batteries'],
    ['Printer Ink', catIds[1], 0, 3, 34.00, 'cartridges', 'OFF-INKB-012', 'High-yield black ink cartridges']
  ];

  const insertedItems = [];
  for (const [name, categoryId, quantity, threshold, unitPrice, unit, sku, description] of items) {
    const res = await client.query(
      `INSERT INTO items (name, category_id, quantity, threshold, unit_price, unit, sku, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, quantity`,
      [name, categoryId, quantity, threshold, unitPrice, unit, sku, description]
    );
    const item = res.rows[0];
    const qrPayload = signQrPayload(item.id, item.name);
    await client.query('UPDATE items SET qr_data = $1 WHERE id = $2', [qrPayload, item.id]);
    insertedItems.push(item);
  }

  const now = Date.now();
  for (const item of insertedItems) {
    let runningQty = item.quantity + 18;
    for (let dayOffset = 24; dayOffset >= 1; dayOffset--) {
      if ((dayOffset + item.id) % 2 === 0) {
        const delta = -((item.id + dayOffset) % 3 + 1);
        const prev = runningQty;
        runningQty = Math.max(0, runningQty + delta);
        const ts = new Date(now - dayOffset * 86400000).toISOString();
        await appendAuditLog(client, {
          itemId: item.id,
          userId: null,
          actionType: 'consumed',
          quantityChange: delta,
          previousQuantity: prev,
          newQuantity: runningQty,
          notes: 'Daily operational usage',
          timestampIso: ts
        });
      }
      if (dayOffset % 9 === 0) {
        const delta = 12;
        const prev = runningQty;
        runningQty += delta;
        const ts = new Date(now - dayOffset * 86400000 + 3600000).toISOString();
        await appendAuditLog(client, {
          itemId: item.id,
          userId: null,
          actionType: 'restocked',
          quantityChange: delta,
          previousQuantity: prev,
          newQuantity: runningQty,
          notes: 'Scheduled supplier delivery',
          timestampIso: ts
        });
      }
    }
  }
}

export async function runStockCheck() {
  const client = await pool.connect();
  try {
    const lowItems = await client.query(
      'SELECT id, name, quantity, threshold FROM items WHERE is_deleted = FALSE AND quantity <= threshold'
    );
    let created = 0;
    for (const item of lowItems.rows) {
      const existing = await client.query(
        `SELECT id FROM alert_logs
         WHERE item_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [item.id]
      );
      if (existing.rows.length === 0) {
        const alertType = item.quantity === 0 ? 'out_of_stock' : 'low_stock';
        const message =
          item.quantity === 0
            ? `Out of stock: "${item.name}" has 0 units remaining (threshold: ${item.threshold}).`
            : `Low stock: "${item.name}" has ${item.quantity} units remaining (threshold: ${item.threshold}).`;
        await client.query(
          'INSERT INTO alert_logs (item_id, alert_type, message, sent_via) VALUES ($1,$2,$3,$4)',
          [item.id, alertType, message, 'system']
        );
        created += 1;
      }
    }
    return created;
  } finally {
    client.release();
  }
}
