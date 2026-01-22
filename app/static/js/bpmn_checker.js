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
                this.analysisStructured = result.analysisStructured;
                this.chatHistoryId = result.chatHistoryId;
                this.displayResults(result.analysis, result.analysisStructured);
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

    displayResults(analysis, structured) {
        this.showResultsState();

        if (structured && typeof structured === 'object') {
            // Check if it's a valid BPMN diagram
            if (structured.isBPMN === false) {
                this.showNonBPMNError(structured.errorMessage || 'This does not appear to be a BPMN diagram.');
                return;
            }

            const score = typeof structured.qualityScore === 'number' ? structured.qualityScore : this.extractScore(analysis || '');
            this.updateScoreDisplay(score);
            this.renderStructured(structured);
        } else {
            // Fallback to text rendering
            const score = this.extractScore(analysis || '');
            this.updateScoreDisplay(score);
            this.renderAnalysis(analysis || '');
        }
    }

    showNonBPMNError(message) {
        // Hide all structured sections
        document.getElementById('summary-section').style.display = 'none';
        document.getElementById('priority-section').style.display = 'none';
        document.getElementById('issues-section').style.display = 'none';
        document.getElementById('score-section').style.display = 'none';

        // Show error in analysis section
        const analysisSection = document.getElementById('analysis-section');
        const analysisContent = document.getElementById('analysis-content');
        analysisSection.style.display = 'block';
        analysisContent.innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5" style="margin-bottom: 1rem;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <h3 style="color: var(--danger); margin: 0 0 0.5rem;">Not a BPMN Diagram</h3>
                <p style="color: var(--text-secondary); margin: 0;">${this.escapeHtml(message)}</p>
                <p style="color: var(--text-secondary); margin: 1rem 0 0; font-size: 0.9rem;">Please upload a valid BPMN 2.0 process diagram (PDF or image).</p>
            </div>
        `;
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

    renderStructured(data) {
        // Show structured sections, hide fallback analysis if not needed
        const summarySection = document.getElementById('summary-section');
        const prioritySection = document.getElementById('priority-section');
        const issuesSection = document.getElementById('issues-section');
        const analysisSection = document.getElementById('analysis-section');

        // Normalize major to critical for backward compatibility
        const counts = (data && data.counts) || { critical: 0, minor: 0, suggestions: 0 };
        if (counts.major) {
            counts.critical = (counts.critical || 0) + counts.major;
        }

        const summaryBadges = document.getElementById('summary-badges');
        const filters = document.getElementById('severity-filters');
        summaryBadges.innerHTML = '';
        filters.innerHTML = '';

        const severities = [
            { key: 'critical', label: 'Critical', cssClass: 'critical' },
            { key: 'minor', label: 'Minor', cssClass: 'minor' },
            { key: 'suggestions', label: 'Suggestions', cssClass: 'suggestion' }
        ];

        severities.forEach(({ key, label, cssClass }) => {
            const count = counts[key] || 0;
            const badge = document.createElement('div');
            badge.className = `summary-badge ${cssClass}`;
            badge.innerHTML = `<span>${label}</span><span class="count">${count}</span>`;
            summaryBadges.appendChild(badge);

            const btn = document.createElement('button');
            btn.className = 'filter-btn';
            btn.textContent = label;
            btn.dataset.severity = key === 'suggestions' ? 'suggestion' : key;
            btn.addEventListener('click', (e) => {
                this.filterIssuesBySeverity(e.target.dataset.severity);
                // Update active state
                filters.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            });
            filters.appendChild(btn);
        });

        summarySection.style.display = 'block';

        // Top priority fixes
        const priorityList = document.getElementById('priority-list');
        priorityList.innerHTML = '';
        const fixes = Array.isArray(data.topPriorityFixes) ? data.topPriorityFixes.slice(0, 3) : [];
        fixes.forEach(fix => {
            const card = document.createElement('div');
            card.className = 'priority-card';
            card.innerHTML = `
                <div class="priority-title">${this.escapeHtml(fix.title || '')}</div>
                <div class="priority-why">${this.escapeHtml(fix.whyItMatters || '')}</div>
                <div class="priority-fix"><strong>Fix:</strong> ${this.escapeHtml(fix.fix || '')}</div>
                <div class="priority-validate"><strong>Validate:</strong> ${this.escapeHtml(fix.howToValidate || '')}</div>
            `;
            priorityList.appendChild(card);
        });
        prioritySection.style.display = fixes.length ? 'block' : 'none';

        // Issues list
        const issuesList = document.getElementById('issues-list');
        issuesList.innerHTML = '';
        const issues = Array.isArray(data.issues) ? data.issues : [];

        // Normalize major → critical
        issues.forEach(iss => {
            if (iss.severity === 'major') iss.severity = 'critical';
        });

        // Group by severity order (3 tiers)
        const order = ['critical', 'minor', 'suggestion'];
        issues.sort((a, b) => order.indexOf(a.severity || 'minor') - order.indexOf(b.severity || 'minor'));

        issues.forEach(issue => {
            const item = document.createElement('div');
            const sev = (issue.severity || 'minor').toLowerCase();
            const itemClass = sev === 'critical' ? 'error' : (sev === 'suggestion' ? 'info' : 'warning');
            item.className = `finding-item ${itemClass}`;
            item.dataset.severity = sev;
            const impacted = Array.isArray(issue.impactedElements) ? issue.impactedElements.join(', ') : '';
            const tags = Array.isArray(issue.tags) ? issue.tags.map(t => `<span class="tag tag-info" style="margin-right:4px;">${this.escapeHtml(t)}</span>`).join(' ') : '';
            item.innerHTML = `
                <div class="finding-icon">!</div>
                <div class="finding-content">
                    <div class="finding-title">${this.escapeHtml(issue.title || '')}</div>
                    <p class="finding-description">${this.escapeHtml(issue.description || '')}</p>
                    ${impacted ? `<p class="finding-description"><strong>Elements:</strong> ${this.escapeHtml(impacted)}</p>` : ''}
                    ${issue.recommendation ? `<p class="finding-description"><strong>Recommendation:</strong> ${this.escapeHtml(issue.recommendation)}</p>` : ''}
                    ${issue.bestPracticeRef ? `<p class="finding-description"><strong>Best practice:</strong> ${this.escapeHtml(issue.bestPracticeRef)}</p>` : ''}
                    ${tags}
                </div>
            `;
            issuesList.appendChild(item);
        });

        issuesSection.style.display = issues.length ? 'block' : 'none';

        // Use analysis-content area for overview/strengths if provided
        const analysisContent = document.getElementById('analysis-content');
        let overviewHtml = '';
        if (data.diagramOverview) {
            overviewHtml += `<h3>Diagram Overview</h3><p>${this.escapeHtml(data.diagramOverview)}</p>`;
        }
        if (Array.isArray(data.strengths) && data.strengths.length) {
            overviewHtml += '<h3>What’s Done Well</h3><ul>' + data.strengths.map(s => `<li>${this.escapeHtml(s)}</li>`).join('') + '</ul>';
        }
        if (data.summary) {
            overviewHtml += `<h3>Summary</h3><p>${this.escapeHtml(data.summary)}</p>`;
        }
        analysisContent.innerHTML = overviewHtml || '<p>No additional summary.</p>';
    }

    filterIssuesBySeverity(sev) {
        const issuesSection = document.getElementById('issues-section');
        const issuesList = document.getElementById('issues-list');
        if (!issuesList || !issuesSection) return;

        // Scroll to issues section smoothly
        issuesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        const items = issuesList.querySelectorAll('.finding-item');
        let visibleCount = 0;

        items.forEach(el => {
            const itemSev = el.dataset.severity || '';
            const isMatch = itemSev === sev;
            el.style.display = isMatch ? '' : 'none';
            if (isMatch) {
                visibleCount++;
                el.classList.add('highlight');
                setTimeout(() => el.classList.remove('highlight'), 1500);
            }
        });

        // Show friendly message if no matches
        let msg = issuesList.querySelector('.filter-message');
        if (!msg) {
            msg = document.createElement('div');
            msg.className = 'filter-message';
            issuesList.prepend(msg);
        }
        if (visibleCount === 0) {
            msg.textContent = `No ${sev} issues found.`;
            msg.style.display = 'block';
        } else {
            msg.style.display = 'none';
        }
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

    escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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

        // Reset results
        this.showEmptyState();

        showToast('Reset complete.', 'info');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.bpmnCheckerApp = new BPMNCheckerApp();
});
