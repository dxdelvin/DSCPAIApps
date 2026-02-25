/**
 * Functional Specification – Spec Builder
 * Handles multi-step form navigation, checkbox "Other" toggling,
 * screenshot uploads, review summary rendering, and .docx export via API.
 */

let currentStep = 1;
const totalSteps = 7;
let maxAccessibleStep = 1;

// Screenshot upload state
let problemFiles = [];
let solutionFiles = [];

window.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initCheckboxToggles();
    initModalHandlers();
    initUploadZone('problem');
    initUploadZone('solution');
    updateNav();
});

/* ═══════════════════════════════════════════════════
   Navigation
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
    document.querySelectorAll('.step-indicator .step').forEach(el => {
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
    document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));

    // Hide current
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    document.getElementById(`step-${n}`).classList.add('active');

    currentStep = n;
    if (n > maxAccessibleStep) maxAccessibleStep = n;

    // If landing on review step, build summary
    if (n === totalSteps) buildReviewSummary();

    updateNav();
    // Scroll form into view
    document.querySelector('.form-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    document.querySelectorAll('.step-indicator .step').forEach(el => {
        const s = parseInt(el.dataset.step, 10);
        el.classList.remove('step-active', 'step-completed');
        if (s === currentStep) el.classList.add('step-active');
        else if (s < currentStep) el.classList.add('step-completed');
    });
}

function resetForm() {
    // Clear all inputs
    document.querySelectorAll('.spec-builder input[type="text"], .spec-builder textarea').forEach(el => { el.value = ''; });
    document.querySelectorAll('.spec-builder input[type="checkbox"]').forEach(el => { el.checked = false; });
    // Re-hide all "other" inputs
    document.querySelectorAll('.other-input').forEach(el => el.classList.add('hidden'));
    // Clear uploaded screenshots
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
   Step Validation
   ═══════════════════════════════════════════════════ */

function validateStep(step) {
    // Clear previous errors
    document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));

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
            // Highlight the parent checkbox-column(s)
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
                document.querySelectorAll('.checkbox-column').forEach(col => {
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
        const firstError = document.querySelector('.field-error');
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

    // Click to open picker
    dropArea.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', () => {
        addFiles(prefix, Array.from(fileInput.files));
        fileInput.value = '';
    });

    // Drag events
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

        // Remove
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
   Collect Form Data
   ═══════════════════════════════════════════════════ */

function collectFormData() {
    // Helper: get checked values for a checkbox group
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
   Review Summary Builder
   ═══════════════════════════════════════════════════ */

function buildReviewSummary() {
    const data = collectFormData();
    const panel = document.getElementById('reviewPanel');
    if (!panel) return;

    let html = '';

    // 1. User Story
    html += section('User Story', [
        row('I as a', data.userStory.role),
        row('want to', data.userStory.want),
        row('to be able to', data.userStory.ability),
    ]);

    // 2. Process
    const processRows = [
        chipRow('Function', data.process.function.selected, data.process.function.other),
        chipRow('Process-Area', data.process.processArea.selected, data.process.processArea.other),
        chipRow('Sub-Area', data.process.processSubArea.selected),
    ];
    if (data.process.describeBelow) processRows.push(row('Additional Details', data.process.describeBelow));
    html += section('Process', processRows);

    // 3. User
    const userRows = [chipRow('Users', data.user.selected, data.user.other)];
    if (data.user.describeBelow) userRows.push(row('Additional Details', data.user.describeBelow));
    html += section('User Group', userRows);

    // 4. Problem
    const pFiles = problemFiles;
    const problemRows = [row('Description', data.problemDescription)];
    if (pFiles.length) problemRows.push(thumbnailRow('Screenshots', pFiles));
    html += section('Problem', problemRows);

    // 5. Solution
    const sFiles = solutionFiles;
    const solutionRows = [row('Description', data.solutionDescription)];
    if (sFiles.length) solutionRows.push(thumbnailRow('Screenshots', sFiles));
    html += section('Solution', solutionRows);

    // 6. Solution Design
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
    // If it contains HTML tags (like our "Not provided" span) return as-is
    if (text.includes('<')) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/* ═══════════════════════════════════════════════════
   Export .docx via API
   ═══════════════════════════════════════════════════ */

async function exportDocx() {
    const data = collectFormData();
    const spinner = document.getElementById('loadingSpinner');

    try {
        if (spinner) spinner.style.display = 'flex';

        // Build FormData with JSON payload + image files
        const formData = new FormData();
        formData.append('form_data', JSON.stringify(data));

        // Append screenshot blobs
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

        // Stream the blob
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Build filename from user story or fallback
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

/** Convert a base64 data URL to a Blob */
async function dataURLtoBlob(dataURL) {
    const res = await fetch(dataURL);
    return res.blob();
}
