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
        this.MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        this.init();
    }

    /* ── Bootstrap ────────────────────────────────────── */

    init() {
        this.setupUpload();
        this.setupEventListeners();
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
            if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
                // Check if file already exists
                if (this.files.some(existing => existing.name === f.name && existing.size === f.size)) {
                    continue;
                }
                
                // Check total size limit (10MB across all files)
                const currentTotal = this.files.reduce((sum, file) => sum + file.size, 0);
                const newTotal = currentTotal + f.size;
                
                if (newTotal > this.MAX_FILE_SIZE) {
                    const remaining = this.MAX_FILE_SIZE - currentTotal;
                    showToast(
                        `Cannot add "${f.name}" (${this.formatSize(f.size)}). ` +
                        `Total upload limit is 10 MB. Current: ${this.formatSize(currentTotal)}, ` +
                        `Available: ${this.formatSize(remaining)}.`,
                        'error'
                    );
                    continue;
                }
                
                this.files.push(f);
            } else {
                showToast(`Skipped "${f.name}" – only PDF files are accepted`, 'warning');
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
        const totalSizeStr = this.formatSize(totalSize);
        const limitStr = this.formatSize(this.MAX_FILE_SIZE);
        
        list.innerHTML = this.files.map((f, i) => `
            <div class="file-item">
                <span class="file-icon">📄</span>
                <span class="file-name">${this.esc(f.name)}</span>
                <span class="file-size">${this.formatSize(f.size)}</span>
                <button class="btn btn-ghost btn-sm file-remove" data-index="${i}">✕</button>
            </div>
        `).join('') + `
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
        document.getElementById('reset-btn').addEventListener('click', ()   => this.resetAll());
        document.getElementById('download-btn').addEventListener('click', () => this.downloadPptx());

        document.getElementById('chat-send-btn').addEventListener('click', () => this.sendChatMessage());
        document.getElementById('chat-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        });
    }

    updateExtractBtn() {
        document.getElementById('extract-btn').disabled = this.files.length === 0;
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

        this.showLoading('Creating presentation from PDFs…');

        const formData = new FormData();
        this.files.forEach(f => formData.append('files', f));
        formData.append('username', userName);
        const instructions = document.getElementById('user-instructions').value.trim();
        if (instructions) formData.append('instructions', instructions);

        try {
            const res  = await fetch('/api/ppt/extract', { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok || data.error || data.status === 'error') {
                this.hideLoading();
                const title = data.message || 'Extraction Failed';
                const detail = data.detail || 'The AI could not process the uploaded PDF. Try a different file or add more instructions.';
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
            this.hideLoading();
            this.showError('Connection Error', 'Could not reach the server. Please check your connection and try again.');
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
                }),
            });
            const data = await res.json();

            if (thinkingEl) thinkingEl.remove();

            if (data.error) {
                this.appendChat('assistant', `Error: ${data.message}`);
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
            this.appendChat('assistant', 'Error: ' + err.message);
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
        html += `<h4 class="error-title">${this.esc(title)}</h4>`;
        html += `<p class="error-detail">${this.esc(detail)}</p>`;
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
        html += `<h4 class="result-title">${this.esc(content.title || 'Untitled Presentation')}</h4>`;
        if (content.subtitle) {
            html += `<p class="result-subtitle">${this.esc(content.subtitle)}</p>`;
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
            html += `<span class="slide-info">${this.esc(s.title || '(No title)')}</span>`;
            html += `<span class="slide-layout-tag">${icon} ${layout}</span>`;
            html += '</div>';
        });
        html += '</div>';

        resultInfo.innerHTML = html;
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

        const userName = document.getElementById('user-name').value.trim() || 'Unknown User';

        try {
            const res = await fetch('/api/ppt/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    content: this.currentContent,
                    username: userName 
                }),
            });

            if (!res.ok) {
                const err = await res.json();
                showToast(err.message || 'Download failed', 'error');
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
            showToast('Download started!', 'success');
        } catch (err) {
            showToast('Download error: ' + err.message, 'error');
        }
    }

    /* ── UI helpers ───────────────────────────────────── */

    showLoading(text) {
        document.getElementById('empty-state').style.display   = 'none';
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';
        document.getElementById('loading-state').style.display = 'flex';
        document.getElementById('loading-text').textContent    = text || 'Processing…';
    }

    hideLoading() {
        document.getElementById('loading-state').style.display = 'none';
    }

    resetAll() {
        this.files          = [];
        this.chatHistoryId  = null;
        this.currentContent = null;

        this.renderFilesList();
        this.updateExtractBtn();
        document.getElementById('user-name').value                  = '';
        document.getElementById('user-instructions').value          = '';
        document.getElementById('chat-container').style.display     = 'none'
        document.getElementById('chat-messages').innerHTML          = '';
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';
        document.getElementById('empty-state').style.display        = 'flex';
        document.getElementById('loading-state').style.display      = 'none';
    }

    esc(str) {
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }

    formatSize(bytes) {
        if (bytes < 1024)        return bytes + ' B';
        if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }
}
