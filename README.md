# Personal Finance Ledger

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Node.js](https://img.shields.io/badge/node-%3E%3D14.0-brightgreen)
![Status: Active](https://img.shields.io/badge/Status-Active-success)

A **zero-dependency, end-to-end encrypted** double-entry accounting system designed for personal finance management. Built with vanilla Node.js and runs seamlessly on **Termux (Android), Windows, macOS, and Linux**.

---

## 🎯 Overview

This application implements a complete double-entry bookkeeping engine with military-grade encryption, audit trails, and comprehensive financial analytics. It's designed for users who want complete control over their financial data without relying on cloud services or third-party integrations.

**Key Differentiators:**
- ✅ 100% local execution—no external servers or API calls
- ✅ Client-side encryption with PBKDF2 key derivation (100,000 iterations)
- ✅ AES-256-GCM encryption for persistent data
- ✅ Real-time trial balance verification
- ✅ Session-based authentication with rate limiting
- ✅ CSRF protection and security headers

---

## ✨ Core Features

### Accounting Engine
- **Double-Entry Bookkeeping** — Accurate debit/credit mechanics following standard accounting principles
- **Multi-Leg Vouchers** — Support for up to N-leg transactions (Payment, Receipt, Contra, Journal types)
- **Trial Balance Audit** — Real-time arithmetic verification with zero-difference guarantee
- **Ledger Balances** — Automatic calculation of opening balance, gross totals, and closing balances

### Financial Analysis
- **Balance Sheet** — Assets, liabilities, capital, and equity at a glance
- **Profit & Loss** — Monthly income and expense summaries with YoY comparison
- **Cash Flow Statement** — Categorized by Operating, Investing, and Financing activities
- **Budget Tracking** — Set and monitor budgets by expense category with spend alerts

### Credit Card Management
- **Automated Billing Cycles** — Configurable statement day and grace period per card
- **Spend Tracking** — Distinction between billed, unbilled, and repaid amounts
- **Due Date Alerts** — Automatic status tags (PAID, DUE IN Xd, URGENT, OVERDUE)
- **Multi-Card Support** — Manage unlimited credit card accounts

### Data Management
- **1-Click Backup** — Export complete books as timestamped JSON snapshots
- **Restore Functionality** — Import backed-up data on any device
- **Encryption at Rest** — All data persisted with AES-256-GCM encryption
- **Session Management** — HTTP-only cookies, 24-hour expiry with automatic cleanup

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 14+** ([Download](https://nodejs.org/))
- **Git** (optional, for cloning)

### Installation & Setup

#### Option 1: Android (Termux)
```bash
# Install Node.js and Git
pkg update && pkg install nodejs-lts git -y

# Clone repository
git clone https://github.com/shreeramsharma065/personal-finance-app.git finance-app
cd finance-app

# Start the server
node server.js
```
Open your browser: http://localhost:3000

**Quick Launch Shortcut:**
```bash
cat << 'EOF' > $PREFIX/bin/finance
#!/data/data/com.termux/files/usr/bin/bash
cd ~/finance-app && node server.js
EOF
chmod +x $PREFIX/bin/finance
```
Now simply type: `finance`

#### Option 2: Windows
```powershell
# 1. Install Node.js from https://nodejs.org/
# 2. Clone the repository
git clone https://github.com/shreeramsharma065/personal-finance-app.git finance-app
cd finance-app

# 3. Start server
node server.js
```

**Desktop Shortcut (Optional):**
Create `start.bat` in your finance-app folder:
```batch
@echo off
start http://localhost:3000
node server.js
pause
```
Double-click to launch automatically.

#### Option 3: macOS
```bash
# Install Node.js (via Homebrew)
brew install node git

# Clone repository
git clone https://github.com/shreeramsharma065/personal-finance-app.git finance-app
cd finance-app

# Start server
node server.js
```
Open: http://localhost:3000

#### Option 4: Linux (Ubuntu/Debian/Raspberry Pi)
```bash
# Install dependencies
sudo apt update && sudo apt install -y nodejs git

# Clone repository
git clone https://github.com/shreeramsharma065/personal-finance-app.git finance-app
cd finance-app

# Start server
node server.js
```
Open: http://localhost:3000

---

## 🔧 Configuration & First Run

### Initial Setup
When launched for the first time, the application will:
1. Prompt you to set a master password (minimum 8 characters)
2. Initialize accounts and groups from `default_books.json`
3. Create encrypted database file (`tally_books.enc`)

### Chart of Accounts Setup

**Navigate to the Accounts Tab and configure:**

1. **Bank Accounts** — Add all savings, checking, and investment accounts
2. **Credit Cards** — Set statement day (e.g., 15) and grace period (e.g., 20 days)
3. **Loans & Borrowings** — Personal loans, home loans, vehicle loans
4. **Other Groups** — Income, Expenses, Capital, etc.

### Recording Your First Transaction

1. **Record Starting Balances** — Use Receipt (F6) or Journal (F7) vouchers
   - Example: Bank opening balance of ₹100,000

2. **Verify Trial Balance** — Should show green "Books In Balance (Δ ₹0.00)" badge

3. **Monitor Cash Flow** — View Operating/Investing/Financing flows in Reports

---

## 📊 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/status` | Check auth configuration and login status |
| POST | `/api/auth/setup` | Initialize master password (first-time setup) |
| POST | `/api/auth/login` | Authenticate with master password |
| POST | `/api/auth/logout` | Destroy session and clear MASTER_ENC_KEY |

### Masters (Chart of Accounts)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/masters` | Fetch all groups and ledgers |
| POST | `/api/groups` | Create or update account group |
| DELETE | `/api/groups/:id` | Delete group (if no ledgers or sub-groups) |
| POST | `/api/ledgers` | Create or update ledger account |
| DELETE | `/api/ledgers/:id` | Delete ledger account |

### Transactions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/vouchers` | Record debit/credit entry (Payment, Receipt, etc.) |
| DELETE | `/api/vouchers/:id` | Delete voucher (reverses transaction) |

### Reports & Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports` | Generate comprehensive financial report |
| POST | `/api/budgets` | Set budget for expense ledger |

### Backup & Restore
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/backup` | Download encrypted database as JSON |
| POST | `/api/restore` | Upload and restore backup file |

---

## 🔐 Security Architecture

### Authentication & Encryption
- **Master Password** — PBKDF2-derived key (100,000 iterations, SHA-256)
- **Data Encryption** — AES-256-GCM with random 12-byte IV per transaction
- **Session Management** — HTTP-only cookies with 24-hour TTL
- **Rate Limiting** — 5 failed login attempts trigger 15-minute lockout

### Security Headers
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
SameSite: Strict (cookies)
```

### CSRF Protection
- Cross-origin request validation via Origin/Referer headers
- Automatic rejection of requests from mismatched origins

### Data Safety
- Automatic database backups (`.bak` files on write)
- Encryption-aware write-ahead logging
- Graceful fallback to plaintext for pre-encryption migrations

---

## 📈 Reports & Analytics

### Available Reports
1. **Trial Balance** — Debit/Credit totals with reconciliation status
2. **Balance Sheet** — Assets, liabilities, capital breakdown
3. **Profit & Loss** — Income vs. expenses with YoY comparison
4. **Cash Flow Statement** — Operating, investing, financing categorization
5. **Budget Analysis** — Spend vs. allocation with variance tracking
6. **Credit Card Dues** — Statement dates, grace periods, payment status
7. **Receivables** — Outstanding debtor balances and ageing

### Key Metrics
- **Net Worth** = Total Assets − Third-Party Liabilities
- **Runway (Months)** = Liquid Cash ÷ Monthly Burn Rate
- **Debt Trap Alert** — Triggers if unsecured debt > liquid cash

---

## 💾 Backup & Restore

### Manual Backup
1. Click the **Backup DB** button in the top navigation
2. Downloads a timestamped JSON file (e.g., `tally_backup_2026-10-01.json`)
3. Store securely (USB drive, cloud storage, etc.)

### Restore from Backup
1. Click **Restore** button
2. Select your backup JSON file
3. Confirm restore (replaces current data)

### Important Notes
- Backups are **unencrypted JSON** for portability
- Always encrypt external backups if storing on cloud services
- Keep multiple backup versions for historical recovery

---

## 📁 Project Structure

```
personal-finance-app/
├── server.js                 # Main Express server with accounting logic
├── package.json              # Dependencies (express, cors)
├── public/                   # Frontend assets (HTML, CSS, JS)
├── default_books.json        # Template chart of accounts
├── tally_books.enc          # Encrypted ledger database
├── auth_config.json         # Password hash + salt
├── README.md                # This file
└── .gitignore               # Git configuration
```

### File Descriptions
- **server.js** (43KB) — Complete backend logic including crypto, accounting engine, API routes
- **public/** — Responsive single-page app (SPA) with real-time calculations
- **default_books.json** — Starter chart of accounts for Indian rupees (₹)
- **tally_books.enc** — Encrypted ledger (created on first save)

---

## 🛠️ Development & Customization

### Modifying Chart of Accounts
Edit `default_books.json` to pre-populate groups and ledgers:
```json
{
  "groups": [
    { "id": 1, "name": "Bank", "nature": "Asset", "parentGroup": "Primary" }
  ],
  "ledgers": [
    { "id": 1, "name": "Savings Account", "group": "Bank", "openingBalance": 0 }
  ]
}
```

### Environment Variables
```bash
PORT=3000              # Server port (default: 3000)
NODE_ENV=production    # Set to production for security headers
```

### Extending the API
The accounting engine exposes core functions:
- `calculateBalances(books)` — Compute Dr/Cr totals per ledger
- `computeTrialBalance(books, ledgerBalances)` — Verify Dr = Cr
- `computeCashFlow(books, fromDate, toDate)` — Categorized cash movements
- `computeDues(books, ledgerBalances)` — Credit card and receivable status

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| **"Server already in use"** | Change port: `PORT=3001 node server.js` |
| **"Invalid master password"** | Verify 8+ character password set on first run |
| **Books not loading** | Check `auth_config.json` and `tally_books.enc` exist |
| **Trial balance not zeroing** | Ensure all entries have matching Dr/Cr amounts |
| **Session expires on refresh** | Clear cookies and re-login; sessions have 24h TTL |

---

## 📄 License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) file for details.

---

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome! Please open an issue or pull request on GitHub.

---

## 📞 Support

For issues, questions, or suggestions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review API documentation above
3. Open a GitHub issue with detailed logs

---

**Built with ❤️ for personal finance enthusiasts who value privacy and control.**
