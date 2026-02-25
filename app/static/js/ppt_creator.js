// ============================================
// PPT CREATOR - Main JavaScript
// ============================================

class PptCreatorApp {
    constructor() {
        this.files = [];
        this.chatHistoryId = null;
        this.currentContent = null;   // parsed JSON from AI
        this.currentSlideIdx = 0;
        this.init();
    }

    // ==================== Initialisation ====================

    init() {
        this.setupUpload();
        this.setupEventListeners();
    }

    // ==================== File Upload ====================

    setupUpload() {
        const dropArea  = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        if (!dropArea || !fileInput) return;

        let dragCounter = 0;

        dropArea.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            this.handleFiles(Array.from(fileInput.files));
            fileInput.value = '';
        });

        dropArea.addEventListener('dragenter', e => {
            e.preventDefault(); e.stopPropagation();
            dragCounter++;
            dropArea.classList.add('dragover');
        });
        dropArea.addEventListener('dragover', e => {
            e.preventDefault(); e.stopPropagation();
        });
        dropArea.addEventListener('dragleave', e => {
            e.preventDefault(); e.stopPropagation();
            dragCounter--;
            if (dragCounter <= 0) { dragCounter = 0; dropArea.classList.remove('dragover'); }
        });
        dropArea.addEventListener('drop', e => {
            e.preventDefault(); e.stopPropagation();
            dragCounter = 0;
            dropArea.classList.remove('dragover');
            const valid = Array.from(e.dataTransfer.files).filter(f => this.isValidFile(f));
            if (valid.length) this.handleFiles(valid);
            else showToast('Only .pptx files are supported', 'warning');
        });
    }

    isValidFile(file) {
        return file.name.toLowerCase().endsWith('.pptx');
    }

    handleFiles(newFiles) {
        const MAX = 10;
        const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

        newFiles.forEach(file => {
            if (this.files.length >= MAX) { showToast(`Maximum ${MAX} files allowed`, 'warning'); return; }
            if (file.size > MAX_SIZE) { showToast(`${file.name} exceeds 25 MB limit`, 'warning'); return; }
            if (!this.isValidFile(file)) { showToast(`${file.name} is not a .pptx file`, 'warning'); return; }
            if (this.files.some(f => f.name === file.name && f.size === file.size)) {
                showToast(`${file.name} already added`, 'warning');
                return;
            }
            this.files.push(file);
        });
        this.renderFileList();
        this.updateExtractBtn();
    }

    renderFileList() {
        const section   = document.getElementById('files-list-section');
        const container = document.getElementById('files-list');
        if (!container) return;

        section.style.display = this.files.length ? 'block' : 'none';
        container.innerHTML = '';

        this.files.forEach((file, idx) => {
            const item = document.createElement('div');
            item.className = 'file-item';
            item.innerHTML = `
                <span class="file-icon">📊</span>
                <div class="file-details">
                    <p class="file-name">${this.esc(file.name)}</p>
                    <p class="file-size">${this.formatSize(file.size)}</p>
                </div>
                <button type="button" class="btn-remove-file" title="Remove">✕</button>
            `;
            item.querySelector('.btn-remove-file').addEventListener('click', () => {
                this.files.splice(idx, 1);
                this.renderFileList();
                this.updateExtractBtn();
                showToast('File removed', 'info');
            });
            container.appendChild(item);
        });
    }

    updateExtractBtn() {
        const btn = document.getElementById('extract-btn');
        if (btn) btn.disabled = this.files.length === 0;
    }

    // ==================== Event Listeners ====================

    setupEventListeners() {
        // Add More
        const addMoreBtn = document.getElementById('add-more-btn');
        if (addMoreBtn) addMoreBtn.addEventListener('click', () => document.getElementById('file-input').click());

        // Extract
        const extractBtn = document.getElementById('extract-btn');
        if (extractBtn) extractBtn.addEventListener('click', () => this.extractContent());

        // Reset
        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) resetBtn.addEventListener('click', () => {
            showConfirmation(
                'Reset All?',
                'Clear all uploaded files and generated content?',
                () => this.resetAll(),
                { icon: '⚠️', confirmText: 'Reset', cancelText: 'Cancel' }
            );
        });

        // Download
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadPptx());

        // Slide navigation
        const prevBtn = document.getElementById('prev-slide-btn');
        const nextBtn = document.getElementById('next-slide-btn');
        if (prevBtn) prevBtn.addEventListener('click', () => this.navigateSlide(-1));
        if (nextBtn) nextBtn.addEventListener('click', () => this.navigateSlide(1));

        // Chat send
        const chatSendBtn = document.getElementById('chat-send-btn');
        if (chatSendBtn) chatSendBtn.addEventListener('click', () => this.sendChatMessage());

        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
            chatInput.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage();
                }
            });
        }
    }

    // ==================== Extract Content ====================

    async extractContent() {
        if (this.files.length === 0) {
            showToast('Please upload at least one PowerPoint file', 'warning');
            return;
        }

        this.showLoading('Analyzing presentations with AI...');

        const formData = new FormData();
        this.files.forEach(f => formData.append('files', f));

        const instructions = document.getElementById('user-instructions')?.value?.trim();
        if (instructions) formData.append('instructions', instructions);

        try {
            const response = await fetch('/api/ppt/extract', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();

            if (data.status !== 'success') {
                showToast(data.detail || data.message || 'Extraction failed', 'error');
                this.hideLoading();
                return;
            }

            this.currentContent = data.content;
            this.chatHistoryId = data.chatHistoryId;
            this.currentSlideIdx = 0;

            this.renderPreview();
            this.showChatPanel();
            this.hideLoading();
            showToast('Content extracted successfully!', 'success');
        } catch (err) {
            console.error('Extract error:', err);
            showToast('Failed to connect to API', 'error');
            this.hideLoading();
        }
    }

    // ==================== Chat / Refine ====================

    async sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input?.value?.trim();
        if (!message || !this.chatHistoryId) return;

        // Show user message
        this.addChatMsg(message, 'user');
        input.value = '';

        // Disable send while loading
        const sendBtn = document.getElementById('chat-send-btn');
        if (sendBtn) sendBtn.disabled = true;

        const formData = new FormData();
        formData.append('chatHistoryId', this.chatHistoryId);
        formData.append('message', message);
        if (this.currentContent) {
            formData.append('currentContent', JSON.stringify(this.currentContent));
        }

        try {
            const response = await fetch('/api/ppt/refine', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();

            if (data.status !== 'success') {
                this.addChatMsg(data.detail || data.message || 'Refine failed', 'ai');
                showToast('Refine request failed', 'error');
            } else if (data.content) {
                this.currentContent = data.content;
                this.currentSlideIdx = 0;
                this.renderPreview();
                this.addChatMsg('Presentation updated! Check the preview.', 'ai');
                showToast('Content updated', 'success');
            } else if (data.response) {
                this.addChatMsg(data.response, 'ai');
            }
        } catch (err) {
            console.error('Chat error:', err);
            this.addChatMsg('Failed to connect to API', 'ai');
        }

        if (sendBtn) sendBtn.disabled = false;
    }

    addChatMsg(text, role) {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        const div = document.createElement('div');
        div.className = `chat-msg ${role}`;
        div.textContent = text;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    // ==================== Preview ====================

    renderPreview() {
        if (!this.currentContent || !this.currentContent.slides) return;

        const slides = this.currentContent.slides;
        const previewPanel = document.getElementById('preview-panel');
        const emptyState = document.getElementById('empty-state');
        const previewTitle = document.getElementById('preview-title');

        if (emptyState) emptyState.style.display = 'none';
        if (previewPanel) previewPanel.style.display = 'flex';
        if (previewTitle) previewTitle.textContent = this.currentContent.title || 'Presentation Preview';

        this.renderSlide();
        this.updateSlideNav();
    }

    renderSlide() {
        const container = document.getElementById('slide-preview');
        if (!container || !this.currentContent) return;

        const slides = this.currentContent.slides;
        if (slides.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:var(--text-secondary)">No slides found</p>';
            return;
        }

        const slide = slides[this.currentSlideIdx];
        let html = '';

        if (slide.title) {
            html += `<div class="slide-title">${this.esc(slide.title)}</div>`;
        }

        if (slide.bullets && slide.bullets.length) {
            html += '<ul class="slide-bullets">';
            slide.bullets.forEach(b => {
                html += `<li>${this.esc(b)}</li>`;
            });
            html += '</ul>';
        }

        if (slide.notes) {
            html += `<div class="slide-notes">📝 ${this.esc(slide.notes)}</div>`;
        }

        container.innerHTML = html;
    }

    navigateSlide(delta) {
        if (!this.currentContent || !this.currentContent.slides) return;
        const total = this.currentContent.slides.length;
        this.currentSlideIdx = Math.max(0, Math.min(total - 1, this.currentSlideIdx + delta));
        this.renderSlide();
        this.updateSlideNav();
    }

    updateSlideNav() {
        const total = this.currentContent?.slides?.length || 0;
        const counter = document.getElementById('slide-counter');
        const prevBtn = document.getElementById('prev-slide-btn');
        const nextBtn = document.getElementById('next-slide-btn');

        if (counter) counter.textContent = `${this.currentSlideIdx + 1} / ${total}`;
        if (prevBtn) prevBtn.disabled = this.currentSlideIdx <= 0;
        if (nextBtn) nextBtn.disabled = this.currentSlideIdx >= total - 1;
    }

    // ==================== Download ====================

    async downloadPptx() {
        if (!this.currentContent) {
            showToast('No content to download', 'warning');
            return;
        }

        showToast('Generating PowerPoint...', 'info');

        try {
            const response = await fetch('/api/ppt/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: this.currentContent }),
            });

            if (!response.ok) {
                const err = await response.json();
                showToast(err.detail || 'Download failed', 'error');
                return;
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // Try to get filename from Content-Disposition header
            const disposition = response.headers.get('Content-Disposition');
            let filename = 'Presentation.pptx';
            if (disposition) {
                const match = disposition.match(/filename="?(.+?)"?$/);
                if (match) filename = match[1];
            }
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            showToast('PowerPoint downloaded!', 'success');
        } catch (err) {
            console.error('Download error:', err);
            showToast('Download failed', 'error');
        }
    }

    // ==================== UI helpers ====================

    showLoading(text) {
        const loading = document.getElementById('loading-state');
        const empty   = document.getElementById('empty-state');
        const preview = document.getElementById('preview-panel');
        const loadingText = document.getElementById('loading-text');

        if (empty)   empty.style.display   = 'none';
        if (preview) preview.style.display = 'none';
        if (loading) loading.style.display = 'flex';
        if (loadingText) loadingText.textContent = text || 'Processing...';
    }

    hideLoading() {
        const loading = document.getElementById('loading-state');
        if (loading) loading.style.display = 'none';
    }

    showChatPanel() {
        const chat = document.getElementById('chat-container');
        if (chat) chat.style.display = 'block';
    }

    resetAll() {
        this.files = [];
        this.chatHistoryId = null;
        this.currentContent = null;
        this.currentSlideIdx = 0;

        this.renderFileList();
        this.updateExtractBtn();

        // Reset instructions
        const inst = document.getElementById('user-instructions');
        if (inst) inst.value = '';

        // Hide panels
        const preview = document.getElementById('preview-panel');
        const empty   = document.getElementById('empty-state');
        const loading = document.getElementById('loading-state');
        const chat    = document.getElementById('chat-container');
        const chatMsgs = document.getElementById('chat-messages');

        if (preview) preview.style.display = 'none';
        if (loading) loading.style.display = 'none';
        if (empty)   empty.style.display   = 'flex';
        if (chat)    chat.style.display    = 'none';
        if (chatMsgs) chatMsgs.innerHTML   = '';

        showToast('All data cleared', 'info');
    }

    esc(text) {
        if (!text) return '';
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
}

// ── Bootstrap ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    window.pptApp = new PptCreatorApp();
});
