/**
 * Common functionality for BSH DSCP AI
 */

document.addEventListener('DOMContentLoaded', () => {
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

