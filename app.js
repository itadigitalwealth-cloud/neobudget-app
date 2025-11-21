// NeoBudget - app.js definitivo

const STORAGE_KEY = 'neobudget-state-v1';

let state = {
  movements: [],
  recurring: []
};

let editingMovementId = null;
let editingRecurringIncomeId = null;
let editingRecurringExpenseId = null;

/* ====================== HELPERS BASE ====================== */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    state.movements = Array.isArray(parsed.movements) ? parsed.movements : [];
    state.recurring = Array.isArray(parsed.recurring) ? parsed.recurring : [];

    // Migrazione vecchio formato (frequency -> recurrence)
    for (const r of state.recurring) {
      if (!r.recurrence) {
        if (r.frequency === 'quarterly') {
          r.recurrence = { mode: 'everyXMonths', interval: 3 };
        } else if (r.frequency === 'yearly') {
          r.recurrence = { mode: 'yearly' };
        } else {
          r.recurrence = { mode: 'monthly' };
        }
      }
      delete r.frequency;
    }
  } catch (err) {
    console.error('Errore caricando lo stato:', err);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = parseDate(dateStr);
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatCurrency(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' €';
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) {
    d.setDate(0);
  }
  return d;
}

function isSameOrBefore(a, b) {
  return a.getTime() <= b.getTime();
}

function isAfter(a, b) {
  return a.getTime() > b.getTime();
}

/* ====================== RICORRENZE ====================== */

function addOccurrence(out, r, dateObj) {
  const dateStr = dateObj.toISOString().slice(0, 10);
  out.push({
    id: `RGEN_${r.id}_${dateStr}`,
    type: r.type,
    amount: Number(r.amount) || 0,
    date: dateStr,
    category: r.category || r.name || '',
    accountType: r.accountType || 'liquid',
    note: r.name || ''
  });
}

function generateDaily(r, start, end, out) {
  let current = new Date(start.getTime());
  while (isSameOrBefore(current, end)) {
    addOccurrence(out, r, current);
    current = addDays(current, 1);
  }
}

function generateEveryXDays(r, start, end, interval, out) {
  let current = new Date(start.getTime());
  const step = Math.max(1, interval || 1);
  while (isSameOrBefore(current, end)) {
    addOccurrence(out, r, current);
    current = addDays(current, step);
  }
}

function generateWeekly(r, start, end, interval, out) {
  let current = new Date(start.getTime());
  const stepWeeks = Math.max(1, interval || 1);
  while (isSameOrBefore(current, end)) {
    addOccurrence(out, r, current);
    current = addDays(current, stepWeeks * 7);
  }
}

function generateWeeklySpecific(r, start, end, daysOfWeek, out) {
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) return;
  const sortedDays = [...daysOfWeek].map(Number).filter(x => x >= 1 && x <= 7).sort();
  if (!sortedDays.length) return;

  let current = new Date(start.getTime());
  while (isSameOrBefore(current, end)) {
    let dow = current.getDay(); // 0..6, lun=1
    dow = dow === 0 ? 7 : dow;
    if (sortedDays.includes(dow)) {
      addOccurrence(out, r, current);
    }
    current = addDays(current, 1);
  }
}

function generateMonthly(r, start, end, out) {
  let current = new Date(start.getTime());
  while (isSameOrBefore(current, end)) {
    addOccurrence(out, r, current);
    current = addMonths(current, 1);
  }
}

function generateEveryXMonths(r, start, end, interval, out) {
  let current = new Date(start.getTime());
  const step = Math.max(1, interval || 1);
  while (isSameOrBefore(current, end)) {
    addOccurrence(out, r, current);
    current = addMonths(current, step);
  }
}

function generateYearly(r, start, end, out) {
  let current = new Date(start.getTime());
  while (isSameOrBefore(current, end)) {
    addOccurrence(out, r, current);
    current = addMonths(current, 12);
  }
}

function generateRecurringOccurrences(targetDate) {
  const occurrences = [];

  for (const r of state.recurring) {
    const start = parseDate(r.startDate);
    if (!start) continue;
    if (isAfter(start, targetDate)) continue;

    const endCfg = r.endDate ? parseDate(r.endDate) : targetDate;
    const effectiveEnd =
      endCfg.getTime() < targetDate.getTime() ? endCfg : targetDate;

    const rec = r.recurrence || { mode: 'monthly' };

    switch (rec.mode) {
      case 'daily':
        generateDaily(r, start, effectiveEnd, occurrences);
        break;
      case 'everyXDays':
        generateEveryXDays(r, start, effectiveEnd, rec.interval, occurrences);
        break;
      case 'weekly':
        generateWeekly(r, start, effectiveEnd, rec.interval, occurrences);
        break;
      case 'weeklySpecific':
        generateWeeklySpecific(r, start, effectiveEnd, rec.daysOfWeek, occurrences);
        break;
      case 'everyXMonths':
        generateEveryXMonths(r, start, effectiveEnd, rec.interval, occurrences);
        break;
      case 'yearly':
        generateYearly(r, start, effectiveEnd, occurrences);
        break;
      case 'monthly':
      default:
        generateMonthly(r, start, effectiveEnd, occurrences);
        break;
    }
  }

  return occurrences;
}

function recurrenceLabel(r) {
  const rec = r.recurrence || { mode: 'monthly' };
  const mode = rec.mode || 'monthly';
  const interval = Math.max(1, rec.interval || 1);
  const days = Array.isArray(rec.daysOfWeek) ? rec.daysOfWeek : [];

  switch (mode) {
    case 'daily':
      return 'Ogni giorno';
    case 'everyXDays':
      return `Ogni ${interval} giorni`;
    case 'weekly':
      return interval === 1 ? 'Ogni settimana' : `Ogni ${interval} settimane`;
    case 'weeklySpecific': {
      if (!days.length) return 'Giorni specifici';
      const map = {
        1: 'Lun',
        2: 'Mar',
        3: 'Mer',
        4: 'Gio',
        5: 'Ven',
        6: 'Sab',
        7: 'Dom'
      };
      const labels = days.map(d => map[d] || '').filter(Boolean);
      return `Ogni ${labels.join(', ')}`;
    }
    case 'everyXMonths':
      return interval === 1 ? 'Ogni mese' : `Ogni ${interval} mesi`;
    case 'yearly':
      return 'Ogni anno';
    case 'monthly':
    default:
      return 'Mensile';
  }
}

/* ====================== SNAPSHOT / KPI ====================== */

function getSnapshot(targetDateStr) {
  const targetDate = parseDate(targetDateStr);
  if (!targetDate) {
    return {
      saldo: 0,
      liquidita: 0,
      investito: 0,
      totale: 0,
      entratePreviste: 0,
      spesePreviste: 0
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const baseMovs = state.movements.filter(m => {
    const d = parseDate(m.date);
    if (!d) return false;
    return isSameOrBefore(d, targetDate);
  });

  const recurringMovs = generateRecurringOccurrences(targetDate);
  const allMovs = [...baseMovs, ...recurringMovs];

  let totalIncome = 0;
  let totalExpense = 0;
  let liquidita = 0;
  let investito = 0;
  let entratePreviste = 0;
  let spesePreviste = 0;

  for (const m of allMovs) {
    const amt = Number(m.amount) || 0;
    const d = parseDate(m.date);
    if (!d) continue;
    const type = m.type === 'expense' ? 'expense' : 'income';
    const accountType = m.accountType === 'invested' ? 'invested' : 'liquid';

    if (type === 'income') {
      totalIncome += amt;
      if (accountType === 'liquid') liquidita += amt;
      else investito += amt;
    } else {
      totalExpense += amt;
      if (accountType === 'liquid') liquidita -= amt;
      else investito -= amt;
    }

    if (isAfter(d, today) && isSameOrBefore(d, targetDate)) {
      if (type === 'income') entratePreviste += amt;
      else spesePreviste += amt;
    }
  }

  const saldo = totalIncome - totalExpense;
  const totale = liquidita + investito;

  return {
    saldo,
    liquidita,
    investito,
    totale,
    entratePreviste,
    spesePreviste
  };
}

function renderKpi() {
  const dateInput = document.getElementById('dateFilter');
  const target = dateInput.value;
  const snap = getSnapshot(target);

  const set = (id, value) => {
    const el = document.getElementById(id);
    el.textContent = formatCurrency(value);
  };

  set('stat-saldo', snap.saldo);
  set('stat-liquidita', snap.liquidita);
  set('stat-investito', snap.investito);
  set('stat-entrate-previste', snap.entratePreviste);
  set('stat-spese-previste', snap.spesePreviste);
  set('stat-totale', snap.totale);
}

/* ====================== MOVIMENTI ====================== */

function renderMovements() {
  const tbody = document.getElementById('mov-list');
  tbody.innerHTML = '';

  const sorted = [...state.movements].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '')
  );

  if (!sorted.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.style.textAlign = 'center';
    td.style.padding = '12px 0';
    td.textContent = 'Nessun movimento inserito.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const m of sorted) {
    const tr = document.createElement('tr');

    const dateTd = document.createElement('td');
    dateTd.textContent = formatDate(m.date);

    const typeTd = document.createElement('td');
    const typeBadge = document.createElement('span');
    typeBadge.className = 'badge ' + (m.type === 'expense' ? 'badge-expense' : 'badge-income');
    typeBadge.textContent = m.type === 'expense' ? 'Uscita' : 'Entrata';
    typeTd.appendChild(typeBadge);

    const accTd = document.createElement('td');
    const accBadge = document.createElement('span');
    accBadge.className =
      'badge ' + (m.accountType === 'invested' ? 'badge-invested' : 'badge-liquid');
    accBadge.textContent = m.accountType === 'invested' ? 'Investito' : 'Liquidità';
    accTd.appendChild(accBadge);

    const catTd = document.createElement('td');
    catTd.textContent = m.category || '-';

    const noteTd = document.createElement('td');
    noteTd.textContent = m.note || '';

    const amtTd = document.createElement('td');
    const amt = Number(m.amount) || 0;
    amtTd.className =
      'align-right ' + (m.type === 'expense' ? 'amount-negative' : 'amount-positive');
    amtTd.textContent = formatCurrency(amt);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'align-center';

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.innerHTML = '✏';
    editBtn.dataset.action = 'edit-mov';
    editBtn.dataset.id = m.id;

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.innerHTML = '🗑';
    delBtn.dataset.action = 'delete-mov';
    delBtn.dataset.id = m.id;

    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(delBtn);

    tr.appendChild(dateTd);
    tr.appendChild(typeTd);
    tr.appendChild(accTd);
    tr.appendChild(catTd);
    tr.appendChild(noteTd);
    tr.appendChild(amtTd);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  }
}

function resetMovementForm() {
  const form = document.getElementById('mov-form');
  form.reset();
  editingMovementId = null;
  document.getElementById('mov-submit').textContent = 'Aggiungi movimento';
  document.getElementById('mov-cancel').classList.add('hidden');
}

function handleMovementSubmit(e) {
  e.preventDefault();
  const form = document.getElementById('mov-form');
  const type =
    form.querySelector('input[name="mov-type"]:checked')?.value || 'income';
  const accountType = document.getElementById('mov-account').value || 'liquid';
  const category = document.getElementById('mov-category').value.trim();
  const amountStr = document.getElementById('mov-amount').value;
  const date = document.getElementById('mov-date').value;
  const note = document.getElementById('mov-note').value.trim();

  const amount = Number(amountStr);
  if (!date || isNaN(amount) || amount <= 0) {
    alert('Inserisci almeno data e importo > 0.');
    return;
  }

  if (editingMovementId) {
    const idx = state.movements.findIndex(m => m.id === editingMovementId);
    if (idx >= 0) {
      state.movements[idx] = {
        ...state.movements[idx],
        type,
        accountType,
        category,
        amount,
        date,
        note
      };
    }
  } else {
    state.movements.push({
      id: generateId('M'),
      type,
      accountType,
      category,
      amount,
      date,
      note
    });
  }

  saveState();
  resetMovementForm();
  renderMovements();
  renderKpi();
}

function handleMovementListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (!id) return;

  if (action === 'delete-mov') {
    if (confirm('Eliminare questo movimento?')) {
      state.movements = state.movements.filter(m => m.id !== id);
      saveState();
      renderMovements();
      renderKpi();
    }
  }

  if (action === 'edit-mov') {
    const m = state.movements.find(x => x.id === id);
    if (!m) return;
    editingMovementId = id;

    const form = document.getElementById('mov-form');
    const typeInputs = form.querySelectorAll('input[name="mov-type"]');
    typeInputs.forEach(inp => {
      inp.checked = inp.value === m.type;
    });

    document.getElementById('mov-account').value = m.accountType || 'liquid';
    document.getElementById('mov-category').value = m.category || '';
    document.getElementById('mov-amount').value = m.amount;
    document.getElementById('mov-date').value = m.date || '';
    document.getElementById('mov-note').value = m.note || '';

    document.getElementById('mov-submit').textContent = 'Salva movimento';
    document.getElementById('mov-cancel').classList.remove('hidden');
  }
}

/* ====================== RICORRENTI ====================== */

function resetRecurringForm(type) {
  if (type === 'income') {
    editingRecurringIncomeId = null;
    const form = document.getElementById('rec-income-form');
    form.reset();
    document.getElementById('rec-income-mode').value = 'monthly';
    document.getElementById('rec-income-interval').value = 1;
    clearWeekdayCheckboxes('rec-income-weekdays');
    updateRecurrenceUi('income');
    document.getElementById('rec-income-submit').textContent =
      'Aggiungi entrata ricorrente';
    document.getElementById('rec-income-cancel').classList.add('hidden');
  } else {
    editingRecurringExpenseId = null;
    const form = document.getElementById('rec-expense-form');
    form.reset();
    document.getElementById('rec-expense-mode').value = 'monthly';
    document.getElementById('rec-expense-interval').value = 1;
    clearWeekdayCheckboxes('rec-expense-weekdays');
    updateRecurrenceUi('expense');
    document.getElementById('rec-expense-submit').textContent =
      'Aggiungi spesa ricorrente';
    document.getElementById('rec-expense-cancel').classList.add('hidden');
  }
}

function clearWeekdayCheckboxes(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const inputs = container.querySelectorAll('input[type="checkbox"]');
  inputs.forEach(i => {
    i.checked = false;
  });
}

function getWeekdaysFromContainer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  const inputs = container.querySelectorAll('input[type="checkbox"]');
  const res = [];
  inputs.forEach(inp => {
    if (inp.checked) res.push(Number(inp.value));
  });
  return res;
}

function setWeekdaysInContainer(containerId, days) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const inputs = container.querySelectorAll('input[type="checkbox"]');
  inputs.forEach(inp => {
    inp.checked = days.includes(Number(inp.value));
  });
}

function updateRecurrenceUi(type) {
  const isIncome = type === 'income';
  const modeEl = document.getElementById(
    isIncome ? 'rec-income-mode' : 'rec-expense-mode'
  );
  const intervalRow = document.getElementById(
    isIncome ? 'rec-income-interval-row' : 'rec-expense-interval-row'
  );
  const weekdaysRow = document.getElementById(
    isIncome ? 'rec-income-weekdays-row' : 'rec-expense-weekdays-row'
  );

  const mode = modeEl.value;

  intervalRow.classList.add('hidden');
  weekdaysRow.classList.add('hidden');

  if (mode === 'everyXDays' || mode === 'weekly' || mode === 'everyXMonths') {
    intervalRow.classList.remove('hidden');
  }

  if (mode === 'weeklySpecific') {
    weekdaysRow.classList.remove('hidden');
  }
}

function handleRecurringSubmit(type, e) {
  e.preventDefault();
  const isIncome = type === 'income';

  const nameEl = document.getElementById(
    isIncome ? 'rec-income-name' : 'rec-expense-name'
  );
  const amountEl = document.getElementById(
    isIncome ? 'rec-income-amount' : 'rec-expense-amount'
  );
  const accountEl = document.getElementById(
    isIncome ? 'rec-income-account' : 'rec-expense-account'
  );
  const categoryEl = document.getElementById(
    isIncome ? 'rec-income-category' : 'rec-expense-category'
  );
  const startEl = document.getElementById(
    isIncome ? 'rec-income-start' : 'rec-expense-start'
  );
  const endEl = document.getElementById(
    isIncome ? 'rec-income-end' : 'rec-expense-end'
  );
  const modeEl = document.getElementById(
    isIncome ? 'rec-income-mode' : 'rec-expense-mode'
  );
  const intervalEl = document.getElementById(
    isIncome ? 'rec-income-interval' : 'rec-expense-interval'
  );
  const weekdaysContainerId = isIncome
    ? 'rec-income-weekdays'
    : 'rec-expense-weekdays';

  const name = nameEl.value.trim();
  const amount = Number(amountEl.value);
  const accountType = accountEl.value || 'liquid';
  const category = categoryEl.value.trim();
  const startDate = startEl.value;
  const endDate = endEl.value || null;
  const mode = modeEl.value || 'monthly';

  if (!name || !startDate || isNaN(amount) || amount <= 0) {
    alert('Compila almeno nome, data di inizio e importo > 0.');
    return;
  }

  let recurrence = { mode };

  if (mode === 'everyXDays' || mode === 'weekly' || mode === 'everyXMonths') {
    const interval = Math.max(1, parseInt(intervalEl.value, 10) || 1);
    recurrence.interval = interval;
  }

  if (mode === 'weeklySpecific') {
    const days = getWeekdaysFromContainer(weekdaysContainerId);
    if (!days.length) {
      alert('Seleziona almeno un giorno della settimana.');
      return;
    }
    recurrence.daysOfWeek = days;
  }

  const obj = {
    type: isIncome ? 'income' : 'expense',
    name,
    amount,
    accountType,
    category,
    startDate,
    endDate,
    recurrence
  };

  if (isIncome) {
    if (editingRecurringIncomeId) {
      const idx = state.recurring.findIndex(
        r => r.id === editingRecurringIncomeId && r.type === 'income'
      );
      if (idx >= 0) {
        state.recurring[idx] = {
          ...state.recurring[idx],
          ...obj,
          id: editingRecurringIncomeId
        };
      }
    } else {
      state.recurring.push({
        ...obj,
        id: generateId('R')
      });
    }
  } else {
    if (editingRecurringExpenseId) {
      const idx = state.recurring.findIndex(
        r => r.id === editingRecurringExpenseId && r.type === 'expense'
      );
      if (idx >= 0) {
        state.recurring[idx] = {
          ...state.recurring[idx],
          ...obj,
          id: editingRecurringExpenseId
        };
      }
    } else {
      state.recurring.push({
        ...obj,
        id: generateId('R')
      });
    }
  }

  saveState();
  resetRecurringForm(type);
  renderRecurring();
  renderKpi();
}

function handleRecurringListClick(type, e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (!id) return;

  const isIncome = type === 'income';

  if (action === (isIncome ? 'delete-rec-income' : 'delete-rec-expense')) {
    if (confirm('Eliminare questa ricorrenza?')) {
      state.recurring = state.recurring.filter(r => r.id !== id);
      saveState();
      renderRecurring();
      renderKpi();
    }
  }

  if (action === (isIncome ? 'edit-rec-income' : 'edit-rec-expense')) {
    const r = state.recurring.find(
      x => x.id === id && x.type === (isIncome ? 'income' : 'expense')
    );
    if (!r) return;

    const rec = r.recurrence || { mode: 'monthly' };
    const mode = rec.mode || 'monthly';
    const interval = Math.max(1, rec.interval || 1);
    const days = Array.isArray(rec.daysOfWeek) ? rec.daysOfWeek : [];

    if (isIncome) {
      editingRecurringIncomeId = id;
      document.getElementById('rec-income-name').value = r.name || '';
      document.getElementById('rec-income-amount').value = r.amount;
      document.getElementById('rec-income-account').value = r.accountType || 'liquid';
      document.getElementById('rec-income-category').value = r.category || '';
      document.getElementById('rec-income-start').value = r.startDate || '';
      document.getElementById('rec-income-end').value = r.endDate || '';
      document.getElementById('rec-income-mode').value = mode;
      document.getElementById('rec-income-interval').value = interval;
      clearWeekdayCheckboxes('rec-income-weekdays');
      setWeekdaysInContainer('rec-income-weekdays', days);
      updateRecurrenceUi('income');
      document.getElementById('rec-income-submit').textContent =
        'Salva entrata ricorrente';
      document.getElementById('rec-income-cancel').classList.remove('hidden');
    } else {
      editingRecurringExpenseId = id;
      document.getElementById('rec-expense-name').value = r.name || '';
      document.getElementById('rec-expense-amount').value = r.amount;
      document.getElementById('rec-expense-account').value =
        r.accountType || 'liquid';
      document.getElementById('rec-expense-category').value = r.category || '';
      document.getElementById('rec-expense-start').value = r.startDate || '';
      document.getElementById('rec-expense-end').value = r.endDate || '';
      document.getElementById('rec-expense-mode').value = mode;
      document.getElementById('rec-expense-interval').value = interval;
      clearWeekdayCheckboxes('rec-expense-weekdays');
      setWeekdaysInContainer('rec-expense-weekdays', days);
      updateRecurrenceUi('expense');
      document.getElementById('rec-expense-submit').textContent =
        'Salva spesa ricorrente';
      document.getElementById('rec-expense-cancel').classList.remove('hidden');
    }
  }
}

function renderRecurring() {
  const incomeTbody = document.getElementById('rec-income-list');
  const expenseTbody = document.getElementById('rec-expense-list');

  incomeTbody.innerHTML = '';
  expenseTbody.innerHTML = '';

  const incomes = state.recurring.filter(r => r.type === 'income');
  const expenses = state.recurring.filter(r => r.type === 'expense');

  const renderList = (data, tbody, type) => {
    if (!data.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.style.textAlign = 'center';
      td.style.padding = '10px 0';
      td.textContent =
        type === 'income'
          ? 'Nessuna entrata ricorrente.'
          : 'Nessuna spesa ricorrente.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const r of data) {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = r.name || '-';

      const catTd = document.createElement('td');
      catTd.textContent = r.category || '-';

      const freqTd = document.createElement('td');
      freqTd.textContent = recurrenceLabel(r);

      const startTd = document.createElement('td');
      startTd.textContent = formatDate(r.startDate);

      const endTd = document.createElement('td');
      endTd.textContent = r.endDate ? formatDate(r.endDate) : '∞';

      const accTd = document.createElement('td');
      const accBadge = document.createElement('span');
      accBadge.className =
        'badge ' + (r.accountType === 'invested' ? 'badge-invested' : 'badge-liquid');
      accBadge.textContent = r.accountType === 'invested' ? 'Investito' : 'Liquidità';
      accTd.appendChild(accBadge);

      const amtTd = document.createElement('td');
      amtTd.className =
        'align-right ' + (type === 'income' ? 'amount-positive' : 'amount-negative');
      amtTd.textContent = formatCurrency(r.amount);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'align-center';

      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.innerHTML = '✏';
      editBtn.dataset.action = type === 'income' ? 'edit-rec-income' : 'edit-rec-expense';
      editBtn.dataset.id = r.id;

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.innerHTML = '🗑';
      delBtn.dataset.action = type === 'income' ? 'delete-rec-income' : 'delete-rec-expense';
      delBtn.dataset.id = r.id;

      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(delBtn);

      tr.appendChild(nameTd);
      tr.appendChild(catTd);
      tr.appendChild(freqTd);
      tr.appendChild(startTd);
      tr.appendChild(endTd);
      tr.appendChild(accTd);
      tr.appendChild(amtTd);
      tr.appendChild(actionsTd);

      tbody.appendChild(tr);
    }
  };

  renderList(incomes, incomeTbody, 'income');
  renderList(expenses, expenseTbody, 'expense');
}

/* ====================== TABS / EXPORT / RESET ====================== */

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      contents.forEach(c => {
        if (c.id === 'tab-' + target) c.classList.add('active');
        else c.classList.remove('active');
      });
    });
  });
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'neobudget-export.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || typeof parsed !== 'object') throw new Error('Formato non valido');
      state.movements = Array.isArray(parsed.movements) ? parsed.movements : [];
      state.recurring = Array.isArray(parsed.recurring) ? parsed.recurring : [];
      // normalizza eventuali vecchi dati
      for (const r of state.recurring) {
        if (!r.recurrence) r.recurrence = { mode: 'monthly' };
      }
      saveState();
      renderMovements();
      renderRecurring();
      renderKpi();
      alert('Dati importati correttamente.');
    } catch (err) {
      console.error(err);
      alert('File JSON non valido.');
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm('Reset totale dei dati? Operazione irreversibile.')) return;
  state = { movements: [], recurring: [] };
  saveState();
  resetMovementForm();
  resetRecurringForm('income');
  resetRecurringForm('expense');
  renderMovements();
  renderRecurring();
  renderKpi();
}

/* ====================== DATE FILTER ====================== */

function initDateFilter() {
  const dateInput = document.getElementById('dateFilter');
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;
  dateInput.value = todayStr;

  dateInput.addEventListener('change', () => {
    renderKpi();
  });

  document.getElementById('btnToday').addEventListener('click', () => {
    dateInput.value = todayStr;
    renderKpi();
  });
}

/* ====================== INIT ====================== */

function init() {
  loadState();
  initDateFilter();
  setupTabs();

  // Movimenti
  document.getElementById('mov-form').addEventListener('submit', handleMovementSubmit);
  document.getElementById('mov-cancel').addEventListener('click', () => {
    resetMovementForm();
  });
  document.getElementById('mov-list').addEventListener('click', handleMovementListClick);

  // Ricorrenti entrate
  document
    .getElementById('rec-income-form')
    .addEventListener('submit', handleRecurringSubmit.bind(null, 'income'));
  document.getElementById('rec-income-cancel').addEventListener('click', () => {
    resetRecurringForm('income');
  });
  document
    .getElementById('rec-income-list')
    .addEventListener('click', e => handleRecurringListClick('income', e));
  document
    .getElementById('rec-income-mode')
    .addEventListener('change', () => updateRecurrenceUi('income'));
  updateRecurrenceUi('income');

  // Ricorrenti spese
  document
    .getElementById('rec-expense-form')
    .addEventListener('submit', handleRecurringSubmit.bind(null, 'expense'));
  document.getElementById('rec-expense-cancel').addEventListener('click', () => {
    resetRecurringForm('expense');
  });
  document
    .getElementById('rec-expense-list')
    .addEventListener('click', e => handleRecurringListClick('expense', e));
  document
    .getElementById('rec-expense-mode')
    .addEventListener('change', () => updateRecurrenceUi('expense'));
  updateRecurrenceUi('expense');

  // Export / import / reset
  document.getElementById('btnExport').addEventListener('click', exportJson);
  document.getElementById('btnImport').addEventListener('click', () => {
    document.getElementById('fileImport').click();
  });
  document.getElementById('fileImport').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importJson(file);
    e.target.value = '';
  });
  document.getElementById('btnReset').addEventListener('click', resetAll);

  // Primo render
  renderMovements();
  renderRecurring();
  renderKpi();
}

document.addEventListener('DOMContentLoaded', init);
