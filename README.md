# Personal Finance Ledger

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Node.js](https://img.shields.io/badge/node-%3E%3D14.0-brightgreen)
![Status: Active](https://img.shields.io/badge/Status-Active-success)

A **zero-dependency, end-to-end encrypted** double-entry accounting system designed for personal finance management. Built with vanilla Node.js and runs seamlessly on **Termux (Android), Windows, macOS, and Linux**. All data stays local on your device.

---

## 🎯 Overview

This application implements a complete double-entry bookkeeping engine with military-grade encryption, audit trails, and comprehensive financial analytics. It's designed for users who want complete control over their finances without relying on cloud services.

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
- **OpenSSL** (required because the app auto-generates a local HTTPS certificate on first launch)

### Installation & Setup

#### Option 1: Android (Termux)
```bash
# Install Node.js and Git
pkg update && pkg install nodejs-lts git openssl -y

# Clone repository
git clone https://github.com/shreeramsharma065/personal-finance-app.git finance-app
cd finance-app

# Start the server
node server.js
```
Open your browser: `https://localhost:3000`

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
# 2. Install OpenSSL if needed
# 3. Clone the repository
git clone https://github.com/shreeramsharma065/personal-finance-app.git finance-app
cd finance-app

# 4. Start server
node server.js
```

**Desktop Shortcut (Optional):**
Create `start.bat` in your finance-app folder:
```batch
@echo off
start https://localhost:3000
node server.js
pause
```
Double-click to launch automatically.

#### Option 3: macOS
```bash
# Install Node.js (via Homebrew)
brew install node git openssl

# Clone repository
git clone https://github.com/shreeramsharma065/personal-finance-app.git finance-app
cd finance-app

# Start server
node server.js
```
Open: `https://localhost:3000`

#### Option 4: Linux (Ubuntu/Debian/Raspberry Pi)
```bash
# Install dependencies
sudo apt update && sudo apt install -y nodejs git openssl

# Clone repository
git clone https://github.com/shreeramsharma065/personal-finance-app.git finance-app
cd finance-app

# Start server
node server.js
```
Open: `https://localhost:3000`

---

## 🔐 First-Time Setup (Required)

This app requires a one-time master-password setup before it can be used.

### Step 1: Start the server
From the project root:
```bash
node server.js
```

On first launch, the app will automatically generate a local SSL certificate in the `ssl/` folder if it does not already exist:
- `ssl/server.key`
- `ssl/server.crt`

This is required because the app runs on HTTPS for secure local access.

### Step 2: Open the app in the browser
Use one of these URLs:
- `https://localhost:3000`
- `https://ledger.local:3000` (after adding the hosts entry below)

### Step 3: Trust the local certificate
Because the certificate is self-signed, the browser will show a warning the first time. You must trust it to proceed.

#### Windows
1. Copy `ssl/server.crt` from the project folder to your machine.
2. Double-click the certificate.
3. Choose `Install Certificate`.
4. Select `Current User`.
5. Place it in `Trusted Root Certification Authorities`.
6. Open `C:\Windows\System32\drivers\etc\hosts` as Administrator and add:
```text
127.0.0.1    ledger.local
```
7. Then open: `https://ledger.local:3000`

#### Android / Termux
1. Copy `ssl/server.crt` to your phone storage.
2. Go to Settings -> Security -> Encryption & credentials -> Install a certificate.
3. Install it as a CA certificate.
4. Then open `https://<your-server-ip>:3000` in the browser.

#### macOS / Linux
If the browser complains about the certificate, import the generated certificate into the system or browser trust store, or open the app using `https://localhost:3000` after trusting the local CA.

### Step 4: Create the master password
When the app detects no password is set yet, it will show the setup screen.

Enter a master password with these rules:
- Minimum 8 characters
- Use a strong password you will remember
- Confirm it on the next field

After submission, the app will:
- create `auth_config.json`
- generate the encrypted ledger file `tally_books.enc`
- initialize the default accounting structure
- log you in automatically for the first session

### Step 5: Login later
After the password is set, reopen the app and sign in with the same master password. The app will use the stored password hash and encryption key to unlock your local ledger.

> Important: The master password is not recoverable. If you forget it, the encrypted data cannot be decrypted.

---

## 🔧 Configuration & First Run

### Initial Setup
When launched for the first time, the application will:
1. Generate a local HTTPS certificate if needed
2. Detect that no master password is configured
3. Ask you to create a master password (minimum 8 characters)
4. Initialize accounts and groups from `default_books.json`
5. Create encrypted database file (`tally_books.enc`)
6. Save authentication details in `auth_config.json`

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
├── ssl/                     # Generated local HTTPS certificate files
├── README.md                # This file
├── .gitignore               # Git configuration
└── LICENSE                  # MIT license
```

### File Descriptions
- **server.js** (43KB) — Complete backend logic including crypto, accounting engine, API routes
- **public/** — Responsive single-page app (SPA) with real-time calculations
- **default_books.json** — Starter chart of accounts for Indian rupees (₹)
- **tally_books.enc** — Encrypted ledger (created on first save)
- **ssl/** — Local certificate generated automatically for secure HTTPS access

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
| **Browser says certificate is unsafe** | Trust the generated `ssl/server.crt` certificate or use `https://localhost:3000` after installation |
| **App asks to set up password** | This is normal for first launch. Create a master password with at least 8 characters |
| **Invalid master password** | Verify 8+ character password set on first run |
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
