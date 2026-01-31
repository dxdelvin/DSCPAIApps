/**
 * Common functionality for BSH DSCP AI
 */

document.addEventListener('DOMContentLoaded', () => {
    // App Search Functionality
    initAppSearch();
    
    // Theme Toggle Functionality
    const themeToggle = document.getElementById('themeToggle');
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');
    
    // Check saved theme
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
            
            // Toggle icons
            if (sunIcon) sunIcon.style.display = isDark ? 'none' : 'block';
            if (moonIcon) moonIcon.style.display = isDark ? 'block' : 'none';
            
            // Save preference
            localStorage.setItem('dscp_theme', isDark ? 'dark' : 'light');
        });
    }

    // Changelog toggle functionality
    const changelogBell = document.getElementById('changelogBell');
    const changelogPanel = document.getElementById('changelog');
    const closeChangelog = document.getElementById('closeChangelog');
    
    // Grab the latest version from the first badge in the DOM
    const latestVersionEl = document.querySelector('.badge-version');
    const latestVersion = latestVersionEl ? latestVersionEl.textContent.trim() : 'v1.0.0';
    const storageKey = 'dscp_last_seen_version';
    
    // Check for new version
    const lastSeenVersion = localStorage.getItem(storageKey);
    const hasUpdates = lastSeenVersion !== latestVersion;

    // Show notification dot if updates exist
    if (hasUpdates && changelogBell) {
        const dot = document.createElement('div');
        dot.className = 'badge-dot';
        changelogBell.appendChild(dot);
    }

    // Ensure modal is hidden on page load
    if (changelogPanel) {
        changelogPanel.hidden = true;
    }

    // Toggle changelog panel
    if (changelogBell) {
        changelogBell.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (changelogPanel) {
                changelogPanel.hidden = !changelogPanel.hidden;
                
                // If opening, mark as seen
                if (!changelogPanel.hidden && hasUpdates) {
                    localStorage.setItem(storageKey, latestVersion);
                    const dot = changelogBell.querySelector('.badge-dot');
                    if (dot) dot.remove();
                }
            }
        });
    }

    // Close button
    if (closeChangelog) {
        closeChangelog.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (changelogPanel) {
                changelogPanel.hidden = true;
            }
        });
    }

    // Close when clicking outside
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

    // Create modal if it doesn't exist
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

        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeConfirmation();
            }
        });

        // Close with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                closeConfirmation();
            }
        });
    }

    // Update content
    modal.querySelector('.confirmation-icon').textContent = icon;
    modal.querySelector('.confirmation-title').textContent = title;
    modal.querySelector('.confirmation-message').textContent = message;
    modal.querySelector('#confirm-ok').textContent = confirmText;
    modal.querySelector('#confirm-cancel').textContent = cancelText;

    // Set up handlers
    modal.querySelector('#confirm-cancel').onclick = () => {
        closeConfirmation();
    };

    modal.querySelector('#confirm-ok').onclick = () => {
        closeConfirmation();
        onConfirm();
    };

    // Show modal
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
    
    // Store original content for each card
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
        
        // Toggle clear button
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
        
        // Reset all cards if empty search
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
        
        // Score and filter cards
        const scored = originalData.map(data => {
            const { name, description, tags } = data;
            let score = 0;
            let matchType = null;
            
            // Priority 1: Name match (highest priority)
            if (name.toLowerCase().includes(searchTerm)) {
                score = 300;
                matchType = 'name';
            }
            // Priority 2: Tag match
            else if (tags.some(tag => tag.toLowerCase().includes(searchTerm))) {
                score = 200;
                matchType = 'tag';
            }
            // Priority 3: Description match
            else if (description.toLowerCase().includes(searchTerm)) {
                score = 100;
                matchType = 'description';
            }
            
            return { ...data, score, matchType };
        });
        
        // Sort by score (descending)
        scored.sort((a, b) => b.score - a.score);
        
        let visibleCount = 0;
        
        scored.forEach(({ card, nameEl, descEl, tagEls, name, description, tags, score, matchType }) => {
            if (score === 0) {
                card.classList.add('search-hidden');
                // Reset content
                if (nameEl) nameEl.innerHTML = escapeHtml(name);
                if (descEl) descEl.innerHTML = escapeHtml(description);
                tagEls.forEach((el, i) => el.innerHTML = escapeHtml(tags[i]));
            } else {
                card.classList.remove('search-hidden');
                visibleCount++;
                
                // Highlight matches
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
                
                // Reorder in DOM
                appGrid.appendChild(card);
            }
        });
        
        // Show results info
        if (searchResultsInfo) {
            if (visibleCount > 0) {
                searchResultsInfo.innerHTML = `Found <span class="highlight">${visibleCount}</span> app${visibleCount !== 1 ? 's' : ''} matching "<span class="highlight">${escapeHtml(searchTerm)}</span>"`;
                searchResultsInfo.hidden = false;
            } else {
                searchResultsInfo.hidden = true;
            }
        }
        
        // Show/hide no results message
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
