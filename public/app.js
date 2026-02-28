/* ============================================
   TradeVault — Application Logic (MySQL API)
   ============================================ */

(function () {
    'use strict';

    const API = '';

    // ---- Helpers ----
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    async function api(path, opts = {}) {
        const res = await fetch(`${API}${path}`, {
            headers: { 'Content-Type': 'application/json', ...opts.headers },
            ...opts,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || 'Request failed');
        }
        return res.json();
    }

    function formatCurrency(val) {
        const v = parseFloat(val) || 0;
        const sign = v >= 0 ? '+' : '';
        return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDate(d) {
        if (!d) return '—';
        const date = new Date(d + (d.includes('T') ? '' : 'T00:00:00'));
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function showToast(msg) {
        const el = $('#toast');
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
    }

    // ---- State ----
    let allTrades = [];
    let allStrategies = [];
    let deleteTargetId = null;
    let drawerTradeId = null;

    // ---- Navigation ----
    const navBtns = $$('.nav-btn');
    const views = $$('.view');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            views.forEach(v => v.classList.remove('active'));
            $(`#view-${btn.dataset.view}`).classList.add('active');
        });
    });

    $('#btn-view-all').addEventListener('click', () => {
        navBtns.forEach(b => b.classList.remove('active'));
        $('#nav-journal').classList.add('active');
        views.forEach(v => v.classList.remove('active'));
        $('#view-journal').classList.add('active');
    });

    // ---- Stats ----
    async function loadStats() {
        try {
            const s = await api('/api/stats');
            $('#val-total-pnl').textContent = formatCurrency(s.totalPnl);
            $('#val-total-pnl').className = 'stat-value ' + (s.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative');
            $('#val-win-rate').textContent = s.winRate + '%';
            $('#val-total-trades').textContent = s.totalTrades;
            $('#val-best-trade').textContent = formatCurrency(s.bestTrade);
            $('#val-best-trade').className = 'stat-value ' + (s.bestTrade >= 0 ? 'pnl-positive' : 'pnl-negative');
            $('#val-worst-trade').textContent = formatCurrency(s.worstTrade);
            $('#val-worst-trade').className = 'stat-value ' + (s.worstTrade >= 0 ? 'pnl-positive' : 'pnl-negative');
            $('#val-avg-rr').textContent = (s.avgRR || 0).toFixed(2);
        } catch (e) { console.error('Stats error:', e); }
    }

    // ---- Trades ----
    async function loadTrades() {
        try {
            allTrades = await api('/api/trades');
            renderDashboard();
            renderJournal();
        } catch (e) { console.error('Trades error:', e); }
    }

    function tradeRow(t, showActions) {
        const pnl = parseFloat(t.pnl) || 0;
        const pnlClass = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
        const dirClass = t.direction === 'BUY' ? 'side-badge--buy' : 'side-badge--sell';
        const resultBadge = t.result
            ? `<span class="result-badge result-badge--${t.result}">${t.result}</span>`
            : '—';

        let actions = '';
        if (showActions) {
            actions = `<td><div class="action-btns">
        <button class="btn-icon btn-icon--detail" data-id="${t.trade_id}" title="Details">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
        <button class="btn-icon btn-icon--edit" data-id="${t.trade_id}" title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon btn-icon--delete" data-id="${t.trade_id}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div></td>`;
        }

        const cols = showActions
            ? `<td>${formatDate(t.trade_date)}</td>
         <td><strong>${escapeHtml(t.symbol)}</strong></td>
         <td>${escapeHtml(t.asset_class || '')}</td>
         <td><span class="side-badge ${dirClass}">${t.direction}</span></td>
         <td>$${Number(t.entry_price).toFixed(2)}</td>
         <td>${t.exit_price != null ? '$' + Number(t.exit_price).toFixed(2) : '—'}</td>
         <td>${t.position_size}</td>
         <td>${t.stop_loss != null ? '$' + Number(t.stop_loss).toFixed(2) : '—'}</td>
         <td>${t.take_profit != null ? '$' + Number(t.take_profit).toFixed(2) : '—'}</td>
         <td class="${pnlClass}">${formatCurrency(pnl)}</td>
         <td>${resultBadge}</td>
         <td>${t.rr_ratio != null ? t.rr_ratio : '—'}</td>
         <td class="note-cell">${escapeHtml(t.strategy_name || '—')}</td>
         ${actions}`
            : `<td>${formatDate(t.trade_date)}</td>
         <td><strong>${escapeHtml(t.symbol)}</strong></td>
         <td><span class="side-badge ${dirClass}">${t.direction}</span></td>
         <td>$${Number(t.entry_price).toFixed(2)}</td>
         <td>${t.exit_price != null ? '$' + Number(t.exit_price).toFixed(2) : '—'}</td>
         <td>${t.position_size}</td>
         <td class="${pnlClass}">${formatCurrency(pnl)}</td>
         <td>${resultBadge}</td>
         <td>${t.rr_ratio != null ? t.rr_ratio : '—'}</td>`;

        return `<tr>${cols}</tr>`;
    }

    function renderDashboard() {
        const recent = allTrades.slice(0, 5);
        const table = $('#recent-trades-table');
        const empty = $('#dashboard-empty');
        if (recent.length === 0) {
            table.classList.add('hidden');
            empty.classList.remove('hidden');
        } else {
            table.classList.remove('hidden');
            empty.classList.add('hidden');
            $('#recent-trades-body').innerHTML = recent.map(t => tradeRow(t, false)).join('');
        }
    }

    function renderJournal() {
        let filtered = [...allTrades];

        const query = ($('#search-input').value || '').trim().toLowerCase();
        if (query) {
            filtered = filtered.filter(t =>
                t.symbol.toLowerCase().includes(query) ||
                (t.notes && t.notes.toLowerCase().includes(query))
            );
        }

        const dir = $('#filter-direction').value;
        if (dir !== 'all') filtered = filtered.filter(t => t.direction === dir);

        const res = $('#filter-result').value;
        if (res !== 'all') filtered = filtered.filter(t => t.result === res);

        const strat = $('#filter-strategy').value;
        if (strat !== 'all') filtered = filtered.filter(t => String(t.strategy_id) === strat);

        const table = $('#journal-table');
        const empty = $('#journal-empty');
        if (filtered.length === 0) {
            table.classList.add('hidden');
            empty.classList.remove('hidden');
        } else {
            table.classList.remove('hidden');
            empty.classList.add('hidden');
            $('#journal-trades-body').innerHTML = filtered.map(t => tradeRow(t, true)).join('');
            attachJournalActions();
        }
    }

    function attachJournalActions() {
        $$('#journal-trades-body .btn-icon--edit').forEach(b =>
            b.addEventListener('click', () => openEditModal(b.dataset.id))
        );
        $$('#journal-trades-body .btn-icon--delete').forEach(b =>
            b.addEventListener('click', () => openDeleteModal(b.dataset.id))
        );
        $$('#journal-trades-body .btn-icon--detail').forEach(b =>
            b.addEventListener('click', () => openDrawer(b.dataset.id))
        );
    }

    // ---- Strategies ----
    async function loadStrategies() {
        try {
            allStrategies = await api('/api/strategies');
            renderStrategies();
            populateStrategyDropdowns();
        } catch (e) { console.error('Strategies error:', e); }
    }

    function renderStrategies() {
        const grid = $('#strategies-grid');
        const empty = $('#strategies-empty');
        if (allStrategies.length === 0) {
            grid.innerHTML = '';
            grid.appendChild(empty);
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');
        grid.innerHTML = allStrategies.map(s => `
      <div class="strategy-card">
        <div class="strategy-card-header">
          <h3>${escapeHtml(s.strategy_name)}</h3>
          <div class="action-btns">
            <button class="btn-icon btn-icon--edit" data-sid="${s.strategy_id}" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon btn-icon--delete" data-sid="${s.strategy_id}" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>
        <div class="strategy-meta">
          ${s.timeframe ? `<span>⏱ <span class="meta-value">${s.timeframe}</span></span>` : ''}
          <span>📊 Risk <span class="meta-value">${s.risk_per_trade}%</span></span>
        </div>
        ${s.description ? `<p class="strategy-desc">${escapeHtml(s.description)}</p>` : ''}
      </div>
    `).join('');

        // Attach edit/delete
        grid.querySelectorAll('.btn-icon--edit[data-sid]').forEach(b =>
            b.addEventListener('click', () => openEditStrategy(b.dataset.sid))
        );
        grid.querySelectorAll('.btn-icon--delete[data-sid]').forEach(b =>
            b.addEventListener('click', async () => {
                if (confirm('Delete this strategy?')) {
                    await api(`/api/strategies/${b.dataset.sid}`, { method: 'DELETE' });
                    showToast('Strategy deleted');
                    await loadStrategies();
                }
            })
        );
    }

    function populateStrategyDropdowns() {
        const opts = allStrategies.map(s =>
            `<option value="${s.strategy_id}">${escapeHtml(s.strategy_name)}</option>`
        ).join('');
        $('#trade-strategy').innerHTML = `<option value="">— None —</option>${opts}`;
        $('#filter-strategy').innerHTML = `<option value="all">All Strategies</option>${opts}`;
    }

    // ---- Trade Modal ----
    const tradeForm = $('#trade-form');
    const modalOverlay = $('#modal-overlay');

    function openModal() {
        modalOverlay.classList.add('open');
        $('#trade-symbol').focus();
    }

    function closeModal() {
        modalOverlay.classList.remove('open');
        tradeForm.reset();
        $('#trade-id').value = '';
        $('#trade-confidence').value = '';
        $$('#confidence-stars .star').forEach(s => s.classList.remove('active'));
        $('#modal-title').textContent = 'New Trade';
    }

    async function openEditModal(id) {
        try {
            const t = await api(`/api/trades/${id}`);
            $('#modal-title').textContent = 'Edit Trade';
            $('#trade-id').value = t.trade_id;
            $('#trade-symbol').value = t.symbol;
            $('#trade-date').value = t.trade_date ? t.trade_date.split('T')[0] : '';
            $('#trade-asset-class').value = t.asset_class || 'stock';
            $('#trade-direction').value = t.direction;
            $('#trade-strategy').value = t.strategy_id || '';
            $('#trade-entry').value = t.entry_price;
            $('#trade-exit').value = t.exit_price || '';
            $('#trade-sl').value = t.stop_loss || '';
            $('#trade-tp').value = t.take_profit || '';
            $('#trade-size').value = t.position_size;
            $('#trade-rr').value = t.rr_ratio || '';
            $('#trade-notes').value = t.notes || '';
            setConfidence(t.confidence_rating || 0);
            openModal();
        } catch (e) { showToast('Error loading trade'); }
    }

    // Confidence stars
    function setConfidence(val) {
        $('#trade-confidence').value = val || '';
        $$('#confidence-stars .star').forEach(s => {
            s.classList.toggle('active', parseInt(s.dataset.val) <= val);
        });
    }

    $$('#confidence-stars .star').forEach(star => {
        star.addEventListener('click', () => setConfidence(parseInt(star.dataset.val)));
    });

    // Save trade
    tradeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('#trade-id').value;
        const body = {
            symbol: $('#trade-symbol').value.trim().toUpperCase(),
            trade_date: $('#trade-date').value,
            asset_class: $('#trade-asset-class').value,
            direction: $('#trade-direction').value,
            strategy_id: $('#trade-strategy').value || null,
            entry_price: parseFloat($('#trade-entry').value),
            exit_price: $('#trade-exit').value ? parseFloat($('#trade-exit').value) : null,
            stop_loss: $('#trade-sl').value ? parseFloat($('#trade-sl').value) : null,
            take_profit: $('#trade-tp').value ? parseFloat($('#trade-tp').value) : null,
            position_size: parseFloat($('#trade-size').value),
            rr_ratio: $('#trade-rr').value ? parseFloat($('#trade-rr').value) : null,
            confidence_rating: $('#trade-confidence').value ? parseInt($('#trade-confidence').value) : null,
            notes: $('#trade-notes').value.trim(),
        };

        try {
            if (id) {
                await api(`/api/trades/${id}`, { method: 'PUT', body: JSON.stringify(body) });
                showToast('Trade updated');
            } else {
                await api('/api/trades', { method: 'POST', body: JSON.stringify(body) });
                showToast('Trade added');
            }
            closeModal();
            await Promise.all([loadTrades(), loadStats()]);
        } catch (e) { showToast('Error: ' + e.message); }
    });

    // Open modal
    $('#btn-open-modal').addEventListener('click', () => {
        $('#trade-date').value = new Date().toISOString().split('T')[0];
        openModal();
    });
    $('#btn-close-modal').addEventListener('click', closeModal);
    $('#btn-cancel-modal').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

    // ---- Delete Modal ----
    const deleteOverlay = $('#delete-overlay');

    function openDeleteModal(id) { deleteTargetId = id; deleteOverlay.classList.add('open'); }
    function closeDeleteModal() { deleteOverlay.classList.remove('open'); deleteTargetId = null; }

    $('#btn-close-delete').addEventListener('click', closeDeleteModal);
    $('#btn-cancel-delete').addEventListener('click', closeDeleteModal);
    deleteOverlay.addEventListener('click', (e) => { if (e.target === deleteOverlay) closeDeleteModal(); });

    $('#btn-confirm-delete').addEventListener('click', async () => {
        if (!deleteTargetId) return;
        try {
            await api(`/api/trades/${deleteTargetId}`, { method: 'DELETE' });
            showToast('Trade deleted');
            closeDeleteModal();
            await Promise.all([loadTrades(), loadStats()]);
        } catch (e) { showToast('Error: ' + e.message); }
    });

    // ---- Strategy Modal ----
    const strategyOverlay = $('#strategy-modal-overlay');
    const strategyForm = $('#strategy-form');

    function openStrategyModal() {
        strategyOverlay.classList.add('open');
        $('#strategy-name').focus();
    }

    function closeStrategyModal() {
        strategyOverlay.classList.remove('open');
        strategyForm.reset();
        $('#strategy-id').value = '';
        $('#strategy-modal-title').textContent = 'New Strategy';
    }

    function openEditStrategy(sid) {
        const s = allStrategies.find(x => String(x.strategy_id) === String(sid));
        if (!s) return;
        $('#strategy-modal-title').textContent = 'Edit Strategy';
        $('#strategy-id').value = s.strategy_id;
        $('#strategy-name').value = s.strategy_name;
        $('#strategy-timeframe').value = s.timeframe || '';
        $('#strategy-description').value = s.description || '';
        $('#strategy-risk').value = s.risk_per_trade;
        openStrategyModal();
    }

    $('#btn-open-strategy-modal').addEventListener('click', openStrategyModal);
    $('#btn-close-strategy-modal').addEventListener('click', closeStrategyModal);
    $('#btn-cancel-strategy').addEventListener('click', closeStrategyModal);
    strategyOverlay.addEventListener('click', (e) => { if (e.target === strategyOverlay) closeStrategyModal(); });

    strategyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('#strategy-id').value;
        const body = {
            strategy_name: $('#strategy-name').value.trim(),
            timeframe: $('#strategy-timeframe').value || null,
            description: $('#strategy-description').value.trim() || null,
            risk_per_trade: parseFloat($('#strategy-risk').value) || 1.0,
        };
        try {
            if (id) {
                await api(`/api/strategies/${id}`, { method: 'PUT', body: JSON.stringify(body) });
                showToast('Strategy updated');
            } else {
                await api('/api/strategies', { method: 'POST', body: JSON.stringify(body) });
                showToast('Strategy created');
            }
            closeStrategyModal();
            await loadStrategies();
        } catch (e) { showToast('Error: ' + e.message); }
    });

    // ---- Trade Detail Drawer ----
    const drawerOverlay = $('#drawer-overlay');

    function openDrawer(tradeId) {
        drawerTradeId = tradeId;
        const trade = allTrades.find(t => String(t.trade_id) === String(tradeId));
        $('#drawer-title').textContent = trade ? `${trade.symbol} — ${formatDate(trade.trade_date)}` : 'Trade Details';
        drawerOverlay.classList.add('open');
        // Reset to first tab
        $$('.drawer-tab').forEach(t => t.classList.remove('active'));
        $$('.drawer-pane').forEach(p => p.classList.remove('active'));
        $$('.drawer-tab')[0].classList.add('active');
        $$('.drawer-pane')[0].classList.add('active');
        loadConditions(tradeId);
        loadExecutions(tradeId);
        loadScreenshots(tradeId);
    }

    function closeDrawer() { drawerOverlay.classList.remove('open'); drawerTradeId = null; }

    $('#btn-close-drawer').addEventListener('click', closeDrawer);
    drawerOverlay.addEventListener('click', (e) => { if (e.target === drawerOverlay) closeDrawer(); });

    // Drawer tabs
    $$('.drawer-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('.drawer-tab').forEach(t => t.classList.remove('active'));
            $$('.drawer-pane').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            $(`#pane-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // ---- Market Conditions ----
    async function loadConditions(tradeId) {
        try {
            const c = await api(`/api/trades/${tradeId}/conditions`);
            if (c) {
                $('#cond-trend').value = c.trend || 'range';
                $('#cond-session').value = c.session || 'Other';
                $('#cond-vix').value = c.volatility_index || '';
                $('#cond-news').value = c.news_event ? '1' : '0';
            } else {
                $('#conditions-form').reset();
            }
        } catch (e) { console.error(e); }
    }

    $('#conditions-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!drawerTradeId) return;
        const body = {
            trend: $('#cond-trend').value,
            session: $('#cond-session').value,
            volatility_index: $('#cond-vix').value ? parseFloat($('#cond-vix').value) : null,
            news_event: $('#cond-news').value === '1',
        };
        try {
            await api(`/api/trades/${drawerTradeId}/conditions`, { method: 'PUT', body: JSON.stringify(body) });
            showToast('Market conditions saved');
        } catch (e) { showToast('Error: ' + e.message); }
    });

    // ---- Execution Log ----
    async function loadExecutions(tradeId) {
        try {
            const execs = await api(`/api/trades/${tradeId}/executions`);
            const table = $('#exec-table');
            const empty = $('#exec-empty');
            if (execs.length === 0) {
                table.classList.add('hidden');
                empty.classList.remove('hidden');
            } else {
                table.classList.remove('hidden');
                empty.classList.add('hidden');
                $('#exec-body').innerHTML = execs.map(ex => `
          <tr>
            <td>${new Date(ex.execution_time).toLocaleString()}</td>
            <td>$${Number(ex.execution_price).toFixed(2)}</td>
            <td>${ex.quantity}</td>
            <td>
              <button class="btn-icon btn-icon--delete" data-eid="${ex.execution_id}" title="Delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </td>
          </tr>
        `).join('');
                $$('#exec-body .btn-icon--delete').forEach(b =>
                    b.addEventListener('click', async () => {
                        await api(`/api/executions/${b.dataset.eid}`, { method: 'DELETE' });
                        loadExecutions(tradeId);
                        showToast('Execution removed');
                    })
                );
            }
        } catch (e) { console.error(e); }
    }

    $('#execution-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!drawerTradeId) return;
        const body = {
            execution_time: $('#exec-time').value,
            execution_price: parseFloat($('#exec-price').value),
            quantity: parseFloat($('#exec-qty').value),
        };
        try {
            await api(`/api/trades/${drawerTradeId}/executions`, { method: 'POST', body: JSON.stringify(body) });
            $('#execution-form').reset();
            loadExecutions(drawerTradeId);
            showToast('Execution logged');
        } catch (e) { showToast('Error: ' + e.message); }
    });

    // ---- Screenshots ----
    async function loadScreenshots(tradeId) {
        try {
            const shots = await api(`/api/trades/${tradeId}/screenshots`);
            const gallery = $('#screenshots-gallery');
            const empty = $('#screenshots-empty');
            if (shots.length === 0) {
                gallery.innerHTML = '';
                empty.classList.remove('hidden');
            } else {
                empty.classList.add('hidden');
                gallery.innerHTML = shots.map(s => `
          <div class="screenshot-thumb">
            <img src="${s.image_path}" alt="Screenshot" loading="lazy">
            <button class="delete-badge" data-ssid="${s.screenshot_id}" title="Delete">✕</button>
          </div>
        `).join('');
                gallery.querySelectorAll('.delete-badge').forEach(b =>
                    b.addEventListener('click', async () => {
                        await api(`/api/screenshots/${b.dataset.ssid}`, { method: 'DELETE' });
                        loadScreenshots(tradeId);
                        showToast('Screenshot deleted');
                    })
                );
            }
        } catch (e) { console.error(e); }
    }

    $('#screenshot-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!drawerTradeId) return;
        const file = $('#screenshot-file').files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('image', file);
        try {
            await fetch(`/api/trades/${drawerTradeId}/screenshots`, { method: 'POST', body: formData });
            $('#screenshot-form').reset();
            loadScreenshots(drawerTradeId);
            showToast('Screenshot uploaded');
        } catch (e) { showToast('Upload failed'); }
    });

    // ---- Filters ----
    $('#search-input').addEventListener('input', renderJournal);
    $('#filter-direction').addEventListener('change', renderJournal);
    $('#filter-result').addEventListener('change', renderJournal);
    $('#filter-strategy').addEventListener('change', renderJournal);

    // ---- Keyboard ----
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (drawerOverlay.classList.contains('open')) closeDrawer();
            else if (deleteOverlay.classList.contains('open')) closeDeleteModal();
            else if (strategyOverlay.classList.contains('open')) closeStrategyModal();
            else if (modalOverlay.classList.contains('open')) closeModal();
        }
    });

    // ---- Init ----
    async function init() {
        await loadStrategies();
        await loadTrades();
        await loadStats();
    }

    init();
})();
