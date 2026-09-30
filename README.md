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

1. **Install Node.js & Git** (if not already installed):
   ```bash
   pkg update && pkg install nodejs-lts git -y
