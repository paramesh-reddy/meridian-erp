import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

let dbInstance: DatabaseSync | null = null;

function defaultDbPath(): string {
  // Serverless instances can only write under /tmp. Seed data is recreated
  // on a cold start so login and the demo catalog work without an external DB.
  if (process.env.VERCEL) {
    return '/tmp/meridian-sales-inventory.db';
  }
  return process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'sales_inventory.db');
}

export function getDb(dbPath?: string): DatabaseSync {
  if (dbInstance && !dbPath) {
    return dbInstance;
  }

  const targetPath = dbPath || defaultDbPath();
  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);
  // Vercel’s deployment filesystem is read-only. The database lives in /tmp,
  // where WAL sidecar files are unreliable, so use a rollback journal there.
  const writableTmp = targetPath.startsWith('/tmp') || Boolean(process.env.VERCEL);
  db.exec(writableTmp ? 'PRAGMA journal_mode = DELETE;' : 'PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  initializeSchema(db);
  seedDatabase(db);

  if (!dbPath) {
    dbInstance = db;
  }
  return db;
}

export function resetDbForTests(db: DatabaseSync): void {
  dbInstance = db;
}

export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors if already rolled back
    }
    throw err;
  }
}

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'MANAGER', 'SALES_EMPLOYEE')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      unit_price REAL NOT NULL CHECK(unit_price > 0),
      cost_price REAL NOT NULL CHECK(cost_price >= 0),
      minimum_stock_level INTEGER NOT NULL DEFAULT 10 CHECK(minimum_stock_level >= 0),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      billing_address TEXT NOT NULL DEFAULT '',
      shipping_address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
      quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK(quantity_on_hand >= 0),
      reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity >= 0),
      minimum_stock_level INTEGER NOT NULL DEFAULT 10 CHECK(minimum_stock_level >= 0),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      order_date TEXT NOT NULL,
      expected_delivery_date TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
      tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),
      grand_total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN (
        'DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED'
      )),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price REAL NOT NULL CHECK(unit_price > 0),
      subtotal REAL NOT NULL CHECK(subtotal >= 0)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE REFERENCES sales_orders(id) ON DELETE CASCADE,
      requested_by INTEGER NOT NULL REFERENCES users(id),
      reviewed_by INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
      rejection_reason TEXT,
      order_amount REAL NOT NULL,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      transaction_type TEXT NOT NULL CHECK(transaction_type IN (
        'STOCK_IN', 'STOCK_ADJUSTMENT', 'STOCK_RESERVED', 'STOCK_RELEASED', 'STOCK_DEDUCTED'
      )),
      quantity INTEGER NOT NULL,
      reference_order_id INTEGER REFERENCES sales_orders(id),
      previous_quantity INTEGER NOT NULL,
      new_quantity INTEGER NOT NULL,
      performed_by INTEGER NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      approval_threshold REAL NOT NULL DEFAULT 50000 CHECK(approval_threshold >= 0),
      currency_symbol TEXT NOT NULL DEFAULT '₹',
      company_name TEXT NOT NULL DEFAULT 'Meridian Industrial Supply Pvt. Ltd.',
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      template_name TEXT NOT NULL,
      body_html TEXT NOT NULL,
      reference_order_id INTEGER REFERENCES sales_orders(id),
      status TEXT NOT NULL CHECK(status IN ('SENT', 'QUEUED_SIMULATED', 'FAILED')),
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON sales_orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_creator ON sales_orders(created_by);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON sales_orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_inv_tx_product ON inventory_transactions(product_id);
  `);
}

export function seedDatabase(db: DatabaseSync): void {
  const existingUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (existingUsers.cnt > 0) {
    return;
  }

  const devPasswordHash = bcrypt.hashSync('Password123!', 10);

  // 1. Seed Users
  const insertUser = db.prepare(`
    INSERT INTO users (email, full_name, password_hash, role, is_active)
    VALUES (?, ?, ?, ?, 1)
  `);
  insertUser.run('admin@example.com', 'Arjun Mehta', devPasswordHash, 'ADMIN');
  insertUser.run('manager@example.com', 'Priya Nair', devPasswordHash, 'MANAGER');
  insertUser.run('sales@example.com', 'Rohan Sharma', devPasswordHash, 'SALES_EMPLOYEE');
  insertUser.run('ananya@example.com', 'Ananya Verma', devPasswordHash, 'SALES_EMPLOYEE');

  // 2. Seed System Settings
  db.prepare(`
    INSERT INTO system_settings (id, approval_threshold, currency_symbol, company_name, updated_by)
    VALUES (1, 50000, '₹', 'Meridian Industrial Supply Pvt. Ltd.', 1)
  `).run();

  // 3. Seed Products & Inventory
  const products = [
    ['NET-SW-48P', 'Meridian 48-Port Gigabit PoE+ Switch', 'Enterprise Layer-3 managed switch with 740W PoE+ budget and 4x 10G SFP+ uplinks.', 'Networking', 28500, 19200, 42, 10],
    ['SRV-RACK-2U', 'Enterprise 2U Rackmount Compute Node', 'Dual-socket Xeon-ready 2U chassis with redundant 800W PSU and hot-swap NVMe bays.', 'Computing', 44000, 31500, 18, 6],
    ['SNS-THM-01', 'Industrial Modbus Thermal Array Sensor', 'IP67-rated non-contact thermal monitoring probe for switchgear and cold storage.', 'Industrial Sensors', 6800, 4100, 7, 15],
    ['PWR-UPS-3K', 'Online Double-Conversion 3kVA UPS', 'True sine-wave rack/tower UPS with SNMP management card and LCD telemetry.', 'Power Systems', 19500, 13400, 26, 8],
    ['NET-AP-WIFI6E', 'Tri-Band Wi-Fi 6E Enterprise Access Point', 'High-density ceiling-mount AP supporting 512 concurrent clients and WPA3.', 'Networking', 12400, 8100, 55, 12],
    ['STR-NAS-8B', '8-Bay Enterprise Storage Enclosure', '10GbE dual-port NAS appliance with hardware RAID and ZFS snapshot support.', 'Computing', 36000, 25800, 11, 5],
    ['SNS-VIB-04', 'Tri-Axial CNC Vibration Monitor', 'Predictive maintenance accelerometer with 4-20mA industrial loop output.', 'Industrial Sensors', 9200, 5700, 5, 12],
    ['PER-BAR-2D', 'Rugged 2D Warehouse Barcode Scanner', 'IP65 cordless industrial scanner with charging cradle and 100m range.', 'Peripherals', 4800, 2850, 64, 15],
    ['PWR-PDU-24', 'Metered 24-Outlet Vertical Rack PDU', '0U metered rack power distribution unit with per-bank current monitoring.', 'Power Systems', 8500, 5200, 31, 8],
    ['PER-KVM-16', '16-Port Rackmount LCD KVM Console', '1U slide-out 17-inch FHD LCD console with Cat6 KVM IP module.', 'Peripherals', 24500, 16900, 14, 4],
  ] as const;

  const insertProduct = db.prepare(`
    INSERT INTO products (sku, name, description, category, unit_price, cost_price, minimum_stock_level, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `);
  const insertInventory = db.prepare(`
    INSERT INTO inventory (product_id, quantity_on_hand, reserved_quantity, minimum_stock_level)
    VALUES (?, ?, 0, ?)
  `);
  const insertTx = db.prepare(`
    INSERT INTO inventory_transactions (product_id, transaction_type, quantity, reference_order_id, previous_quantity, new_quantity, performed_by, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [sku, name, desc, cat, unitPrice, costPrice, stock, minStock] of products) {
    const res = insertProduct.run(sku, name, desc, cat, unitPrice, costPrice, minStock);
    const productId = Number(res.lastInsertRowid);
    insertInventory.run(productId, stock, minStock);
    insertTx.run(productId, 'STOCK_IN', stock, null, 0, stock, 1, 'Initial opening warehouse balance', '2026-06-01T09:00:00.000Z');
  }

  // 4. Seed Customers
  const customers = [
    ['Vikramaditya Rao', 'TechNova Solutions Pvt. Ltd.', 'procurement@technova.in', '+91-9845011223', 'Plot 42, Electronic City Phase 1', 'Plot 42, Electronic City Phase 1', 'Bengaluru', 'Karnataka', '560100'],
    ['Meera Kulkarni', 'Apex Precision Manufacturing', 'supply@apexprecision.co.in', '+91-9822044556', 'MIDC Chakan Industrial Area, Sector 4', 'MIDC Chakan Industrial Area, Sector 4', 'Pune', 'Maharashtra', '410501'],
    ['Siddharth Menon', 'Vertex Cold-Chain Logistics', 'ops@vertexlogistics.in', '+91-9840077889', '18 Harbour Expressway, Ennore', '18 Harbour Expressway, Ennore', 'Chennai', 'Tamil Nadu', '600057'],
    ['Dr. Kavita Iyer', 'Horizon Diagnostics & Healthcare', 'purchasing@horizonhealth.org', '+91-9811133445', 'B-14 Okhla Industrial Estate Phase II', 'B-14 Okhla Industrial Estate Phase II', 'New Delhi', 'Delhi', '110020'],
    ['Devendra Patel', 'Solaris Grid Energy Systems', 'vendors@solarisgrid.in', '+91-9825099112', 'GIDC Sanand Phase II, Block C', 'GIDC Sanand Phase II, Block C', 'Ahmedabad', 'Gujarat', '382110'],
    ['Nandini Bose', 'Crestwood Retail Warehousing', 'infra@crestwoodretail.in', '+91-9830066778', 'Salt Lake Sector V, Plot J-9', 'Salt Lake Sector V, Plot J-9', 'Kolkata', 'West Bengal', '700091'],
  ] as const;

  const insertCustomer = db.prepare(`
    INSERT INTO customers (name, company_name, email, phone, billing_address, shipping_address, city, state, postal_code, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const c of customers) {
    insertCustomer.run(...c);
  }

  // 5. Seed Historical & Active Orders so charts, approvals, and ledgers have real data
  const insertOrder = db.prepare(`
    INSERT INTO sales_orders (order_number, customer_id, created_by, order_date, expected_delivery_date, subtotal, discount_amount, tax_amount, grand_total, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOrderItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertApproval = db.prepare(`
    INSERT INTO approvals (order_id, requested_by, reviewed_by, status, rejection_reason, order_amount, requested_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEmailLog = db.prepare(`
    INSERT INTO email_logs (recipient, subject, template_name, body_html, reference_order_id, status, error_message, retry_count, created_at, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Order 1: Completed historical order (June)
  const o1 = Number(insertOrder.run('SO-2026-1001', 1, 3, '2026-06-14', '2026-06-21', 57000, 2000, 9900, 64900, 'COMPLETED', 'Core switch refresh for Bengaluru DC', '2026-06-14T10:15:00.000Z', '2026-06-20T16:00:00.000Z').lastInsertRowid);
  insertOrderItem.run(o1, 1, 2, 28500, 57000);
  insertApproval.run(o1, 3, 2, 'APPROVED', null, 64900, '2026-06-14T10:15:00.000Z', '2026-06-14T11:30:00.000Z');

  // Order 2: Completed historical order (July)
  const o2 = Number(insertOrder.run('SO-2026-1002', 2, 3, '2026-07-08', '2026-07-15', 39000, 0, 7020, 46020, 'COMPLETED', 'UPS backup units for Chakan line 2', '2026-07-08T09:20:00.000Z', '2026-07-14T14:00:00.000Z').lastInsertRowid);
  insertOrderItem.run(o2, 4, 2, 19500, 39000);

  // Order 3: Completed historical order (August)
  const o3 = Number(insertOrder.run('SO-2026-1003', 3, 4, '2026-08-19', '2026-08-27', 88000, 3000, 15300, 100300, 'COMPLETED', 'Compute nodes for Ennore cold hub', '2026-08-19T13:10:00.000Z', '2026-08-26T17:45:00.000Z').lastInsertRowid);
  insertOrderItem.run(o3, 2, 2, 44000, 88000);
  insertApproval.run(o3, 4, 2, 'APPROVED', null, 100300, '2026-08-19T13:10:00.000Z', '2026-08-19T15:05:00.000Z');

  // Order 4: Completed historical order (September)
  const o4 = Number(insertOrder.run('SO-2026-1004', 4, 3, '2026-09-11', '2026-09-18', 37200, 1200, 6480, 42480, 'COMPLETED', 'Wi-Fi 6E rollout for diagnostics wing', '2026-09-11T08:40:00.000Z', '2026-09-17T12:20:00.000Z').lastInsertRowid);
  insertOrderItem.run(o4, 5, 3, 12400, 37200);

  // Order 5: Confirmed order (October)
  const o5 = Number(insertOrder.run('SO-2026-1005', 5, 4, '2026-10-22', '2026-10-30', 72000, 0, 12960, 84960, 'CONFIRMED', 'Redundant storage arrays for SCADA cluster', '2026-10-22T11:00:00.000Z', '2026-10-22T14:25:00.000Z').lastInsertRowid);
  insertOrderItem.run(o5, 6, 2, 36000, 72000);
  insertApproval.run(o5, 4, 2, 'APPROVED', null, 84960, '2026-10-22T11:00:00.000Z', '2026-10-22T14:25:00.000Z');

  // Order 6: Rejected order (November)
  const o6 = Number(insertOrder.run('SO-2026-1006', 6, 3, '2026-11-04', '2026-11-12', 73500, 10000, 11430, 74930, 'REJECTED', 'Requested exceptional 13.6% bulk discount', '2026-11-04T09:50:00.000Z', '2026-11-04T13:15:00.000Z').lastInsertRowid);
  insertOrderItem.run(o6, 10, 3, 24500, 73500);
  insertApproval.run(o6, 3, 2, 'REJECTED', 'Discount exceeds regional margin policy (max 8%). Re-quote with standard enterprise tier pricing.', 74930, '2026-11-04T09:50:00.000Z', '2026-11-04T13:15:00.000Z');

  // Order 7: Pending Approval (> ₹50,000) with reserved inventory!
  const o7 = Number(insertOrder.run('SO-2026-1007', 1, 3, '2026-11-14', '2026-11-24', 101000, 2500, 17730, 116230, 'PENDING_APPROVAL', 'Q4 data center expansion — priority rack & switch bundle', '2026-11-14T14:30:00.000Z', '2026-11-14T14:30:00.000Z').lastInsertRowid);
  insertOrderItem.run(o7, 1, 2, 28500, 57000);
  insertOrderItem.run(o7, 2, 1, 44000, 44000);
  insertApproval.run(o7, 3, null, 'PENDING', null, 116230, '2026-11-14T14:30:00.000Z', null);
  db.prepare('UPDATE inventory SET reserved_quantity = reserved_quantity + 2 WHERE product_id = 1').run();
  db.prepare('UPDATE inventory SET reserved_quantity = reserved_quantity + 1 WHERE product_id = 2').run();
  insertTx.run(1, 'STOCK_RESERVED', 2, o7, 42, 42, 3, 'Reserved pending manager approval for SO-2026-1007', '2026-11-14T14:30:00.000Z');
  insertTx.run(2, 'STOCK_RESERVED', 1, o7, 18, 18, 3, 'Reserved pending manager approval for SO-2026-1007', '2026-11-14T14:30:00.000Z');

  // Order 8: Pending Approval (> ₹50,000) with reserved inventory!
  const o8 = Number(insertOrder.run('SO-2026-1008', 2, 4, '2026-11-15', '2026-11-26', 64300, 0, 11574, 75874, 'PENDING_APPROVAL', 'Plant 3 wireless & UPS modernization', '2026-11-15T16:10:00.000Z', '2026-11-15T16:10:00.000Z').lastInsertRowid);
  insertOrderItem.run(o8, 4, 2, 19500, 39000);
  insertOrderItem.run(o8, 5, 2, 12400, 24800); // wait: 39000+24800=63800, let's keep subtotal accurate: 63800!
  db.prepare('UPDATE sales_orders SET subtotal = 63800, tax_amount = 11484, grand_total = 75284 WHERE id = ?').run(o8);
  db.prepare('UPDATE approvals SET order_amount = 75284 WHERE order_id = ?').run(o8);
  insertApproval.run(o8, 4, null, 'PENDING', null, 75284, '2026-11-15T16:10:00.000Z', null);
  db.prepare('UPDATE inventory SET reserved_quantity = reserved_quantity + 2 WHERE product_id = 4').run();
  db.prepare('UPDATE inventory SET reserved_quantity = reserved_quantity + 2 WHERE product_id = 5').run();
  insertTx.run(4, 'STOCK_RESERVED', 2, o8, 26, 26, 4, 'Reserved pending manager approval for SO-2026-1008', '2026-11-15T16:10:00.000Z');
  insertTx.run(5, 'STOCK_RESERVED', 2, o8, 55, 55, 4, 'Reserved pending manager approval for SO-2026-1008', '2026-11-15T16:10:00.000Z');

  // Order 9: Auto-confirmed order below ₹50,000 threshold (November)
  const o9 = Number(insertOrder.run('SO-2026-1009', 6, 3, '2026-11-16', '2026-11-22', 24000, 0, 4320, 28320, 'CONFIRMED', 'Warehouse handheld scanner replenishment', '2026-11-16T08:30:00.000Z', '2026-11-16T08:30:00.000Z').lastInsertRowid);
  insertOrderItem.run(o9, 8, 5, 4800, 24000);
  db.prepare('UPDATE inventory SET quantity_on_hand = quantity_on_hand - 5 WHERE product_id = 8').run();
  insertTx.run(8, 'STOCK_DEDUCTED', 5, o9, 64, 59, 3, 'Auto-confirmed sales order SO-2026-1009 (below approval threshold)', '2026-11-16T08:30:00.000Z');

  // Seed Email Logs
  insertEmailLog.run(
    'manager@example.com',
    '[Approval Required] Sales Order SO-2026-1007 — ₹116,230.00',
    'manager_approval_request',
    '<p>Order SO-2026-1007 submitted by Rohan Sharma requires manager approval.</p>',
    o7,
    'QUEUED_SIMULATED',
    null,
    0,
    '2026-11-14T14:30:05.000Z',
    '2026-11-14T14:30:05.000Z'
  );
  insertEmailLog.run(
    'sales@example.com',
    '[Order Rejected] Sales Order SO-2026-1006',
    'order_rejected',
    '<p>Order SO-2026-1006 was rejected by Priya Nair.</p>',
    o6,
    'QUEUED_SIMULATED',
    null,
    0,
    '2026-11-04T13:15:02.000Z',
    '2026-11-04T13:15:02.000Z'
  );
  insertEmailLog.run(
    'ananya@example.com',
    '[Order Approved] Sales Order SO-2026-1005 — ₹84,960.00',
    'order_approved',
    '<p>Order SO-2026-1005 has been approved by Priya Nair and confirmed.</p>',
    o5,
    'QUEUED_SIMULATED',
    null,
    0,
    '2026-11-01T14:25:05.000Z',
    '2026-11-01T14:25:05.000Z'
  );
}
