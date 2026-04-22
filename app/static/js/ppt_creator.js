/**
 * PPT Creator – frontend controller.
 * Handles PDF upload, AI extraction, chat refinement,
 * result summary, and PPTX download.
 */
document.addEventListener('DOMContentLoaded', () => {
    const app = new PptCreatorApp();
});

class PptCreatorApp {
    constructor() {
        this.files = [];
        this.chatHistoryId = null;
        this.currentContent = null;
        this.currentGenId = null;     // set after first save; used to update on re-download
        this.refinementCount = 0;     // increments on each refine+download cycle
        this.MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        this.MAX_IMAGES = 3;
        this.userId = (typeof window.__PPT_USER_ID__ !== 'undefined') ? window.__PPT_USER_ID__ : 'Guest';
        this.init();
    }

    /* ── Bootstrap ────────────────────────────────────── */

    init() {
        this.setupUpload();
        this.setupEventListeners();
        this.setupTabs();
    }

    /* ── Upload handling ──────────────────────────────── */

    setupUpload() {
        const uploadArea = document.getElementById('upload-area');
        const fileInput  = document.getElementById('file-input');

        uploadArea.addEventListener('click', () => fileInput.click());

        uploadArea.addEventListener('dragover', e => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', e => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            this.addFiles(e.dataTransfer.files);
        });

        fileInput.addEventListener('change', () => {
            this.addFiles(fileInput.files);
            fileInput.value = '';
        });
    }

    addFiles(fileList) {
        for (const f of fileList) {
            const nameLower = f.name.toLowerCase();
            const isPdf  = f.type === 'application/pdf' || nameLower.endsWith('.pdf');
            const isImage = ['image/png', 'image/jpeg'].includes(f.type)
                         || nameLower.endsWith('.png') || nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg');
            if (isPdf || isImage) {
                // Check if file already exists
                if (this.files.some(existing => existing.name === f.name && existing.size === f.size)) {
                    continue;
                }

                // Check max image limit
                if (isImage) {
                    const currentImageCount = this.files.filter(ef => {
                        const n = ef.name.toLowerCase();
                        return n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg');
                    }).length;
                    if (currentImageCount >= this.MAX_IMAGES) {
                        showToast(`Cannot add "${f.name}" — maximum ${this.MAX_IMAGES} images allowed.`, 'error');
                        continue;
                    }
                }
                
                // Check total size limit (10MB across all files)
                const currentTotal = this.files.reduce((sum, file) => sum + file.size, 0);
                const newTotal = currentTotal + f.size;
                
                if (newTotal > this.MAX_FILE_SIZE) {
                    showToast(
                        `Cannot add "${f.name}" — adding this file (${formatFileSize(f.size)}) would exceed the 10 MB upload limit.`,
                        'error'
                    );
                    continue;
                }
                
                this.files.push(f);
            } else {
                showToast(`Skipped "${f.name}" – only PDF, PNG, JPG, or JPEG files are accepted`, 'warning');
            }
        }
        this.renderFilesList();
        this.updateExtractBtn();
    }

    renderFilesList() {
        const section = document.getElementById('files-list-section');
        const list    = document.getElementById('files-list');
        if (!this.files.length) {
            section.style.display = 'none';
            return;
        }
        section.style.display = 'block';
        
        // Calculate total size
        const totalSize = this.files.reduce((sum, file) => sum + file.size, 0);
        const totalSizeStr = formatFileSize(totalSize);
        const limitStr = formatFileSize(this.MAX_FILE_SIZE);
        
        list.innerHTML = this.files.map((f, i) => {
            const isImg = !f.name.toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf';
            return `
            <div class="file-item">
                <span class="file-icon">${isImg ? '🖼️' : '📄'}</span>
                <span class="file-name">${escapeHtml(f.name)}</span>
                <span class="file-size">${formatFileSize(f.size)}</span>
                <button class="btn btn-ghost btn-sm file-remove" data-index="${i}">✕</button>
            </div>
        `;
        }).join('') + `
            <div class="file-item total-size">
                <span class="file-icon">📊</span>
                <span class="file-name"><strong>Total Size</strong></span>
                <span class="file-size"><strong>${totalSizeStr} / ${limitStr}</strong></span>
                <span style="width: 24px;"></span>
            </div>
        `;

        list.querySelectorAll('.file-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                this.files.splice(+btn.dataset.index, 1);
                this.renderFilesList();
                this.updateExtractBtn();
            });
        });
    }

    /* ── Event listeners ──────────────────────────────── */

    setupEventListeners() {
        document.getElementById('add-more-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });

        document.getElementById('extract-btn').addEventListener('click', () => this.extractContent());
        document.getElementById('reset-btn').addEventListener('click', ()   => this.handleResetRequest());
        document.getElementById('download-btn').addEventListener('click', () => this.downloadPptx());

        document.getElementById('chat-send-btn').addEventListener('click', () => this.sendChatMessage());
        document.getElementById('chat-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        });

        document.getElementById('history-refresh-btn')?.addEventListener('click', () => this.loadHistory());
        document.getElementById('history-go-generate-btn')?.addEventListener('click', () => this.switchTab('generate'));
    }

    updateExtractBtn() {
        document.getElementById('extract-btn').disabled = this.files.length === 0;
    }

    isOrangeThemeEnabled() {
        return Boolean(document.getElementById('orange-theme-toggle')?.checked);
    }

    /* ── Extract content ──────────────────────────────── */

    async extractContent() {
        if (!this.files.length) return;

        const userName = document.getElementById('user-name').value.trim();
        if (!userName) {
            showToast('Please enter your name before generating the presentation.', 'warning');
            document.getElementById('user-name').focus();
            return;
        }

        this.showLoading('Creating presentation from Your Content…');

        const formData = new FormData();
        this.files.forEach(f => formData.append('files', f));
        formData.append('username', userName);
        formData.append('force_orange_theme', this.isOrangeThemeEnabled() ? 'true' : 'false');
        const instructions = document.getElementById('user-instructions').value.trim();
        if (instructions) formData.append('instructions', instructions);

        try {
            const res  = await fetch('/api/ppt/extract', { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok || data.error || data.status === 'error') {
                AppLogger.error('PPT extraction failed', { message: data.message, detail: data.detail });
                this.hideLoading();
                const title = data.message || 'Extraction Failed';
                const detail = data.detail || 'The AI service could not process your document. Please try again later.';
                this.showError(title, detail);
                return;
            }

            if (!data.content || !data.content.slides || data.content.slides.length === 0) {
                this.hideLoading();
                this.showError(
                    'No Slides Generated',
                    'The AI could not extract meaningful content from the PDF. The document may be image-based, scanned, or empty. Try a different file or provide additional instructions.'
                );
                return;
            }

            this.currentContent = data.content;
            this.chatHistoryId  = data.chatHistoryId;

            this.hideLoading();
            this.showResult();
            document.getElementById('chat-container').style.display = 'block';
            showToast('Presentation generated successfully!', 'success');
        } catch (err) {
            AppLogger.error('PPT extraction connection error:', err);
            this.hideLoading();
            this.showError('Connection Error', 'Unable to connect to the server. Please check your connection and try again.');
        }
    }

    /* ── Chat / Refine ────────────────────────────────── */

    async sendChatMessage() {
        const input = document.getElementById('chat-input');
        const msg   = input.value.trim();
        if (!msg) return;

        this.appendChat('user', msg);
        input.value = '';

        this.appendChat('assistant', '⏳ Thinking…');
        const thinkingEl = document.querySelector('#chat-messages .chat-msg:last-child');

        try {
            const res  = await fetch('/api/ppt/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatHistoryId: this.chatHistoryId,
                    message: msg,
                    currentContent: this.currentContent,
                    forceOrangeTheme: this.isOrangeThemeEnabled(),
                }),
            });
            const data = await res.json();

            if (thinkingEl) thinkingEl.remove();

            if (data.error) {
                AppLogger.error('PPT refinement failed:', data.message);
                this.appendChat('assistant', 'Something went wrong while updating the presentation. Please try again.');
                return;
            }

            if (data.content) {
                this.currentContent = data.content;
                this.chatHistoryId  = data.chatHistoryId || this.chatHistoryId;
                this.showResult();
                this.appendChat('assistant', 'Presentation updated! Check the result panel.');
            } else {
                this.appendChat('assistant', data.result || 'No structured update received.');
            }
        } catch (err) {
            if (thinkingEl) thinkingEl.remove();
            AppLogger.error('PPT chat error:', err);
            this.appendChat('assistant', 'Unable to connect to the server. Please try again.');
        }
    }

    appendChat(role, text) {
        const msgs = document.getElementById('chat-messages');
        const div  = document.createElement('div');
        div.className = `chat-msg chat-${role}`;
        div.textContent = text;
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
    }

    /* ── Error display ────────────────────────────────── */

    showError(title, detail) {
        const resultPanel = document.getElementById('result-panel');
        const emptyState  = document.getElementById('empty-state');
        const resultInfo  = document.getElementById('result-info');

        if (emptyState)  emptyState.style.display = 'none';
        if (resultPanel) resultPanel.style.display = 'flex';
        const dlRow = document.getElementById('download-btn')?.closest('.result-actions');
        if (dlRow) dlRow.style.display = 'none';

        let html = '<div class="result-error">';
        html += '<span class="error-icon">⚠️</span>';
        html += `<h4 class="error-title">${escapeHtml(title)}</h4>`;
        html += `<p class="error-detail">${escapeHtml(detail)}</p>`;
        html += '<p class="error-hint">You can try uploading a different PDF or add more specific instructions.</p>';
        html += '</div>';

        resultInfo.innerHTML = html;
        showToast(title, 'error');
    }

    /* ── Result panel ─────────────────────────────────── */

    showResult() {
        const content = this.currentContent;
        if (!content || !content.slides) return;

        const resultPanel = document.getElementById('result-panel');
        const emptyState  = document.getElementById('empty-state');
        const resultInfo  = document.getElementById('result-info');

        if (emptyState)  emptyState.style.display = 'none';
        if (resultPanel) resultPanel.style.display = 'flex';

        // Re-show download row (may have been hidden by showError)
        const dlRow = document.getElementById('download-btn')?.closest('.result-actions');
        if (dlRow) dlRow.style.display = '';

        const slides = content.slides;
        const layoutCounts = {};
        slides.forEach(s => {
            const l = s.layout || 'content';
            layoutCounts[l] = (layoutCounts[l] || 0) + 1;
        });

        let html = '';

        /* Title & Subtitle */
        html += '<div class="result-header">';
        html += `<h4 class="result-title">${escapeHtml(content.title || 'Untitled Presentation')}</h4>`;
        if (content.subtitle) {
            html += `<p class="result-subtitle">${escapeHtml(content.subtitle)}</p>`;
        }
        html += '</div>';

        /* Stats */
        const smartArtCount = slides.filter(s => s.layout === 'smart_art').length;
        const imageCount    = slides.filter(s => s.image_description).length;

        html += '<div class="result-stats">';
        html += `<div class="stat-item"><span class="stat-value">${slides.length}</span><span class="stat-label">Slides</span></div>`;
        html += `<div class="stat-item"><span class="stat-value">${Object.keys(layoutCounts).length}</span><span class="stat-label">Layouts</span></div>`;
        if (smartArtCount) {
            html += `<div class="stat-item"><span class="stat-value">${smartArtCount}</span><span class="stat-label">SmartArt</span></div>`;
        }
        if (imageCount) {
            html += `<div class="stat-item"><span class="stat-value">${imageCount}</span><span class="stat-label">Placeholders</span></div>`;
        }
        html += '</div>';

        /* Slide breakdown */
        html += '<div class="result-slides-list">';
        html += '<h5>Slide Breakdown</h5>';
        slides.forEach((s, i) => {
            const layout = (s.layout || 'content').replace(/_/g, ' ');
            const icon   = this.getLayoutIcon(s.layout);
            html += '<div class="result-slide-row">';
            html += `<span class="slide-num">${i + 1}</span>`;
            html += `<span class="slide-info">${escapeHtml(s.title || '(No title)')}</span>`;
            html += `<span class="slide-layout-tag">${icon} ${layout}</span>`;
            html += '</div>';
        });
        html += '</div>';

        resultInfo.innerHTML = html;

        // Stagger slide rows in
        requestAnimationFrame(() => {
            resultInfo.querySelectorAll('.result-slide-row').forEach((row, i) => {
                setTimeout(() => row.classList.add('row-visible'), 60 + i * 40);
            });
            // Count-up stat values (entrance handled by CSS animation)
            resultInfo.querySelectorAll('.stat-item').forEach((item, i) => {
                const valEl = item.querySelector('.stat-value');
                if (!valEl) return;
                const target = parseInt(valEl.textContent, 10);
                if (!isNaN(target) && target > 0) {
                    setTimeout(() => this.countUp(valEl, target, 600), 100 + i * 80);
                }
            });
        });
    }

    getLayoutIcon(layout) {
        const icons = {
            title_slide:        '🎯',
            chapter:            '📖',
            content:            '📝',
            smart_art:          '✨',
            content_with_image: '🖼️',
            image_with_content: '🖼️',
            two_columns:        '▪▪',
            three_columns:      '▪▪▪',
            four_quadrants:     '⊞',
            full_image:         '🌄',
            title_only:         '🏷️',
            end_slide:          '🏁',
        };
        return icons[layout] || '📄';
    }

    /* ── Download ─────────────────────────────────────── */

    async downloadPptx() {
        if (!this.currentContent) return;

        const btn = document.getElementById('download-btn');
        const originalHTML = btn.innerHTML;
        btn.classList.add('downloading');
        btn.innerHTML = '<span class="btn-icon">⏳</span> Preparing…';

        const userName = document.getElementById('user-name').value.trim() || 'Unknown User';

        try {
            const res = await fetch('/api/ppt/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: this.currentContent,
                    username: userName,
                    forceOrangeTheme: this.isOrangeThemeEnabled(),
                }),
            });

            if (!res.ok) {
                const err = await res.json();
                AppLogger.error('PPT download failed:', err.message || err.detail);
                showToast('Download failed. Please try again.', 'error');
                btn.innerHTML = originalHTML;
                btn.classList.remove('downloading');
                return;
            }

            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = (this.currentContent.title || 'Presentation').replace(/[^a-zA-Z0-9 _-]/g, '') + '.pptx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            btn.innerHTML = '<span class="btn-icon">✅</span> Downloaded!';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.classList.remove('downloading');
            }, 2000);
            showToast('Download started!', 'success');

            // Auto-save / update history silently
            await this._persistToHistory();
        } catch (err) {
            AppLogger.error('PPT download error:', err);
            showToast('Download failed. Please try again.', 'error');
            btn.innerHTML = originalHTML;
            btn.classList.remove('downloading');
        }
    }

    /* ── UI helpers ───────────────────────────────────── */

    showLoading(text) {
        document.getElementById('empty-state').style.display   = 'none';
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';
        const messages = text
            ? [text, 'Analyzing document structure', 'Designing slide layouts', 'Building presentation']
            : ['Processing…'];
        LoadingPanel.show('loading-state', { messages });
    }

    hideLoading() {
        LoadingPanel.hide('loading-state');
    }

    handleResetRequest() {
        if (typeof showConfirmation === 'function') {
            showConfirmation(
                'Clear All Data?',
                'Are you sure you want to reset uploaded files and generated content? This cannot be undone.',
                () => this.resetAll(),
                {
                    icon: '⚠️',
                    confirmText: 'Clear Data',
                    cancelText: 'Cancel'
                }
            );
            return;
        }

        // Fallback for pages where the shared modal helper is unavailable.
        this.resetAll();
    }

    resetAll() {
        this.files          = [];
        this.chatHistoryId  = null;
        this.currentContent = null;
        this.currentGenId   = null;
        this.refinementCount = 0;

        this.renderFilesList();
        this.updateExtractBtn();
        document.getElementById('user-name').value                  = '';
        document.getElementById('user-instructions').value          = '';
        const orangeToggle = document.getElementById('orange-theme-toggle');
        if (orangeToggle) orangeToggle.checked = false;
        document.getElementById('chat-container').style.display     = 'none'
        document.getElementById('chat-messages').innerHTML          = '';
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';
        document.getElementById('empty-state').style.display        = 'flex';
        document.getElementById('loading-state').style.display      = 'none';
    }

    countUp(el, target, duration) {
        const start = performance.now();
        const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(eased * target);
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }


}


/* ── Tab switching ────────────────────────────────────────── */

PptCreatorApp.prototype.setupTabs = function () {
    document.querySelectorAll('.ppt-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });
};

PptCreatorApp.prototype.switchTab = function (tab) {
    document.querySelectorAll('.ppt-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.ppt-tab-panel').forEach(p => {
        p.style.display = p.id === `tab-${tab}` ? '' : 'none';
    });
    if (tab === 'history') this.loadHistory();
};

/* ── History — persist ────────────────────────────────────── */

PptCreatorApp.prototype._persistToHistory = async function () {
    if (!this.currentContent || !this.chatHistoryId) return;
    try {
        if (!this.currentGenId) {
            // First download for this session — create new entry
            const res = await fetch('/api/ppt/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: this.currentContent,
                    chatHistoryId: this.chatHistoryId,
                    forceOrangeTheme: this.isOrangeThemeEnabled(),
                }),
            });
            if (res.ok) {
                const d = await res.json();
                this.currentGenId = d.genId || null;
            }
        } else {
            // Subsequent download after refinements — update existing entry
            await fetch(`/api/ppt/history/${this.currentGenId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: this.currentContent }),
            });
        }
    } catch (err) {
        AppLogger.error('History auto-save failed (non-critical):', err);
    }
};

/* ── History — list ───────────────────────────────────────── */

PptCreatorApp.prototype.loadHistory = async function () {
    const grid    = document.getElementById('history-grid');
    const empty   = document.getElementById('history-empty');
    const loading = document.getElementById('history-loading');

    grid.innerHTML   = '';
    empty.style.display   = 'none';
    loading.style.display = 'flex';

    try {
        const res  = await fetch('/api/ppt/history');
        const data = await res.json();
        loading.style.display = 'none';

        if (!res.ok || data.status === 'error') {
            grid.innerHTML = `<p class="history-error">Could not load history. Please try again.</p>`;
            return;
        }

        const history = data.history || [];
        if (!history.length) {
            empty.style.display = 'flex';
            return;
        }

        grid.innerHTML = history.map(e => this._renderCard(e)).join('');

        grid.querySelectorAll('[data-action="load"]').forEach(btn => {
            btn.addEventListener('click', () => this.loadGeneration(btn.dataset.id, btn.dataset.chatHistoryId));
        });
        grid.querySelectorAll('[data-action="download"]').forEach(btn => {
            btn.addEventListener('click', () => this.downloadFromHistory(btn.dataset.id, btn.dataset.title));
        });
        grid.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', () => this.deleteGeneration(btn.dataset.id, btn.closest('.gen-card')));
        });
    } catch (err) {
        loading.style.display = 'none';
        AppLogger.error('History load error:', err);
        grid.innerHTML = `<p class="history-error">Connection error loading history.</p>`;
    }
};

PptCreatorApp.prototype._renderCard = function (entry) {
    const date      = entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : '—';
    const time      = entry.updatedAt ? new Date(entry.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const refined   = entry.refinements > 0 ? `<span class="gen-badge gen-badge-refined">${entry.refinements} refinement${entry.refinements > 1 ? 's' : ''}</span>` : '';
    const orange    = entry.forceOrangeTheme ? `<span class="gen-badge gen-badge-orange">🎨 Orange</span>` : '';
    const subtitle  = entry.subtitle ? `<p class="gen-card-subtitle">${escapeHtml(entry.subtitle)}</p>` : '';
    return `
    <div class="gen-card" data-gen-id="${escapeHtml(entry.id)}">
        <div class="gen-card-body">
            <div class="gen-card-title-row">
                <span class="gen-card-title">${escapeHtml(entry.title || 'Untitled')}</span>
                <div class="gen-card-badges">${refined}${orange}</div>
            </div>
            ${subtitle}
            <div class="gen-card-meta">
                <span class="gen-meta-item">📊 ${entry.slideCount || 0} slides</span>
                ${entry.smartArtCount ? `<span class="gen-meta-item">✨ ${entry.smartArtCount} SmartArt</span>` : ''}
                <span class="gen-meta-item">🕐 ${date} ${time}</span>
            </div>
        </div>
        <div class="gen-card-actions">
            <button class="btn btn-secondary btn-sm" data-action="load" data-id="${escapeHtml(entry.id)}" data-chat-history-id="${escapeHtml(entry.chatHistoryId || '')}">
                📂 Load &amp; Edit
            </button>
            <button class="btn btn-primary btn-sm" data-action="download" data-id="${escapeHtml(entry.id)}" data-title="${escapeHtml(entry.title || 'Presentation')}">
                ⬇️ Download
            </button>
            <button class="btn btn-ghost btn-sm btn-danger" data-action="delete" data-id="${escapeHtml(entry.id)}">
                🗑️
            </button>
        </div>
    </div>`;
};

/* ── History — load generation into editor ────────────────── */

PptCreatorApp.prototype.loadGeneration = async function (genId, chatHistoryId) {
    try {
        const res  = await fetch(`/api/ppt/history/${encodeURIComponent(genId)}`);
        const data = await res.json();
        if (!res.ok || !data.content) {
            showToast('Could not load this generation.', 'error');
            return;
        }
        this.currentContent  = data.content;
        this.chatHistoryId   = chatHistoryId || null;
        this.currentGenId    = genId;
        this.refinementCount = 0;

        this.switchTab('generate');
        this.showResult();
        document.getElementById('chat-container').style.display = 'block';
        showToast('Generation loaded — you can continue refining it.', 'success');
    } catch (err) {
        AppLogger.error('Load generation error:', err);
        showToast('Failed to load generation.', 'error');
    }
};

/* ── History — download from history ─────────────────────── */

PptCreatorApp.prototype.downloadFromHistory = async function (genId, title) {
    const userName = this.userId || 'Unknown User';
    try {
        const res = await fetch(`/api/ppt/history/${encodeURIComponent(genId)}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: userName, forceOrangeTheme: false }),
        });
        if (!res.ok) {
            showToast('Download failed. Please try again.', 'error');
            return;
        }
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = (title || 'Presentation').replace(/[^a-zA-Z0-9 _-]/g, '') + '.pptx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('Download started!', 'success');
    } catch (err) {
        AppLogger.error('History download error:', err);
        showToast('Download failed.', 'error');
    }
};

/* ── History — delete ─────────────────────────────────────── */

PptCreatorApp.prototype.deleteGeneration = function (genId, cardEl) {
    if (typeof showConfirmation === 'function') {
        showConfirmation(
            'Delete Generation?',
            'This will permanently remove this presentation from your history.',
            () => this._doDelete(genId, cardEl),
            { icon: '🗑️', confirmText: 'Delete', cancelText: 'Cancel' }
        );
    } else {
        this._doDelete(genId, cardEl);
    }
};

PptCreatorApp.prototype._doDelete = async function (genId, cardEl) {
    try {
        const res = await fetch(`/api/ppt/history/${encodeURIComponent(genId)}`, { method: 'DELETE' });
        if (res.ok) {
            cardEl?.remove();
            // If grid is now empty, show empty state
            if (!document.querySelector('.gen-card')) {
                document.getElementById('history-empty').style.display = 'flex';
            }
            // Clear currentGenId if we just deleted the active generation
            if (this.currentGenId === genId) this.currentGenId = null;
            showToast('Generation deleted.', 'success');
        } else {
            showToast('Could not delete this generation.', 'error');
        }
    } catch (err) {
        AppLogger.error('Delete generation error:', err);
        showToast('Failed to delete generation.', 'error');
    }
};

