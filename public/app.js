/* ============================================
   TradeVault — Application Logic (MySQL API)
   ============================================ */

(function () {
    'use strict';

    const API = '';

    // ---- Auth Guard ----
    const token = localStorage.getItem('tv_token');
    if (!token && !window.location.pathname.includes('login')) {
        window.location.href = '/login';
        return;
    }

    function getAuthHeaders() {
        const t = localStorage.getItem('tv_token');
        return t ? { Authorization: `Bearer ${t}` } : {};
    }

    function logout() {
        localStorage.removeItem('tv_token');
        localStorage.removeItem('tv_user');
        window.location.href = '/login';
    }

    // ---- Helpers ----
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    async function api(path, opts = {}) {
        const res = await fetch(`${API}${path}`, {
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...opts.headers },
            ...opts,
        });
        if (res.status === 401) {
            logout();
            throw new Error('Session expired');
        }
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
    const sidebar = $('#sidebar');
    const sidebarOverlay = $('#sidebar-overlay');
    const sidebarToggle = $('#sidebar-toggle');

    function openSidebar() {
        sidebar.classList.add('open');
        sidebarOverlay.classList.add('open');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('open');
    }

    sidebarToggle.addEventListener('click', () => {
        if (sidebar.classList.contains('open')) closeSidebar();
        else openSidebar();
    });

    sidebarOverlay.addEventListener('click', closeSidebar);

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            views.forEach(v => v.classList.remove('active'));
            $(`#view-${btn.dataset.view}`).classList.add('active');
            closeSidebar();
        });
    });

    $('#btn-view-all').addEventListener('click', () => {
        navBtns.forEach(b => b.classList.remove('active'));
        $('#nav-journal').classList.add('active');
        views.forEach(v => v.classList.remove('active'));
        $('#view-journal').classList.add('active');
        closeSidebar();
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
            await fetch(`/api/trades/${drawerTradeId}/screenshots`, {
                method: 'POST',
                body: formData,
                headers: getAuthHeaders(),
            });
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

    // ---- TradingView Chart ----
    let chartLoaded = false;

    function loadTradingViewChart(symbol) {
        const container = $('#tradingview-widget');
        const sym = (symbol || 'AAPL').toUpperCase().trim();
        container.innerHTML = '';

        const widgetHTML = `
            <iframe
                src="https://s.tradingview.com/widgetembed/?hideideas=1&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&locale=en#%7B%22symbol%22%3A%22${sym}%22%2C%22frameElementId%22%3A%22tradingview_widget%22%2C%22interval%22%3A%22D%22%2C%22hide_side_toolbar%22%3A%220%22%2C%22allow_symbol_change%22%3A%221%22%2C%22save_image%22%3A%221%22%2C%22studies%22%3A%5B%5D%2C%22theme%22%3A%22dark%22%2C%22style%22%3A%221%22%2C%22timezone%22%3A%22Etc%2FUTC%22%2C%22withdateranges%22%3A%221%22%2C%22studies_overrides%22%3A%7B%7D%2C%22utm_source%22%3A%22localhost%22%2C%22utm_medium%22%3A%22widget_new%22%2C%22utm_campaign%22%3A%22chart%22%2C%22page-uri%22%3A%22localhost%22%7D"
                style="width:100%;height:100%;" frameborder="0" allowtransparency="true" scrolling="no" allowfullscreen>
            </iframe>`;
        container.innerHTML = widgetHTML;
        chartLoaded = true;
    }

    $('#btn-load-chart').addEventListener('click', () => {
        const sym = $('#chart-symbol-input').value.trim();
        if (sym) loadTradingViewChart(sym);
    });

    $('#chart-symbol-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const sym = $('#chart-symbol-input').value.trim();
            if (sym) loadTradingViewChart(sym);
        }
    });

    // Load chart when Charts tab is first activated
    const origNavHandler = navBtns.forEach.bind(navBtns);
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.view === 'charts' && !chartLoaded) {
                loadTradingViewChart($('#chart-symbol-input').value || 'AAPL');
            }
            if (btn.dataset.view === 'ai') {
                loadSuggestions();
                loadQuantStrategies();
            }
            if (btn.dataset.view === 'rl-model') {
                loadRLBacktest();
            }
        });
    });

    // ---- WebSocket Live Signals ----
    let ws = null;
    let lastPrice = 0;
    const signalFeed = [];
    const STRATEGY_LABELS = {
        sma_crossover: 'SMA Crossover (10/30)',
        rsi: 'RSI (14)',
        breakout: 'Breakout (20)',
        hft_momentum: 'HFT Momentum',
        linear_regression: 'Linear Regression (Jim Simons)',
    };

    function connectWebSocket() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${location.host}/ws`);

        ws.onopen = () => {
            $('#ws-status .status-dot').className = 'status-dot connected';
            $('#ws-status-text').textContent = 'Connected';
        };

        ws.onclose = () => {
            $('#ws-status .status-dot').className = 'status-dot disconnected';
            $('#ws-status-text').textContent = 'Disconnected';
            // Auto-reconnect
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = () => {
            console.error('WebSocket error');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWSMessage(data);
            } catch (e) { /* ignore */ }
        };
    }

    function handleWSMessage(data) {
        switch (data.type) {
            case 'price':
                updateLivePrice(data);
                break;
            case 'signal':
                addSignalCard(data);
                break;
            case 'subscribed':
                showToast(`Subscribed to ${data.symbol} live feed`);
                break;
            case 'unsubscribed':
                showToast(`Unsubscribed from ${data.symbol}`);
                $('#live-sym').textContent = '—';
                $('#live-price').textContent = '—';
                $('#live-price').className = 'live-price';
                $('#live-range').textContent = '';
                break;
        }
    }

    function updateLivePrice(data) {
        const priceEl = $('#live-price');
        const newPrice = parseFloat(data.price);

        $('#live-sym').textContent = data.symbol;
        priceEl.textContent = '$' + newPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        if (lastPrice > 0) {
            priceEl.className = 'live-price ' + (newPrice >= lastPrice ? 'up' : 'down');
        }
        lastPrice = newPrice;

        if (data.high && data.low) {
            $('#live-range').textContent = `H: $${parseFloat(data.high).toFixed(2)} · L: $${parseFloat(data.low).toFixed(2)}`;
        }
    }

    function addSignalCard(data) {
        signalFeed.unshift(data);
        if (signalFeed.length > 50) signalFeed.pop();
        renderSignalFeed();
    }

    function renderSignalFeed() {
        const feed = $('#signal-feed');
        if (signalFeed.length === 0) {
            feed.innerHTML = '<div class="signal-empty">Subscribe to a symbol to see live signals.</div>';
            return;
        }

        feed.innerHTML = signalFeed.map(s => {
            const strengthPct = Math.round(s.strength || 0);
            const strengthClass = strengthPct > 40 ? 'strong' : 'weak';
            const timeStr = new Date(s.time).toLocaleTimeString();
            const stratLabel = STRATEGY_LABELS[s.strategy] || s.strategy;

            return `
          <div class="signal-card ${s.action}">
            <span class="signal-action ${s.action}">${s.action}</span>
            <div class="signal-info">
              <div class="signal-strategy">${stratLabel} · ${s.symbol}</div>
              <div class="signal-reason">${escapeHtml(s.reason)}</div>
            </div>
            <div class="signal-strength">
              <div class="signal-strength-fill ${strengthClass}" style="width:${Math.max(strengthPct, 5)}%"></div>
            </div>
            <span class="signal-time">${timeStr}</span>
          </div>`;
        }).join('');
    }

    // Subscribe/unsubscribe buttons
    $('#btn-subscribe').addEventListener('click', () => {
        const sym = $('#signal-symbol-input').value.trim().toUpperCase();
        if (!sym) return showToast('Enter a symbol');
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
            signalFeed.length = 0;
            renderSignalFeed();
        } else {
            showToast('WebSocket not connected');
        }
    });

    $('#btn-unsubscribe').addEventListener('click', () => {
        const sym = $('#signal-symbol-input').value.trim().toUpperCase();
        if (!sym) return;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'unsubscribe', symbol: sym }));
            signalFeed.length = 0;
            renderSignalFeed();
        }
    });

    $('#signal-symbol-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            $('#btn-subscribe').click();
        }
    });

    // Auto-connect WebSocket
    connectWebSocket();

    // ---- AI Suggestions ----
    async function loadSuggestions() {
        try {
            const data = await api('/api/suggestions');
            const msgEl = $('#ai-message');
            const sectionsEl = $('#ai-sections');

            if (data.message) {
                msgEl.textContent = data.message;
                msgEl.classList.remove('hidden');
                sectionsEl.style.display = 'none';
                return;
            }

            msgEl.classList.add('hidden');
            sectionsEl.style.display = '';

            renderSuggestionCards('#suggestions-favorable', data.suggestions || [], 'favorable');
            renderSuggestionCards('#suggestions-avoid', data.avoid || [], 'avoid');
            renderSuggestionCards('#suggestions-neutral', data.neutral || [], 'neutral');
        } catch (e) {
            console.error('AI suggestions error:', e);
            const msgEl = $('#ai-message');
            msgEl.textContent = 'Failed to load suggestions. Make sure you have completed trades with market conditions.';
            msgEl.classList.remove('hidden');
        }
    }

    function renderSuggestionCards(selector, items, type) {
        const container = $(selector);
        if (items.length === 0) {
            container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem 0;">No ${type} setups found yet.</p>`;
            return;
        }

        const barClass = type === 'favorable' ? 'good' : type === 'avoid' ? 'bad' : 'meh';

        container.innerHTML = items.map(s => `
            <div class="suggestion-card ${type}">
                <div class="suggestion-desc">${escapeHtml(s.description)}</div>
                <div class="suggestion-tags">
                    <span class="suggestion-tag">${s.direction}</span>
                    <span class="suggestion-tag">${s.asset}</span>
                    <span class="suggestion-tag">${s.trend}</span>
                    <span class="suggestion-tag">${s.session}</span>
                    ${s.confidence !== 'none' ? `<span class="suggestion-tag">Conf: ${s.confidence}</span>` : ''}
                </div>
                <div class="suggestion-score">
                    <span>Score: ${s.score}%</span>
                    <div class="score-bar">
                        <div class="score-bar-fill ${barClass}" style="width: ${Math.max(s.score, 5)}%"></div>
                    </div>
                    <span>Q: ${s.qValue}</span>
                </div>
            </div>
        `).join('');
    }

    $('#btn-refresh-ai').addEventListener('click', () => {
        loadSuggestions();
        loadQuantStrategies();
    });

    // ---- Quant Strategies Library ----
    let quantCache = [];

    async function loadQuantStrategies(category) {
        try {
            const cat = category || 'all';
            const data = await api(`/api/quant-strategies?category=${encodeURIComponent(cat)}`);
            quantCache = data;
            renderQuantCards(data);
        } catch (e) { console.error('Quant strategies error:', e); }
    }

    function renderQuantCards(strategies) {
        const grid = $('#quant-grid');
        if (strategies.length === 0) {
            grid.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">No strategies in this category.</p>';
            return;
        }

        grid.innerHTML = strategies.map(s => `
            <div class="quant-card" data-qid="${s.id}">
                <div class="quant-card-header">
                    <h3>${escapeHtml(s.name)}</h3>
                    <div class="quant-badges">
                        <span class="cat-badge">${escapeHtml(s.category)}</span>
                        <span class="diff-badge diff-badge--${s.difficulty}">${s.difficulty}</span>
                    </div>
                </div>
                <p class="quant-card-desc">${escapeHtml(s.description)}</p>
                <div class="quant-source">📄 ${escapeHtml(s.source)}</div>
                <button class="quant-rules-toggle" data-qid="${s.id}">▸ Show Trading Rules (${s.rules.length} steps)</button>
                <ol class="quant-rules" id="rules-${s.id}">
                    ${s.rules.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
                </ol>
                <div class="quant-meta">
                    <span>📊 Assets: <span class="meta-value">${s.assets.join(', ')}</span></span>
                    <span>⏱ <span class="meta-value">${s.timeframe}</span></span>
                </div>
                <p class="quant-backtest">📈 ${escapeHtml(s.backtest_note)}</p>
                <div class="quant-card-actions">
                    <button class="btn-implement" data-qid="${s.id}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Implement Strategy
                    </button>
                </div>
            </div>
        `).join('');

        // Toggle rules
        grid.querySelectorAll('.quant-rules-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const rules = $(`#rules-${btn.dataset.qid}`);
                const open = rules.classList.toggle('open');
                btn.textContent = open
                    ? `▾ Hide Trading Rules`
                    : `▸ Show Trading Rules (${rules.children.length} steps)`;
            });
        });

        // Implement button → create strategy
        grid.querySelectorAll('.btn-implement').forEach(btn => {
            btn.addEventListener('click', async () => {
                const s = quantCache.find(x => x.id === btn.dataset.qid);
                if (!s) return;
                const body = {
                    strategy_name: s.name,
                    timeframe: s.timeframe,
                    description: `[${s.category}] ${s.description}\n\nSource: ${s.source}\n\nRules:\n${s.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nBacktest: ${s.backtest_note}`,
                    risk_per_trade: 1.0,
                };
                try {
                    await api('/api/strategies', { method: 'POST', body: JSON.stringify(body) });
                    showToast(`"${s.name}" added to your strategies!`);
                    await loadStrategies();
                    btn.textContent = '✓ Added';
                    btn.disabled = true;
                    btn.style.opacity = '0.6';
                } catch (e) { showToast('Error: ' + e.message); }
            });
        });
    }

    // Category filter tabs
    $$('.quant-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('.quant-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            loadQuantStrategies(tab.dataset.cat);
        });
    });

    // ---- Keyboard ----
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (sidebar.classList.contains('open')) closeSidebar();
            else if (drawerOverlay.classList.contains('open')) closeDrawer();
            else if (deleteOverlay.classList.contains('open')) closeDeleteModal();
            else if (strategyOverlay.classList.contains('open')) closeStrategyModal();
            else if (modalOverlay.classList.contains('open')) closeModal();
        }
    });

    // ---- RL Model Backtest ----
    let rlChart = null;
    let rlData = null;

    async function loadRLBacktest() {
        try {
            const data = await api('/api/rl-backtest');
            rlData = data;
            renderRLStats(data);
            renderRLYearlyTable(data);
            renderRLEquityChart(data, 'dqn');
        } catch (e) {
            console.error('RL backtest error:', e);
            $('#rl-total-return').textContent = '—';
            $('#rl-win-rate').textContent = '—';
            $('#rl-sharpe').textContent = '—';
            $('#rl-max-dd').textContent = '—';
        }
    }

    function renderRLStats(data) {
        if (!data || !data.summary) return;
        const s = data.summary;
        const retEl = $('#rl-total-return');
        retEl.textContent = (s.total_return >= 0 ? '+' : '') + s.total_return.toFixed(1) + '%';
        retEl.className = 'stat-value ' + (s.total_return >= 0 ? 'pnl-positive' : 'pnl-negative');
        $('#rl-win-rate').textContent = s.win_rate.toFixed(1) + '%';
        $('#rl-sharpe').textContent = s.sharpe_ratio.toFixed(2);
        const ddEl = $('#rl-max-dd');
        ddEl.textContent = s.max_drawdown.toFixed(1) + '%';
        ddEl.className = 'stat-value pnl-negative';
    }

    function renderRLYearlyTable(data) {
        if (!data || !data.yearly) return;
        const body = $('#rl-yearly-body');
        body.innerHTML = data.yearly.map(y => {
            const retClass = y.return_pct >= 0 ? 'pnl-positive' : 'pnl-negative';
            return `<tr>
                <td><strong>${y.year}</strong></td>
                <td>${escapeHtml(y.strategy)}</td>
                <td class="${retClass}">${y.return_pct >= 0 ? '+' : ''}${y.return_pct.toFixed(1)}%</td>
                <td>${y.trades}</td>
                <td>${y.win_rate.toFixed(1)}%</td>
                <td>${y.sharpe.toFixed(2)}</td>
                <td class="pnl-negative">${y.max_dd.toFixed(1)}%</td>
                <td>${y.profit_factor.toFixed(2)}</td>
            </tr>`;
        }).join('');
    }

    function renderRLEquityChart(data, stratKey) {
        if (!data || !data.equity_curves || !data.equity_curves[stratKey]) return;
        const curve = data.equity_curves[stratKey];
        const ctx = $('#rl-equity-chart').getContext('2d');

        if (rlChart) rlChart.destroy();

        const colors = {
            dqn: { border: '#6366f1', bg: 'rgba(99, 102, 241, 0.1)' },
            hft: { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)' },
            linreg: { border: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)' },
        };
        const c = colors[stratKey] || colors.dqn;

        rlChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: curve.dates,
                datasets: [{
                    label: stratKey === 'dqn' ? 'DQN Agent' : stratKey === 'hft' ? 'HFT Momentum' : 'Jim Simons LR',
                    data: curve.values,
                    borderColor: c.border,
                    backgroundColor: c.bg,
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 0,
                    tension: 0.3,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, labels: { color: '#94a3b8', font: { family: 'Inter' } } },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                    },
                },
                scales: {
                    x: {
                        ticks: { color: '#64748b', maxTicksLimit: 12, font: { size: 10 } },
                        grid: { color: 'rgba(255,255,255,0.04)' },
                    },
                    y: {
                        ticks: { color: '#64748b', callback: v => v.toFixed(0) + '%', font: { size: 10 } },
                        grid: { color: 'rgba(255,255,255,0.04)' },
                    },
                },
            },
        });
    }

    // RL strategy tab clicks
    $$('[data-rl-strat]').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('[data-rl-strat]').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            if (rlData) renderRLEquityChart(rlData, tab.dataset.rlStrat);
        });
    });

    // Train model button
    $('#btn-train-model').addEventListener('click', async () => {
        showToast('Training started — run python rl_model/train.py on your machine');
    });

    // ---- Init ----
    async function init() {
        // Show user name in sidebar
        try {
            const user = JSON.parse(localStorage.getItem('tv_user') || '{}');
            const greeting = $('#user-greeting');
            if (greeting && user.name) greeting.textContent = `👤 ${user.name}`;
        } catch (e) { }

        // Logout button
        const logoutBtn = $('#btn-logout');
        if (logoutBtn) logoutBtn.addEventListener('click', logout);

        await loadStrategies();
        await loadTrades();
        await loadStats();
    }

    init();
})();
