/**
 * Diagram Generator – frontend controller.
 * Handles PDF upload, AI analysis, diagram selection,
 * generation, chat refinement, preview, and .drawio download.
 */
document.addEventListener('DOMContentLoaded', () => {
    const app = new DiagramGeneratorApp();
});

class DiagramGeneratorApp {
    constructor() {
        this.file = null;
        this.chatHistoryId = null;
        this.analysis = null;
        this.extractedText = null;
        this.diagrams = [];          // { name, type, xml }
        this.activeTabIndex = 0;
        this.MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        this.init();
    }

    /* ── Bootstrap ────────────────────────────────────── */

    init() {
        this.setupUpload();
        this.setupTypePicker();
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
            if (e.dataTransfer.files.length) this.setFile(e.dataTransfer.files[0]);
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) this.setFile(fileInput.files[0]);
            fileInput.value = '';
        });
    }

    setFile(f) {
        if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
            showToast('Only PDF files are accepted.', 'warning');
            return;
        }
        if (f.size > this.MAX_FILE_SIZE) {
            showToast(`File is too large (${this.formatSize(f.size)}). Maximum is 10 MB.`, 'error');
            return;
        }
        this.file = f;
        this.renderFilesList();
        this.updateAnalyzeBtn();
    }

    renderFilesList() {
        const section = document.getElementById('files-list-section');
        const list    = document.getElementById('files-list');
        if (!this.file) {
            section.style.display = 'none';
            return;
        }
        section.style.display = 'block';
        list.innerHTML = `
            <div class="file-item">
                <span class="file-icon">📄</span>
                <span class="file-name">${this.esc(this.file.name)}</span>
                <span class="file-size">${this.formatSize(this.file.size)}</span>
                <button class="btn btn-ghost btn-sm file-remove" id="remove-file-btn">✕</button>
            </div>
        `;
        document.getElementById('remove-file-btn').addEventListener('click', () => {
            this.file = null;
            this.renderFilesList();
            this.updateAnalyzeBtn();
        });
    }

    /* ── Type picker chips ─────────────────────────────── */

    setupTypePicker() {
        const picker = document.getElementById('type-picker');
        if (!picker) return;
        const MAX_TYPES = 5;

        picker.querySelectorAll('.type-chip').forEach(chip => {
            chip.addEventListener('click', e => {
                e.preventDefault();
                const type = chip.dataset.type;

                if (type === 'auto') {
                    // AI Decides: deselect everything else
                    picker.querySelectorAll('.type-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                } else {
                    // Deselect "AI Decides" when picking specific types
                    picker.querySelector('[data-type="auto"]')?.classList.remove('active');

                    if (chip.classList.contains('active')) {
                        chip.classList.remove('active');
                    } else {
                        // Enforce max 5 selection limit
                        const currentCount = picker.querySelectorAll('.type-chip.active:not([data-type="auto"])').length;
                        if (currentCount >= MAX_TYPES) {
                            showToast(`You can select up to ${MAX_TYPES} diagram types.`, 'warning');
                            return;
                        }
                        chip.classList.add('active');
                    }

                    // If nothing selected, re-activate auto
                    if (!picker.querySelectorAll('.type-chip.active').length) {
                        picker.querySelector('[data-type="auto"]')?.classList.add('active');
                    }
                }
            });
        });
    }

    getSelectedTypes() {
        const chips = document.querySelectorAll('#type-picker .type-chip.active');
        const types = [...chips].map(c => c.dataset.type);
        if (types.includes('auto') || types.length === 0) return [];
        return types;
    }

    /* ── Event listeners ──────────────────────────────── */

    setupEventListeners() {
        document.getElementById('analyze-btn').addEventListener('click', () => this.analyzeContent());
        document.getElementById('reset-btn').addEventListener('click', () => this.handleResetRequest());
        document.getElementById('generate-btn').addEventListener('click', () => this.generateDiagrams());
        document.getElementById('select-all-btn').addEventListener('click', () => this.toggleSelectAll());

        document.getElementById('chat-send-btn').addEventListener('click', () => this.sendChatMessage());
        document.getElementById('chat-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendChatMessage();
            }
        });
    }

    updateAnalyzeBtn() {
        document.getElementById('analyze-btn').disabled = !this.file;
    }

    /* ── Analyze content ──────────────────────────────── */

    async analyzeContent() {
        if (!this.file) return;

        this.showLoading('Analyzing PDF content…');

        const formData = new FormData();
        formData.append('files', this.file);

        // Build instructions from selected diagram types
        const selectedTypes = this.getSelectedTypes();
        if (selectedTypes.length) {
            const typeLabels = selectedTypes.map(t => t.replace(/_/g, ' ')).join(', ');
            formData.append('instructions',
                `The user specifically wants these diagram types: ${typeLabels}. ` +
                `Generate suggestions ONLY for these types. Do not suggest other types.`);
        }

        try {
            const res  = await fetch('/api/diagram/analyze', { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok || data.error || data.status === 'error') {
                this.hideLoading();
                const title = data.message || 'Analysis Failed';
                const detail = data.detail || 'The AI could not analyze the uploaded PDF.';
                this.showNoContentError(title, detail, data.title);
                return;
            }

            if (!data.analysis || !data.analysis.diagrams || data.analysis.diagrams.length === 0) {
                this.hideLoading();
                this.showNoContentError(
                    'No Diagrams Suggested',
                    data.analysis?.summary || 'The AI could not determine suitable diagrams for this content. Try a different PDF or add more specific instructions.',
                    data.analysis?.title
                );
                return;
            }

            this.analysis = data.analysis;
            this.chatHistoryId = data.chatHistoryId;
            this.extractedText = data.extractedText;

            this.hideLoading();
            this.showSuggestions();
            showToast('PDF analyzed! Select diagrams to generate.', 'success');
        } catch (err) {
            this.hideLoading();
            this.showError('Connection Error', 'Could not reach the server. Please check your connection and try again.');
        }
    }

    /* ── Diagram suggestions ──────────────────────────── */

    showSuggestions() {
        const container = document.getElementById('selection-container');
        const summary   = document.getElementById('analysis-summary');
        const list      = document.getElementById('diagram-suggestions');

        // Hide empty state and result panel, show suggestions in right panel
        document.getElementById('empty-state').style.display = 'none';
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';

        container.style.display = 'block';
        summary.textContent = this.analysis.summary || 'AI has analyzed the content and suggests the following diagrams:';

        list.innerHTML = this.analysis.diagrams.map((d, i) => `
            <div class="suggestion-card selected" data-index="${i}">
                <div class="card-check">✓</div>
                <div class="card-header">
                    <span class="card-type-badge">${this.getTypeIcon(d.type)} ${this.esc(this.formatTypeLabel(d.type))}</span>
                    <span class="card-title">${this.esc(this.formatDiagramName(d, i))}</span>
                </div>
                <div class="card-reason">${this.esc(d.reason || d.description || '')}</div>
                ${d.key_elements && d.key_elements.length ? `
                    <div class="card-elements">
                        ${d.key_elements.map(el => `<span class="element-tag">${this.esc(el)}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('');

        list.querySelectorAll('.suggestion-card').forEach(card => {
            card.addEventListener('click', () => {
                card.classList.toggle('selected');
            });
        });
    }

    toggleSelectAll() {
        const cards = document.querySelectorAll('#diagram-suggestions .suggestion-card');
        const allSelected = [...cards].every(c => c.classList.contains('selected'));
        cards.forEach(c => {
            if (allSelected) c.classList.remove('selected');
            else c.classList.add('selected');
        });
        document.getElementById('select-all-btn').textContent = allSelected ? 'Select All' : 'Deselect All';
    }

    /* ── Generate diagrams ────────────────────────────── */

    async generateDiagrams() {
        const selected = [...document.querySelectorAll('#diagram-suggestions .suggestion-card.selected')]
            .map(c => parseInt(c.dataset.index));

        if (!selected.length) {
            showToast('Please select at least one diagram to generate.', 'warning');
            return;
        }

        document.getElementById('selection-container').style.display = 'none';
        this.showLoading(`Generating ${selected.length} diagram${selected.length > 1 ? 's' : ''}…`);

        try {
            const res = await fetch('/api/diagram/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatHistoryId: this.chatHistoryId,
                    analysis: this.analysis,
                    extractedText: this.extractedText,
                    selectedIndices: selected,
                }),
            });
            const data = await res.json();

            if (!res.ok || data.error || data.status === 'error') {
                this.hideLoading();
                this.showError(data.message || 'Generation Failed', data.detail || 'Could not generate diagrams.');
                return;
            }

            this.diagrams = (data.diagrams || []).map((d, i) => ({
                ...d,
                name: this.formatDiagramName(d, i),
            }));
            this.chatHistoryId = data.chatHistoryId || this.chatHistoryId;
            this.activeTabIndex = 0;

            this.hideLoading();
            this.showResult();
            this.showChatPanel();
            showToast(`${this.diagrams.length} diagram${this.diagrams.length > 1 ? 's' : ''} generated!`, 'success');
        } catch (err) {
            this.hideLoading();
            this.showError('Connection Error', 'Could not reach the server. Please try again.');
        }
    }

    /* ── Chat / Refine ────────────────────────────────── */

    showChatPanel() {
        const chatContainer = document.getElementById('chat-container');
        const select = document.getElementById('refine-select');

        chatContainer.style.display = 'block';
        select.innerHTML = this.diagrams.map((d, i) =>
            `<option value="${i}">${this.esc(this.formatDiagramName(d, i))}</option>`
        ).join('');
        select.value = this.activeTabIndex;
    }

    async sendChatMessage() {
        const input = document.getElementById('chat-input');
        const msg   = input.value.trim();
        if (!msg) return;

        const targetIdx = parseInt(document.getElementById('refine-select').value);
        const diagram   = this.diagrams[targetIdx];
        if (!diagram) return;

        this.appendChat('user', msg);
        input.value = '';

        this.appendChat('assistant', '⏳ Thinking…');
        const thinkingEl = document.querySelector('#chat-messages .chat-msg:last-child');

        try {
            const res = await fetch('/api/diagram/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatHistoryId: this.chatHistoryId,
                    message: msg,
                    currentXml: diagram.xml,
                    diagramName: diagram.name,
                }),
            });
            const data = await res.json();

            if (thinkingEl) thinkingEl.remove();

            if (data.error || data.status === 'error') {
                this.appendChat('assistant', `Error: ${data.message || 'Refinement failed.'}`);
                return;
            }

            if (data.xml) {
                this.diagrams[targetIdx].xml = data.xml;
                this.chatHistoryId = data.chatHistoryId || this.chatHistoryId;
                this.activeTabIndex = targetIdx;
                this.showResult();
                this.appendChat('assistant', `Diagram "${this.formatDiagramName(diagram, targetIdx)}" updated! Check the preview.`);
            } else {
                this.appendChat('assistant', 'No structured update received.');
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

    showNoContentError(title, detail, docTitle) {
        const resultPanel = document.getElementById('result-panel');
        const emptyState  = document.getElementById('empty-state');
        const resultInfo  = document.getElementById('result-info');
        const cards       = document.getElementById('diagram-cards');

        if (emptyState) emptyState.style.display = 'none';
        if (cards) cards.innerHTML = '';
        if (resultPanel) resultPanel.style.display = 'flex';

        let html = '<div class="no-content-state">';
        html += '<span class="no-content-icon">💭</span>';
        if (docTitle) html += `<p class="no-content-doc">${this.esc(docTitle)}</p>`;
        html += `<h4 class="no-content-title">${this.esc(title)}</h4>`;
        html += `<p class="no-content-detail">${this.esc(detail)}</p>`;
        html += '<div class="no-content-tips">';
        html += '<p class="no-content-tips-heading">Tips to get better results:</p>';
        html += '<ul>';
        html += '<li>Use PDFs with structured text content (process docs, technical specs, reports)</li>';
        html += '<li>Avoid image-heavy or scanned PDFs</li>';
        html += '<li>Select specific diagram types instead of "AI Decides"</li>';
        html += '<li>Try a different PDF with more detailed information</li>';
        html += '</ul>';
        html += '</div></div>';

        resultInfo.innerHTML = html;
        showToast(title, 'warning');
    }

    showError(title, detail) {
        const resultPanel = document.getElementById('result-panel');
        const emptyState  = document.getElementById('empty-state');
        const resultInfo  = document.getElementById('result-info');
        const cards       = document.getElementById('diagram-cards');

        if (emptyState) emptyState.style.display = 'none';
        if (cards) cards.innerHTML = '';
        if (resultPanel) resultPanel.style.display = 'flex';

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
        if (!this.diagrams.length) return;

        const resultPanel = document.getElementById('result-panel');
        const emptyState  = document.getElementById('empty-state');
        const resultInfo  = document.getElementById('result-info');
        const cardsEl     = document.getElementById('diagram-cards');

        if (emptyState) emptyState.style.display = 'none';
        if (resultPanel) resultPanel.style.display = 'flex';

        // Result info (header + stats)
        const successCount = this.diagrams.filter(d => d.xml && !d.error).length;
        const typeSet = new Set(this.diagrams.map(d => d.type));

        let html = '<div class="result-header">';
        html += `<h4 class="result-title">${this.esc(this.analysis?.title || 'Generated Diagrams')}</h4>`;
        html += `<p class="result-subtitle">${successCount} of ${this.diagrams.length} diagrams ready to download</p>`;
        html += '</div>';

        html += '<div class="result-stats">';
        html += `<div class="stat-item"><span class="stat-value">${this.diagrams.length}</span><span class="stat-label">Diagrams</span></div>`;
        html += `<div class="stat-item"><span class="stat-value">${typeSet.size}</span><span class="stat-label">Types</span></div>`;
        html += `<div class="stat-item"><span class="stat-value">${successCount}</span><span class="stat-label">Ready</span></div>`;
        html += '</div>';

        resultInfo.innerHTML = html;

        // Diagram cards
        cardsEl.innerHTML = this.diagrams.map((d, i) => {
            const isError = d.error || !d.xml;
            const name = this.esc(this.formatDiagramName(d, i));
            const icon = this.getTypeIcon(d.type);
            const typeLabel = this.esc(this.formatTypeLabel(d.type));

            if (isError) {
                return `<div class="dg-card dg-card-error">
                    <div class="dg-card-icon">${icon}</div>
                    <div class="dg-card-body">
                        <span class="dg-card-name">${name}</span>
                        <span class="dg-card-type">${typeLabel}</span>
                        <span class="dg-card-status dg-status-error">⚠️ Generation failed</span>
                    </div>
                </div>`;
            }

            return `<div class="dg-card" data-index="${i}">
                <div class="dg-card-icon">${icon}</div>
                <div class="dg-card-body">
                    <span class="dg-card-name">${name}</span>
                    <span class="dg-card-type">${typeLabel}</span>
                    <span class="dg-card-status dg-status-ready"> Ready</span>
                </div>
                <button class="btn btn-primary btn-sm dg-card-download" data-index="${i}" title="Download .drawio">
                    ⬇ Download
                </button>
            </div>`;
        }).join('');

        // Wire download buttons
        cardsEl.querySelectorAll('.dg-card-download').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this.downloadDiagramByIndex(parseInt(btn.dataset.index));
            });
        });

        // Wire card click to select for refine
        cardsEl.querySelectorAll('.dg-card:not(.dg-card-error)').forEach(card => {
            card.addEventListener('click', () => {
                const idx = parseInt(card.dataset.index);
                this.activeTabIndex = idx;
                // Highlight active card
                cardsEl.querySelectorAll('.dg-card').forEach(c => c.classList.remove('dg-card-active'));
                card.classList.add('dg-card-active');
                // Sync refine dropdown
                const refineSelect = document.getElementById('refine-select');
                if (refineSelect) refineSelect.value = idx;
            });
        });

        // Mark initial active card
        const activeCard = cardsEl.querySelector(`.dg-card[data-index="${this.activeTabIndex}"]`);
        if (activeCard) activeCard.classList.add('dg-card-active');
    }

    getTypeIcon(type) {
        const icons = {
            flowchart:     '🔀',
            org_chart:     '🏢',
            sequence:      '🔄',
            mind_map:      '🧠',
            er_diagram:    '🗃️',
            network:       '🌐',
            swimlane:      '🏊',
            timeline:      '📅',
            class_diagram: '📦',
            state_diagram: '⚡',
            block_diagram: '🧱',
            tree:          '🌲',
        };
        return icons[type] || '📊';
    }

    formatTypeLabel(type) {
        if (!type) return 'General';
        return String(type)
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    formatDiagramName(diagram, index) {
        const baseRaw = (diagram?.name || `Diagram ${index + 1}`).trim();
        const base = baseRaw.replace(/\s*\([^)]*\)\s*$/, '').trim() || `Diagram ${index + 1}`;
        const typeLabel = this.formatTypeLabel(diagram?.type || 'general');
        return `${base} (${typeLabel})`;
    }

    /* ── Download ─────────────────────────────────────── */

    async downloadDiagramByIndex(index) {
        const diagram = this.diagrams[index];
        if (!diagram || !diagram.xml || diagram.error) {
            showToast('This diagram has no valid content to download.', 'warning');
            return;
        }

        // Disable the button while downloading
        const btn = document.querySelector(`.dg-card-download[data-index="${index}"]`);
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparing…'; }

        try {
            const res = await fetch('/api/diagram/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ diagrams: [diagram] }),
            });

            if (!res.ok) {
                const err = await res.json();
                showToast(err.message || 'Download failed', 'error');
                return;
            }

            const blob = await res.blob();
            const prettyName = this.formatDiagramName(diagram, index);
            const name = prettyName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
            const filename = `${name}.drawio`;
            const started = this.triggerBlobDownload(blob, filename);
            if (started) {
                showToast('Download started!', 'success');
            } else {
                showToast('Browser blocked automatic download.', 'warning');
            }
        } catch (err) {
            showToast('Download error: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '⬇ Download'; }
        }
    }

    triggerBlobDownload(blob, filename) {
        if (!blob || blob.size === 0) return false;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);

        // In some browsers, async-triggered downloads can be ignored.
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        document.body.removeChild(a);

        // Delay revoke slightly so browser has time to start download.
        setTimeout(() => URL.revokeObjectURL(url), 3000);

        return true;
    }

    /* ── UI helpers ───────────────────────────────────── */

    showLoading(text) {
        document.getElementById('empty-state').style.display   = 'none';
        document.getElementById('selection-container').style.display = 'none';
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';
        document.getElementById('loading-state').style.display = 'flex';
        document.getElementById('loading-text').textContent    = text || 'Processing…';
    }

    hideLoading() {
        document.getElementById('loading-state').style.display = 'none';
    }

    handleResetRequest() {
        if (typeof showConfirmation === 'function') {
            showConfirmation(
                'Clear All Data?',
                'Are you sure you want to reset the uploaded file and all generated diagrams? This cannot be undone.',
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
        this.file           = null;
        this.chatHistoryId  = null;
        this.analysis       = null;
        this.extractedText  = null;
        this.diagrams       = [];
        this.activeTabIndex = 0;

        this.renderFilesList();
        this.updateAnalyzeBtn();

        // Reset type picker to "AI Decides"
        const picker = document.getElementById('type-picker');
        if (picker) {
            picker.querySelectorAll('.type-chip').forEach(c => c.classList.remove('active'));
            picker.querySelector('[data-type="auto"]')?.classList.add('active');
        }

        document.getElementById('selection-container').style.display = 'none';
        document.getElementById('chat-container').style.display     = 'none';
        document.getElementById('chat-messages').innerHTML          = '';
        const rp = document.getElementById('result-panel');
        if (rp) rp.style.display = 'none';
        const cards = document.getElementById('diagram-cards');
        if (cards) cards.innerHTML = '';
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
