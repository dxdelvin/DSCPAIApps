// ============================================
// BPMN DIAGRAM CHECKER - Main JavaScript
// ============================================

class BPMNCheckerApp {
    constructor() {
        this.selectedFile = null;
        this.chatHistoryId = null;
        this.analysisResult = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
    }

    setupEventListeners() {
        // Upload area click
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        
        if (uploadArea && fileInput) {
            uploadArea.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => this.handleFileSelection(e.target.files));
        }

        // Remove file button
        const removeBtn = document.getElementById('remove-file-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => this.removeFile());
        }

        // Check button
        const checkBtn = document.getElementById('check-btn');
        if (checkBtn) {
            checkBtn.addEventListener('click', () => this.checkDiagram());
        }

        // Reset button
        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.reset());
        }

        // Guide modal
        const guideBtn = document.getElementById('guideBtn');
        const guideModal = document.getElementById('guide-modal');
        const closeGuideBtn = document.getElementById('close-guide-btn');
        
        if (guideBtn && guideModal) {
            guideBtn.addEventListener('click', () => guideModal.style.display = 'flex');
            closeGuideBtn.addEventListener('click', () => guideModal.style.display = 'none');
            guideModal.addEventListener('click', (e) => {
                if (e.target === guideModal) guideModal.style.display = 'none';
            });
        }
    }

    /**
     * Parse JSON from AI response - handles code fences and raw JSON
     */
    parseAnalysisJSON(text) {
        if (!text) return null;
        
        // Try to extract JSON from code fences first
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
        
        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.warn('Failed to parse analysis as JSON:', e);
            return null;
        }
    }

    setupDragAndDrop() {
        const uploadArea = document.getElementById('upload-area');
        if (!uploadArea) return;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => {
                uploadArea.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => {
                uploadArea.classList.remove('dragover');
            });
        });

        uploadArea.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            this.handleFileSelection(files);
        });
    }

    handleFileSelection(files) {
        if (!files || files.length === 0) return;

        const file = files[0];
        
        // Validate file type - accept PDF and images
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
        const validExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
        const fileExt = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
        
        const isValid = validTypes.includes(file.type) || validExtensions.includes(fileExt);
        
        if (!isValid) {
            showToast('Please upload a PDF or image file (JPG, JPEG, PNG).', 'error');
            return;
        }

        // Validate file size (max 20MB)
        const maxSize = 20 * 1024 * 1024;
        if (file.size > maxSize) {
            showToast('File size must be less than 20MB.', 'error');
            return;
        }

        this.selectedFile = file;
        this.updateFileDisplay();
    }

    updateFileDisplay() {
        const uploadArea = document.getElementById('upload-area');
        const selectedSection = document.getElementById('selected-file-section');
        const fileName = document.getElementById('file-name');
        const fileSize = document.getElementById('file-size');
        const checkBtn = document.getElementById('check-btn');

        if (this.selectedFile) {
            uploadArea.style.display = 'none';
            selectedSection.style.display = 'block';
            fileName.textContent = this.selectedFile.name;
            fileSize.textContent = this.formatFileSize(this.selectedFile.size);
            checkBtn.disabled = false;
        } else {
            uploadArea.style.display = 'block';
            selectedSection.style.display = 'none';
            checkBtn.disabled = true;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    removeFile() {
        this.selectedFile = null;
        document.getElementById('file-input').value = '';
        this.updateFileDisplay();
    }

    async checkDiagram() {
        if (!this.selectedFile) {
            showToast('Please select a PDF file first.', 'warning');
            return;
        }

        // Show loading state
        this.showLoadingState();

        try {
            const formData = new FormData();
            formData.append('file', this.selectedFile);
            
            // Add optional context
            const contextInput = document.getElementById('context-input');
            if (contextInput && contextInput.value.trim()) {
                formData.append('context', contextInput.value.trim());
            }

            const response = await fetch('/api/bpmn-diagram-check', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.status === 'success') {
                this.analysisResult = result.analysis;
                this.chatHistoryId = result.chatHistoryId;
                this.displayResults(result.analysis);
                showToast('Diagram analysis complete!', 'success');
            } else {
                this.showEmptyState();
                showToast(result.message || 'Failed to analyze diagram.', 'error');
            }
        } catch (error) {
            console.error('Error checking diagram:', error);
            this.showEmptyState();
            showToast('An error occurred while analyzing the diagram.', 'error');
        }
    }

    showLoadingState() {
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('loading-state').style.display = 'flex';
        document.getElementById('results-content').style.display = 'none';
    }

    showEmptyState() {
        document.getElementById('empty-state').style.display = 'flex';
        document.getElementById('loading-state').style.display = 'none';
        document.getElementById('results-content').style.display = 'none';
    }

    showResultsState() {
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('loading-state').style.display = 'none';
        document.getElementById('results-content').style.display = 'block';
    }

    showNotBPMNState(errorMessage) {
        // Show a friendly "not a BPMN diagram" message
        this.showResultsState();
        
        const analysisContent = document.getElementById('analysis-content');
        const scoreSection = document.getElementById('score-section');
        
        // Hide score for non-BPMN
        if (scoreSection) scoreSection.style.display = 'none';
        
        analysisContent.innerHTML = `
            <div class="not-bpmn-notice">
                <div class="notice-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                </div>
                <h4>Not a BPMN Diagram</h4>
                <p>${this.escapeHtml(errorMessage || "The uploaded file doesn't appear to be a BPMN diagram. Please upload a valid BPMN 2.0 process diagram.")}</p>
                <button class="btn btn-secondary" onclick="window.bpmnCheckerApp.reset()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Upload Different File
                </button>
            </div>
        `;
    }

    displayResults(analysis) {
        this.showResultsState();
        
        // Try to parse as structured JSON
        const data = this.parseAnalysisJSON(analysis);
        
        if (data) {
            // Check if it's a BPMN diagram
            if (data.isBPMN === false) {
                this.showNotBPMNState(data.errorMessage);
                return;
            }
            
            // Render structured results
            this.renderStructuredResults(data);
        } else {
            // Fallback: render as markdown/text
            this.renderMarkdownResults(analysis);
        }
    }

    renderStructuredResults(data) {
        const scoreSection = document.getElementById('score-section');
        if (scoreSection) scoreSection.style.display = 'flex';
        
        // Update score
        const score = data.qualityScore || 75;
        this.updateScoreDisplay(score);
        
        // Build results HTML
        const analysisContent = document.getElementById('analysis-content');
        let html = '';
        
        // Summary
        if (data.summary) {
            html += `<div class="result-summary"><p>${this.escapeHtml(data.summary)}</p></div>`;
        }
        
        // Issue counts badge bar
        if (data.counts) {
            const totalIssues = (data.counts.critical || 0) + (data.counts.minor || 0);
            const suggestions = data.counts.suggestions || 0;
            
            html += `
                <div class="counts-bar">
                    ${totalIssues > 0 ? `<span class="count-badge issues"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${totalIssues} Issue${totalIssues !== 1 ? 's' : ''}</span>` : ''}
                    ${suggestions > 0 ? `<span class="count-badge suggestions"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg> ${suggestions} Suggestion${suggestions !== 1 ? 's' : ''}</span>` : ''}
                    ${totalIssues === 0 && suggestions === 0 ? `<span class="count-badge success"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> No Issues Found</span>` : ''}
                </div>
            `;
        }
        
        // Diagram Overview (collapsible)
        if (data.diagramOverview) {
            html += `
                <details class="result-section overview-section">
                    <summary><span class="section-icon">📊</span> Diagram Overview</summary>
                    <div class="section-content">
                        <p>${this.escapeHtml(data.diagramOverview)}</p>
                    </div>
                </details>
            `;
        }
        
        // Top Priority Fixes
        if (data.topPriorityFixes && data.topPriorityFixes.length > 0) {
            html += `
                <div class="result-section priority-section">
                    <h4><span class="section-icon">🎯</span> Priority Fixes</h4>
                    <div class="priority-fixes">
                        ${data.topPriorityFixes.map((fix, i) => `
                            <div class="priority-card">
                                <div class="priority-header">
                                    <span class="priority-number">${i + 1}</span>
                                    <h5>${this.escapeHtml(fix.title)}</h5>
                                </div>
                                <div class="priority-body">
                                    <div class="priority-row">
                                        <span class="row-label">Why it matters:</span>
                                        <span>${this.escapeHtml(fix.whyItMatters)}</span>
                                    </div>
                                    <div class="priority-row fix-row">
                                        <span class="row-label">Fix:</span>
                                        <span>${this.escapeHtml(fix.fix)}</span>
                                    </div>
                                    ${fix.howToValidate ? `
                                        <div class="priority-row validate-row">
                                            <span class="row-label">Validate:</span>
                                            <span>${this.escapeHtml(fix.howToValidate)}</span>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        // All Issues
        if (data.issues && data.issues.length > 0) {
            html += `
                <details class="result-section issues-section" open>
                    <summary><span class="section-icon">🔍</span> All Findings (${data.issues.length})</summary>
                    <div class="issues-list">
                        ${data.issues.map(issue => `
                            <div class="issue-card severity-${issue.severity}">
                                <div class="issue-header">
                                    <span class="severity-badge ${issue.severity}">${this.getSeverityLabel(issue.severity)}</span>
                                    <span class="issue-category">${this.escapeHtml(issue.category || '')}</span>
                                    ${issue.effort ? `<span class="effort-badge effort-${issue.effort}">${issue.effort} effort</span>` : ''}
                                </div>
                                <h5 class="issue-title">${this.escapeHtml(issue.title)}</h5>
                                <p class="issue-desc">${this.escapeHtml(issue.description)}</p>
                                ${issue.recommendation ? `
                                    <div class="issue-recommendation">
                                        <strong>💡 Fix:</strong> ${this.escapeHtml(issue.recommendation)}
                                    </div>
                                ` : ''}
                                ${issue.impactedElements && issue.impactedElements.length > 0 ? `
                                    <div class="issue-elements">
                                        <span class="elements-label">Affected:</span>
                                        ${issue.impactedElements.map(el => `<code>${this.escapeHtml(el)}</code>`).join(' ')}
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </details>
            `;
        }
        
        // Strengths
        if (data.strengths && data.strengths.length > 0) {
            html += `
                <div class="result-section strengths-section">
                    <h4><span class="section-icon">✅</span> What's Done Well</h4>
                    <ul class="strengths-list">
                        ${data.strengths.map(s => `<li>${this.escapeHtml(s)}</li>`).join('')}
                    </ul>
                </div>
            `;
        }
        
        analysisContent.innerHTML = html;
    }

    getSeverityLabel(severity) {
        const labels = {
            'critical': '🔴 Critical',
            'minor': '🟡 Minor',
            'suggestion': '💡 Suggestion'
        };
        return labels[severity] || severity;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    renderMarkdownResults(analysis) {
        // Fallback markdown rendering for non-JSON responses
        const scoreSection = document.getElementById('score-section');
        if (scoreSection) scoreSection.style.display = 'flex';
        
        const score = this.extractScore(analysis);
        this.updateScoreDisplay(score);
        this.renderAnalysis(analysis);
    }

    extractScore(analysis) {
        // Try to extract a score if mentioned (e.g., "Score: 75/100" or "Quality Score: 80/100")
        const scoreMatch = analysis.match(/(?:score|quality\s*score)[:\s]*(\d+)\s*(?:\/\s*(\d+)|%)?/i);
        if (scoreMatch) {
            const value = parseInt(scoreMatch[1]);
            const max = scoreMatch[2] ? parseInt(scoreMatch[2]) : 100;
            return Math.round((value / max) * 100);
        }
        // Default score if not found
        return 75;
    }

    updateScoreDisplay(score) {
        const scoreCircle = document.getElementById('score-circle');
        const scoreValue = document.getElementById('score-value');
        const scoreLabel = document.getElementById('score-label');
        const scoreSummary = document.getElementById('score-summary');

        scoreValue.textContent = score;

        // Remove existing classes
        scoreCircle.classList.remove('excellent', 'good', 'fair', 'poor');

        // Set class and label based on score
        if (score >= 90) {
            scoreCircle.classList.add('excellent');
            scoreLabel.textContent = 'Excellent';
            scoreSummary.textContent = 'Your BPMN diagram follows best practices with minimal issues.';
        } else if (score >= 70) {
            scoreCircle.classList.add('good');
            scoreLabel.textContent = 'Good';
            scoreSummary.textContent = 'Your diagram is well-structured with some improvements suggested.';
        } else if (score >= 50) {
            scoreCircle.classList.add('fair');
            scoreLabel.textContent = 'Fair';
            scoreSummary.textContent = 'Several issues found. Review the recommendations below.';
        } else {
            scoreCircle.classList.add('poor');
            scoreLabel.textContent = 'Needs Improvement';
            scoreSummary.textContent = 'Multiple issues detected. See solutions below.';
        }

        // Update the conic gradient
        const degrees = (score / 100) * 360;
        let color = 'var(--score-excellent)';
        if (score < 50) color = 'var(--score-poor)';
        else if (score < 70) color = 'var(--score-fair)';
        else if (score < 90) color = 'var(--score-good)';
        
        scoreCircle.style.background = `conic-gradient(${color} 0deg, ${color} ${degrees}deg, var(--border) ${degrees}deg)`;
    }

    renderAnalysis(analysis) {
        const analysisContent = document.getElementById('analysis-content');
        
        // Convert markdown-like formatting to HTML
        let html = analysis
            // Horizontal rules (---) - convert to styled divider
            .replace(/^---+$/gm, '<hr class="finding-divider">')
            // Headers
            .replace(/^### (.*$)/gm, '<h3>$1</h3>')
            .replace(/^## (.*$)/gm, '<h2>$1</h2>')
            .replace(/^# (.*$)/gm, '<h1>$1</h1>')
            // Bold
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            // Lists
            .replace(/^- (.*$)/gm, '<li>$1</li>')
            .replace(/^(\d+)\. (.*$)/gm, '<li>$2</li>')
            // Code
            .replace(/`(.*?)`/g, '<code>$1</code>')
            // Line breaks
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');

        // Wrap consecutive <li> elements in <ul>
        html = html.replace(/(<li>.*?<\/li>(?:<br>)?)+/g, (match) => {
            return '<ul>' + match.replace(/<br>/g, '') + '</ul>';
        });

        // Wrap in paragraph if not already starting with a tag
        if (!html.startsWith('<')) {
            html = '<p>' + html + '</p>';
        }

        // Clean up empty paragraphs
        html = html.replace(/<p><\/p>/g, '');
        html = html.replace(/<p><br><\/p>/g, '');

        analysisContent.innerHTML = html;
    }

    reset() {
        // Reset file
        this.selectedFile = null;
        this.chatHistoryId = null;
        this.analysisResult = null;
        document.getElementById('file-input').value = '';
        this.updateFileDisplay();

        // Reset context
        const contextInput = document.getElementById('context-input');
        if (contextInput) contextInput.value = '';

        // Reset results display
        const scoreSection = document.getElementById('score-section');
        if (scoreSection) scoreSection.style.display = 'flex';
        
        this.showEmptyState();

        showToast('Reset complete.', 'info');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.bpmnCheckerApp = new BPMNCheckerApp();
});
