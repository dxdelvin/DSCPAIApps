
let currentStep = 1;
const totalSteps = 6; 
const formData = {};
let maxAccessibleStep = 1; // highest step allowed to jump to
let chatHistoryId = null; // Track the current chat session

// Upload mode state
let currentMode = 'form'; // 'form' or 'upload'
let uploadChatHistoryId = null;
let uploadedFile = null;
let uploadDocumentValid = true;

const BPMN_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="8.5" y="14" width="7" height="7" rx="1.5"/><line x1="6.5" y1="10" x2="6.5" y2="14" opacity="0.5"/><line x1="17.5" y1="10" x2="17.5" y2="14" opacity="0.5"/><line x1="6.5" y1="14" x2="8.5" y2="14" opacity="0.5"/><line x1="17.5" y1="14" x2="15.5" y2="14" opacity="0.5"/></svg>';
const BPMN_GENERATE_MESSAGES = ['Analyzing process structure', 'Building BPMN elements', 'Arranging swimlanes', 'Generating diagram file'];

window.addEventListener('DOMContentLoaded', () => {
    initializeFormHandlers();
    initializeUploadHandlers();
    initializeModeSwitch();
    updateFormNavigation();
});

function initializeFormHandlers() {
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) nextBtn.addEventListener('click', handleNext);

    const prevBtn = document.getElementById('prevBtn');
    if (prevBtn) prevBtn.addEventListener('click', previousStep);

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateBPMN);
        generateBtn.disabled = true; // disabled by default until analysis is complete
    }
    const reviewAgainBtn = document.getElementById('reviewAgainBtn');
    if (reviewAgainBtn) reviewAgainBtn.addEventListener('click', refreshAnalysis);

    const editBtnReview = document.getElementById('editBtnReview');
    if (editBtnReview) editBtnReview.addEventListener('click', () => {
        // Show inline override box to edit answers directly on review
        toggleInlineOverride(true);
        // Focus the override textarea and keep on Step 6
        const overrideBox = document.getElementById('reviewOverride');
        if (overrideBox) overrideBox.focus();
        // Ensure we remain on the review step
        if (currentStep !== 6) goToStep(6);
    });

    // Support alternative button id used in UI: "Modify Inputs"
    const modifyInputsBtn = document.getElementById('modifyInputsBtn');
    if (modifyInputsBtn) modifyInputsBtn.addEventListener('click', () => {
        toggleInlineOverride(true);
        const overrideBox = document.getElementById('reviewOverride');
        if (overrideBox) overrideBox.focus();
        if (currentStep !== 6) goToStep(6);
    });

    // Reset buttons
    const editBtn = document.getElementById('editBtn');
    if (editBtn) editBtn.addEventListener('click', () => {
        // Show confirmation dialog before resetting
        showConfirmation(
            'Clear All Data?',
            'Are you sure you want to reset the form? This cannot be undone.',
            () => {
                goToStep(1);
                resetForm();
            },
            {
                icon: '⚠️',
                confirmText: 'Clear Data',
                cancelText: 'Cancel'
            }
        );
    });
    
    const inlineOverride = document.getElementById('inlineOverrideContainer');
    if (inlineOverride) inlineOverride.addEventListener('click', (e) => e.stopPropagation());

    const reviewOverride = document.getElementById('reviewOverride');
    if (reviewOverride) {
        reviewOverride.addEventListener('input', (e) => {
            formData.reviewOverride = e.target.value;
        });
    }

    // Lanes functionality
    initializeLaneHandlers();

    // Info Button
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const closeModal = document.querySelector('.close');

    if (infoBtn && infoModal) {
        infoBtn.addEventListener('click', () => {
            updateInfoModalContent();
            infoModal.style.display = 'block';
        });
    }
    if (closeModal && infoModal) {
        closeModal.addEventListener('click', () => infoModal.style.display = 'none');
    }
    window.addEventListener('click', (event) => {
        if (event.target == infoModal) {
            infoModal.style.display = 'none';
        }
    });

    // Initialize button state based on current status (if any)
    updateGenerateButtonState();

    document.querySelectorAll('.step').forEach((step) => {
        step.addEventListener('click', () => {
            const stepNum = Number(step.getAttribute('data-step'));
            if (stepNum < 1 || stepNum > totalSteps) return;
            if (stepNum > maxAccessibleStep) {
                showToast('Complete previous steps before jumping ahead.', 'warning');
                return;
            }
            goToStep(stepNum);
        });
    });

    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.target.matches('textarea')) {
            e.preventDefault();
            const targetBtn = document.getElementById('nextBtn');
            if (targetBtn && targetBtn.style.display !== 'none') targetBtn.click();
        }
    });
}

// ============== Mode Switching ==============
function initializeModeSwitch() {
    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.getAttribute('data-mode');
            if (mode === currentMode) return;
            switchMode(mode);
        });
    });
}

function switchMode(mode) {
    currentMode = mode;
    // Update tab active state
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.mode-tab[data-mode="${mode}"]`)?.classList.add('active');
    // Toggle panels
    document.querySelectorAll('.mode-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`${mode}-mode`)?.classList.add('active');
}

// ============== Upload Mode Handlers ==============
function initializeUploadHandlers() {
    const uploadArea = document.getElementById('bpmn-upload-area');
    const fileInput = document.getElementById('bpmn-file-input');
    const removeBtn = document.getElementById('removeFileBtn');
    const analyzeBtn = document.getElementById('uploadAnalyzeBtn');
    const modifyBtn = document.getElementById('uploadModifyBtn');
    const refreshBtn = document.getElementById('uploadRefreshBtn');
    const generateBtn = document.getElementById('uploadGenerateBtn');

    if (uploadArea && fileInput) {
        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) handleUploadFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) handleUploadFile(fileInput.files[0]);
        });
    }

    if (removeBtn) removeBtn.addEventListener('click', clearUploadFile);
    if (analyzeBtn) analyzeBtn.addEventListener('click', analyzeUploadedFile);
    if (modifyBtn) modifyBtn.addEventListener('click', () => toggleUploadOverride(true));
    if (refreshBtn) refreshBtn.addEventListener('click', refreshUploadAnalysis);
    if (generateBtn) generateBtn.addEventListener('click', generateUploadBPMN);

    // Ctrl+Enter in upload override
    const uploadOverride = document.getElementById('uploadOverride');
    if (uploadOverride) {
        uploadOverride.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                refreshUploadAnalysis();
            }
        });
    }
}

function handleUploadFile(file) {
    const allowed = ['image/png', 'image/jpeg', 'application/pdf'];
    if (!allowed.includes(file.type)) {
        showToast('Please upload a PNG, JPG, or PDF file.', 'warning');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showToast('File size must be under 10 MB.', 'warning');
        return;
    }
    uploadedFile = file;
    // Show file info
    const infoEl = document.getElementById('upload-file-info');
    const nameEl = document.getElementById('upload-file-name');
    const sizeEl = document.getElementById('upload-file-size');
    const areaEl = document.getElementById('bpmn-upload-area');
    if (infoEl) infoEl.style.display = 'flex';
    if (nameEl) nameEl.textContent = file.name;
    if (sizeEl) sizeEl.textContent = formatFileSize(file.size);
    if (areaEl) areaEl.style.display = 'none';
    // Enable analyze button
    const btn = document.getElementById('uploadAnalyzeBtn');
    if (btn) btn.disabled = false;
}

function clearUploadFile() {
    uploadedFile = null;
    uploadChatHistoryId = null;
    uploadDocumentValid = true;
    const infoEl = document.getElementById('upload-file-info');
    const areaEl = document.getElementById('bpmn-upload-area');
    const fileInput = document.getElementById('bpmn-file-input');
    const analyzeBtn = document.getElementById('uploadAnalyzeBtn');
    const modifyBtn = document.getElementById('uploadModifyBtn');
    const generateBtn = document.getElementById('uploadGenerateBtn');
    const panel = document.getElementById('upload-analysis-panel');
    const ctaPanel = document.getElementById('upload-cta-panel');
    const overrideContainer = document.getElementById('uploadOverrideContainer');
    if (infoEl) infoEl.style.display = 'none';
    if (areaEl) areaEl.style.display = '';
    if (fileInput) fileInput.value = '';
    if (analyzeBtn) analyzeBtn.disabled = true;
    if (modifyBtn) modifyBtn.disabled = true;
    if (generateBtn) generateBtn.disabled = true;
    if (panel) panel.style.display = 'none';
    if (ctaPanel) ctaPanel.style.display = 'none';
    if (overrideContainer) overrideContainer.style.display = 'none';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function analyzeUploadedFile() {
    if (!uploadedFile) {
        showToast('Please select a file first.', 'warning');
        return;
    }

    const panel = document.getElementById('upload-analysis-panel');
    const statusEl = document.getElementById('uploadAnalysisStatus');
    const contentEl = document.getElementById('uploadAnalysisContent');
    const generateBtn = document.getElementById('uploadGenerateBtn');
    const ctaPanel = document.getElementById('upload-cta-panel');
    const analyzeBtn = document.getElementById('uploadAnalyzeBtn');

    // Disable button and show loading state
    if (analyzeBtn) { analyzeBtn.disabled = true; analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing…'; }
    if (panel) panel.style.display = '';
    if (statusEl) statusEl.textContent = 'Analyzing...';
    if (contentEl) {
        contentEl.innerHTML = '';
        contentEl.style.display = 'flex';
        LoadingPanel.show(contentEl, { messages: ['Reading document content', 'Extracting process details', 'Analyzing workflow structure'] });
    }
    if (generateBtn) generateBtn.disabled = true;
    if (ctaPanel) ctaPanel.style.display = '';

    try {
        const fd = new FormData();
        fd.append('file', uploadedFile);

        const response = await fetch('/api/bpmn/upload-analyze', {
            method: 'POST',
            body: fd,
        });

        const result = await response.json();

        if (!response.ok || result.status !== 'success') {
            AppLogger.error('Upload analysis failed:', result.detail || result.message || response.status);
            if (statusEl) statusEl.textContent = 'Error';
            if (contentEl) contentEl.innerHTML = '<div class="analysis-error"><p>Failed to analyze file</p><p class="error-detail">The AI service is temporarily unavailable. Please try again later.</p></div>';
            return;
        }

        uploadChatHistoryId = result.chatHistoryId;
        uploadDocumentValid = result.document_valid !== false;

        if (statusEl) statusEl.textContent = uploadDocumentValid ? '✓ Complete' : '⚠ Invalid Document';
        if (contentEl) {
            let html = formatAnalysisResponse(result.analysis || 'No analysis returned.');
            if (!uploadDocumentValid) {
                html += `<div class="not-bpmn-warning">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    Document Invalid — The uploaded content does not contain meaningful information for process diagram generation.
                </div>`;
            }
            contentEl.innerHTML = html;
        }
        const modifyBtn = document.getElementById('uploadModifyBtn');
        if (generateBtn) generateBtn.disabled = !uploadDocumentValid;
        if (modifyBtn) modifyBtn.disabled = false;

    } catch (error) {
        AppLogger.error('Upload analysis error:', error);
        if (statusEl) statusEl.textContent = 'Error';
        if (contentEl) contentEl.innerHTML = '<div class="analysis-error"><p>Connection failed</p><p class="error-detail">Unable to connect to the server. Please check your connection and try again.</p></div>';
    } finally {
        // Re-enable analyze button
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Analyze File';
        }
    }
}

function toggleUploadOverride(forceShow = false) {
    const container = document.getElementById('uploadOverrideContainer');
    const textarea = document.getElementById('uploadOverride');
    if (!container) return;
    const shouldShow = forceShow || container.style.display === 'none';
    container.style.display = shouldShow ? 'block' : 'none';
    if (shouldShow && textarea) textarea.focus();
}

async function refreshUploadAnalysis() {
    if (!uploadChatHistoryId) {
        showToast('Please analyze a file first.', 'warning');
        return;
    }

    const statusEl = document.getElementById('uploadAnalysisStatus');
    const contentEl = document.getElementById('uploadAnalysisContent');
    const generateBtn = document.getElementById('uploadGenerateBtn');
    const overrideBox = document.getElementById('uploadOverride');

    const overrideText = (overrideBox?.value || '').trim();
    const message = overrideText.length > 0
        ? `Please update the analysis based on my feedback:\n\n${overrideText}`
        : 'Please refresh the analysis.';

    if (statusEl) statusEl.textContent = 'Analyzing...';
    if (contentEl) contentEl.innerHTML = '<div class="analysis-loading"><span class="spinner"></span> Updating analysis…</div>';
    if (generateBtn) generateBtn.disabled = true;

    try {
        const response = await fetch('/api/bpmn/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatHistoryId: uploadChatHistoryId,
                message,
                formData: null,
            }),
        });

        const result = await response.json();

        if (!response.ok || result.status !== 'success') {
            AppLogger.error('Refresh analysis failed:', result.detail || result.message || response.status);
            if (statusEl) statusEl.textContent = 'Error';
            if (contentEl) contentEl.innerHTML = '<div class="analysis-error"><p>Failed to refresh analysis</p><p class="error-detail">The AI service is temporarily unavailable. Please try again later.</p></div>';
            return;
        }

        if (statusEl) statusEl.textContent = '✓ Complete';
        if (contentEl) contentEl.innerHTML = formatAnalysisResponse(result.response || 'No analysis returned.');
        if (generateBtn) generateBtn.disabled = !uploadDocumentValid;
        // Clear override after success
        if (overrideBox && overrideText.length > 0) overrideBox.value = '';

    } catch (error) {
        AppLogger.error('Refresh upload analysis error:', error);
        if (statusEl) statusEl.textContent = 'Error';
        if (contentEl) contentEl.innerHTML = '<div class="analysis-error"><p>Connection failed</p><p class="error-detail">Unable to connect to the server. Please check your connection and try again.</p></div>';
    }
}

async function generateUploadBPMN() {
    if (!uploadDocumentValid) {
        showToast('Document invalid — cannot generate BPMN from this content.', 'warning');
        return;
    }

    LoadingOverlay.show({ messages: BPMN_GENERATE_MESSAGES, icon: BPMN_ICON_SVG });

    try {
        showToast('Consulting BRAIN for BPMN generation...', 'info');

        const payload = {
            chatHistoryId: uploadChatHistoryId,
            processName: uploadedFile?.name?.replace(/\.[^.]+$/, '') || 'uploaded_bpmn',
        };

        const response = await fetch('/api/generate-bpmn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (!response.ok) {
            AppLogger.error('Upload BPMN generation failed', { message: result.message, detail: result.detail });
            showToast('The AI service is temporarily unavailable. Please try again later.', 'error', 5000);
            return;
        }

        const blob = new Blob([result.xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast('BPMN generated and downloaded successfully.', 'success');

    } catch (error) {
        AppLogger.error('Upload BPMN generation error:', error);
        showToast('Unable to connect to the server. Please check your connection and try again.', 'error');
    } finally {
        LoadingOverlay.hide();
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Lane Management Functions
function initializeLaneHandlers() {
    const addLaneBtn = document.getElementById('addLaneBtn');
    if (addLaneBtn) {
        addLaneBtn.addEventListener('click', addLane);
    }

    // Initialize handlers for the first lane
    initializeLaneItemHandlers(document.querySelector('.lane-item'));
}

function createLaneHTML() {
    return `
        <div class="lane-item">
            <div class="lane-input-group">
                <input type="text" class="lane-input" placeholder="e.g., Warehouse Manager" required>
                <button type="button" class="btn-icon btn-remove-lane" title="Remove lane">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
                <button type="button" class="btn-icon btn-add-sublane" title="Add sub-lane">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Sub
                </button>
            </div>
            <div class="sublanes-container"></div>
        </div>
    `;
}

function createSublaneHTML() {
    return `
        <div class="sublane-item">
            <input type="text" class="sublane-input" placeholder="e.g., Regional Sales" required>
            <button type="button" class="btn-icon btn-remove-sublane" title="Remove sub-lane">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <button type="button" class="btn-icon btn-add-sublane" title="Add sub-lane">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Sub
            </button>
        </div>
    `;
}

function addLane() {
    const lanesContainer = document.getElementById('lanesContainer');
    const laneDiv = document.createElement('div');
    laneDiv.innerHTML = createLaneHTML();
    const laneItem = laneDiv.firstElementChild;
    lanesContainer.appendChild(laneItem);
    initializeLaneItemHandlers(laneItem);
}

function initializeLaneItemHandlers(laneItem) {
    if (!laneItem) return;

    const removeBtn = laneItem.querySelector('.btn-remove-lane');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            const lanesContainer = document.getElementById('lanesContainer');
            if (lanesContainer.querySelectorAll('.lane-item').length > 1) {
                laneItem.remove();
            } else {
                showToast('At least one lane is required', 'warning');
            }
        });
    }

    const addSublaneBtn = laneItem.querySelector('.lane-input-group .btn-add-sublane');
    if (addSublaneBtn) {
        addSublaneBtn.addEventListener('click', () => {
            const sublanesContainer = laneItem.querySelector('.sublanes-container');
            const sublaneDiv = document.createElement('div');
            sublaneDiv.innerHTML = createSublaneHTML();
            const sublaneItem = sublaneDiv.firstElementChild;
            sublanesContainer.appendChild(sublaneItem);
            initializeSublaneHandlers(sublaneItem);
        });
    }
}

function initializeSublaneHandlers(sublaneItem) {
    if (!sublaneItem) return;

    const removeBtn = sublaneItem.querySelector('.btn-remove-sublane');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            sublaneItem.remove();
        });
    }

    const addSublaneBtn = sublaneItem.querySelector('.btn-add-sublane');
    if (addSublaneBtn) {
        addSublaneBtn.addEventListener('click', () => {
            const parentContainer = sublaneItem.parentElement;
            const newSublaneDiv = document.createElement('div');
            newSublaneDiv.innerHTML = createSublaneHTML();
            const newSublaneItem = newSublaneDiv.firstElementChild;
            
            // Insert after current sublane
            sublaneItem.insertAdjacentElement('afterend', newSublaneItem);
            initializeSublaneHandlers(newSublaneItem);
        });
    }
}

function handleNext() {
    if (!validateCurrentStep()) {
        markStepInvalid(currentStep);
        return;
    }
    clearStepInvalid(currentStep);
    saveCurrentStepData();
    maxAccessibleStep = Math.max(maxAccessibleStep, currentStep + 1);
    nextStep();
}

function saveCurrentStepData() {
    const step = document.getElementById(`step-${currentStep}`);
    if (!step) return;
    
    // Special handling for Step 2 (Lanes)
    if (currentStep === 2) {
        saveLanesData();
        return;
    }
    
    step.querySelectorAll('input, textarea, select').forEach((input) => {
        if (input.id) formData[input.id] = input.value;
    });
}

function loadCurrentStepData() {
    const step = document.getElementById(`step-${currentStep}`);
    if (!step) return;
    
    // Special handling for Step 2 (Lanes)
    if (currentStep === 2) {
        loadLanesData();
        return;
    }

    // Special handling for inline override on Review step
    if (currentStep === 6) {
        const overrideBox = document.getElementById('reviewOverride');
        if (overrideBox && formData.reviewOverride) overrideBox.value = formData.reviewOverride;
    }
    
    step.querySelectorAll('input, textarea, select').forEach((input) => {
        if (input.id && formData[input.id]) input.value = formData[input.id];
    });
}

function saveLanesData() {
    const lanes = [];
    document.querySelectorAll('.lane-item').forEach((laneItem) => {
        const laneInput = laneItem.querySelector('.lane-input');
        const sublanes = [];
        
        laneItem.querySelectorAll('.sublane-input').forEach((sublaneInput) => {
            if (sublaneInput.value.trim()) {
                sublanes.push(sublaneInput.value.trim());
            }
        });
        
        if (laneInput && laneInput.value.trim()) {
            lanes.push({
                name: laneInput.value.trim(),
                sublanes: sublanes
            });
        }
    });
    
    formData.lanesData = lanes;
    // Create formatted strings for display
    formData.participants = lanes.map(l => l.name).join(', ');
    formData.subLanes = lanes.flatMap(l => l.sublanes.map(s => `${s} (under ${l.name})`)).join(', ');
}

function loadLanesData() {
    if (!formData.lanesData || formData.lanesData.length === 0) return;
    
    const lanesContainer = document.getElementById('lanesContainer');
    lanesContainer.innerHTML = '';
    
    formData.lanesData.forEach((laneData) => {
        const laneDiv = document.createElement('div');
        laneDiv.innerHTML = createLaneHTML();
        const laneItem = laneDiv.firstElementChild;
        
        const laneInput = laneItem.querySelector('.lane-input');
        if (laneInput) laneInput.value = laneData.name;
        
        const sublanesContainer = laneItem.querySelector('.sublanes-container');
        laneData.sublanes.forEach((sublaneName) => {
            const sublaneDiv = document.createElement('div');
            sublaneDiv.innerHTML = createSublaneHTML();
            const sublaneItem = sublaneDiv.firstElementChild;
            const sublaneInput = sublaneItem.querySelector('.sublane-input');
            if (sublaneInput) sublaneInput.value = sublaneName;
            sublanesContainer.appendChild(sublaneItem);
            initializeSublaneHandlers(sublaneItem);
        });
        
        lanesContainer.appendChild(laneItem);
        initializeLaneItemHandlers(laneItem);
    });
}

function validateCurrentStep() {
    const step = document.getElementById(`step-${currentStep}`);
    if (!step) return true;
    const requiredInputs = step.querySelectorAll('[required]');
    let isValid = true;
    requiredInputs.forEach((input) => {
        if (!input.value.trim()) {
            input.classList.add('error');
            isValid = false;
            input.addEventListener('input', () => input.classList.remove('error'), { once: true });
        }
    });
    if (!isValid) showToast('Please complete required fields before continuing.', 'warning');
    return isValid;
}

function nextStep() { if (currentStep < totalSteps) goToStep(currentStep + 1); }
function previousStep() { if (currentStep > 1) goToStep(currentStep - 1); }

function goToStep(stepNum) {
    if (stepNum < 1 || stepNum > totalSteps) return;
    const movingForward = stepNum > currentStep;
    if (movingForward) {
        if (!validateCurrentStep()) {
            markStepInvalid(currentStep);
            return;
        }
        clearStepInvalid(currentStep);
        saveCurrentStepData();
        maxAccessibleStep = Math.max(maxAccessibleStep, stepNum);
    } else if (currentStep !== stepNum) {
        saveCurrentStepData();
    }

    document.querySelectorAll('.form-step').forEach((step) => step.classList.remove('active'));
    const target = document.getElementById(`step-${stepNum}`);
    if (target) {
        target.classList.add('active');
        loadCurrentStepData();
    }
    currentStep = stepNum;
    updateStepIndicator();
    updateFormNavigation();
    if (currentStep === 6) {
        updateGenerateButtonState();
    }
    if (currentStep === totalSteps) {
        fetchBrainAnalysis();
    }
    document.querySelector('.form-container')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function markStepInvalid(stepNum) {
    const stepEl = document.querySelector(`.step[data-step="${stepNum}"]`);
    if (stepEl) stepEl.classList.add('step-error');
}

function clearStepInvalid(stepNum) {
    const stepEl = document.querySelector(`.step[data-step="${stepNum}"]`);
    if (stepEl) stepEl.classList.remove('step-error');
}

function updateStepIndicator() {
    document.querySelectorAll('.step').forEach((step) => {
        const stepNum = Number(step.getAttribute('data-step'));
        step.classList.remove('step-active', 'step-completed');
        if (stepNum === currentStep) step.classList.add('step-active');
        else if (stepNum < currentStep && stepNum <= maxAccessibleStep) step.classList.add('step-completed');
    });
}

function updateFormNavigation() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (prevBtn) prevBtn.style.display = currentStep > 1 ? 'block' : 'none';
    if (nextBtn) {
        if (currentStep === totalSteps) nextBtn.style.display = 'none';
        else {
            nextBtn.style.display = 'block';
            nextBtn.textContent = currentStep === totalSteps - 1 ? 'Review' : 'Next';
        }
    }
}

function updateGenerateButtonState() {
    const statusEl = document.getElementById('analysisStatus');
    const generateBtn = document.getElementById('generateBtn');
    if (!generateBtn) return;
    const statusText = (statusEl?.textContent || '').toLowerCase();
    // Enable only when status indicates completion
    const isComplete = statusText.includes('complete') && !statusText.includes('error');
    generateBtn.disabled = !isComplete;
}


async function fetchBrainAnalysis() {
    const statusEl = document.getElementById('analysisStatus');
    const contentEl = document.getElementById('analysisContent');
    const generateBtn = document.getElementById('generateBtn');
    
    if (statusEl) statusEl.textContent = 'Analyzing...';
    if (contentEl) contentEl.innerHTML = '<div class="analysis-loading"><span class="spinner"></span> Analyzing your process...</div>';
    if (generateBtn) generateBtn.disabled = true;

    try {
        // Use session-based endpoint for analysis
        const response = await fetch('/api/bpmn/start-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (!response.ok || result.status !== 'success') {
            AppLogger.error('Brain analysis session failed:', result.detail || result.message || response.status);
            if (statusEl) statusEl.textContent = 'Error';
            if (contentEl) contentEl.innerHTML = '<div class="analysis-error"><p>Failed to connect to AI Brain</p><p class="error-detail">The AI service is temporarily unavailable. Please try again later.</p></div>';
            updateGenerateButtonState();
            return;
        }

        // Store the chat history ID for BPMN generation context
        chatHistoryId = result.chatHistoryId;
        
        if (statusEl) statusEl.textContent = '✓ Complete';
        if (contentEl) {
            // Format and display the analysis nicely
            contentEl.innerHTML = formatAnalysisResponse(result.analysis || 'No analysis returned.');
        }
        updateGenerateButtonState();
        
    } catch (error) {
        AppLogger.error('Analysis error:', error);
        if (statusEl) statusEl.textContent = 'Error';
        if (contentEl) contentEl.innerHTML = '<div class="analysis-error"><p>Connection failed</p><p class="error-detail">Unable to connect to the server. Please check your connection and try again.</p></div>';
        updateGenerateButtonState();
    }
}

function formatAnalysisResponse(text) {
    if (!text) return '<div class="analysis-empty"><p>No analysis available.</p></div>';
    
    // Split by double newlines to preserve paragraph structure
    const sections = text.split('\n\n').map(s => s.trim()).filter(s => s.length > 0);
    
    let html = '<div class="analysis-formatted">';
    
    sections.forEach(section => {
        // Check if section starts with markdown headers
        const h2Match = section.match(/^## (.+)$/m);
        const h3Match = section.match(/^### (.+)$/m);
        
        if (h2Match) {
            // Main heading
            const heading = h2Match[1];
            const content = section.replace(/^## .+\n?/, '').trim();
            html += `<div class="analysis-section">`;
            html += `<h2 class="analysis-main-heading">➤ ${heading}</h2>`;
            if (content) {
                html += formatContent(content);
            }
            html += `</div>`;
        } else if (h3Match) {
            // Subheading
            const heading = h3Match[1];
            const content = section.replace(/^### .+\n?/, '').trim();
            html += `<div class="analysis-subsection">`;
            html += `<h3 class="analysis-subheading">⬥ ${heading}</h3>`;
            if (content) {
                html += formatContent(content);
            }
            html += `</div>`;
        } else {
            // Regular content paragraph
            html += formatContent(section);
        }
    });
    
    html += '</div>';
    return html;
}

function formatContent(content) {
    if (!content) return '';
    
    // Check if content has list items
    const lines = content.split('\n').map(l => l.trim());
    const hasLists = lines.some(l => /^[-*•]\s/.test(l) || /^\d+\.\s/.test(l));
    
    if (hasLists) {
        // Process as list
        let html = '';
        let currentList = null;
        let listType = null;
        
        lines.forEach(line => {
            if (/^[-*•]\s/.test(line)) {
                const item = line.replace(/^[-*•]\s/, '').trim();
                if (currentList !== 'ul') {
                    if (currentList) html += '</ul>';
                    html += '<ul class="analysis-list">';
                    currentList = 'ul';
                    listType = 'ul';
                }
                html += `<li>${escapeBoldAndItalics(item)}</li>`;
            } else if (/^\d+\.\s/.test(line)) {
                const item = line.replace(/^\d+\.\s/, '').trim();
                if (currentList !== 'ol') {
                    if (currentList) html += currentList === 'ul' ? '</ul>' : '</ol>';
                    html += '<ol class="analysis-list">';
                    currentList = 'ol';
                    listType = 'ol';
                }
                html += `<li>${escapeBoldAndItalics(item)}</li>`;
            } else if (line.length > 0) {
                if (currentList) {
                    html += currentList === 'ul' ? '</ul>' : '</ol>';
                    currentList = null;
                }
                html += `<p class="analysis-paragraph">${escapeBoldAndItalics(line)}</p>`;
            }
        });
        
        if (currentList) {
            html += currentList === 'ul' ? '</ul>' : '</ol>';
        }
        
        return html;
    } else {
        // Simple paragraph with formatting
        return `<p class="analysis-paragraph">${escapeBoldAndItalics(content)}</p>`;
    }
}

async function refreshAnalysis() {
    const statusEl = document.getElementById('analysisStatus');
    const contentEl = document.getElementById('analysisContent');
    const overrideBox = document.getElementById('reviewOverride');
    const generateBtn = document.getElementById('generateBtn');

    // Persist any inline override into formData
    if (overrideBox) {
        formData.reviewOverride = overrideBox.value || formData.reviewOverride || '';
    }

    if (statusEl) statusEl.textContent = 'Analyzing...';
    if (contentEl) contentEl.innerHTML = '<div class="analysis-loading"><span class="spinner"></span> Updating analysis…</div>';
    if (generateBtn) generateBtn.disabled = true;

    try {
        // If no session yet, start one
        if (!chatHistoryId) {
            await fetchBrainAnalysis();
            return;
        }

        const message = formData.reviewOverride && formData.reviewOverride.trim().length > 0
            ? `Please update the analysis based on my edited details:\n\n${formData.reviewOverride}`
            : 'Please refresh the analysis based on my current inputs.';

        const response = await fetch('/api/bpmn/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatHistoryId,
                message,
                formData
            })
        });

        const result = await response.json();
        if (!response.ok || result.status !== 'success') {
            AppLogger.error('Refresh analysis failed:', result.detail || result.message || response.status);
            if (statusEl) statusEl.textContent = 'Error';
            if (contentEl) contentEl.innerHTML = '<div class="analysis-error"><p>Failed to refresh analysis</p><p class="error-detail">The AI service is temporarily unavailable. Please try again later.</p></div>';
            updateGenerateButtonState();
            return;
        }

        if (statusEl) statusEl.textContent = '✓ Complete';
        if (contentEl) contentEl.innerHTML = formatAnalysisResponse(result.response || 'No analysis returned.');
        updateGenerateButtonState();
        // Clear Modify Inputs textbox on successful completion
        if (overrideBox && (overrideBox.value || '').trim().length > 0) {
            overrideBox.value = '';
            formData.reviewOverride = '';
        }
    } catch (error) {
        AppLogger.error('Refresh analysis error:', error);
        if (statusEl) statusEl.textContent = 'Error';
        if (contentEl) contentEl.innerHTML = '<div class="analysis-error"><p>Connection failed</p><p class="error-detail">Unable to connect to the server. Please check your connection and try again.</p></div>';
        updateGenerateButtonState();
    }
}

function escapeBoldAndItalics(text) {
    // Convert markdown bold **text** to <strong>
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Convert markdown italic *text* to <em>
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Convert markdown code `text` to <code>
    text = text.replace(/`(.+?)`/g, '<code>$1</code>');
    return text;
}

// Allow quick send with Ctrl+Enter inside the override box
document.addEventListener('keydown', (e) => {
    const overrideBox = document.getElementById('reviewOverride');
    if (!overrideBox) return;
    const isFocused = document.activeElement === overrideBox;
    if (isFocused && e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        refreshAnalysis();
    }
});

async function generateBPMN() {
    LoadingOverlay.show({ messages: BPMN_GENERATE_MESSAGES, icon: BPMN_ICON_SVG });
    
    try {
        showToast('Consulting BRAIN for BPMN generation...', 'info');
        
        // Include chat history ID to maintain context
        const payload = {
            ...formData,
            chatHistoryId: chatHistoryId
        };
        
        const response = await fetch('/api/generate-bpmn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            AppLogger.error('BPMN generation failed', { message: result.message, detail: result.detail });
            showToast('The AI service is temporarily unavailable. Please try again later.', 'error', 5000);
            return;
        }

        // 1. Create a Blob from the extracted XML string
        const blob = new Blob([result.xml], { type: 'application/xml' });
        
        // 2. Create a temporary URL for the Blob
        const url = URL.createObjectURL(blob);
        
        // 3. Create a hidden link and click it to trigger the download
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename; // Uses the safe filename from the backend
        document.body.appendChild(link);
        link.click();
        
        // 4. Cleanup
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showToast('BPMN generated and downloaded successfully.', 'success');
        
    } catch (error) {
        AppLogger.error('BPMN generation error:', error);
        showToast('Unable to connect to the server. Please check your connection and try again.', 'error');
    } finally {
        LoadingOverlay.hide();
    }
}

function downloadFakeBPMN() {
    const filename = `${(formData.processName || 'bpmn_diagram').replace(/\s+/g, '_')}.xml`;
    const overrideNote = (formData.reviewOverride || '').trim();
    // Simple fake BPMN structure using the new fields
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" id="sample-diagram" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn2:process id="Process_1" isExecutable="false">
        ${overrideNote ? `<bpmn2:documentation>${escapeXml(overrideNote)}</bpmn2:documentation>` : ''}
    <bpmn2:startEvent id="StartEvent_1" name="${escapeXml(formData.startTriggers || 'Start')}"/>
    <bpmn2:task id="Activity_1" name="${escapeXml((formData.processActivities || '').split('.')[0] || 'Task 1')}"/>
    <bpmn2:endEvent id="Event_End" name="End"/>
  </bpmn2:process>
  <bpmn2:collaboration id="Collaboration_1">
    <bpmn2:participant id="Participant_1" name="${escapeXml(formData.poolName || 'Pool')}" processRef="Process_1"/>
  </bpmn2:collaboration>
</bpmn2:definitions>`;
    
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function escapeXml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function sanitizeDetail(detail) {
    if (!detail) return '';
    const trimmed = detail.trim();
    return trimmed.startsWith('Auth Error') ? 'Auth Error' : trimmed;
}

function updateInfoModalContent() {
    const infoTitle = document.getElementById('infoModalTitle');
    const infoContent = document.getElementById('infoModalContent');

    if (currentMode === 'upload') {
        if (infoTitle) infoTitle.textContent = 'Upload & Build Guide';
        if (infoContent) {
            infoContent.innerHTML = `<p>Use Upload & Build when you already have process material and want the AI to convert it into BPMN faster.</p>
                <div class="guide-section">
                    <h4>📁 What you can upload</h4>
                    <ul>
                        <li><strong>PDF:</strong> Process descriptions, SOPs, requirements, workshop notes, or exported diagrams.</li>
                        <li><strong>PNG / JPG / JPEG:</strong> Screenshots of flowcharts, whiteboard sketches, BPMN drafts, or process diagrams.</li>
                    </ul>
                </div>
                <div class="guide-section">
                    <h4>🔎 How analysis works</h4>
                    <ul>
                        <li><strong>PDF files:</strong> Text is extracted and analyzed by the AI.</li>
                        <li><strong>Image files:</strong> The AI inspects the visual content directly.</li>
                        <li><strong>Best results:</strong> Upload clear, readable files with visible decisions, actors, and sequence flow.</li>
                    </ul>
                </div>
                <div class="guide-section">
                    <h4>🛠 Recommended workflow</h4>
                    <ul>
                        <li>Upload one process-focused file.</li>
                        <li>Click <strong>Analyze File</strong> and review the AI summary.</li>
                        <li>Use <strong>Modify Inputs</strong> to correct missing lanes, gateways, or end states.</li>
                        <li>Click <strong>Generate BPMN</strong> once the analysis matches your intended flow.</li>
                    </ul>
                </div>
                <div class="guide-example">
                    <strong>Tip:</strong> If your file contains multiple processes, mention in Modify Inputs which one should be modeled in the final BPMN.
                </div>`;
        }
        return;
    }
    
    const stepInfo = {
        1: {
            title: 'Step 1: Define Your Process',
            content: `<p>Start by giving your process a clear identity. This helps the AI understand the scope.</p>
                <div class="guide-section">
                    <h4>📝 What to write</h4>
                    <ul>
                        <li><strong>Process Name:</strong> Use a clear Verb-Noun format (e.g., "Handle Customer Order").</li>
                        <li><strong>Pool/Department:</strong> The main organization or system owning this process (e.g., "DSCP: Digital Supply Chain Planning").</li>
                    </ul>
                </div>
                <div class="guide-example">
                    <strong>Good:</strong> "Approve Purchase Request"<br>
                    <strong>Bad:</strong> "Approval stuff"
                </div>`
        },
        2: {
            title: 'Step 2: Who is Involved? (Swimlanes)',
            content: `<p>List the specific roles, systems, or departments that perform tasks. These will become the horizontal <strong>Swimlanes</strong> in your diagram.</p>
                <div class="guide-section">
                    <h4>👥 Participants</h4>
                    <p>Add a new lane for every distinct actor (Human or System).</p>
                    <ul>
                        <li><strong>Human Roles:</strong> "Demand Planner", "Manager", "Analyst".</li>
                        <li><strong>Systems:</strong> "SAP ERP", "Salesforce", "Email Server".</li>
                    </ul>
                </div>
                <p><em>Note: You can add sub-lanes if multiple teams work under one department, but usually main lanes are enough.</em></p>`
        },
        3: {
            title: 'Step 3: What Starts the Process?',
            content: `<p>Every process must have a trigger. How does this workflow begin?</p>
                <div class="guide-section">
                    <h4>🚦 Trigger Types</h4>
                    <ul>
                        <li><strong>Message:</strong> Receiving an email, file, or order (e.g., "Receive Order via EDI").</li>
                        <li><strong>Timer:</strong> A scheduled event (e.g., "Every Monday morning").</li>
                        <li><strong>Manual:</strong> User action (e.g., "User logs into portal").</li>
                    </ul>
                </div>
                <div class="guide-example">
                    "Planner receives a new demand signal from the Market."
                </div>`
        },
        4: {
            title: 'Step 4: The Process Story',
            content: `<p>Describe the step-by-step actions. This is the most important part for the AI.</p>
                <div class="guide-section">
                    <h4>✍️ How to describe flow</h4>
                    <ul>
                        <li><strong>Sequence:</strong> "First X does this, then Y does that."</li>
                        <li><strong>Responsibility:</strong> ALWAYS mention who does what (e.g., "<strong>Manager</strong> approves the request").</li>
                        <li><strong>Gateways (Decisions):</strong> "If approved, send email. If rejected, close ticket."</li>
                        <li><strong>Parallel:</strong> "At the same time, Finance checks credit and Warehouse picks goods."</li>
                    </ul>
                </div>`
        },
        5: {
            title: 'Step 5: Delays & Waiting',
            content: `<p>Does the process pause to wait for something outside your control?</p>
                 <div class="guide-section">
                    <h4>⏳ Intermediate Events</h4>
                    <ul>
                        <li><strong>Time Delays:</strong> "Wait 24 hours for confirmation."</li>
                        <li><strong>External Events:</strong> "Wait for customer reply" or "Wait for payment signal."</li>
                    </ul>
                </div>
                <p><em>If the process flows continuously without external waits, you can skip this.</em></p>`
        },
        6: {
            title: 'Step 6: Review & Generate',
            content: `<p>Final check before creating the diagram.</p>
                <div class="guide-section">
                    <h4>✅ Checklist</h4>
                    <ul>
                        <li>Check the <strong>AI Analysis</strong> on the right side. Does it understand your flow?</li>
                        <li>If the analysis looks wrong, click <strong>Modify Inputs</strong> to correct the text.</li>
                        <li>When satisfied, click <strong>Generate BPMN</strong> to download your .xml file.</li>
                    </ul>
                </div>`
        }
    };
    
    const currentInfo = stepInfo[currentStep] || stepInfo[1];
    if (infoTitle) infoTitle.textContent = currentInfo.title;
    if (infoContent) infoContent.innerHTML = currentInfo.content;
}

function resetForm() {
    // Clear formData object
    Object.keys(formData).forEach((k) => delete formData[k]);
    
    // Reset chat history
    chatHistoryId = null;
    
    // Clear all input fields in the DOM
    document.querySelectorAll('input, textarea, select').forEach((input) => { 
        input.value = ''; 
        input.classList.remove('error'); 
    });
    
    // Reset analysis panel
    const analysisContent = document.getElementById('analysisContent');
    if (analysisContent) {
        analysisContent.innerHTML = `
            <div class="analysis-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <p>Click "Refresh Analysis" to get AI insights about your process</p>
            </div>
        `;
    }
    
    const analysisStatus = document.getElementById('analysisStatus');
    if (analysisStatus) analysisStatus.textContent = 'Ready';
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) generateBtn.disabled = true;
    
    // Reset to step 1
    maxAccessibleStep = 1;
    goToStep(1);
    showToast('Form reset successfully.', 'info');
}

function toggleInlineOverride(forceShow = false) {
    const container = document.getElementById('inlineOverrideContainer');
    const textarea = document.getElementById('reviewOverride');
    if (!container) return;
    const shouldShow = forceShow || container.style.display === 'none';
    container.style.display = shouldShow ? 'block' : 'none';
    if (shouldShow && textarea) {
        if (formData.reviewOverride) textarea.value = formData.reviewOverride;
        textarea.focus();
    }
}
