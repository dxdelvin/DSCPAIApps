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

    displayResults(analysis) {
        this.showResultsState();

        // Extract score from analysis
        const score = this.extractScore(analysis);

        // Update score display
        this.updateScoreDisplay(score);

        // Render the full analysis directly
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

        // Reset results
        this.showEmptyState();

        showToast('Reset complete.', 'info');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.bpmnCheckerApp = new BPMNCheckerApp();
});
