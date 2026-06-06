# VendorBridge ERP - Centralized Procurement & Vendor Management

VendorBridge is a centralized, scalable enterprise ERP platform mimicking core modules of Odoo, focused on Requests for Quotations (RFQs), Vendor Bidding, Multi-Stage Approvals, Purchase Order Generation, and Invoicing.

---

## 🛠️ Technology Stack & Architecture

- **Frontend**: Clean single-page application (SPA) built using semantic HTML5, Vanilla JavaScript (ES Modules), and custom Vanilla CSS. Integrates **Lucide Icons** and **Chart.js** (for spending and performance charts).
- **Backend**: Node.js + Express.js REST API server.
- **Database**: SQLite using Node's native `node:sqlite` module, enforcing database-level foreign key integrity with cascading deletes. No native C++ compiler packages required!
- **Security**: Strict cryptographic signature session handling (stateless signed tokens) and secure SHA-256 salted password hashing. Role-Based Access Control (RBAC) middleware limits endpoints dynamically.
- **Print/PDF Engine**: Responsive custom print styles enabling standard browser prints or local PDF downloads.

---

## 📂 Project Structure

```text
/ (Workspace Root)
├── package.json        # Node metadata & starting scripts
├── server.js           # REST API routing, session management, static server
├── database.js         # Schema creation, constraints, hashing, and seeding
├── README.md           # Project guide
└── public/             # Static frontend SPA files
    ├── index.html      # Main application viewport shell
    ├── app.js          # Client-side router, tab controller, calculations
    └── style.css       # Premium HSL light/dark styling & print rules
```

---

## 🚀 Getting Started

### 1. Installation
Ensure Node.js (version 22+) is installed. Run the following command in the workspace directory to download dependencies:
```bash
npm install
```

### 2. Run the Application
Start the Express server:
```bash
npm start
```
The server will run on: [http://localhost:3000](http://localhost:3000).

---

## 🔑 Sandbox Testing Credentials

For evaluation convenience, the database is pre-seeded with the following credentials. All passwords are set to `password`:

| System Role | Email Address | Assigned Entities / Purpose |
| :--- | :--- | :--- |
| **Global Admin** | `admin@vendorbridge.com` | Onboard and verify vendors, view audit trails, check KPIs |
| **Procurement Officer** | `officer@vendorbridge.com` | Create RFQs, compare bids, generate POs and Invoices |
| **Manager / Approver** | `manager@vendorbridge.com` | Approve or reject pending procurement bids with remarks |
| **Vendor 1 (Apex Tech)** | `vendor1@vendorbridge.com` | IT Services, quote pricing for assigned RFQs |
| **Vendor 2 (Office Depot)** | `vendor2@vendorbridge.com` | Office Supplies |
| **Vendor 3 (Global Logistics)** | `vendor3@vendorbridge.com` | Logistics |

### ⚡ Fast Sandbox Role Switcher
In the top right of the application header, a floating dropdown widget named **"Switch Role"** allows assessors to jump instantly between active roles without needing to log out and log back in, facilitating quick end-to-end workflow verification!

---

## 🔄 Core Business Process Lifecycle

1. **RFQ(Request For Quotation) Dispatch**: Log in as **Procurement Officer** -> Click **Create New RFQ** -> Input titles, line items, and select specific vendors. Click Submit.
2. **Vendor Bidding**: Click the **Switch Role** dropdown -> Select **Apex Tech (Vendor)** -> Go to **Bidding Workspace** -> Select the RFQ and input your bid (e.g. Unit Price, delivery timeline, notes) -> Submit.
3. **Closing Bids**: Switch back to **Procurement Officer** -> Go to **RFQ Engine** -> Click **Close Bidding** next to the RFQ to lock submissions and prepare for review.
4. **Side-by-Side Comparison**: In RFQ Engine, click **Compare Bids** to view a grid comparing bids side-by-side (the lowest price is automatically highlighted in emerald). Click **Select Winning Bid**.
5. **Manager Approvals**: Switch role to **Manager** -> Navigate to **Approval Queue** -> Review specifications and pricing -> Enter audit remarks and click **Approve & Issue PO**.
6. **Billing & Settlement**: Switch role back to **Procurement Officer** -> Go to **POs & Invoices** -> View the newly generated Purchase Order -> Click **Generate Invoice** -> Go to Invoices tab -> View and click **Pay Invoice**.
7. **Traceability & Reports**: Navigate to **Intelligence & Reports** (view spend distributions and compliance metrics) and **Audit Stream** (inspect the immutable log trail).
