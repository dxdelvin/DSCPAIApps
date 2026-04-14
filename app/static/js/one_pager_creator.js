/**
 * One Pager Creator – frontend controller.
 * AI generates a complete HTML/CSS document. Preview renders it in an iframe.
 * PDF download uses html2pdf.js (html2canvas + jsPDF) for client-side conversion.
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

        this.MAX_FILE_SIZE = 10 * 1024 * 1024;
        this.MAX_IMAGES = 3;
        this.init();
    }

    init() {
        this.setupUpload();
        this.setupTemplateSelector();
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

        if (emptyState)  emptyState.style.display = 'none';
        if (resultPanel) resultPanel.style.display = 'flex';

        const dlRow = document.getElementById('download-btn')?.closest('.result-actions');
        if (dlRow) dlRow.style.display = '';

        // Inject an override style so body/html height or overflow constraints don't crop content
        const overrideCss = '<style>html,body{height:auto!important;min-height:auto!important;overflow:visible!important;}</style>';
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

        const isLandscape = this.templateStyle === 'cheatsheet';
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

        if (emptyState)  emptyState.style.display = 'none';
        if (resultPanel) resultPanel.style.display = 'flex';
        const dlRow = document.getElementById('download-btn')?.closest('.result-actions');
        if (dlRow) dlRow.style.display = 'none';

        const iframe = document.getElementById('preview-frame');
        iframe.srcdoc = `<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fef2f2">
            <div style="text-align:center;padding:24px;max-width:400px">
                <div style="font-size:32px;margin-bottom:12px">&#9888;</div>
                <h3 style="color:#dc2626;margin:0 0 8px">${escapeHtml(title)}</h3>
                <p style="color:#6b7280;font-size:14px;margin:0">${escapeHtml(detail)}</p>
            </div>
        </body></html>`;
        showToast(title, 'error');
    }

    /* ── Download PDF ─────────────────────────────────── */

    async downloadPdf() {
        if (!this.currentHtml) return;

        const btn = document.getElementById('download-btn');
        const originalHTML = btn.innerHTML;
        btn.classList.add('downloading');
        btn.innerHTML = '<span class="btn-icon">⏳</span> Generating PDF…';

        try {
            const iframe = document.getElementById('preview-frame');
            const iframeDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);

            if (!iframeDoc || !iframeDoc.body) {
                showToast('Preview not ready. Please wait and try again.', 'warning');
                btn.innerHTML = originalHTML;
                btn.classList.remove('downloading');
                return;
            }

            // Clone the iframe body into a temporary off-screen container so
            // html2pdf.js can measure and render it without cross-frame issues.
            const container = document.createElement('div');

            // Copy all stylesheets from the iframe into the container
            const iframeStyles = iframeDoc.querySelectorAll('style, link[rel="stylesheet"]');
            iframeStyles.forEach(s => container.appendChild(s.cloneNode(true)));

            // Copy the body content
            const bodyClone = iframeDoc.body.cloneNode(true);
            // Preserve inline styles from <body>
            container.style.cssText = iframeDoc.body.style.cssText;
            // Copy body class and computed background
            const bodyCS = iframeDoc.defaultView.getComputedStyle(iframeDoc.body);
            container.style.background = bodyCS.background;
            container.style.color = bodyCS.color;
            container.style.fontFamily = bodyCS.fontFamily;

            while (bodyClone.firstChild) container.appendChild(bodyClone.firstChild);

            // Position off-screen at the same A4 dimensions used for preview
            const isLandscape = this.templateStyle === 'cheatsheet';
            const A4_W = isLandscape ? 1122 : 794;
            container.style.position = 'absolute';
            container.style.left = '-9999px';
            container.style.top = '0';
            container.style.width = A4_W + 'px';
            document.body.appendChild(container);

            // Brief pause so the browser can reflow and calculate actual content dimensions
            await new Promise(r => setTimeout(r, 100));
            const contentHeight = Math.max(container.scrollHeight, container.offsetHeight);
            const contentWidth  = A4_W;

            const filename = (this._extractTitle() || 'One-Pager') + '.pdf';

            const opt = {
                margin:      0,
                filename:    filename,
                image:       { type: 'jpeg', quality: 0.98 },
                html2canvas: {
                    scale:          2,
                    useCORS:        true,
                    width:          contentWidth,
                    height:         contentHeight,
                    windowWidth:    contentWidth,
                    windowHeight:   contentHeight,
                    backgroundColor: null,
                },
                jsPDF: {
                    unit:        'px',
                    format:      [contentWidth, contentHeight],
                    orientation: isLandscape ? 'landscape' : 'portrait',
                    hotfixes:    ['px_scaling'],
                },
            };

            await html2pdf().set(opt).from(container).save();

            // Clean up
            document.body.removeChild(container);

            btn.innerHTML = '<span class="btn-icon">✅</span> Downloaded!';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.classList.remove('downloading');
            }, 2500);
            showToast('PDF downloaded successfully!', 'success');
        } catch (err) {
            AppLogger.error('One-pager PDF generation error:', err);
            showToast('PDF generation failed. Please try again.', 'error');
            btn.innerHTML = originalHTML;
            btn.classList.remove('downloading');
        }
    }

    _extractTitle() {
        if (!this.currentHtml) return 'One-Pager';
        const m = this.currentHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
        return m ? m[1].trim() : 'One-Pager';
    }

    /* ── UI helpers ───────────────────────────────────── */

    showLoading(text) {
        document.getElementById('empty-state').style.display = 'none';
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';
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


        document.getElementById('chat-container').style.display = 'none';
        document.getElementById('chat-messages').innerHTML = '';
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';
        document.getElementById('empty-state').style.display = 'flex';
        document.getElementById('loading-state').style.display = 'none';

        // Clear iframe
        const iframe = document.getElementById('preview-frame');
        if (iframe) iframe.srcdoc = '';
    }
}
