document.addEventListener('DOMContentLoaded', () => {
    new ConfluenceBuilderApp();
});

class ConfluenceBuilderApp {
    constructor() {
        this.files = [];
        this.currentDraft = null;
        this.chatHistoryId = '';
        this.publishResult = null;
        this.currentViewStep = 'upload';
        this.MAX_DISPLAY_IMAGES = 10;
        this.defaultConfluenceUrl = 'https://inside-docupedia.bosch.com/confluence2';
        this.init();
    }

    init() {
        this.cacheElements();
        this.setupUpload();
        this.setupEventListeners();
        this.updateActionState();
        this.renderFilesList();
        this.showGuideState();
    }

    cacheElements() {
        this.elements = {
            uploadArea: document.getElementById('upload-area'),
            fileInput: document.getElementById('file-input'),
            addMoreBtn: document.getElementById('add-more-btn'),
            filesPanel: document.getElementById('files-panel'),
            filesList: document.getElementById('files-list'),
            requestedTitle: document.getElementById('requested-title'),
            draftInstructions: document.getElementById('draft-instructions'),
            generateBtn: document.getElementById('generate-btn'),
            regenerateBtn: document.getElementById('regenerate-btn'),
            resetBtn: document.getElementById('reset-btn'),
            refinePanel: document.getElementById('refine-panel'),
            refineHistory: document.getElementById('refine-history'),
            refineInstruction: document.getElementById('refine-instruction'),
            refineBtn: document.getElementById('refine-btn'),
            confluenceUrl: document.getElementById('confluence-url'),
            spaceKey: document.getElementById('space-key'),
            parentPageId: document.getElementById('parent-page-id'),
            confluencePat: document.getElementById('confluence-pat'),
            draftStatus: document.getElementById('draft-status'),
            displayCount: document.getElementById('display-count'),
            attachmentCount: document.getElementById('attachment-count'),
            publishBtn: document.getElementById('publish-btn'),
            publishResult: document.getElementById('publish-result'),
            reviewShell: document.getElementById('review-shell'),
            emptyState: document.getElementById('empty-state'),
            loadingState: document.getElementById('loading-state'),
            draftTitle: document.getElementById('draft-title'),
            draftSummary: document.getElementById('draft-summary'),
            storageXml: document.getElementById('storage-xml'),
            xmlStatus: document.getElementById('xml-status'),
            copyXmlBtn: document.getElementById('copy-xml-btn'),
            displayReferenceList: document.getElementById('display-reference-list'),
            attachmentReferenceList: document.getElementById('attachment-reference-list'),
            warningCard: document.getElementById('warning-card'),
            warningList: document.getElementById('warning-list'),
            draftStateChip: document.getElementById('draft-state-chip'),
            openPostBtn: document.getElementById('open-post-btn'),
            steps: Array.from(document.querySelectorAll('#cb-steps .cb-step')),
            stagePanels: Array.from(document.querySelectorAll('[data-view-step]')),
            panels: Array.from(document.querySelectorAll('[data-panel-step]')),
        };
    }

    setupUpload() {
        const { uploadArea, fileInput } = this.elements;

        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', (event) => {
            event.preventDefault();
            uploadArea.classList.add('drag-over');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });
        uploadArea.addEventListener('drop', (event) => {
            event.preventDefault();
            uploadArea.classList.remove('drag-over');
            this.addFiles(event.dataTransfer.files);
        });
        fileInput.addEventListener('change', () => {
            this.addFiles(fileInput.files);
            fileInput.value = '';
        });
    }

    setupEventListeners() {
        const { addMoreBtn, generateBtn, regenerateBtn, resetBtn, refineBtn, publishBtn, copyXmlBtn } = this.elements;

        addMoreBtn.addEventListener('click', () => this.elements.fileInput.click());
        generateBtn.addEventListener('click', () => this.generateDraft());
        regenerateBtn.addEventListener('click', () => this.generateDraft({ isRegeneration: true }));
        resetBtn.addEventListener('click', () => this.handleResetRequest());
        refineBtn.addEventListener('click', () => this.refineDraft());
        publishBtn.addEventListener('click', () => this.publishDraft());
        copyXmlBtn.addEventListener('click', () => this.copyXmlToClipboard());
        if (this.elements.openPostBtn) {
            this.elements.openPostBtn.addEventListener('click', () => this.handleStepSelection('post'));
        }

        this.elements.steps.forEach((step) => {
            step.setAttribute('role', 'button');
            step.tabIndex = 0;
            step.addEventListener('click', () => this.handleStepSelection(step.dataset.step));
            step.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.handleStepSelection(step.dataset.step);
                }
            });
        });

        [this.elements.confluenceUrl, this.elements.spaceKey, this.elements.parentPageId, this.elements.confluencePat]
            .forEach((input) => input.addEventListener('input', () => this.updateActionState()));

        [this.elements.draftTitle, this.elements.draftSummary, this.elements.storageXml].forEach((input) => {
            input.addEventListener('input', () => this.syncDraftFromEditors());
        });
    }

    addFiles(fileList) {
        let addedAny = false;

        for (const file of fileList) {
            if (this.files.some((existing) => this.isSameFile(existing.file, file))) {
                continue;
            }

            const record = this.createFileRecord(file);
            if (!record) {
                showToast(`Skipped "${file.name}" because the file type is not supported.`, 'warning');
                continue;
            }

            this.files.push(record);
            addedAny = true;
        }

        if (addedAny) {
            this.normalizeDisplayOrder();
            this.clearDraftState('Draft cleared because the upload list changed.');
            this.renderFilesList();
            this.updateActionState();
        }
    }

    createFileRecord(file) {
        const extension = this.getExtension(file.name);
        const supported = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.msg'];
        if (!supported.includes(extension)) {
            return null;
        }

        const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(extension);
        const isAiEligible = isImage || extension === '.pdf';

        return {
            id: this.createId(),
            file,
            extension,
            isImage,
            isAiEligible,
            useForAi: isAiEligible,
            attachToPage: true,
            displayInPage: false,
            displayOrder: null,
        };
    }

    renderFilesList() {
        const { filesPanel, filesList } = this.elements;
        if (!this.files.length) {
            filesPanel.hidden = true;
            filesList.innerHTML = '';
            return;
        }

        filesPanel.hidden = false;
        const displayCount = this.getDisplayRecords().length;

        filesList.innerHTML = this.files.map((record) => {
            const displayDisabled = !record.isImage || (!record.displayInPage && displayCount >= this.MAX_DISPLAY_IMAGES);
            const aiDisabled = !record.isAiEligible;

            return `
                <article class="cb-file-card" data-file-id="${record.id}">
                    <div class="cb-file-head">
                        <div class="cb-file-icon">${record.isImage ? 'IMG' : record.extension.replace('.', '').toUpperCase()}</div>
                        <div class="cb-file-meta">
                            <p class="cb-file-name">${this.escapeHtml(record.file.name)}</p>
                            <p class="cb-file-details">${this.formatFileSize(record.file.size)} - ${this.escapeHtml(record.extension.replace('.', '').toUpperCase())}</p>
                        </div>
                        <div class="cb-file-actions">
                            <button class="cb-remove-btn" type="button" data-action="remove">Remove</button>
                        </div>
                    </div>

                    <div class="cb-role-grid">
                        <label class="cb-role-chip ${aiDisabled ? 'is-disabled' : ''}">
                            <input type="checkbox" data-action="toggle-ai" ${record.useForAi ? 'checked' : ''} ${aiDisabled ? 'disabled' : ''}>
                            <span>AI Source</span>
                        </label>
                        <label class="cb-role-chip">
                            <input type="checkbox" data-action="toggle-attach" ${record.attachToPage ? 'checked' : ''}>
                            <span>Attach to Page</span>
                        </label>
                        <label class="cb-role-chip ${displayDisabled ? 'is-disabled' : ''}">
                            <input type="checkbox" data-action="toggle-display" ${record.displayInPage ? 'checked' : ''} ${displayDisabled ? 'disabled' : ''}>
                            <span>Display in Page</span>
                        </label>
                    </div>

                    <div class="cb-file-foot">
                        <div>
                            ${record.displayInPage ? `<span class="cb-slot-badge">Display Slot ${record.displayOrder}</span>` : ''}
                        </div>
                        <div class="cb-display-order">
                            ${record.displayInPage ? `
                                <button class="cb-order-btn" type="button" data-action="move-up" title="Move Up">^</button>
                                <button class="cb-order-btn" type="button" data-action="move-down" title="Move Down">v</button>
                            ` : ''}
                        </div>
                    </div>
                </article>
            `;
        }).join('');

        filesList.querySelectorAll('[data-file-id]').forEach((card) => {
            const record = this.files.find((item) => item.id === card.dataset.fileId);
            if (!record) return;

            card.querySelectorAll('[data-action]').forEach((element) => {
                const action = element.dataset.action;
                if (action === 'remove') {
                    element.addEventListener('click', () => this.removeFile(record.id));
                    return;
                }

                if (action === 'toggle-ai') {
                    element.addEventListener('change', () => this.toggleAiSource(record.id, element.checked));
                    return;
                }

                if (action === 'toggle-attach') {
                    element.addEventListener('change', () => this.toggleAttach(record.id, element.checked));
                    return;
                }

                if (action === 'toggle-display') {
                    element.addEventListener('change', () => this.toggleDisplay(record.id, element.checked));
                    return;
                }

                if (action === 'move-up') {
                    element.addEventListener('click', () => this.moveDisplayRecord(record.id, -1));
                }

                if (action === 'move-down') {
                    element.addEventListener('click', () => this.moveDisplayRecord(record.id, 1));
                }
            });
        });
    }

    removeFile(recordId) {
        this.files = this.files.filter((record) => record.id !== recordId);
        this.normalizeDisplayOrder();
        this.clearDraftState('Draft cleared because the upload list changed.');
        this.renderFilesList();
        this.updateActionState();
    }

    toggleAiSource(recordId, checked) {
        const record = this.findFile(recordId);
        if (!record || !record.isAiEligible) return;
        record.useForAi = checked;
        this.clearDraftState('Draft cleared because file roles changed.');
        this.updateActionState();
    }

    toggleAttach(recordId, checked) {
        const record = this.findFile(recordId);
        if (!record) return;
        record.attachToPage = checked;
        if (!checked) {
            record.displayInPage = false;
            record.displayOrder = null;
            this.normalizeDisplayOrder();
        }
        this.clearDraftState('Draft cleared because file roles changed.');
        this.renderFilesList();
        this.updateActionState();
    }

    toggleDisplay(recordId, checked) {
        const record = this.findFile(recordId);
        if (!record || !record.isImage) return;

        if (checked && !record.displayInPage && this.getDisplayRecords().length >= this.MAX_DISPLAY_IMAGES) {
            showToast(`You can select up to ${this.MAX_DISPLAY_IMAGES} display images.`, 'warning');
            this.renderFilesList();
            return;
        }

        record.displayInPage = checked;
        record.attachToPage = checked ? true : record.attachToPage;
        record.displayOrder = checked ? this.getDisplayRecords().length + 1 : null;
        this.normalizeDisplayOrder();
        this.clearDraftState('Draft cleared because file roles changed.');
        this.renderFilesList();
        this.updateActionState();
    }

    moveDisplayRecord(recordId, direction) {
        const displayRecords = this.getDisplayRecords();
        const currentIndex = displayRecords.findIndex((record) => record.id === recordId);
        if (currentIndex < 0) return;

        const nextIndex = currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= displayRecords.length) return;

        const currentOrder = displayRecords[currentIndex].displayOrder;
        displayRecords[currentIndex].displayOrder = displayRecords[nextIndex].displayOrder;
        displayRecords[nextIndex].displayOrder = currentOrder;
        this.normalizeDisplayOrder();
        this.clearDraftState('Draft cleared because display image order changed.');
        this.renderFilesList();
        this.updateActionState();
    }

    async generateDraft({ isRegeneration = false } = {}) {
        if (!this.files.length) {
            showToast('Upload at least one file before generating the draft.', 'warning');
            return;
        }

        if (!this.files.some((record) => record.useForAi)) {
            showToast('Select at least one PDF or image as an AI source.', 'warning');
            return;
        }

        this.publishResult = null;
        this.renderPublishResult();
        this.showLoading(
            isRegeneration
                ? ['Rebuilding Confluence draft', 'Rechecking attachment references', 'Refreshing review workspace']
                : ['Reading source files', 'Building Confluence content', 'Preparing review workspace']
        );

        const formData = new FormData();
        this.files.forEach((record) => formData.append('files', record.file));
        formData.append('uploadManifest', JSON.stringify(this.serializeManifest()));
        formData.append('requestedTitle', this.elements.requestedTitle.value.trim());
        formData.append('instructions', this.elements.draftInstructions.value.trim());

        try {
            const response = await fetch('/api/confluence-builder/generate', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();

            if (!response.ok || data.status === 'error') {
                AppLogger.error('Confluence draft generation failed', data);
                showToast(data.detail || 'The draft could not be generated.', 'error');
                return;
            }

            this.chatHistoryId = data.chatHistoryId || '';
            this.loadDraft(data);
            this.appendRefineMessage('assistant', isRegeneration ? 'Draft regenerated. Review the updated storage format and publish details.' : 'Draft ready. Review the storage format, then refine or publish when it looks right.');
            showToast('Confluence draft generated successfully.', 'success');
        } catch (error) {
            AppLogger.error('Confluence draft generation error', error);
            showToast('Unable to connect to the server. Please try again.', 'error');
        } finally {
            this.hideLoading();
        }
    }

    async refineDraft() {
        if (!this.currentDraft) {
            showToast('Generate a draft before using AI refinement.', 'warning');
            return;
        }

        const instruction = this.elements.refineInstruction.value.trim();
        if (!instruction) {
            showToast('Tell the AI what should change before refining the draft.', 'warning');
            this.elements.refineInstruction.focus();
            return;
        }

        this.setActiveView('review', { force: true });
        this.appendRefineMessage('user', instruction);
        this.appendRefineMessage('assistant', 'Refining the Confluence draft...');
        const loadingNode = this.elements.refineHistory.lastElementChild;
        this.elements.refineInstruction.value = '';

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
                AppLogger.error('Confluence draft refinement failed', data);
                this.appendRefineMessage('assistant', data.detail || 'The draft could not be refined. Please try again.');
                return;
            }

            this.chatHistoryId = data.chatHistoryId || this.chatHistoryId;
            this.loadDraft(data);
            this.appendRefineMessage('assistant', 'Draft refined. Review the updated title, summary, and storage format.');
            showToast('Draft refined successfully.', 'success');
        } catch (error) {
            if (loadingNode) loadingNode.remove();
            AppLogger.error('Confluence draft refinement error', error);
            this.appendRefineMessage('assistant', 'Unable to reach the server right now. Please try again.');
        }
    }

    async publishDraft() {
        if (!this.currentDraft) {
            showToast('Generate and review a draft before publishing.', 'warning');
            return;
        }

        const missingFields = [];
        if (!this.elements.spaceKey.value.trim()) missingFields.push('Space Key');
        if (!this.elements.parentPageId.value.trim()) missingFields.push('Parent Page ID');
        if (!this.elements.confluencePat.value.trim()) missingFields.push('Confluence PAT');

        if (missingFields.length) {
            showToast(`Please fill in: ${missingFields.join(', ')}.`, 'warning');
            return;
        }

        if (typeof LoadingOverlay !== 'undefined') {
            LoadingOverlay.show({
                messages: ['Creating Confluence page', 'Uploading attachments', 'Finishing publishing flow'],
            });
        }

        const formData = new FormData();
        this.files.forEach((record) => formData.append('files', record.file));
        formData.append('uploadManifest', JSON.stringify(this.serializeManifest()));
        formData.append('draft', JSON.stringify(this.getDraftPayload()));
        formData.append('confluenceUrl', this.elements.confluenceUrl.value.trim() || this.defaultConfluenceUrl);
        formData.append('spaceKey', this.elements.spaceKey.value.trim());
        formData.append('parentPageId', this.elements.parentPageId.value.trim());
        formData.append('pat', this.elements.confluencePat.value.trim());

        try {
            const response = await fetch('/api/confluence-builder/publish', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();

            if (!response.ok || data.status === 'error') {
                AppLogger.error('Confluence publish failed', data);
                showToast(data.detail || 'Publishing failed. Please review the form and try again.', 'error');
                return;
            }

            this.publishResult = data;
            this.setActiveView('post', { force: true });
            this.renderPublishResult();
            this.updateActionState();

            if (data.status === 'partial_success') {
                showToast('Page created, but some attachments failed to upload.', 'warning');
            } else {
                showToast('Page published successfully.', 'success');
            }
        } catch (error) {
            AppLogger.error('Confluence publish error', error);
            showToast('Unable to connect to the server. Please try again.', 'error');
        } finally {
            if (typeof LoadingOverlay !== 'undefined') {
                LoadingOverlay.hide();
            }
        }
    }

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

        this.elements.draftTitle.value = this.currentDraft.title;
        this.elements.draftSummary.value = this.currentDraft.summary;
        this.elements.storageXml.value = this.currentDraft.storageXml;
        this.elements.refinePanel.hidden = false;
        this.showReviewState();
        this.setActiveView('review', { force: true });
        this.refreshDraftValidation();
    }

    syncDraftFromEditors() {
        if (!this.currentDraft) return;
        this.currentDraft.title = this.elements.draftTitle.value.trim();
        this.currentDraft.summary = this.elements.draftSummary.value.trim();
        this.currentDraft.storageXml = this.elements.storageXml.value;
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
            .sort((left, right) => (left.displayOrder || 999) - (right.displayOrder || 999))
            .map((item) => ({
                sourceId: item.sourceId,
                originalName: item.originalName,
                canonicalName: item.canonicalName,
                displayOrder: item.displayOrder,
                usedInXml: item.usedInXml,
            }));

        const unknownNames = [...referencedNames].filter((name) => !allowedNames.has(name));
        if (unknownNames.length) {
            warnings.push(`Storage format references attachment names that are not selected for upload: ${unknownNames.join(', ')}`);
        }

        const missingDisplayNames = this.currentDraft.displayImages
            .filter((item) => !item.usedInXml)
            .map((item) => item.canonicalName);
        if (missingDisplayNames.length) {
            warnings.push(`Some selected display images are not referenced in the storage format yet: ${missingDisplayNames.join(', ')}`);
        }

        this.currentDraft.warnings = [...new Set(warnings.filter(Boolean))];
        this.renderReview();
        this.updateActionState();
    }

    renderReview() {
        if (!this.currentDraft) {
            this.showGuideState();
            return;
        }

        this.elements.displayReferenceList.innerHTML = this.renderReferenceItems(
            this.currentDraft.displayImages,
            'No display images selected yet.'
        );
        this.elements.attachmentReferenceList.innerHTML = this.renderReferenceItems(
            this.currentDraft.attachmentReferences,
            'No attachments are selected for publishing.'
        );

        if (this.currentDraft.warnings.length) {
            this.elements.warningCard.hidden = false;
            this.elements.warningList.innerHTML = this.currentDraft.warnings
                .map((warning) => `<li>${this.escapeHtml(warning)}</li>`)
                .join('');
        } else {
            this.elements.warningCard.hidden = true;
            this.elements.warningList.innerHTML = '';
        }

        const referenceCount = this.extractAttachmentNames(this.currentDraft.storageXml).size;
        this.elements.xmlStatus.textContent = referenceCount
            ? `${referenceCount} attachment reference(s)`
            : 'No attachment references yet';
    }

    renderReferenceItems(items, emptyMessage) {
        if (!items.length) {
            return `<div class="reference-item"><div class="reference-item-main"><div class="reference-meta">${this.escapeHtml(emptyMessage)}</div></div></div>`;
        }

        return items.map((item) => `
            <div class="reference-item">
                <div class="reference-item-main">
                    <div class="reference-name">${this.escapeHtml(item.canonicalName)}</div>
                    <div class="reference-meta">${this.escapeHtml(item.originalName)}${item.displayOrder ? ` | Slot ${item.displayOrder}` : ''}</div>
                </div>
                <span class="cb-ref-status ${item.usedInXml ? 'is-used' : 'is-unused'}">${item.usedInXml ? 'Used' : 'Pending'}</span>
            </div>
        `).join('');
    }

    renderPublishResult() {
        const target = this.elements.publishResult;
        if (!this.publishResult) {
            target.hidden = true;
            target.classList.remove('is-warning');
            target.innerHTML = '';
            return;
        }

        const isWarning = this.publishResult.status === 'partial_success';
        target.hidden = false;
        target.classList.toggle('is-warning', isWarning);

        const failedItems = Array.isArray(this.publishResult.uploadResults)
            ? this.publishResult.uploadResults.filter((item) => !item.success)
            : [];

        target.innerHTML = `
            <p class="publish-result-title">${isWarning ? 'Page created with upload warnings' : 'Page published successfully'}</p>
            <p><strong>${this.escapeHtml(this.publishResult.title || 'Confluence page')}</strong></p>
            <p><a href="${this.escapeHtml(this.publishResult.pageLink || '#')}" target="_blank" rel="noopener noreferrer">Open published page</a></p>
            <p>${this.publishResult.uploadedCount || 0} attachment(s) uploaded${failedItems.length ? `, ${failedItems.length} failed` : ''}.</p>
            ${failedItems.length ? `<ul>${failedItems.map((item) => `<li>${this.escapeHtml(item.uploadedAs || item.originalName)}: ${this.escapeHtml(item.detail || 'Upload failed')}</li>`).join('')}</ul>` : ''}
        `;
    }

    updateActionState() {
        const hasFiles = this.files.length > 0;
        const hasAiSource = this.files.some((record) => record.useForAi);
        const hasDraft = Boolean(this.currentDraft);
        const displayRecords = this.getDisplayRecords();
        const attachmentPlan = this.buildCanonicalPlan().filter((item) => item.attachToPage);

        this.elements.generateBtn.disabled = !hasFiles || !hasAiSource;
        this.elements.regenerateBtn.disabled = !hasFiles || !hasAiSource;
        this.elements.refineBtn.disabled = !hasDraft;

        this.elements.draftStatus.textContent = hasDraft ? 'Draft ready for review' : 'No draft yet';
        this.elements.displayCount.textContent = `${displayRecords.length} / ${this.MAX_DISPLAY_IMAGES} selected`;
        this.elements.attachmentCount.textContent = `${attachmentPlan.length} selected`;

        const requiredPublishFields = [
            this.elements.spaceKey.value.trim(),
            this.elements.parentPageId.value.trim(),
            this.elements.confluencePat.value.trim(),
        ];
        this.elements.publishBtn.disabled = !hasDraft || requiredPublishFields.some((value) => !value);
        if (this.elements.openPostBtn) {
            this.elements.openPostBtn.disabled = !hasDraft;
        }

        if (this.elements.draftStateChip) {
            if (this.publishResult) {
                this.elements.draftStateChip.textContent = 'Published';
            } else if (hasDraft) {
                this.elements.draftStateChip.textContent = 'Draft ready';
            } else if (hasFiles) {
                this.elements.draftStateChip.textContent = 'Files loaded';
            } else {
                this.elements.draftStateChip.textContent = 'Waiting for upload';
            }
        }

        this.renderStepState();
    }

    handleStepSelection(step) {
        if (!this.canOpenStep(step)) {
            const message = step === 'review'
                ? 'Generate a draft first before opening Review.'
                : 'Finish the draft first before opening Post.';
            showToast(message, 'warning');
            return;
        }
        this.setActiveView(step, { force: true });
    }

    canOpenStep(step) {
        if (step === 'upload') return true;
        if (step === 'review') return Boolean(this.currentDraft);
        if (step === 'post') return Boolean(this.currentDraft);
        return false;
    }

    setActiveView(step, { force = false } = {}) {
        if (!force && !this.canOpenStep(step)) {
            return false;
        }
        this.currentViewStep = step;
        this.renderStepState();
        return true;
    }

    renderStepState() {
        const stepOrder = ['upload', 'review', 'post'];
        const activeIndex = stepOrder.indexOf(this.currentViewStep);
        const readyIndex = this.publishResult ? 2 : this.currentDraft ? 1 : 0;

        this.elements.steps.forEach((step, index) => {
            const stepName = step.dataset.step;
            const locked = !this.canOpenStep(stepName);
            step.classList.remove('active', 'done', 'is-locked');
            if ((index < readyIndex || (this.publishResult && index === readyIndex)) && index !== activeIndex) {
                step.classList.add('done');
            }
            if (index === activeIndex) {
                step.classList.add('active');
            }
            if (locked) {
                step.classList.add('is-locked');
            }
        });

        this.elements.panels.forEach((panel) => {
            const panelIndex = stepOrder.indexOf(panel.dataset.panelStep);
            panel.classList.remove('is-active', 'is-done');
            if ((panelIndex < readyIndex || (this.publishResult && panelIndex === readyIndex)) && panelIndex !== activeIndex) {
                panel.classList.add('is-done');
            }
            if (panelIndex === activeIndex) {
                panel.classList.add('is-active');
            }
        });

        this.elements.stagePanels.forEach((panel) => {
            panel.classList.toggle('is-visible', panel.dataset.viewStep === this.currentViewStep);
        });
    }

    showGuideState() {
        this.elements.emptyState.style.display = 'flex';
        this.elements.reviewShell.hidden = true;
        this.elements.refinePanel.hidden = true;
    }

    showReviewState() {
        this.elements.emptyState.style.display = 'none';
        this.elements.reviewShell.hidden = false;
        this.elements.refinePanel.hidden = false;
    }

    showLoading(messages) {
        this.setActiveView('review', { force: true });
        this.elements.emptyState.style.display = 'none';
        this.elements.reviewShell.hidden = true;
        LoadingPanel.show(this.elements.loadingState, { messages });
    }

    hideLoading() {
        LoadingPanel.hide(this.elements.loadingState);
        if (this.currentDraft) {
            this.showReviewState();
            this.setActiveView('review', { force: true });
        } else {
            this.showGuideState();
            this.setActiveView('upload', { force: true });
        }
    }

    clearDraftState(message = '') {
        if (message && this.currentDraft) {
            showToast(message, 'info', 2400);
        }
        this.currentDraft = null;
        this.chatHistoryId = '';
        this.publishResult = null;
        this.elements.draftTitle.value = '';
        this.elements.draftSummary.value = '';
        this.elements.storageXml.value = '';
        this.elements.refineInstruction.value = '';
        this.elements.refineHistory.innerHTML = '';
        this.renderPublishResult();
        this.showGuideState();
        this.setActiveView('upload', { force: true });
    }

    handleResetRequest() {
        if (typeof showConfirmation === 'function') {
            showConfirmation(
                'Reset Confluence Builder?',
                'This will remove all uploaded files, draft content, and publish state.',
                () => this.resetAll(),
                {
                    icon: '!',
                    confirmText: 'Reset',
                    cancelText: 'Cancel',
                }
            );
            return;
        }
        this.resetAll();
    }

    resetAll() {
        this.files = [];
        this.currentDraft = null;
        this.chatHistoryId = '';
        this.publishResult = null;
        this.elements.fileInput.value = '';
        this.elements.requestedTitle.value = '';
        this.elements.draftInstructions.value = '';
        this.elements.spaceKey.value = '';
        this.elements.parentPageId.value = '';
        this.elements.confluencePat.value = '';
        this.elements.confluenceUrl.value = this.defaultConfluenceUrl;
        this.elements.refineInstruction.value = '';
        this.elements.refineHistory.innerHTML = '';
        this.elements.draftTitle.value = '';
        this.elements.draftSummary.value = '';
        this.elements.storageXml.value = '';
        this.renderFilesList();
        this.renderPublishResult();
        this.showGuideState();
        this.setActiveView('upload', { force: true });
        this.updateActionState();
    }

    appendRefineMessage(role, message) {
        const item = document.createElement('div');
        item.className = `chat-msg ${role}`;
        item.textContent = message;
        this.elements.refineHistory.appendChild(item);
        this.elements.refineHistory.scrollTop = this.elements.refineHistory.scrollHeight;
    }

    async copyXmlToClipboard() {
        const xml = this.elements.storageXml.value || '';
        if (!xml.trim()) {
            showToast('There is no storage format to copy yet.', 'warning');
            return;
        }

        try {
            await navigator.clipboard.writeText(xml);
            showToast('Confluence storage format copied to clipboard.', 'success');
        } catch (error) {
            AppLogger.error('Clipboard copy failed', error);
            showToast('Clipboard access failed. Please copy the storage format manually.', 'warning');
        }
    }

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
            .sort((left, right) => (left.displayOrder || 999) - (right.displayOrder || 999) || left.index - right.index);

        displayItems.forEach((item, index) => {
            item.displayOrder = index + 1;
            item.canonicalName = `display-image-${String(index + 1).padStart(2, '0')}${item.extension}`;
            usedNames.add(item.canonicalName.toLowerCase());
        });

        plan.forEach((item) => {
            if (item.canonicalName || !item.attachToPage) return;
            const sanitized = this.sanitizeFilename(item.file.name);
            item.canonicalName = this.dedupeFilename(sanitized, usedNames);
        });

        return plan;
    }

    normalizeDisplayOrder() {
        this.getDisplayRecords()
            .sort((left, right) => (left.displayOrder || 999) - (right.displayOrder || 999))
            .forEach((record, index) => {
                record.displayOrder = index + 1;
            });
    }

    extractAttachmentNames(xml) {
        const names = new Set();
        const regex = /ri:filename="([^"]+)"/g;
        let match;
        while ((match = regex.exec(xml || '')) !== null) {
            names.add(match[1]);
        }
        return names;
    }

    sanitizeFilename(filename) {
        const safe = (filename || 'attachment')
            .replace(/[<>:"/\\|?*]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
        return safe || 'attachment';
    }

    dedupeFilename(filename, usedNames) {
        const dotIndex = filename.lastIndexOf('.');
        const root = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
        const ext = dotIndex >= 0 ? filename.slice(dotIndex) : '';
        let candidate = filename;
        let counter = 2;
        while (usedNames.has(candidate.toLowerCase())) {
            candidate = `${root} (${counter})${ext}`;
            counter += 1;
        }
        usedNames.add(candidate.toLowerCase());
        return candidate;
    }

    getDisplayRecords() {
        return this.files.filter((record) => record.displayInPage);
    }

    findFile(recordId) {
        return this.files.find((record) => record.id === recordId);
    }

    isSameFile(left, right) {
        return (
            left.name === right.name &&
            left.size === right.size &&
            left.lastModified === right.lastModified
        );
    }

    getExtension(filename) {
        const parts = (filename || '').toLowerCase().split('.');
        return parts.length > 1 ? `.${parts.pop()}` : '';
    }

    createId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
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
