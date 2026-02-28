/* ============================================
   TradeVault — Application Logic
   ============================================ */

(function () {
  'use strict';

  // ---- Storage ----
  const STORAGE_KEY = 'tradevault_trades';

  function loadTrades() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveTrades(trades) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  }

  let trades = loadTrades();
  let deleteTargetId = null;

  // ---- DOM refs ----
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const navBtns = $$('.nav-btn');
  const views = $$('.view');

  // Dashboard
  const valTotalPnl   = $('#val-total-pnl');
  const valWinRate     = $('#val-win-rate');
  const valTotalTrades = $('#val-total-trades');
  const valBestTrade   = $('#val-best-trade');
  const valWorstTrade  = $('#val-worst-trade');
  const valAvgPnl      = $('#val-avg-pnl');
  const recentBody     = $('#recent-trades-body');
  const recentTable    = $('#recent-trades-table');
  const dashboardEmpty = $('#dashboard-empty');

  // Journal
  const journalBody    = $('#journal-trades-body');
  const journalTable   = $('#journal-table');
  const journalEmpty   = $('#journal-empty');
  const searchInput    = $('#search-input');
  const filterSide     = $('#filter-side');
  const filterResult   = $('#filter-result');

  // Modal
  const modalOverlay   = $('#modal-overlay');
  const modalTitle     = $('#modal-title');
  const tradeForm      = $('#trade-form');
  const tradeIdInput   = $('#trade-id');
  const tradeSymbol    = $('#trade-symbol');
  const tradeDate      = $('#trade-date');
  const tradeSide      = $('#trade-side');
  const tradeQty       = $('#trade-qty');
  const tradeEntry     = $('#trade-entry');
  const tradeExit      = $('#trade-exit');
  const tradeNotes     = $('#trade-notes');

  // Delete Modal
  const deleteOverlay  = $('#delete-overlay');

  // Toast
  const toastEl        = $('#toast');

  // ---- Utilities ----
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function calcPnl(trade) {
    const diff = trade.side === 'LONG'
      ? trade.exitPrice - trade.entryPrice
      : trade.entryPrice - trade.exitPrice;
    return diff * trade.qty;
  }

  function formatCurrency(val) {
    const sign = val >= 0 ? '+' : '';
    return sign + '$' + Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(d) {
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2500);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Navigation ----
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.view;
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      views.forEach(v => v.classList.remove('active'));
      $(`#view-${target}`).classList.add('active');
    });
  });

  $('#btn-view-all').addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    $('#nav-journal').classList.add('active');
    views.forEach(v => v.classList.remove('active'));
    $('#view-journal').classList.add('active');
  });

  // ---- Stats ----
  function updateStats() {
    if (trades.length === 0) {
      valTotalPnl.textContent = '$0.00';
      valWinRate.textContent = '0%';
      valTotalTrades.textContent = '0';
      valBestTrade.textContent = '$0.00';
      valWorstTrade.textContent = '$0.00';
      valAvgPnl.textContent = '$0.00';
      valTotalPnl.className = 'stat-value';
      valBestTrade.className = 'stat-value';
      valWorstTrade.className = 'stat-value';
      valAvgPnl.className = 'stat-value';
      return;
    }

    const pnls = trades.map(calcPnl);
    const total = pnls.reduce((a, b) => a + b, 0);
    const wins = pnls.filter(p => p > 0).length;
    const best = Math.max(...pnls);
    const worst = Math.min(...pnls);
    const avg = total / pnls.length;

    valTotalPnl.textContent = formatCurrency(total);
    valTotalPnl.className = 'stat-value ' + (total >= 0 ? 'pnl-positive' : 'pnl-negative');

    valWinRate.textContent = Math.round((wins / trades.length) * 100) + '%';
    valTotalTrades.textContent = trades.length;

    valBestTrade.textContent = formatCurrency(best);
    valBestTrade.className = 'stat-value ' + (best >= 0 ? 'pnl-positive' : 'pnl-negative');

    valWorstTrade.textContent = formatCurrency(worst);
    valWorstTrade.className = 'stat-value ' + (worst >= 0 ? 'pnl-positive' : 'pnl-negative');

    valAvgPnl.textContent = formatCurrency(avg);
    valAvgPnl.className = 'stat-value ' + (avg >= 0 ? 'pnl-positive' : 'pnl-negative');
  }

  // ---- Render Trades ----
  function tradeRow(trade, showActions) {
    const pnl = calcPnl(trade);
    const pnlClass = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
    const sideClass = trade.side === 'LONG' ? 'side-badge--long' : 'side-badge--short';

    let actions = '';
    if (showActions) {
      actions = `
        <td>
          <div class="action-btns">
            <button class="btn-icon btn-icon--edit" data-id="${trade.id}" title="Edit">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon btn-icon--delete" data-id="${trade.id}" title="Delete">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </td>`;
    }

    return `
      <tr>
        <td>${formatDate(trade.date)}</td>
        <td><strong>${escapeHtml(trade.symbol.toUpperCase())}</strong></td>
        <td><span class="side-badge ${sideClass}">${trade.side}</span></td>
        <td>$${Number(trade.entryPrice).toFixed(2)}</td>
        <td>$${Number(trade.exitPrice).toFixed(2)}</td>
        <td>${trade.qty}</td>
        <td class="${pnlClass}">${formatCurrency(pnl)}</td>
        <td class="note-cell" title="${escapeHtml(trade.notes || '')}">${escapeHtml(trade.notes || '—')}</td>
        ${actions}
      </tr>`;
  }

  function renderDashboard() {
    const sorted = [...trades].sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = sorted.slice(0, 5);

    if (recent.length === 0) {
      recentTable.classList.add('hidden');
      dashboardEmpty.classList.remove('hidden');
    } else {
      recentTable.classList.remove('hidden');
      dashboardEmpty.classList.add('hidden');
      recentBody.innerHTML = recent.map(t => tradeRow(t, false)).join('');
    }
  }

  function renderJournal() {
    let filtered = [...trades];

    // Search
    const query = searchInput.value.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter(t =>
        t.symbol.toLowerCase().includes(query) ||
        (t.notes && t.notes.toLowerCase().includes(query))
      );
    }

    // Side filter
    const side = filterSide.value;
    if (side !== 'all') {
      filtered = filtered.filter(t => t.side === side);
    }

    // Result filter
    const result = filterResult.value;
    if (result === 'win') {
      filtered = filtered.filter(t => calcPnl(t) > 0);
    } else if (result === 'loss') {
      filtered = filtered.filter(t => calcPnl(t) <= 0);
    }

    // Sort by date descending
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (filtered.length === 0) {
      journalTable.classList.add('hidden');
      journalEmpty.classList.remove('hidden');
    } else {
      journalTable.classList.remove('hidden');
      journalEmpty.classList.add('hidden');
      journalBody.innerHTML = filtered.map(t => tradeRow(t, true)).join('');
      attachJournalActions();
    }
  }

  function attachJournalActions() {
    journalBody.querySelectorAll('.btn-icon--edit').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
    journalBody.querySelectorAll('.btn-icon--delete').forEach(btn => {
      btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
    });
  }

  function refreshAll() {
    updateStats();
    renderDashboard();
    renderJournal();
    saveTrades(trades);
  }

  // ---- Modal ----
  function openModal() {
    modalOverlay.classList.add('open');
    tradeSymbol.focus();
  }

  function closeModal() {
    modalOverlay.classList.remove('open');
    tradeForm.reset();
    tradeIdInput.value = '';
    modalTitle.textContent = 'New Trade';
  }

  function openEditModal(id) {
    const trade = trades.find(t => t.id === id);
    if (!trade) return;

    modalTitle.textContent = 'Edit Trade';
    tradeIdInput.value = trade.id;
    tradeSymbol.value = trade.symbol;
    tradeDate.value = trade.date;
    tradeSide.value = trade.side;
    tradeQty.value = trade.qty;
    tradeEntry.value = trade.entryPrice;
    tradeExit.value = trade.exitPrice;
    tradeNotes.value = trade.notes || '';
    openModal();
  }

  // ---- Delete ----
  function openDeleteModal(id) {
    deleteTargetId = id;
    deleteOverlay.classList.add('open');
  }

  function closeDeleteModal() {
    deleteOverlay.classList.remove('open');
    deleteTargetId = null;
  }

  // ---- Event Listeners ----
  $('#btn-open-modal').addEventListener('click', () => {
    // Pre-fill today's date
    tradeDate.value = new Date().toISOString().split('T')[0];
    openModal();
  });

  $('#btn-close-modal').addEventListener('click', closeModal);
  $('#btn-cancel-modal').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Delete modal
  $('#btn-close-delete').addEventListener('click', closeDeleteModal);
  $('#btn-cancel-delete').addEventListener('click', closeDeleteModal);
  deleteOverlay.addEventListener('click', (e) => {
    if (e.target === deleteOverlay) closeDeleteModal();
  });

  $('#btn-confirm-delete').addEventListener('click', () => {
    if (deleteTargetId) {
      trades = trades.filter(t => t.id !== deleteTargetId);
      closeDeleteModal();
      refreshAll();
      showToast('Trade deleted');
    }
  });

  // Save trade
  tradeForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const tradeData = {
      id: tradeIdInput.value || generateId(),
      symbol: tradeSymbol.value.trim(),
      date: tradeDate.value,
      side: tradeSide.value,
      qty: parseFloat(tradeQty.value),
      entryPrice: parseFloat(tradeEntry.value),
      exitPrice: parseFloat(tradeExit.value),
      notes: tradeNotes.value.trim(),
    };

    const existingIdx = trades.findIndex(t => t.id === tradeData.id);
    if (existingIdx >= 0) {
      trades[existingIdx] = tradeData;
      showToast('Trade updated');
    } else {
      trades.push(tradeData);
      showToast('Trade added');
    }

    closeModal();
    refreshAll();
  });

  // Filters
  searchInput.addEventListener('input', renderJournal);
  filterSide.addEventListener('change', renderJournal);
  filterResult.addEventListener('change', renderJournal);

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (deleteOverlay.classList.contains('open')) closeDeleteModal();
      else if (modalOverlay.classList.contains('open')) closeModal();
    }
  });

  // ---- Init ----
  refreshAll();
})();
