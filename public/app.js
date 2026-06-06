// ==========================================================================
// VendorBridge ERP - Frontend Orchestrator
// ==========================================================================

let token = localStorage.getItem('vb_token') || null;
let currentUser = null;
let currentView = 'dashboard';
let charts = {};



// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  checkSession();
  
  // Theme check
  const savedTheme = localStorage.getItem('vb_theme') || 'light-mode';
  setTheme(savedTheme);
});

// ==========================================
// STATE MANAGEMENT & ROUTING
// ==========================================

function setTheme(theme) {
  document.body.className = '';
  document.body.classList.add(theme);
  localStorage.setItem('vb_theme', theme);
  
  const lightIcon = document.querySelector('.theme-icon-light');
  const darkIcon = document.querySelector('.theme-icon-dark');
  if (theme === 'dark-mode') {
    lightIcon.style.display = 'none';
    darkIcon.style.display = 'inline-block';
  } else {
    lightIcon.style.display = 'inline-block';
    darkIcon.style.display = 'none';
  }
}

async function checkSession() {
  if (!token) {
    showAuthView();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      showAppContainer();
      switchView(currentView);
    } else {
      logout();
    }
  } catch (e) {
    showToast('Failed to check auth state. Offline?', 'danger');
    showAuthView();
  }
}

function showAuthView() {
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('authContainer').style.display = 'flex';
}

function showAppContainer() {
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('appContainer').style.display = 'flex';
  
  // Update user profile display
  document.getElementById('userDisplayName').textContent = currentUser.name;
  
  const formattedRole = currentUser.role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  document.getElementById('userDisplayRole').textContent = formattedRole;
  
  document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();

  // Enforce Navigation Visibility (RBAC UI)
  updateSidebarNavigation();
}

function updateSidebarNavigation() {
  const role = currentUser.role;

  // Show/Hide specific nav tabs based on role
  document.getElementById('nav-dashboard').style.display = 'block';
  document.getElementById('nav-vendors').style.display = (role === 'vendor') ? 'none' : 'block';
  document.getElementById('nav-rfqs').style.display = (role === 'vendor' || role === 'manager') ? 'none' : 'block';
  document.getElementById('nav-bidding').style.display = (role === 'vendor') ? 'block' : 'none';
  document.getElementById('nav-approvals').style.display = (role === 'manager' || role === 'admin') ? 'block' : 'none';
  document.getElementById('nav-pos').style.display = 'block';
  document.getElementById('nav-analytics').style.display = (role === 'vendor') ? 'none' : 'block';
  document.getElementById('nav-audit').style.display = (role === 'vendor') ? 'none' : 'block';

  // Toggle quick action dashboard buttons
  document.getElementById('dashActionCreateRfq').style.display = (role === 'procurement_officer') ? 'block' : 'none';
  document.getElementById('dashActionSubmitBid').style.display = (role === 'vendor') ? 'block' : 'none';
  document.getElementById('dashActionApprovalQueue').style.display = (role === 'manager') ? 'block' : 'none';
  document.getElementById('dashActionOnboardVendor').style.display = (role === 'admin') ? 'block' : 'none';
  document.getElementById('btnOnboardVendorOpen').style.display = (role === 'admin') ? 'block' : 'none';
  document.getElementById('btnCreateRfqOpen').style.display = (role === 'procurement_officer') ? 'block' : 'none';
}

function switchView(viewName) {
  currentView = viewName;
  
  // Deactivate all nav items and views
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

  // Activate selected nav item and view panel
  const activeNavItem = document.getElementById(`nav-${viewName}`);
  if (activeNavItem) activeNavItem.classList.add('active');

  const activePanel = document.getElementById(`view-${viewName}`);
  if (activePanel) activePanel.classList.add('active');

  // Set header title
  const viewTitles = {
    dashboard: 'Command Dashboard & Operations',
    vendors: 'Vendor Directory & Registry',
    rfqs: 'Request for Quotation (RFQ) Engine',
    bidding: 'Vendor Bidding Workspace',
    approvals: 'Workflow Approval Queue',
    pos: 'Purchase Orders & Billing Invoices',
    analytics: 'Procurement Spent Intelligence & Reports',
    audit: 'Immutable System Audit Stream'
  };
  document.getElementById('currentViewTitle').textContent = viewTitles[viewName] || 'VendorBridge ERP';

  // Load view-specific data
  loadViewData(viewName);
  
  // Clean up overlays
  document.getElementById('notificationPanel').classList.remove('open');
  lucide.createIcons();
}

function loadViewData(viewName) {
  switch (viewName) {
    case 'dashboard':
      fetchDashboardKpis();
      fetchDashboardLists();
      break;
    case 'vendors':
      fetchVendors();
      break;
    case 'rfqs':
      showRfqListView();
      fetchRfqs();
      break;
    case 'bidding':
      showBiddingListView();
      fetchBiddingInvites();
      break;
    case 'approvals':
      fetchApprovalQueue();
      break;
    case 'pos':
      fetchPOsAndInvoices();
      break;
    case 'analytics':
      fetchAnalyticsData();
      break;
    case 'audit':
      fetchAuditLogs();
      break;
  }
}

// ==========================================
// 2. AUTHENTICATION & LOGIN GATEWAY
// ==========================================



async function loginUser(email, password) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('vb_token', token);
      showToast('Authenticated successfully!', 'success');
      showAppContainer();
      switchView('dashboard');
    } else {
      showToast(data.error || 'Authentication failed', 'danger');
    }
  } catch (e) {
    showToast('Network error during authentication', 'danger');
  }
}

async function signupUser(name, email, password, role, gst, category) {
  try {
    const payload = { name, email, password, role };
    if (role === 'vendor') {
      payload.gst_number = gst;
      payload.category = category;
    }

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('vb_token', token);
      showToast('Account registered and verified!', 'success');
      showAppContainer();
      switchView('dashboard');
    } else {
      showToast(data.error || 'Registration failed', 'danger');
    }
  } catch (e) {
    showToast('Network error during registration', 'danger');
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('vb_token');
  showToast('Logged out successfully', 'warning');
  showAuthView();
}



// ==========================================
// 3. SCREEN 2: DASHBOARD
// ==========================================

async function fetchDashboardKpis() {
  try {
    const res = await fetch('/api/analytics', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      document.getElementById('kpi-totalSpent').textContent = `$${data.kpis.totalSpent.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      document.getElementById('kpi-openRfqs').textContent = data.kpis.openRfqs;
      document.getElementById('kpi-pendingApprovals').textContent = data.kpis.pendingApprovals;
      document.getElementById('kpi-activeVendors').textContent = data.kpis.activeVendors;
    }
  } catch (e) {
    console.error('Failed to load KPIs', e);
  }
}

async function fetchDashboardLists() {
  try {
    // 1. Fetch Queue list (Approvals if manager, Quotations comparison if Officer, Open RFQs if Vendor)
    const queueBody = document.getElementById('dashboardQueueBody');
    queueBody.innerHTML = '';

    const streamFeed = document.getElementById('dashboardActivityFeed');
    streamFeed.innerHTML = '';

    // Load Stream Activity Feed
    const streamRes = await fetch('/api/activity-stream', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (streamRes.ok) {
      const logs = await streamRes.json();
      if (logs.length === 0) {
        streamFeed.innerHTML = '<div class="text-muted text-xs">No active logs yet</div>';
      } else {
        logs.forEach(log => {
          const item = document.createElement('div');
          item.className = 'activity-feed-item';
          const formattedDate = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          item.innerHTML = `
            <strong>${log.action.replace(/_/g, ' ')}</strong> - ${log.details}
            <span class="activity-time">${formattedDate} by ${log.user_name} (${log.user_role})</span>
          `;
          streamFeed.appendChild(item);
        });
      }
    }

    // Load operational tasks
    if (currentUser.role === 'manager') {
      const res = await fetch('/api/approvals', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.pending.length === 0) {
        queueBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No pending approvals in queue</td></tr>';
      } else {
        data.pending.forEach(p => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>RFQ: ${p.rfq_title}</strong><br><small>Quotation #${p.quotation_id} by ${p.vendor_name} ($${p.grand_total.toFixed(2)})</small></td>
            <td><span class="badge badge-warning">Manager Sign-off</span></td>
            <td>${new Date(p.created_at).toLocaleDateString()}</td>
            <td><button class="btn btn-warning btn-sm" onclick="switchView('approvals')">Review</button></td>
          `;
          queueBody.appendChild(tr);
        });
      }
    } else if (currentUser.role === 'procurement_officer') {
      // Show RFQs under review needing quotation comparison matrix selections
      const res = await fetch('/api/rfqs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const rfqs = await res.json();
      const underReview = rfqs.filter(r => r.status === 'under_review' || r.status === 'open');
      if (underReview.length === 0) {
        queueBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No active RFQs needing evaluation</td></tr>';
      } else {
        underReview.forEach(r => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>RFQ #${r.id}: ${r.title}</strong><br><small>Deadline: ${r.deadline}</small></td>
            <td><span class="badge badge-info">Procurement Officer</span></td>
            <td>${new Date(r.created_at).toLocaleDateString()}</td>
            <td>
              ${r.status === 'open' 
                ? `<button class="btn btn-secondary btn-sm" onclick="closeRfqForReview(${r.id})">Close Bidding</button>`
                : `<button class="btn btn-primary btn-sm" onclick="openComparisonMatrix(${r.id})">Compare Bids</button>`
              }
            </td>
          `;
          queueBody.appendChild(tr);
        });
      }
    } else if (currentUser.role === 'vendor') {
      // Show open RFQs they haven't quoted on yet
      const rfqRes = await fetch('/api/rfqs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const rfqs = await rfqRes.json();
      const openInvites = rfqs.filter(r => r.status === 'open');
      
      if (openInvites.length === 0) {
        queueBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No pending bid invitations</td></tr>';
      } else {
        openInvites.forEach(r => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>RFQ #${r.id}: ${r.title}</strong><br><small>Ends: ${r.deadline}</small></td>
            <td><span class="badge badge-emerald">Vendor Action</span></td>
            <td>${new Date(r.created_at).toLocaleDateString()}</td>
            <td><button class="btn btn-emerald btn-sm" onclick="openBiddingForm(${r.id})">Bid Now</button></td>
          `;
          queueBody.appendChild(tr);
        });
      }
    } else {
      queueBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Admin panel: monitor via Audit Stream and Registry</td></tr>';
    }

    // Load active general RFQs progress table
    const rfqsRes = await fetch('/api/rfqs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const activeRfqs = await rfqsRes.json();
    const rfqDashboardBody = document.getElementById('dashboardRfqsBody');
    rfqDashboardBody.innerHTML = '';
    
    if (activeRfqs.length === 0) {
      rfqDashboardBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No system RFQs recorded yet</td></tr>';
    } else {
      activeRfqs.slice(0, 5).forEach(r => {
        const vendorBadges = r.assigned_vendors.map(v => `<span class="vendor-category-tag">${v.name}</span>`).join(' ');
        const statusBadge = `<span class="badge ${getStatusClass(r.status)}">${r.status}</span>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>RFQ #${r.id}: ${r.title}</strong></td>
          <td>${r.deadline}</td>
          <td>${vendorBadges || 'None'}</td>
          <td>${statusBadge}</td>
          <td>
            ${(currentUser.role === 'procurement_officer' && r.status === 'under_review') 
              ? `<button class="btn btn-secondary btn-sm" onclick="openComparisonMatrix(${r.id})">Evaluate</button>` 
              : `<span class="text-muted text-xs">No Action</span>`
            }
          </td>
        `;
        rfqDashboardBody.appendChild(tr);
      });
    }
  } catch (e) {
    console.error('Failed to load Dashboard Lists', e);
  }
}

function getStatusClass(status) {
  switch (status) {
    case 'draft': return 'badge-info';
    case 'open': return 'badge-success';
    case 'under_review': return 'badge-warning';
    case 'approved': return 'badge-success';
    case 'rejected': return 'badge-danger';
    case 'completed': return 'badge-info';
    case 'unpaid': return 'badge-warning';
    case 'paid': return 'badge-success';
    case 'sent': return 'badge-info';
    default: return 'badge-info';
  }
}

// ==========================================
// 4. SCREEN 3: VENDOR REGISTRY
// ==========================================

async function fetchVendors() {
  try {
    const res = await fetch('/api/vendors', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const vendors = await res.json();
      renderVendors(vendors);
    }
  } catch (e) {
    showToast('Failed to load vendor registry', 'danger');
  }
}

function renderVendors(vendors) {
  const container = document.getElementById('vendorGridContainer');
  container.innerHTML = '';

  const search = document.getElementById('vendorSearchInput').value.toLowerCase();
  const category = document.getElementById('vendorCategoryFilter').value;

  const filtered = vendors.filter(v => {
    const matchesSearch = v.name.toLowerCase().includes(search) || 
                          v.gst_number.toLowerCase().includes(search) || 
                          v.category.toLowerCase().includes(search);
    const matchesCategory = category === 'all' || v.category === category;
    return matchesSearch && matchesCategory;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><i data-lucide="users"></i><p>No vendors found matching criteria</p></div>';
    lucide.createIcons();
    return;
  }

  filtered.forEach(v => {
    const card = document.createElement('div');
    card.className = 'vendor-card';
    
    let stars = '★'.repeat(Math.round(v.rating)) + '☆'.repeat(5 - Math.round(v.rating));
    const isVerified = v.status === 'active';
    const statusText = isVerified ? 'Verified' : v.status.toUpperCase();
    const statusBadge = isVerified ? 'badge-success' : 'badge-warning';

    card.innerHTML = `
      <div class="vendor-card-header">
        <span class="vendor-category-tag">${v.category}</span>
        <span class="badge ${statusBadge}">${statusText}</span>
      </div>
      <h3 class="vendor-title">${v.name}</h3>
      <div class="vendor-meta-item"><i data-lucide="mail"></i> <span>${v.email}</span></div>
      <div class="vendor-meta-item"><i data-lucide="file-check"></i> <span>GST: ${v.gst_number}</span></div>
      <div class="vendor-rating">
        <span>${stars}</span>
        <span>(${v.rating.toFixed(1)})</span>
      </div>
      <div class="vendor-actions">
        <span class="text-xs text-muted">Joined: ${new Date(v.created_at).toLocaleDateString()}</span>
        ${(currentUser.role === 'admin') 
          ? `<button class="btn btn-secondary btn-sm" onclick="toggleVendorVerification(${v.id}, '${v.status}')">
              ${v.status === 'active' ? 'Disable' : 'Verify'}
             </button>`
          : ''
        }
      </div>
    `;
    container.appendChild(card);
  });
  lucide.createIcons();
}

async function toggleVendorVerification(vendorId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  try {
    const res = await fetch(`/api/vendors/${vendorId}/verify`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      showToast('Vendor status updated successfully', 'success');
      fetchVendors();
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to update vendor status', 'danger');
    }
  } catch (e) {
    showToast('Server update error', 'danger');
  }
}

// ==========================================
// 5. SCREEN 4: RFQ ENGINE
// ==========================================

function showRfqListView() {
  document.getElementById('rfqListView').style.display = 'block';
  document.getElementById('rfqCreateView').style.display = 'none';
}

function showRfqCreateView() {
  document.getElementById('rfqListView').style.display = 'none';
  document.getElementById('rfqCreateView').style.display = 'block';
  populateRfqVendorAssignments();
}

async function fetchRfqs() {
  try {
    const res = await fetch('/api/rfqs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const rfqs = await res.json();
      const body = document.getElementById('rfqListTableBody');
      body.innerHTML = '';

      if (rfqs.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No RFQs created yet.</td></tr>';
        return;
      }

      rfqs.forEach(r => {
        const tr = document.createElement('tr');
        const count = r.assigned_vendors.length;
        const statusBadge = `<span class="badge ${getStatusClass(r.status)}">${r.status}</span>`;
        
        let actionBtn = '';
        if (currentUser.role === 'procurement_officer') {
          if (r.status === 'open') {
            actionBtn = `<button class="btn btn-secondary btn-sm" onclick="closeRfqForReview(${r.id})">Close Bidding</button>`;
          } else if (r.status === 'under_review') {
            actionBtn = `<button class="btn btn-primary btn-sm" onclick="openComparisonMatrix(${r.id})">Compare Bids</button>`;
          } else {
            actionBtn = `<span class="text-muted text-xs">Awaiting PO Flow</span>`;
          }
        } else {
          actionBtn = `<span class="text-muted text-xs">Read-Only</span>`;
        }

        tr.innerHTML = `
          <td><strong>RFQ #${r.id}</strong></td>
          <td><strong>${r.title}</strong><br><small class="text-muted">${r.items.map(i => `${i.product_name} (x${i.quantity})`).join(', ')}</small></td>
          <td>${r.deadline}</td>
          <td><span class="badge badge-info">${count} Vendors</span></td>
          <td>${statusBadge}</td>
          <td>${actionBtn}</td>
        `;
        body.appendChild(tr);
      });
    }
  } catch (e) {
    showToast('Failed to load RFQs', 'danger');
  }
}

async function populateRfqVendorAssignments() {
  try {
    const res = await fetch('/api/vendors', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const vendors = await res.json();
      const container = document.getElementById('rfqVendorCheckboxes');
      container.innerHTML = '';
      
      const verified = vendors.filter(v => v.status === 'active');
      if (verified.length === 0) {
        container.innerHTML = '<p class="text-muted text-xs" style="grid-column: 1/-1;">No verified vendors in directory. Please onboard and verify first.</p>';
        return;
      }

      verified.forEach(v => {
        const label = document.createElement('label');
        label.className = 'vendor-select-item';
        label.innerHTML = `
          <input type="checkbox" name="rfq_vendor_ids" value="${v.id}">
          <span>${v.name} (${v.category})</span>
        `;
        container.appendChild(label);
      });
    }
  } catch (e) {
    console.error(e);
  }
}

async function closeRfqForReview(rfqId) {
  try {
    const res = await fetch(`/api/rfqs/${rfqId}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      showToast('RFQ closed for comparison matrix generation.', 'success');
      loadViewData(currentView);
    }
  } catch (e) {
    showToast('Failed to close RFQ', 'danger');
  }
}

// ==========================================
// 6. SCREEN 5: VENDOR BIDDING WORKSPACE
// ==========================================

function showBiddingListView() {
  document.getElementById('vendorBiddingListView').style.display = 'block';
  document.getElementById('vendorBiddingFormView').style.display = 'none';
}

async function fetchBiddingInvites() {
  try {
    const res = await fetch('/api/rfqs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const quotesRes = await fetch('/api/quotations', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (res.ok && quotesRes.ok) {
      const rfqs = await res.json();
      const quotations = await quotesRes.json();
      
      const container = document.getElementById('vendorBiddingGrid');
      container.innerHTML = '';

      // Find Open RFQs
      const openRfqs = rfqs.filter(r => r.status === 'open');

      if (openRfqs.length === 0) {
        container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><i data-lucide="gavel"></i><p>No active bidding invitations</p></div>';
        lucide.createIcons();
        return;
      }

      openRfqs.forEach(rfq => {
        // Check if there is an existing quotation
        const quote = quotations.find(q => q.rfq_id === rfq.id);
        const hasQuote = !!quote;
        const isDraft = hasQuote && quote.status === 'draft';
        
        let statusBadge = '<span class="badge badge-danger">Not Submitted</span>';
        if (hasQuote) {
          statusBadge = isDraft 
            ? '<span class="badge badge-warning">Draft saved</span>' 
            : '<span class="badge badge-success">Proposal Submitted</span>';
        }

        const card = document.createElement('div');
        card.className = 'rfq-bidding-card';
        card.innerHTML = `
          <div class="vendor-card-header">
            <span class="text-xs text-muted">Ends: ${rfq.deadline}</span>
            ${statusBadge}
          </div>
          <h3 class="vendor-title">${rfq.title}</h3>
          <p class="text-xs text-muted margin-bottom-md" style="flex-grow: 1;">${rfq.description || 'No specifications provided'}</p>
          <div class="vendor-actions">
            <span class="text-xs">Items: ${rfq.items.length} lines</span>
            <button class="btn btn-emerald btn-sm" onclick="openBiddingForm(${rfq.id})">
              ${isDraft ? 'Resume Draft' : (hasQuote ? 'Edit Submission' : 'Draft Quotation')}
            </button>
          </div>
        `;
        container.appendChild(card);
      });
      lucide.createIcons();
    }
  } catch (e) {
    showToast('Failed to load bidding proposals', 'danger');
  }
}

async function openBiddingForm(rfqId) {
  try {
    const res = await fetch('/api/rfqs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const quoteRes = await fetch('/api/quotations', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (res.ok && quoteRes.ok) {
      const rfqs = await res.json();
      const quotations = await quoteRes.json();
      
      const rfq = rfqs.find(r => r.id === rfqId);
      if (!rfq) return;

      const myQuote = quotations.find(q => q.rfq_id === rfqId);

      document.getElementById('vendorBiddingListView').style.display = 'none';
      document.getElementById('vendorBiddingFormView').style.display = 'block';

      // Set RFQ Header Details
      document.getElementById('bidRfqTitle').textContent = rfq.title;
      document.getElementById('bidRfqDesc').textContent = rfq.description || 'No detailed specs';
      document.getElementById('bidRfqDeadline').textContent = rfq.deadline;
      document.getElementById('bidRfqCreator').textContent = rfq.creator_name;
      document.getElementById('bidRfqId').value = rfq.id;

      // Reset unit costs table
      const tbody = document.getElementById('bidLinesBody');
      tbody.innerHTML = '';

      rfq.items.forEach(item => {
        let existingPrice = '';
        if (myQuote) {
          const qItem = myQuote.items.find(qi => qi.rfq_item_id === item.id);
          if (qItem) existingPrice = qItem.unit_price;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${item.product_name}</strong></td>
          <td class="item-qty-cell">${item.quantity}</td>
          <td>
            <input type="number" class="bid-unit-price-input" 
                   data-item-id="${item.id}" data-qty="${item.quantity}" 
                   value="${existingPrice}" min="0" step="0.01" required placeholder="0.00">
          </td>
          <td class="bid-row-total">$0.00</td>
        `;
        tbody.appendChild(tr);
      });

      // Populate delivery days and comments
      document.getElementById('bid_delivery').value = myQuote ? myQuote.delivery_days : '';
      document.getElementById('bid_remarks').value = myQuote ? myQuote.remarks : '';

      // Initialize inputs total calculators
      document.querySelectorAll('.bid-unit-price-input').forEach(input => {
        input.addEventListener('input', calculateBidTotals);
      });

      calculateBidTotals();
    }
  } catch (e) {
    showToast('Failed to open bidding workspace', 'danger');
  }
}

function calculateBidTotals() {
  let grandTotal = 0;
  document.querySelectorAll('.bid-unit-price-input').forEach(input => {
    const qty = parseFloat(input.dataset.qty) || 0;
    const unitPrice = parseFloat(input.value) || 0;
    const total = qty * unitPrice;
    
    // Update row cell
    const tr = input.closest('tr');
    tr.querySelector('.bid-row-total').textContent = `$${total.toFixed(2)}`;
    
    grandTotal += total;
  });

  document.getElementById('bidGrandTotal').textContent = `$${grandTotal.toFixed(2)}`;
}

async function submitQuotation(isDraft) {
  const rfqId = parseInt(document.getElementById('bidRfqId').value);
  const deliveryDays = parseInt(document.getElementById('bid_delivery').value);
  const remarks = document.getElementById('bid_remarks').value;

  if (isNaN(deliveryDays) || deliveryDays <= 0) {
    showToast('Please enter a valid guaranteed delivery timeline', 'warning');
    return;
  }

  // Build items array
  const items = [];
  let isValid = true;
  document.querySelectorAll('.bid-unit-price-input').forEach(input => {
    const unitPrice = parseFloat(input.value);
    if (isNaN(unitPrice) || unitPrice < 0) {
      isValid = false;
    }
    items.push({
      rfq_item_id: parseInt(input.dataset.itemId),
      unit_price: unitPrice
    });
  });

  if (!isValid && !isDraft) {
    showToast('Please specify bid prices for all items', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/quotations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ rfq_id: rfqId, delivery_days: deliveryDays, remarks, items, is_draft: isDraft })
    });
    if (res.ok) {
      showToast(isDraft ? 'Quotation draft saved successfully!' : 'Quotation submitted successfully!', 'success');
      switchView('bidding');
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to submit bid', 'danger');
    }
  } catch (e) {
    showToast('Network error during bid submission', 'danger');
  }
}

// ==========================================
// 7. SCREEN 6: COMPARISON MATRIX
// ==========================================

async function openComparisonMatrix(rfqId) {
  switchView('pos'); // Jump view to comparison routing shell internally
  // Actually we have view_comparison inside the main shell! Let's display the view panel
  
  // Deactivate others
  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById('view-comparison').classList.add('active');
  document.getElementById('currentViewTitle').textContent = 'Quotation Evaluation Matrix';

  try {
    const res = await fetch(`/api/rfqs/${rfqId}/comparison`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      document.getElementById('comparisonRfqTitle').textContent = `Comparison: ${data.rfq.title}`;
      document.getElementById('compRfqDesc').textContent = data.rfq.description || 'No technical guidelines';
      document.getElementById('compBidsCount').textContent = `${data.quotations.length} Bids Submitted`;
      
      renderComparisonMatrix(data);
    }
  } catch (e) {
    showToast('Failed to generate matrix', 'danger');
  }
}

function renderComparisonMatrix(data) {
  const container = document.getElementById('comparisonMatrixContainer');
  container.innerHTML = '';

  if (data.quotations.length === 0) {
    container.innerHTML = '<div class="empty-state" style="width: 100%;"><i data-lucide="file-warning"></i><p>No vendor quotations submitted for this RFQ yet</p></div>';
    lucide.createIcons();
    return;
  }

  // Find the lowest price bid
  let lowestGrandTotal = Infinity;
  let lowestQuoteId = null;

  data.quotations.forEach(q => {
    if (q.grand_total < lowestGrandTotal) {
      lowestGrandTotal = q.grand_total;
      lowestQuoteId = q.quotation_id;
    }
  });

  data.quotations.forEach(q => {
    const isLowest = q.quotation_id === lowestQuoteId;
    const col = document.createElement('div');
    col.className = `comparison-column ${isLowest ? 'lowest-cost' : ''}`;
    
    let stars = '★'.repeat(Math.round(q.vendor_rating)) + '☆'.repeat(5 - Math.round(q.vendor_rating));
    
    // Header
    let lowestBadgeHTML = isLowest ? '<div class="lowest-cost-badge">Lowest Price Proposal</div>' : '';
    
    // Generate lines breakdown
    let itemsHTML = '';
    data.items.forEach(rfqItem => {
      const bidItem = q.items.find(qi => qi.rfq_item_id === rfqItem.id);
      const price = bidItem ? `$${bidItem.unit_price.toFixed(2)}` : 'N/A';
      const total = bidItem ? `$${bidItem.total_price.toFixed(2)}` : 'N/A';
      itemsHTML += `
        <div class="comp-item-row">
          <span class="comp-item-name">${rfqItem.product_name} (x${rfqItem.quantity})</span>
          <span class="comp-item-price">${price} <small class="text-muted">(${total})</small></span>
        </div>
      `;
    });

    col.innerHTML = `
      ${lowestBadgeHTML}
      <div class="comparison-header">
        <h4 class="comparison-vendor-name">${q.vendor_name}</h4>
        <div class="comparison-score">
          <span>${stars}</span>
          <span>(${q.vendor_rating.toFixed(1)})</span>
        </div>
      </div>
      
      <div class="comparison-items-list">
        <h5>Pricing Line Items</h5>
        ${itemsHTML}
      </div>

      <div class="comparison-summary-card">
        <div class="comparison-total-row">
          <span class="comparison-total-label">Grand Total Bid:</span>
          <span>$${q.grand_total.toFixed(2)}</span>
        </div>
        <div class="comparison-timeline">
          <i data-lucide="truck"></i>
          <span>Guaranteed: <strong>${q.delivery_days} Days</strong> delivery</span>
        </div>
        ${q.remarks ? `<p class="text-xs text-muted margin-top-sm"><em>"${q.remarks}"</em></p>` : ''}
      </div>

      <button class="btn btn-primary margin-top-lg" onclick="selectWinningQuotation(${q.quotation_id})">
        Select Winning Bid
      </button>
    `;
    container.appendChild(col);
  });
  lucide.createIcons();
}

async function selectWinningQuotation(quoteId) {
  try {
    const res = await fetch(`/api/quotations/${quoteId}/select`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      showToast('Quotation selected and routed to approval queue!', 'success');
      switchView('rfqs');
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to select quotation', 'danger');
    }
  } catch (e) {
    showToast('Network select error', 'danger');
  }
}

// ==========================================
// 8. SCREEN 7: APPROVAL ENGINE
// ==========================================

async function fetchApprovalQueue() {
  try {
    const res = await fetch('/api/approvals', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      
      // Render Pending Queue
      const queueContainer = document.getElementById('approvalQueueContainer');
      queueContainer.innerHTML = '';
      
      document.getElementById('pendingApprovalsBadge').textContent = `${data.pending.length} Queue`;

      if (data.pending.length === 0) {
        queueContainer.innerHTML = '<div class="empty-state"><i data-lucide="check-circle-2"></i><p>No procurement packages pending approval</p></div>';
      } else {
        data.pending.forEach(p => {
          const item = document.createElement('div');
          item.className = 'card margin-bottom-md';
          
          let itemsList = p.items.map(i => `<li>${i.product_name} (x${i.quantity}) at $${i.unit_price.toFixed(2)}/ea</li>`).join('');

          item.innerHTML = `
            <div class="card-header">
              <h4>Request for Quotation approval: ${p.rfq_title}</h4>
              <span class="badge badge-warning">Awaiting Decision</span>
            </div>
            <div class="card-content">
              <div class="document-addresses" style="margin-bottom: var(--space-md);">
                <div>
                  <strong>Supplier Bidder:</strong> ${p.vendor_name} (Rating: ${p.vendor_rating}/5.0)
                </div>
                <div class="text-right">
                  <strong>Financial Proposal:</strong> <span class="text-indigo font-bold">$${p.grand_total.toFixed(2)}</span> (Tax: 18%)
                </div>
              </div>
              <ul class="margin-bottom-md text-xs" style="padding-left: 20px;">
                ${itemsList}
              </ul>
              
              <div class="form-group">
                <label for="approval_remarks_${p.quotation_id}">Manager Sign-off Remarks <span class="required">*</span></label>
                <input type="text" id="approval_remarks_${p.quotation_id}" placeholder="Provide detailed audit remarks or justification for approval/rejection...">
              </div>
              
              <div class="form-actions-row" style="margin-top: var(--space-md);">
                <button class="btn btn-secondary" onclick="processApproval('quotation', ${p.quotation_id}, 'rejected')">
                  <i data-lucide="x-circle"></i> Reject Bid
                </button>
                <button class="btn btn-emerald" onclick="processApproval('quotation', ${p.quotation_id}, 'approved')">
                  <i data-lucide="check-circle"></i> Approve & Issue PO
                </button>
              </div>
            </div>
          `;
          queueContainer.appendChild(item);
        });
      }

      // Render Approval history timeline
      const historyContainer = document.getElementById('approvalHistoryContainer');
      historyContainer.innerHTML = '';
      if (data.history.length === 0) {
        historyContainer.innerHTML = '<p class="text-muted text-xs">No historical actions logged</p>';
      } else {
        data.history.forEach(h => {
          const isApproved = h.status === 'approved';
          const step = document.createElement('div');
          step.className = `timeline-step ${isApproved ? 'approved' : 'rejected'}`;
          step.innerHTML = `
            <div class="timeline-dot"><i data-lucide="${isApproved ? 'check' : 'x'}"></i></div>
            <div class="timeline-content">
              <div class="timeline-title">${h.manager_name} ${isApproved ? 'Approved' : 'Rejected'} Quote #${h.document_id}</div>
              <div class="timeline-time">${new Date(h.created_at).toLocaleString()}</div>
              ${h.remarks ? `<div class="timeline-remarks">"${h.remarks}"</div>` : ''}
            </div>
          `;
          historyContainer.appendChild(step);
        });
      }
      lucide.createIcons();
    }
  } catch (e) {
    showToast('Failed to load approval queues', 'danger');
  }
}

async function processApproval(docType, docId, decision) {
  const remarksInput = document.getElementById(`approval_remarks_${docId}`);
  const remarks = remarksInput.value.trim();

  if (!remarks) {
    showToast('Audit remarks are mandatory before decision submission', 'warning');
    remarksInput.focus();
    return;
  }

  try {
    const res = await fetch('/api/approvals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ document_type: docType, document_id: docId, status: decision, remarks })
    });
    if (res.ok) {
      showToast(decision === 'approved' ? 'Purchase Order successfully generated!' : 'Bid successfully rejected and reopened.', 'success');
      loadViewData(currentView);
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to submit decision', 'danger');
    }
  } catch (e) {
    showToast('Network approval error', 'danger');
  }
}

// ==========================================
// 9. SCREEN 8: PO & INVOICE GENERATOR
// ==========================================

async function fetchPOsAndInvoices() {
  try {
    // 1. Fetch POs
    const poRes = await fetch('/api/pos', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const poBody = document.getElementById('poTableBody');
    poBody.innerHTML = '';

    if (poRes.ok) {
      const pos = await poRes.json();
      if (pos.length === 0) {
        poBody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No Purchase Orders generated.</td></tr>';
      } else {
        pos.forEach(po => {
          const statusBadge = `<span class="badge ${getStatusClass(po.status)}">${po.status}</span>`;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${po.po_number}</strong></td>
            <td>${po.rfq_title}</td>
            <td><strong>${po.vendor_name || 'Your Company'}</strong></td>
            <td>${po.officer_name}</td>
            <td>$${po.total_amount.toFixed(2)}</td>
            <td>$${po.tax_amount.toFixed(2)}</td>
            <td><strong>$${po.grand_total.toFixed(2)}</strong></td>
            <td>${statusBadge}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="viewDocument('po', ${po.id})">
                <i data-lucide="eye"></i> View PO
              </button>
            </td>
          `;
          poBody.appendChild(tr);
        });
      }
    }

    // 2. Fetch Invoices
    const invRes = await fetch('/api/invoices', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const invBody = document.getElementById('invoiceTableBody');
    invBody.innerHTML = '';

    if (invRes.ok) {
      const invoices = await invRes.json();
      if (invoices.length === 0) {
        invBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No Invoices generated.</td></tr>';
      } else {
        invoices.forEach(inv => {
          const statusBadge = `<span class="badge ${getStatusClass(inv.status)}">${inv.status}</span>`;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${inv.invoice_number}</strong></td>
            <td>${inv.po_number}</td>
            <td><strong>${inv.vendor_name || 'Your Company'}</strong></td>
            <td><strong>$${inv.grand_total.toFixed(2)}</strong></td>
            <td>${statusBadge}</td>
            <td>${new Date(inv.created_at).toLocaleDateString()}</td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="viewDocument('invoice', ${inv.id})">
                <i data-lucide="eye"></i> View Invoice
              </button>
            </td>
          `;
          invBody.appendChild(tr);
        });
      }
    }
    lucide.createIcons();
  } catch (e) {
    showToast('Failed to load purchase/invoicing data', 'danger');
  }
}

async function viewDocument(type, id) {
  try {
    let doc;
    if (type === 'po') {
      const res = await fetch('/api/pos', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const pos = await res.json();
      doc = pos.find(p => p.id === id);
    } else {
      const res = await fetch('/api/invoices', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const invoices = await res.json();
      doc = invoices.find(inv => inv.id === id);
    }

    if (!doc) return;

    // Open Modal Details Overlay
    const modal = document.getElementById('documentDetailsModal');
    modal.style.display = 'flex';

    // Set Document Details text
    document.getElementById('docTypeName').textContent = type === 'po' ? 'PURCHASE ORDER' : 'BILLING INVOICE';
    document.getElementById('docNumber').textContent = type === 'po' ? doc.po_number : doc.invoice_number;
    document.getElementById('docDate').textContent = new Date(doc.created_at).toLocaleDateString();
    
    const statusBadge = document.getElementById('docStatusBadge');
    statusBadge.textContent = doc.status;
    statusBadge.className = `badge ${getStatusClass(doc.status)}`;

    document.getElementById('docVendorName').textContent = doc.vendor_name || currentUser.name;
    document.getElementById('docPreparedBy').textContent = doc.officer_name || ' Sarah Jenkins';

    // Load Line Items Table
    const tbody = document.getElementById('docItemsBody');
    tbody.innerHTML = '';
    
    doc.items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><strong>${item.product_name}</strong></td>
        <td style="text-align: center;">${item.quantity}</td>
        <td style="text-align: right;">$${item.unit_price.toFixed(2)}</td>
        <td style="text-align: right;">$${item.total_price.toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    });

    // Subtotals
    document.getElementById('docSubtotal').textContent = `$${doc.total_amount.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById('docTax').textContent = `$${doc.tax_amount.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById('docGrandTotal').textContent = `$${doc.grand_total.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    // Manage contextual document actions footer buttons
    const btnDispatch = document.getElementById('btnDocDispatch');
    const btnInvoiceGen = document.getElementById('btnDocInvoiceGen');
    const btnInvoicePay = document.getElementById('btnDocInvoicePay');

    btnDispatch.style.display = 'none';
    btnInvoiceGen.style.display = 'none';
    btnInvoicePay.style.display = 'none';

    if (type === 'po') {
      if (currentUser.role === 'procurement_officer' && doc.status === 'draft') {
        btnDispatch.style.display = 'inline-flex';
        btnDispatch.onclick = () => dispatchPO(doc.id);
      }
      if (currentUser.role === 'procurement_officer' && (doc.status === 'sent' || doc.status === 'draft')) {
        btnInvoiceGen.style.display = 'inline-flex';
        btnInvoiceGen.onclick = () => generateInvoiceFromPO(doc.id);
      }
    } else {
      if ((currentUser.role === 'procurement_officer' || currentUser.role === 'manager') && doc.status === 'unpaid') {
        btnInvoicePay.style.display = 'inline-flex';
        btnInvoicePay.onclick = () => recordInvoicePayment(doc.id);
      }
    }

    lucide.createIcons();
  } catch (e) {
    showToast('Failed to render document details', 'danger');
  }
}

async function dispatchPO(poId) {
  try {
    const res = await fetch(`/api/pos/${poId}/dispatch`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      showToast('Purchase Order dispatched successfully.', 'success');
      document.getElementById('documentDetailsModal').style.display = 'none';
      fetchPOsAndInvoices();
    }
  } catch (e) {
    showToast('Failed to dispatch PO', 'danger');
  }
}

async function generateInvoiceFromPO(poId) {
  try {
    const res = await fetch(`/api/pos/${poId}/invoice`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      showToast('Invoice generated directly from PO guidelines successfully!', 'success');
      document.getElementById('documentDetailsModal').style.display = 'none';
      fetchPOsAndInvoices();
    } else {
      const err = await res.json();
      showToast(err.error || 'Invoice generation error', 'danger');
    }
  } catch (e) {
    showToast('Network error during invoice creation', 'danger');
  }
}

async function recordInvoicePayment(invoiceId) {
  try {
    const res = await fetch(`/api/invoices/${invoiceId}/pay`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      showToast('Invoice settlement logged successfully!', 'success');
      document.getElementById('documentDetailsModal').style.display = 'none';
      fetchPOsAndInvoices();
    }
  } catch (e) {
    showToast('Payment update error', 'danger');
  }
}

// ==========================================
// 10. SCREEN 9: AUDIT LOGS
// ==========================================

async function fetchAuditLogs() {
  try {
    const res = await fetch('/api/audit-logs', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const logs = await res.json();
      const body = document.getElementById('auditLogsTableBody');
      body.innerHTML = '';

      logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.className = 'text-xs';
        tr.innerHTML = `
          <td>${new Date(log.timestamp).toLocaleString()}</td>
          <td><strong>${log.user_name || 'System Action'}</strong></td>
          <td><span class="badge badge-info">${log.user_role || 'system'}</span></td>
          <td><strong>${log.action}</strong></td>
          <td>${log.details || ''}</td>
        `;
        body.appendChild(tr);
      });
    }
  } catch (e) {
    showToast('Failed to load audit logs', 'danger');
  }
}

function exportAuditLogsCSV() {
  const table = document.querySelector('#view-audit table');
  let csv = [];
  const rows = table.querySelectorAll('tr');
  
  for (let i = 0; i < rows.length; i++) {
    const row = [], cols = rows[i].querySelectorAll('td, th');
    
    for (let j = 0; j < cols.length; j++) {
      // Clean text content
      let data = cols[j].innerText.replace(/(\r\n|\n|\r)/gm, '').replace(/(\s\s+)/gm, ' ');
      data = data.replace(/"/g, '""');
      row.push('"' + data + '"');
    }
    csv.push(row.join(','));
  }
  
  const csvString = csv.join('\n');
  const filename = `audit_logs_${new Date().toISOString().slice(0,10)}.csv`;
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  
  if (navigator.msSaveBlob) { // IE 10+
    navigator.msSaveBlob(blob, filename);
  } else {
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
  showToast('Audit trail CSV exported successfully', 'success');
}

// ==========================================
// 11. SCREEN 10: REPORTS & ANALYTICS
// ==========================================

async function fetchAnalyticsData() {
  try {
    const res = await fetch('/api/analytics', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();

      // Render Chart 1: Monthly Spend
      renderMonthlyChart(data.monthlySpend);

      // Render Chart 2: Category Spend
      renderCategoryChart(data.categorySpend);

      // Render Vendor Stats Table
      const body = document.getElementById('analyticsVendorsTableBody');
      body.innerHTML = '';
      
      if (data.vendorStats.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No vendor compliance recorded</td></tr>';
      } else {
        data.vendorStats.forEach(v => {
          const tr = document.createElement('tr');
          const rate = v.total_bids > 0 ? ((v.awarded_pos / v.total_bids) * 100).toFixed(0) : '0';
          
          let stars = '★'.repeat(Math.round(v.rating)) + '☆'.repeat(5 - Math.round(v.rating));

          tr.innerHTML = `
            <td><strong>${v.name}</strong></td>
            <td>${v.category}</td>
            <td><span class="text-warning font-bold">${stars} (${v.rating.toFixed(1)})</span></td>
            <td>${v.total_bids}</td>
            <td>${v.awarded_pos}</td>
            <td><strong>${rate}%</strong></td>
            <td><strong>$${v.total_earnings.toFixed(2)}</strong></td>
          `;
          body.appendChild(tr);
        });
      }
    }
  } catch (e) {
    showToast('Failed to load analytics dashboard', 'danger');
  }
}

function renderMonthlyChart(data) {
  if (charts.monthly) charts.monthly.destroy();

  const labels = data.map(d => d.month);
  const spends = data.map(d => d.spend);

  const ctx = document.getElementById('monthlySpendChart').getContext('2d');
  charts.monthly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length > 0 ? labels : ['No Data'],
      datasets: [{
        label: 'Procurement Spend ($)',
        data: spends.length > 0 ? spends : [0],
        backgroundColor: '#4f46e5',
        borderColor: '#4338ca',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });
}

function renderCategoryChart(data) {
  if (charts.category) charts.category.destroy();

  const labels = data.map(d => d.category || 'Uncategorized');
  const spends = data.map(d => d.spend);

  const ctx = document.getElementById('categorySpendChart').getContext('2d');
  charts.category = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.length > 0 ? labels : ['No Data'],
      datasets: [{
        data: spends.length > 0 ? spends : [1],
        backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#64748b'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

// ==========================================
// 12. UTILITY & NOTIFICATION HELPERS
// ==========================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'info';
  if (type === 'success') icon = 'check-circle';
  if (type === 'warning') icon = 'alert-triangle';
  if (type === 'danger') icon = 'x-circle';

  toast.innerHTML = `
    <i data-lucide="${icon}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.25s forwards';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

// Add CSS keyframe on the fly for fading out
const styleSheet = document.createElement('style');
styleSheet.innerText = `
  @keyframes fadeOut {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(100%); }
  }
`;
document.head.appendChild(styleSheet);

// Slide-out Notification panel actions
async function toggleNotificationPanel() {
  const panel = document.getElementById('notificationPanel');
  panel.classList.toggle('open');
  
  if (panel.classList.contains('open')) {
    // Populate panel contents from activity stream
    try {
      const res = await fetch('/api/activity-stream', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const logs = await res.json();
        const list = document.getElementById('notificationList');
        list.innerHTML = '';
        
        if (logs.length === 0) {
          list.innerHTML = '<div class="empty-state"><i data-lucide="check-circle-2"></i><p>No system logs yet</p></div>';
        } else {
          logs.forEach(log => {
            const div = document.createElement('div');
            div.className = 'activity-feed-item';
            div.style.marginBottom = 'var(--space-md)';
            div.style.borderLeft = '2px solid var(--primary)';
            div.style.paddingLeft = 'var(--space-sm)';
            const formattedDate = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            div.innerHTML = `
              <strong>${log.action.replace(/_/g, ' ')}</strong><br>
              <span class="text-xs text-muted">${log.details}</span><br>
              <small class="activity-time">${formattedDate} by ${log.user_name}</small>
            `;
            list.appendChild(div);
          });
        }
        lucide.createIcons();
      }
    } catch (e) {
      console.error(e);
    }
  }
}

// ==========================================
// EVENT LISTENER REGISTRY
// ==========================================

function initEventListeners() {
  // Authentication Forms
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login_email').value;
    const pass = document.getElementById('login_password').value;
    loginUser(email, pass);
  });

  document.getElementById('signupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('signup_name').value;
    const email = document.getElementById('signup_email').value;
    const pass = document.getElementById('signup_password').value;
    const role = document.getElementById('signup_role').value;
    const gst = document.getElementById('signup_gst').value;
    const category = document.getElementById('signup_category').value;
    signupUser(name, email, pass, role, gst, category);
  });

  document.getElementById('signup_role').addEventListener('change', (e) => {
    const extra = document.getElementById('signupVendorExtra');
    if (e.target.value === 'vendor') {
      extra.style.display = 'block';
      document.getElementById('signup_gst').setAttribute('required', 'true');
      document.getElementById('signup_category').setAttribute('required', 'true');
    } else {
      extra.style.display = 'none';
      document.getElementById('signup_gst').removeAttribute('required');
      document.getElementById('signup_category').removeAttribute('required');
    }
  });

  document.getElementById('forgotPasswordBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login_email').value;
    if (!email) {
      showToast('Please enter your email in the email field first', 'warning');
      return;
    }
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message, 'success');
      } else {
        showToast(data.error || 'Failed to trigger reset', 'danger');
      }
    } catch (e) {
      showToast('Network error during reset', 'danger');
    }
  });

  // Toggle Login/Signup Cards
  document.getElementById('authTabLogin').addEventListener('click', () => {
    document.getElementById('authTabLogin').classList.add('active');
    document.getElementById('authTabSignup').classList.remove('active');
    document.getElementById('authCardLogin').style.display = 'block';
    document.getElementById('authCardSignup').style.display = 'none';
  });

  document.getElementById('authTabSignup').addEventListener('click', () => {
    document.getElementById('authTabSignup').classList.add('active');
    document.getElementById('authTabLogin').classList.remove('active');
    document.getElementById('authCardSignup').style.display = 'block';
    document.getElementById('authCardLogin').style.display = 'none';
  });



  // Sidebar navigation switching
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      switchView(view);
    });
  });

  document.getElementById('logoutButton').addEventListener('click', logout);

  // Theme Toggler
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const activeTheme = document.body.classList.contains('light-mode') ? 'dark-mode' : 'light-mode';
    setTheme(activeTheme);
  });

  // Notifications slide
  document.getElementById('notificationBtn').addEventListener('click', toggleNotificationPanel);
  document.getElementById('closeNotificationPanel').addEventListener('click', () => {
    document.getElementById('notificationPanel').classList.remove('open');
  });

  // Dashboard quick triggers
  document.getElementById('dashActionCreateRfq').addEventListener('click', () => {
    switchView('rfqs');
    showRfqCreateView();
  });
  document.getElementById('dashActionSubmitBid').addEventListener('click', () => switchView('bidding'));
  document.getElementById('dashActionApprovalQueue').addEventListener('click', () => switchView('approvals'));
  document.getElementById('dashActionOnboardVendor').addEventListener('click', () => {
    switchView('vendors');
    document.getElementById('onboardVendorModal').style.display = 'flex';
  });

  // Onboard Vendor Modal controls
  document.getElementById('btnOnboardVendorOpen').addEventListener('click', () => {
    document.getElementById('onboardVendorModal').style.display = 'flex';
  });
  document.getElementById('btnCloseOnboardVendor').addEventListener('click', () => {
    document.getElementById('onboardVendorModal').style.display = 'none';
  });
  document.getElementById('btnCancelOnboard').addEventListener('click', () => {
    document.getElementById('onboardVendorModal').style.display = 'none';
  });

  document.getElementById('onboardVendorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('v_name').value;
    const email = document.getElementById('v_email').value;
    const password = document.getElementById('v_password').value;
    const gst_number = document.getElementById('v_gst').value;
    const category = document.getElementById('v_category').value;

    try {
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, email, password, gst_number, category })
      });
      if (res.ok) {
        showToast('Vendor onboarded successfully!', 'success');
        document.getElementById('onboardVendorModal').style.display = 'none';
        document.getElementById('onboardVendorForm').reset();
        fetchVendors();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to onboard vendor', 'danger');
      }
    } catch (err) {
      showToast('Network error during onboarding', 'danger');
    }
  });

  // Vendor searching / filtering registry
  document.getElementById('vendorSearchInput').addEventListener('input', () => renderVendors(window.lastVendors || []));
  document.getElementById('vendorCategoryFilter').addEventListener('change', () => renderVendors(window.lastVendors || []));

  // RFQ Engine Views controls
  document.getElementById('btnCreateRfqOpen').addEventListener('click', showRfqCreateView);
  document.getElementById('btnRfqCreateBack').addEventListener('click', showRfqListView);
  document.getElementById('btnCancelCreateRfq').addEventListener('click', showRfqListView);

  // RFQ line item creation buttons
  document.getElementById('btnAddRfqLineItem').addEventListener('click', () => {
    const tbody = document.getElementById('rfqLinesBody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="rfq-line-desc" required placeholder="e.g. Ergonomic Office Mice"></td>
      <td>
        <div class="quantity-counter">
          <button type="button" class="qty-btn dec">-</button>
          <input type="number" class="rfq-line-qty" value="1" min="1" required>
          <button type="button" class="qty-btn inc">+</button>
        </div>
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn-delete-line"><i data-lucide="trash-2"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
    lucide.createIcons();
    
    // Register increment / decrement listeners
    registerQtyListeners(tr);
  });

  // Helper listener for line deletions and counters
  document.getElementById('rfqLinesTable').addEventListener('click', (e) => {
    if (e.target.closest('.btn-delete-line')) {
      const row = e.target.closest('tr');
      if (document.querySelectorAll('#rfqLinesBody tr').length > 1) {
        row.remove();
      } else {
        showToast('At least one line item is required.', 'warning');
      }
    }
  });

  // Initial row listeners for quantity counters
  document.querySelectorAll('#rfqLinesBody tr').forEach(row => registerQtyListeners(row));

  // Create RFQ form submission
  document.getElementById('createRfqForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('rfq_title').value;
    const description = document.getElementById('rfq_desc').value;
    const deadline = document.getElementById('rfq_deadline').value;

    const items = [];
    document.querySelectorAll('#rfqLinesBody tr').forEach(row => {
      const desc = row.querySelector('.rfq-line-desc').value;
      const qty = parseInt(row.querySelector('.rfq-line-qty').value);
      items.push({ product_name: desc, quantity: qty });
    });

    const vendor_ids = [];
    document.querySelectorAll('input[name="rfq_vendor_ids"]:checked').forEach(cb => {
      vendor_ids.push(parseInt(cb.value));
    });

    if (vendor_ids.length === 0) {
      showToast('Please assign at least one corporate vendor to this RFQ.', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/rfqs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title, description, deadline, items, vendor_ids })
      });
      if (res.ok) {
        showToast('RFQ successfully initialized and vendors notified!', 'success');
        document.getElementById('createRfqForm').reset();
        showRfqListView();
        fetchRfqs();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to create RFQ', 'danger');
      }
    } catch (err) {
      showToast('RFQ Creation Error', 'danger');
    }
  });

  // Bidding buttons return
  document.getElementById('btnVendorBiddingBack').addEventListener('click', showBiddingListView);

  document.getElementById('btnSaveBidDraft').addEventListener('click', () => submitQuotation(true));
  document.getElementById('submitQuotationForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitQuotation(false);
  });

  // Comparison return buttons
  document.getElementById('btnComparisonBack').addEventListener('click', () => switchView('rfqs'));

  // Document modal close & printing buttons
  document.getElementById('btnDocClose').addEventListener('click', () => {
    document.getElementById('documentDetailsModal').style.display = 'none';
  });
  document.getElementById('btnDocPrint').addEventListener('click', () => {
    window.print();
  });
  document.getElementById('btnDocDownload').addEventListener('click', () => {
    showToast('Compiling document elements. Downloading PDF...', 'info');
    // Using standard print stylesheet or triggers to export as PDF cleanly.
    // Triggering print modal which supports "Save as PDF" natively in all modern browsers.
    window.print();
  });

  // Audit export CSV
  document.getElementById('btnExportAuditLogs').addEventListener('click', exportAuditLogsCSV);

  // Tab routing inside PO views
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      
      const paneId = btn.dataset.tab;
      document.getElementById(paneId).classList.add('active');
    });
  });

  // Drag and drop attachment mock
  const dropZone = document.getElementById('fileUploadZone');
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--primary)';
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--border-color)';
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border-color)';
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      document.getElementById('uploadFileName').textContent = `${file.name} (${(file.size/1024).toFixed(1)} KB)`;
      showToast(`Specs file '${file.name}' attached successfully`, 'success');
    }
  });
  dropZone.addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      document.getElementById('uploadFileName').textContent = `${file.name} (${(file.size/1024).toFixed(1)} KB)`;
      showToast(`Specs file '${file.name}' attached successfully`, 'success');
    }
  });

  // Export Analytics PDF trigger
  document.getElementById('btnExportAnalyticsReport').addEventListener('click', () => {
    showToast('Rendering analytics data reports. Downloading PDF...', 'info');
    window.print();
  });
}

function registerQtyListeners(row) {
  const input = row.querySelector('.rfq-line-qty');
  const decBtn = row.querySelector('.qty-btn.dec');
  const incBtn = row.querySelector('.qty-btn.inc');

  decBtn.addEventListener('click', () => {
    const val = parseInt(input.value) || 1;
    if (val > 1) {
      input.value = val - 1;
    }
  });

  incBtn.addEventListener('click', () => {
    const val = parseInt(input.value) || 1;
    input.value = val + 1;
  });
}

// Wrapper to cache vendors list for searching
const originalFetchVendors = fetchVendors;
fetchVendors = async () => {
  try {
    const res = await fetch('/api/vendors', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const vendors = await res.json();
      window.lastVendors = vendors;
      renderVendors(vendors);
    }
  } catch (e) {
    showToast('Failed to load vendors', 'danger');
  }
};
