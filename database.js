const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Ensure database directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'vendorbridge.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');

// Define Hashing helper
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'vendorbridge-salt-123!').digest('hex');
}

// Initialize tables
function initDb() {
  console.log('Initializing database schema...');

  // Create tables in order of dependency
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('procurement_officer', 'vendor', 'manager', 'admin')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'pending', 'inactive')),
      gst_number TEXT,
      category TEXT,
      rating REAL DEFAULT 0.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS rfqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      deadline TEXT NOT NULL,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'open', 'under_review', 'approved', 'rejected', 'completed')),
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS rfq_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS rfq_vendors (
      rfq_id INTEGER NOT NULL,
      vendor_id INTEGER NOT NULL,
      PRIMARY KEY(rfq_id, vendor_id),
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE,
      FOREIGN KEY(vendor_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS quotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL,
      vendor_id INTEGER NOT NULL,
      delivery_days INTEGER NOT NULL CHECK(delivery_days > 0),
      remarks TEXT,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'selected', 'rejected')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE,
      FOREIGN KEY(vendor_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS quotation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quotation_id INTEGER NOT NULL,
      rfq_item_id INTEGER NOT NULL,
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      total_price REAL NOT NULL,
      FOREIGN KEY(quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
      FOREIGN KEY(rfq_item_id) REFERENCES rfq_items(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_type TEXT NOT NULL CHECK(document_type IN ('rfq', 'quotation', 'po')),
      document_id INTEGER NOT NULL,
      manager_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('approved', 'rejected')),
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(manager_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_number TEXT UNIQUE NOT NULL,
      rfq_id INTEGER NOT NULL,
      quotation_id INTEGER NOT NULL,
      vendor_id INTEGER NOT NULL,
      procurement_officer_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      tax_amount REAL NOT NULL,
      grand_total REAL NOT NULL,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'acknowledged', 'completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE,
      FOREIGN KEY(quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
      FOREIGN KEY(vendor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(procurement_officer_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      po_id INTEGER NOT NULL,
      vendor_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      tax_amount REAL NOT NULL,
      grand_total REAL NOT NULL,
      status TEXT DEFAULT 'unpaid' CHECK(status IN ('draft', 'unpaid', 'paid', 'cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      FOREIGN KEY(vendor_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      user_role TEXT,
      action TEXT NOT NULL,
      details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  seedData();
}

function seedData() {
  console.log('Clean database initialized. No dummy data seeded.');
}

// Run DB setup on import
initDb();

module.exports = {
  db,
  hashPassword
};
