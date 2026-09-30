# 📊 Personal Finance Ledger

A lightweight, local-first double-entry personal accounting system with a modern web UI. Designed to run smoothly inside **Termux on Android** or locally on **Windows, macOS, and Linux**.

---

## ✨ Features

- **Double-Entry Engine:** Accurate balance tracking using standard debit (`Dr`) and credit (`Cr`) mechanics.
- **Trial Balance Integrity:** Real-time arithmetic checking with an automatic zero-difference ($\Delta \text{ ₹0.00}$) verification badge.
- **Split Multi-Leg Vouchers:** Full support for Payment (`F5`), Receipt (`F6`), Contra (`F4`), and Journal (`F7`) transactions with multiple debit/credit splits.
- **Accurate Net Worth:** Dynamically separates personal equity from third-party liabilities (loans, cards) to calculate true personal net worth.
- **Automated Credit Card Due Tracking:** Tracks statement generation dates, grace periods, billed vs. unbilled spends, and settlement countdowns.
- **Cash Flow & Budget Insights:** Categorizes monthly cash movements into Operating, Investing, and Financing flows.
- **1-Click Backup & Restore:** Export and import complete books as portable JSON snapshots.
- **100% Local & Private:** Runs entirely on your own device; no external servers, cloud databases, or third-party tracking.

---

## 🚀 Quick Start Guide

### Option 1: Running on Android (via Termux)

```bash
# 1. Update and install Node.js + Git
pkg update && pkg install nodejs-lts git -y

# 2. Clone the repository
git clone [https://github.com/shreeramsharma065/personal-finance-app.git](https://github.com/shreeramsharma065/personal-finance-app.git) finance-app
cd finance-app

# 3. Start the application
node server.js
```
Open your browser and navigate to:
http://localhost:3000

#### Android Pro Tip (1-Word Shortcut)
Create a quick command so you can start the app by simply typing `finance`:

```bash
cat << 'EOF' > $PREFIX/bin/finance
#!/data/data/com.termux/files/usr/bin/bash
cd ~/finance-app && node server.js
EOF
chmod +x $PREFIX/bin/finance
```
### Option 2: Running on Windows (PC / Laptop)

```bash
# 1. Install Node.js LTS from [https://nodejs.org/](https://nodejs.org/) (and Git if needed)

# 2. Clone repository in PowerShell or Command Prompt
git clone [https://github.com/shreeramsharma065/personal-finance-app.git](https://github.com/shreeramsharma065/personal-finance-app.git) finance-app
cd finance-app

# 3. Start the server
node server.js
```
Open your browser and navigate to:
http://localhost:3000

Windows Pro Tip (1-Click Desktop Launcher)
Create a file named start.bat in your finance-app folder with the following lines:

@echo off
start http://localhost:3000
node server.js
pause

Double-click start.bat anytime to launch the server and open your browser automatically.


### Option 3: Running on macOS

```bash
# 1. Install Node.js and Git (via Homebrew or installer from nodejs.org)
brew install node git

# 2. Clone repository
git clone [https://github.com/shreeramsharma065/personal-finance-app.git](https://github.com/shreeramsharma065/personal-finance-app.git) finance-app
cd finance-app

# 3. Start the application
node server.js
```
Open your browser and navigate to:
http://localhost:3000

### Option 4: Running on Linux (Ubuntu / Debian / Raspberry Pi)

```bash
# 1. Install Node.js and Git
sudo apt update
sudo apt install -y nodejs git

# 2. Clone repository
git clone [https://github.com/shreeramsharma065/personal-finance-app.git](https://github.com/shreeramsharma065/personal-finance-app.git) finance-app
cd finance-app

# 3. Run the server
node server.js
```
Open your browser and navigate to:
http://localhost:3000


