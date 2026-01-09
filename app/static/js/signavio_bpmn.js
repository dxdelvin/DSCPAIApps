/**
 * Signavio BPMN Creator logic
 */

let currentStep = 1;
const totalSteps = 6; // Keep in sync with template step count
const formData = {};
let maxAccessibleStep = 1; // highest step allowed to jump to

window.addEventListener('DOMContentLoaded', () => {
    initializeFormHandlers();
    updateFormNavigation();
});

function initializeFormHandlers() {
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) nextBtn.addEventListener('click', handleNext);

    const prevBtn = document.getElementById('prevBtn');
    if (prevBtn) prevBtn.addEventListener('click', previousStep);

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) generateBtn.addEventListener('click', generateBPMN);
    const reviewAgainBtn = document.getElementById('reviewAgainBtn');
    if (reviewAgainBtn) reviewAgainBtn.addEventListener('click', () => goToStep(Math.min(maxAccessibleStep, 6)));

    const editBtnReview = document.getElementById('editBtnReview');
    if (editBtnReview) editBtnReview.addEventListener('click', () => {
        toggleInlineOverride(true);
    });

    // Reset buttons
    const editBtn = document.getElementById('editBtn');
    if (editBtn) editBtn.addEventListener('click', () => resetForm());
    
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
    if (currentStep === totalSteps) populateReviewSummary();
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

function populateReviewSummary() {
    // Summary list intentionally removed in this version.
}

async function generateBPMN() {
    const loadingSpinner = document.getElementById('loadingSpinner');
    if (loadingSpinner) loadingSpinner.style.display = 'flex';
    try {
        showToast('Generating BPMN diagram...', 'info', 4000);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await downloadFakeBPMN();
        showToast('BPMN generated and downloaded.', 'success');
        setTimeout(resetForm, 800);
    } catch (error) {
        console.error('Error generating BPMN:', error);
        showToast('Failed to generate BPMN. Please try again.', 'error');
    } finally {
        if (loadingSpinner) loadingSpinner.style.display = 'none';
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

function updateInfoModalContent() {
    const infoTitle = document.getElementById('infoModalTitle');
    const infoContent = document.getElementById('infoModalContent');
    
    const stepInfo = {
        1: {
            title: 'Step 1: Process Context',
            content: `<p>Define the basic identity of your process.</p>
                <h4>What to write:</h4>
                <ul>
                    <li><strong>Process Name:</strong> A clear, descriptive name for the process</li>
                    <li><strong>Pool/Department:</strong> The organizational unit responsible for the process</li>
                </ul>
                <h4>Example:</h4>
                <div class="modal-example">
                    <strong>Process Name:</strong> Customer Order Fulfillment<br>
                    <strong>Pool/Department:</strong> Digital Supply Chain Planning (DSCP) or Sales Department
                </div>`
        },
        2: {
            title: 'Step 2: Structure & Participants',
            content: `<p>Identify who is involved in executing the process. Use Digital Supply Chain Planning lanes/systems.</p>
                <h4>What to write:</h4>
                <ul>
                    <li><strong>Participants (Lanes):</strong> Roles or systems (e.g., R0P, P0P, GRP, M0P)</li>
                    <li><strong>Sub-lanes:</strong> More specific roles within a participant (optional)</li>
                </ul>
                <h4>Example:</h4>
                <div class="modal-example">
                    <strong>Participants:</strong> R0P (Demand Planning), P0P (Production Planning), GRP (Global Replenishment), M0P (Master Data), Logistics Execution, Customer Portal<br>
                    <strong>Sub-lanes:</strong> APAC Demand Planner (under R0P), EMEA Supply Planner (under GRP)
                </div>`
        },
        3: {
            title: 'Step 3: Start Triggers',
            content: `<p>Describe how the process is initiated. Always mention the lane(s) where each start happens, and include all start events. Use supply chain examples.</p>
                <h4>What to write:</h4>
                <ul>
                    <li><strong>Lane + trigger type:</strong> Message (email/API), Timer (scheduled), Manual (user)</li>
                    <li>List every start event and the lane that owns it (multiple starts allowed)</li>
                </ul>
                <h4>Example:</h4>
                <div class="modal-example">
                    R0P lane — Weekly demand signal file arrives (Message); GRP lane — Nightly replenishment batch (Timer); Customer Portal lane — User submits rush order (Manual)
                </div>`
        },
        4: {
            title: 'Step 4: Flow & Activities',
            content: `<p>Describe the sequence of tasks and decisions in detail.</p>
                <h4>What to write:</h4>
                <ul>
                    <li>List tasks in order of execution</li>
                    <li>Mention who is responsible for each task</li>
                    <li>Include conditions (e.g., "If X, then Y")</li>
                    <li>Note any parallel activities</li>
                    <li><strong>End-of-process question:</strong> What happens after the process is completed?</li>
                </ul>
                <h4>Example:</h4>
                <div class="modal-example">
                    1. R0P ingests demand plan and flags anomalies<br>
                    2. GRP checks supply and proposes reallocations<br>
                    3. If stock-out risk > threshold, M0P triggers master-data validation; else continue<br>
                    4. P0P schedules production; Logistics Execution creates deliveries in parallel<br>
                    5. Finance posts billing once goods issue is confirmed<br>
                    <strong>End-of-process question:</strong> Customer receives order confirmation and tracking details.
                </div>`
        },
        5: {
            title: 'Step 5: Delays & Intermediate Events',
            content: `<p>Identify points where the process must wait or pause, including system or document dependencies.</p>
                <h4>What to write:</h4>
                <ul>
                    <li>Timer events (e.g., "Wait 2 days before follow-up")</li>
                    <li>Message events (e.g., "Wait for payment confirmation")</li>
                    <li>Dependencies on systems/documents (e.g., "Wait for ERP record", "Wait for invoice PDF", "Wait for DB update")</li>
                </ul>
                <h4>Example:</h4>
                <div class="modal-example">
                    Wait for payment gateway confirmation (max 5 minutes); Wait 24 hours for customer response; Wait until ERP creates delivery note; Wait for invoice PDF upload; Wait for DB update from SAP
                </div>`
        },
        6: {
            title: 'Step 6: Review',
            content: `<p>Review all your inputs before generating the BPMN.</p>
                <h4>What to do:</h4>
                <ul>
                    <li>Check the AI-generated summary</li>
                    <li>Verify all information is accurate</li>
                    <li>Use "Edit Details" to make changes</li>
                    <li>Click "Generate BPMN" when ready</li>
                </ul>
                <p style="margin-top: 12px;"><strong>Tip:</strong> The more detailed your inputs, the more accurate your BPMN diagram will be.</p>`
        }
    };
    
    const currentInfo = stepInfo[currentStep] || stepInfo[1];
    if (infoTitle) infoTitle.textContent = currentInfo.title;
    if (infoContent) infoContent.innerHTML = currentInfo.content;
}

function resetForm() {
    // Clear formData object
    Object.keys(formData).forEach((k) => delete formData[k]);
    
    // Clear all input fields in the DOM
    document.querySelectorAll('input, textarea, select').forEach((input) => { 
        input.value = ''; 
        input.classList.remove('error'); 
    });
    
    // Reset to step 1
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