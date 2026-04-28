/**
 * Common functionality for BSH DSCP AI
 */

document.addEventListener('DOMContentLoaded', () => {
    initAppSearch();
    initCharacterCounters();
    initAiDisclaimer();
    initAiWarningTimer();

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
            themeToggle.classList.add('spinning');
            setTimeout(() => themeToggle.classList.remove('spinning'), 400);

            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');

            if (sunIcon) sunIcon.style.display = isDark ? 'none' : 'block';
            if (moonIcon) moonIcon.style.display = isDark ? 'block' : 'none';

            localStorage.setItem('dscp_theme', isDark ? 'dark' : 'light');
        });
    }

    initSpringMode();
    initCardEntrance();

    const tutorialBtn = document.getElementById('tutorialBtn');
    if (tutorialBtn) {
        tutorialBtn.addEventListener('click', () => window.DSCPTutorial.startCurrent());
    }

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

function initAiWarningTimer() {
    const aiWarning = document.querySelector('.ai-warning-global');
    if (!aiWarning) return;

    window.setTimeout(() => {
        aiWarning.classList.add('is-dismissing');

        window.setTimeout(() => {
            aiWarning.remove();
        }, 320);
    }, 5000);
}

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

function escapeHtml(str) {
    const el = document.createElement('div');
    el.textContent = str ?? '';
    return el.innerHTML;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
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
    },
    triggerBlobDownload(blob, filename) {
        if (!blob || blob.size === 0) return false;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        return true;
    },
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
 * Inline loading panel - renders animated loader inside an existing container.
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
 * Spring Mode
 * Fresh, clean, and energetic theme with vibrant greens,
 * soft yellows, floating leaves, blooming flowers, and
 * petal bursts - works on top of light or dark theme.
 */
function initSpringMode() {
    const toggle = document.getElementById('springToggle');
    if (!toggle) return;

    const LEAVES = ['🍃', '🌿', '🌱', '🌸', '🌼', '🌻', '☘️', '🌺'];
    const PETAL_COLORS = ['#4ade80', '#86efac', '#facc15', '#a3e635', '#fef08a', '#16a34a'];
    let leafContainer = null;
    let leafInterval = null;
    let trailThrottle = 0;

    if (localStorage.getItem('dscp_spring') === 'on') {
        activateSpring(false);
    }

    toggle.addEventListener('click', () => {
        const isActive = document.body.classList.contains('spring-mode');
        if (isActive) {
            deactivateSpring();
        } else {
            activateSpring(true);
        }
    });

    function activateSpring(withFanfare) {
        document.body.classList.add('spring-mode');
        localStorage.setItem('dscp_spring', 'on');

        if (!leafContainer) {
            leafContainer = document.createElement('div');
            leafContainer.className = 'spring-leaves-container';
            leafContainer.id = 'springLeavesContainer';
            document.body.appendChild(leafContainer);
        }

        // One-time drift: big burst on activation, gentle on page reload
        if (withFanfare) {
            for (let i = 0; i < 10; i++) setTimeout(() => spawnFloatingLeaf(true), i * 120);
        } else {
            for (let i = 0; i < 4; i++) setTimeout(() => spawnFloatingLeaf(false), i * 350);
        }

        document.addEventListener('mousemove', handleCursorTrail);
        document.addEventListener('click', handlePetalBurst);

        if (withFanfare) showToast('🌸 Hello Spring!', 'info', 3000);
    }

    function deactivateSpring() {
        document.body.classList.remove('spring-mode');
        localStorage.setItem('dscp_spring', 'off');

        if (leafInterval) { clearInterval(leafInterval); leafInterval = null; }
        if (leafContainer) { leafContainer.remove(); leafContainer = null; }

        document.removeEventListener('mousemove', handleCursorTrail);
        document.removeEventListener('click', handlePetalBurst);
    }

    function spawnFloatingLeaf(big = false) {
        if (!leafContainer) return;
        const leaf = document.createElement('span');
        leaf.className = 'spring-leaf-float';
        leaf.textContent = LEAVES[Math.floor(Math.random() * LEAVES.length)];
        leaf.style.left = Math.random() * 95 + '%';
        leaf.style.fontSize = big ? (32 + Math.random() * 20) + 'px' : (10 + Math.random() * 8) + 'px';
        leaf.style.animationDuration = (big ? 5 : 8) + (Math.random() * 4) + 's';
        leafContainer.appendChild(leaf);
        leaf.addEventListener('animationend', () => leaf.remove());
    }

    function handleCursorTrail(e) {
        if (!document.body.classList.contains('spring-mode')) return;
        const now = Date.now();
        if (now - trailThrottle < 120) return;
        trailThrottle = now;

        const trail = document.createElement('span');
        trail.className = 'spring-trail';
        trail.textContent = LEAVES[Math.floor(Math.random() * LEAVES.length)];
        trail.style.left = e.clientX + 'px';
        trail.style.top = e.clientY + 'px';
        document.body.appendChild(trail);
        trail.addEventListener('animationend', () => trail.remove());
    }

    function handlePetalBurst(e) {
        if (!document.body.classList.contains('spring-mode')) return;

        const cx = e.clientX;
        const cy = e.clientY;
        const count = 14;

        for (let i = 0; i < count; i++) {
            const petal = document.createElement('span');
            petal.className = 'spring-petal';
            petal.style.left = cx + 'px';
            petal.style.top = cy + 'px';
            petal.style.background = PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)];
            const angle = (Math.PI * 2 * i) / count;
            const dist = 35 + Math.random() * 70;
            petal.style.setProperty('--confetti-x', Math.cos(angle) * dist + 'px');
            petal.style.setProperty('--confetti-y', Math.sin(angle) * dist + 'px');
            // Vary shape: circles and small rectangles
            petal.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            petal.style.width = (5 + Math.random() * 5) + 'px';
            petal.style.height = (5 + Math.random() * 5) + 'px';
            document.body.appendChild(petal);
            petal.addEventListener('animationend', () => petal.remove());
        }
    }
}

function initCardEntrance() {
    const cards = document.querySelectorAll('.app-grid .app-card');
    if (!cards.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card = entry.target;
                const idx = parseInt(card.dataset.entranceIdx || '0', 10);
                setTimeout(() => card.classList.add('card-visible'), idx * 60);
                observer.unobserve(card);
            }
        });
    }, { threshold: 0.05 });

    cards.forEach((card, i) => {
        card.dataset.entranceIdx = i;
        observer.observe(card);
    });
}

function countUp(el, target, duration = 600) {
    const start = performance.now();
    el.textContent = '0';
    function tick(now) {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(ease * target);
        if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

const HistoryIcons = {
    delete: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>',
    open: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v7h-7"/><path d="M3 10V3h7"/><path d="M3 21h7v-7"/></svg>',
};

function initAiDisclaimer() {
    const modal = document.getElementById('aiDisclaimerModal');
    const acceptBtn = document.getElementById('aiDisclaimerAccept');
    if (!modal || !acceptBtn) return;

    const STORAGE_KEY = 'dscp_ai_disclaimer_accepted';
    if (localStorage.getItem(STORAGE_KEY)) return;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    acceptBtn.addEventListener('click', () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        modal.classList.remove('active');
        document.body.style.overflow = '';
        // Auto-start the tour on first visit after accepting the disclaimer
        if (!window.DSCPTutorial._isSeen()) {
            setTimeout(() => window.DSCPTutorial.startCurrent(), 400);
        }
    });
}

// ============== Feedback Widget ==============

const FeedbackWidget = {
    _RATING_ICONS: {
        4: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
        3: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
        2: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
        1: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>',
    },
    _RATING_LABELS: { 4: 'Excellent', 3: 'Good', 2: 'Okay', 1: 'Poor' },

    show(container, appKey, genIdGetter) {
        if (!container) return;
        if (container.querySelector('.feedback-widget')) return;
        const widget = document.createElement('div');
        widget.className = 'feedback-widget';
        widget.innerHTML = this._html();
        container.appendChild(widget);
        this._bind(widget, appKey, genIdGetter);
    },

    _html() {
        const buttons = [4, 3, 2, 1].map(r =>
            `<button class="feedback-rating-btn" data-rating="${r}" title="${this._RATING_LABELS[r]}" aria-label="${this._RATING_LABELS[r]}">${this._RATING_ICONS[r]}<span>${this._RATING_LABELS[r]}</span></button>`
        ).join('');
        return `
            <div class="feedback-inner">
                <p class="feedback-prompt">How was this result?</p>
                <div class="feedback-ratings">${buttons}</div>
                <p class="feedback-thanks" style="display:none">Thank you for your feedback!</p>
            </div>`;
    },

    _bind(widget, appKey, genIdGetter) {
        widget.querySelectorAll('.feedback-rating-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const rating = parseInt(btn.dataset.rating, 10);
                widget.querySelectorAll('.feedback-rating-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this._submit(widget, appKey, genIdGetter, rating);
            });
        });
    },

    async _submit(widget, appKey, genIdGetter, rating) {
        const genId = typeof genIdGetter === 'function' ? genIdGetter() : null;
        try {
            await Utils.apiRequest(`/api/feedback/${encodeURIComponent(appKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gen_id: genId || null, rating }),
            });
            widget.querySelector('.feedback-ratings').style.display = 'none';
            widget.querySelector('.feedback-prompt').style.display = 'none';
            widget.querySelector('.feedback-thanks').style.display = 'block';
            setTimeout(() => { widget.remove(); }, 3000);
        } catch {
            showToast('Failed to submit feedback.', 'error');
        }
    },
};

// ------------------------------------------------------------
// DSCPTutorial - Driver.js powered interactive tour system
// ------------------------------------------------------------

window.DSCPTutorial = (() => {
    const STORAGE_KEY = 'dscp_tutorial_seen';
    const DRIVER_JS_URL = '/static/js/driver.iife.js';
    const DRIVER_CSS_URL = 'https://cdn.jsdelivr.net/npm/driver.js@1.3.6/dist/driver.css';

    // Pathname prefix ? tour key mapping
    const PATH_MAP = {
        '/': 'homepage',
        '/diagram-generator': 'diagram-generator',
        '/signavio-bpmn': 'signavio-bpmn',
        '/ppt-creator': 'ppt-creator',
        '/audit-check': 'audit-check',
        '/bpmn-checker': 'bpmn-checker',
        '/one-pager-creator': 'one-pager-creator',
        '/spec-builder': 'spec-builder',
        '/docupedia-publisher': 'docupedia-publisher',
    };

    const _registry = {};
    let _activeTour = null;
    let _didComplete = false;
    let _driverLoadPromise = null;

    // -- Shared step builder helpers --------------------------

    function _icon(svgPath, size = 18) {
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
    }

    function _progressHTML(current, total) {
        const pct = Math.round((current / total) * 100);
        return `<div class="dscp-tour-progress">
            <span class="dscp-tour-progress-label">Step ${current} of ${total}</span>
            <div class="dscp-tour-progress-bar"><div class="dscp-tour-progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }

    function _driverFactory() {
        return window.driver && window.driver.js && typeof window.driver.js.driver === 'function'
            ? window.driver.js.driver
            : null;
    }

    function _ensureDriverCss() {
        const existing = document.querySelector(`link[data-dscp-driver-css="1"], link[href="${DRIVER_CSS_URL}"]`);
        if (existing) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = DRIVER_CSS_URL;
            link.dataset.dscpDriverCss = '1';
            link.onload = () => resolve();
            link.onerror = () => reject(new Error('Failed to load Driver CSS'));
            document.head.appendChild(link);
        });
    }

    function _ensureDriverScript() {
        if (_driverFactory()) {
            return Promise.resolve();
        }

        const existing = document.querySelector(`script[data-dscp-driver-js="1"], script[src="${DRIVER_JS_URL}"]`);
        if (existing) {
            return new Promise((resolve, reject) => {
                if (_driverFactory()) {
                    resolve();
                    return;
                }

                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error('Failed to load Driver script')), { once: true });
            });
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = DRIVER_JS_URL;
            script.async = true;
            script.dataset.dscpDriverJs = '1';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Driver script'));
            document.body.appendChild(script);
        });
    }

    function _ensureDriverAssets() {
        if (_driverFactory()) {
            return Promise.resolve(true);
        }

        if (!_driverLoadPromise) {
            _driverLoadPromise = Promise.all([_ensureDriverCss(), _ensureDriverScript()])
                .then(() => !!_driverFactory())
                .catch((err) => {
                    console.error('DSCPTutorial: Failed to lazy-load Driver assets.', err);
                    return false;
                })
                .finally(() => {
                    _driverLoadPromise = null;
                });
        }

        return _driverLoadPromise;
    }

    function _driverSide(attachTo) {
        const on = (attachTo && attachTo.on) || 'bottom';
        if (on === 'top' || on === 'right' || on === 'bottom' || on === 'left') {
            return on;
        }
        return 'bottom';
    }

    function _ensureElementInView(target) {
        if (!target || target.id === 'driver-dummy-element') return;

        window.setTimeout(() => {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            });
        }, 40);
    }

    function _injectLockedControls(popover) {
        if (!popover || !popover.footerButtons || popover.footerButtons.querySelector('.dscp-tour-skip-btn')) {
            return;
        }

        // Skip - completely custom class so Driver.js event delegation never intercepts it
        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.className = 'dscp-tour-skip-btn';
        skipBtn.textContent = 'Skip';
        skipBtn.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            e.preventDefault();
            if (!_activeTour) return;
            _didComplete = false;
            _activeTour.destroy();
        });
        popover.footerButtons.prepend(skipBtn);

        // Close × button pinned to the right side of the title header
        if (popover.title && !popover.title.querySelector('.dscp-tour-close-btn')) {
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'dscp-tour-close-btn';
            closeBtn.setAttribute('aria-label', 'Close tutorial');
            closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>';
            closeBtn.addEventListener('click', (e) => {
                e.stopImmediatePropagation();
                e.preventDefault();
                if (!_activeTour) return;
                _didComplete = true;
                _activeTour.destroy();
            });
            popover.title.appendChild(closeBtn);
        }
    }

    function _toDriverSteps(stepsData) {
        const total = stepsData.length;

        return stepsData.map((step, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === total - 1;
            const popover = {
                title: step.title,
                description: `${step.text}${_progressHTML(idx + 1, total)}`,
                popoverClass: 'dscp-driver-popover',
                showButtons: isFirst ? ['next'] : ['previous', 'next'],
                side: step.attachTo ? _driverSide(step.attachTo) : 'over',
                align: 'center',
                nextBtnText: isLast ? 'Finish' : 'Next →',
                prevBtnText: '← Back',
                onPopoverRender: (popover) => _injectLockedControls(popover),
                onHighlightStarted: (el) => _ensureElementInView(el),
                onPrevClick: () => {
                    if (!_activeTour) return;
                    if (isFirst) {
                        return;
                    }
                    _activeTour.movePrevious();
                },
                onNextClick: () => {
                    if (!_activeTour) return;
                    if (isLast) {
                        _didComplete = true;
                        _activeTour.destroy();
                        return;
                    }
                    _activeTour.moveNext();
                }
            };

            if (step.attachTo && step.attachTo.element) {
                return {
                    element: step.attachTo.element,
                    popover,
                };
            }

            return { popover };
        });
    }

    // -- Tour builder -----------------------------------------

    function _buildTour(stepsData) {
        const factory = _driverFactory();
        if (!factory) {
            console.warn('DSCPTutorial: Driver.js not loaded yet.');
            showToast('Tutorial could not start because Driver.js did not load. Please refresh the page.', 'warning', 4500);
            return null;
        }

        _didComplete = false;

        let _keyDismissHandler = null;

        const tour = factory({
            animate: true,
            smoothScroll: true,
            allowClose: false,
            allowKeyboardControl: false,
            overlayOpacity: 0.62,
            stagePadding: 8,
            stageRadius: 10,
            showProgress: false,
            popoverClass: 'dscp-driver-popover',
            onDestroyed: () => {
                if (_keyDismissHandler) {
                    document.removeEventListener('keydown', _keyDismissHandler, true);
                    _keyDismissHandler = null;
                }
                _markSeen();
                document.getElementById('tutorialBtn')?.classList.remove('tour-active');
                if (_didComplete) {
                    _burstConfetti();
                    _didComplete = false;
                }
            }
        });

        _keyDismissHandler = (e) => {
            // Ignore pure modifier keys
            if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) return;
            e.stopImmediatePropagation();
            if (_activeTour && _activeTour.isActive()) {
                _didComplete = false;
                _activeTour.destroy();
            }
        };
        document.addEventListener('keydown', _keyDismissHandler, true);

        tour.setSteps(_toDriverSteps(stepsData));

        return tour;
    }

    // -- Confetti burst on tour completion -------------------

    function _burstConfetti() {
        const colors = ['#FF6840', '#FF9B59', '#FFD166', '#06D6A0', '#118AB2', '#EF476F'];
        const container = document.createElement('div');
        container.className = 'dscp-confetti-container';
        document.body.appendChild(container);

        const count = 52;

        for (let i = 0; i < count; i++) {
            const piece = document.createElement('div');
            piece.className = 'dscp-confetti-piece';
            piece.style.left = `${Math.random() * 100}%`;
            piece.style.background = colors[i % colors.length];
            piece.style.opacity = (0.65 + Math.random() * 0.35).toFixed(2);
            piece.style.width = `${6 + Math.random() * 8}px`;
            piece.style.height = `${5 + Math.random() * 9}px`;
            piece.style.animationDelay = `${Math.random() * 0.25}s`;
            piece.style.animationDuration = `${1.2 + Math.random() * 1.15}s`;
            piece.style.setProperty('--drift-x', `${(Math.random() - 0.5) * 220}px`);
            piece.style.setProperty('--spin', `${Math.random() > 0.5 ? 1 : -1}`);
            container.appendChild(piece);
        }

        const sparkles = 18;
        for (let i = 0; i < sparkles; i++) {
            const sparkle = document.createElement('div');
            sparkle.className = 'dscp-confetti-sparkle';
            sparkle.style.left = `${Math.random() * 100}%`;
            sparkle.style.animationDelay = `${Math.random() * 0.2}s`;
            sparkle.style.animationDuration = `${0.9 + Math.random() * 0.5}s`;
            container.appendChild(sparkle);
        }

        window.setTimeout(() => container.remove(), 2600);
    }

    // -- localStorage helpers ---------------------------------

    function _markSeen() {
        localStorage.setItem(STORAGE_KEY, 'true');
    }

    function _isSeen() {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    }

    // -- Homepage tour definition -----------------------------

    function _homepageSteps() {
        return [
            {
                id: 'welcome',
                title: `${_icon('<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>')} Welcome to DSCP AI Tools`,
                text: `<p>Hi there! Welcome to <strong>BSH DSCP AI APPS</strong> - your intelligent toolkit for day to day activities.</p>
                       <p>This quick tour takes about 30 seconds and covers everything you need to get started.</p>`,
            },
            {
                id: 'search',
                title: `${_icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>')} Find any app instantly`,
                text: `<p>Use the <strong>search bar</strong> to find the right AI tool fast. It searches by name, category, and description.</p>`,
                attachTo: { element: '.search-box', on: 'bottom' },
            },
            {
                id: 'filters',
                title: `${_icon('<line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>')} Browse by category`,
                text: `<p>Use the <strong>filter chips</strong> to narrow down apps by category: <em>Day to Day</em>, <em>Signavio</em>, or <em>DSCP</em>.</p>`,
                attachTo: { element: '.filter-bar', on: 'bottom' },
            },
            {
                id: 'app-card',
                title: `${_icon('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>')} Your AI toolkit`,
                text: `<p>Each <strong>app card</strong> describes what the tool does. Click <em>Open App</em> to launch it.</p>
                       <p>There are lot of AI-powered tools ready for you to explore.</p>`,
                attachTo: { element: '.app-card', on: 'right' },
            },
            {
                id: 'favourites',
                title: `${_icon('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>')} Pin your favourites`,
                text: `<p>Click the <strong>star icon</strong> on any app card to save it as a favourite. Starred apps get a special glow so you can find them instantly.</p>`,
                attachTo: { element: '.fav-star-btn', on: 'left' },
            },
            {
                id: 'theme',
                title: `${_icon('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>')} Light &amp; Dark mode`,
                text: `<p>Toggle between <strong>light and dark mode</strong> any time with this button. Your preference is saved automatically.</p>`,
                attachTo: { element: '#themeToggle', on: 'bottom' },
            },
            {
                id: 'changelog',
                title: `${_icon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 22h4"/>')} What's new`,
                text: `<p>The <strong>bell</strong> lights up whenever there's a new release. Click it to see what features and fixes have landed.</p>`,
                attachTo: { element: '#changelogBell', on: 'bottom' },
            },
            {
                id: 'tutorial-btn',
                title: `${_icon('<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>')} Replay this tour anytime`,
                text: `<p>Forgot something? Click this <strong>Tutorial button</strong> anytime to restart the guided tour for any App you're on.</p>`,
                attachTo: { element: '#tutorialBtn', on: 'bottom' },
            },
            {
                id: 'done',
                title: `${_icon('<path d="M20 6 9 17l-5-5"/>')} You\'re all set!`,
                text: `<p>You now know your way around DSCP AI. Each feature page also has its own tour - just click the Tutorial button once you're inside an app.</p>
                       <p><strong>Happy building!</strong></p>`,
            },
        ];
    }

    async function _startWithSteps(stepsData) {
        const ok = await _ensureDriverAssets();
        if (!ok) {
            showToast('Tutorial assets failed to load. Please check your connection and try again.', 'warning', 4500);
            return;
        }

        if (_activeTour && _activeTour.isActive()) {
            _activeTour.destroy();
        }

        _activeTour = _buildTour(stepsData);
        if (_activeTour) {
            document.getElementById('tutorialBtn')?.classList.add('tour-active');
            _activeTour.drive();
        }
    }

    // -- Public API -------------------------------------------

    return {
        _isSeen,
        _markSeen,

        register(key, stepsFactory) {
            _registry[key] = stepsFactory;
        },

        async startHomepage() {
            const steps = _homepageSteps();
            await _startWithSteps(steps);
        },

        async startCurrent() {
            // Detect current page key from pathname
            const path = window.location.pathname.replace(/\/$/, '') || '/';
            const key = PATH_MAP[path] || null;

            if (key && _registry[key]) {
                await _startWithSteps(_registry[key]());
                return;
            }

            // Fallback: homepage tour or generic message
            if (path === '/') {
                await this.startHomepage();
            } else {
                showToast('No tour available for this page yet. Check back soon!', 'info', 3000);
            }
        },

        async start(key) {
            if (_registry[key]) {
                await _startWithSteps(_registry[key]());
            }
        }
    };
})();
