/* ===================================================
   Admin Analytics Dashboard - admin.js
   =================================================== */

(function () {
    'use strict';

    // - App colour palette -----------------
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

    function appColor(key) { return APP_COLORS[key] || '#94a3b8'; }

    // ── DOM helpers ──────────────────────────────────
    function $(id) { return document.getElementById(id); }
    function fmt(n) { return (n ?? 0).toLocaleString(); }

    function today() {
        return new Date().toISOString().slice(0, 10);
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

    function pct(num, denom) {
        if (!denom) return 0;
        return Math.round((num / denom) * 100);
    }

    function pctClass(p) {
        if (p >= 60) return 'adm-pct-good';
        if (p >= 35) return 'adm-pct-ok';
        if (p >= 15) return 'adm-pct-warn';
        return 'adm-pct-low';
    }

    function convClass(p) {
        if (p >= 60) return 'adm-conv-good';
        if (p >= 35) return 'adm-conv-ok';
        if (p >= 15) return 'adm-conv-warn';
        return 'adm-conv-low';
    }

    // ── Fetch data ─────────────────────────────────────
    async function fetchAnalytics(days) {
        const res = await fetch(`/api/admin/analytics?days=${days}`);
        if (res.status === 403) throw new Error('Access denied. Admin only.');
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return res.json();
    }

    async function fetchFeedback() {
        const res = await fetch('/api/admin/feedback');
        if (res.status === 403) return null;
        if (!res.ok) return null;
        return res.json();
    }

    // ── Compute per-app funnel for a date range ─────────────
    function computeFunnels(data, rangeStart) {
        const {
            daily_clicks, daily_unique_users, daily_generations,
            daily_gen_failed, daily_downloads, app_labels,
        } = data;

        const funnels = {};
        for (const appKey of Object.keys(app_labels)) {
            let clicks = 0, gens = 0, failedGens = 0, downloads = 0;
            const userSet = new Set();

            for (const [d, apps] of Object.entries(daily_clicks || {})) {
                if (d >= rangeStart) clicks += apps[appKey] || 0;
            }
            for (const [d, apps] of Object.entries(daily_unique_users || {})) {
                if (d >= rangeStart && Array.isArray(apps[appKey])) {
                    apps[appKey].forEach(id => userSet.add(id));
                }
            }
            for (const [d, apps] of Object.entries(daily_generations || {})) {
                if (d >= rangeStart) gens += apps[appKey] || 0;
            }
            for (const [d, apps] of Object.entries(daily_gen_failed || {})) {
                if (d >= rangeStart) failedGens += apps[appKey] || 0;
            }
            for (const [d, apps] of Object.entries(daily_downloads || {})) {
                if (d >= rangeStart) downloads += apps[appKey] || 0;
            }

            const users       = userSet.size;
            const totalAttempts = gens + failedGens;
            const successRate = pct(gens, totalAttempts);   // successful / total attempts
            const convRate    = pct(gens, clicks);           // visits → gens
            const userRate    = pct(users, clicks);          // visits → users
            const genRate     = pct(gens, users);            // users → gens
            const dlRate      = pct(downloads, gens);        // gens → downloads

            funnels[appKey] = {
                label: app_labels[appKey],
                clicks, users, gens, failedGens, downloads,
                successRate, convRate, userRate, genRate, dlRate,
            };
        }
        return funnels;
    }

    // - Hero KPI cards -------------------
    function renderHero(data, funnels, days) {
        const rangeStart = nDaysAgo(days);
        const d7Start    = nDaysAgo(7);
        const d14Start   = nDaysAgo(14);

        // ALL TIME unique users (from users_total, union across all apps)
        const totalUserSet = new Set();
        for (const ids of Object.values(data.users_total || {})) {
            if (Array.isArray(ids)) ids.forEach(id => totalUserSet.add(id));
        }
        // 28d unique users for sub-label trend
        const d28Start = nDaysAgo(28);
        const userSet28 = new Set();
        const userSet7  = new Set();
        const userSetP7 = new Set();
        for (const [d, apps] of Object.entries(data.daily_unique_users || {})) {
            for (const ids of Object.values(apps)) {
                if (!Array.isArray(ids)) continue;
                if (d >= d28Start) ids.forEach(id => userSet28.add(id));
                if (d >= d7Start)  ids.forEach(id => userSet7.add(id));
                if (d >= d14Start && d < d7Start) ids.forEach(id => userSetP7.add(id));
            }
        }

        // Gens, failed & downloads in range / 7d / prior 7d
        let gens = 0, gensP = 0, gens7 = 0, gensP7 = 0;
        let failed = 0;
        let dl = 0, dl7 = 0, dlP7 = 0;
        let clicks = 0;
        for (const [d, apps] of Object.entries(data.daily_generations || {})) {
            const v = Object.values(apps).reduce((s, x) => s + (x || 0), 0);
            if (d >= rangeStart) gens += v;
            if (d >= d7Start)    gens7  += v;
            if (d >= d14Start && d < d7Start) gensP7 += v;
        }
        for (const [d, apps] of Object.entries(data.daily_gen_failed || {})) {
            if (d >= rangeStart) failed += Object.values(apps).reduce((s, x) => s + (x || 0), 0);
        }
        for (const [d, apps] of Object.entries(data.daily_downloads || {})) {
            const v = Object.values(apps).reduce((s, x) => s + (x || 0), 0);
            if (d >= rangeStart) dl  += v;
            if (d >= d7Start)    dl7  += v;
            if (d >= d14Start && d < d7Start) dlP7 += v;
        }
        for (const [d, apps] of Object.entries(data.daily_clicks || {})) {
            if (d >= rangeStart) clicks += Object.values(apps).reduce((s, x) => s + (x || 0), 0);
        }

        // Success rate for period
        const totalAttempts = gens + failed;
        const successRate   = totalAttempts > 0 ? Math.round((gens / totalAttempts) * 100) : null;

        // Conv rate for period
        const convRate = clicks > 0 ? Math.round((gens / clicks) * 100) : 0;

        function trendHtml(curr, prev) {
            if (!prev) return '';
            const d = curr - prev;
            const p = Math.round(Math.abs(d / prev) * 100);
            if (d > 0) return `<span class="adm-hero-delta up">+${p}% vs prior 7d</span>`;
            if (d < 0) return `<span class="adm-hero-delta down">−${p}% vs prior 7d</span>`;
            return `<span class="adm-hero-delta flat">flat vs prior 7d</span>`;
        }

        const rangeLabel = days <= 7 ? '7 days' : days <= 28 ? '28 days' : days <= 90 ? '3 months' : days <= 180 ? '6 months' : '1 year';

        $('heroUniqueUsers').textContent  = fmt(totalUserSet.size);
        $('heroUniqueUsersSub').innerHTML = `<span style="opacity:.7">${fmt(userSet28.size)} in last 28d</span>`;

        $('heroGenerations').textContent   = fmt(gens);
        $('heroGenerationsSub').innerHTML  = trendHtml(gens7, gensP7) || `${fmt(gens7)} this week`;

        $('heroDownloads').textContent     = fmt(dl);
        $('heroDownloadsSub').innerHTML    = trendHtml(dl7, dlP7) || `${fmt(dl7)} this week`;

        const srEl = $('heroSuccessRate');
        if (successRate !== null) {
            srEl.textContent = successRate + '%';
            srEl.style.color = successRate >= 90 ? 'var(--success)' : successRate >= 70 ? '#d97706' : 'var(--danger)';
            $('heroSuccessRateSub').innerHTML = `${fmt(failed)} failed in ${rangeLabel}`;
        } else {
            srEl.textContent = '—';
            $('heroSuccessRateSub').textContent = 'no attempts tracked yet';
        }

        const convEl = $('heroConvRate');
        convEl.textContent = convRate + '%';
        convEl.style.color = convRate >= 40 ? 'var(--success)' : convRate >= 20 ? '#d97706' : 'var(--danger)';
    }

    // - Funnel Cards --------------------
    function renderFunnelCards(funnels, feedbackAggregates) {
        const grid = $('funnelGrid');
        if (!grid) return;

        const sorted = Object.entries(funnels).sort((a, b) => b[1].users - a[1].users);

        grid.innerHTML = sorted.map(([key, f]) => {
            const color = appColor(key);
            const hasData = f.clicks > 0;

            if (!hasData) {
                return `
                <div class="adm-funnel-card" style="--app-color:${color}">
                    <div class="adm-funnel-head">
                        <span class="adm-funnel-dot"></span>
                        <span class="adm-funnel-name">${escapeHtml(f.label)}</span>
                    </div>
                    <div class="adm-funnel-no-data">No activity in this period</div>
                </div>`;
            }

            // Bar widths relative to visits (visits = 100%)
            const userBarW = f.clicks > 0   ? Math.max(4, Math.round(f.users    / f.clicks   * 100)) : 0;
            const genBarW  = f.clicks > 0   ? Math.max(4, Math.round(f.gens     / f.clicks   * 100)) : 0;
            const dlBarW   = f.clicks > 0   ? Math.max(4, Math.round(f.downloads/ f.clicks   * 100)) : 0;

            // Stage-to-stage conversion labels
            const userPct  = pct(f.users,     f.clicks);
            const genPct   = pct(f.gens,      f.users);
            const dlPct    = pct(f.downloads, f.gens);

            // Success rate label
            const totalAttempts = f.gens + f.failedGens;
            const srHtml = totalAttempts > 0
                ? `<span class="adm-funnel-conv" style="margin-left:auto">Success: <b style="color:${f.successRate >= 90 ? '#16a34a' : f.successRate >= 70 ? '#d97706' : '#dc2626'}">${f.successRate}%</b></span>`
                : '';

            // Feedback rating
            const agg   = (feedbackAggregates || {})[key];
            let ratingHtml = '';
            if (agg && agg.total_count > 0) {
                const avg = (agg.score_sum / agg.total_count).toFixed(1);
                ratingHtml = `
                <span class="adm-funnel-rating">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="#f59e0b" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    ${avg}/4 &nbsp;<span style="opacity:.55">(${agg.total_count})</span>
                </span>`;
            }

            return `
            <div class="adm-funnel-card" style="--app-color:${color}">
                <div class="adm-funnel-head">
                    <span class="adm-funnel-dot"></span>
                    <span class="adm-funnel-name">${escapeHtml(f.label)}</span>
                </div>
                <div class="adm-funnel-body">
                    <div class="adm-funnel-row">
                        <span class="adm-funnel-stage">Visits</span>
                        <div class="adm-funnel-track"><div class="adm-funnel-fill" style="width:100%"></div></div>
                        <span class="adm-funnel-n">${fmt(f.clicks)}</span>
                        <span class="adm-funnel-pct adm-pct-base">100%</span>
                    </div>
                    <div class="adm-funnel-row">
                        <span class="adm-funnel-stage">Unique Users</span>
                        <div class="adm-funnel-track"><div class="adm-funnel-fill" style="width:${userBarW}%"></div></div>
                        <span class="adm-funnel-n">${fmt(f.users)}</span>
                        <span class="adm-funnel-pct ${pctClass(userPct)}">${userPct}%</span>
                    </div>
                    <div class="adm-funnel-row">
                        <span class="adm-funnel-stage">Generated</span>
                        <div class="adm-funnel-track"><div class="adm-funnel-fill" style="width:${genBarW}%"></div></div>
                        <span class="adm-funnel-n">${fmt(f.gens)}</span>
                        <span class="adm-funnel-pct ${pctClass(genPct)}">${genPct}%</span>
                    </div>
                    <div class="adm-funnel-row">
                        <span class="adm-funnel-stage">Downloaded</span>
                        <div class="adm-funnel-track"><div class="adm-funnel-fill" style="width:${dlBarW}%"></div></div>
                        <span class="adm-funnel-n">${fmt(f.downloads)}</span>
                        <span class="adm-funnel-pct ${f.gens > 0 ? pctClass(dlPct) : 'adm-pct-base'}">${f.gens > 0 ? dlPct + '%' : '—'}</span>
                    </div>
                </div>
                <div class="adm-funnel-foot">
                    <span class="adm-funnel-conv">Conv: <b>${f.convRate}%</b> visits → gens</span>
                    ${srHtml}
                    ${ratingHtml}
                </div>
            </div>`;
        }).join('');
    }

    // - Daily Generations chart (stacked bars) -------
    function renderDailyChart(data) {
        const canvas = $('dailyChart');
        if (!canvas) return;

        const { daily_generations, date_range, app_labels } = data;
        const appKeys = Object.keys(app_labels);
        const dates   = date_range || [];

        const legendEl = $('chartLegend');
        legendEl.innerHTML = '';
        appKeys.forEach(key => {
            const item = document.createElement('span');
            item.className = 'adm-legend-item';
            item.innerHTML = `<span class="adm-legend-dot" style="background:${appColor(key)}"></span>${escapeHtml(app_labels[key])}`;
            legendEl.appendChild(item);
        });

        const datasets = {};
        appKeys.forEach(k => { datasets[k] = []; });
        dates.forEach(d => {
            const dayData = (daily_generations || {})[d] || {};
            appKeys.forEach(k => datasets[k].push(dayData[k] || 0));
        });

        const dpr     = window.devicePixelRatio || 1;
        const padL = 36, padB = 28, padT = 14, padR = 16;
        const W    = canvas.parentElement.clientWidth || 900;
        const H    = 260;

        canvas.style.width  = W + 'px';
        canvas.style.height = H + 'px';
        canvas.width  = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);

        const chartW = W - padL - padR;
        const chartH = H - padT - padB;

        const dayTotals = dates.map((_, i) => appKeys.reduce((s, k) => s + datasets[k][i], 0));
        const maxVal = Math.max(...dayTotals, 1);
        const yStep  = niceStep(maxVal);
        const yMax   = Math.ceil(maxVal / yStep) * yStep;

        const isDark = document.body.classList.contains('dark-mode');
        const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)';
        const textColor = isDark ? '#8a9db2' : '#6b7280';
        const labelFont = `11px 'Noto Sans', Verdana, sans-serif`;

        ctx.font = labelFont;
        ctx.textAlign = 'right';
        ctx.fillStyle = textColor;
        for (let v = 0; v <= yMax; v += yStep) {
            const y = padT + chartH - (v / yMax) * chartH;
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(padL + chartW, y);
            ctx.stroke();
            ctx.fillText(v.toString(), padL - 5, y + 4);
        }

        const n    = dates.length;
        const barW = Math.max(8, (chartW / n) * 0.55);
        const barG = chartW / n;

        ctx.textAlign = 'center';
        dates.forEach((d, i) => {
            const x = padL + i * barG + barG / 2;
            let baseY = padT + chartH;
            appKeys.forEach(k => {
                const val = datasets[k][i];
                if (val <= 0) return;
                const bh  = (val / yMax) * chartH;
                ctx.fillStyle = appColor(k);
                roundedRectTop(ctx, x - barW / 2, baseY - bh, barW, bh, 3);
                ctx.fill();
                baseY -= bh;
            });
            ctx.fillStyle = textColor;
            ctx.font = labelFont;
            ctx.fillText(shortDate(d), x, padT + chartH + 18);
        });

        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, padT + chartH);
        ctx.lineTo(padL + chartW, padT + chartH);
        ctx.stroke();
    }

    // - Rankings Table -------------------
    let _rankFunnels = null;
    let _rankFeedback = null;
    let _currentSort = 'users';

    function renderRankings(funnels, feedbackAggregates, sortBy) {
        _rankFunnels  = funnels;
        _rankFeedback = feedbackAggregates;
        _currentSort  = sortBy || _currentSort;

        const tbody = $('rankingsBody');
        if (!tbody) return;

        const rows = Object.entries(funnels).map(([key, f]) => {
            const agg = (feedbackAggregates || {})[key];
            const rating = agg && agg.total_count > 0
                ? (agg.score_sum / agg.total_count).toFixed(1)
                : null;
            return { key, ...f, rating };
        });

        const sortMap = {
            users:   (a, b) => b.users       - a.users,
            gens:    (a, b) => b.gens        - a.gens,
            conv:    (a, b) => b.convRate    - a.convRate,
            success: (a, b) => b.successRate - a.successRate,
        };
        rows.sort(sortMap[_currentSort] || sortMap.users);

        tbody.innerHTML = rows.map((r, i) => {
            const rankCls    = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
            const convHtml   = r.clicks > 0
                ? `<span class="adm-conv-pill ${convClass(r.convRate)}">${r.convRate}%</span>`
                : `<span class="adm-num-zero">—</span>`;
            const totalAttempts = r.gens + r.failedGens;
            const srHtml = totalAttempts > 0
                ? `<span class="adm-conv-pill ${r.successRate >= 90 ? 'adm-conv-good' : r.successRate >= 70 ? 'adm-conv-warn' : 'adm-conv-low'}">${r.successRate}%</span>`
                : `<span class="adm-num-zero">—</span>`;
            const ratingHtml = r.rating
                ? `<span style="color:#f59e0b;font-weight:700">${r.rating}</span><span style="color:var(--text-secondary);font-size:11px">/4</span>`
                : `<span class="adm-num-zero">—</span>`;
            const color = appColor(r.key);
            return `<tr>
                <td class="adm-rank-num ${rankCls}">${i + 1}</td>
                <td>
                    <div class="adm-app-cell">
                        <span class="adm-app-dot" style="background:${color}"></span>
                        <span class="adm-app-name">${escapeHtml(r.label)}</span>
                    </div>
                </td>
                <td class="${r.clicks === 0 ? 'adm-num-zero' : ''}">${fmt(r.clicks)}</td>
                <td class="${r.users === 0 ? 'adm-num-zero' : ''}">${fmt(r.users)}</td>
                <td class="${r.gens === 0 ? 'adm-num-zero' : ''}">${fmt(r.gens)}</td>
                <td class="${r.failedGens === 0 ? 'adm-num-zero' : ''}"><span style="${r.failedGens > 0 ? 'color:var(--danger)' : ''}">${fmt(r.failedGens)}</span></td>
                <td>${srHtml}</td>
                <td>${convHtml}</td>
                <td>${ratingHtml}</td>
            </tr>`;
        }).join('');
    }

    // - Feedback section ------------------
    function renderFeedbackSection(feedbackData) {
        if (!feedbackData || !feedbackData.aggregates) return;
        const { aggregates, app_labels } = feedbackData;
        const grid = $('feedbackScoresGrid');
        const card = $('feedbackScoresCard');
        if (!grid || !card) return;

        grid.innerHTML = '';
        let hasAny = false;

        for (const [appKey, agg] of Object.entries(aggregates)) {
            if (!agg || !agg.total_count) continue;
            hasAny = true;
            const avg    = (agg.score_sum / agg.total_count).toFixed(1);
            const scores = agg.scores || {};
            const total  = agg.total_count || 1;
            const label  = (app_labels && app_labels[appKey]) || appKey;
            const color  = appColor(appKey);

            const segments = [4, 3, 2, 1].map(r => {
                const p    = ((scores[String(r)] || 0) / total * 100).toFixed(1);
                const segC = r === 4 ? '#16a34a' : r === 3 ? '#2563eb' : r === 2 ? '#f59e0b' : '#dc2626';
                return `<div style="flex:${p};background:${segC};min-width:${p > 0 ? '3px' : '0'}" title="Rating ${r}: ${scores[String(r)] || 0}"></div>`;
            }).join('');

            const el = document.createElement('div');
            el.className = 'adm-feedback-score-card';
            el.innerHTML = `
                <div class="adm-feedback-score-label" style="color:${color}">${escapeHtml(label)}</div>
                <div class="adm-feedback-score-avg">${avg}<span class="adm-feedback-score-max">/4</span></div>
                <div class="adm-feedback-score-count">${agg.total_count} reaction${agg.total_count !== 1 ? 's' : ''}</div>
                <div class="adm-feedback-mini-bar">${segments}</div>`;
            grid.appendChild(el);
        }
        if (hasAny) card.hidden = false;
    }

    // ── Full render ──────────────────────────────────
    function render(data, feedbackData, days) {
        const rangeStart = nDaysAgo(days);
        const funnels    = computeFunnels(data, rangeStart);
        const fbAgg      = feedbackData && feedbackData.aggregates ? feedbackData.aggregates : null;

        // Update dynamic labels
        const rangeLabel = days <= 7 ? '7 days' : days <= 28 ? '28 days' : days <= 90 ? '3 months' : days <= 180 ? '6 months' : '1 year';
        const periodNote = $('funnelPeriodNote');
        if (periodNote) periodNote.textContent = `${rangeLabel} · percentages show stage-to-stage conversion`;

        renderHero(data, funnels, days);
        renderFunnelCards(funnels, fbAgg);
        renderDailyChart(data);
        renderRankings(funnels, fbAgg, _currentSort);
        renderFeedbackSection(feedbackData);
        $('admLastUpdated').textContent = new Date().toLocaleTimeString();

        // Sort button handlers
        document.querySelectorAll('.adm-sort-btn').forEach(btn => {
            btn.classList.toggle('adm-sort-active', btn.dataset.sort === _currentSort);
            btn.onclick = () => {
                document.querySelectorAll('.adm-sort-btn').forEach(b => b.classList.remove('adm-sort-active'));
                btn.classList.add('adm-sort-active');
                renderRankings(_rankFunnels, _rankFeedback, btn.dataset.sort);
            };
        });
    }

    // - Load ------------------------
    async function load(btn, days) {
        days = days || window._admDays || 28;
        window._admDays = days;

        $('admLoading').hidden = false;
        $('admContent').hidden = true;
        $('admError').hidden   = true;
        if (btn) { btn.disabled = true; btn.classList.add('spinning'); }

        try {
            const [data, feedbackData] = await Promise.all([fetchAnalytics(days), fetchFeedback()]);
            window._admData    = data;
            window._admFeedback = feedbackData;
            render(data, feedbackData, days);
            $('admContent').hidden = false;
        } catch (err) {
            $('admErrorMsg').textContent = err.message || 'Could not load analytics.';
            $('admError').hidden = false;
        } finally {
            $('admLoading').hidden = true;
            if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
        }
    }

    // - Canvas helpers -------------------
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

    // - Boot ------------------------
    document.addEventListener('DOMContentLoaded', () => {
        const dateEl = $('admDate');
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString(undefined, {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            });
        }

        const refreshBtn = $('admRefresh');
        if (refreshBtn) refreshBtn.addEventListener('click', () => load(refreshBtn, window._admDays));

        // Time range selector
        document.querySelectorAll('.adm-range-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.adm-range-btn').forEach(b => b.classList.remove('adm-range-active'));
                btn.classList.add('adm-range-active');
                load(null, parseInt(btn.dataset.days, 10));
            });
        });

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (window._admData && !$('admContent').hidden) {
                    renderDailyChart(window._admData);
                }
            }, 200);
        });

        load(null, 28);
    });

})();
