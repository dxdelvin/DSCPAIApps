/**
 * Common functionality for BSH DSCP AI
 */

document.addEventListener('DOMContentLoaded', () => {
    initAppSearch();
    initCharacterCounters();

    const themeToggle = document.getElementById('themeToggle');
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');

    const savedTheme = localStorage.getItem('dscp_theme') || 'light';
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        if (sunIcon) sunIcon.style.display = 'none';
        if (moonIcon) moonIcon.style.display = 'block';
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');

            if (sunIcon) sunIcon.style.display = isDark ? 'none' : 'block';
            if (moonIcon) moonIcon.style.display = isDark ? 'block' : 'none';

            localStorage.setItem('dscp_theme', isDark ? 'dark' : 'light');
        });
    }

    initEasterMode();

    const changelogBell = document.getElementById('changelogBell');
    const changelogPanel = document.getElementById('changelog');
    const closeChangelog = document.getElementById('closeChangelog');

    const latestVersionEl = document.querySelector('.badge-version');
    const latestVersion = latestVersionEl ? latestVersionEl.textContent.trim() : 'v1.0.0';
    const storageKey = 'dscp_last_seen_version';

    const lastSeenVersion = localStorage.getItem(storageKey);
    const hasUpdates = lastSeenVersion !== latestVersion;

    if (hasUpdates && changelogBell) {
        const dot = document.createElement('div');
        dot.className = 'badge-dot';
        changelogBell.appendChild(dot);
    }

    if (changelogPanel) {
        changelogPanel.hidden = true;
    }

    if (changelogBell) {
        changelogBell.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (changelogPanel) {
                changelogPanel.hidden = !changelogPanel.hidden;

                if (!changelogPanel.hidden && hasUpdates) {
                    localStorage.setItem(storageKey, latestVersion);
                    const dot = changelogBell.querySelector('.badge-dot');
                    if (dot) dot.remove();
                }
            }
        });
    }

    if (closeChangelog) {
        closeChangelog.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (changelogPanel) {
                changelogPanel.hidden = true;
            }
        });
    }

    if (changelogPanel) {
        changelogPanel.addEventListener('click', (e) => {
            if (e.target === changelogPanel) {
                changelogPanel.hidden = true;
            }
        });
    }
});

/**
 * Common JavaScript utilities
 * - Modern toast system with progress bar
 * - Helpers for DOM and fetch
 */

const Toast = {
    ICONS: {
        success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
        error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
        warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="m10.29 3.86-8 14A1 1 0 0 0 3.1 19h17.8a1 1 0 0 0 .86-1.5l-8-14a1 1 0 0 0-1.72 0Z"/></svg>`,
        info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`
    },
    TITLES: {
        success: 'Success',
        error: 'Error',
        warning: 'Warning',
        info: 'Notice'
    },
    show(message, type = 'info', duration = 3200) {
        const container = document.getElementById('toast-container');
        if (!container) return null;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="icon-wrap">${this.ICONS[type] || this.ICONS.info}</div>
            <div class="content">
                <div class="title">${this.TITLES[type] || 'Notice'}</div>
                <div class="message">${this.escape(message)}</div>
            </div>
            <button class="close-btn" aria-label="Dismiss">×</button>
            <div class="progress" style="animation-duration:${duration}ms"></div>
        `;

        const closeBtn = toast.querySelector('.close-btn');
        closeBtn.addEventListener('click', () => this.remove(toast));

        container.appendChild(toast);
        const timeout = setTimeout(() => this.remove(toast), duration);
        toast.dataset.timeout = timeout;
        return toast;
    },
    remove(toast) {
        if (!toast || !toast.parentElement) return;
        const timeout = toast.dataset.timeout;
        if (timeout) clearTimeout(timeout);
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 180);
    },
    escape(value) {
        const div = document.createElement('div');
        div.textContent = value;
        return div.innerHTML;
    }
};

function showToast(message, type = 'info', duration) {
    return Toast.show(message, type, duration);
}

const Utils = {
    isEmpty(value) {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value.trim() === '';
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return Object.keys(value).length === 0;
        return false;
    },
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },
    apiRequest: async (url, options = {}) => {
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        return response.json();
    },
    formDataToJson(formData) {
        const json = {};
        for (const [k, v] of formData.entries()) json[k] = v;
        return json;
    }
};

const AppLogger = {
    LEVELS: {
        debug: 10,
        info: 20,
        warn: 30,
        error: 40,
    },
    getConfig() {
        const cfg = window.APP_CONFIG || {};
        const env = (cfg.env || 'dev').toLowerCase();
        return {
            env,
            isProd: env === 'prod',
            enabled: cfg.clientLoggingEnabled !== false,
            minLevel: (cfg.clientLogLevel || (env === 'prod' ? 'error' : 'debug')).toLowerCase(),
        };
    },
    shouldLog(level) {
        const cfg = this.getConfig();
        if (!cfg.enabled) return false;
        const current = this.LEVELS[level] || this.LEVELS.error;
        const min = this.LEVELS[cfg.minLevel] || this.LEVELS.error;
        return current >= min;
    },
    shouldUseConsole(level) {
        const cfg = this.getConfig();
        if (!cfg.enabled) return false;
        if (!cfg.isProd) return true;
        return level === 'error';
    },
    sanitizeMeta(meta) {
        if (meta === undefined || meta === null) return null;
        const raw = typeof meta === 'string' ? meta : this.safeStringify(meta);
        if (!raw) return null;
        return raw.slice(0, 2000);
    },
    safeStringify(value) {
        try {
            return JSON.stringify(value);
        } catch {
            return '[unserializable]';
        }
    },
    sendToServer(level, message, meta) {
        const payload = {
            level,
            message: String(message || 'Unknown client error').slice(0, 500),
            metadata: this.sanitizeMeta(meta),
            path: window.location.pathname,
            userAgent: navigator.userAgent,
            ts: new Date().toISOString(),
        };

        const endpoint = '/api/client-log';
        const body = JSON.stringify(payload);

        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon(endpoint, blob);
            return;
        }

        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
        }).catch(() => {});
    },
    write(level, message, meta) {
        if (!this.shouldLog(level)) return;

        if (this.shouldUseConsole(level)) {
            const fn = console[level] || console.error;
            if (meta !== undefined) fn.call(console, message, meta);
            else fn.call(console, message);
        }

        if (level === 'error') {
            this.sendToServer(level, message, meta);
        }
    },
    debug(message, meta) {
        this.write('debug', message, meta);
    },
    info(message, meta) {
        this.write('info', message, meta);
    },
    warn(message, meta) {
        this.write('warn', message, meta);
    },
    error(message, meta) {
        this.write('error', message, meta);
    },
};

window.AppLogger = AppLogger;

const DOM = {
    select: (sel, parent = document) => parent.querySelector(sel),
    selectAll: (sel, parent = document) => parent.querySelectorAll(sel),
    create: (tag, attrs = {}, content = '') => {
        const el = document.createElement(tag);
        Object.assign(el, attrs);
        if (content) el.innerHTML = content;
        return el;
    },
    empty: (el) => { while (el && el.firstChild) el.removeChild(el.firstChild); }
};

/**
 * Confirmation Modal - Reusable component for dangerous actions
 * @param {string} title - Modal title
 * @param {string} message - Confirmation message
 * @param {function} onConfirm - Callback when user confirms
 * @param {object} options - Additional options { icon, confirmText, cancelText }
 */
function showConfirmation(title, message, onConfirm, options = {}) {
    const {
        icon = '⚠️',
        confirmText = 'Delete',
        cancelText = 'Cancel'
    } = options;

    let modal = document.getElementById('confirmation-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirmation-modal';
        modal.className = 'confirmation-modal';
        modal.innerHTML = `
            <div class="confirmation-content">
                <div class="confirmation-header">
                    <span class="confirmation-icon"></span>
                    <h2 class="confirmation-title"></h2>
                </div>
                <p class="confirmation-message"></p>
                <div class="confirmation-actions">
                    <button class="btn confirmation-btn-cancel" id="confirm-cancel">Cancel</button>
                    <button class="btn confirmation-btn-confirm" id="confirm-ok">Delete</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeConfirmation();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                closeConfirmation();
            }
        });
    }

    modal.querySelector('.confirmation-icon').textContent = icon;
    modal.querySelector('.confirmation-title').textContent = title;
    modal.querySelector('.confirmation-message').textContent = message;
    modal.querySelector('#confirm-ok').textContent = confirmText;
    modal.querySelector('#confirm-cancel').textContent = cancelText;

    modal.querySelector('#confirm-cancel').onclick = () => {
        closeConfirmation();
    };

    modal.querySelector('#confirm-ok').onclick = () => {
        closeConfirmation();
        onConfirm();
    };

    modal.classList.add('active');
    modal.querySelector('#confirm-cancel').focus();
}

function closeConfirmation() {
    const modal = document.getElementById('confirmation-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * App Search Functionality
 * Searches apps by name, tags, and description with priority ordering
 */
function initAppSearch() {
    const searchInput = document.getElementById('appSearch');
    const searchClear = document.getElementById('searchClear');
    const searchResultsInfo = document.getElementById('searchResultsInfo');
    const appGrid = document.querySelector('.app-grid');
    
    if (!searchInput || !appGrid) return;
    
    const appCards = Array.from(appGrid.querySelectorAll('.app-card'));

    const originalData = appCards.map(card => {
        const name = card.querySelector('h3')?.textContent || '';
        const description = card.querySelector('.app-body p')?.textContent || '';
        const tags = Array.from(card.querySelectorAll('.tag')).map(t => t.textContent.trim());
        return {
            card,
            name,
            description,
            tags,
            nameEl: card.querySelector('h3'),
            descEl: card.querySelector('.app-body p'),
            tagEls: card.querySelectorAll('.tag')
        };
    });
    
    let debounceTimer;
    
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => performSearch(e.target.value), 150);

        searchClear.hidden = !e.target.value.trim();
    });
    
    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.hidden = true;
        performSearch('');
        searchInput.focus();
    });
    
    function performSearch(query) {
        const searchTerm = query.toLowerCase().trim();

        const isFilteredOut = (card) => card.classList.contains('filter-hidden');

        if (!searchTerm) {
            originalData.forEach(({ card, nameEl, descEl, tagEls, name, description, tags }) => {
                card.classList.remove('search-hidden');
                if (nameEl) nameEl.innerHTML = escapeHtml(name);
                if (descEl) descEl.innerHTML = escapeHtml(description);
                tagEls.forEach((el, i) => el.innerHTML = escapeHtml(tags[i]));
            });
            if (searchResultsInfo) searchResultsInfo.hidden = true;
            removeNoResults();
            return;
        }

        const scored = originalData.map(data => {
            const { card, name, description, tags } = data;
            let score = 0;
            let matchType = null;

            if (isFilteredOut(card)) {
                return { ...data, score: 0, matchType: null };
            }

            if (name.toLowerCase().includes(searchTerm)) {
                score = 300;
                matchType = 'name';
            }
            else if (tags.some(tag => tag.toLowerCase().includes(searchTerm))) {
                score = 200;
                matchType = 'tag';
            }
            else if (description.toLowerCase().includes(searchTerm)) {
                score = 100;
                matchType = 'description';
            }
            
            return { ...data, score, matchType };
        });

        scored.sort((a, b) => b.score - a.score);
        
        let visibleCount = 0;
        
        scored.forEach(({ card, nameEl, descEl, tagEls, name, description, tags, score, matchType }) => {
            if (score === 0) {
                card.classList.add('search-hidden');
                if (nameEl) nameEl.innerHTML = escapeHtml(name);
                if (descEl) descEl.innerHTML = escapeHtml(description);
                tagEls.forEach((el, i) => el.innerHTML = escapeHtml(tags[i]));
            } else {
                card.classList.remove('search-hidden');
                visibleCount++;

                if (matchType === 'name' && nameEl) {
                    nameEl.innerHTML = highlightMatch(name, searchTerm);
                } else if (nameEl) {
                    nameEl.innerHTML = escapeHtml(name);
                }
                
                if (matchType === 'tag') {
                    tagEls.forEach((el, i) => {
                        if (tags[i].toLowerCase().includes(searchTerm)) {
                            el.innerHTML = highlightMatch(tags[i], searchTerm);
                        } else {
                            el.innerHTML = escapeHtml(tags[i]);
                        }
                    });
                } else {
                    tagEls.forEach((el, i) => el.innerHTML = escapeHtml(tags[i]));
                }
                
                if (matchType === 'description' && descEl) {
                    descEl.innerHTML = highlightMatch(description, searchTerm);
                } else if (descEl) {
                    descEl.innerHTML = escapeHtml(description);
                }

                appGrid.appendChild(card);
            }
        });

        if (searchResultsInfo) {
            if (visibleCount > 0) {
                searchResultsInfo.innerHTML = `Found <span class="highlight">${visibleCount}</span> app${visibleCount !== 1 ? 's' : ''} matching "<span class="highlight">${escapeHtml(searchTerm)}</span>"`;
                searchResultsInfo.hidden = false;
            } else {
                searchResultsInfo.hidden = true;
            }
        }

        if (visibleCount === 0) {
            showNoResults(searchTerm);
        } else {
            removeNoResults();
        }
    }
    
    function highlightMatch(text, term) {
        const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
        return escapeHtml(text).replace(regex, '<span class="match-highlight">$1</span>');
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    function showNoResults(term) {
        removeNoResults();
        const noResults = document.createElement('div');
        noResults.className = 'no-results';
        noResults.id = 'noResultsMessage';
        noResults.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
                <path d="M8 8l6 6"></path>
                <path d="M14 8l-6 6"></path>
            </svg>
            <h3>No apps found</h3>
            <p>No apps match "<strong>${escapeHtml(term)}</strong>". Try a different search term.</p>
        `;
        appGrid.appendChild(noResults);
    }
    
    function removeNoResults() {
        const existing = document.getElementById('noResultsMessage');
        if (existing) existing.remove();
    }
}

/**
 * Character Counters Functionality
 * Automatically adds a character counter below any textarea that has a maxlength attribute
 */
function initCharacterCounters() {
    const textareas = document.querySelectorAll('textarea[maxlength]');
    
    textareas.forEach(ta => {
        const maxLength = parseInt(ta.getAttribute('maxlength'), 10);
        if (isNaN(maxLength)) return;

        const counter = document.createElement('div');
        counter.className = 'char-counter';

        if (ta.nextSibling) {
            ta.parentNode.insertBefore(counter, ta.nextSibling);
        } else {
            ta.parentNode.appendChild(counter);
        }

        const updateCounter = () => {
            const currentLength = ta.value.length;
            counter.textContent = `${currentLength} / ${maxLength}`;

            const ratio = currentLength / maxLength;

            counter.classList.remove('char-safe', 'char-warn', 'char-danger');
            
            if (ratio > 0.95) {
                counter.classList.add('char-danger');
            } else if (ratio > 0.80) {
                counter.classList.add('char-warn');
            } else {
                counter.classList.add('char-safe');
            }
        };

        updateCounter();
        ta.addEventListener('input', updateCounter);
    });
}

/**
 * Full-screen loading overlay with animated concentric rings and cycling messages.
 *
 * Usage:
 *   LoadingOverlay.show({ messages: ['Step 1…', 'Step 2…'], icon: '<svg>…</svg>' });
 *   LoadingOverlay.hide();
 */
const LoadingOverlay = {
    _el: null,
    _timer: null,

    show({ messages = ['Processing…'], icon = '' } = {}) {
        this.hide();
        const el = document.createElement('div');
        el.className = 'lo-overlay';
        el.innerHTML =
            '<div class="lo-rings">' +
                '<div class="lo-ring lo-ring-outer"></div>' +
                '<div class="lo-ring lo-ring-inner"></div>' +
                (icon ? '<div class="lo-icon">' + icon + '</div>' : '') +
            '</div>' +
            '<div class="lo-status">' +
                '<span class="lo-text"></span>' +
                '<span class="lo-dots"><i></i><i></i><i></i></span>' +
            '</div>';
        document.body.appendChild(el);
        this._el = el;
        this._cycleMessages(el.querySelector('.lo-text'), messages);
    },

    hide() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        if (this._el) { this._el.remove(); this._el = null; }
    },

    _cycleMessages(el, msgs) {
        let i = 0;
        el.textContent = msgs[0];
        if (msgs.length > 1) {
            this._timer = setInterval(() => {
                el.style.opacity = '0';
                setTimeout(() => {
                    i = (i + 1) % msgs.length;
                    el.textContent = msgs[i];
                    el.style.opacity = '1';
                }, 250);
            }, 2500);
        }
    }
};

/**
 * Inline loading panel — renders animated loader inside an existing container.
 *
 * Usage:
 *   LoadingPanel.show('loading-state', { messages: ['Analyzing…', 'Processing…'], hint: 'This may take a moment.' });
 *   LoadingPanel.hide('loading-state');
 */
const LoadingPanel = {
    _timers: new Map(),

    show(container, { messages = ['Processing…'], hint = '' } = {}) {
        if (typeof container === 'string') container = document.getElementById(container);
        if (!container) return;
        this.hide(container);
        container.style.display = 'flex';
        container.innerHTML =
            '<div class="lp-panel">' +
                '<div class="lp-rings">' +
                    '<div class="lp-ring lp-ring-outer"></div>' +
                    '<div class="lp-ring lp-ring-inner"></div>' +
                '</div>' +
                '<div class="lp-status">' +
                    '<span class="lp-text"></span>' +
                    '<span class="lp-dots"><i></i><i></i><i></i></span>' +
                '</div>' +
                (hint ? '<p class="lp-hint">' + hint + '</p>' : '') +
            '</div>';
        const textEl = container.querySelector('.lp-text');
        let i = 0;
        textEl.textContent = messages[0];
        if (messages.length > 1) {
            const timer = setInterval(() => {
                textEl.style.opacity = '0';
                setTimeout(() => {
                    i = (i + 1) % messages.length;
                    textEl.textContent = messages[i];
                    textEl.style.opacity = '1';
                }, 250);
            }, 2500);
            this._timers.set(container, timer);
        }
    },

    hide(container) {
        if (typeof container === 'string') container = document.getElementById(container);
        if (!container) return;
        const timer = this._timers.get(container);
        if (timer) { clearInterval(timer); this._timers.delete(container); }
        container.style.display = 'none';
        container.innerHTML = '';
    }
};

/**
 * Easter / Festive Mode
 * Adds pastel color overrides, floating eggs, cursor trails,   
 * and confetti bursts — works on top of light or dark theme.
 */
function initEasterMode() {
    const toggle = document.getElementById('easterToggle');
    if (!toggle) return;

    const EGGS = ['🥚', '🐣', '🐰', '🌷', '🐥', '🌸', '🎀', '🪺'];
    const CONFETTI_COLORS = ['#fbbf24', '#fb923c', '#f472b6', '#c084fc', '#60a5fa', '#34d399'];
    let eggContainer = null;
    let eggInterval = null;
    let trailThrottle = 0;

    if (localStorage.getItem('dscp_easter') === 'on') {
        activateEaster(false);
    }

    toggle.addEventListener('click', () => {
        const isActive = document.body.classList.contains('easter-mode');
        if (isActive) {
            deactivateEaster();
        } else {
            activateEaster(true);
        }
    });

    function activateEaster(withFanfare) {
        document.body.classList.add('easter-mode');
        localStorage.setItem('dscp_easter', 'on');

        if (!eggContainer) {
            eggContainer = document.createElement('div');
            eggContainer.className = 'easter-eggs-container';
            eggContainer.id = 'easterEggsContainer';
            document.body.appendChild(eggContainer);
        }

        eggInterval = setInterval(spawnFloatingEgg, 2500);
        for (let i = 0; i < 3; i++) setTimeout(spawnFloatingEgg, i * 400);

        document.addEventListener('mousemove', handleCursorTrail);

        document.addEventListener('click', handleConfetti);

        if (withFanfare) {
            for (let i = 0; i < 8; i++) setTimeout(spawnFloatingEgg, i * 150);
            showToast('🐣 Happy Easter Season', 'info', 3000);
        }
    }

    function deactivateEaster() {
        document.body.classList.remove('easter-mode');
        localStorage.setItem('dscp_easter', 'off');

        if (eggInterval) { clearInterval(eggInterval); eggInterval = null; }
        if (eggContainer) { eggContainer.remove(); eggContainer = null; }

        document.removeEventListener('mousemove', handleCursorTrail);
        document.removeEventListener('click', handleConfetti);
    }

    function spawnFloatingEgg() {
        if (!eggContainer) return;
        const egg = document.createElement('span');
        egg.className = 'easter-egg-float';
        egg.textContent = EGGS[Math.floor(Math.random() * EGGS.length)];
        egg.style.left = Math.random() * 95 + '%';
        egg.style.fontSize = (18 + Math.random() * 16) + 'px';
        egg.style.animationDuration = (5 + Math.random() * 6) + 's';
        eggContainer.appendChild(egg);
        egg.addEventListener('animationend', () => egg.remove());
    }

    function handleCursorTrail(e) {
        if (!document.body.classList.contains('easter-mode')) return;
        const now = Date.now();
        if (now - trailThrottle < 120) return;
        trailThrottle = now;

        const trail = document.createElement('span');
        trail.className = 'easter-trail';
        trail.textContent = EGGS[Math.floor(Math.random() * EGGS.length)];
        trail.style.left = e.clientX + 'px';
        trail.style.top = e.clientY + 'px';
        document.body.appendChild(trail);
        trail.addEventListener('animationend', () => trail.remove());
    }

    function handleConfetti(e) {
        if (!document.body.classList.contains('easter-mode')) return;
        const target = e.target.closest('.btn, .app-card, .easter-toggle');
        if (!target) return;

        const rect = target.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        for (let i = 0; i < 12; i++) {
            const dot = document.createElement('span');
            dot.className = 'easter-confetti';
            dot.style.left = cx + 'px';
            dot.style.top = cy + 'px';
            dot.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
            const angle = (Math.PI * 2 * i) / 12;
            const dist = 40 + Math.random() * 60;
            dot.style.setProperty('--confetti-x', Math.cos(angle) * dist + 'px');
            dot.style.setProperty('--confetti-y', Math.sin(angle) * dist + 'px');
            document.body.appendChild(dot);
            dot.addEventListener('animationend', () => dot.remove());
        }
    }
}
