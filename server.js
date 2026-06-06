const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { db, hashPassword } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Helper Functions
const TOKEN_SECRET = 'vendorbridge-secret-key-456!';

function createToken(userId, role, email, name) {
  const payload = JSON.stringify({
    userId,
    role,
    email,
    name,
    exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours expiry
  });
  const base64Payload = Buffer.from(payload).toString('base64');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(base64Payload).digest('hex');
  return `${base64Payload}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token) return null;
    const [base64Payload, signature] = token.split('.');
    if (!base64Payload || !signature) return null;

    const expectedSignature = crypto.createHmac('sha256', TOKEN_SECRET).update(base64Payload).digest('hex');
    if (signature !== expectedSignature) return null;

    const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
    if (payload.exp < Date.now()) return null; // Expired

    return payload;
  } catch (e) {
    return null;
  }
}

// Authentication Middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid format' });
  }

  const token = authHeader.split(' ')[1];
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }

  req.user = user;
  next();
}

// RBAC Middleware
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access forbidden: Insufficient permissions' });
    }
    next();
  };
}

// Helper to log audit actions
function logAction(userId, name, role, action, details) {
  try {
    const stmt = db.prepare('INSERT INTO audit_logs (user_id, user_name, user_role, action, details) VALUES (?, ?, ?, ?, ?)');
    stmt.run(userId, name, role, action, details);
  } catch (err) {
    console.error('Failed to log audit action:', err);
  }
}

// ==========================================
// 1. AUTHENTICATION GATEWAY ROUTES
// ==========================================

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, role, gst_number, category } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password, and role are required' });
  }

  const validRoles = ['procurement_officer', 'vendor', 'manager', 'admin'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role chosen' });
  }

  try {
    const hashedPassword = hashPassword(password);
    
    // Vendors start as active in this simulation for easier onboarding
    const status = 'active'; 

    const stmt = db.prepare(`
      INSERT INTO users (name, email, password, role, status, gst_number, category, rating) 
      VALUES (?, ?, ?, ?, ?, ?, ?, 0.0)
    `);
    
    stmt.run(name, email, hashedPassword, role, status, gst_number || null, category || null);
    
    // Retrieve created user
    const newUser = db.prepare('SELECT id, name, email, role, status FROM users WHERE email = ?').get(email);
    
    logAction(newUser.id, newUser.name, newUser.role, 'USER_SIGNUP', `User signed up as ${role}`);
    
    const token = createToken(newUser.id, newUser.role, newUser.email, newUser.name);
    res.status(201).json({ token, user: newUser });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const hashedPassword = hashPassword(password);
    const user = db.prepare('SELECT id, name, email, role, password, status FROM users WHERE email = ?').get(email);

    if (!user || user.password !== hashedPassword) {
      logAction(null, email, 'unknown', 'LOGIN_FAILED', 'Invalid password or user not found');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is pending verification or suspended' });
    }

    logAction(user.id, user.name, user.role, 'USER_LOGIN', 'User logged in successfully');
    
    const token = createToken(user.id, user.role, user.email, user.name);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = db.prepare('SELECT id, name, role FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'Email address not found' });
    }

    // Reset password to 'password' for easy sandbox recovery
    const tempPass = 'password';
    const hashed = hashPassword(tempPass);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id);

    logAction(user.id, user.name, user.role, 'PASSWORD_RESET', `Password reset requested. Temporary set to '${tempPass}'`);
    res.json({ message: `Password reset instructions sent. For sandbox testing, password has been reset to '${tempPass}'` });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, name, email, role, status, gst_number, category, rating FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ==========================================
// 2. VENDOR REGISTRY ROUTES
// ==========================================

app.get('/api/vendors', authenticate, (req, res) => {
  try {
    const vendors = db.prepare("SELECT id, name, email, status, gst_number, category, rating, created_at FROM users WHERE role = 'vendor'").all();
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vendors', authenticate, requireRole(['admin']), (req, res) => {
  const { name, email, password, gst_number, category } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  try {
    const hashed = hashPassword(password);
    db.prepare(`
      INSERT INTO users (name, email, password, role, status, gst_number, category, rating)
      VALUES (?, ?, ?, 'vendor', 'active', ?, ?, 5.0)
    `).run(name, email, hashed, gst_number || null, category || null);

    const vendor = db.prepare("SELECT id, name, email, status, gst_number, category, rating FROM users WHERE email = ?").get(email);
    logAction(req.user.userId, req.user.name, req.user.role, 'VENDOR_ONBOARDED', `Onboarded vendor: ${name}`);
    res.status(201).json(vendor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vendors/:id/verify', authenticate, requireRole(['admin']), (req, res) => {
  const { status } = req.body;
  if (!status || !['active', 'pending', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'Invalid verification status' });
  }

  try {
    const vendor = db.prepare('SELECT name FROM users WHERE id = ? AND role = \'vendor\'').get(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
    logAction(req.user.userId, req.user.name, req.user.role, 'VENDOR_VERIFY', `Updated verification status for vendor ${vendor.name} to ${status}`);
    res.json({ message: 'Vendor verification status updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3. REQUEST FOR QUOTATION (RFQ) ENGINE
// ==========================================

app.get('/api/rfqs', authenticate, (req, res) => {
  try {
    let rfqs;
    if (req.user.role === 'vendor') {
      // Vendors only see RFQs they are assigned to
      rfqs = db.prepare(`
        SELECT r.id, r.title, r.description, r.deadline, r.status, r.created_at, u.name as creator_name
        FROM rfqs r
        JOIN users u ON r.created_by = u.id
        JOIN rfq_vendors rv ON r.id = rv.rfq_id
        WHERE rv.vendor_id = ?
        ORDER BY r.id DESC
      `).all(req.user.userId);
    } else {
      // Procurement, Manager, and Admin can see all RFQs
      rfqs = db.prepare(`
        SELECT r.id, r.title, r.description, r.deadline, r.status, r.created_at, u.name as creator_name
        FROM rfqs r
        JOIN users u ON r.created_by = u.id
        ORDER BY r.id DESC
      `).all();
    }

    // Attach items to each RFQ
    for (const r of rfqs) {
      r.items = db.prepare('SELECT id, product_name, quantity FROM rfq_items WHERE rfq_id = ?').all(r.id);
      r.assigned_vendors = db.prepare(`
        SELECT u.id, u.name, u.email 
        FROM rfq_vendors rv
        JOIN users u ON rv.vendor_id = u.id
        WHERE rv.rfq_id = ?
      `).all(r.id);
    }

    res.json(rfqs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rfqs', authenticate, requireRole(['procurement_officer']), (req, res) => {
  const { title, description, deadline, items, vendor_ids } = req.body;

  if (!title || !deadline || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Title, deadline, and at least one item line are required' });
  }

  try {
    // Insert RFQ
    const rfqInsert = db.prepare(`
      INSERT INTO rfqs (title, description, deadline, status, created_by) 
      VALUES (?, ?, ?, 'open', ?)
    `);
    rfqInsert.run(title, description || '', deadline, req.user.userId);
    const rfq = db.prepare('SELECT id FROM rfqs ORDER BY id DESC LIMIT 1').get();

    // Insert Items
    const itemInsert = db.prepare('INSERT INTO rfq_items (rfq_id, product_name, quantity) VALUES (?, ?, ?)');
    for (const item of items) {
      itemInsert.run(rfq.id, item.product_name, parseInt(item.quantity) || 1);
    }

    // Assign Vendors
    if (vendor_ids && Array.isArray(vendor_ids)) {
      const vendorAssign = db.prepare('INSERT INTO rfq_vendors (rfq_id, vendor_id) VALUES (?, ?)');
      for (const vId of vendor_ids) {
        vendorAssign.run(rfq.id, vId);
      }
    }

    logAction(req.user.userId, req.user.name, req.user.role, 'RFQ_CREATED', `Created RFQ: ${title}`);
    res.status(201).json({ id: rfq.id, message: 'Request for Quotation created and dispatched successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rfqs/:id/close', authenticate, requireRole(['procurement_officer']), (req, res) => {
  try {
    const rfq = db.prepare('SELECT status, title FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) return res.status(404).json({ error: 'RFQ not found' });
    if (rfq.status !== 'open') return res.status(400).json({ error: 'Only open RFQs can be closed for evaluation' });

    db.prepare("UPDATE rfqs SET status = 'under_review' WHERE id = ?").run(req.params.id);
    logAction(req.user.userId, req.user.name, req.user.role, 'RFQ_CLOSED', `Bidding closed for RFQ: ${rfq.title}`);
    res.json({ message: 'RFQ closed for quotation review' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4. VENDOR BIDDING WORKSPACE ROUTES
// ==========================================

app.get('/api/quotations', authenticate, (req, res) => {
  try {
    let quotes;
    if (req.user.role === 'vendor') {
      quotes = db.prepare(`
        SELECT q.id, q.rfq_id, q.delivery_days, q.remarks, q.status, q.created_at, r.title as rfq_title
        FROM quotations q
        JOIN rfqs r ON q.rfq_id = r.id
        WHERE q.vendor_id = ?
        ORDER BY q.id DESC
      `).all(req.user.userId);
    } else {
      quotes = db.prepare(`
        SELECT q.id, q.rfq_id, q.delivery_days, q.remarks, q.status, q.created_at, r.title as rfq_title, u.name as vendor_name
        FROM quotations q
        JOIN rfqs r ON q.rfq_id = r.id
        JOIN users u ON q.vendor_id = u.id
        ORDER BY q.id DESC
      `).all();
    }

    for (const q of quotes) {
      q.items = db.prepare(`
        SELECT qi.id, qi.rfq_item_id, qi.unit_price, qi.total_price, ri.product_name, ri.quantity
        FROM quotation_items qi
        JOIN rfq_items ri ON qi.rfq_item_id = ri.id
        WHERE qi.quotation_id = ?
      `).all(q.id);
    }

    res.json(quotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/quotations', authenticate, requireRole(['vendor']), (req, res) => {
  const { rfq_id, delivery_days, remarks, items, is_draft } = req.body;

  if (!rfq_id || !delivery_days || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'RFQ ID, delivery timeline, and bid items are required' });
  }

  try {
    // Confirm RFQ is active (open)
    const rfq = db.prepare('SELECT status, title FROM rfqs WHERE id = ?').get(rfq_id);
    if (!rfq) return res.status(404).json({ error: 'RFQ not found' });
    if (rfq.status !== 'open') return res.status(400).json({ error: 'RFQ is not open for bidding' });

    // Check if vendor already has a quotation for this RFQ
    const existingQuote = db.prepare('SELECT id FROM quotations WHERE rfq_id = ? AND vendor_id = ?').get(rfq_id, req.user.userId);
    const status = is_draft ? 'draft' : 'submitted';

    let quoteId;
    if (existingQuote) {
      quoteId = existingQuote.id;
      // Update
      db.prepare(`
        UPDATE quotations 
        SET delivery_days = ?, remarks = ?, status = ?, created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(delivery_days, remarks || '', status, quoteId);

      // Clear existing item prices
      db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(quoteId);
    } else {
      // Create new
      db.prepare(`
        INSERT INTO quotations (rfq_id, vendor_id, delivery_days, remarks, status) 
        VALUES (?, ?, ?, ?, ?)
      `).run(rfq_id, req.user.userId, delivery_days, remarks || '', status);

      const newQ = db.prepare('SELECT id FROM quotations ORDER BY id DESC LIMIT 1').get();
      quoteId = newQ.id;
    }

    // Insert new pricing items
    const qiInsert = db.prepare(`
      INSERT INTO quotation_items (quotation_id, rfq_item_id, unit_price, total_price) 
      VALUES (?, ?, ?, ?)
    `);

    for (const item of items) {
      // Fetch rfq_item quantity to programmatically verify totals
      const rfqItem = db.prepare('SELECT quantity FROM rfq_items WHERE id = ?').get(item.rfq_item_id);
      const qty = rfqItem ? rfqItem.quantity : 1;
      const unitPrice = parseFloat(item.unit_price) || 0;
      qiInsert.run(quoteId, item.rfq_item_id, unitPrice, unitPrice * qty);
    }

    logAction(req.user.userId, req.user.name, req.user.role, is_draft ? 'QUOTATION_DRAFT' : 'QUOTATION_SUBMITTED', `${is_draft ? 'Saved draft' : 'Submitted'} quotation for RFQ: ${rfq.title}`);
    res.status(200).json({ id: quoteId, message: is_draft ? 'Quotation draft saved' : 'Quotation submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. QUOTATION COMPARISON MATRIX ROUTE
// ==========================================

app.get('/api/rfqs/:id/comparison', authenticate, requireRole(['procurement_officer', 'manager', 'admin']), (req, res) => {
  try {
    const rfq = db.prepare(`
      SELECT r.id, r.title, r.description, r.deadline, r.status, u.name as creator_name
      FROM rfqs r
      JOIN users u ON r.created_by = u.id
      WHERE r.id = ?
    `).get(req.params.id);

    if (!rfq) return res.status(404).json({ error: 'RFQ not found' });

    const items = db.prepare('SELECT id, product_name, quantity FROM rfq_items WHERE rfq_id = ?').all(req.params.id);

    // Get all quotations submitted for this RFQ
    const quotations = db.prepare(`
      SELECT q.id as quotation_id, q.delivery_days, q.remarks, q.status as quotation_status, q.created_at,
             u.id as vendor_id, u.name as vendor_name, u.rating as vendor_rating
      FROM quotations q
      JOIN users u ON q.vendor_id = u.id
      WHERE q.rfq_id = ? AND q.status = 'submitted'
    `).all(req.params.id);

    for (const q of quotations) {
      q.items = db.prepare(`
        SELECT qi.rfq_item_id, qi.unit_price, qi.total_price
        FROM quotation_items qi
        WHERE qi.quotation_id = ?
      `).all(q.quotation_id);

      q.grand_total = q.items.reduce((sum, item) => sum + item.total_price, 0);
    }

    res.json({ rfq, items, quotations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Procurement officer selects quotation -> updates status and requests approval
app.post('/api/quotations/:id/select', authenticate, requireRole(['procurement_officer']), (req, res) => {
  try {
    const quote = db.prepare(`
      SELECT q.id, q.rfq_id, q.vendor_id, r.title, u.name as vendor_name 
      FROM quotations q
      JOIN rfqs r ON q.rfq_id = r.id
      JOIN users u ON q.vendor_id = u.id
      WHERE q.id = ?
    `).get(req.params.id);

    if (!quote) return res.status(404).json({ error: 'Quotation not found' });

    // Validate that RFQ is not already approved or completed
    const rfq = db.prepare('SELECT status FROM rfqs WHERE id = ?').get(quote.rfq_id);
    if (['approved', 'completed'].includes(rfq.status)) {
      return res.status(400).json({ error: 'RFQ is already approved/completed' });
    }

    // Set this quotation status to selected, set others to rejected
    db.prepare("UPDATE quotations SET status = 'selected' WHERE id = ?").run(req.params.id);
    db.prepare("UPDATE quotations SET status = 'rejected' WHERE rfq_id = ? AND id != ?").run(quote.rfq_id, req.params.id);

    // Update RFQ status to under_review
    db.prepare("UPDATE rfqs SET status = 'under_review' WHERE id = ?").run(quote.rfq_id);

    logAction(
      req.user.userId,
      req.user.name,
      req.user.role,
      'QUOTATION_SELECTED',
      `Selected quotation from ${quote.vendor_name} for RFQ ${quote.title}. Submitted for Manager approval.`
    );

    res.json({ message: 'Quotation selected and submitted to manager approval queue.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 6. DYNAMIC APPROVAL WORKFLOW ROUTE
// ==========================================

app.get('/api/approvals', authenticate, requireRole(['manager', 'admin']), (req, res) => {
  try {
    // Return both historical approvals and outstanding selected quotations waiting for approval
    const pendingQuotes = db.prepare(`
      SELECT q.id as quotation_id, q.delivery_days, q.remarks as quotation_remarks, q.created_at,
             r.id as rfq_id, r.title as rfq_title, u.name as vendor_name, u.rating as vendor_rating
      FROM quotations q
      JOIN rfqs r ON q.rfq_id = r.id
      JOIN users u ON q.vendor_id = u.id
      WHERE q.status = 'selected' AND r.status = 'under_review'
    `).all();

    for (const pq of pendingQuotes) {
      pq.items = db.prepare(`
        SELECT qi.unit_price, qi.total_price, ri.product_name, ri.quantity
        FROM quotation_items qi
        JOIN rfq_items ri ON qi.rfq_item_id = ri.id
        WHERE qi.quotation_id = ?
      `).all(pq.quotation_id);
      pq.grand_total = pq.items.reduce((sum, item) => sum + item.total_price, 0);
    }

    const history = db.prepare(`
      SELECT a.id, a.document_type, a.document_id, a.status, a.remarks, a.created_at, u.name as manager_name
      FROM approvals a
      JOIN users u ON a.manager_id = u.id
      ORDER BY a.id DESC
    `).all();

    res.json({ pending: pendingQuotes, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/approvals', authenticate, requireRole(['manager']), (req, res) => {
  const { document_type, document_id, status, remarks } = req.body;

  if (!document_type || !document_id || !status || !remarks) {
    return res.status(400).json({ error: 'Document type, ID, status (approved/rejected), and remarks are required' });
  }

  if (document_type !== 'quotation') {
    return res.status(400).json({ error: 'Only quotation approvals are supported in this workflow version' });
  }

  try {
    // Validate target quotation
    const quote = db.prepare(`
      SELECT q.id, q.rfq_id, q.vendor_id, r.title, u.name as vendor_name, u.email as vendor_email
      FROM quotations q
      JOIN rfqs r ON q.rfq_id = r.id
      JOIN users u ON q.vendor_id = u.id
      WHERE q.id = ? AND q.status = 'selected'
    `).get(document_id);

    if (!quote) return res.status(404).json({ error: 'Pending selected quotation not found' });

    // Log the approval decision
    db.prepare(`
      INSERT INTO approvals (document_type, document_id, manager_id, status, remarks)
      VALUES (?, ?, ?, ?, ?)
    `).run(document_type, document_id, req.user.userId, status, remarks);

    if (status === 'approved') {
      // 1. Lock RFQ status to approved
      db.prepare("UPDATE rfqs SET status = 'approved' WHERE id = ?").run(quote.rfq_id);

      // 2. Generate Purchase Order
      const items = db.prepare(`
        SELECT qi.total_price
        FROM quotation_items qi
        WHERE qi.quotation_id = ?
      `).all(quote.id);
      
      const totalAmount = items.reduce((sum, item) => sum + item.total_price, 0);
      const taxAmount = totalAmount * 0.18; // 18% GST standard
      const grandTotal = totalAmount + taxAmount;

      // Make sequential PO number PO-2026-XXXX
      const poCountObj = db.prepare('SELECT COUNT(*) as count FROM purchase_orders').get();
      const seq = String(poCountObj.count + 1).padStart(4, '0');
      const poNumber = `PO-2026-${seq}`;

      // Get procurement officer of this RFQ to assign PO ownership
      const rfqOwner = db.prepare('SELECT created_by FROM rfqs WHERE id = ?').get(quote.rfq_id);

      db.prepare(`
        INSERT INTO purchase_orders (po_number, rfq_id, quotation_id, vendor_id, procurement_officer_id, total_amount, tax_amount, grand_total, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
      `).run(poNumber, quote.rfq_id, quote.id, quote.vendor_id, rfqOwner.created_by, totalAmount, taxAmount, grandTotal);

      logAction(
        req.user.userId,
        req.user.name,
        req.user.role,
        'PURCHASE_ORDER_GENERATED',
        `Approved quotation #${quote.id} from ${quote.vendor_name}. Generated ${poNumber} for standard approval.`
      );

      res.json({ message: `Quotation approved and ${poNumber} created successfully.` });
    } else {
      // Rejected: reset quotation to rejected, reset RFQ status back to open for other vendor selection
      db.prepare("UPDATE quotations SET status = 'rejected' WHERE id = ?").run(quote.id);
      db.prepare("UPDATE rfqs SET status = 'open' WHERE id = ?").run(quote.rfq_id);

      logAction(
        req.user.userId,
        req.user.name,
        req.user.role,
        'QUOTATION_REJECTED',
        `Rejected quotation #${quote.id} from ${quote.vendor_name} for RFQ ${quote.title}. Reset RFQ to active open status.`
      );

      res.json({ message: 'Quotation rejected. RFQ has been reopened for alternative bidding.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 7. PURCHASE ORDER & INVOICE GENERATOR
// ==========================================

app.get('/api/pos', authenticate, (req, res) => {
  try {
    let pos;
    if (req.user.role === 'vendor') {
      pos = db.prepare(`
        SELECT po.id, po.po_number, po.rfq_id, po.quotation_id, po.vendor_id, po.total_amount, po.tax_amount, po.grand_total, po.status, po.created_at,
               r.title as rfq_title, u.name as officer_name
        FROM purchase_orders po
        JOIN rfqs r ON po.rfq_id = r.id
        JOIN users u ON po.procurement_officer_id = u.id
        WHERE po.vendor_id = ?
        ORDER BY po.id DESC
      `).all(req.user.userId);
    } else {
      pos = db.prepare(`
        SELECT po.id, po.po_number, po.rfq_id, po.quotation_id, po.vendor_id, po.total_amount, po.tax_amount, po.grand_total, po.status, po.created_at,
               r.title as rfq_title, v.name as vendor_name, u.name as officer_name
        FROM purchase_orders po
        JOIN rfqs r ON po.rfq_id = r.id
        JOIN users v ON po.vendor_id = v.id
        JOIN users u ON po.procurement_officer_id = u.id
        ORDER BY po.id DESC
      `).all();
    }

    for (const po of pos) {
      po.items = db.prepare(`
        SELECT qi.unit_price, qi.total_price, ri.product_name, ri.quantity
        FROM quotation_items qi
        JOIN rfq_items ri ON qi.rfq_item_id = ri.id
        WHERE qi.quotation_id = ?
      `).all(po.quotation_id);
    }

    res.json(pos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pos/:id/dispatch', authenticate, requireRole(['procurement_officer']), (req, res) => {
  try {
    const po = db.prepare('SELECT po_number, status, vendor_id FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });

    db.prepare("UPDATE purchase_orders SET status = 'sent' WHERE id = ?").run(req.params.id);
    
    const vendor = db.prepare('SELECT name, email FROM users WHERE id = ?').get(po.vendor_id);
    logAction(
      req.user.userId,
      req.user.name,
      req.user.role,
      'PO_DISPATCHED',
      `Dispatched Purchase Order ${po.po_number} to Vendor ${vendor.name} (${vendor.email})`
    );

    res.json({ message: 'Purchase Order dispatched to vendor email successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pos/:id/invoice', authenticate, (req, res) => {
  try {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });

    // Ensure PO is either sent or draft (usually must be sent first, but let's allow draft/sent for workflow flexibility)
    
    // Check if invoice already exists
    const existingInv = db.prepare('SELECT id, invoice_number FROM invoices WHERE po_id = ?').get(req.params.id);
    if (existingInv) {
      return res.status(400).json({ error: `Invoice already generated for this PO: ${existingInv.invoice_number}` });
    }

    // Auto-generate invoice number INV-2026-XXXX
    const invCount = db.prepare('SELECT COUNT(*) as count FROM invoices').get();
    const seq = String(invCount.count + 1).padStart(4, '0');
    const invoiceNumber = `INV-2026-${seq}`;

    db.prepare(`
      INSERT INTO invoices (invoice_number, po_id, vendor_id, total_amount, tax_amount, grand_total, status)
      VALUES (?, ?, ?, ?, ?, ?, 'unpaid')
    `).run(invoiceNumber, po.id, po.vendor_id, po.total_amount, po.tax_amount, po.grand_total);

    // Update PO status to completed
    db.prepare("UPDATE purchase_orders SET status = 'completed' WHERE id = ?").run(po.id);
    // Also complete RFQ
    db.prepare("UPDATE rfqs SET status = 'completed' WHERE id = ?").run(po.rfq_id);

    logAction(
      req.user.userId,
      req.user.name,
      req.user.role,
      'INVOICE_GENERATED',
      `Generated invoice ${invoiceNumber} directly from ${po.po_number}.`
    );

    res.status(201).json({ message: `Invoice ${invoiceNumber} generated successfully.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/invoices', authenticate, (req, res) => {
  try {
    let invoices;
    if (req.user.role === 'vendor') {
      invoices = db.prepare(`
        SELECT inv.id, inv.invoice_number, inv.po_id, inv.total_amount, inv.tax_amount, inv.grand_total, inv.status, inv.created_at,
               po.po_number, r.title as rfq_title
        FROM invoices inv
        JOIN purchase_orders po ON inv.po_id = po.id
        JOIN rfqs r ON po.rfq_id = r.id
        WHERE inv.vendor_id = ?
        ORDER BY inv.id DESC
      `).all(req.user.userId);
    } else {
      invoices = db.prepare(`
        SELECT inv.id, inv.invoice_number, inv.po_id, inv.total_amount, inv.tax_amount, inv.grand_total, inv.status, inv.created_at,
               po.po_number, r.title as rfq_title, v.name as vendor_name
        FROM invoices inv
        JOIN purchase_orders po ON inv.po_id = po.id
        JOIN rfqs r ON po.rfq_id = r.id
        JOIN users v ON inv.vendor_id = v.id
        ORDER BY inv.id DESC
      `).all();
    }

    for (const inv of invoices) {
      // Fetch PO info and item lines
      const poObj = db.prepare('SELECT quotation_id FROM purchase_orders WHERE id = ?').get(inv.po_id);
      if (poObj) {
        inv.items = db.prepare(`
          SELECT qi.unit_price, qi.total_price, ri.product_name, ri.quantity
          FROM quotation_items qi
          JOIN rfq_items ri ON qi.rfq_item_id = ri.id
          WHERE qi.quotation_id = ?
        `).all(poObj.quotation_id);
      }
    }

    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices/:id/pay', authenticate, requireRole(['procurement_officer', 'manager']), (req, res) => {
  try {
    const inv = db.prepare('SELECT invoice_number, status FROM invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status === 'paid') return res.status(400).json({ error: 'Invoice is already paid' });

    db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").run(req.params.id);
    logAction(
      req.user.userId,
      req.user.name,
      req.user.role,
      'INVOICE_PAID',
      `Marked invoice ${inv.invoice_number} as PAID. Settlement complete.`
    );

    res.json({ message: `Invoice ${inv.invoice_number} successfully recorded as paid.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 8. AUDIT LOGS & ACTIVITY STREAM ROUTES
// ==========================================

app.get('/api/audit-logs', authenticate, requireRole(['manager', 'admin']), (req, res) => {
  try {
    const logs = db.prepare('SELECT id, user_name, user_role, action, details, timestamp FROM audit_logs ORDER BY id DESC LIMIT 100').all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper for real-time live events dashboard card (accessible to all authenticated)
app.get('/api/activity-stream', authenticate, (req, res) => {
  try {
    const stream = db.prepare(`
      SELECT id, user_name, user_role, action, details, timestamp 
      FROM audit_logs 
      WHERE action IN ('USER_SIGNUP', 'RFQ_CREATED', 'QUOTATION_SUBMITTED', 'QUOTATION_SELECTED', 'PURCHASE_ORDER_GENERATED', 'INVOICE_GENERATED', 'PO_DISPATCHED', 'INVOICE_PAID')
      ORDER BY id DESC LIMIT 25
    `).all();
    res.json(stream);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 9. INTELLIGENCE, REPORTS & ANALYTICS ROUTE
// ==========================================

app.get('/api/analytics', authenticate, (req, res) => {
  try {
    // 1. Core KPIs
    const totalSpent = db.prepare("SELECT SUM(grand_total) as sum FROM purchase_orders WHERE status IN ('sent', 'completed')").get().sum || 0;
    const openRfqs = db.prepare("SELECT COUNT(*) as count FROM rfqs WHERE status = 'open'").get().count;
    const pendingApprovals = db.prepare("SELECT COUNT(*) as count FROM quotations WHERE status = 'selected'").get().count;
    const activeVendors = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'vendor' AND status = 'active'").get().count;

    // 2. Spending by Month (PO generation month)
    const monthlySpend = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, SUM(grand_total) as spend
      FROM purchase_orders
      WHERE status IN ('sent', 'completed')
      GROUP BY month
      ORDER BY month ASC
    `).all();

    // 3. Spending by Category (linked via vendor category)
    const categorySpend = db.prepare(`
      SELECT u.category, SUM(po.grand_total) as spend
      FROM purchase_orders po
      JOIN users u ON po.vendor_id = u.id
      WHERE po.status IN ('sent', 'completed')
      GROUP BY u.category
    `).all();

    // 4. Vendor Performance Stats
    const vendorStats = db.prepare(`
      SELECT u.name, u.rating, u.category,
             (SELECT COUNT(*) FROM quotations q WHERE q.vendor_id = u.id) as total_bids,
             (SELECT COUNT(*) FROM purchase_orders po WHERE po.vendor_id = u.id) as awarded_pos,
             IFNULL((SELECT SUM(po2.grand_total) FROM purchase_orders po2 WHERE po2.vendor_id = u.id AND po2.status = 'completed'), 0) as total_earnings
      FROM users u
      WHERE u.role = 'vendor'
      ORDER BY u.rating DESC
    `).all();

    res.json({
      kpis: { totalSpent, openRfqs, pendingApprovals, activeVendors },
      monthlySpend,
      categorySpend,
      vendorStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all to serve index.html for clients
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`VendorBridge ERP active at http://localhost:${PORT}`);
});
