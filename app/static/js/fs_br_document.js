/**
 * FS & BR Document Builder
 * Handles mode switching between Functional Specification and Business Requirement,
 * multi-step form navigation for both, dynamic tables, JSON save/load,
 * review summary rendering, and .docx export via API.
 */

// ═══════════════════════════════════════════════════
// Shared state
// ═══════════════════════════════════════════════════
let currentMode = 'functional-spec';  // 'functional-spec' | 'business-req' | 'fs-variant'

// ── Functional Spec state ──
let fsCurrentStep = 1;
const fsTotalSteps = 10;
let fsMaxAccessibleStep = 1;

// ── Business Requirement state ──
let brCurrentStep = 1;
const brTotalSteps = 8;
let brMaxAccessibleStep = 1;

// ── FS Variant state ──
let fvCurrentStep = 1;
const fvTotalSteps = 9;
let fvMaxAccessibleStep = 1;

window.addEventListener('DOMContentLoaded', () => {
    initModeSwitch();
    initMobileStepJumpers();
    // Functional Spec
    initFsNavigation();
    initFsDynamicTables();
    initFsJsonLoad();
    initFsInfoPanels();
    initFsDefaultTextInputs();
    updateFsNav();
    // Business Requirement
    initBrNavigation();
    initBrCostTable();
    initBrJsonLoad();
    initBrDecisionToggle();
    updateBrNav();
    // FS Variant
    initFvNavigation();
    initFvDynamicTables();
    initFvJsonLoad();
    updateFvNav();
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

    closeAllStepJumpMenus();
}

function initMobileStepJumpers() {
    const configs = [
        { indicatorId: 'fs-step-indicator', mode: 'fs', totalSteps: fsTotalSteps },
        { indicatorId: 'br-step-indicator', mode: 'br', totalSteps: brTotalSteps },
        { indicatorId: 'fv-step-indicator', mode: 'fv', totalSteps: fvTotalSteps },
    ];

    configs.forEach(cfg => {
        const indicator = document.getElementById(cfg.indicatorId);
        if (!indicator || indicator.querySelector('.mobile-step-jump')) return;

        const jumpWrap = document.createElement('div');
        jumpWrap.className = 'mobile-step-jump';

        const jumpBtn = document.createElement('button');
        jumpBtn.type = 'button';
        jumpBtn.className = 'mobile-step-jump-btn';
        jumpBtn.setAttribute('aria-label', 'Jump to step');
        jumpBtn.setAttribute('aria-expanded', 'false');
        jumpBtn.innerHTML = '<span aria-hidden="true">&#9776;</span>';

        const jumpMenu = document.createElement('div');
        jumpMenu.className = 'mobile-step-jump-menu';

        const jumpMenuTitle = document.createElement('div');
        jumpMenuTitle.className = 'mobile-step-jump-menu-title';
        jumpMenuTitle.textContent = 'Jump to step';

        const jumpList = document.createElement('div');
        jumpList.className = 'mobile-step-jump-list';

        for (let i = 1; i <= cfg.totalSteps; i++) {
            const sourceStep = indicator.querySelector(`.step[data-${cfg.mode}-step="${i}"]`);
            const stepLabel = sourceStep?.querySelector('.step-label')?.textContent?.trim() || `Step ${i}`;

            const itemBtn = document.createElement('button');
            itemBtn.type = 'button';
            itemBtn.className = 'mobile-step-jump-item';
            itemBtn.dataset.step = String(i);
            itemBtn.innerHTML = `<span class="jump-item-number">${i}</span><span class="jump-item-label">${stepLabel}</span>`;

            itemBtn.addEventListener('click', () => {
                if (cfg.mode === 'fs') {
                    if (i <= fsMaxAccessibleStep) fsGoToStep(i);
                    else showToast('Complete previous steps before jumping ahead.', 'warning');
                } else if (cfg.mode === 'br') {
                    if (i <= brMaxAccessibleStep) brGoToStep(i);
                    else showToast('Complete previous steps before jumping ahead.', 'warning');
                } else if (cfg.mode === 'fv') {
                    if (i <= fvMaxAccessibleStep) fvGoToStep(i);
                    else showToast('Complete previous steps before jumping ahead.', 'warning');
                }
                closeAllStepJumpMenus();
            });

            jumpList.appendChild(itemBtn);
        }

        jumpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = jumpWrap.classList.contains('open');
            closeAllStepJumpMenus();
            if (!isOpen) {
                jumpWrap.classList.add('open');
                jumpBtn.setAttribute('aria-expanded', 'true');
            }
        });

        jumpMenu.appendChild(jumpMenuTitle);
        jumpMenu.appendChild(jumpList);
        jumpWrap.appendChild(jumpBtn);
        jumpWrap.appendChild(jumpMenu);
        indicator.appendChild(jumpWrap);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.mobile-step-jump')) closeAllStepJumpMenus();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllStepJumpMenus();
    });
}

function closeAllStepJumpMenus() {
    document.querySelectorAll('.mobile-step-jump.open').forEach(el => {
        el.classList.remove('open');
        const btn = el.querySelector('.mobile-step-jump-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    });
}

/* ═══════════════════════════════════════════════════
   FUNCTIONAL SPEC — Navigation
   ═══════════════════════════════════════════════════ */

function initFsNavigation() {
    const nextBtn = document.getElementById('fsNextBtn');
    const prevBtn = document.getElementById('fsPrevBtn');
    const resetBtn = document.getElementById('fsResetBtn');
    const exportBtn = document.getElementById('fsExportBtn');
    const editBtn = document.getElementById('fsEditFromReviewBtn');
    const downloadJsonBtn = document.getElementById('fsDownloadJsonBtn');

    if (nextBtn) nextBtn.addEventListener('click', fsNextStep);
    if (prevBtn) prevBtn.addEventListener('click', fsPrevStep);
    if (resetBtn) resetBtn.addEventListener('click', () => {
        showConfirmation(
            'Reset Form?',
            'All your inputs will be cleared. This cannot be undone.',
            () => { fsResetForm(); fsGoToStep(1); },
            { icon: '⚠️', confirmText: 'Reset', cancelText: 'Cancel' }
        );
    });
    if (exportBtn) exportBtn.addEventListener('click', exportFsDocx);
    if (editBtn) editBtn.addEventListener('click', () => fsGoToStep(1));
    if (downloadJsonBtn) downloadJsonBtn.addEventListener('click', downloadFsJson);

    // Allow clicking step indicators to jump (only to visited steps)
    document.querySelectorAll('#fs-step-indicator .step').forEach(el => {
        el.addEventListener('click', () => {
            const target = parseInt(el.dataset.fsStep, 10);
            if (target <= fsMaxAccessibleStep) {
                fsGoToStep(target);
            } else {
                showToast('Complete previous steps before jumping ahead.', 'warning');
            }
        });
    });
}

function fsNextStep() {
    if (fsCurrentStep < fsTotalSteps) {
        if (!validateFsStep(fsCurrentStep)) return;
        fsGoToStep(fsCurrentStep + 1);
    }
}

function fsPrevStep() {
    if (fsCurrentStep > 1) fsGoToStep(fsCurrentStep - 1);
}

function fsGoToStep(n) {
    if (n < 1 || n > fsTotalSteps) return;

    document.querySelectorAll('#functional-spec-mode .field-error').forEach(el => el.classList.remove('field-error'));
    document.querySelectorAll('#functional-spec-mode .form-step').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`fs-step-${n}`);
    if (target) target.classList.add('active');

    fsCurrentStep = n;
    if (n > fsMaxAccessibleStep) fsMaxAccessibleStep = n;

    if (n === fsTotalSteps) buildFsReviewSummary();

    updateFsNav();
    const container = document.querySelector('#fs-form-container');
    if (container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateFsNav() {
    const prevBtn = document.getElementById('fsPrevBtn');
    const nextBtn = document.getElementById('fsNextBtn');

    if (prevBtn) prevBtn.style.display = fsCurrentStep > 1 ? '' : 'none';
    if (nextBtn) {
        nextBtn.style.display = fsCurrentStep < fsTotalSteps ? '' : 'none';
        nextBtn.textContent = fsCurrentStep === fsTotalSteps - 1 ? 'Review' : 'Next';
    }

    document.querySelectorAll('#fs-step-indicator .step').forEach(el => {
        const s = parseInt(el.dataset.fsStep, 10);
        el.classList.remove('step-active', 'step-completed');
        if (s === fsCurrentStep) el.classList.add('step-active');
        else if (s < fsCurrentStep) el.classList.add('step-completed');
    });

    updateMobileStepProgress('fs-step-indicator', fsCurrentStep, fsTotalSteps);
}

function fsResetForm() {
    document.querySelectorAll('#functional-spec-mode input[type="text"], #functional-spec-mode input[type="date"], #functional-spec-mode textarea').forEach(el => { el.value = ''; });
    // Restore default values
    const langEl = document.getElementById('fsLanguageTopics');
    if (langEl) langEl.value = 'Development language is English.';
    // Reset dynamic tables to single empty row
    const dtMeta = {
        fsPrevStepsTable: { cols: 4, dateCols: [1] },
        fsGlossaryTable: { cols: 2, dateCols: [] },
        fsDocHistoryTable: { cols: 5, dateCols: [1] },
    };
    for (const [id, meta] of Object.entries(dtMeta)) {
        const table = document.getElementById(id);
        if (!table) continue;
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = _buildDynamicRow(meta.cols, meta.dateCols);
        _bindRemoveButtons(tbody);
    }
    fsMaxAccessibleStep = 1;
    showToast('Form has been reset', 'info');
}

/* ═══════════════════════════════════════════════════
   FS Dynamic Tables (Previous Steps, Glossary, Doc History)
   ═══════════════════════════════════════════════════ */

// Date column indices per table (0-based)
const FS_DT_DATE_COLS = {
    fsPrevStepsTable: [1],
    fsDocHistoryTable: [1],
};

function initFsDynamicTables() {
    // Add-row buttons
    document.querySelectorAll('#functional-spec-mode .btn-add-row').forEach(btn => {
        btn.addEventListener('click', () => {
            const tableId = btn.dataset.table;
            const cols = parseInt(btn.dataset.cols, 10);
            const table = document.getElementById(tableId);
            if (!table) return;
            const tbody = table.querySelector('tbody');
            const dateCols = FS_DT_DATE_COLS[tableId] || [];
            tbody.insertAdjacentHTML('beforeend', _buildDynamicRow(cols, dateCols));
            _bindRemoveButtons(tbody);
        });
    });

    // Bind initial remove buttons
    document.querySelectorAll('#functional-spec-mode .dynamic-table tbody').forEach(tbody => {
        _bindRemoveButtons(tbody);
    });
}

function _buildDynamicRow(cols, dateCols = []) {
    let cells = '';
    for (let i = 0; i < cols; i++) {
        const inputType = dateCols.includes(i) ? 'date' : 'text';
        cells += `<td><input type="${inputType}" class="dt-input" /></td>`;
    }
    cells += `<td><button type="button" class="btn-remove-row" title="Remove row">&times;</button></td>`;
    return `<tr>${cells}</tr>`;
}

function _bindRemoveButtons(tbody) {
    tbody.querySelectorAll('.btn-remove-row').forEach(btn => {
        btn.onclick = () => {
            const row = btn.closest('tr');
            if (tbody.rows.length > 1) {
                row.remove();
            } else {
                // Don't remove last row, just clear it
                row.querySelectorAll('input').forEach(inp => { inp.value = ''; });
            }
        };
    });
}

function _collectDynamicTable(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return [];
    const rows = [];
    table.querySelectorAll('tbody tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('input').forEach(inp => cells.push(inp.value.trim()));
        if (cells.some(c => c)) rows.push(cells);
    });
    return rows;
}

function _loadDynamicTable(tableId, data, cols) {
    const table = document.getElementById(tableId);
    if (!table || !data || !data.length) return;
    const tbody = table.querySelector('tbody');
    const dateCols = FS_DT_DATE_COLS[tableId] || [];
    tbody.innerHTML = '';
    data.forEach(rowData => {
        let cells = '';
        for (let i = 0; i < cols; i++) {
            const v = (rowData[i] || '').replace(/"/g, '&quot;');
            const inputType = dateCols.includes(i) ? 'date' : 'text';
            cells += `<td><input type="${inputType}" class="dt-input" value="${v}" /></td>`;
        }
        cells += `<td><button type="button" class="btn-remove-row" title="Remove row">&times;</button></td>`;
        tbody.insertAdjacentHTML('beforeend', `<tr>${cells}</tr>`);
    });
    _bindRemoveButtons(tbody);
}

/* ═══════════════════════════════════════════════════
   FS Step Validation
   ═══════════════════════════════════════════════════ */

function validateFsStep(step) {
    document.querySelectorAll('#functional-spec-mode .field-error').forEach(el => el.classList.remove('field-error'));

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
            requireText('fsTitle', 'Document Title');
            requireText('fsDate', 'Date');
            requireText('fsAuthor', 'Author');
            break;
        case 3:
            requireText('fsProjectGoal', 'Project Goal');
            break;
        case 4:
            requireText('fsSolutionDesc', 'Solution Description');
            break;
        case 6:
            requireText('fsFunctionality', 'Functionality');
            break;
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
   FS Collect Form Data
   ═══════════════════════════════════════════════════ */

function collectFsFormData() {
    return {
        title: val('fsTitle'),
        date: val('fsDate'),
        version: val('fsVersion'),
        author: val('fsAuthor'),
        responsibilities: {
            globalBusiness: { name: val('fsRespGlobalBizName'), date: val('fsRespGlobalBizDate') },
            globalShape: { name: val('fsRespGlobalShapeName'), date: val('fsRespGlobalShapeDate') },
            developer: { name: val('fsRespDevName'), date: val('fsRespDevDate') },
            steward: { name: val('fsRespStewardName'), date: val('fsRespStewardDate') },
        },
        projectGoal: val('fsProjectGoal'),
        solutionDesc: val('fsSolutionDesc'),
        improvementPotential: val('fsImprovementPotential'),
        delimitation: val('fsDelimitation'),
        previousSteps: _collectDynamicTable('fsPrevStepsTable'),
        report: defaultVal('fsReport'),
        transaction: defaultVal('fsTransaction'),
        sourceSystem: defaultVal('fsSourceSystem'),
        functionality: val('fsFunctionality'),
        userView: val('fsUserView'),
        languageTopics: val('fsLanguageTopics'),
        dataStructures: val('fsDataStructures'),
        dataMaintenance: val('fsDataMaintenance'),
        interfaces: val('fsInterfaces'),
        authorization: val('fsAuthorization'),
        infoSecurity: val('fsInfoSecurity'),
        architecture: val('fsArchitecture'),
        risks: val('fsRisks'),
        openIssues: val('fsOpenIssues'),
        migration: val('fsMigration'),
        glossary: _collectDynamicTable('fsGlossaryTable'),
        docHistory: _collectDynamicTable('fsDocHistoryTable'),
    };
}

/* ═══════════════════════════════════════════════════
   FS Review Summary Builder
   ═══════════════════════════════════════════════════ */

function buildFsReviewSummary() {
    const data = collectFsFormData();
    const panel = document.getElementById('fsReviewPanel');
    if (!panel) return;

    let html = '';

    // Document Info
    html += section('Document Information', [
        row('Title', data.title),
        row('Date', data.date),
        row('Version', data.version),
        row('Author', data.author),
    ]);

    // Responsibilities
    const respLabels = {
        globalBusiness: 'Global Business Responsible',
        globalShape: 'Global Shape Responsible',
        developer: 'Developer',
        steward: 'Steward Group Leader',
    };
    const respRows = [];
    for (const [key, label] of Object.entries(respLabels)) {
        const r = data.responsibilities[key];
        const parts = [r.name, r.date].filter(Boolean);
        respRows.push(row(label, parts.join(' — ') || ''));
    }
    html += section('Responsibilities', respRows);

    // Starting Point
    html += section('Starting Point', [
        row('Project Goal', data.projectGoal),
    ]);

    // Solution Description
    html += section('Solution Description', [
        row('Description', data.solutionDesc),
        row('Improvement Potential', data.improvementPotential),
        row('Delimitation', data.delimitation),
    ]);

    // Previous Steps
    if (data.previousSteps.length) {
        const psRows = data.previousSteps.map(r =>
            row(r[0] || 'Step', [r[1], r[2], r[3]].filter(Boolean).join(' · '))
        );
        html += section('Previous Steps', psRows);
    } else {
        html += section('Previous Steps', [row('Steps', '')]);
    }

    // Solution Definition 1
    const solDef1Rows = [];
    if (data.report) solDef1Rows.push(row('Report', data.report));
    if (data.transaction) solDef1Rows.push(row('Transaction', data.transaction));
    if (data.sourceSystem) solDef1Rows.push(row('Source System', data.sourceSystem));
    solDef1Rows.push(
        row('Functionality', data.functionality),
        row('User View / Dialog', data.userView),
        row('Language Topics', data.languageTopics),
        row('Data Structures', data.dataStructures),
        row('Data Maintenance', data.dataMaintenance),
    );
    html += section('Solution Definition (Part 1)', solDef1Rows);

    // Solution Definition 2
    html += section('Solution Definition (Part 2)', [
        row('Interfaces', data.interfaces),
        row('Authorization', data.authorization),
        row('Info Security', data.infoSecurity),
        row('Architecture', data.architecture),
    ]);

    // Risks & Issues
    html += section('Risks, Issues & Migration', [
        row('Risks', data.risks),
        row('Open Issues', data.openIssues),
        row('Migration', data.migration),
    ]);

    // Glossary
    if (data.glossary.length) {
        const gRows = data.glossary.map(r => row(r[0] || '—', r[1] || ''));
        html += section('Glossary', gRows);
    }

    // Doc History
    if (data.docHistory.length) {
        const hRows = data.docHistory.map(r =>
            row(`v${r[0] || '?'}`, [r[1], r[2], r[3], r[4]].filter(Boolean).join(' · '))
        );
        html += section('Document History', hRows);
    }

    panel.innerHTML = html;
}

/* ═══════════════════════════════════════════════════
   FS JSON Save / Load
   ═══════════════════════════════════════════════════ */

function downloadFsJson() {
    const data = collectFsFormData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (data.title || 'Functional_Spec').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    a.download = `${safeName}_FS.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('JSON saved', 'success');
}

function initFsJsonLoad() {
    const btn = document.getElementById('fsLoadJsonBtn');
    const input = document.getElementById('fsJsonFileInput');
    if (!btn || !input) return;

    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                loadFsFromJson(data);
                showToast('Loaded from JSON successfully', 'success');
            } catch {
                showToast('Invalid JSON file', 'error');
            }
        };
        reader.readAsText(file);
        input.value = '';
    });
}

function loadFsFromJson(data) {
    // Step 1: Doc Info
    setVal('fsTitle', data.title);
    setVal('fsDate', data.date);
    setVal('fsVersion', data.version);
    setVal('fsAuthor', data.author);

    // Step 2: Responsibilities
    const resp = data.responsibilities || {};
    const rMap = {
        globalBusiness: ['fsRespGlobalBizName', 'fsRespGlobalBizDate'],
        globalShape: ['fsRespGlobalShapeName', 'fsRespGlobalShapeDate'],
        developer: ['fsRespDevName', 'fsRespDevDate'],
        steward: ['fsRespStewardName', 'fsRespStewardDate'],
    };
    for (const [key, ids] of Object.entries(rMap)) {
        const entry = resp[key] || {};
        setVal(ids[0], entry.name);
        setVal(ids[1], entry.date);
    }

    // Step 3
    setVal('fsProjectGoal', data.projectGoal);

    // Step 4
    setVal('fsSolutionDesc', data.solutionDesc);
    setVal('fsImprovementPotential', data.improvementPotential);
    setVal('fsDelimitation', data.delimitation);

    // Step 5: Previous Steps
    if (data.previousSteps) _loadDynamicTable('fsPrevStepsTable', data.previousSteps, 4);

    // Step 6
    setVal('fsReport', data.report);
    setVal('fsTransaction', data.transaction);
    setVal('fsSourceSystem', data.sourceSystem);
    // Update default-text styling after loading
    document.querySelectorAll('.default-text').forEach(el => {
        el.classList.toggle('has-value', !!el.value && !el.dataset.defaultText?.includes(el.value));
    });
    setVal('fsFunctionality', data.functionality);
    setVal('fsUserView', data.userView);
    setVal('fsLanguageTopics', data.languageTopics);
    setVal('fsDataStructures', data.dataStructures);
    setVal('fsDataMaintenance', data.dataMaintenance);

    // Step 7
    setVal('fsInterfaces', data.interfaces);
    setVal('fsAuthorization', data.authorization);
    setVal('fsInfoSecurity', data.infoSecurity);
    setVal('fsArchitecture', data.architecture);

    // Step 8
    setVal('fsRisks', data.risks);
    setVal('fsOpenIssues', data.openIssues);
    setVal('fsMigration', data.migration);

    // Step 9: Glossary & Doc History
    if (data.glossary) _loadDynamicTable('fsGlossaryTable', data.glossary, 2);
    if (data.docHistory) _loadDynamicTable('fsDocHistoryTable', data.docHistory, 5);

    // Allow jumping to any step after importing saved JSON
    fsMaxAccessibleStep = fsTotalSteps;
    updateFsNav();
}

function setVal(id, v) {
    const el = document.getElementById(id);
    if (el && v != null) el.value = v;
}

/* ═══════════════════════════════════════════════════
   FS Export .docx via API
   ═══════════════════════════════════════════════════ */

async function exportFsDocx() {
    const data = collectFsFormData();

    try {
        LoadingOverlay.show({
            messages: ['Collecting form data', 'Generating document structure', 'Building Word document', 'Preparing download']
        });

        const response = await fetch('/api/export-functional-spec', {
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

        const safeName = (data.title || 'Functional_Spec').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
        a.download = `${safeName}_Functional_Specification.docx`;

        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        showToast('Document exported successfully!', 'success');
    } catch (err) {
        AppLogger.error('FS Export error:', err);
        showToast('Document export failed. Please try again.', 'error');
    } finally {
        LoadingOverlay.hide();
    }
}

/* ═══════════════════════════════════════════════════
   FS Standardization Panel
   ═══════════════════════════════════════════════════ */

function initFsInfoPanels() {
    // Wire up each info panel: [buttonId, panelId, overlayId, closeId]
    const panels = [
        ['fsStdInfoBtn', 'stdPanel', 'stdPanelOverlay', 'stdPanelClose'],
        ['fsDevStmtBtn', 'devStmtPanel', 'devStmtPanelOverlay', 'devStmtPanelClose'],
    ];

    panels.forEach(([btnId, panelId, overlayId, closeId]) => {
        const btn = document.getElementById(btnId);
        const panel = document.getElementById(panelId);
        const overlay = document.getElementById(overlayId);
        const closeBtn = document.getElementById(closeId);

        if (!btn || !panel) return;

        const openPanel = () => {
            panel.classList.add('open');
            if (overlay) overlay.classList.add('open');
        };
        const closePanel = () => {
            panel.classList.remove('open');
            if (overlay) overlay.classList.remove('open');
        };

        btn.addEventListener('click', openPanel);
        if (closeBtn) closeBtn.addEventListener('click', closePanel);
        if (overlay) overlay.addEventListener('click', closePanel);
    });
}

/* ═══════════════════════════════════════════════════
   FS Source Code Reference Toggle
   ═══════════════════════════════════════════════════ */

function initFsDefaultTextInputs() {
    document.querySelectorAll('.default-text').forEach(input => {
        const defaultVal = input.value;
        input.dataset.defaultText = defaultVal;

        input.addEventListener('focus', () => {
            if (input.value === defaultVal) {
                input.value = '';
                input.classList.add('has-value');
            }
        });
        input.addEventListener('blur', () => {
            if (!input.value.trim()) {
                input.value = defaultVal;
                input.classList.remove('has-value');
            }
        });
    });
}


/* ═══════════════════════════════════════════════════
   Shared Helpers
   ═══════════════════════════════════════════════════ */

function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

/** Return value only if it differs from the default text (i.e. user actually typed something). */
function defaultVal(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    const v = el.value.trim();
    return (el.dataset.defaultText && v === el.dataset.defaultText.trim()) ? '' : v;
}

function section(title, rows) {
    return `<div class="review-section"><div class="review-section-title">${title}</div>${rows.join('')}</div>`;
}

function row(label, value) {
    const display = value || '<span class="review-empty">Not provided</span>';
    return `<div class="review-row"><span class="review-label">${label}</span><span class="review-value">${escapeHtml(display)}</span></div>`;
}

function escapeHtml(text) {
    if (!text) return '';
    if (text.includes('<')) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
            if (target <= brMaxAccessibleStep) {
                brGoToStep(target);
            } else {
                showToast('Complete previous steps before jumping ahead.', 'warning');
            }
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

    updateMobileStepProgress('br-step-indicator', brCurrentStep, brTotalSteps);
}

function updateMobileStepProgress(indicatorId, currentStep, totalSteps) {
    const indicator = document.getElementById(indicatorId);
    if (!indicator || totalSteps <= 0) return;

    const progressPercent = Math.max(0, Math.min(100, (currentStep / totalSteps) * 100));
    const activeStep = indicator.querySelector('.step.step-active');
    const activeLabel = activeStep?.querySelector('.step-label')?.textContent?.trim() || `Step ${currentStep}`;

    indicator.style.setProperty('--progress-percent', `${progressPercent}%`);
    indicator.setAttribute('data-progress-label', `Step ${currentStep} of ${totalSteps}`);
    indicator.setAttribute('data-step-title', activeLabel);

    const maxAccessible = indicatorId === 'fs-step-indicator' ? fsMaxAccessibleStep
        : indicatorId === 'fv-step-indicator' ? fvMaxAccessibleStep
        : brMaxAccessibleStep;
    indicator.querySelectorAll('.mobile-step-jump-item').forEach(item => {
        const step = parseInt(item.dataset.step, 10);
        item.classList.toggle('is-active', step === currentStep);
        item.classList.toggle('is-locked', step > maxAccessible);
        item.disabled = step > maxAccessible;
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

    try {
        LoadingOverlay.show({
            messages: ['Collecting requirements data', 'Generating document structure', 'Building Word document', 'Preparing download']
        });

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
        AppLogger.error('BR Export error:', err);
        showToast('Document export failed. Please try again.', 'error');
    } finally {
        LoadingOverlay.hide();
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
    updateBrNav();
}


/* ═══════════════════════════════════════════════════
   FS VARIANT — Navigation
   ═══════════════════════════════════════════════════ */

function initFvNavigation() {
    const nextBtn = document.getElementById('fvNextBtn');
    const prevBtn = document.getElementById('fvPrevBtn');
    const resetBtn = document.getElementById('fvResetBtn');
    const exportBtn = document.getElementById('fvExportBtn');
    const editBtn = document.getElementById('fvEditFromReviewBtn');
    const downloadJsonBtn = document.getElementById('fvDownloadJsonBtn');

    if (nextBtn) nextBtn.addEventListener('click', fvNextStep);
    if (prevBtn) prevBtn.addEventListener('click', fvPrevStep);
    if (resetBtn) resetBtn.addEventListener('click', () => {
        showConfirmation(
            'Reset Form?',
            'All your inputs will be cleared. This cannot be undone.',
            () => { fvResetForm(); fvGoToStep(1); },
            { icon: '⚠️', confirmText: 'Reset', cancelText: 'Cancel' }
        );
    });
    if (exportBtn) exportBtn.addEventListener('click', exportFvDocx);
    if (editBtn) editBtn.addEventListener('click', () => fvGoToStep(1));
    if (downloadJsonBtn) downloadJsonBtn.addEventListener('click', downloadFvJson);

    document.querySelectorAll('#fv-step-indicator .step').forEach(el => {
        el.addEventListener('click', () => {
            const target = parseInt(el.dataset.fvStep, 10);
            if (target <= fvMaxAccessibleStep) {
                fvGoToStep(target);
            } else {
                showToast('Complete previous steps before jumping ahead.', 'warning');
            }
        });
    });
}

function fvNextStep() {
    if (fvCurrentStep < fvTotalSteps) {
        if (!validateFvStep(fvCurrentStep)) return;
        fvGoToStep(fvCurrentStep + 1);
    }
}

function fvPrevStep() {
    if (fvCurrentStep > 1) fvGoToStep(fvCurrentStep - 1);
}

function fvGoToStep(n) {
    if (n < 1 || n > fvTotalSteps) return;

    document.querySelectorAll('#fs-variant-mode .field-error').forEach(el => el.classList.remove('field-error'));
    document.querySelectorAll('.fv-form-step').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`fv-step-${n}`);
    if (target) target.classList.add('active');

    fvCurrentStep = n;
    if (n > fvMaxAccessibleStep) fvMaxAccessibleStep = n;

    if (n === fvTotalSteps) buildFvReviewSummary();

    updateFvNav();
    const container = document.querySelector('#fv-form-container');
    if (container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateFvNav() {
    const prevBtn = document.getElementById('fvPrevBtn');
    const nextBtn = document.getElementById('fvNextBtn');

    if (prevBtn) prevBtn.style.display = fvCurrentStep > 1 ? '' : 'none';
    if (nextBtn) {
        nextBtn.style.display = fvCurrentStep < fvTotalSteps ? '' : 'none';
        nextBtn.textContent = fvCurrentStep === fvTotalSteps - 1 ? 'Review' : 'Next';
    }

    document.querySelectorAll('#fv-step-indicator .step').forEach(el => {
        const s = parseInt(el.dataset.fvStep, 10);
        el.classList.remove('step-active', 'step-completed');
        if (s === fvCurrentStep) el.classList.add('step-active');
        else if (s < fvCurrentStep) el.classList.add('step-completed');
    });

    updateMobileStepProgress('fv-step-indicator', fvCurrentStep, fvTotalSteps);
}

function fvResetForm() {
    document.querySelectorAll('#fs-variant-mode input[type="text"], #fs-variant-mode input[type="date"], #fs-variant-mode input[type="number"], #fs-variant-mode textarea').forEach(el => { el.value = ''; });
    document.querySelectorAll('#fs-variant-mode input[type="radio"]').forEach(el => { el.checked = false; });
    document.querySelectorAll('#fs-variant-mode input[type="checkbox"]').forEach(el => { el.checked = false; });
    // Reset dynamic tables
    const dtMeta = {
        fvRevHistoryTable: { cols: 8, dateCols: [1] },
        fvSelScreenTable: { cols: 6, dateCols: [] },
        fvTestScenariosTable: { cols: 4, dateCols: [] },
        fvChangeHistoryTable: { cols: 4, dateCols: [0] },
    };
    for (const [id, meta] of Object.entries(dtMeta)) {
        const table = document.getElementById(id);
        if (!table) continue;
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = _buildDynamicRow(meta.cols, meta.dateCols);
        _bindRemoveButtons(tbody);
    }
    fvMaxAccessibleStep = 1;
    showToast('FS Template form has been reset', 'info');
}

/* ═══════════════════════════════════════════════════
   FV Dynamic Tables
   ═══════════════════════════════════════════════════ */

const FV_DT_DATE_COLS = {
    fvRevHistoryTable: [1],
    fvChangeHistoryTable: [0],
};

function initFvDynamicTables() {
    document.querySelectorAll('#fs-variant-mode .btn-add-row').forEach(btn => {
        btn.addEventListener('click', () => {
            const tableId = btn.dataset.table;
            const cols = parseInt(btn.dataset.cols, 10);
            const table = document.getElementById(tableId);
            if (!table) return;
            const tbody = table.querySelector('tbody');
            const dateCols = FV_DT_DATE_COLS[tableId] || [];
            tbody.insertAdjacentHTML('beforeend', _buildDynamicRow(cols, dateCols));
            _bindRemoveButtons(tbody);
        });
    });

    document.querySelectorAll('#fs-variant-mode .dynamic-table tbody').forEach(tbody => {
        _bindRemoveButtons(tbody);
    });
}

/* ═══════════════════════════════════════════════════
   FV Step Validation
   ═══════════════════════════════════════════════════ */

function validateFvStep(step) {
    document.querySelectorAll('#fs-variant-mode .field-error').forEach(el => el.classList.remove('field-error'));
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
            requireText('fvDescription', 'Description');
            requireText('fvWrittenBy', 'Written By');
            requireText('fvDate', 'Date');
            break;
        case 3:
            requireText('fvPurpose', 'Purpose');
            break;
        case 4:
            requireText('fvProcessingLogic', 'Processing Logic');
            break;
    }

    if (missing.length) {
        showToast(`Please fill in: ${missing.join(', ')}`, 'warning');
        const firstError = document.querySelector('#fs-variant-mode .field-error');
        if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return false;
    }
    return true;
}

/* ═══════════════════════════════════════════════════
   FV Collect Form Data
   ═══════════════════════════════════════════════════ */

function _collectCheckedValues(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(el => el.value);
}

function _getRadioValue(name) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : '';
}

function _fvCharValue(name) {
    const selected = _getRadioValue(name);
    if (!selected) return '';
    const yMark = selected === 'Yes' ? 'X' : '  ';
    const nMark = selected === 'No' ? 'X' : '  ';
    return `( ${yMark} ) Yes   ( ${nMark} ) No`;
}

function collectFvFormData() {
    const allTypeOptions = ['User-Exit', 'Core Code Change', 'Forms', 'Custom Program/Transaction', 'Other'];
    const typeValues = _collectCheckedValues('fvType');
    const typeStr = allTypeOptions.map(v => typeValues.includes(v) ? `(X) ${v}` : `( ) ${v}`).join('  ');

    const allLatencyOptions = ['Real-Time', 'Batch', 'Others'];
    const latency = _getRadioValue('fvLatency');
    const latencyStr = allLatencyOptions.map(v => v === latency ? `(X) ${v}` : `( ) ${v}`).join('  ');

    const allFreqOptions = ['Annually', 'Quarterly', 'Monthly', 'Weekly', 'Daily', 'On Demand', 'Other'];
    const freqValues = _collectCheckedValues('fvFrequency');
    const freqStr = allFreqOptions.map(v => freqValues.includes(v) ? `(X) ${v}` : `( ) ${v}`).join('  ');

    const allSystemOptions = ['SAP R/3', 'SAP S4'];
    const system = _getRadioValue('fvSystem');
    const systemStr = allSystemOptions.map(v => v === system ? `(*) ${v}` : `( ) ${v}`).join('  ');

    const allDeliveryOptions = ['Online', 'Spool', 'Printed', 'Send to Excel', 'Local Download', 'Other'];
    const deliveryValues = _collectCheckedValues('fvDelivery');
    const deliveryStr = allDeliveryOptions.map(v => deliveryValues.includes(v) ? `(*) ${v}` : `( ) ${v}`).join('  ');

    return {
        description: val('fvDescription'),
        writtenBy: val('fvWrittenBy'),
        date: val('fvDate'),
        updatedBy: val('fvUpdatedBy'),
        version: val('fvVersion'),
        revisionHistory: _collectDynamicTable('fvRevHistoryTable'),
        purpose: val('fvPurpose'),
        type: typeStr,
        latency: latencyStr,
        frequency: freqStr,
        system: systemStr,
        impactedSystem: val('fvImpactedSystem'),
        processingLogic: val('fvProcessingLogic'),
        prerequisites: val('fvPrerequisites'),
        selectionScreen: _collectDynamicTable('fvSelScreenTable'),
        reportCharacteristics: {
            standard: { value: _fvCharValue('fvCharStandard'), comments: val('fvCharStandardComment') },
            interactive: { value: _fvCharValue('fvCharInteractive'), comments: val('fvCharInteractiveComment') },
            drillDown: { value: _fvCharValue('fvCharDrillDown'), comments: val('fvCharDrillDownComment') },
            alv: { value: _fvCharValue('fvCharAlv'), comments: val('fvCharAlvComment') },
            other: { value: _fvCharValue('fvCharOther'), comments: val('fvCharOtherComment') },
        },
        reportDelivery: deliveryStr,
        reportLayout: val('fvReportLayout'),
        reportAttributes: val('fvReportAttributes'),
        customTransitions: val('fvCustomTransitions'),
        printerRequirements: val('fvPrinterReq'),
        exclusions: val('fvExclusions'),
        outputFileLocation: val('fvOutputFileLoc'),
        outputFileRemarks: val('fvOutputFileRemarks'),
        exceptionHandling: val('fvExceptionHandling'),
        dependencies: val('fvDependencies'),
        constraints: val('fvConstraints'),
        scheduling: val('fvScheduling'),
        roleAuthorization: val('fvRoleAuth'),
        testScenarios: _collectDynamicTable('fvTestScenariosTable'),
        testData: val('fvTestData'),
        testSystem: val('fvTestSystem'),
        testClient: val('fvTestClient'),
        changeHistory: _collectDynamicTable('fvChangeHistoryTable'),
    };
}

/* ═══════════════════════════════════════════════════
   FV Review Summary Builder
   ═══════════════════════════════════════════════════ */

function buildFvReviewSummary() {
    const data = collectFvFormData();
    const panel = document.getElementById('fvReviewPanel');
    if (!panel) return;

    let html = '';

    html += section('Cover Page', [
        row('Description', data.description),
        row('Written By', data.writtenBy),
        row('Date', data.date),
        row('Updated By (Footer)', data.updatedBy),
        row('Version (Footer)', data.version),
    ]);

    if (data.revisionHistory.length) {
        const revRows = data.revisionHistory.map(r =>
            row(`v${r[0] || '?'}`, [r[1], r[2], r[5]].filter(Boolean).join(' · '))
        );
        html += section('Revision History', revRows);
    }

    html += section('Purpose', [
        row('Purpose', data.purpose),
        row('Type', data.type),
        row('Latency', data.latency),
        row('Frequency', data.frequency),
        row('System', data.system),
        row('Impacted System', data.impactedSystem),
    ]);

    html += section('Detail Processing Logic', [
        row('Processing Logic', data.processingLogic),
        row('Prerequisites', data.prerequisites),
    ]);

    if (data.selectionScreen.length) {
        const selRows = data.selectionScreen.map(r =>
            row(r[0] || '—', [r[1], r[2], r[3], r[4], r[5]].filter(Boolean).join(' · '))
        );
        html += section('Selection Screen', selRows);
    }

    const charLabels = { standard: 'Standard Report', interactive: 'Interactive Report', drillDown: 'Drill-Down Report', alv: 'ALV Output', other: 'Other' };
    const charRows = [];
    for (const [key, label] of Object.entries(charLabels)) {
        const c = data.reportCharacteristics[key] || {};
        const parts = [c.value, c.comments].filter(Boolean);
        if (parts.length) charRows.push(row(label, parts.join(' — ')));
    }
    if (charRows.length) html += section('Report Characteristics', charRows);

    html += section('Report Configuration', [
        row('Delivery', data.reportDelivery),
        row('Layout', data.reportLayout),
        row('Attributes', data.reportAttributes),
    ]);

    html += section('Additional Sections', [
        row('Custom Transitions', data.customTransitions),
        row('Printer Requirements', data.printerRequirements),
        row('Exclusions', data.exclusions),
        row('Output File Location', data.outputFileLocation),
        row('Output File Remarks', data.outputFileRemarks),
        row('Exception Handling', data.exceptionHandling),
        row('Dependencies', data.dependencies),
        row('Constraints', data.constraints),
        row('Scheduling', data.scheduling),
        row('Role/Authorization', data.roleAuthorization),
    ]);

    if (data.testScenarios.length) {
        const testRows = data.testScenarios.map(r =>
            row(`#${r[0] || '?'}`, [r[1], r[2], r[3]].filter(Boolean).join(' · '))
        );
        html += section('Test Scenarios', testRows);
    }

    html += section('Test Environment', [
        row('Test Data', data.testData),
        row('Test System', data.testSystem),
        row('Client', data.testClient),
    ]);

    if (data.changeHistory.length) {
        const chRows = data.changeHistory.map(r =>
            row(`v${r[2] || '?'}`, [r[0], r[1], r[3]].filter(Boolean).join(' · '))
        );
        html += section('Change History', chRows);
    }

    panel.innerHTML = html;
}

/* ═══════════════════════════════════════════════════
   FV Export .docx via API
   ═══════════════════════════════════════════════════ */

async function exportFvDocx() {
    const data = collectFvFormData();

    try {
        LoadingOverlay.show({
            messages: ['Collecting form data', 'Generating document structure', 'Building Word document', 'Preparing download']
        });

        const response = await fetch('/api/export-fs-variant', {
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

        const safeName = (data.description || 'FS_Template').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
        a.download = `${safeName}_Functional_Specification.docx`;

        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        showToast('Document exported successfully!', 'success');
    } catch (err) {
        AppLogger.error('FV Export error:', err);
        showToast('Document export failed. Please try again.', 'error');
    } finally {
        LoadingOverlay.hide();
    }
}

/* ═══════════════════════════════════════════════════
   FV JSON Save / Load
   ═══════════════════════════════════════════════════ */

function downloadFvJson() {
    const data = collectFvFormData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (data.description || 'FS_Template').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
    a.download = `${safeName}_FSVariant.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('JSON saved', 'success');
}

function initFvJsonLoad() {
    const btn = document.getElementById('fvLoadJsonBtn');
    const input = document.getElementById('fvJsonFileInput');
    if (!btn || !input) return;

    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                loadFvFromJson(data);
                showToast('Loaded from JSON successfully', 'success');
            } catch {
                showToast('Invalid JSON file', 'error');
            }
        };
        reader.readAsText(file);
        input.value = '';
    });
}

function loadFvFromJson(data) {
    setVal('fvDescription', data.description);
    setVal('fvWrittenBy', data.writtenBy);
    setVal('fvDate', data.date);
    setVal('fvUpdatedBy', data.updatedBy);
    setVal('fvVersion', data.version);

    if (data.revisionHistory) _loadFvDynamicTable('fvRevHistoryTable', data.revisionHistory, 8);

    setVal('fvPurpose', data.purpose);
    setVal('fvImpactedSystem', data.impactedSystem);

    // Restore checkboxes/radios from formatted strings is complex,
    // so we skip restoring type/latency/frequency/system radio states from JSON.
    // Clear them so user can re-select.

    setVal('fvProcessingLogic', data.processingLogic);
    setVal('fvPrerequisites', data.prerequisites);

    if (data.selectionScreen) _loadFvDynamicTable('fvSelScreenTable', data.selectionScreen, 6);

    setVal('fvReportLayout', data.reportLayout);
    setVal('fvReportAttributes', data.reportAttributes);
    setVal('fvCustomTransitions', data.customTransitions);
    setVal('fvPrinterReq', data.printerRequirements);
    setVal('fvExclusions', data.exclusions);
    setVal('fvOutputFileLoc', data.outputFileLocation);
    setVal('fvOutputFileRemarks', data.outputFileRemarks);
    setVal('fvExceptionHandling', data.exceptionHandling);
    setVal('fvDependencies', data.dependencies);
    setVal('fvConstraints', data.constraints);
    setVal('fvScheduling', data.scheduling);
    setVal('fvRoleAuth', data.roleAuthorization);

    if (data.testScenarios) _loadFvDynamicTable('fvTestScenariosTable', data.testScenarios, 4);
    setVal('fvTestData', data.testData);
    setVal('fvTestSystem', data.testSystem);
    setVal('fvTestClient', data.testClient);

    if (data.changeHistory) _loadFvDynamicTable('fvChangeHistoryTable', data.changeHistory, 4);

    fvMaxAccessibleStep = fvTotalSteps;
    updateFvNav();
}

function _loadFvDynamicTable(tableId, data, cols) {
    const table = document.getElementById(tableId);
    if (!table || !data || !data.length) return;
    const tbody = table.querySelector('tbody');
    const dateCols = FV_DT_DATE_COLS[tableId] || [];
    tbody.innerHTML = '';
    data.forEach(rowData => {
        let cells = '';
        for (let i = 0; i < cols; i++) {
            const v = (rowData[i] || '').replace(/"/g, '&quot;');
            const inputType = dateCols.includes(i) ? 'date' : 'text';
            cells += `<td><input type="${inputType}" class="dt-input" value="${v}" /></td>`;
        }
        cells += `<td><button type="button" class="btn-remove-row" title="Remove row">&times;</button></td>`;
        tbody.insertAdjacentHTML('beforeend', `<tr>${cells}</tr>`);
    });
    _bindRemoveButtons(tbody);
}
