document.addEventListener('DOMContentLoaded', () => {
    new DocupediaPublisherApp();
});

class DocupediaPublisherApp {
    constructor() {
        this.files = [];
        this.currentDraft = null;
        this.chatHistoryId = '';
        this.publishResult = null;
        this.activeStep = 'auth';
        this.MAX_DISPLAY_IMAGES = 10;
        this.MAX_AI_SOURCES = 4;
        this.isVerified = false;
        this.verifiedUser = '';
        this.defaultConfluenceUrl = 'https://inside-docupedia.bosch.com/confluence2';
        this.STEPS = ['auth', 'upload', 'generate', 'review', 'publish'];
        this.LOADING_MESSAGES = [
            'Reading source files...',
            'Building Confluence storage format...',
            'Checking attachment references...',
            'Preparing your draft...',
        ];
        this.init();
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        this.syncProgress();
    }

    cacheElements() {
        this.el = {
            progressFill: document.getElementById('dp-progress-fill'),
            progressSteps: Array.from(document.querySelectorAll('.dp-progress-step')),
            panels: Array.from(document.querySelectorAll('.dp-panel')),

            confluenceUrl: document.getElementById('dp-confluence-url'),
            spaceKey: document.getElementById('dp-space-key'),
            parentId: document.getElementById('dp-parent-id'),
            pat: document.getElementById('dp-pat'),
            patToggle: document.getElementById('dp-pat-toggle'),
            connectionStatus: document.getElementById('dp-connection-status'),
            nextAuth: document.getElementById('dp-next-auth'),
            nextAuthLabel: document.querySelector('#dp-next-auth .dp-btn-label'),
            nextAuthSpinner: document.querySelector('#dp-next-auth .dp-btn-spinner'),

            userGreeting: document.getElementById('dp-user-greeting'),
            userName: document.getElementById('dp-user-name'),

            uploadZone: document.getElementById('dp-upload-zone'),
            fileInput: document.getElementById('dp-file-input'),
            filesSection: document.getElementById('dp-files-section'),
            filesGrid: document.getElementById('dp-files-grid'),
            displayCounter: document.getElementById('dp-display-counter'),
            addMore: document.getElementById('dp-add-more'),
            backAuth: document.getElementById('dp-back-auth'),
            nextUpload: document.getElementById('dp-next-upload'),

            titleHint: document.getElementById('dp-title-hint'),
            instructions: document.getElementById('dp-instructions'),
            statAi: document.getElementById('dp-stat-ai'),
            statDisplay: document.getElementById('dp-stat-display'),
            statAttach: document.getElementById('dp-stat-attach'),
            backUpload: document.getElementById('dp-back-upload'),
            generateBtn: document.getElementById('dp-generate-btn'),
            loadingCard: document.getElementById('dp-loading-card'),
            loadingMsg: document.getElementById('dp-loading-msg'),

            draftTitle: document.getElementById('dp-draft-title'),
            draftSummary: document.getElementById('dp-draft-summary'),
            storageXml: document.getElementById('dp-storage-xml'),
            xmlStatus: document.getElementById('dp-xml-status'),
            copyXml: document.getElementById('dp-copy-xml'),
            regenerateBtn: document.getElementById('dp-regenerate-btn'),
            displayRefs: document.getElementById('dp-display-refs'),
            attachRefs: document.getElementById('dp-attach-refs'),
            warningsSection: document.getElementById('dp-warnings-section'),
            warningList: document.getElementById('dp-warning-list'),
            chatHistory: document.getElementById('dp-chat-history'),
            refineText: document.getElementById('dp-refine-text'),
            refineBtn: document.getElementById('dp-refine-btn'),
            backGenerate: document.getElementById('dp-back-generate'),
            nextReview: document.getElementById('dp-next-review'),

            pubTitle: document.getElementById('dp-pub-title'),
            pubSpace: document.getElementById('dp-pub-space'),
            pubParent: document.getElementById('dp-pub-parent'),
            pubAttachments: document.getElementById('dp-pub-attachments'),
            pubWarnings: document.getElementById('dp-pub-warnings'),
            pubWarningsList: document.getElementById('dp-pub-warnings-list'),
            backReview: document.getElementById('dp-back-review'),
            publishBtn: document.getElementById('dp-publish-btn'),
            publishResult: document.getElementById('dp-publish-result'),
        };
    }

    bindEvents() {
        // Progress step clicks
        this.el.progressSteps.forEach((btn) => {
            btn.addEventListener('click', () => {
                const step = btn.dataset.step;
                if (this.canGoTo(step)) this.goTo(step);
            });
        });

        // Auth fields
        [this.el.confluenceUrl, this.el.spaceKey, this.el.parentId, this.el.pat].forEach((input) => {
            input.addEventListener('input', () => {
                this.invalidateVerification();
                this.validateAuth();
            });
        });
        this.el.patToggle.addEventListener('click', () => this.togglePatVisibility());
        this.el.nextAuth.addEventListener('click', () => this.verifyConnection());

        // Upload
        this.el.uploadZone.addEventListener('click', () => this.el.fileInput.click());
        this.el.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.el.uploadZone.classList.add('drag-over');
        });
        this.el.uploadZone.addEventListener('dragleave', () => {
            this.el.uploadZone.classList.remove('drag-over');
        });
        this.el.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.el.uploadZone.classList.remove('drag-over');
            this.addFiles(e.dataTransfer.files);
        });
        this.el.fileInput.addEventListener('change', () => {
            this.addFiles(this.el.fileInput.files);
            this.el.fileInput.value = '';
        });
        this.el.addMore.addEventListener('click', () => this.el.fileInput.click());
        this.el.backAuth.addEventListener('click', () => this.goTo('auth'));
        this.el.nextUpload.addEventListener('click', () => this.goTo('generate'));

        // Generate
        this.el.backUpload.addEventListener('click', () => this.goTo('upload'));
        this.el.generateBtn.addEventListener('click', () => this.generateDraft());

        // Review
        this.el.copyXml.addEventListener('click', () => this.copyXmlToClipboard());
        this.el.regenerateBtn.addEventListener('click', () => this.generateDraft({ isRegeneration: true }));
        this.el.refineBtn.addEventListener('click', () => this.refineDraft());
        this.el.backGenerate.addEventListener('click', () => this.goTo('generate'));
        this.el.nextReview.addEventListener('click', () => this.goTo('publish'));

        [this.el.draftTitle, this.el.draftSummary, this.el.storageXml].forEach((input) => {
            input.addEventListener('input', () => this.syncDraftFromEditors());
        });

        // Publish
        this.el.backReview.addEventListener('click', () => this.goTo('review'));
        this.el.publishBtn.addEventListener('click', () => this.publishDraft());

        this.validateAuth();
    }

    // ---- Navigation ----

    canGoTo(step) {
        const idx = this.STEPS.indexOf(step);
        if (idx <= 0) return true;
        if (idx === 1) return this.isVerified;
        if (idx === 2) return this.isVerified && this.files.length > 0 && this.files.some((f) => f.useForAi);
        if (idx === 3) return Boolean(this.currentDraft);
        if (idx === 4) return Boolean(this.currentDraft);
        return false;
    }

    goTo(step) {
        if (!this.canGoTo(step)) {
            this.showStepBlockedMessage(step);
            return;
        }

        this.activeStep = step;

        // Populate publish summary when entering publish step
        if (step === 'publish') {
            this.populatePublishSummary();
        }

        // Update generate stats when entering generate step
        if (step === 'generate') {
            this.updateGenerateStats();
        }

        this.syncProgress();
    }

    showStepBlockedMessage(step) {
        const messages = {
            upload: 'Verify your connection first.',
            generate: 'Upload at least one AI-readable file first.',
            review: 'Generate a draft first.',
            publish: 'Generate a draft first.',
        };
        showToast(messages[step] || 'Complete the previous steps first.', 'warning');
    }

    syncProgress() {
        const currentIdx = this.STEPS.indexOf(this.activeStep);
        const totalSteps = this.STEPS.length;
        const fillPct = (currentIdx / (totalSteps - 1)) * 100;
        this.el.progressFill.style.width = `${fillPct}%`;

        this.el.progressSteps.forEach((btn, idx) => {
            const step = btn.dataset.step;
            btn.classList.remove('active', 'done', 'is-locked');

            if (idx === currentIdx) {
                btn.classList.add('active');
            } else if (idx < currentIdx) {
                btn.classList.add('done');
            }

            if (!this.canGoTo(step)) {
                btn.classList.add('is-locked');
            }
        });

        this.el.panels.forEach((panel) => {
            panel.classList.toggle('is-active', panel.dataset.panel === this.activeStep);
        });
    }

    // ---- Auth Validation ----

    isAuthValid() {
        return Boolean(
            this.el.spaceKey.value.trim() &&
            this.el.parentId.value.trim() &&
            this.el.pat.value.trim()
        );
    }

    validateAuth() {
        const valid = this.isAuthValid();
        this.el.nextAuth.disabled = !valid;
    }

    invalidateVerification() {
        if (!this.isVerified) return;
        this.isVerified = false;
        this.verifiedUser = '';
        this.el.connectionStatus.hidden = true;
        if (this.el.nextAuthLabel) this.el.nextAuthLabel.textContent = 'Verify & Continue';
        this.syncProgress();
    }

    async verifyConnection() {
        if (!this.isAuthValid()) {
            showToast('Fill in Space Key, Parent Page ID, and PAT.', 'warning');
            return;
        }

        this.el.nextAuth.disabled = true;
        if (this.el.nextAuthLabel) this.el.nextAuthLabel.textContent = 'Verifying...';
        if (this.el.nextAuthSpinner) this.el.nextAuthSpinner.hidden = false;

        try {
            const response = await fetch('/api/confluence-builder/verify-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    confluenceUrl: this.el.confluenceUrl.value.trim() || this.defaultConfluenceUrl,
                    pat: this.el.pat.value.trim(),
                    spaceKey: this.el.spaceKey.value.trim(),
                    parentPageId: this.el.parentId.value.trim(),
                }),
            });
            const data = await response.json();

            if (!response.ok || data.status === 'error') {
                this.showConnectionResult(false, data.detail || 'Verification failed.');
                showToast(data.detail || 'Connection verification failed.', 'error');
                return;
            }

            this.isVerified = true;
            this.verifiedUser = data.displayName || '';
            this.showConnectionResult(true, `Verified as ${this.verifiedUser}`);

            if (this.el.userName) this.el.userName.textContent = this.verifiedUser;
            if (this.el.userGreeting) this.el.userGreeting.hidden = false;

            showToast(`Connected as ${this.verifiedUser}`, 'success');
            this.goTo('upload');
        } catch (error) {
            AppLogger.error('Connection verification error', error);
            this.showConnectionResult(false, 'Server connection failed. Please try again.');
            showToast('Server connection failed.', 'error');
        } finally {
            this.el.nextAuth.disabled = !this.isAuthValid();
            if (this.el.nextAuthLabel) this.el.nextAuthLabel.textContent = this.isVerified ? 'Verified' : 'Verify & Continue';
            if (this.el.nextAuthSpinner) this.el.nextAuthSpinner.hidden = true;
        }
    }

    showConnectionResult(success, message) {
        this.el.connectionStatus.hidden = false;
        this.el.connectionStatus.className = `dp-connection-status ${success ? 'is-ok' : 'is-error'}`;
        const icon = this.el.connectionStatus.querySelector('.dp-status-icon');
        const text = this.el.connectionStatus.querySelector('.dp-status-text');
        if (icon) icon.textContent = success ? '\u2713' : '\u2717';
        if (text) text.textContent = message;
    }

    togglePatVisibility() {
        const input = this.el.pat;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';

        const open = this.el.patToggle.querySelector('.eye-open');
        const closed = this.el.patToggle.querySelector('.eye-closed');
        if (open) open.style.display = isPassword ? 'none' : 'block';
        if (closed) closed.style.display = isPassword ? 'block' : 'none';
    }

    // ---- File Management ----

    addFiles(fileList) {
        let addedAny = false;

        for (const file of fileList) {
            if (this.files.some((existing) => this.isSameFile(existing.file, file))) continue;

            const record = this.createFileRecord(file);
            if (!record) {
                showToast(`"${file.name}" is not a supported file type.`, 'warning');
                continue;
            }

            this.files.push(record);
            addedAny = true;
        }

        if (addedAny) {
            this.normalizeDisplayOrder();
            this.clearDraft();
            this.renderFiles();
            this.syncProgress();
        }
    }

    createFileRecord(file) {
        const ext = this.getExtension(file.name);
        const supported = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.msg'];
        if (!supported.includes(ext)) return null;

        const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext);
        const isAiEligible = isImage || ext === '.pdf';
        const aiSourceCount = this.files.filter((r) => r.useForAi).length;

        return {
            id: this.createId(),
            file,
            extension: ext,
            isImage,
            isAiEligible,
            useForAi: isAiEligible && aiSourceCount < this.MAX_AI_SOURCES,
            attachToPage: true,
            displayInPage: false,
            displayOrder: null,
            thumbUrl: isImage ? URL.createObjectURL(file) : null,
        };
    }

    removeFile(recordId) {
        const record = this.files.find((r) => r.id === recordId);
        if (record && record.thumbUrl) URL.revokeObjectURL(record.thumbUrl);
        this.files = this.files.filter((r) => r.id !== recordId);
        this.normalizeDisplayOrder();
        this.clearDraft();
        this.renderFiles();
        this.syncProgress();
    }

    toggleRole(recordId, role) {
        const record = this.files.find((r) => r.id === recordId);
        if (!record) return;

        if (role === 'ai') {
            if (!record.isAiEligible) return;
            if (!record.useForAi && this.files.filter((r) => r.useForAi).length >= this.MAX_AI_SOURCES) {
                showToast(`Maximum ${this.MAX_AI_SOURCES} AI source files. Only PDF and images are supported for AI reading.`, 'warning');
                return;
            }
            record.useForAi = !record.useForAi;
        }

        if (role === 'display') {
            if (!record.isImage) return;
            if (!record.displayInPage && this.getDisplayRecords().length >= this.MAX_DISPLAY_IMAGES) {
                showToast(`Maximum ${this.MAX_DISPLAY_IMAGES} display images allowed.`, 'warning');
                return;
            }
            record.displayInPage = !record.displayInPage;
            if (record.displayInPage) record.attachToPage = true;
            record.displayOrder = record.displayInPage ? this.getDisplayRecords().length + 1 : null;
            this.normalizeDisplayOrder();
        }

        if (role === 'attach') {
            record.attachToPage = !record.attachToPage;
            if (!record.attachToPage) {
                record.displayInPage = false;
                record.displayOrder = null;
                this.normalizeDisplayOrder();
            }
        }

        this.clearDraft();
        this.renderFiles();
        this.syncProgress();
    }

    moveDisplayRecord(recordId, direction) {
        const displayRecords = this.getDisplayRecords();
        const idx = displayRecords.findIndex((r) => r.id === recordId);
        if (idx < 0) return;

        const nextIdx = idx + direction;
        if (nextIdx < 0 || nextIdx >= displayRecords.length) return;

        const tmpOrder = displayRecords[idx].displayOrder;
        displayRecords[idx].displayOrder = displayRecords[nextIdx].displayOrder;
        displayRecords[nextIdx].displayOrder = tmpOrder;
        this.normalizeDisplayOrder();
        this.clearDraft();
        this.renderFiles();
    }

    renderFiles() {
        const hasFiles = this.files.length > 0;
        this.el.filesSection.hidden = !hasFiles;
        this.el.nextUpload.disabled = !hasFiles || !this.files.some((r) => r.useForAi);

        const displayCount = this.getDisplayRecords().length;
        const aiCount = this.files.filter((r) => r.useForAi).length;
        this.el.displayCounter.textContent = `${displayCount} / ${this.MAX_DISPLAY_IMAGES} display · ${aiCount} / ${this.MAX_AI_SOURCES} AI`;

        this.el.filesGrid.innerHTML = this.files.map((record) => {
            const displayDisabled = !record.isImage || (!record.displayInPage && displayCount >= this.MAX_DISPLAY_IMAGES);
            const aiDisabled = !record.isAiEligible || (!record.useForAi && aiCount >= this.MAX_AI_SOURCES);

            const thumbHtml = record.thumbUrl
                ? `<img class="dp-file-thumb" src="${this.escapeHtml(record.thumbUrl)}" alt="${this.escapeHtml(record.file.name)}">`
                : `<div class="dp-file-icon-box">${this.escapeHtml(record.extension.replace('.', ''))}</div>`;

            const orderHtml = record.displayInPage
                ? `<div class="dp-file-order">
                     <button class="dp-order-btn" data-action="move-up" title="Move up">&#9650;</button>
                     <button class="dp-order-btn" data-action="move-down" title="Move down">&#9660;</button>
                   </div>`
                : '';

            return `
                <div class="dp-file-card ${record.displayInPage ? 'is-display' : ''}" data-file-id="${record.id}">
                    ${thumbHtml}
                    <div class="dp-file-info">
                        <p class="dp-file-name">${this.escapeHtml(record.file.name)}</p>
                        <p class="dp-file-meta">${this.formatFileSize(record.file.size)}${record.displayInPage ? ` · Slot ${record.displayOrder}` : ''}</p>
                    </div>
                    <div class="dp-file-roles">
                        <span class="dp-role-tag ${record.useForAi ? 'is-active' : ''} ${aiDisabled ? 'is-disabled' : ''}" data-action="toggle-ai">AI</span>
                        <span class="dp-role-tag ${record.displayInPage ? 'is-active' : ''} ${displayDisabled ? 'is-disabled' : ''}" data-action="toggle-display">Display</span>
                        <span class="dp-role-tag ${record.attachToPage ? 'is-active' : ''}" data-action="toggle-attach">Attach</span>
                    </div>
                    ${orderHtml}
                    <button class="dp-file-remove" data-action="remove" title="Remove file">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                </div>
            `;
        }).join('');

        // Bind file card actions
        this.el.filesGrid.querySelectorAll('[data-file-id]').forEach((card) => {
            const fileId = card.dataset.fileId;
            card.querySelectorAll('[data-action]').forEach((btn) => {
                const action = btn.dataset.action;
                if (action === 'remove') {
                    btn.addEventListener('click', (e) => { e.stopPropagation(); this.removeFile(fileId); });
                } else if (action === 'toggle-ai') {
                    btn.addEventListener('click', () => this.toggleRole(fileId, 'ai'));
                } else if (action === 'toggle-display') {
                    btn.addEventListener('click', () => this.toggleRole(fileId, 'display'));
                } else if (action === 'toggle-attach') {
                    btn.addEventListener('click', () => this.toggleRole(fileId, 'attach'));
                } else if (action === 'move-up') {
                    btn.addEventListener('click', (e) => { e.stopPropagation(); this.moveDisplayRecord(fileId, -1); });
                } else if (action === 'move-down') {
                    btn.addEventListener('click', (e) => { e.stopPropagation(); this.moveDisplayRecord(fileId, 1); });
                }
            });
        });
    }

    updateGenerateStats() {
        this.el.statAi.textContent = this.files.filter((r) => r.useForAi).length;
        this.el.statDisplay.textContent = this.getDisplayRecords().length;
        this.el.statAttach.textContent = this.files.filter((r) => r.attachToPage).length;
    }

    // ---- Draft Generation ----

    async generateDraft({ isRegeneration = false } = {}) {
        if (!this.files.length || !this.files.some((r) => r.useForAi)) {
            showToast('Upload at least one AI-readable file first.', 'warning');
            return;
        }

        this.publishResult = null;
        this.showLoading(
            isRegeneration
                ? 'Regenerating Confluence draft...'
                : 'Reading source files...'
        );

        const formData = new FormData();
        this.files.forEach((r) => formData.append('files', r.file));
        formData.append('uploadManifest', JSON.stringify(this.serializeManifest()));
        formData.append('requestedTitle', this.el.titleHint.value.trim());
        formData.append('instructions', this.el.instructions.value.trim());

        try {
            const response = await fetch('/api/confluence-builder/generate', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();

            if (!response.ok || data.status === 'error') {
                AppLogger.error('Docupedia draft generation failed', data);
                showToast(data.detail || 'Draft generation failed.', 'error');
                this.hideLoading();
                return;
            }

            this.chatHistoryId = data.chatHistoryId || '';
            this.loadDraft(data);
            this.hideLoading();
            this.goTo('review');
            this.appendChatMessage('assistant', isRegeneration ? 'Draft regenerated. Review the updated content.' : 'Draft ready. Edit anything below, or refine with AI.');
            showToast('Confluence draft generated.', 'success');
        } catch (error) {
            AppLogger.error('Docupedia draft generation error', error);
            showToast('Server connection failed. Please try again.', 'error');
            this.hideLoading();
        }
    }

    async refineDraft() {
        if (!this.currentDraft) {
            showToast('Generate a draft first.', 'warning');
            return;
        }

        const instruction = this.el.refineText.value.trim();
        if (!instruction) {
            showToast('Enter a refinement instruction.', 'warning');
            this.el.refineText.focus();
            return;
        }

        this.appendChatMessage('user', instruction);
        this.appendChatMessage('assistant', 'Refining...');
        const loadingNode = this.el.chatHistory.lastElementChild;
        this.el.refineText.value = '';

        try {
            const response = await fetch('/api/confluence-builder/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatHistoryId: this.chatHistoryId,
                    instruction,
                    draft: this.getDraftPayload(),
                }),
            });
            const data = await response.json();
            if (loadingNode) loadingNode.remove();

            if (!response.ok || data.status === 'error') {
                AppLogger.error('Docupedia draft refinement failed', data);
                this.appendChatMessage('assistant', data.detail || 'Refinement failed. Please try again.');
                return;
            }

            this.chatHistoryId = data.chatHistoryId || this.chatHistoryId;
            this.loadDraft(data);
            this.appendChatMessage('assistant', 'Draft refined. Review the updates.');
            showToast('Draft refined.', 'success');
        } catch (error) {
            if (loadingNode) loadingNode.remove();
            AppLogger.error('Docupedia draft refinement error', error);
            this.appendChatMessage('assistant', 'Server connection failed. Try again.');
        }
    }

    async publishDraft() {
        if (!this.currentDraft) {
            showToast('Generate a draft first.', 'warning');
            return;
        }

        if (typeof LoadingOverlay !== 'undefined') {
            LoadingOverlay.show({
                messages: ['Creating Confluence page...', 'Uploading attachments...', 'Finalizing...'],
            });
        }

        const formData = new FormData();
        this.files.forEach((r) => formData.append('files', r.file));
        formData.append('uploadManifest', JSON.stringify(this.serializeManifest()));
        formData.append('draft', JSON.stringify(this.getDraftPayload()));
        formData.append('confluenceUrl', this.el.confluenceUrl.value.trim() || this.defaultConfluenceUrl);
        formData.append('spaceKey', this.el.spaceKey.value.trim());
        formData.append('parentPageId', this.el.parentId.value.trim());
        formData.append('pat', this.el.pat.value.trim());

        try {
            const response = await fetch('/api/confluence-builder/publish', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();

            if (!response.ok || data.status === 'error') {
                AppLogger.error('Docupedia publish failed', data);
                showToast(data.detail || 'Publish failed.', 'error');
                return;
            }

            this.publishResult = data;
            this.renderPublishResult();
            this.syncProgress();

            if (data.status === 'partial_success') {
                showToast('Page created, but some attachments failed.', 'warning');
            } else {
                showToast('Page published!', 'success');
            }
        } catch (error) {
            AppLogger.error('Docupedia publish error', error);
            showToast('Server connection failed.', 'error');
        } finally {
            if (typeof LoadingOverlay !== 'undefined') LoadingOverlay.hide();
        }
    }

    // ---- Draft State ----

    loadDraft(payload) {
        this.currentDraft = {
            title: payload.title || '',
            summary: payload.summary || '',
            storageXml: payload.storageXml || '',
            attachmentReferences: Array.isArray(payload.attachmentReferences) ? payload.attachmentReferences : [],
            displayImages: Array.isArray(payload.displayImages) ? payload.displayImages : [],
            warnings: Array.isArray(payload.warnings) ? [...payload.warnings] : [],
            baseWarnings: Array.isArray(payload.warnings) ? [...payload.warnings] : [],
        };

        this.el.draftTitle.value = this.currentDraft.title;
        this.el.draftSummary.value = this.currentDraft.summary;
        this.el.storageXml.value = this.currentDraft.storageXml;
        this.refreshDraftValidation();
    }

    syncDraftFromEditors() {
        if (!this.currentDraft) return;
        this.currentDraft.title = this.el.draftTitle.value.trim();
        this.currentDraft.summary = this.el.draftSummary.value.trim();
        this.currentDraft.storageXml = this.el.storageXml.value;
        this.refreshDraftValidation();
    }

    refreshDraftValidation() {
        if (!this.currentDraft) return;

        const filePlan = this.buildCanonicalPlan();
        const referencedNames = this.extractAttachmentNames(this.currentDraft.storageXml);
        const warnings = [...(this.currentDraft.baseWarnings || [])];
        const allowedNames = new Set();

        this.currentDraft.attachmentReferences = filePlan
            .filter((item) => item.attachToPage && item.canonicalName)
            .map((item) => {
                allowedNames.add(item.canonicalName);
                return {
                    sourceId: item.id,
                    originalName: item.file.name,
                    canonicalName: item.canonicalName,
                    attachToPage: item.attachToPage,
                    displayInPage: item.displayInPage,
                    useForAi: item.useForAi,
                    displayOrder: item.displayOrder,
                    usedInXml: referencedNames.has(item.canonicalName),
                };
            });

        this.currentDraft.displayImages = this.currentDraft.attachmentReferences
            .filter((item) => item.displayInPage)
            .sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999))
            .map((item) => ({
                sourceId: item.sourceId,
                originalName: item.originalName,
                canonicalName: item.canonicalName,
                displayOrder: item.displayOrder,
                usedInXml: item.usedInXml,
            }));

        const unknownNames = [...referencedNames].filter((name) => !allowedNames.has(name));
        if (unknownNames.length) {
            warnings.push(`Unknown references not in upload list: ${unknownNames.join(', ')}`);
        }

        const missingDisplay = this.currentDraft.displayImages.filter((i) => !i.usedInXml).map((i) => i.canonicalName);
        if (missingDisplay.length) {
            warnings.push(`Display images not yet referenced in XML: ${missingDisplay.join(', ')}`);
        }

        this.currentDraft.warnings = [...new Set(warnings.filter(Boolean))];
        this.renderReview();
    }

    clearDraft() {
        if (!this.currentDraft) return;
        this.currentDraft = null;
        this.chatHistoryId = '';
        this.publishResult = null;
        this.el.draftTitle.value = '';
        this.el.draftSummary.value = '';
        this.el.storageXml.value = '';
        this.el.refineText.value = '';
        this.el.chatHistory.innerHTML = '';
        this.el.publishResult.hidden = true;
    }

    // ---- Rendering ----

    renderReview() {
        if (!this.currentDraft) return;

        this.el.displayRefs.innerHTML = this.renderRefList(this.currentDraft.displayImages, 'No display images selected.');
        this.el.attachRefs.innerHTML = this.renderRefList(this.currentDraft.attachmentReferences, 'No attachments selected.');

        if (this.currentDraft.warnings.length) {
            this.el.warningsSection.hidden = false;
            this.el.warningList.innerHTML = this.currentDraft.warnings.map((w) => `<li>${this.escapeHtml(w)}</li>`).join('');
        } else {
            this.el.warningsSection.hidden = true;
            this.el.warningList.innerHTML = '';
        }

        const refCount = this.extractAttachmentNames(this.currentDraft.storageXml).size;
        this.el.xmlStatus.textContent = refCount ? `${refCount} attachment ref(s)` : 'No references yet';
    }

    renderRefList(items, emptyMsg) {
        if (!items || !items.length) {
            return `<div class="dp-ref-empty">${this.escapeHtml(emptyMsg)}</div>`;
        }
        return items.map((item) => `
            <div class="dp-ref-item">
                <span class="dp-ref-name" title="${this.escapeHtml(item.originalName)}">${this.escapeHtml(item.canonicalName)}</span>
                <span class="dp-ref-status ${item.usedInXml ? 'is-used' : 'is-unused'}">${item.usedInXml ? 'Used' : 'Pending'}</span>
            </div>
        `).join('');
    }

    renderPublishResult() {
        const target = this.el.publishResult;
        if (!this.publishResult) {
            target.hidden = true;
            target.innerHTML = '';
            return;
        }

        const isWarning = this.publishResult.status === 'partial_success';
        target.hidden = false;
        target.classList.toggle('is-warning', isWarning);

        const failed = Array.isArray(this.publishResult.uploadResults)
            ? this.publishResult.uploadResults.filter((r) => !r.success)
            : [];

        target.innerHTML = `
            <p class="dp-publish-result-title">${isWarning ? 'Page created with upload warnings' : 'Page published successfully!'}</p>
            <p><strong>${this.escapeHtml(this.publishResult.title || 'Confluence Page')}</strong></p>
            <p><a href="${this.escapeHtml(this.publishResult.pageLink || '#')}" target="_blank" rel="noopener noreferrer">Open published page</a></p>
            <p>${this.publishResult.uploadedCount || 0} attachment(s) uploaded${failed.length ? `, ${failed.length} failed` : ''}.</p>
            ${failed.length ? `<ul>${failed.map((r) => `<li>${this.escapeHtml(r.uploadedAs || r.originalName)}: ${this.escapeHtml(r.detail || 'Upload failed')}</li>`).join('')}</ul>` : ''}
        `;
    }

    populatePublishSummary() {
        this.el.pubTitle.textContent = this.currentDraft ? this.currentDraft.title || '(untitled)' : '-';
        this.el.pubSpace.textContent = this.el.spaceKey.value.trim() || '-';
        this.el.pubParent.textContent = this.el.parentId.value.trim() || '-';

        const attachCount = this.currentDraft
            ? this.currentDraft.attachmentReferences.filter((r) => r.attachToPage).length
            : 0;
        this.el.pubAttachments.textContent = `${attachCount} file(s)`;

        const warnings = this.currentDraft ? this.currentDraft.warnings : [];
        if (warnings.length) {
            this.el.pubWarnings.hidden = false;
            this.el.pubWarningsList.innerHTML = warnings.map((w) => `<li>${this.escapeHtml(w)}</li>`).join('');
        } else {
            this.el.pubWarnings.hidden = true;
        }
    }

    appendChatMessage(role, message) {
        const item = document.createElement('div');
        item.className = `dp-chat-msg ${role}`;
        item.textContent = message;
        this.el.chatHistory.appendChild(item);
        this.el.chatHistory.scrollTop = this.el.chatHistory.scrollHeight;
    }

    // ---- Loading ----

    showLoading(message) {
        this.el.loadingCard.hidden = false;
        this.el.loadingMsg.textContent = message || 'Processing...';
        this.el.generateBtn.disabled = true;

        this._loadingInterval = setInterval(() => {
            const idx = Math.floor(Math.random() * this.LOADING_MESSAGES.length);
            this.el.loadingMsg.textContent = this.LOADING_MESSAGES[idx];
        }, 3000);
    }

    hideLoading() {
        this.el.loadingCard.hidden = true;
        this.el.generateBtn.disabled = false;
        if (this._loadingInterval) {
            clearInterval(this._loadingInterval);
            this._loadingInterval = null;
        }
    }

    // ---- Clipboard ----

    async copyXmlToClipboard() {
        const xml = this.el.storageXml.value || '';
        if (!xml.trim()) {
            showToast('No storage format to copy.', 'warning');
            return;
        }
        try {
            await navigator.clipboard.writeText(xml);
            showToast('Confluence storage format copied.', 'success');
        } catch {
            showToast('Clipboard access failed. Copy manually.', 'warning');
        }
    }

    // ---- Serialization ----

    getDraftPayload() {
        if (!this.currentDraft) return null;
        return {
            title: this.currentDraft.title,
            summary: this.currentDraft.summary,
            storageXml: this.currentDraft.storageXml,
            attachmentReferences: this.currentDraft.attachmentReferences,
            displayImages: this.currentDraft.displayImages,
            warnings: this.currentDraft.warnings,
        };
    }

    serializeManifest() {
        return this.files.map((record) => ({
            id: record.id,
            name: record.file.name,
            useForAi: record.useForAi,
            attachToPage: record.attachToPage,
            displayInPage: record.displayInPage,
            displayOrder: record.displayOrder,
        }));
    }

    buildCanonicalPlan() {
        const plan = this.files.map((record, index) => ({
            ...record,
            index,
            canonicalName: null,
        }));
        const usedNames = new Set();
        const displayItems = plan
            .filter((item) => item.displayInPage)
            .sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999) || a.index - b.index);

        displayItems.forEach((item, i) => {
            item.displayOrder = i + 1;
            item.canonicalName = `display-image-${String(i + 1).padStart(2, '0')}${item.extension}`;
            usedNames.add(item.canonicalName.toLowerCase());
        });

        plan.forEach((item) => {
            if (item.canonicalName || !item.attachToPage) return;
            const sanitized = this.sanitizeFilename(item.file.name);
            item.canonicalName = this.dedupeFilename(sanitized, usedNames);
        });

        return plan;
    }

    // ---- Utilities ----

    normalizeDisplayOrder() {
        this.getDisplayRecords()
            .sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999))
            .forEach((record, i) => { record.displayOrder = i + 1; });
    }

    extractAttachmentNames(xml) {
        const names = new Set();
        const regex = /ri:filename="([^"]+)"/g;
        let match;
        while ((match = regex.exec(xml || '')) !== null) names.add(match[1]);
        return names;
    }

    sanitizeFilename(filename) {
        return (filename || 'attachment').replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim() || 'attachment';
    }

    dedupeFilename(filename, usedNames) {
        const dotIdx = filename.lastIndexOf('.');
        const root = dotIdx >= 0 ? filename.slice(0, dotIdx) : filename;
        const ext = dotIdx >= 0 ? filename.slice(dotIdx) : '';
        let candidate = filename;
        let counter = 2;
        while (usedNames.has(candidate.toLowerCase())) {
            candidate = `${root} (${counter})${ext}`;
            counter++;
        }
        usedNames.add(candidate.toLowerCase());
        return candidate;
    }

    getDisplayRecords() {
        return this.files.filter((r) => r.displayInPage);
    }

    isSameFile(a, b) {
        return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
    }

    getExtension(filename) {
        const parts = (filename || '').toLowerCase().split('.');
        return parts.length > 1 ? `.${parts.pop()}` : '';
    }

    createId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        return `file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
    }

    escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value || '';
        return div.innerHTML;
    }
}
