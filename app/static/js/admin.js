/* ===================================================
   Admin Analytics Dashboard — admin.js
   =================================================== */

(function () {
    'use strict';

    // ── App colour palette ──────────────────────────────────
    const APP_COLORS = {
        'ppt':                '#FF6840',
        'diagram':            '#2563eb',
        'bpmn':               '#10b981',
        'audit':              '#f59e0b',
        'bpmn-checker':       '#8b5cf6',
        'spec-builder':       '#ec4899',
        'docupedia':          '#0ea5e9',
        'one-pager':          '#64748b',
        'signavio-learning':  '#14b8a6',
    };

    function appColor(key) {
        return APP_COLORS[key] || '#94a3b8';
    }

    // ── Helpers ─────────────────────────────────────────────
    function $(id) { return document.getElementById(id); }
    function fmt(n) { return (n ?? 0).toLocaleString(); }

    function today() {
        const d = new Date();
        return d.toISOString().slice(0, 10);
    }

    function nDaysAgo(n) {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return d.toISOString().slice(0, 10);
    }

    function shortDate(iso) {
        const [, m, d] = iso.split('-');
        return `${parseInt(m)}/${parseInt(d)}`;
    }

    // ── Fetch analytics data ─────────────────────────────────
    async function fetchAnalytics() {
        const res = await fetch('/api/admin/analytics');
        if (res.status === 403) throw new Error('Access denied. Admin only.');
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return res.json();
    }

    // ── Stat cards ───────────────────────────────────────────
    function renderStatCards(data) {
        const { daily_clicks, daily_unique_users, generations, app_labels } = data;

        const todayKey  = today();
        const weekStart = nDaysAgo(7);

        let todayTotal = 0;
        let weekTotal  = 0;
        let totalGens  = 0;

        for (const [dateStr, apps] of Object.entries(daily_clicks)) {
            for (const count of Object.values(apps)) {
                const c = count || 0;
                if (dateStr === todayKey) todayTotal += c;
                if (dateStr >= weekStart) weekTotal  += c;
            }
        }

        for (const v of Object.values(generations)) totalGens += (v || 0);

        // All-time unique users: union across every date in daily_unique_users
        const allTimeUniqueUsers = new Set();
        for (const dayUsers of Object.values(daily_unique_users || {})) {
            for (const ids of Object.values(dayUsers)) {
                if (Array.isArray(ids)) ids.forEach(id => allTimeUniqueUsers.add(id));
            }
        }

        $('statToday').textContent       = fmt(todayTotal);
        $('statWeek').textContent        = fmt(weekTotal);
        $('statGenerations').textContent = fmt(totalGens);
        $('statUniqueUsers').textContent = fmt(allTimeUniqueUsers.size);
    }

    // ── Daily clicks canvas chart ─────────────────────────────
    function renderDailyChart(data) {
        const canvas = $('dailyChart');
        if (!canvas) return;

        const { daily_clicks, date_range, app_labels } = data;
        const appKeys = Object.keys(app_labels);
        const dates   = date_range || [];

        // Build legend
        const legendEl = $('chartLegend');
        legendEl.innerHTML = '';
        appKeys.forEach(key => {
            const item = document.createElement('span');
            item.className = 'adm-legend-item';
            item.innerHTML = `<span class="adm-legend-dot" style="background:${appColor(key)}"></span>${app_labels[key]}`;
            legendEl.appendChild(item);
        });

        // Build dataset: totals per day per app
        const datasets = {};
        appKeys.forEach(k => { datasets[k] = []; });

        dates.forEach(d => {
            const dayData = daily_clicks[d] || {};
            appKeys.forEach(k => {
                datasets[k].push(dayData[k] || 0);
            });
        });

        // Canvas drawing
        const dpr     = window.devicePixelRatio || 1;
        const padLeft = 36, padBottom = 28, padTop = 14, padRight = 16;
        const W       = canvas.parentElement.clientWidth || 900;
        const H       = 260;

        canvas.style.width  = W + 'px';
        canvas.style.height = H + 'px';
        canvas.width  = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);

        const chartW = W - padLeft - padRight;
        const chartH = H - padTop - padBottom;

        // Compute stacked max
        const dayTotals = dates.map((_, i) => appKeys.reduce((s, k) => s + datasets[k][i], 0));
        const maxVal    = Math.max(...dayTotals, 1);
        const yStep     = niceStep(maxVal);
        const yMax      = Math.ceil(maxVal / yStep) * yStep;

        const isDark = document.body.classList.contains('dark-mode');
        const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)';
        const textColor = isDark ? '#8a9db2' : '#6b7280';
        const labelFont = `11px 'Noto Sans', Verdana, sans-serif`;

        // Grid lines + Y labels
        ctx.font = labelFont;
        ctx.textAlign = 'right';
        ctx.fillStyle = textColor;
        for (let v = 0; v <= yMax; v += yStep) {
            const y = padTop + chartH - (v / yMax) * chartH;
            ctx.strokeStyle = gridColor;
            ctx.lineWidth   = 1;
            ctx.beginPath();
            ctx.moveTo(padLeft, y);
            ctx.lineTo(padLeft + chartW, y);
            ctx.stroke();
            ctx.fillText(v.toString(), padLeft - 5, y + 4);
        }

        // Bars
        const n       = dates.length;
        const barW    = Math.max(8, (chartW / n) * 0.55);
        const barGap  = chartW / n;

        ctx.textAlign = 'center';
        dates.forEach((d, i) => {
            const x = padLeft + i * barGap + barGap / 2;
            let baseY = padTop + chartH;

            appKeys.forEach(k => {
                const val = datasets[k][i];
                if (val <= 0) return;
                const bh  = (val / yMax) * chartH;
                const col = appColor(k);
                ctx.fillStyle = col;
                roundedRectTop(ctx, x - barW / 2, baseY - bh, barW, bh, 3);
                ctx.fill();
                baseY -= bh;
            });

            // X label
            ctx.fillStyle = textColor;
            ctx.font = labelFont;
            ctx.fillText(shortDate(d), x, padTop + chartH + 18);
        });

        // X axis line
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, padTop + chartH);
        ctx.lineTo(padLeft + chartW, padTop + chartH);
        ctx.stroke();
    }

    // ── Generations horizontal bars ───────────────────────────
    function renderGenBars(data) {
        const { generations, app_labels } = data;
        const container = $('genBars');
        if (!container) return;

        const appKeys = Object.keys(app_labels);
        const maxGen  = Math.max(...appKeys.map(k => generations[k] || 0), 1);

        container.innerHTML = appKeys.map(k => {
            const count = generations[k] || 0;
            const pct   = Math.round((count / maxGen) * 100);
            const color = appColor(k);
            return `
            <div class="adm-gen-row">
                <div class="adm-gen-row-head">
                    <span class="adm-gen-name">${escapeHtml(app_labels[k])}</span>
                    <span class="adm-gen-count">${fmt(count)}</span>
                </div>
                <div class="adm-gen-track">
                    <div class="adm-gen-fill" style="width:${pct}%;background:${color}"></div>
                </div>
            </div>`;
        }).join('');
    }

    // ── App breakdown table ───────────────────────────────────
    function renderAppTable(data) {
        const { daily_clicks, daily_unique_users, generations, app_labels } = data;
        const tbody  = $('appTableBody');
        if (!tbody) return;

        const todayKey  = today();
        const weekStart = nDaysAgo(7);
        const appKeys   = Object.keys(app_labels);

        const rows = appKeys.map(k => {
            let todayC = 0, weekC = 0, totalC = 0;
            for (const [d, apps] of Object.entries(daily_clicks)) {
                const v = apps[k] || 0;
                if (d === todayKey) todayC += v;
                if (d >= weekStart) weekC  += v;
                totalC += v;
            }

            // Unique users for this app today
            const todayUserList = ((daily_unique_users || {})[todayKey] || {})[k] || [];
            const uniqueToday = new Set(todayUserList).size;

            return { key: k, label: app_labels[k], todayC, weekC, totalC, uniqueToday, gens: generations[k] || 0 };
        });

        rows.sort((a, b) => b.totalC - a.totalC);

        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>
                    <div class="adm-app-cell">
                        <span class="adm-app-dot" style="background:${appColor(r.key)}"></span>
                        <span class="adm-app-name">${escapeHtml(r.label)}</span>
                    </div>
                </td>
                <td class="${r.todayC     === 0 ? 'adm-num-zero' : ''}">${fmt(r.todayC)}</td>
                <td class="${r.uniqueToday === 0 ? 'adm-num-zero' : ''}">${fmt(r.uniqueToday)}</td>
                <td class="${r.weekC      === 0 ? 'adm-num-zero' : ''}">${fmt(r.weekC)}</td>
                <td class="${r.totalC     === 0 ? 'adm-num-zero' : ''}">${fmt(r.totalC)}</td>
                <td class="${r.gens       === 0 ? 'adm-num-zero' : ''}">${fmt(r.gens)}</td>
            </tr>`).join('');
    }

    // ── Render full dashboard ────────────────────────────────
    function render(data) {
        renderStatCards(data);
        renderDailyChart(data);
        renderGenBars(data);
        renderAppTable(data);
        $('admLastUpdated').textContent = new Date().toLocaleTimeString();
    }

    // ── Load data ──────────────────────────────────────────
    async function load(btn) {
        $('admLoading').hidden = false;
        $('admContent').hidden = true;
        $('admError').hidden   = true;
        if (btn) { btn.disabled = true; btn.classList.add('spinning'); }

        try {
            const data = await fetchAnalytics();
            window._admData = data;
            render(data);
            $('admContent').hidden = false;
        } catch (err) {
            $('admErrorMsg').textContent = err.message || 'Could not load analytics.';
            $('admError').hidden = false;
        } finally {
            $('admLoading').hidden = true;
            if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
        }
    }

    // ── Canvas helper: bar with rounded top corners ──────────
    function roundedRectTop(ctx, x, y, w, h, r) {
        if (h <= 0) return;
        r = Math.min(r, h / 2, w / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function niceStep(maxVal) {
        if (maxVal <= 5)  return 1;
        if (maxVal <= 10) return 2;
        if (maxVal <= 25) return 5;
        if (maxVal <= 50) return 10;
        const mag  = Math.pow(10, Math.floor(Math.log10(maxVal)));
        const norm = maxVal / mag;
        if (norm <= 1.5) return 0.5 * mag;
        if (norm <= 3)   return mag;
        if (norm <= 7)   return 2 * mag;
        return 5 * mag;
    }

    // ── Boot ─────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const dateEl = $('admDate');
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString(undefined, {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        }

        const refreshBtn = $('admRefresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => load(refreshBtn));
        }

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (window._admData && !$('admContent').hidden) {
                    renderDailyChart(window._admData);
                }
            }, 200);
        });

        load(null);
    });

})();
