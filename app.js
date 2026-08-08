/* ============================================================
   app.js — UI state, rendering, refresh loop, alerts, CSV I/O.
   Depends on globals from data.js (Store, CoinData) and
   charts.js (Charts). Loaded last, plain scripts (file:// safe).
   ============================================================ */
'use strict';

/* ---------- state ---------- */
const KEYS = { holdings: 'pt_holdings', alerts: 'pt_alerts' };
const REFRESH_MS = 60000;

let holdings = Store.get(KEYS.holdings, []);   // [{id, symbol, name, amount, avgBuy}]
let alerts = Store.get(KEYS.alerts, []);       // [{coinId, symbol, direction, target}]
let marketById = {};                            // coin id -> CoinGecko market record
let coinList = [];                              // [{id, symbol, name, rank}] for search
let selectedCoin = null;                        // coin picked in the add form
let dataSource = 'connecting';                  // live | cached | sample | offline
let refreshTimer = null;

/* ---------- formatting ---------- */
const fmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const fmtBig = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function fmtMoney(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 10000) return fmtBig.format(v);
  if (abs >= 1) return fmt2.format(v);
  // sub-dollar prices need more precision
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}
function fmtPct(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function signClass(v) { return v >= 0 ? 'pos' : 'neg'; }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- DOM shortcuts ---------- */
const $ = id => document.getElementById(id);

/* ============================================================
   Data loading: live -> cache -> sample
   ============================================================ */
async function loadMarketData(manual) {
  dataSource = 'connecting';
  renderStatus();
  if (manual) $('refresh-btn').disabled = true;

  const heldIds = holdings.map(h => h.id);
  const result = await CoinData.fetchMarket(heldIds);

  if (result.ok) {
    marketById = result.byId;
    coinList = result.list;
    dataSource = 'live';
    CoinData.saveCache(result.byId, result.list);
    renderAll();
    scheduleRefresh();
    $('refresh-btn').disabled = false;
    return;
  }

  // Fetch failed — fall back to cached prices, then sample data.
  const cache = CoinData.loadCache();
  const rateLimited = result.error && result.error.code === 429;

  if (cache && cache.byId) {
    marketById = cache.byId;
    coinList = cache.list && cache.list.length ? cache.list : coinList;
    dataSource = rateLimited ? 'rate-limited' : 'offline';
  } else {
    const sample = CoinData.sampleData();
    marketById = sample.byId;
    if (coinList.length === 0) coinList = sample.list;
    dataSource = rateLimited ? 'rate-limited-sample' : 'sample';
  }

  renderAll(cache ? cache.updatedAt : null);
  scheduleRefresh();
  $('refresh-btn').disabled = false;
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => loadMarketData(false), REFRESH_MS);
}

/* ============================================================
   Rendering
   ============================================================ */
function renderAll(cachedAt) {
  renderStatus(cachedAt);
  renderSummary();
  renderHoldings();
  renderAlerts();
  renderAlertCoinOptions();
}

function renderStatus(cachedAt) {
  const badge = $('status-badge');
  const lastEl = $('last-updated');
  const map = {
    live:                  ['badge badge-live', 'LIVE'],
    connecting:            ['badge badge-muted', 'connecting…'],
    offline:               ['badge badge-warn', 'OFFLINE · cached prices'],
    'rate-limited':        ['badge badge-warn', 'RATE LIMITED · cached prices'],
    sample:                ['badge badge-bad', 'OFFLINE · sample data'],
    'rate-limited-sample': ['badge badge-bad', 'RATE LIMITED · sample data']
  };
  const [cls, text] = map[dataSource] || map.connecting;
  badge.className = cls;
  badge.textContent = text;

  const when = cachedAt || (dataSource === 'live' ? Date.now() : null);
  lastEl.textContent = when ? 'updated ' + new Date(when).toLocaleTimeString() : '';
}

function holdingStats(h) {
  const m = marketById[h.id];
  const price = m ? m.current_price : null;
  const value = price !== null ? price * h.amount : null;
  const cost = h.avgBuy * h.amount;
  const pnl = value !== null ? value - cost : null;
  const pnlPct = (pnl !== null && cost > 0) ? (pnl / cost) * 100 : null;
  const change24h = m ? m.price_change_percentage_24h : null;
  return { price, value, cost, pnl, pnlPct, change24h, market: m };
}

function renderSummary() {
  let totalValue = 0, totalCost = 0, totalPrev = 0, anyValue = false;
  let top = null, worst = null;
  const alloc = [];

  for (const h of holdings) {
    const s = holdingStats(h);
    if (s.value === null) continue;
    anyValue = true;
    totalValue += s.value;
    totalCost += s.cost;
    // Reverse the 24h move to get yesterday's value for the portfolio 24h change.
    if (s.change24h !== null && s.change24h !== undefined) {
      totalPrev += s.value / (1 + s.change24h / 100);
    } else {
      totalPrev += s.value;
    }
    alloc.push({ label: h.symbol.toUpperCase(), value: s.value });
    if (s.pnlPct !== null) {
      if (!top || s.pnlPct > top.pnlPct) top = { sym: h.symbol, pnlPct: s.pnlPct };
      if (!worst || s.pnlPct < worst.pnlPct) worst = { sym: h.symbol, pnlPct: s.pnlPct };
    }
  }

  $('total-value').textContent = fmtMoney(totalValue);

  const totalPnl = totalValue - totalCost;
  const pnlEl = $('total-pnl');
  pnlEl.textContent = anyValue ? fmtMoney(totalPnl) : '$0.00';
  pnlEl.className = 'stat-value ' + (totalPnl >= 0 ? 'pos' : 'neg');
  const pnlPctEl = $('total-pnl-pct');
  if (totalCost > 0) {
    pnlPctEl.textContent = fmtPct((totalPnl / totalCost) * 100) + ' all-time · cost ' + fmtMoney(totalCost);
    pnlPctEl.className = 'stat-sub ' + signClass(totalPnl);
  } else {
    pnlPctEl.textContent = '';
  }

  const chEl = $('change-24h');
  if (anyValue && totalPrev > 0) {
    const ch = ((totalValue - totalPrev) / totalPrev) * 100;
    chEl.textContent = fmtPct(ch);
    chEl.className = 'stat-value ' + signClass(ch);
  } else {
    chEl.textContent = '—';
    chEl.className = 'stat-value';
  }

  $('top-performer').textContent = top ? top.sym.toUpperCase() + ' ' + fmtPct(top.pnlPct) : '—';
  $('top-performer').className = 'stat-value small ' + (top ? signClass(top.pnlPct) : '');
  $('worst-performer').textContent = worst ? worst.sym.toUpperCase() + ' ' + fmtPct(worst.pnlPct) : '—';
  $('worst-performer').className = 'stat-value small ' + (worst ? signClass(worst.pnlPct) : '');

  const d = Charts.donut(alloc);
  $('donut').innerHTML = d.svg;
  $('donut-legend').innerHTML = d.legend.map(l =>
    '<div class="legend-row"><span class="legend-dot" style="background:' + l.color + '"></span>' +
    '<span>' + esc(l.label) + '</span><span class="legend-pct">' + l.pct.toFixed(1) + '%</span></div>'
  ).join('');
}

function renderHoldings() {
  const body = $('holdings-body');
  $('holdings-empty').classList.toggle('hidden', holdings.length > 0);

  body.innerHTML = holdings.map(h => {
    const s = holdingStats(h);
    const spark = s.market && s.market.sparkline_in_7d
      ? Charts.sparkline(s.market.sparkline_in_7d.price, 110, 34, null)
      : '<span class="muted">—</span>';
    return '<tr>' +
      '<td><div class="asset-cell"><span class="coin-badge">' + esc(h.symbol.slice(0, 4).toUpperCase()) + '</span>' +
      '<span><strong>' + esc(h.symbol.toUpperCase()) + '</strong><br><span class="asset-name">' + esc(h.name) + '</span></span></div></td>' +
      '<td class="num">' + h.amount + '</td>' +
      '<td class="num">' + fmtMoney(h.avgBuy) + '</td>' +
      '<td class="num">' + fmtMoney(s.price) + '</td>' +
      '<td class="num ' + (s.change24h === null ? '' : signClass(s.change24h)) + '">' + fmtPct(s.change24h) + '</td>' +
      '<td class="num">' + fmtMoney(s.value) + '</td>' +
      '<td class="num">' + fmtMoney(s.cost) + '</td>' +
      '<td class="num ' + (s.pnl === null ? '' : signClass(s.pnl)) + '">' + fmtMoney(s.pnl) + '</td>' +
      '<td class="num ' + (s.pnlPct === null ? '' : signClass(s.pnlPct)) + '">' + fmtPct(s.pnlPct) + '</td>' +
      '<td class="spark">' + spark + '</td>' +
      '<td><button class="btn-icon" data-remove="' + esc(h.id) + '" title="Remove holding">✕</button></td>' +
      '</tr>';
  }).join('');
}

function renderAlerts() {
  const list = $('alert-list');
  $('alerts-empty').classList.toggle('hidden', alerts.length > 0);
  $('alert-count').textContent = alerts.length + ' active';

  list.innerHTML = alerts.map((a, i) => {
    const m = marketById[a.coinId];
    const price = m ? m.current_price : null;
    const triggered = price !== null &&
      ((a.direction === 'above' && price >= a.target) || (a.direction === 'below' && price <= a.target));
    const state = triggered
      ? 'TRIGGERED — now ' + fmtMoney(price)
      : (price !== null ? 'watching · now ' + fmtMoney(price) : 'waiting for price data');
    return '<li class="alert-item' + (triggered ? ' triggered' : '') + '">' +
      '<strong>' + esc(a.symbol.toUpperCase()) + '</strong>' +
      '<span>' + (a.direction === 'above' ? 'rises above' : 'falls below') + '</span>' +
      '<span class="alert-target">' + fmtMoney(a.target) + '</span>' +
      '<span class="grow"></span>' +
      '<span class="alert-state">' + state + '</span>' +
      '<button class="btn-icon" data-alert-remove="' + i + '" title="Delete alert">✕</button>' +
      '</li>';
  }).join('');
}

function renderAlertCoinOptions() {
  const sel = $('alert-coin');
  const prev = sel.value;
  const coins = holdings.length > 0
    ? holdings.map(h => ({ id: h.id, symbol: h.symbol }))
    : coinList.slice(0, 30).map(c => ({ id: c.id, symbol: c.symbol }));
  sel.innerHTML = coins.map(c =>
    '<option value="' + esc(c.id) + '">' + esc(c.symbol.toUpperCase()) + '</option>'
  ).join('');
  if (prev && coins.some(c => c.id === prev)) sel.value = prev;
}

/* ============================================================
   Holdings: add / remove / search
   ============================================================ */
function initAddForm() {
  const searchInput = $('coin-search');
  const results = $('search-results');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (q.length === 0) { results.classList.add('hidden'); return; }
    const matches = coinList
      .filter(c => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q))
      .slice(0, 8);
    if (matches.length === 0) {
      results.innerHTML = '<div class="search-none">No match in the coin list' +
        (dataSource !== 'live' ? ' (limited list while offline)' : '') + '.</div>';
    } else {
      results.innerHTML = matches.map(c =>
        '<div class="search-item" data-id="' + esc(c.id) + '" data-symbol="' + esc(c.symbol) + '" data-name="' + esc(c.name) + '">' +
        '<span class="sym">' + esc(c.symbol.toUpperCase()) + '</span>' +
        '<span class="name">' + esc(c.name) + '</span>' +
        (c.rank ? '<span class="rank">#' + c.rank + '</span>' : '') +
        '</div>'
      ).join('');
    }
    results.classList.remove('hidden');
  });

  results.addEventListener('mousedown', e => {
    const item = e.target.closest('.search-item');
    if (!item) return;
    selectedCoin = { id: item.dataset.id, symbol: item.dataset.symbol, name: item.dataset.name };
    $('selected-coin-id').value = selectedCoin.id;
    $('selected-coin').textContent = selectedCoin.symbol.toUpperCase() + ' — ' + selectedCoin.name;
    $('selected-coin').classList.remove('muted');
    searchInput.value = '';
    results.classList.add('hidden');
    $('amount-input').focus();
  });

  searchInput.addEventListener('blur', () => {
    // mousedown on a result fires before this timeout
    setTimeout(() => results.classList.add('hidden'), 150);
  });

  $('add-form').addEventListener('submit', e => {
    e.preventDefault();
    const amount = parseFloat($('amount-input').value);
    const avgBuy = parseFloat($('avgbuy-input').value);
    if (!selectedCoin) { flashInput(searchInput); return; }
    if (!(amount > 0)) { flashInput($('amount-input')); return; }
    if (!(avgBuy >= 0) || isNaN(avgBuy)) { flashInput($('avgbuy-input')); return; }

    const existing = holdings.find(h => h.id === selectedCoin.id);
    if (existing) {
      // Merge: weighted average buy price.
      const totalCost = existing.avgBuy * existing.amount + avgBuy * amount;
      existing.amount += amount;
      existing.avgBuy = totalCost / existing.amount;
    } else {
      holdings.push({
        id: selectedCoin.id,
        symbol: selectedCoin.symbol,
        name: selectedCoin.name,
        amount: amount,
        avgBuy: avgBuy
      });
    }
    saveHoldings();
    $('amount-input').value = '';
    $('avgbuy-input').value = '';
    selectedCoin = null;
    $('selected-coin').textContent = 'no coin selected';
    $('selected-coin').classList.add('muted');
    renderAll();
    loadMarketData(false); // pull data for the new coin
  });

  $('holdings-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const id = btn.dataset.remove;
    holdings = holdings.filter(h => h.id !== id);
    alerts = alerts.filter(a => a.coinId !== id); // alerts for a removed coin go too
    saveHoldings();
    saveAlerts();
    renderAll();
  });
}

function flashInput(el) {
  el.style.borderColor = 'var(--red)';
  setTimeout(() => { el.style.borderColor = ''; }, 900);
}

/* ============================================================
   Alerts: add / remove
   ============================================================ */
function initAlertForm() {
  $('alert-form').addEventListener('submit', e => {
    e.preventDefault();
    const coinId = $('alert-coin').value;
    const symbol = $('alert-coin').selectedOptions[0]
      ? $('alert-coin').selectedOptions[0].textContent.toLowerCase()
      : coinId;
    const direction = $('alert-direction').value;
    const target = parseFloat($('alert-target').value);
    if (!coinId || !(target > 0)) { flashInput($('alert-target')); return; }
    alerts.push({ coinId, symbol, direction, target });
    saveAlerts();
    $('alert-target').value = '';
    renderAlerts();
  });

  $('alert-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-alert-remove]');
    if (!btn) return;
    alerts.splice(parseInt(btn.dataset.alertRemove, 10), 1);
    saveAlerts();
    renderAlerts();
  });
}

/* ============================================================
   CSV import / export, demo data, clear
   ============================================================ */
function exportCSV() {
  const rows = [['id', 'symbol', 'name', 'amount', 'avg_buy_price']];
  for (const h of holdings) rows.push([h.id, h.symbol, h.name, h.amount, h.avgBuy]);
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'portfolio-holdings.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return 0;
  let imported = 0;

  for (let i = 0; i < lines.length; i++) {
    // naive-but-adequate CSV split (handles quoted commas)
    const cells = lines[i].match(/("([^"]|"")*"|[^,]+)/g) || [];
    const clean = cells.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    if (i === 0 && clean[0] && clean[0].toLowerCase() === 'id') continue; // header

    const [id, symbol, name, amountStr, avgStr] = clean;
    const amount = parseFloat(amountStr);
    const avgBuy = parseFloat(avgStr);
    if (!id || !symbol || !(amount > 0) || !(avgBuy >= 0) || isNaN(avgBuy)) continue;

    const known = coinList.find(c => c.id === id);
    const existing = holdings.find(h => h.id === id);
    if (existing) {
      const totalCost = existing.avgBuy * existing.amount + avgBuy * amount;
      existing.amount += amount;
      existing.avgBuy = totalCost / existing.amount;
    } else {
      holdings.push({
        id: id,
        symbol: symbol.toLowerCase(),
        name: name || (known ? known.name : id),
        amount: amount,
        avgBuy: avgBuy
      });
    }
    imported++;
  }

  if (imported > 0) {
    saveHoldings();
    renderAll();
    loadMarketData(false);
  }
  return imported;
}

function initDataIO() {
  $('export-btn').addEventListener('click', exportCSV);

  $('import-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const n = importCSV(String(reader.result || ''));
      alert(n > 0 ? 'Imported ' + n + ' holding(s).' : 'No valid rows found. Expected: id,symbol,name,amount,avg_buy_price');
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-importing the same file
  });

  $('sample-btn').addEventListener('click', () => {
    holdings = [
      { id: 'bitcoin',  symbol: 'btc', name: 'Bitcoin',  amount: 0.42, avgBuy: 61500 },
      { id: 'ethereum', symbol: 'eth', name: 'Ethereum', amount: 3.1,  avgBuy: 2980 },
      { id: 'solana',   symbol: 'sol', name: 'Solana',   amount: 14,   avgBuy: 165 }
    ];
    alerts = [
      { coinId: 'bitcoin', symbol: 'btc', direction: 'above', target: 100000 },
      { coinId: 'solana', symbol: 'sol', direction: 'below', target: 180 }
    ];
    saveHoldings();
    saveAlerts();
    renderAll();
    loadMarketData(false);
  });

  $('clear-btn').addEventListener('click', () => {
    if (!confirm('Delete all holdings, alerts and cached prices?')) return;
    holdings = [];
    alerts = [];
    marketById = {};
    Store.remove(KEYS.holdings);
    Store.remove(KEYS.alerts);
    Store.remove(CoinData.CACHE_KEY);
    renderAll();
    loadMarketData(false);
  });
}

/* ============================================================
   Keyboard shortcuts
   ============================================================ */
function initKeys() {
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'r' || e.key === 'R') loadMarketData(true);
    if (e.key === 'e' || e.key === 'E') exportCSV();
  });
}

/* ---------- persistence wrappers ---------- */
function saveHoldings() { Store.set(KEYS.holdings, holdings); }
function saveAlerts() { Store.set(KEYS.alerts, alerts); }

/* ---------- boot ---------- */
function init() {
  initAddForm();
  initAlertForm();
  initDataIO();
  initKeys();
  renderAll();          // paint structure immediately
  loadMarketData(false); // then fetch live data (falls back as needed)
}

document.addEventListener('DOMContentLoaded', init);
