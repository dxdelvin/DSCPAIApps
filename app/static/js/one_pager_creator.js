/**
 * One Pager Creator – frontend controller.
 * AI generates a complete HTML/CSS document. Preview renders it in an iframe.
 * Export downloads a PDF generated client-side via html2pdf.js.
 */
document.addEventListener('DOMContentLoaded', () => {
    const app = new OnePagerApp();
});

class OnePagerApp {
    constructor() {
        this.files = [];
        this.chatHistoryId = null;
        this.currentHtml   = null;
        this.templateStyle = 'executive_summary';
        this.orientation   = 'portrait';

        this.MAX_FILE_SIZE = 10 * 1024 * 1024;
        this.MAX_IMAGES = 3;
        this.init();
    }

    init() {
        this.setupUpload();
        this.setupTemplateSelector();
        this.setupOrientationToggle();
        this.setupColorPicker();
        this.setupEventListeners();
        window.addEventListener('resize', () => this.scalePreview());
    }

    getFieldValue(id) {
        const element = document.getElementById(id);
        return element ? element.value.trim() : '';
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
                if (this.files.some(existing => existing.name === f.name && existing.size === f.size)) {
                    continue;
                }

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

                const currentTotal = this.files.reduce((sum, file) => sum + file.size, 0);
                if (currentTotal + f.size > this.MAX_FILE_SIZE) {
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
        this.updateGenerateBtn();
    }

    renderFilesList() {
        const section = document.getElementById('files-list-section');
        const list    = document.getElementById('files-list');
        if (!this.files.length) {
            section.style.display = 'none';
            return;
        }
        section.style.display = 'block';

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
                this.updateGenerateBtn();
            });
        });
    }

    /* ── Template Style selector ──────────────────────── */

    setupTemplateSelector() {
        const grid = document.getElementById('template-grid');
        grid.addEventListener('click', e => {
            const card = e.target.closest('.template-card');
            if (!card) return;
            grid.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            this.templateStyle = card.dataset.style;
            this.setOrientation(card.dataset.style === 'cheatsheet' ? 'landscape' : 'portrait');
        });
    }

    /* ── Orientation toggle ───────────────────────────── */

    setupOrientationToggle() {
        const toggle = document.getElementById('orientation-toggle');
        if (!toggle) return;
        toggle.addEventListener('click', e => {
            const btn = e.target.closest('.orientation-btn');
            if (!btn) return;
            this.setOrientation(btn.dataset.orientation);
        });
    }

    setOrientation(orientation) {
        this.orientation = orientation;
        document.querySelectorAll('.orientation-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.orientation === orientation);
        });
    }

    /* ── Color Picker ─────────────────────────────────── */

    setupColorPicker() {
    }

    /* ── Event listeners ──────────────────────────────── */

    setupEventListeners() {
        document.getElementById('add-more-btn').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });

        document.getElementById('generate-btn').addEventListener('click', () => this.generateContent());
        document.getElementById('reset-btn').addEventListener('click', () => this.handleResetRequest());
        document.getElementById('download-btn').addEventListener('click', () => this.downloadPdf());
        document.getElementById('refresh-preview-btn').addEventListener('click', () => this.refreshPreview());

        document.getElementById('chat-send-btn').addEventListener('click', () => this.sendChatMessage());
        document.getElementById('chat-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        });

        // Update generate button when text fields change
        ['topic-input', 'keypoints-input', 'audience-input', 'purpose-input'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', () => this.updateGenerateBtn());
            }
        });
    }

    updateGenerateBtn() {
        const hasFiles = this.files.length > 0;
        const hasTopic = this.getFieldValue('topic-input').length > 0;
        const hasPoints = this.getFieldValue('keypoints-input').length > 0;
        document.getElementById('generate-btn').disabled = !(hasFiles || hasTopic || hasPoints);
    }

    /* ── Extract content ──────────────────────────────── */

    async generateContent() {
        const hasFiles = this.files.length > 0;
        const topic = this.getFieldValue('topic-input');
        const keyPoints = this.getFieldValue('keypoints-input');
        const audience = this.getFieldValue('audience-input');
        const purpose = this.getFieldValue('purpose-input');

        if (!hasFiles && !topic && !keyPoints) {
            showToast('Upload at least one file or fill in the topic/key points.', 'warning');
            return;
        }

        this.showLoading('Designing your one-pager…');

        const formData = new FormData();
        this.files.forEach(f => formData.append('files', f));
        formData.append('topic', topic);
        formData.append('keyPoints', keyPoints);
        formData.append('audience', audience);
        formData.append('purpose', purpose);
        formData.append('templateStyle', this.templateStyle);
        formData.append('orientation', this.orientation);

        try {
            const res  = await fetch('/api/one-pager/extract', { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok || data.error || data.status === 'error') {
                AppLogger.error('One-pager extraction failed', { message: data.message, detail: data.detail });
                this.hideLoading();
                this.showError(
                    data.message || 'Generation Failed',
                    data.detail  || 'The AI service could not generate the one-pager. Please try again.'
                );
                return;
            }

            if (!data.html || !data.html.toLowerCase().includes('<html')) {
                this.hideLoading();
                this.showError(
                    'No Content Generated',
                    'The AI could not produce a valid document. Try providing more details or uploading a different file.'
                );
                return;
            }

            this.currentHtml   = data.html;
            this.chatHistoryId = data.chatHistoryId;

            this.hideLoading();
            this.showPreview();
            document.getElementById('chat-container').style.display = 'block';
            showToast('One-pager generated! Preview is ready.', 'success');
        } catch (err) {
            AppLogger.error('One-pager extraction connection error:', err);
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
            const res  = await fetch('/api/one-pager/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatHistoryId: this.chatHistoryId,
                    message:       msg,
                    currentHtml:   this.currentHtml || '',
                    templateStyle: this.templateStyle,
                    orientation:   this.orientation,
                }),
            });
            const data = await res.json();

            if (thinkingEl) thinkingEl.remove();

            if (data.error || data.status === 'error') {
                AppLogger.error('One-pager refinement failed:', data.message);
                this.appendChat('assistant', 'Something went wrong while updating the one-pager. Please try again.');
                return;
            }

            if (data.html && data.html.toLowerCase().includes('<html')) {
                this.currentHtml   = data.html;
                this.chatHistoryId = data.chatHistoryId || this.chatHistoryId;
                this.showPreview();
                this.appendChat('assistant', 'One-pager updated! Check the preview on the right.');
            } else {
                this.appendChat('assistant', 'The AI responded but did not regenerate the document. Try a more specific request.');
            }
        } catch (err) {
            if (thinkingEl) thinkingEl.remove();
            AppLogger.error('One-pager chat error:', err);
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

    /* ── Preview ──────────────────────────────────────── */

    showPreview() {
        if (!this.currentHtml) return;

        const resultPanel = document.getElementById('result-panel');
        const emptyState  = document.getElementById('empty-state');
        const errEl       = document.getElementById('error-state');

        if (errEl)       errEl.remove();
        if (emptyState)  emptyState.style.display = 'none';
        if (resultPanel) resultPanel.style.display = 'flex';

        const dlRow = document.getElementById('download-btn')?.closest('.result-actions');
        if (dlRow) dlRow.style.display = '';

        // Inject an override style so body/html height or overflow constraints don't crop content
        const overrideCss = '<style>html,body{height:auto!important;min-height:auto!important;overflow:visible!important;}.page{overflow:visible!important;}</style>';
        const previewHtml = this.currentHtml.includes('</head>')
            ? this.currentHtml.replace('</head>', overrideCss + '</head>')
            : overrideCss + this.currentHtml;

        const iframe = document.getElementById('preview-frame');
        iframe.srcdoc = previewHtml;
        this.scalePreview();
        iframe.addEventListener('load', () => this.scalePreview(), { once: true });
    }

    scalePreview() {
        const wrapper = document.querySelector('.preview-frame-wrapper');
        const iframe  = document.getElementById('preview-frame');
        if (!wrapper || !iframe || !this.currentHtml) return;

        const isLandscape = this.orientation === 'landscape';
        const A4_W = isLandscape ? 1122 : 794;
        const A4_H = isLandscape ? 794  : 1123;

        const pad    = 16;
        const availW = wrapper.clientWidth - pad;
        const scale  = Math.min(1, availW / A4_W);

        // Detect actual content height to avoid cropping content that overflows A4 dimensions
        let contentH = A4_H;
        try {
            const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            if (doc && doc.documentElement) {
                contentH = Math.max(A4_H, doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
            }
        } catch (e) { /* cross-origin guard */ }

        iframe.style.width           = A4_W + 'px';
        iframe.style.height          = contentH + 'px';
        iframe.style.transform       = `scale(${scale})`;
        iframe.style.transformOrigin = 'top left';
        wrapper.style.height         = Math.round(contentH * scale + pad) + 'px';
        wrapper.style.minHeight      = '';
    }

    async refreshPreview() {
        if (!this.currentHtml) {
            showToast('No content to preview. Generate a one-pager first.', 'warning');
            return;
        }
        this.showPreview();
        showToast('Preview refreshed.', 'info');
    }

    /* ── Error display ────────────────────────────────── */

    showError(title, detail) {
        const resultPanel = document.getElementById('result-panel');
        const emptyState  = document.getElementById('empty-state');

        // Hide result panel (iframe) and empty guide – show error in the
        // results container as a full-size state so it is clearly visible.
        if (resultPanel) resultPanel.style.display = 'none';
        if (emptyState)  emptyState.style.display = 'none';

        // Remove any previous error state
        const container = document.querySelector('.results-container');
        let errEl = document.getElementById('error-state');
        if (errEl) errEl.remove();

        errEl = document.createElement('div');
        errEl.id = 'error-state';
        errEl.className = 'error-state';
        errEl.innerHTML = `
            <div class="error-state-card">
                <div class="error-state-icon">⚠️</div>
                <h3 class="error-state-title">${escapeHtml(title)}</h3>
                <p class="error-state-detail">${escapeHtml(detail)}</p>
            </div>`;
        container.appendChild(errEl);

        showToast(title, 'error');
    }

    /* ── Download PDF ─────────────────────────────────── */

    downloadPdf() {
        if (!this.currentHtml) return;

        const isLandscape = this.orientation === 'landscape';
        const pageW = isLandscape ? 1122 : 794;
        const pageH = isLandscape ? 794  : 1122;
        const filename = this.buildDownloadFilename('pdf');

        // Inject print-specific styles:
        // - @page sets exact paper size with zero margins
        // - print-color-adjust forces backgrounds/gradients to print
        // - overflow:visible on .page so content flows to next pages naturally
        // - break-inside:avoid prevents cards/sections being split mid-page
        // - auto-trigger window.print() on load
        const printStyle = `
<style>
@media print {
  @page { size: ${pageW}px ${pageH}px; margin: 0; }
  html, body {
    width: ${pageW}px !important;
    margin: 0 !important;
    padding: 0 !important;
    height: auto !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .page {
    width: ${pageW}px !important;
    min-height: ${pageH}px !important;
    overflow: visible !important;
    box-sizing: border-box !important;
    break-after: page !important;
    page-break-after: always !important;
  }
  .page:last-child {
    break-after: auto !important;
    page-break-after: auto !important;
  }
  div, section, article, aside, figure, table, tr, img, svg {
    break-inside: avoid !important;
  }
  h1, h2, h3, h4, h5, h6 { break-after: avoid !important; }
}
</style>
<script>
window._pdfFilename = ${JSON.stringify(filename)};
window.onload = function () {
  setTimeout(function () {
    document.title = window._pdfFilename.replace(/\.pdf$/i, '');
    window.print();
  }, 400);
};
<\/script>`;

        const printHtml = this.currentHtml.includes('</head>')
            ? this.currentHtml.replace('</head>', printStyle + '</head>')
            : printStyle + this.currentHtml;

        // Open as a Blob URL in a new full tab so the browser renders it
        // at full width with all CSS intact — no popup size restrictions.
        const blob = new Blob([printHtml], { type: 'text/html' });
        const url  = URL.createObjectURL(blob);
        const tab  = window.open(url, '_blank');

        if (!tab) {
            showToast('Popup blocked — allow popups for this site and try again.', 'error');
            URL.revokeObjectURL(url);
            return;
        }

        // Revoke the object URL after the tab has had time to load
        setTimeout(() => URL.revokeObjectURL(url), 15000);

        showToast('Print dialog opened — choose "Save as PDF" and enable "Background graphics".', 'info');
    }

    _extractTitle() {
        if (!this.currentHtml) return 'One-Pager';
        const m = this.currentHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
        return m ? m[1].trim() : 'One-Pager';
    }

    buildDownloadFilename(extension) {
        const base = (this._extractTitle() || 'One-Pager')
            .replace(/[^a-z0-9 _-]+/gi, '')
            .trim()
            .replace(/\s+/g, '_');
        return `${base || 'One-Pager'}.${extension}`;
    }

    /* ── UI helpers ───────────────────────────────────── */

    showLoading(text) {
        document.getElementById('empty-state').style.display = 'none';
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';
        const errEl = document.getElementById('error-state');
        if (errEl) errEl.remove();
        const messages = text
            ? [text, 'Analyzing your content', 'Structuring the layout', 'Generating one-pager']
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
                'Are you sure you want to reset? This will clear uploaded files, generated content, and chat history.',
                () => this.resetAll(),
                {
                    icon: '⚠️',
                    confirmText: 'Clear Data',
                    cancelText: 'Cancel'
                }
            );
            return;
        }
        this.resetAll();
    }

    resetAll() {
        this.files         = [];
        this.chatHistoryId = null;
        this.currentHtml   = null;

        this.renderFilesList();
        this.updateGenerateBtn();

        const topicInput = document.getElementById('topic-input');
        const audienceInput = document.getElementById('audience-input');
        const purposeInput = document.getElementById('purpose-input');
        const keypointsInput = document.getElementById('keypoints-input');

        if (topicInput) topicInput.value = '';
        if (audienceInput) audienceInput.value = '';
        if (purposeInput) purposeInput.value = '';
        if (keypointsInput) keypointsInput.value = '';

        // Reset template to default
        document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
        const defaultCard = document.querySelector('.template-card[data-style="executive_summary"]');
        if (defaultCard) defaultCard.classList.add('active');
        this.templateStyle = 'executive_summary';
        this.setOrientation('portrait');

        document.getElementById('chat-container').style.display = 'none';
        document.getElementById('chat-messages').innerHTML = '';
        const errEl = document.getElementById('error-state');
        if (errEl) errEl.remove();
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';
        document.getElementById('empty-state').style.display = 'flex';
        document.getElementById('loading-state').style.display = 'none';

        // Clear iframe
        const iframe = document.getElementById('preview-frame');
        if (iframe) iframe.srcdoc = '';
    }
}
