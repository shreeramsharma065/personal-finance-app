const { execSync } = require('child_process');
const os = require('os');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'tally_books.enc');
const OLD_PLAINTEXT_FILE = path.join(__dirname, 'tally_books.json');
const TEMPLATE_FILE = path.join(__dirname, 'default_books.json');
const AUTH_FILE = path.join(__dirname, 'auth_config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- IN-MEMORY SECURITY STATE ---
let MASTER_ENC_KEY = null;
const SESSIONS = new Map();
const LOGIN_ATTEMPTS = new Map();

// Session garbage collection
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of SESSIONS.entries()) {
    if (now > data.expiresAt) SESSIONS.delete(token);
  }
}, 30 * 60 * 1000);

// --- CRYPTO HELPERS ---
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 200000, 64, 'sha512').toString('hex');
}

function encryptBooks(dataObj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(dataObj);
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({
    iv: iv.toString('hex'),
    authTag,
    ciphertext: encrypted
  });
}

function decryptBooks(encPayloadStr, key) {
  const parsed = JSON.parse(encPayloadStr);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(parsed.authTag, 'hex'));
  let decrypted = decipher.update(parsed.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// --- PERSISTENCE ---
function readBooks() {
  if (MASTER_ENC_KEY && fs.existsSync(DB_FILE)) {
    try {
      const encStr = fs.readFileSync(DB_FILE, 'utf8');
      const decrypted = decryptBooks(encStr, MASTER_ENC_KEY);
      if (decrypted && !Array.isArray(decrypted.templates)) {
        decrypted.templates = [];
      }
      return decrypted;
    } catch (e) {
      if (fs.existsSync(DB_FILE + '.bak')) {
        try {
          return decryptBooks(fs.readFileSync(DB_FILE + '.bak', 'utf8'), MASTER_ENC_KEY);
        } catch (err) {}
      }
    }
  }

  // Pre-encryption setup fallback
  if (!fs.existsSync(AUTH_FILE)) {
    if (fs.existsSync(OLD_PLAINTEXT_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(OLD_PLAINTEXT_FILE, 'utf8'));
      } catch (e) {}
    }
    if (fs.existsSync(TEMPLATE_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8'));
      } catch (e) {}
    }
  }

  return { groups: [], ledgers: [], vouchers: [], budgets: {}, templates: [] };
}

function writeBooks(data) {
  if (data && !Array.isArray(data.templates)) data.templates = [];
  if (MASTER_ENC_KEY) {
    try {
      if (fs.existsSync(DB_FILE)) {
        try { fs.copyFileSync(DB_FILE, DB_FILE + '.bak'); } catch (err) {}
      }
      const enc = encryptBooks(data, MASTER_ENC_KEY);
      fs.writeFileSync(DB_FILE, enc, 'utf8');
      return;
    } catch (e) {
      console.error('Error writing encrypted database file:', e);
    }
  }

  if (!fs.existsSync(AUTH_FILE)) {
    try {
      fs.writeFileSync(OLD_PLAINTEXT_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('Error writing plaintext database file:', e);
    }
  }
}

// --- RATE LIMITING ---
function isRateLimited(ip) {
  const now = Date.now();
  const record = LOGIN_ATTEMPTS.get(ip);
  if (!record) return false;
  if (now > record.resetAt) {
    LOGIN_ATTEMPTS.delete(ip);
    return false;
  }
  return record.count >= 5;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const record = LOGIN_ATTEMPTS.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  record.count += 1;
  LOGIN_ATTEMPTS.set(ip, record);
}

function clearLoginAttempts(ip) {
  LOGIN_ATTEMPTS.delete(ip);
}

// --- SECURITY GUARDS ---
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function validateOrigin(req, res) {
  if (['POST', 'DELETE', 'PUT'].includes(req.method)) {
    const origin = req.headers.origin || req.headers.referer;
    const host = req.headers.host;
    if (origin && host) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.host !== host) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cross-origin request rejected.' }));
          return false;
        }
      } catch (err) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Malformed Origin header.' }));
        return false;
      }
    }
  }
  return true;
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  return list;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies.session_token;
  if (!token) return false;
  const session = SESSIONS.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    SESSIONS.delete(token);
    return false;
  }
  if (!MASTER_ENC_KEY) return false;
  return true;
}

function readJsonBody(req, res, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytesReceived = 0;
    req.on('data', chunk => {
      bytesReceived += chunk.length;
      if (bytesReceived > maxBytes) {
        if (!res.writableEnded) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload size exceeds safe threshold.' }));
        }
        req.destroy();
        return reject(new Error('Payload too large'));
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        if (!res.writableEnded) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Malformed JSON payload.' }));
        }
        reject(err);
      }
    });
  });
}

// --- ACCOUNTING ENGINE HELPERS ---
function padZero(n) {
  return String(n).padStart(2, '0');
}

function formatLocalDate(d) {
  return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`;
}

function getGroupNature(groupName, groups, visited = new Set()) {
  if (!groupName || visited.has(groupName.toLowerCase())) return 'Asset';
  visited.add(groupName.toLowerCase());
  const grp = (groups || []).find(g => g.name.toLowerCase() === (groupName || '').toLowerCase());
  if (!grp) return 'Asset';
  if (grp.parentGroup && grp.parentGroup !== 'Primary' && grp.parentGroup.toLowerCase() !== groupName.toLowerCase()) {
    return getGroupNature(grp.parentGroup, groups, visited);
  }
  return grp.nature || 'Asset';
}

function generateVoucherNumber(books, type, dateStr) {
  const prefixes = { Payment: 'PAY', Receipt: 'RCP', Contra: 'CNT', Journal: 'JRN' };
  const prefix = prefixes[type] || 'VCH';
  const year = (dateStr ? new Date(dateStr) : new Date()).getFullYear();

  const count = (books.vouchers || []).filter(v => {
    return v.voucher_type === type && (v.date || '').startsWith(String(year));
  }).length + 1;

  return `${prefix}/${year}/${String(count).padStart(3, '0')}`;
}

function getNormalizedEntries(v) {
  if (Array.isArray(v.entries) && v.entries.length > 0) {
    return v.entries.map(e => ({
      type: e.type || 'Dr',
      ledger: e.ledger,
      amount: parseFloat(e.amount) || 0
    }));
  }
  const amt = parseFloat(v.amount) || 0;
  const entries = [];
  if (v.dr_ledger) entries.push({ type: 'Dr', ledger: v.dr_ledger, amount: amt });
  if (v.cr_ledger) entries.push({ type: 'Cr', ledger: v.cr_ledger, amount: amt });
  return entries;
}

function calculateBalances(books) {
  const map = {};
  (books.ledgers || []).forEach(l => {
    const nature = getGroupNature(l.group, books.groups);
    map[l.name] = { ...l, nature, drTotal: 0, crTotal: 0, closingBalance: 0 };
    const op = parseFloat(l.openingBalance) || 0;
    if (nature === 'Asset' || nature === 'Expense') {
      map[l.name].drTotal += op;
    } else {
      map[l.name].crTotal += op;
    }
  });

  (books.vouchers || []).forEach(v => {
    const entries = getNormalizedEntries(v);
    entries.forEach(e => {
      if (map[e.ledger]) {
        if (e.type === 'Dr') map[e.ledger].drTotal += e.amount;
        else map[e.ledger].crTotal += e.amount;
      }
    });
  });

  Object.values(map).forEach(l => {
    if (l.nature === 'Asset' || l.nature === 'Expense') {
      l.closingBalance = l.drTotal - l.crTotal;
    } else {
      l.closingBalance = l.crTotal - l.drTotal;
    }
  });

  return map;
}

function computeTrialBalance(books, ledgerBalances) {
  let grossDrTotal = 0;
  let grossCrTotal = 0;
  let closingDrTotal = 0;
  let closingCrTotal = 0;

  const rows = Object.values(ledgerBalances).map(l => {
    grossDrTotal += l.drTotal;
    grossCrTotal += l.crTotal;

    let closingDr = 0;
    let closingCr = 0;

    if (l.nature === 'Asset' || l.nature === 'Expense') {
      if (l.closingBalance >= 0) closingDr = l.closingBalance;
      else closingCr = Math.abs(l.closingBalance);
    } else {
      if (l.closingBalance >= 0) closingCr = l.closingBalance;
      else closingDr = Math.abs(l.closingBalance);
    }

    closingDrTotal += closingDr;
    closingCrTotal += closingCr;

    return {
      name: l.name,
      group: l.group,
      nature: l.nature,
      grossDr: l.drTotal,
      grossCr: l.crTotal,
      closingDr,
      closingCr
    };
  });

  const diff = Math.abs(closingDrTotal - closingCrTotal);
  return {
    rows,
    totals: {
      grossDr: grossDrTotal,
      grossCr: grossCrTotal,
      closingDr: closingDrTotal,
      closingCr: closingCrTotal,
      difference: diff,
      isBalanced: diff < 0.01
    }
  };
}

function computeCashFlow(books, fromDate = '', toDate = '') {
  const cashBankLedgers = (books.ledgers || [])
    .filter(l => (l.group || '').toLowerCase().includes('bank') || (l.group || '').toLowerCase().includes('cash'))
    .map(l => l.name);

  let openingCash = 0;
  (books.ledgers || []).filter(l => cashBankLedgers.includes(l.name)).forEach(l => {
    openingCash += parseFloat(l.openingBalance) || 0;
  });

  (books.vouchers || []).forEach(v => {
    const vDate = v.date || '';
    if (fromDate && vDate < fromDate) {
      const entries = getNormalizedEntries(v);
      entries.forEach(e => {
        if (cashBankLedgers.includes(e.ledger)) {
          if (e.type === 'Dr') openingCash += e.amount;
          else openingCash -= e.amount;
        }
      });
    }
  });

  const operatingItems = [];
  const investingItems = [];
  const financingItems = [];

  let operatingTotal = 0;
  let investingTotal = 0;
  let financingTotal = 0;

  (books.vouchers || []).forEach(v => {
    const vDate = v.date || '';
    if (fromDate && vDate < fromDate) return;
    if (toDate && vDate > toDate) return;

    const entries = getNormalizedEntries(v);
    const hasCashBank = entries.some(e => cashBankLedgers.includes(e.ledger));
    if (!hasCashBank) return;

    const isPureContra = entries.every(e => cashBankLedgers.includes(e.ledger));
    if (isPureContra) return;

    entries.forEach(e => {
      if (cashBankLedgers.includes(e.ledger)) return;

      const nonCashLedger = (books.ledgers || []).find(l => l.name === e.ledger);
      const group = nonCashLedger ? nonCashLedger.group : '';
      const nature = nonCashLedger ? getGroupNature(group, books.groups) : 'Expense';

      const flowAmount = e.type === 'Cr' ? e.amount : -e.amount;

      if (nature === 'Income' || nature === 'Expense') {
        operatingTotal += flowAmount;
        operatingItems.push({
          date: v.date,
          ledger: e.ledger,
          group,
          amount: flowAmount,
          narration: v.narration || ''
        });
      } else if (group.toLowerCase().includes('investment') || group.toLowerCase().includes('property') || group.toLowerCase().includes('fixed asset')) {
        investingTotal += flowAmount;
        investingItems.push({
          date: v.date,
          ledger: e.ledger,
          group,
          amount: flowAmount,
          narration: v.narration || ''
        });
      } else {
        financingTotal += flowAmount;
        financingItems.push({
          date: v.date,
          ledger: e.ledger,
          group,
          amount: flowAmount,
          narration: v.narration || ''
        });
      }
    });
  });

  const netCashFlow = operatingTotal + investingTotal + financingTotal;
  const closingCash = openingCash + netCashFlow;

  return {
    openingCash,
    closingCash,
    netCashFlow,
    operating: { total: operatingTotal, items: operatingItems },
    investing: { total: investingTotal, items: investingItems },
    financing: { total: financingTotal, items: financingItems }
  };
}

function computeComparativePnL(books) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();

  const curPrefix = `${curYear}-${padZero(curMonth + 1)}`;

  let prevYear = curYear;
  let prevMonth = curMonth - 1;
  if (prevMonth < 0) { prevMonth = 11; prevYear -= 1; }
  const prevPrefix = `${prevYear}-${padZero(prevMonth + 1)}`;

  const expMap = {};
  const incMap = {};

  (books.ledgers || []).forEach(l => {
    const nature = getGroupNature(l.group, books.groups);
    if (nature === 'Expense') expMap[l.name] = { name: l.name, group: l.group, current: 0, previous: 0 };
    if (nature === 'Income') incMap[l.name] = { name: l.name, group: l.group, current: 0, previous: 0 };
  });

  (books.vouchers || []).forEach(v => {
    const vDate = v.date || '';
    const isCur = vDate.startsWith(curPrefix);
    const isPrev = vDate.startsWith(prevPrefix);
    if (!isCur && !isPrev) return;

    const entries = getNormalizedEntries(v);
    entries.forEach(e => {
      if (expMap[e.ledger]) {
        const val = e.type === 'Dr' ? e.amount : -e.amount;
        if (isCur) expMap[e.ledger].current += val;
        if (isPrev) expMap[e.ledger].previous += val;
      }
      if (incMap[e.ledger]) {
        const val = e.type === 'Cr' ? e.amount : -e.amount;
        if (isCur) incMap[e.ledger].current += val;
        if (isPrev) incMap[e.ledger].previous += val;
      }
    });
  });

  function processList(map) {
    return Object.values(map).map(item => {
      const diff = item.current - item.previous;
      const pct = item.previous > 0 ? (diff / item.previous) * 100 : (item.current > 0 ? 100 : 0);
      return { ...item, diff, pct };
    }).filter(i => i.current > 0 || i.previous > 0);
  }

  return {
    curLabel: curPrefix,
    prevLabel: prevPrefix,
    expenses: processList(expMap),
    incomes: processList(incMap)
  };
}

function computeBudgets(books) {
  const now = new Date();
  const curPrefix = `${now.getFullYear()}-${padZero(now.getMonth() + 1)}`;
  const budgets = books.budgets || {};

  const actuals = {};
  (books.vouchers || []).forEach(v => {
    if (!(v.date || '').startsWith(curPrefix)) return;
    const entries = getNormalizedEntries(v);
    entries.forEach(e => {
      if (e.type === 'Dr') {
        actuals[e.ledger] = (actuals[e.ledger] || 0) + e.amount;
      }
    });
  });

  const list = [];
  (books.ledgers || []).filter(l => l.nature === 'Expense').forEach(l => {
    const allocated = parseFloat(budgets[l.name]) || 0;
    const spent = actuals[l.name] || 0;
    const remaining = allocated - spent;
    const pct = allocated > 0 ? Math.min(100, Math.round((spent / allocated) * 100)) : 0;
    const isOver = allocated > 0 && spent > allocated;

    list.push({
      ledger: l.name,
      group: l.group,
      allocated,
      spent,
      remaining,
      pct,
      isOver,
      hasBudget: allocated > 0
    });
  });

  return list;
}

function computeDues(books, ledgerBalances) {
  const cards = [];
  const receivables = [];

  try {
    const now = new Date();
    const todayStr = formatLocalDate(now);

    (books.ledgers || []).filter(l => {
      const g = (l.group || '').toLowerCase();
      return g.includes('credit card') || g.includes('card');
    }).forEach(card => {
      const bal = ledgerBalances[card.name] ? ledgerBalances[card.name].closingBalance : 0;
      const bDay = parseInt(card.billingDay) || 15;
      const grace = parseInt(card.gracePeriodDays) || 20;

      let curYear = now.getFullYear();
      let curMonth = now.getMonth();
      let curDay = now.getDate();

      let stmtYear = curYear;
      let stmtMonth = curMonth;

      if (curDay < bDay) {
        stmtMonth -= 1;
        if (stmtMonth < 0) {
          stmtMonth = 11;
          stmtYear -= 1;
        }
      }

      const maxDaysInStmtMonth = new Date(stmtYear, stmtMonth + 1, 0).getDate();
      const actualStmtDay = Math.min(bDay, maxDaysInStmtMonth);
      const stmtDate = new Date(stmtYear, stmtMonth, actualStmtDay);
      const stmtStr = formatLocalDate(stmtDate);

      let prevStmtYear = stmtYear;
      let prevStmtMonth = stmtMonth - 1;
      if (prevStmtMonth < 0) {
        prevStmtMonth = 11;
        prevStmtYear -= 1;
      }
      const maxDaysInPrevMonth = new Date(prevStmtYear, prevStmtMonth + 1, 0).getDate();
      const actualPrevStmtDay = Math.min(bDay, maxDaysInPrevMonth);
      const prevStmtDate = new Date(prevStmtYear, prevStmtMonth, actualPrevStmtDay);
      const prevStmtStr = formatLocalDate(prevStmtDate);

      let nextStmtYear = stmtYear;
      let nextStmtMonth = stmtMonth + 1;
      if (nextStmtMonth > 11) {
        nextStmtMonth = 0;
        nextStmtYear += 1;
      }
      const maxDaysInNextMonth = new Date(nextStmtYear, nextStmtMonth + 1, 0).getDate();
      const actualNextStmtDay = Math.min(bDay, maxDaysInNextMonth);
      const nextStmtDate = new Date(nextStmtYear, nextStmtMonth, actualNextStmtDay);
      const nextStmtStr = formatLocalDate(nextStmtDate);

      const dueDate = new Date(stmtDate.getTime() + (grace * 86400000));
      const dueStr = formatLocalDate(dueDate);

      let billedDebits = 0;
      let repaymentsAfterStmt = 0;
      let unbilled = 0;

      (books.vouchers || []).forEach(v => {
        const vDate = v.date || todayStr;
        const entries = getNormalizedEntries(v);

        entries.forEach(e => {
          if (e.ledger === card.name) {
            if (e.type === 'Cr') {
              if (vDate > stmtStr) {
                unbilled += e.amount;
              } else if (vDate > prevStmtStr && vDate <= stmtStr) {
                billedDebits += e.amount;
              }
            } else if (e.type === 'Dr') {
              if (vDate > stmtStr) {
                repaymentsAfterStmt += e.amount;
              }
            }
          }
        });
      });

      const billedAmount = Math.max(0, billedDebits - repaymentsAfterStmt);
      const daysLeft = Math.ceil((dueDate.getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000);

      let statusTag = '';
      let statusLevel = '';
      let subMessage = '';

      if (billedAmount <= 0.01) {
        if (unbilled <= 0.01) {
          statusTag = 'NO DUES';
          statusLevel = 'CLEAN';
          subMessage = `Next bill on ${nextStmtStr}`;
        } else {
          statusTag = 'PAID';
          statusLevel = 'PAID';
          subMessage = `Next bill on ${nextStmtStr}`;
        }
      } else {
        if (daysLeft < 0) {
          statusTag = `OVERDUE (${Math.abs(daysLeft)}d)`;
          statusLevel = 'OVERDUE';
          subMessage = `Was due on ${dueStr}`;
        } else if (daysLeft <= 3) {
          statusTag = `URGENT (${daysLeft}d left)`;
          statusLevel = 'URGENT';
          subMessage = `Due on ${dueStr}`;
        } else {
          statusTag = `DUE IN ${daysLeft}d`;
          statusLevel = 'SAFE';
          subMessage = `Due on ${dueStr}`;
        }
      }

      cards.push({
        name: card.name,
        totalBalance: bal,
        billedAmount,
        unbilledAmount: unbilled,
        statementDay: bDay,
        gracePeriodDays: grace,
        statementDate: stmtStr,
        dueDate: dueStr,
        nextStatementDate: nextStmtStr,
        daysLeft: isNaN(daysLeft) ? 0 : daysLeft,
        statusTag,
        statusLevel,
        subMessage
      });
    });

    (books.ledgers || [])
      .filter(l => {
        const grp = (l.group || '').toLowerCase();
        return grp.includes('debtor') || grp.includes('receivable') || grp.includes('friend') || grp.includes('advance') || grp.includes('due');
      })
      .forEach(debtor => {
        const netBal = ledgerBalances[debtor.name] ? ledgerBalances[debtor.name].closingBalance : 0;
        if (netBal > 0.01) {
          const debtorVouchers = (books.vouchers || [])
            .filter(v => getNormalizedEntries(v).some(e => e.ledger === debtor.name && e.type === 'Dr'))
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

          const latestVoucher = debtorVouchers[0];

          receivables.push({
            id: latestVoucher ? latestVoucher.id : debtor.id,
            voucher_no: latestVoucher ? (latestVoucher.voucher_no || `#${String(latestVoucher.id).slice(-6)}`) : 'BAL-BF',
            debtor: debtor.name,
            invoiceDate: latestVoucher ? latestVoucher.date : todayStr,
            narration: latestVoucher ? (latestVoucher.narration || 'Unsettled Debit Balance') : 'Unsettled Debit Balance',
            amount: netBal
          });
        }
      });
  } catch (err) {
    console.error('Error computing dues:', err);
  }

  return { creditCards: cards, receivables };
}

// --- SERVER DISPATCHER ---
// --- AUTOMATIC SSL CERTIFICATE INITIALIZATION ---
const sslDir = path.join(__dirname, 'ssl');
const keyPath = path.join(sslDir, 'server.key');
const certPath = path.join(sslDir, 'server.crt');

let certWasGenerated = false;

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  certWasGenerated = true;
  console.log('\n=============================================================');
  console.log('⚡ SSL certificates not detected in ssl/ directory.');
  console.log('⚡ Generating local high-security SAN SSL certificate...');
  console.log('=============================================================');

  if (!fs.existsSync(sslDir)) {
    fs.mkdirSync(sslDir, { recursive: true });
  }

  const cnfPath = path.join(sslDir, 'openssl_init.cnf');
  const opensslConfig = `[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = IN
ST = UP
L = Local
O = Ledgerly
CN = ledger.local

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:TRUE

[alt_names]
DNS.1 = ledger.local
DNS.2 = localhost
IP.1 = 127.0.0.1
`;

  try {
    fs.writeFileSync(cnfPath, opensslConfig, 'utf8');
    execSync(
      `openssl req -x509 -nodes -days 825 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -config "${cnfPath}" -extensions v3_req`,
      { stdio: 'pipe' }
    );
    if (fs.existsSync(cnfPath)) fs.unlinkSync(cnfPath);
    console.log('✅ Certificate and private key created successfully in ssl/\n');
  } catch (err) {
    console.error('❌ Failed to auto-generate SSL certificate:', err.message);
    console.error('Please ensure openssl is installed (`sudo apt install openssl`).');
    process.exit(1);
  }
}

const sslOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

const server = https.createServer(sslOptions, async (req, res) => {
  applySecurityHeaders(res);
  if (!validateOrigin(req, res)) return;

  const clientIp = req.socket.remoteAddress || '127.0.0.1';
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  // 1. PUBLIC AUTH GATEWAY ENDPOINTS
  if (req.method === 'GET' && pathname === '/api/auth/status') {
    const isConfigured = fs.existsSync(AUTH_FILE);
    const loggedIn = isAuthenticated(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ isConfigured, isAuthenticated: loggedIn }));
  }

  if (req.method === 'POST' && pathname === '/api/auth/setup') {
    if (fs.existsSync(AUTH_FILE)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Master password has already been established.' }));
    }
    try {
      const { password } = await readJsonBody(req, res);
      if (!password || password.length < 8) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Password must be at least 8 characters long.' }));
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);
      fs.writeFileSync(AUTH_FILE, JSON.stringify({ salt, hash }), 'utf8');

      MASTER_ENC_KEY = deriveKey(password, salt);

      let booksData = { groups: [], ledgers: [], vouchers: [], budgets: {}, templates: [] };
      if (fs.existsSync(OLD_PLAINTEXT_FILE)) {
        try {
          booksData = JSON.parse(fs.readFileSync(OLD_PLAINTEXT_FILE, 'utf8'));
        } catch (e) {}
      } else if (fs.existsSync(TEMPLATE_FILE)) {
        try {
          booksData = JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8'));
        } catch (e) {}
      }
      writeBooks(booksData);

      if (fs.existsSync(OLD_PLAINTEXT_FILE)) {
        try {
          fs.unlinkSync(OLD_PLAINTEXT_FILE);
        } catch (err) {}
      }

      const token = crypto.randomBytes(32).toString('hex');
      SESSIONS.set(token, { expiresAt: Date.now() + 24 * 60 * 60 * 1000 });

      res.setHeader('Set-Cookie', `session_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (e) {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || 'Setup encountered an error.' }));
      }
      return;
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    if (isRateLimited(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Too many failed login attempts. Try again in 15 minutes.' }));
    }
    if (!fs.existsSync(AUTH_FILE)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'App setup required before authentication.' }));
    }

    try {
      const { password } = await readJsonBody(req, res);
      const authConfig = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
      const testHash = hashPassword(password, authConfig.salt);

      if (crypto.timingSafeEqual(Buffer.from(testHash), Buffer.from(authConfig.hash))) {
        clearLoginAttempts(clientIp);
        MASTER_ENC_KEY = deriveKey(password, authConfig.salt);

        if (!fs.existsSync(DB_FILE) && fs.existsSync(OLD_PLAINTEXT_FILE)) {
          try {
            const data = JSON.parse(fs.readFileSync(OLD_PLAINTEXT_FILE, 'utf8'));
            writeBooks(data);
            fs.unlinkSync(OLD_PLAINTEXT_FILE);
          } catch (e) {}
        }

        const token = crypto.randomBytes(32).toString('hex');
        SESSIONS.set(token, { expiresAt: Date.now() + 24 * 60 * 60 * 1000 });

        res.setHeader('Set-Cookie', `session_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      } else {
        recordLoginFailure(clientIp);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid master password.' }));
      }
    } catch (e) {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || 'Authentication error.' }));
      }
      return;
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const cookies = parseCookies(req);
    if (cookies.session_token) SESSIONS.delete(cookies.session_token);
    MASTER_ENC_KEY = null;
    res.setHeader('Set-Cookie', `session_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // 2. PROTECTED API ROUTES
  if (pathname.startsWith('/api/')) {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized. Active session required.' }));
    }
  }

  // 3. API ROUTES

  // --- TEMPLATES API ---
  if (req.method === 'GET' && pathname === '/api/templates') {
    const books = readBooks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(books.templates || []));
  }

  if (req.method === 'POST' && pathname === '/api/templates') {
    const body = await readJsonBody(req, res);
    if (!body) return; // readJsonBody handles errors internally

    const books = readBooks();
    if (!books.templates) books.templates = [];

    const newTpl = {
      id: body.id || ('tpl_' + Date.now()),
      name: (body.name || 'Custom Template').trim(),
      type: body.type || 'Payment',
      narration: body.narration || '',
      legs: body.legs || []
    };

    const existingIdx = books.templates.findIndex(t => t.id === newTpl.id);
    if (existingIdx >= 0) {
      books.templates[existingIdx] = newTpl;
    } else {
      books.templates.push(newTpl);
    }

    writeBooks(books);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, template: newTpl }));
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/templates/')) {
    const tplId = pathname.replace('/api/templates/', '');
    const books = readBooks();
    if (books.templates) {
      books.templates = books.templates.filter(t => t.id !== tplId);
      writeBooks(books);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }
  // --- END TEMPLATES API ---

  if (req.method === 'GET' && pathname === '/api/backup') {
    const books = readBooks();
    const dateStr = formatLocalDate(new Date());
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="tally_backup_${dateStr}.json"`
    });
    return res.end(JSON.stringify(books, null, 2));
  }

  if (req.method === 'POST' && pathname === '/api/restore') {
    try {
      const parsedData = await readJsonBody(req, res, 25 * 1024 * 1024);
      if (!parsedData.ledgers || !Array.isArray(parsedData.vouchers)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid file structure for accounting books.' }));
      }
      writeBooks(parsedData);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (err) {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Restore failed.' }));
      }
      return;
    }
  }

  if (req.method === 'POST' && pathname === '/api/budgets') {
    try {
      const { ledger, amount } = await readJsonBody(req, res);
      const books = readBooks();
      books.budgets = books.budgets || {};
      const val = parseFloat(amount) || 0;
      if (val > 0) books.budgets[ledger] = val;
      else delete books.budgets[ledger];
      writeBooks(books);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (e) {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || 'Saving budget encountered an error.' }));
      }
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/masters') {
    const books = readBooks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ groups: books.groups, ledgers: books.ledgers }));
  }

  if (req.method === 'POST' && pathname === '/api/groups') {
    try {
      const { id, name, parentGroup, nature } = await readJsonBody(req, res);
      if (!name || typeof name !== 'string' || !name.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Group Name is required' }));
      }
      const books = readBooks();
      const parent = parentGroup && parentGroup !== 'Primary' ? parentGroup : null;
      const resolvedNature = parent ? getGroupNature(parent, books.groups) : (nature || 'Asset');

      if (id) {
        const idx = books.groups.findIndex(g => g.id === parseInt(id));
        if (idx !== -1) {
          const oldName = books.groups[idx].name;
          books.groups[idx] = {
            ...books.groups[idx],
            name: name.trim(),
            parentGroup: parent,
            nature: resolvedNature
          };
          books.groups.forEach(g => { if (g.parentGroup === oldName) g.parentGroup = name.trim(); });
          books.ledgers.forEach(l => { if (l.group === oldName) l.group = name.trim(); });
        }
      } else {
        if (books.groups.some(g => g.name.toLowerCase() === name.trim().toLowerCase())) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'A group with this name already exists' }));
        }
        books.groups.push({
          id: Date.now(),
          name: name.trim(),
          parentGroup: parent,
          nature: resolvedNature
        });
      }
      writeBooks(books);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (e) {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || 'Modifying group encountered an error.' }));
      }
      return;
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/groups/')) {
    const id = parseInt(pathname.split('/').pop());
    const books = readBooks();
    const grp = books.groups.find(g => g.id === id);
    if (!grp) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Group not found' }));
    }
    const hasSubgroups = books.groups.some(g => (g.parentGroup || '').toLowerCase() === grp.name.toLowerCase());
    if (hasSubgroups) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Cannot delete group with active sub-groups' }));
    }
    const hasLedgers = books.ledgers.some(l => (l.group || '').toLowerCase() === grp.name.toLowerCase());
    if (hasLedgers) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Cannot delete group with active ledger accounts' }));
    }
    books.groups = books.groups.filter(g => g.id !== id);
    writeBooks(books);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  if (req.method === 'POST' && pathname === '/api/ledgers') {
    try {
      const { id, name, group, openingBalance, billingDay, gracePeriodDays } = await readJsonBody(req, res);
      if (!name || typeof name !== 'string' || !name.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Ledger account name is required.' }));
      }
      const books = readBooks();
      const nature = getGroupNature(group, books.groups);
      const op = parseFloat(openingBalance) || 0;

      if (id) {
        const idx = books.ledgers.findIndex(l => l.id === parseInt(id));
        if (idx !== -1) {
          const oldName = books.ledgers[idx].name;
          books.ledgers[idx] = {
            ...books.ledgers[idx],
            id: parseInt(id),
            name: name.trim(),
            group,
            nature,
            openingBalance: op,
            billingDay: parseInt(billingDay) || 15,
            gracePeriodDays: parseInt(gracePeriodDays) || 20
          };
          books.vouchers.forEach(v => {
            if (v.entries) {
              v.entries.forEach(e => { if (e.ledger === oldName) e.ledger = name.trim(); });
            }
            if (v.dr_ledger === oldName) v.dr_ledger = name.trim();
            if (v.cr_ledger === oldName) v.cr_ledger = name.trim();
          });
        }
      } else {
        books.ledgers.push({
          id: Date.now(),
          name: name.trim(),
          group,
          nature,
          openingBalance: op,
          billingDay: parseInt(billingDay) || 15,
          gracePeriodDays: parseInt(gracePeriodDays) || 20
        });
      }
      writeBooks(books);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (e) {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || 'Modifying ledger encountered an error.' }));
      }
      return;
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/ledgers/')) {
    const id = parseInt(pathname.split('/').pop());
    const books = readBooks();
    books.ledgers = books.ledgers.filter(l => l.id !== id);
    writeBooks(books);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  if (req.method === 'POST' && pathname === '/api/vouchers') {
    try {
      const payload = await readJsonBody(req, res);
      const books = readBooks();

      const vDate = payload.date || formatLocalDate(new Date());
      const vType = payload.voucher_type || 'Payment';
      let entries = [];

      if (Array.isArray(payload.entries) && payload.entries.length >= 2) {
        entries = payload.entries.map(e => ({
          type: e.type === 'Cr' ? 'Cr' : 'Dr',
          ledger: e.ledger,
          amount: parseFloat(e.amount) || 0
        }));
      } else {
        const amt = parseFloat(payload.amount) || 0;
        entries = [
          { type: 'Dr', ledger: payload.dr_ledger, amount: amt },
          { type: 'Cr', ledger: payload.cr_ledger, amount: amt }
        ];
      }

      let totalDr = 0;
      let totalCr = 0;
      entries.forEach(e => {
        if (e.type === 'Dr') totalDr += e.amount;
        else totalCr += e.amount;
      });

      if (Math.abs(totalDr - totalCr) > 0.01) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: `Debit and Credit totals must match! Dr: ₹${totalDr.toFixed(2)}, Cr: ₹${totalCr.toFixed(2)}`
        }));
      }

      const totalAmount = totalDr;
      const drLedgers = entries.filter(e => e.type === 'Dr').map(e => e.ledger).join(', ');
      const crLedgers = entries.filter(e => e.type === 'Cr').map(e => e.ledger).join(', ');

      if (payload.id) {
        const idx = books.vouchers.findIndex(v => v.id === parseInt(payload.id));
        if (idx !== -1) {
          books.vouchers[idx] = {
            ...books.vouchers[idx],
            date: vDate,
            voucher_type: vType,
            voucher_no: books.vouchers[idx].voucher_no || generateVoucherNumber(books, vType, vDate),
            entries,
            dr_ledger: drLedgers,
            cr_ledger: crLedgers,
            amount: totalAmount,
            narration: typeof payload.narration === 'string' ? payload.narration.slice(0, 500) : ''
          };
        }
      } else {
        const vNo = generateVoucherNumber(books, vType, vDate);
        books.vouchers.push({
          id: Date.now(),
          voucher_no: vNo,
          date: vDate,
          voucher_type: vType,
          entries,
          dr_ledger: drLedgers,
          cr_ledger: crLedgers,
          amount: totalAmount,
          narration: typeof payload.narration === 'string' ? payload.narration.slice(0, 500) : ''
        });
      }

      writeBooks(books);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (e) {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || 'Recording voucher encountered an error.' }));
      }
      return;
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/vouchers/')) {
    const id = parseInt(pathname.split('/').pop());
    const books = readBooks();
    books.vouchers = books.vouchers.filter(v => v.id !== id);
    writeBooks(books);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  if (req.method === 'GET' && pathname === '/api/reports') {
    try {
      const books = readBooks();

      const cfFromDate = parsed.searchParams.get('cfFromDate') || '';
      const cfToDate = parsed.searchParams.get('cfToDate') || '';

      let modified = false;
      books.vouchers.forEach(v => {
        if (!v.voucher_no) {
          v.voucher_no = `#${String(v.id).slice(-6)}`;
          modified = true;
        }
      });
      if (modified) writeBooks(books);

      const balances = calculateBalances(books);
      const dues = computeDues(books, balances);
      const trialBalance = computeTrialBalance(books, balances);
      const cashFlow = computeCashFlow(books, cfFromDate, cfToDate);
      const comparativePnL = computeComparativePnL(books);
      const budgets = computeBudgets(books);

      let totalAssets = 0;
      let totalThirdPartyDebt = 0;
      let totalCapitalEquity = 0;
      let totalIncome = 0;
      let totalExpenses = 0;
      let liquidCashBank = 0;
      let totalUnsecuredDebt = 0;
      let monthlyBurnRate = 0;

      const assetList = [];
      const liabList = [];
      const incList = [];
      const expList = [];

      Object.values(balances).forEach(l => {
        const bal = l.closingBalance || 0;
        const grp = (l.group || '').toLowerCase();
        
        if (l.nature === 'Asset') {
          totalAssets += bal;
          assetList.push({ name: l.name, group: l.group, balance: bal });
          if (grp.includes('bank') || grp.includes('cash')) liquidCashBank += bal;
        } else if (l.nature === 'Liability') {
          if (grp.includes('capital')) {
            totalCapitalEquity += bal;
          } else {
            totalThirdPartyDebt += bal;
            liabList.push({ name: l.name, group: l.group, balance: bal });
            if (grp.includes('credit card') || grp.includes('loan') || grp.includes('borrowing')) {
              totalUnsecuredDebt += bal;
            }
          }
        } else if (l.nature === 'Income') {
          totalIncome += bal;
          incList.push({ name: l.name, group: l.group, balance: bal });
        } else if (l.nature === 'Expense') {
          totalExpenses += bal;
          expList.push({ name: l.name, group: l.group, balance: bal });
          if (grp.includes('living') || grp.includes('household') || grp.includes('utilities') || grp.includes('education')) {
            monthlyBurnRate += bal;
          }
        }
      });

      const distinctMonths = Math.max(1, new Set((books.vouchers || []).map(v => (v.date || '').slice(0, 7))).size);
      const avgMonthlyBurn = Math.max(1, (monthlyBurnRate > 0 ? monthlyBurnRate / distinctMonths : totalExpenses / distinctMonths));
      const runwayMonths = parseFloat((liquidCashBank / avgMonthlyBurn).toFixed(1));

      // Enhanced friend / sundry debtors matcher (matches Sundry Debtors, Friends, or any receivable)
      const friendsList = (books.ledgers || [])
        .filter(l => {
          const grp = (l.group || '').toLowerCase();
          return grp.includes('debtor') || grp.includes('receivable') || grp.includes('friend') || grp.includes('advance') || grp.includes('due');
        })
        .map(f => {
          const bal = balances[f.name] ? balances[f.name].closingBalance : 0;
          return { id: f.id, name: f.name, group: f.group, balance: bal };
        });

      const netSurplus = totalIncome - totalExpenses;
      const trueNetWorth = totalAssets - totalThirdPartyDebt;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        metrics: {
          netWorth: trueNetWorth,
          liquidCashBank,
          totalUnsecuredDebt,
          totalLiabilities: totalThirdPartyDebt,
          totalAssets,
          totalIncome,
          totalExpenses,
          netSurplus,
          runwayMonths: isFinite(runwayMonths) ? runwayMonths : 0,
          avgMonthlyBurn,
          isDebtTrap: totalUnsecuredDebt > liquidCashBank
        },
        trialBalance,
        cashFlow,
        comparativePnL,
        budgets,
        friendsList,
        balanceSheet: {
          assets: assetList,
          liabilities: liabList,
          capital: totalCapitalEquity,
          netSurplus
        },
        profitAndLoss: { incomes: incList, expenses: expList },
        vouchers: (books.vouchers || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id),
        dues
      }));
    } catch (err) {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Report generation failed.' }));
      }
      return;
    }
  }

  // 4. STATIC FILE RESOLUTION
  let targetPath = pathname;
  if (targetPath === '/') targetPath = 'index.html';
  else if (targetPath === '/favicon.ico') targetPath = 'favicon.svg';
  const safeFilename = targetPath.replace(/^\/+/, '');
  let filePath = path.join(PUBLIC_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, safeFilename);
  }

  const ext = path.extname(filePath);
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  }[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const detectedIps = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        detectedIps.push(net.address);
      }
    }
  }

  console.log(`\n🔒 Secure Ledger HTTPS Server Online on Port ${PORT}`);
  console.log(`   • Local Phone:   https://localhost:${PORT}`);
  console.log(`   • Domain URL:    https://ledger.local:${PORT}`);
  if (detectedIps.length > 0) {
    detectedIps.forEach(ip => {
      console.log(`   • Direct IP:     https://${ip}:${PORT}`);
    });
  }

  if (certWasGenerated) {
    console.log('\n-------------------------------------------------------------');
    console.log('📋 FIRST TIME SETUP GUIDE FOR CLIENT ACCESS:');
    console.log('-------------------------------------------------------------');
    console.log('1. On Client Laptop (Windows):');
    console.log('   - Copy "ssl/server.crt" to the laptop.');
    console.log('   - Double-click server.crt -> Install Certificate -> Current User');
    console.log('     -> Place all certificates in "Trusted Root Certification Authorities".');
    console.log('   - Open C:\\Windows\\System32\\drivers\\etc\\hosts as Administrator and add:');
    const primaryIp = detectedIps[0] || '127.0.0.1';
    console.log(`     ${primaryIp}    ledger.local`);
    console.log('   - Open https://ledger.local:' + PORT + ' in your browser.');
    console.log('\n2. On Client Phone (Android):');
    console.log('   - Copy "ssl/server.crt" to internal storage.');
    console.log('   - Settings -> Security -> Encryption & credentials -> Install CA certificate.');
    console.log('-------------------------------------------------------------\n');
  }
});
