const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'tally_books.json');
const TEMPLATE_FILE = path.join(__dirname, 'default_books.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function readBooks() {
  try {
    // Auto-initialize from template if database does not exist
    if (!fs.existsSync(DB_FILE)) {
      if (fs.existsSync(TEMPLATE_FILE)) {
        fs.copyFileSync(TEMPLATE_FILE, DB_FILE);
      } else {
        return { groups: [], ledgers: [], vouchers: [], budgets: {} };
      }
    }
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      groups: Array.isArray(raw.groups) ? raw.groups : [],
      ledgers: Array.isArray(raw.ledgers) ? raw.ledgers : [],
      vouchers: Array.isArray(raw.vouchers) ? raw.vouchers : [],
      budgets: (raw.budgets && typeof raw.budgets === 'object') ? raw.budgets : {}
    };
  } catch (e) {
    if (fs.existsSync(DB_FILE + '.bak')) {
      try { return JSON.parse(fs.readFileSync(DB_FILE + '.bak', 'utf8')); } catch (err) {}
    }
    return { groups: [], ledgers: [], vouchers: [], budgets: {} };
  }
}

function writeBooks(data) {
  try {
    if (fs.existsSync(DB_FILE)) {
      try { fs.copyFileSync(DB_FILE, DB_FILE + '.bak'); } catch (err) {}
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error writing database file:', e);
  }
}

function getGroupNature(groupName, groups) {
  const grp = groups.find(g => g.name === groupName);
  if (!grp) return 'Asset';
  if (grp.parentGroup && grp.parentGroup !== 'Primary') {
    return getGroupNature(grp.parentGroup, groups);
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

function computeCashFlow(books, ledgerBalances) {
  const cashBankLedgers = (books.ledgers || [])
    .filter(l => l.group.includes('Bank') || l.group.includes('Cash'))
    .map(l => l.name);

  let openingCash = 0;
  (books.ledgers || []).filter(l => cashBankLedgers.includes(l.name)).forEach(l => {
    openingCash += parseFloat(l.openingBalance) || 0;
  });

  const operatingItems = [];
  const investingItems = [];
  const financingItems = [];

  let operatingTotal = 0;
  let investingTotal = 0;
  let financingTotal = 0;

  (books.vouchers || []).forEach(v => {
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
      } else if (group.includes('Investment') || group.includes('Property') || group.includes('Fixed Asset')) {
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

  const pad = n => String(n).padStart(2, '0');
  const curPrefix = `${curYear}-${pad(curMonth + 1)}`;

  let prevYear = curYear;
  let prevMonth = curMonth - 1;
  if (prevMonth < 0) { prevMonth = 11; prevYear -= 1; }
  const prevPrefix = `${prevYear}-${pad(prevMonth + 1)}`;

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
  const pad = n => String(n).padStart(2, '0');
  const curPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
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
    const todayStr = now.toISOString().split('T')[0];
    const curDay = now.getDate();

    (books.ledgers || []).filter(l => l.group === 'Credit Cards').forEach(card => {
      const bal = ledgerBalances[card.name] ? ledgerBalances[card.name].closingBalance : 0;
      const bDay = parseInt(card.billingDay) || 15;
      const grace = parseInt(card.gracePeriodDays) || 20;

      let sYear = now.getFullYear();
      let sMonth = now.getMonth();
      if (curDay < bDay) {
        sMonth -= 1;
        if (sMonth < 0) { sMonth = 11; sYear -= 1; }
      }

      const stmtDate = new Date(sYear, sMonth, bDay);
      const dueDate = new Date(stmtDate.getTime() + (grace * 86400000));
      const stmtStr = stmtDate.toISOString().split('T')[0];
      const dueStr = dueDate.toISOString().split('T')[0];

      let billed = 0;
      let unbilled = 0;

      (books.vouchers || []).forEach(v => {
        const vDate = v.date || todayStr;
        const entries = getNormalizedEntries(v);
        entries.forEach(e => {
          if (e.ledger === card.name) {
            if (e.type === 'Cr') {
              if (vDate > stmtStr) unbilled += e.amount;
              else billed += e.amount;
            } else if (e.type === 'Dr') {
              billed = Math.max(0, billed - e.amount);
            }
          }
        });
      });

      const daysLeft = Math.round((dueDate - now) / 86400000);
      cards.push({
        name: card.name,
        totalBalance: bal,
        billedAmount: billed,
        unbilledAmount: unbilled,
        statementDay: bDay,
        gracePeriodDays: grace,
        statementDate: stmtStr,
        dueDate: dueStr,
        daysLeft: isNaN(daysLeft) ? 0 : daysLeft,
        status: daysLeft < 0 ? 'OVERDUE' : (daysLeft <= 3 ? 'URGENT' : 'SAFE')
      });
    });

    (books.vouchers || []).forEach(v => {
      const entries = getNormalizedEntries(v);
      const drEntry = entries.find(e => e.type === 'Dr');
      if (!drEntry) return;

      const drLedger = (books.ledgers || []).find(l => l.name === drEntry.ledger);
      if (drLedger && drLedger.group && (drLedger.group.includes('Debtor') || drLedger.group.includes('Receivable'))) {
        const dStr = v.dueDate || v.date || todayStr;
        const dObj = new Date(dStr + 'T00:00:00');
        const daysLeft = Math.round((dObj - now) / 86400000);
        receivables.push({
          id: v.id,
          voucher_no: v.voucher_no || `#${String(v.id).slice(-6)}`,
          debtor: drEntry.ledger,
          invoiceDate: v.date || todayStr,
          dueDate: dStr,
          amount: drEntry.amount,
          narration: v.narration || '',
          daysLeft: isNaN(daysLeft) ? 0 : daysLeft,
          status: daysLeft < 0 ? `${Math.abs(daysLeft)}d Overdue` : `${daysLeft}d Left`
        });
      }
    });
  } catch (err) {}

  return { creditCards: cards, receivables };
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  if (req.method === 'GET' && pathname === '/api/backup') {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const dateStr = new Date().toISOString().split('T')[0];
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="finance_backup_${dateStr}.json"`
    });
    return res.end(data);
  }

  if (req.method === 'POST' && pathname === '/api/restore') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsedData = JSON.parse(body);
        if (!parsedData.ledgers || !Array.isArray(parsedData.vouchers)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid structure' }));
        }
        writeBooks(parsedData);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Corrupt JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/budgets') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { ledger, amount } = JSON.parse(body);
        const books = readBooks();
        books.budgets = books.budgets || {};
        const val = parseFloat(amount) || 0;
        if (val > 0) books.budgets[ledger] = val;
        else delete books.budgets[ledger];
        writeBooks(books);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/masters') {
    const books = readBooks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ groups: books.groups, ledgers: books.ledgers }));
  }

  // GROUP CRUD
  if (req.method === 'POST' && pathname === '/api/groups') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { id, name, parentGroup, nature } = JSON.parse(body);
        if (!name) {
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
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/groups/')) {
    const id = parseInt(pathname.split('/').pop());
    const books = readBooks();
    const grp = books.groups.find(g => g.id === id);
    if (!grp) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Group not found' }));
    }
    const hasSubgroups = books.groups.some(g => g.parentGroup === grp.name);
    if (hasSubgroups) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Cannot delete group with active sub-groups' }));
    }
    const hasLedgers = books.ledgers.some(l => l.group === grp.name);
    if (hasLedgers) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Cannot delete group with active ledger accounts' }));
    }
    books.groups = books.groups.filter(g => g.id !== id);
    writeBooks(books);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // LEDGER CRUD
  if (req.method === 'POST' && pathname === '/api/ledgers') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { id, name, group, openingBalance, billingDay, gracePeriodDays } = JSON.parse(body);
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
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/ledgers/')) {
    const id = parseInt(pathname.split('/').pop());
    const books = readBooks();
    books.ledgers = books.ledgers.filter(l => l.id !== id);
    writeBooks(books);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // VOUCHERS
  if (req.method === 'POST' && pathname === '/api/vouchers') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const books = readBooks();

        const vDate = payload.date || new Date().toISOString().split('T')[0];
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
            error: `Debit and Credit totals must match! Total Dr: ₹${totalDr.toFixed(2)}, Total Cr: ₹${totalCr.toFixed(2)}`
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
              dueDate: payload.dueDate || vDate,
              voucher_type: vType,
              voucher_no: books.vouchers[idx].voucher_no || generateVoucherNumber(books, vType, vDate),
              entries,
              dr_ledger: drLedgers,
              cr_ledger: crLedgers,
              amount: totalAmount,
              narration: payload.narration || ''
            };
          }
        } else {
          const vNo = generateVoucherNumber(books, vType, vDate);
          books.vouchers.push({
            id: Date.now(),
            voucher_no: vNo,
            date: vDate,
            dueDate: payload.dueDate || vDate,
            voucher_type: vType,
            entries,
            dr_ledger: drLedgers,
            cr_ledger: crLedgers,
            amount: totalAmount,
            narration: payload.narration || ''
          });
        }

        writeBooks(books);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/vouchers/')) {
    const id = parseInt(pathname.split('/').pop());
    const books = readBooks();
    books.vouchers = books.vouchers.filter(v => v.id !== id);
    writeBooks(books);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // ACCURATE NET WORTH & FINANCIAL REPORTS
  if (req.method === 'GET' && pathname === '/api/reports') {
    try {
      const books = readBooks();

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
      const cashFlow = computeCashFlow(books, balances);
      const comparativePnL = computeComparativePnL(books);
      const budgets = computeBudgets(books);

      let totalAssets = 0;
      let totalThirdPartyDebt = 0;
      let totalCapitalEquity = 0;
      let totalIncome = 0;
      let totalExpenses = 0;
      let liquidCashBank = 0;
      let totalUnsecuredDebt = 0;

      const assetList = [];
      const liabList = [];
      const incList = [];
      const expList = [];

      Object.values(balances).forEach(l => {
        const bal = l.closingBalance || 0;
        if (l.nature === 'Asset') {
          totalAssets += bal;
          assetList.push({ name: l.name, group: l.group, balance: bal });
          if (l.group.includes('Bank') || l.group.includes('Cash')) liquidCashBank += bal;
        } else if (l.nature === 'Liability') {
          // EXCLUDE Capital Account from 3rd-party debt calculations
          if (l.group === 'Capital Account' || (l.group && l.group.includes('Capital'))) {
            totalCapitalEquity += bal;
          } else {
            totalThirdPartyDebt += bal;
            liabList.push({ name: l.name, group: l.group, balance: bal });
            if (l.group.includes('Credit Card') || l.group.includes('Loan')) totalUnsecuredDebt += bal;
          }
        } else if (l.nature === 'Income') {
          totalIncome += bal;
          incList.push({ name: l.name, group: l.group, balance: bal });
        } else if (l.nature === 'Expense') {
          totalExpenses += bal;
          expList.push({ name: l.name, group: l.group, balance: bal });
        }
      });

      // True Net Worth = Total Assets - External Debt
      const trueNetWorth = totalAssets - totalThirdPartyDebt;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        metrics: {
          netWorth: trueNetWorth,
          liquidCashBank,
          totalUnsecuredDebt,
          totalLiabilities: totalThirdPartyDebt,
          totalAssets,
          totalIncome,
          totalExpenses,
          netSurplus: totalIncome - totalExpenses,
          isDebtTrap: totalUnsecuredDebt > liquidCashBank
        },
        trialBalance,
        cashFlow,
        comparativePnL,
        budgets,
        balanceSheet: { assets: assetList, liabilities: liabList },
        profitAndLoss: { incomes: incList, expenses: expList },
        vouchers: (books.vouchers || []).slice().reverse(),
        dues
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // STATIC FILE SERVING
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  const contentType = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json'
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
  console.log(`Server permanently live on http://0.0.0.0:${PORT}`);
});
