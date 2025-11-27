// NeoBudget - app.js CLEAN

const STORAGE_KEY = 'neobudget-state-v1';

let state = {
  movements: [],
  recurring: []
};

let editingMovementId = null;
let currentRecType = 'income';        // 'income' | 'expense' per ricorrenti
let editingRecurringId = null;        // id ricorrente in edit unificato
let monthChart = null;

/* ====================== HELPERS BASE ====================== */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    state.movements = Array.isArray(parsed.movements) ? parsed.movements : [];
    state.recurring = Array.isArray(parsed.recurring) ? parsed.recurring : [];

    // Normalizza vecchi formati ricorrenti
    for (const r of state.recurring) {
      // tipo fallback
      if (r.type !== 'income' && r.type !== 'expense') {
        r.type = 'income';
      }

      // migrazione vecchio frequency -> recurrence
      if (!r.recurrence) {
        if (r.frequency === 'quarterly') {
          r.recurrence = { mode: 'everyXMonths', interval: 3 };
        } else if (r.frequency === 'yearly') {
          r.recurrence = { mode: 'yearly' };
        } else {
          r.recurrence = { mode: 'monthly' };
        }
      }

      if (!r.recurrence.mode) {
        r.recurrence.mode = 'monthly';
      }

      if (typeof r.recurrence.interval !== 'number') {
        r.recurrence.interval = 1;
      }

      if (!Array.isArray(r.recurrence.daysOfWeek)) {
        r.recurrence.daysOfWeek = [];
      }

      delete r.frequency;
    }

  } catch (err) {
    console.error('Errore caricando lo stato:', err);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Errore salvando lo stato:', err);
  }
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
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
    let dow = current.getDay(); // 0=Dom..6=Sab, convertiamo in 1..7 con Lun=1
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
  if (!(targetDate instanceof Date)) return occurrences;

  for (const r of state.recurring) {
    const start = parseDate(r.startDate);
    if (!start) continue;
    if (isAfter(start, targetDate)) continue;

    const rec = r.recurrence || { mode: 'monthly', interval: 1, daysOfWeek: [] };
    const mode = rec.mode || 'monthly';
    const interval = Math.max(1, rec.interval || 1);
    const daysOfWeek = Array.isArray(rec.daysOfWeek) ? rec.daysOfWeek : [];

    const endCfg = r.endDate ? parseDate(r.endDate) : targetDate;
    const effectiveEnd = endCfg.getTime() < targetDate.getTime() ? endCfg : targetDate;

    switch (mode) {
      case 'daily':
        generateDaily(r, start, effectiveEnd, occurrences);
        break;
      case 'everyXDays':
        generateEveryXDays(r, start, effectiveEnd, interval, occurrences);
        break;
      case 'weekly':
        generateWeekly(r, start, effectiveEnd, interval, occurrences);
        break;
      case 'weeklySpecific':
        generateWeeklySpecific(r, start, effectiveEnd, daysOfWeek, occurrences);
        break;
      case 'everyXMonths':
        generateEveryXMonths(r, start, effectiveEnd, interval, occurrences);
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
  const rec = r.recurrence || { mode: 'monthly', interval: 1, daysOfWeek: [] };
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
      const map = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Gio', 5: 'Ven', 6: 'Sab', 7: 'Dom' };
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

/* ====================== KPI / SNAPSHOT ====================== */

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
  if (!dateInput) return;

  const snap = getSnapshot(dateInput.value);

  const mapping = {
    'stat-saldo': snap.saldo,
    'stat-liquidita': snap.liquidita,
    'stat-investito': snap.investito,
    'stat-entrate-previste': snap.entratePreviste,
    'stat-spese-previste': snap.spesePreviste,
    'stat-totale': snap.totale
  };

  Object.entries(mapping).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = formatCurrency(val);
    el.classList.add('animate');
    setTimeout(() => el.classList.remove('animate'), 350);
  });
}

function generateCategorySummary(targetDate) {
  const list = document.getElementById('summary-list');
  if (!list || !(targetDate instanceof Date)) return;

  list.innerHTML = '';

  const baseMovs = state.movements.filter(m => {
    const d = parseDate(m.date);
    return d && isSameOrBefore(d, targetDate);
  });

  const recMovs = generateRecurringOccurrences(targetDate);
  const all = [...baseMovs, ...recMovs];

  if (!all.length) {
    const empty = document.createElement('div');
    empty.className = 'summary-item';
    empty.innerHTML = '<span>Nessun dato disponibile</span><span>0,00 €</span>';
    list.appendChild(empty);
    return;
  }

  const map = {};

  for (const m of all) {
    const cat = (m.category || 'Senza categoria').trim();
    if (!map[cat]) map[cat] = 0;
    const amt = Number(m.amount) || 0;
    if (m.type === 'income') map[cat] += amt;
    else map[cat] -= amt;
  }

  Object.entries(map).forEach(([cat, val]) => {
    const div = document.createElement('div');
    div.className = 'summary-item';
    const color = val >= 0 ? '#6bf5c0' : '#ff6689';
    div.innerHTML = `
      <span>${cat}</span>
      <span style="font-weight:600;color:${color}">${val.toFixed(2)} €</span>
    `;
    list.appendChild(div);
  });
}

/* ====================== CHART MENSILE ====================== */

function getMonthlyBalanceData(selectedDateStr) {
  const date = parseDate(selectedDateStr);
  if (!date) return [];

  const year = date.getFullYear();
  const month = date.getMonth();

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const daysInMonth = monthEnd.getDate();

  // saldo liquidità prima dell'inizio mese
  let startingLiquidity = 0;

  const beforeMonthMovs = [
    ...state.movements,
    ...generateRecurringOccurrences(monthEnd)
  ].filter(m => {
    const d = parseDate(m.date);
    return d && d < monthStart && m.accountType === 'liquid';
  });

  for (const m of beforeMonthMovs) {
    startingLiquidity += (m.type === 'income' ? 1 : -1) * (Number(m.amount) || 0);
  }

  const monthMovs = [
    ...state.movements,
    ...generateRecurringOccurrences(monthEnd)
  ].filter(m => {
    const d = parseDate(m.date);
    return d && d >= monthStart && d <= monthEnd && m.accountType === 'liquid';
  });

  monthMovs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const daily = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    value: 0
  }));

  let current = startingLiquidity;

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);

    for (const mov of monthMovs) {
      const md = parseDate(mov.date);
      if (md && md.getDate() === day) {
        current += (mov.type === 'income' ? 1 : -1) * (Number(mov.amount) || 0);
      }
    }

    daily[day - 1].value = current;
  }

  return daily;
}

function renderMonthlyChart(selectedDateStr) {
  const chartEl = document.getElementById('chart-month');
  if (!chartEl) return;
  if (typeof ApexCharts === 'undefined') return;

  const data = getMonthlyBalanceData(selectedDateStr);
  const values = data.map(d => d.value);

  const options = {
    series: [{
      name: 'Liquidità',
      data: values
    }],
    chart: {
      type: 'area',
      height: 260,
      toolbar: { show: false },
      animations: {
        enabled: true,
        easing: 'easeinout',
        speed: 550
      },
      zoom: { enabled: false }
    },
    stroke: {
      curve: 'smooth',
      width: 4,
      colors: ['#c8d0ff']
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 0.9,
        opacityFrom: 0.4,
        opacityTo: 0.05,
        stops: [0, 50, 100],
        colorStops: [
          { offset: 0, color: '#7f8dff', opacity: 0.35 },
          { offset: 50, color: '#a5b1ff', opacity: 0.18 },
          { offset: 100, color: '#ffffff', opacity: 0.07 }
        ]
      }
    },
    dataLabels: { enabled: false },
    markers: {
      size: 0,
      hover: { size: 6 }
    },
    grid: {
      borderColor: 'rgba(255,255,255,0.08)',
      padding: {
        left: 10,
        right: 10,
        top: 0,
        bottom: -10
      }
    },
    xaxis: {
      categories: data.map(d => d.day),
      tickAmount: 6,
      labels: {
        rotate: 0,
        style: { color: '#bfc3e1', fontSize: '12px' },
        formatter: (value) => {
          const v = Number(value);
          return [1, 5, 10, 15, 20, 25, 30].includes(v) ? v : '';
        }
      },
      tooltip: { enabled: false }
    },
    yaxis: {
      decimalsInFloat: 0,
      forceNiceScale: true,
      labels: {
        formatter: (v) => v.toFixed(0),
        style: { color: '#bfc3e1', fontSize: '12px' }
      }
    },
    tooltip: {
      theme: 'dark',
      marker: { show: false },
      y: {
        formatter: (v) => `${v.toFixed(2)} €`
      }
    }
  };

  if (monthChart) {
    monthChart.updateOptions(options);
  } else {
    monthChart = new ApexCharts(chartEl, options);
    monthChart.render();
  }
}

/* ====================== MOVIMENTI ====================== */

function getSelectedMovementType() {
  const btn = document.querySelector('.mov-pill-btn.active');
  return btn ? btn.dataset.type : null;
}


function renderMovements() {
  const list = document.getElementById('mov-list');
  if (!list) return;

  list.innerHTML = '';

  const sorted = [...state.movements].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '')
  );

  if (!sorted.length) {
    list.innerHTML = `
      <div class="mov-item empty">
        Nessun movimento inserito.
      </div>`;
    return;
  }

  for (const m of sorted) {
    const amount = Number(m.amount) || 0;
    const amountFormatted = formatCurrency(amount);
    const dateFormatted = formatDate(m.date);

    const item = document.createElement('div');
    item.className = 'mov-item';

    item.innerHTML = `
      <div class="mov-left">

        <div class="mov-topline">
          <span class="mov-date">${dateFormatted}</span>
          <span class="mov-amount ${m.type === 'expense' ? 'mov-amount-neg' : 'mov-amount-pos'}">
            ${amountFormatted}
          </span>
        </div>

        <div class="mov-category">${m.category || 'Senza categoria'}</div>

        <div class="mov-meta">
          <span class="badge">${m.type === 'expense' ? 'Uscita' : 'Entrata'}</span>
          <span class="badge">${m.accountType === 'invested' ? 'Investito' : 'Liquidità'}</span>
          ${m.note ? `<span class="note">${m.note}</span>` : ''}
        </div>

      </div>

      <div class="mov-actions">
        <button data-action="edit-mov" data-id="${m.id}">
          <ion-icon name="create-outline"></ion-icon>
        </button>
        <button data-action="delete-mov" data-id="${m.id}">
          <ion-icon name="trash-outline"></ion-icon>
        </button>
      </div>
    `;

    list.appendChild(item);
  }
}


function resetMovementForm() {
  const form = document.getElementById('mov-form');
  if (!form) return;
  form.reset();
  editingMovementId = null;

  const submitBtn = document.getElementById('mov-submit');
  const cancelBtn = document.getElementById('mov-cancel');
  if (submitBtn) submitBtn.textContent = 'Aggiungi movimento';
  if (cancelBtn) cancelBtn.classList.add('hidden');

  // deseleziona tipo
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  const formCollapse = document.getElementById('movementForm');
  if (formCollapse) {
    formCollapse.style.maxHeight = '0';
    formCollapse.style.opacity = '0';
  }
}

function handleMovementSubmit(e) {
  e.preventDefault();

  const type = getSelectedMovementType();
  if (!type) {
    alert('Seleziona Entrata o Uscita.');
    return;
  }

  const accountType = (document.getElementById('mov-account')?.value) || 'liquid';
  const category = (document.getElementById('mov-category')?.value || '').trim();
  const amountStr = document.getElementById('mov-amount')?.value;
  const date = document.getElementById('mov-date')?.value;
  const note = (document.getElementById('mov-note')?.value || '').trim();

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
  refreshAll();
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
      refreshAll();
    }
    return;
  }

  if (action === 'edit-mov') {
    const m = state.movements.find(x => x.id === id);
    if (!m) return;
    editingMovementId = id;

    const form = document.getElementById('mov-form');
    if (!form) return;

    document.getElementById('mov-account').value = m.accountType || 'liquid';
    document.getElementById('mov-category').value = m.category || '';
    document.getElementById('mov-amount').value = m.amount;
    document.getElementById('mov-date').value = m.date || '';
    document.getElementById('mov-note').value = m.note || '';

    // seleziona tipo
    document.querySelectorAll('.type-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.type === m.type);
    });

    const submitBtn = document.getElementById('mov-submit');
    const cancelBtn = document.getElementById('mov-cancel');
    if (submitBtn) submitBtn.textContent = 'Salva movimento';
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    // apri form
    const formCollapse = document.getElementById('movementForm');
    if (formCollapse) {
      formCollapse.style.maxHeight = '900px';
      formCollapse.style.opacity = '1';
    }
  }
}

function initMovements() {
  const form = document.getElementById('mov-form');
  const cancelBtn = document.getElementById('mov-cancel');
  const list = document.getElementById('mov-list');
  const typeBtns = document.querySelectorAll('.mov-pill-btn');
  const formCollapse = document.getElementById('movementForm');

  if (!form || !list) return; // pagina non è Movimenti

  // type toggle + collapse
  let activeType = null;
  let open = false;

  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const clicked = btn.dataset.type;

      if (clicked === activeType && open) {
        typeBtns.forEach(b => b.classList.remove('active'));
        if (formCollapse) {
          formCollapse.style.maxHeight = '0';
          formCollapse.style.opacity = '0';
        }
        activeType = null;
        open = false;
        return;
      }

      typeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeType = clicked;
      open = true;

      if (formCollapse) {
        formCollapse.style.maxHeight = '900px';
        formCollapse.style.opacity = '1';
      }
    });
  });

  form.addEventListener('submit', handleMovementSubmit);
  if (cancelBtn) cancelBtn.addEventListener('click', resetMovementForm);
  list.addEventListener('click', handleMovementListClick);

  renderMovements();
}

/* ====================== RICORRENTI UNIFICATI ====================== */

function resetUnifiedRecForm() {
  const form = document.getElementById('rec-form');
  if (!form) return;

  form.reset();
  editingRecurringId = null;

  const cancelBtn = document.getElementById('rec-cancel');
  const submitBtn = document.getElementById('rec-submit');
  if (cancelBtn) cancelBtn.classList.add('hidden');
  if (submitBtn) {
    submitBtn.textContent =
      currentRecType === 'income'
        ? 'Aggiungi entrata ricorrente'
        : 'Aggiungi spesa ricorrente';
  }

  const intervalRow = document.getElementById('rec-interval-row');
  const weekdaysRow = document.getElementById('rec-weekdays-row');
  if (intervalRow) intervalRow.classList.add('hidden');
  if (weekdaysRow) weekdaysRow.classList.add('hidden');

  // reset weekdays
  document.querySelectorAll('#rec-weekdays input[type="checkbox"]').forEach(c => {
    c.checked = false;
  });
}

function renderUnifiedRecurring() {
  const list = document.getElementById('rec-list');
  if (!list) return;

  list.innerHTML = '';

  const items = state.recurring.filter(r => r.type === currentRecType);

  if (!items.length) {
    list.innerHTML = `
      <div class="rec-card">
        <div class="rec-card-left">
          <div class="rec-card-title">Nessun elemento</div>
        </div>
      </div>`;
    return;
  }

  for (const r of items) {

    // Importo colorato
    const amountClass = r.type === 'income'
      ? 'rec-card-amount-pos'
      : 'rec-card-amount-neg';

    const card = document.createElement('div');
    card.className = 'rec-card';

    card.innerHTML = `
      <div class="rec-card-left">
        <div class="rec-card-title">${r.name || '-'}</div>
        <div class="rec-card-cat">${r.category || 'Senza categoria'}</div>
        <div class="rec-card-cat">${recurrenceLabel(r)}</div>
      </div>

      <div class="rec-card-right">
        <div class="${amountClass}">${formatCurrency(r.amount)}</div>
        <div class="card-actions">
          <button class="icon-btn" data-action="edit" data-id="${r.id}">✏</button>
          <button class="icon-btn" data-action="delete" data-id="${r.id}">🗑</button>
        </div>
      </div>
    `;

    list.appendChild(card);
  }
}



function handleRecModeUiUpdate() {
  const modeEl = document.getElementById('rec-mode');
  const intervalRow = document.getElementById('rec-interval-row');
  const weekdaysRow = document.getElementById('rec-weekdays-row');
  if (!modeEl || !intervalRow || !weekdaysRow) return;

  const mode = modeEl.value;

  intervalRow.classList.add('hidden');
  weekdaysRow.classList.add('hidden');

  if (['everyXDays', 'weekly', 'everyXMonths'].includes(mode)) {
    intervalRow.classList.remove('hidden');
  }

  if (mode === 'weeklySpecific') {
    weekdaysRow.classList.remove('hidden');
  }
}

function handleRecurringSubmit(e) {
  e.preventDefault();

  const name = (document.getElementById('rec-name')?.value || '').trim();
  const amount = Number(document.getElementById('rec-amount')?.value || 0);
  const accountType = (document.getElementById('rec-account')?.value) || 'liquid';
  const category = (document.getElementById('rec-category')?.value || '').trim();
  const startDate = document.getElementById('rec-start')?.value || '';
  const endDate = document.getElementById('rec-end')?.value || null;
  const mode = document.getElementById('rec-mode')?.value || 'monthly';
  const interval = Number(document.getElementById('rec-interval')?.value || 1);

  const daysOfWeek = Array.from(
    document.querySelectorAll('#rec-weekdays input:checked')
  ).map(x => Number(x.value));

  if (!name || !startDate || amount <= 0 || isNaN(amount)) {
    alert('Compila almeno nome, data di inizio e importo valido.');
    return;
  }

  const recurrence = {
    mode,
    interval: Math.max(1, interval),
    daysOfWeek: mode === 'weeklySpecific' ? daysOfWeek : []
  };

  const obj = {
    type: currentRecType,
    name,
    amount,
    accountType,
    category,
    startDate,
    endDate,
    recurrence
  };

  if (editingRecurringId) {
    const idx = state.recurring.findIndex(r => r.id === editingRecurringId);
    if (idx >= 0) {
      state.recurring[idx] = { ...state.recurring[idx], ...obj, id: editingRecurringId };
    }
  } else {
    obj.id = generateId('R');
    state.recurring.push(obj);
  }

  saveState();
  editingRecurringId = null;
  resetUnifiedRecForm();
  renderUnifiedRecurring();
  refreshAll();
}

function handleRecurringListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (!id) return;

  if (action === 'delete') {
    if (confirm('Eliminare questa ricorrenza?')) {
      state.recurring = state.recurring.filter(r => r.id !== id);
      saveState();
      renderUnifiedRecurring();
      refreshAll();
    }
    return;
  }

  if (action === 'edit') {
    const r = state.recurring.find(x => x.id === id);
    if (!r) return;
    editingRecurringId = id;

    document.getElementById('rec-name').value = r.name || '';
    document.getElementById('rec-amount').value = r.amount;
    document.getElementById('rec-account').value = r.accountType || 'liquid';
    document.getElementById('rec-category').value = r.category || '';
    document.getElementById('rec-start').value = r.startDate || '';
    document.getElementById('rec-end').value = r.endDate || '';

    document.getElementById('rec-mode').value = r.recurrence.mode || 'monthly';
    document.getElementById('rec-interval').value = r.recurrence.interval || 1;

    // WEEKDAYS
    const dayBtns = document.querySelectorAll('.day-btn');
    dayBtns.forEach(btn => {
      const day = Number(btn.dataset.day);
      btn.classList.toggle(
        'active',
        (r.recurrence.daysOfWeek || []).includes(day)
      );
    });

    handleRecModeUiUpdate();

    const cancelBtn = document.getElementById('rec-cancel');
    const submitBtn = document.getElementById('rec-submit');
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    if (submitBtn) submitBtn.textContent = 'Salva modifica';
  }
}



function initRecurring() {
  const tabsContainer = document.getElementById('rec-tabs');
  const form = document.getElementById('rec-form');
  const list = document.getElementById('rec-list');

  if (!tabsContainer || !form || !list) return;

  const tabs = tabsContainer.querySelectorAll('.rec-pill');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {

      // Visivo
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Tipo logico
      currentRecType = tab.dataset.recType === 'expense' ? 'expense' : 'income';

      // Aggiorna titolo
      const title = document.getElementById('rec-form-title');
      if (title) {
        title.textContent =
          currentRecType === 'income'
            ? 'Nuova entrata ricorrente'
            : 'Nuova spesa ricorrente';
      }

      // Aggiorna bottone submit
      const submitBtn = document.getElementById('rec-submit');
      if (submitBtn) {
        submitBtn.textContent =
          currentRecType === 'income'
            ? 'Aggiungi entrata ricorrente'
            : 'Aggiungi spesa ricorrente';
      }

      resetUnifiedRecForm();
      renderUnifiedRecurring();
    });
  });

  form.addEventListener('submit', handleRecurringSubmit);

  const cancelBtn = document.getElementById('rec-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    editingRecurringId = null;
    resetUnifiedRecForm();
  });

  const modeEl = document.getElementById('rec-mode');
  if (modeEl) {
    modeEl.addEventListener('change', handleRecModeUiUpdate);
    handleRecModeUiUpdate();
  }

  list.addEventListener('click', handleRecurringListClick);

  renderUnifiedRecurring();
}


// Day buttons (settimana)
document.querySelectorAll('.day-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
  });
});


/* ====================== EXPORT / IMPORT / RESET ====================== */

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

      // normalizza ricorrenze
      for (const r of state.recurring) {
        if (!r.recurrence) r.recurrence = { mode: 'monthly', interval: 1, daysOfWeek: [] };
        if (!r.recurrence.mode) r.recurrence.mode = 'monthly';
        if (typeof r.recurrence.interval !== 'number') r.recurrence.interval = 1;
        if (!Array.isArray(r.recurrence.daysOfWeek)) r.recurrence.daysOfWeek = [];
      }

      saveState();
      renderMovements();
      renderUnifiedRecurring();
      refreshAll();

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
  editingMovementId = null;
  editingRecurringId = null;

  renderMovements();
  renderUnifiedRecurring();
  refreshAll();
}

/* ====================== DATE FILTER + REFRESH ====================== */

function initDateFilter() {
  const dateInput = document.getElementById('dateFilter');
  if (!dateInput) return;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  dateInput.value = dateInput.value || todayStr;

  const refresh = () => {
    refreshAll();
  };

  dateInput.addEventListener('change', refresh);

  const todayBtn = document.getElementById('btnToday');
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      dateInput.value = todayStr;
      refresh();
    });
  }
}

function refreshAll() {
  const dateInput = document.getElementById('dateFilter');
  const targetStr = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);
  const targetDate = parseDate(targetStr) || new Date();

  // KPI + summary + chart solo dove esistono
  renderKpi();
  generateCategorySummary(targetDate);
  renderMonthlyChart(targetStr);
}

/* ====================== SETTINGS INIT ====================== */

function initSettings() {
  const btnExport = document.getElementById('btnExport');
  const btnImport = document.getElementById('btnImport');
  const fileInput = document.getElementById('fileImport');
  const btnReset = document.getElementById('btnReset');

  if (btnExport) btnExport.addEventListener('click', exportJson);

  if (btnImport && fileInput) {
    btnImport.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) importJson(file);
      e.target.value = '';
    });
  }

  if (btnReset) btnReset.addEventListener('click', resetAll);
}

/* ====================== BOTTOM NAV ====================== */

function initBottomNav() {
  const items = document.querySelectorAll('.bottom-nav .nav-item');
  if (!items.length) return;

  items.forEach(btn => {
    btn.addEventListener('click', () => {
      // lato SPA avrebbe senso; qui le pagine ricaricano, ma lo lascio per coerenza
      items.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

/* ====================== INIT GLOBALE ====================== */

function init() {
  loadState();

  initDateFilter();
  initMovements();
  initRecurring();
  initSettings();
  initBottomNav();

  // prima render globale per Home
  refreshAll();
  // Movimenti & Ricorrenti già renderizzati nelle rispettive init
}

document.addEventListener('DOMContentLoaded', init);
