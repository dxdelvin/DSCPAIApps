/**
 * FS & BR Document Builder
 * Handles mode switching between Functional Specification and Business Requirement,
 * multi-step form navigation for both, checkbox "Other" toggling,
 * screenshot uploads, review summary rendering, and .docx export via API.
 */

// ═══════════════════════════════════════════════════
// Shared state
// ═══════════════════════════════════════════════════
let currentMode = 'functional-spec';  // 'functional-spec' | 'business-req'

// ── Functional Spec state ──
let currentStep = 1;
const totalSteps = 7;
let maxAccessibleStep = 1;
let problemFiles = [];
let solutionFiles = [];

// ── Business Requirement state ──
let brCurrentStep = 1;
const brTotalSteps = 8;
let brMaxAccessibleStep = 1;

window.addEventListener('DOMContentLoaded', () => {
    initModeSwitch();
    // Functional Spec
    initNavigation();
    initCheckboxToggles();
    initModalHandlers();
    initUploadZone('problem');
    initUploadZone('solution');
    updateNav();
    // Business Requirement
    initBrNavigation();
    initBrCostTable();
    initBrJsonLoad();
    initBrDecisionToggle();
    updateBrNav();
});

/* ═══════════════════════════════════════════════════
   Mode Switching (same pattern as Audit Checker)
   ═══════════════════════════════════════════════════ */

function initModeSwitch() {
    document.querySelectorAll('.mode-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            switchMode(mode);
        });
    });
}

function switchMode(mode) {
    currentMode = mode;

    // Update tab buttons
    document.querySelectorAll('.mode-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Update panel visibility
    document.querySelectorAll('.mode-panel').forEach(panel => {
        const isActive = panel.id === `${mode}-mode`;
        panel.classList.toggle('active', isActive);
        panel.style.display = isActive ? 'block' : 'none';
    });
}

/* ═══════════════════════════════════════════════════
   FUNCTIONAL SPEC — Navigation
   ═══════════════════════════════════════════════════ */

function initNavigation() {
    const nextBtn = document.getElementById('nextBtn');
    const prevBtn = document.getElementById('prevBtn');
    const resetBtn = document.getElementById('resetBtn');
    const exportBtn = document.getElementById('exportBtn');
    const editFromReviewBtn = document.getElementById('editFromReviewBtn');

    if (nextBtn) nextBtn.addEventListener('click', nextStep);
    if (prevBtn) prevBtn.addEventListener('click', prevStep);
    if (resetBtn) resetBtn.addEventListener('click', () => {
        showConfirmation(
            'Reset Form?',
            'All your inputs will be cleared. This cannot be undone.',
            () => { resetForm(); goToStep(1); },
            { icon: '⚠️', confirmText: 'Reset', cancelText: 'Cancel' }
        );
    });
    if (exportBtn) exportBtn.addEventListener('click', exportDocx);
    if (editFromReviewBtn) editFromReviewBtn.addEventListener('click', () => goToStep(1));

    // Allow clicking step indicators to jump (only to visited steps)
    document.querySelectorAll('#functional-spec-mode .step-indicator .step').forEach(el => {
        el.addEventListener('click', () => {
            const target = parseInt(el.dataset.step, 10);
            if (target <= maxAccessibleStep) goToStep(target);
        });
    });
}

function nextStep() {
    if (currentStep < totalSteps) {
        if (!validateStep(currentStep)) return;
        goToStep(currentStep + 1);
    }
}

function prevStep() {
    if (currentStep > 1) goToStep(currentStep - 1);
}

function goToStep(n) {
    if (n < 1 || n > totalSteps) return;

    // Clear validation highlights when navigating
    document.querySelectorAll('#functional-spec-mode .field-error').forEach(el => el.classList.remove('field-error'));

    // Hide current
    document.querySelectorAll('#functional-spec-mode .form-step').forEach(s => s.classList.remove('active'));
    document.getElementById(`step-${n}`).classList.add('active');

    currentStep = n;
    if (n > maxAccessibleStep) maxAccessibleStep = n;

    // If landing on review step, build summary
    if (n === totalSteps) buildReviewSummary();

    updateNav();
    // Scroll form into view
    document.querySelector('#functional-spec-mode .form-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateNav() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    if (prevBtn) prevBtn.style.display = currentStep > 1 ? '' : 'none';
    if (nextBtn) {
        nextBtn.style.display = currentStep < totalSteps ? '' : 'none';
        nextBtn.textContent = currentStep === totalSteps - 1 ? 'Review' : 'Next';
    }

    // Update step indicators
    document.querySelectorAll('#functional-spec-mode .step-indicator .step').forEach(el => {
        const s = parseInt(el.dataset.step, 10);
        el.classList.remove('step-active', 'step-completed');
        if (s === currentStep) el.classList.add('step-active');
        else if (s < currentStep) el.classList.add('step-completed');
    });
}

function resetForm() {
    // Clear all inputs
    document.querySelectorAll('#functional-spec-mode input[type="text"], #functional-spec-mode textarea').forEach(el => { el.value = ''; });
    document.querySelectorAll('#functional-spec-mode input[type="checkbox"]').forEach(el => { el.checked = false; });
    // Re-hide all "other" inputs
    document.querySelectorAll('#functional-spec-mode .other-input').forEach(el => el.classList.add('hidden'));
    // Clear screenshots
    problemFiles = [];
    solutionFiles = [];
    renderFileList('problem');
    renderFileList('solution');
    maxAccessibleStep = 1;
    showToast('Form has been reset', 'info');
}

/* ═══════════════════════════════════════════════════
   Checkbox "Other" Toggle
   ═══════════════════════════════════════════════════ */

function initCheckboxToggles() {
    document.querySelectorAll('[data-toggle-other]').forEach(cb => {
        cb.addEventListener('change', () => {
            const target = document.getElementById(cb.dataset.toggleOther);
            if (target) {
                target.classList.toggle('hidden', !cb.checked);
                if (cb.checked) target.focus();
                else target.value = '';
            }
        });
    });
}

/* ═══════════════════════════════════════════════════
   FS Step Validation
   ═══════════════════════════════════════════════════ */

function validateStep(step) {
    document.querySelectorAll('#functional-spec-mode .field-error').forEach(el => el.classList.remove('field-error'));

    const missing = [];

    const requireText = (id, label) => {
        if (!val(id)) {
            const el = document.getElementById(id);
            if (el) el.classList.add('field-error');
            missing.push(label);
        }
    };

    const requireCheckboxGroup = (name, label) => {
        if (!document.querySelectorAll(`input[name="${name}"]:checked`).length) {
            document.querySelectorAll(`input[name="${name}"]`).forEach(cb => {
                const col = cb.closest('.checkbox-column');
                if (col) col.classList.add('field-error');
            });
            missing.push(label);
        }
    };

    switch (step) {
        case 1:
            requireText('userRole', 'I as a');
            requireText('userWant', 'want to');
            requireText('userAbility', 'to be able to');
            break;
        case 2:
            requireCheckboxGroup('function', 'Function');
            requireCheckboxGroup('processArea', 'Process-Area');
            break;
        case 3:
            requireCheckboxGroup('userGroup', 'User Group');
            break;
        case 4:
            requireText('problemDescription', 'Problem Description');
            break;
        case 5:
            requireText('solutionDescription', 'Solution Description');
            break;
        case 6: {
            const anyDev = ['erp', 'scm', 'cloud'].some(n =>
                document.querySelectorAll(`input[name="${n}"]:checked`).length > 0
            );
            if (!anyDev) {
                document.querySelectorAll('#functional-spec-mode .checkbox-column').forEach(col => {
                    if (col.closest('#step-6')) col.classList.add('field-error');
                });
                missing.push('at least one Development System');
            }
            requireText('technicalDetails', 'Technical Details');
            requireText('namesAndLanguage', 'Names and Language');
            requireText('authorization', 'Authorization');
            break;
        }
    }

    if (missing.length) {
        showToast(`Please fill in: ${missing.join(', ')}`, 'warning');
        const firstError = document.querySelector('#functional-spec-mode .field-error');
        if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
    }
    return true;
}

/* ═══════════════════════════════════════════════════
   Screenshot Upload — standalone per-zone logic
   ═══════════════════════════════════════════════════ */

function getFiles(prefix) { return prefix === 'problem' ? problemFiles : solutionFiles; }
function setFiles(prefix, files) { if (prefix === 'problem') problemFiles = files; else solutionFiles = files; }

function initUploadZone(prefix) {
    const dropArea  = document.getElementById(`${prefix}-upload-area`);
    const fileInput = document.getElementById(`${prefix}-file-input`);
    if (!dropArea || !fileInput) return;

    let dragCounter = 0;

    dropArea.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
        addFiles(prefix, Array.from(fileInput.files));
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
        const valid = Array.from(e.dataTransfer.files).filter(f => isValidImage(f));
        if (valid.length) addFiles(prefix, valid);
        else showToast('Only .jpg, .jpeg, .png files are supported', 'warning');
    });
}

function isValidImage(file) {
    const validTypes = ['image/jpeg', 'image/png'];
    const validExts  = ['.jpg', '.jpeg', '.png'];
    return validTypes.includes(file.type) || validExts.some(ext => file.name.toLowerCase().endsWith(ext));
}

function addFiles(prefix, newFiles) {
    const files = getFiles(prefix);
    const MAX = 10;
    const MAX_SIZE = 5 * 1024 * 1024;

    newFiles.forEach(file => {
        if (files.length >= MAX) { showToast(`Maximum ${MAX} files allowed`, 'warning'); return; }
        if (file.size > MAX_SIZE) { showToast(`${file.name} exceeds 5 MB limit`, 'warning'); return; }
        if (!isValidImage(file)) { showToast(`${file.name} is not a supported file type`, 'warning'); return; }
        if (files.some(f => f.name === file.name && f.size === file.size)) { showToast(`${file.name} already added`, 'warning'); return; }

        const reader = new FileReader();
        reader.onload = () => {
            files.push({ name: file.name, size: file.size, type: file.type, data: reader.result });
            renderFileList(prefix);
        };
        reader.readAsDataURL(file);
    });
}

function renderFileList(prefix) {
    const files = getFiles(prefix);
    const container = document.getElementById(`${prefix}-files-list`);
    if (!container) return;
    container.innerHTML = '';

    let dragSrcIdx = null;

    files.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.draggable = true;

        const isImg = file.type.startsWith('image/');
        const preview = isImg ? `<img src="${file.data}" class="file-preview" alt="Preview">` : '';

        item.innerHTML = `
            <div class="file-item-content">
                ${preview}
                <div class="file-details">
                    <p class="file-name">${escapeText(file.name)}</p>
                    <p class="file-size">${fmtBytes(file.size)}</p>
                </div>
            </div>
            <button type="button" class="btn-remove-file" title="Remove">✕</button>
        `;

        item.querySelector('.btn-remove-file').addEventListener('click', e => {
            e.stopPropagation();
            files.splice(idx, 1);
            renderFileList(prefix);
            showToast('File removed', 'info');
        });

        // Drag-to-reorder
        item.addEventListener('dragstart', e => {
            dragSrcIdx = idx;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', '');
        });
        item.addEventListener('dragend', () => {
            container.querySelectorAll('.file-item').forEach(el => el.classList.remove('dragging', 'drag-over'));
            dragSrcIdx = null;
        });
        item.addEventListener('dragover', e => {
            e.preventDefault();
            if (dragSrcIdx !== null && dragSrcIdx !== idx) item.classList.add('drag-over');
        });
        item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
        item.addEventListener('drop', e => {
            e.preventDefault(); e.stopPropagation();
            if (dragSrcIdx !== null && dragSrcIdx !== idx) {
                const [moved] = files.splice(dragSrcIdx, 1);
                files.splice(idx, 0, moved);
                renderFileList(prefix);
            }
            container.querySelectorAll('.file-item').forEach(el => el.classList.remove('drag-over'));
        });

        container.appendChild(item);
    });
}

function escapeText(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function fmtBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* ═══════════════════════════════════════════════════
   Info Modal
   ═══════════════════════════════════════════════════ */

function initModalHandlers() {
    const infoBtn = document.getElementById('infoBtn');
    const modal = document.getElementById('infoModal');
    const closeBtn = modal ? modal.querySelector('.close') : null;

    if (infoBtn && modal) infoBtn.addEventListener('click', () => modal.style.display = 'block');
    if (closeBtn && modal) closeBtn.addEventListener('click', () => modal.style.display = 'none');
    if (modal) window.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
}

/* ═══════════════════════════════════════════════════
   FS Collect Form Data
   ═══════════════════════════════════════════════════ */

function collectFormData() {
    const checked = name => Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(cb => cb.value);

    return {
        userStory: {
            role: val('userRole'),
            want: val('userWant'),
            ability: val('userAbility'),
        },
        process: {
            function: { selected: checked('function'), other: val('functionOther') },
            processArea: { selected: checked('processArea'), other: val('processAreaOther') },
            processSubArea: { selected: checked('processSubArea') },
            describeBelow: val('processDescribeBelow'),
        },
        user: {
            selected: checked('userGroup'),
            other: val('userGroupOther'),
            describeBelow: val('userGroupDescribeBelow'),
        },
        problemDescription: val('problemDescription'),
        solutionDescription: val('solutionDescription'),
        developmentSystem: {
            erp: { selected: checked('erp'), other: val('erpOther') },
            scm: { selected: checked('scm'), other: val('scmOther') },
            cloud: { selected: checked('cloud'), other: val('cloudOther') },
        },
        technicalDetails: val('technicalDetails'),
        namesAndLanguage: val('namesAndLanguage'),
        authorization: val('authorization'),
    };
}

function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

/* ═══════════════════════════════════════════════════
   FS Review Summary Builder
   ═══════════════════════════════════════════════════ */

function buildReviewSummary() {
    const data = collectFormData();
    const panel = document.getElementById('reviewPanel');
    if (!panel) return;

    let html = '';

    html += section('User Story', [
        row('I as a', data.userStory.role),
        row('want to', data.userStory.want),
        row('to be able to', data.userStory.ability),
    ]);

    const processRows = [
        chipRow('Function', data.process.function.selected, data.process.function.other),
        chipRow('Process-Area', data.process.processArea.selected, data.process.processArea.other),
        chipRow('Sub-Area', data.process.processSubArea.selected),
    ];
    if (data.process.describeBelow) processRows.push(row('Additional Details', data.process.describeBelow));
    html += section('Process', processRows);

    const userRows = [chipRow('Users', data.user.selected, data.user.other)];
    if (data.user.describeBelow) userRows.push(row('Additional Details', data.user.describeBelow));
    html += section('User Group', userRows);

    const pFiles = problemFiles;
    const problemRows = [row('Description', data.problemDescription)];
    if (pFiles.length) problemRows.push(thumbnailRow('Screenshots', pFiles));
    html += section('Problem', problemRows);

    const sFiles = solutionFiles;
    const solutionRows = [row('Description', data.solutionDescription)];
    if (sFiles.length) solutionRows.push(thumbnailRow('Screenshots', sFiles));
    html += section('Solution', solutionRows);

    html += section('Solution Design', [
        chipRow('ERP', data.developmentSystem.erp.selected, data.developmentSystem.erp.other),
        chipRow('SCM / S4', data.developmentSystem.scm.selected, data.developmentSystem.scm.other),
        chipRow('Cloud', data.developmentSystem.cloud.selected, data.developmentSystem.cloud.other),
        row('Technical Details', data.technicalDetails),
        row('Names & Language', data.namesAndLanguage),
        row('Authorization', data.authorization),
    ]);

    panel.innerHTML = html;
}

// ── Review helpers ──

function section(title, rows) {
    return `<div class="review-section"><div class="review-section-title">${title}</div>${rows.join('')}</div>`;
}

function row(label, value) {
    const display = value || '<span class="review-empty">Not provided</span>';
    return `<div class="review-row"><span class="review-label">${label}</span><span class="review-value">${escapeHtml(display)}</span></div>`;
}

function chipRow(label, items, otherText) {
    let chips = '';
    if (items && items.length) {
        chips = `<div class="review-chips">${items.map(i => `<span class="review-chip">${escapeHtml(i)}</span>`).join('')}</div>`;
    }
    if (otherText) {
        chips += `<div class="review-chips" style="margin-top:4px"><span class="review-chip">${escapeHtml(otherText)}</span></div>`;
    }
    if (!chips) chips = '<span class="review-empty">None selected</span>';
    return `<div class="review-row"><span class="review-label">${label}</span><span class="review-value">${chips}</span></div>`;
}

function thumbnailRow(label, images) {
    const thumbs = images.map(img => `<img class="review-thumb" src="${img.data}" alt="${escapeHtml(img.name)}">`).join('');
    return `<div class="review-row"><span class="review-label">${label}</span><span class="review-value"><div class="review-thumbnails">${thumbs}</div><span style="font-size:12px;color:var(--text-secondary)">${images.length} image(s) attached</span></span></div>`;
}

function escapeHtml(text) {
    if (!text) return '';
    if (text.includes('<')) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/* ═══════════════════════════════════════════════════
   FS Export .docx via API
   ═══════════════════════════════════════════════════ */

async function exportDocx() {
    const data = collectFormData();
    const spinner = document.getElementById('loadingSpinner');

    try {
        if (spinner) spinner.style.display = 'flex';

        const formData = new FormData();
        formData.append('form_data', JSON.stringify(data));

        const pImgs = problemFiles;
        for (const img of pImgs) {
            const blob = await dataURLtoBlob(img.data);
            formData.append('problem_screenshots', blob, img.name);
        }
        const sImgs = solutionFiles;
        for (const img of sImgs) {
            const blob = await dataURLtoBlob(img.data);
            formData.append('solution_screenshots', blob, img.name);
        }

        const response = await fetch('/api/export-functional-spec', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || err.message || 'Export failed');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const role = data.userStory.role || 'Functional_Spec';
        const safeName = role.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
        a.download = `${safeName}_Functional_Specification.docx`;

        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        showToast('Document exported successfully!', 'success');
    } catch (err) {
        console.error('Export error:', err);
        showToast(err.message || 'Failed to export document', 'error');
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}

async function dataURLtoBlob(dataURL) {
    const res = await fetch(dataURL);
    return res.blob();
}


/* ═══════════════════════════════════════════════════
   BUSINESS REQUIREMENT — Navigation
   ═══════════════════════════════════════════════════ */

function initBrNavigation() {
    const nextBtn = document.getElementById('brNextBtn');
    const prevBtn = document.getElementById('brPrevBtn');
    const resetBtn = document.getElementById('brResetBtn');
    const exportBtn = document.getElementById('brExportBtn');
    const editFromReviewBtn = document.getElementById('brEditFromReviewBtn');
    const downloadJsonBtn = document.getElementById('brDownloadJsonBtn');

    if (nextBtn) nextBtn.addEventListener('click', brNextStep);
    if (prevBtn) prevBtn.addEventListener('click', brPrevStep);
    if (resetBtn) resetBtn.addEventListener('click', () => {
        showConfirmation(
            'Reset Form?',
            'All your inputs will be cleared. This cannot be undone.',
            () => { brResetForm(); brGoToStep(1); },
            { icon: '⚠️', confirmText: 'Reset', cancelText: 'Cancel' }
        );
    });
    if (exportBtn) exportBtn.addEventListener('click', exportBrDocx);
    if (editFromReviewBtn) editFromReviewBtn.addEventListener('click', () => brGoToStep(1));
    if (downloadJsonBtn) downloadJsonBtn.addEventListener('click', downloadBrJson);

    // Allow clicking step indicators to jump
    document.querySelectorAll('#br-step-indicator .step').forEach(el => {
        el.addEventListener('click', () => {
            const target = parseInt(el.dataset.brStep, 10);
            if (target <= brMaxAccessibleStep) brGoToStep(target);
        });
    });
}

function brNextStep() {
    if (brCurrentStep < brTotalSteps) {
        if (!validateBrStep(brCurrentStep)) return;
        brGoToStep(brCurrentStep + 1);
    }
}

function brPrevStep() {
    if (brCurrentStep > 1) brGoToStep(brCurrentStep - 1);
}

function brGoToStep(n) {
    if (n < 1 || n > brTotalSteps) return;

    document.querySelectorAll('#business-req-mode .field-error').forEach(el => el.classList.remove('field-error'));

    document.querySelectorAll('.br-form-step').forEach(s => s.classList.remove('active'));
    document.getElementById(`br-step-${n}`).classList.add('active');

    brCurrentStep = n;
    if (n > brMaxAccessibleStep) brMaxAccessibleStep = n;

    if (n === brTotalSteps) buildBrReviewSummary();

    updateBrNav();
    document.querySelector('#br-form-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateBrNav() {
    const prevBtn = document.getElementById('brPrevBtn');
    const nextBtn = document.getElementById('brNextBtn');

    if (prevBtn) prevBtn.style.display = brCurrentStep > 1 ? '' : 'none';
    if (nextBtn) {
        nextBtn.style.display = brCurrentStep < brTotalSteps ? '' : 'none';
        nextBtn.textContent = brCurrentStep === brTotalSteps - 1 ? 'Review' : 'Next';
    }

    document.querySelectorAll('#br-step-indicator .step').forEach(el => {
        const s = parseInt(el.dataset.brStep, 10);
        el.classList.remove('step-active', 'step-completed');
        if (s === brCurrentStep) el.classList.add('step-active');
        else if (s < brCurrentStep) el.classList.add('step-completed');
    });
}

function brResetForm() {
    document.querySelectorAll('#business-req-mode input[type="text"], #business-req-mode input[type="email"], #business-req-mode input[type="date"], #business-req-mode input[type="number"], #business-req-mode textarea').forEach(el => { el.value = ''; });
    document.querySelectorAll('#business-req-mode input[type="radio"]').forEach(el => { el.checked = false; });
    document.querySelectorAll('#business-req-mode input[type="checkbox"]').forEach(el => { el.checked = false; });
    // Hide accepted sub-options
    const subOpts = document.getElementById('brAcceptedSubOptions');
    if (subOpts) subOpts.style.display = 'none';
    // Reset cost table calculated cells
    document.querySelectorAll('.cost-calc, .cost-total').forEach(el => { el.textContent = '–'; });
    brMaxAccessibleStep = 1;
    showToast('Business Requirement form has been reset', 'info');
}

/* ═══════════════════════════════════════════════════
   BR Decision Toggle — show/hide sub-options
   ═══════════════════════════════════════════════════ */

function initBrDecisionToggle() {
    document.querySelectorAll('input[name="brDecision"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            toggleAcceptedSubOptions(e.target.value);
        });
    });
}

function toggleAcceptedSubOptions(decisionValue) {
    const subOpts = document.getElementById('brAcceptedSubOptions');
    if (!subOpts) return;
    if (decisionValue === 'accepted') {
        subOpts.style.display = 'block';
    } else {
        subOpts.style.display = 'none';
        // Uncheck sub-options when not accepted
        const addon = document.getElementById('brSubAddon');
        const local = document.getElementById('brSubLocalOnly');
        if (addon) addon.checked = false;
        if (local) local.checked = false;
    }
}

/* ═══════════════════════════════════════════════════
   BR Step Validation
   ═══════════════════════════════════════════════════ */

function validateBrStep(step) {
    document.querySelectorAll('#business-req-mode .field-error').forEach(el => el.classList.remove('field-error'));

    const missing = [];

    const requireText = (id, label) => {
        if (!val(id)) {
            const el = document.getElementById(id);
            if (el) el.classList.add('field-error');
            missing.push(label);
        }
    };

    switch (step) {
        case 1:
            requireText('brTitle', 'Requirement Title');
            requireText('brRequestor', 'Requestor');
            requireText('brRequestorCompany', 'Requestor Company');
            break;
        case 2:
            // Responsibles are optional
            break;
        case 3:
            requireText('brInitialSituation', 'Initial Situation');
            requireText('brRequiredSituation', 'Required Situation');
            break;
        case 4:
            requireText('brBenefits', 'Benefits');
            break;
    }

    if (missing.length) {
        showToast(`Please fill in: ${missing.join(', ')}`, 'warning');
        const firstError = document.querySelector('#business-req-mode .field-error');
        if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
    }
    return true;
}

/* ═══════════════════════════════════════════════════
   BR Collect Form Data
   ═══════════════════════════════════════════════════ */

function collectBrFormData() {
    return {
        title: val('brTitle'),
        project: val('brProject'),
        productOwner: val('brProductOwner'),
        itProduct: val('brItProduct'),
        targetDate: val('brTargetDate'),
        requestor: val('brRequestor'),
        requestorCompany: val('brRequestorCompany'),
        createDate: val('brCreateDate'),
        createdBy: val('brCreatedBy'),
        responsibles: {
            localBusiness: {
                email: val('brLocalEmail'),
                company: val('brLocalCompany'),
                department: val('brLocalDept'),
            },
            globalBusiness: {
                email: val('brGlobalEmail'),
                company: val('brGlobalCompany'),
                department: val('brGlobalDept'),
            },
            globalShapeGds: {
                email: val('brGdsEmail'),
                company: val('brGdsCompany'),
                department: val('brGdsDept'),
            },
            regionalShapeGds: {
                email: val('brRegionalEmail'),
                company: val('brRegionalCompany'),
                department: val('brRegionalDept'),
            },
        },
        description: {
            initialSituation: val('brInitialSituation'),
            requiredSituation: val('brRequiredSituation'),
            departments: val('brDepartments'),
            itComponents: val('brItComponents'),
            dataAffected: val('brDataAffected'),
            proposalSolution: val('brProposalSolution'),
        },
        benefits: {
            benefitsReached: val('brBenefits'),
            savingsPA: val('brSavings'),
            withoutImplementation: val('brWithoutImpl'),
        },
        signOff: {
            gbpo: {
                name: val('brSignoffGbpoName'),
                department: val('brSignoffGbpoDept'),
                date: val('brSignoffGbpoDate'),
            },
            gds: {
                name: val('brSignoffGdsName'),
                department: val('brSignoffGdsDept'),
                date: val('brSignoffGdsDate'),
            },
        },
        decision: {
            evaluation: val('brEvaluation'),
            decisionDate: val('brDecisionDate'),
            decisionType: (() => {
                const checked = document.querySelector('input[name="brDecision"]:checked');
                return checked ? checked.value : '';
            })(),
            acceptedSubOptions: (() => {
                const subs = [];
                const addon = document.getElementById('brSubAddon');
                const local = document.getElementById('brSubLocalOnly');
                if (addon && addon.checked) subs.push('add-on');
                if (local && local.checked) subs.push('local-only');
                return subs;
            })(),
            restrictions: val('brRestrictions'),
            reason: val('brDecisionReason'),
            implTargetDate: val('brImplTargetDate'),
        },
        costs: collectCostTableData(),
    };
}

/* ═══════════════════════════════════════════════════
   BR Review Summary Builder
   ═══════════════════════════════════════════════════ */

function buildBrReviewSummary() {
    const data = collectBrFormData();
    const panel = document.getElementById('brReviewPanel');
    if (!panel) return;

    let html = '';

    // General Info
    html += section('General Information', [
        row('Requirement Title', data.title),
        row('Project', data.project),
        row('Product Owner', data.productOwner),
        row('IT Product', data.itProduct),
        row('Target Date', data.targetDate),
        row('Requestor', data.requestor),
        row('Requestor Company', data.requestorCompany),
        row('Create Date', data.createDate),
        row('Created By', data.createdBy),
    ]);

    // Responsibles
    const respRows = [];
    const respLabels = {
        localBusiness: 'Local Business',
        globalBusiness: 'Global Business',
        globalShapeGds: 'Global Shape GDS',
        regionalShapeGds: 'Regional Shape GDS',
    };
    for (const [key, label] of Object.entries(respLabels)) {
        const r = data.responsibles[key];
        const parts = [r.email, r.company, r.department].filter(Boolean);
        respRows.push(row(label, parts.join(' · ') || ''));
    }
    html += section('Requirement Responsibles', respRows);

    // Description
    html += section('Business Requirement Description', [
        row('Initial Situation', data.description.initialSituation),
        row('Required Situation', data.description.requiredSituation),
        row('Departments Involved', data.description.departments),
        row('IT Components', data.description.itComponents),
        row('Data Used/Affected', data.description.dataAffected),
        row('Proposal for Solution', data.description.proposalSolution),
    ]);

    // Benefits
    html += section('Benefits for the Business', [
        row('Benefits', data.benefits.benefitsReached),
        row('Savings p.a.', data.benefits.savingsPA),
        row('Without Implementation', data.benefits.withoutImplementation),
    ]);

    // Sign Off
    const so = data.signOff;
    html += section('Sign Off / Agreement', [
        row('Global Business Process Owner', [so.gbpo.name, so.gbpo.department, so.gbpo.date].filter(Boolean).join(' · ') || ''),
        row('GDS Product Owner / Manager', [so.gds.name, so.gds.department, so.gds.date].filter(Boolean).join(' · ') || ''),
    ]);

    // Decision
    const dec = data.decision;
    const decisionLabels = {
        'rejected': 'Rejected',
        'accepted': 'Accepted',
        'accepted-with-restrictions': 'Accepted with restrictions',
    };
    const subLabels = { 'add-on': 'Add-on to BSH standard product', 'local-only': 'Only local solution' };
    let decisionDisplay = decisionLabels[dec.decisionType] || '';
    if (dec.decisionType === 'accepted' && dec.acceptedSubOptions && dec.acceptedSubOptions.length) {
        decisionDisplay += ' (' + dec.acceptedSubOptions.map(s => subLabels[s] || s).join(', ') + ')';
    }
    html += section('Cost Estimation & Decision', [
        row('Evaluation by', dec.evaluation),
        row('Decision Date', dec.decisionDate),
        row('Decision', decisionDisplay),
        row('Restrictions', dec.restrictions),
        row('Reason', dec.reason),
        row('Implementation Target Date', dec.implTargetDate),
    ]);

    // Costs
    const costRows = data.costs.rows || [];
    const filledCostRows = costRows.filter(r => r.itProduct || r.catsnr || r.initialCosts || r.runningCosts || r.savings);
    if (filledCostRows.length) {
        const costHtmlRows = filledCostRows.map((r, i) => {
            const payback = (parseFloat(r.savings) || 0) - (parseFloat(r.runningCosts) || 0);
            const period = payback > 0 ? ((parseFloat(r.initialCosts) || 0) / payback).toFixed(1) : '–';
            return row(`Row ${i + 1}`, `${r.itProduct || '–'} | ${r.catsnr || '–'} | €${r.initialCosts || 0} | €${r.runningCosts || 0}/yr | €${r.savings || 0}/yr | €${payback.toFixed(0)}/yr | ${period}y`);
        });
        html += section('Costs / Savings / Charging', costHtmlRows);
    } else {
        html += section('Costs / Savings / Charging', [row('Data', '')]);
    }

    panel.innerHTML = html;
}

/* ═══════════════════════════════════════════════════
   BR Export .docx via API
   ═══════════════════════════════════════════════════ */

async function exportBrDocx() {
    const data = collectBrFormData();
    const spinner = document.getElementById('loadingSpinner');

    try {
        if (spinner) spinner.style.display = 'flex';

        const response = await fetch('/api/export-business-requirement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || err.message || 'Export failed');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const title = data.title || 'Business_Requirement';
        const safeName = title.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
        a.download = `${safeName}_Business_Requirement.docx`;

        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        showToast('Business Requirement exported successfully!', 'success');
    } catch (err) {
        console.error('BR Export error:', err);
        showToast(err.message || 'Failed to export document', 'error');
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}

/* ═══════════════════════════════════════════════════
   BR Cost Table — auto-calculate & collect
   ═══════════════════════════════════════════════════ */

function initBrCostTable() {
    const table = document.getElementById('brCostTable');
    if (!table) return;
    table.querySelectorAll('.cost-number').forEach(input => {
        input.addEventListener('input', recalcCostTable);
    });
}

function recalcCostTable() {
    const table = document.getElementById('brCostTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = tbody.querySelectorAll('tr');

    let totals = { initialCosts: 0, runningCosts: 0, savings: 0, payback: 0 };
    let periodSum = 0;
    let periodCount = 0;

    rows.forEach(tr => {
        const initial = parseFloat(tr.querySelector('[data-field="initialCosts"]')?.value) || 0;
        const running = parseFloat(tr.querySelector('[data-field="runningCosts"]')?.value) || 0;
        const savings = parseFloat(tr.querySelector('[data-field="savings"]')?.value) || 0;
        const payback = savings - running;
        const period = payback > 0 ? initial / payback : 0;

        const paybackCell = tr.querySelector('[data-calc="payback"]');
        const periodCell = tr.querySelector('[data-calc="period"]');
        if (paybackCell) paybackCell.textContent = (initial || running || savings) ? payback.toFixed(0) : '–';
        if (periodCell) periodCell.textContent = payback > 0 ? period.toFixed(1) : '–';

        totals.initialCosts += initial;
        totals.runningCosts += running;
        totals.savings += savings;
        totals.payback += payback;
        if (payback > 0) { periodSum += period; periodCount++; }
    });

    const hasData = totals.initialCosts || totals.runningCosts || totals.savings;
    const setTotal = (key, val) => {
        const el = table.querySelector(`[data-total="${key}"]`);
        if (el) el.textContent = hasData ? val : '–';
    };
    setTotal('initialCosts', totals.initialCosts.toFixed(0));
    setTotal('runningCosts', totals.runningCosts.toFixed(0));
    setTotal('savings', totals.savings.toFixed(0));
    setTotal('payback', totals.payback.toFixed(0));
    setTotal('period', periodCount ? (periodSum / periodCount).toFixed(1) : '–');
}

function collectCostTableData() {
    const table = document.getElementById('brCostTable');
    if (!table) return { rows: [] };
    const tbody = table.querySelector('tbody');
    const rowsData = [];
    tbody.querySelectorAll('tr').forEach(tr => {
        rowsData.push({
            itProduct: tr.querySelector('[data-field="itProduct"]')?.value?.trim() || '',
            catsnr: tr.querySelector('[data-field="catsnr"]')?.value?.trim() || '',
            initialCosts: tr.querySelector('[data-field="initialCosts"]')?.value?.trim() || '',
            runningCosts: tr.querySelector('[data-field="runningCosts"]')?.value?.trim() || '',
            savings: tr.querySelector('[data-field="savings"]')?.value?.trim() || '',
        });
    });
    return { rows: rowsData };
}

/* ═══════════════════════════════════════════════════
   BR JSON Save / Load
   ═══════════════════════════════════════════════════ */

function downloadBrJson() {
    const data = collectBrFormData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const title = data.title || 'Business_Requirement';
    const safeName = title.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    a.download = `${safeName}_BR_Data.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('JSON data downloaded', 'success');
}

function initBrJsonLoad() {
    const btn = document.getElementById('brLoadJsonBtn');
    const fileInput = document.getElementById('brJsonFileInput');
    if (!btn || !fileInput) return;

    btn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = JSON.parse(evt.target.result);
                loadBrFromJson(data);
                showToast('Business Requirement loaded from JSON', 'success');
            } catch (err) {
                showToast('Invalid JSON file', 'error');
            }
        };
        reader.readAsText(file);
        fileInput.value = ''; // reset so same file can be loaded again
    });
}

function loadBrFromJson(data) {
    // Step 1: General Info
    setVal('brTitle', data.title);
    setVal('brProject', data.project);
    setVal('brProductOwner', data.productOwner);
    setVal('brItProduct', data.itProduct);
    setVal('brTargetDate', data.targetDate);
    setVal('brRequestor', data.requestor);
    setVal('brRequestorCompany', data.requestorCompany);
    setVal('brCreateDate', data.createDate);
    setVal('brCreatedBy', data.createdBy);

    // Step 2: Responsibles
    const resp = data.responsibles || {};
    const rMap = {
        localBusiness: ['brLocalEmail', 'brLocalCompany', 'brLocalDept'],
        globalBusiness: ['brGlobalEmail', 'brGlobalCompany', 'brGlobalDept'],
        globalShapeGds: ['brGdsEmail', 'brGdsCompany', 'brGdsDept'],
        regionalShapeGds: ['brRegionalEmail', 'brRegionalCompany', 'brRegionalDept'],
    };
    for (const [key, ids] of Object.entries(rMap)) {
        const entry = resp[key] || {};
        setVal(ids[0], entry.email);
        setVal(ids[1], entry.company);
        setVal(ids[2], entry.department);
    }

    // Step 3: Description
    const desc = data.description || {};
    setVal('brInitialSituation', desc.initialSituation);
    setVal('brRequiredSituation', desc.requiredSituation);
    setVal('brDepartments', desc.departments);
    setVal('brItComponents', desc.itComponents);
    setVal('brDataAffected', desc.dataAffected);
    setVal('brProposalSolution', desc.proposalSolution);

    // Step 4: Benefits
    const ben = data.benefits || {};
    setVal('brBenefits', ben.benefitsReached);
    setVal('brSavings', ben.savingsPA);
    setVal('brWithoutImpl', ben.withoutImplementation);

    // Step 5: Sign Off
    const so = data.signOff || {};
    const gbpo = so.gbpo || {};
    const gds = so.gds || {};
    setVal('brSignoffGbpoName', gbpo.name);
    setVal('brSignoffGbpoDept', gbpo.department);
    setVal('brSignoffGbpoDate', gbpo.date);
    setVal('brSignoffGdsName', gds.name);
    setVal('brSignoffGdsDept', gds.department);
    setVal('brSignoffGdsDate', gds.date);

    // Step 6: Decision
    const dec = data.decision || {};
    setVal('brEvaluation', dec.evaluation);
    setVal('brDecisionDate', dec.decisionDate);
    if (dec.decisionType) {
        const radio = document.querySelector(`input[name="brDecision"][value="${dec.decisionType}"]`);
        if (radio) {
            radio.checked = true;
            // Trigger sub-options visibility
            toggleAcceptedSubOptions(dec.decisionType);
        }
    }
    // Load sub-options
    if (dec.acceptedSubOptions && Array.isArray(dec.acceptedSubOptions)) {
        const addon = document.getElementById('brSubAddon');
        const local = document.getElementById('brSubLocalOnly');
        if (addon) addon.checked = dec.acceptedSubOptions.includes('add-on');
        if (local) local.checked = dec.acceptedSubOptions.includes('local-only');
    }
    setVal('brRestrictions', dec.restrictions);
    setVal('brDecisionReason', dec.reason);
    setVal('brImplTargetDate', dec.implTargetDate);

    // Step 7: Cost Table
    const costs = data.costs || {};
    const costRows = costs.rows || [];
    const table = document.getElementById('brCostTable');
    if (table) {
        const tbodyRows = table.querySelector('tbody').querySelectorAll('tr');
        costRows.forEach((cr, i) => {
            if (i < tbodyRows.length) {
                const tr = tbodyRows[i];
                const setInput = (field, val) => {
                    const inp = tr.querySelector(`[data-field="${field}"]`);
                    if (inp) inp.value = val || '';
                };
                setInput('itProduct', cr.itProduct);
                setInput('catsnr', cr.catsnr);
                setInput('initialCosts', cr.initialCosts);
                setInput('runningCosts', cr.runningCosts);
                setInput('savings', cr.savings);
            }
        });
        recalcCostTable();
    }

    // Allow jumping to any step
    brMaxAccessibleStep = brTotalSteps;
}

function setVal(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.value = value;
}
