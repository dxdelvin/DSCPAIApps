// ============================================
// AUDIT CHECK - Main JavaScript
// ============================================

class AuditCheckApp {
    constructor() {
        this.currentMode = 'creator';
        this.creatorData = {
            title: '',
            description: '',
            files: []
        };
        this.selectedPdf = null;
        this.chatHistoryId = null; // Deprecated: no follow-up chat in audit
        this.init();
    }

    init() {
        this.setupImageUpload();
        this.setupEventListeners();
        this.setupPdfDragAndDrop();
        this.switchMode(this.currentMode);
    }

    // ==================== IMAGE UPLOAD (standalone) ====================

    setupImageUpload() {
        const dropArea  = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        if (!dropArea || !fileInput) return;

        let dragCounter = 0;

        // Click to open picker
        dropArea.addEventListener('click', () => fileInput.click());

        // File-input change
        fileInput.addEventListener('change', () => {
            this.handleImageFiles(Array.from(fileInput.files));
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
            const valid = Array.from(e.dataTransfer.files).filter(f => this.isValidImageFile(f));
            if (valid.length) this.handleImageFiles(valid);
            else showToast('Only .jpg, .jpeg, .png files are supported', 'warning');
        });
    }

    isValidImageFile(file) {
        const validTypes = ['image/jpeg', 'image/png'];
        const validExts  = ['.jpg', '.jpeg', '.png'];
        return validTypes.includes(file.type) || validExts.some(ext => file.name.toLowerCase().endsWith(ext));
    }

    handleImageFiles(newFiles) {
        const MAX = 10;
        const MAX_SIZE = 5 * 1024 * 1024;

        newFiles.forEach(file => {
            if (this.creatorData.files.length >= MAX) { showToast(`Maximum ${MAX} files allowed`, 'warning'); return; }
            if (file.size > MAX_SIZE) { showToast(`${file.name} exceeds 5 MB limit`, 'warning'); return; }
            if (!this.isValidImageFile(file)) { showToast(`${file.name} is not supported`, 'warning'); return; }
            if (this.creatorData.files.some(f => f.name === file.name && f.size === file.size)) { showToast(`${file.name} already added`, 'warning'); return; }

            const reader = new FileReader();
            reader.onload = () => {
                this.creatorData.files.push({ name: file.name, size: file.size, type: file.type, data: reader.result, description: '' });
                this.renderImageFileList();
            };
            reader.readAsDataURL(file);
        });
    }

    renderImageFileList() {
        const section   = document.getElementById('files-list-section');
        const container = document.getElementById('files-list');
        if (!container) return;

        if (section) section.style.display = this.creatorData.files.length ? 'block' : 'none';
        container.innerHTML = '';

        let dragSrcIdx = null;

        this.creatorData.files.forEach((file, idx) => {
            const item = document.createElement('div');
            item.className = 'file-item';
            item.draggable = true;

            const isImg = file.type.startsWith('image/');
            const preview = isImg ? `<img src="${file.data}" class="file-preview" alt="Preview">` : '';

            item.innerHTML = `
                <div class="file-item-content">
                    ${preview}
                    <div class="file-details">
                        <p class="file-name">${this.escText(file.name)}</p>
                        <p class="file-size">${this.formatFileSize(file.size)}</p>
                        <textarea class="description-input" placeholder="Add image description (optional)" data-index="${idx}">${this.escText(file.description)}</textarea>
                    </div>
                </div>
                <button type="button" class="btn-remove-file" title="Remove">✕</button>
            `;

            // Description sync
            const textarea = item.querySelector('.description-input');
            if (textarea) textarea.addEventListener('input', e => { this.creatorData.files[idx].description = e.target.value; });

            // Remove
            item.querySelector('.btn-remove-file').addEventListener('click', e => {
                e.stopPropagation();
                this.creatorData.files.splice(idx, 1);
                this.renderImageFileList();
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
                    const [moved] = this.creatorData.files.splice(dragSrcIdx, 1);
                    this.creatorData.files.splice(idx, 0, moved);
                    this.renderImageFileList();
                }
                container.querySelectorAll('.file-item').forEach(el => el.classList.remove('drag-over'));
            });

            container.appendChild(item);
        });
    }

    escText(text) {
        if (!text) return '';
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    setupEventListeners() {
        // Mode switching
        document.querySelectorAll('.mode-tab').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchMode(e.target.closest('.mode-tab').dataset.mode));
        });

        // Reset All button (if exists)
        const resetAllBtn = document.getElementById('resetAllBtn');
        if (resetAllBtn) {
            resetAllBtn.addEventListener('click', () => {
                if (this.currentMode === 'creator') {
                    this.resetCreatorMode();
                } else {
                    this.resetCheckerMode();
                }
            });
        }

        // Creator Mode
        document.getElementById('generate-pdf-btn').addEventListener('click', () => this.generatePdfAndCheck());
        document.getElementById('reset-creator-btn').addEventListener('click', () => {
            showConfirmation(
                'Clear All Data?',
                'Are you sure you want to clear all images and data? This cannot be undone.',
                () => this.resetCreatorMode(),
                {
                    icon: '⚠️',
                    confirmText: 'Clear Data',
                    cancelText: 'Cancel'
                }
            );
        });
        
        const downloadBtn = document.getElementById('download-pdf-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadPdf());
        }

        // Add More Images button → open zone's file picker
        const addMoreBtn = document.getElementById('add-more-files-btn');
        if (addMoreBtn) {
            addMoreBtn.addEventListener('click', () => {
                document.getElementById('file-input').click();
            });
        }
        
        const pdfUploadArea = document.getElementById('pdf-upload-area');
        const pdfFileInput = document.getElementById('pdf-file-input');
        
        if (pdfUploadArea && pdfFileInput) {
            pdfUploadArea.addEventListener('click', () => {
                pdfFileInput.click();
            });

            pdfFileInput.addEventListener('change', (e) => {
                this.handlePdfSelection(e.target.files);
            });
        }

        const checkBtn = document.getElementById('check-pdf-btn');
        if (checkBtn) {
            checkBtn.addEventListener('click', () => this.checkPdf());
        }

        const removePdfBtn = document.getElementById('remove-pdf-btn');
        if (removePdfBtn) {
            removePdfBtn.addEventListener('click', () => this.removePdf());
        }

        document.getElementById('reset-checker-btn').addEventListener('click', () => {
            showConfirmation(
                'Clear All Data?',
                'Are you sure you want to clear the PDF and results? This cannot be undone.',
                () => this.resetCheckerMode(),
                {
                    icon: '⚠️',
                    confirmText: 'Clear Data',
                    cancelText: 'Cancel'
                }
            );
        });

        // Form inputs
        document.getElementById('audit-title').addEventListener('input', (e) => {
            this.creatorData.title = e.target.value;
        });

        document.getElementById('audit-description').addEventListener('input', (e) => {
            this.creatorData.description = e.target.value;
        });
    }

    setupPdfDragAndDrop() {
        const area = document.getElementById('pdf-upload-area');
        if (!area) return;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt =>
            area.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); })
        );
        ['dragenter', 'dragover'].forEach(evt =>
            area.addEventListener(evt, () => area.classList.add('dragover'))
        );
        ['dragleave', 'drop'].forEach(evt =>
            area.addEventListener(evt, () => area.classList.remove('dragover'))
        );
        area.addEventListener('drop', e => this.handlePdfSelection(e.dataTransfer.files));
    }

    switchMode(mode) {
        this.currentMode = mode;
        
        // Update button states
        document.querySelectorAll('.mode-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Update panel visibility
        document.querySelectorAll('.mode-panel').forEach(panel => {
            const isActive = panel.id === `${mode}-mode`;
            panel.classList.toggle('active', isActive);
            panel.style.display = isActive ? 'flex' : 'none';
        });
    }

    // ==================== CREATOR MODE ====================

    async generatePdfAndCheck() {
        // Sync latest form values to state to avoid stale data
        const titleInput = document.getElementById('audit-title');
        const descInput = document.getElementById('audit-description');
        if (titleInput) this.creatorData.title = titleInput.value || '';
        if (descInput) this.creatorData.description = descInput.value || '';

        if (!this.creatorData.title.trim()) {
            showToast('Please enter an audit title', 'error');
            return;
        }

        if (this.creatorData.files.length === 0) {
            showToast('Please add at least one file', 'error');
            return;
        }

        try {
            // Show loading state
            const btn = document.getElementById('generate-pdf-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="spinner"></span> Generating...';
            btn.disabled = true;

            // Generate PDF
            const pdfDoc = await this.createPdf();

            // Display preview
            this.displayPdfPreview();

            // Send generated PDF to Audit Brain
            await this.runCreatorAuditCheck(pdfDoc);

            btn.innerHTML = originalText;
            btn.disabled = false;
            showToast('PDF generated and audit check completed', 'success');

        } catch (error) {
            console.error('Error generating PDF:', error);
            showToast('Error generating PDF', 'error');
            document.getElementById('generate-pdf-btn').disabled = false;
        }
    }

    async createPdf() {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF();
        let yPosition = 20;
        const pageHeight = pdf.internal.pageSize.getHeight();
        const pageWidth = pdf.internal.pageSize.getWidth();
        const margin = 15;
        const contentWidth = pageWidth - (margin * 2);

        // Add title
        pdf.setFontSize(24);
        pdf.setTextColor(102, 126, 234);
        const titleLines = pdf.splitTextToSize(this.creatorData.title, contentWidth);
        pdf.text(titleLines, margin, yPosition);
        yPosition += titleLines.length * 10 + 10;

        // Add description
        if (this.creatorData.description.trim()) {
            pdf.setFontSize(12);
            pdf.setTextColor(100, 100, 100);
            const descLines = pdf.splitTextToSize(this.creatorData.description, contentWidth);
            pdf.text(descLines, margin, yPosition);
            yPosition += descLines.length * 7 + 15;
        }

        // Add files with alternating description and image format
        const uploadedFiles = this.creatorData.files;
        for (let i = 0; i < uploadedFiles.length; i++) {
            const file = uploadedFiles[i];

            // Check if we need a new page
            if (yPosition > pageHeight - 80) {
                pdf.addPage();
                yPosition = 20;
            }

            // Add file description first if exists
            if (file.description.trim()) {
                pdf.setFontSize(11);
                pdf.setTextColor(50, 50, 50);
                const descLines = pdf.splitTextToSize(`Image ${i + 1} Description: ${file.description}`, contentWidth);
                pdf.text(descLines, margin, yPosition);
                yPosition += descLines.length * 6 + 8;
            }

            // Add image if it's an image file
            if (this.isImage(file.type)) {
                // Check if we need a new page for the image
                if (yPosition > pageHeight - 70) {
                    pdf.addPage();
                    yPosition = 20;
                }

                try {
                    const img = new Image();
                    img.src = file.data;
                    
                    // Calculate image dimensions to fit page
                    const maxWidth = contentWidth;
                    const maxHeight = pageHeight - yPosition - 20;
                    
                    let imgWidth = maxWidth;
                    let imgHeight = (img.height * maxWidth) / img.width;

                    if (imgHeight > maxHeight) {
                        imgHeight = maxHeight;
                        imgWidth = (img.width * maxHeight) / img.height;
                    }

                    // Detect image format - default to JPEG, but support PNG
                    let imageFormat = 'JPEG';
                    if (file.type === 'image/png') {
                        imageFormat = 'PNG';
                    }

                    // Add image to PDF
                    pdf.addImage(file.data, imageFormat, margin, yPosition, imgWidth, imgHeight);
                    yPosition += imgHeight + 15;

                } catch (error) {
                    console.error('Error adding image:', error);
                }
            }

            // Add separator between items
            if (i < uploadedFiles.length - 1) {
                if (yPosition > pageHeight - 30) {
                    pdf.addPage();
                    yPosition = 20;
                } else {
                    pdf.setDrawColor(200, 200, 200);
                    pdf.line(margin, yPosition, pageWidth - margin, yPosition);
                    yPosition += 10;
                }
            }
        }

        // Store PDF for download
        this.generatedPdf = pdf;
        return pdf;
    }

    displayPdfPreview() {
        const container = document.getElementById('pdf-preview-container');
        const content = document.getElementById('pdf-content');
        const emptyState = document.getElementById('empty-state-creator');

        container.style.display = 'block';
        emptyState.style.display = 'none';

        // Show only the filename, no preview content
        const filename = `${this.creatorData.title.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
        content.innerHTML = `
            <div class="pdf-filename-info" id="pdf-download-box">
                <span class="pdf-icon">📄</span>
                <div class="pdf-file-details">
                    <p class="pdf-file-name">${filename}</p>
                    <p class="pdf-file-ready">Click to download</p>
                </div>
            </div>
        `;
        const statusEl = document.getElementById('pdf-status');
        if (statusEl) statusEl.textContent = 'READY';
        
        // Make PDF box clickable to download
        const pdfBox = content.querySelector('#pdf-download-box');
        if (pdfBox) {
            pdfBox.addEventListener('click', () => this.downloadPdf());
            pdfBox.style.cursor = 'pointer';
        }
    }

    async runCreatorAuditCheck(pdfDoc) {
        const resultsPanel = document.getElementById('results-panel-creator');
        const emptyState = document.getElementById('empty-state-creator');
        const statusBadge = document.getElementById('status-badge');
        const resultsContent = document.getElementById('results-content-creator');

        resultsPanel.style.display = 'block';
        emptyState.style.display = 'none';
        resultsContent.innerHTML = '<div class="loading"><span class="spinner"></span> Analyzing with Audit Brain...</div>';
        statusBadge.className = 'status-badge info';
        statusBadge.textContent = 'Analyzing...';

        try {
            const filename = `${this.creatorData.title.replace(/\s+/g, '_') || 'audit'}_${Date.now()}.pdf`;
            const pdfBlob = pdfDoc.output('blob');
            const formData = new FormData();
            formData.append('file', pdfBlob, filename);

            const response = await fetch('/api/audit-doc-check', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok || result.status !== 'success') {
                statusBadge.className = 'status-badge error';
                statusBadge.textContent = 'Error';
                resultsContent.innerHTML = `<div class="result-item error">Failed to analyze document. ${result.detail || ''}</div>`;
                const detail = sanitizeDetail(result.detail);
                showToast(detail || 'Audit Brain error', 'error');
                return;
            }

            // Format and display results only (no follow-up chat)
            this.chatHistoryId = null;
            resultsContent.innerHTML = this.formatAnalysisResult(result.analysis);

            statusBadge.className = 'status-badge success';
            statusBadge.textContent = 'Complete';
        } catch (error) {
            console.error('Error sending PDF to Audit Brain:', error);
            statusBadge.className = 'status-badge error';
            statusBadge.textContent = 'Error';
            resultsContent.innerHTML = '<div class="result-item error">Connection failed. Please try again.</div>';
            showToast('Error sending PDF to Audit Brain', 'error');
        }
    }
    
    formatAnalysisResult(text) {
        if (!text) return '<div class="result-item">No analysis available.</div>';
        
        // Convert markdown-style formatting to HTML
        let formatted = text
            // Headers
            .replace(/^## (.+)$/gm, '<h4 class="result-heading">$1</h4>')
            .replace(/^### (.+)$/gm, '<h5 class="result-subheading">$1</h5>')
            // Bold text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // Tables (basic support)
            .replace(/\|(.+)\|/g, (match) => {
                const cells = match.split('|').filter(c => c.trim());
                if (cells.every(c => c.trim().match(/^[-]+$/))) {
                    return ''; // Skip separator rows
                }
                return `<tr>${cells.map(c => `<td>${c.trim()}</td>`).join('')}</tr>`;
            })
            // Bullet points
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            // Numbered lists
            .replace(/^\d+\. (.+)$/gm, '<li class="numbered">$1</li>')
            // Line breaks
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
        
        // Wrap consecutive <li> elements in <ul>
        formatted = formatted.replace(/(<li[^>]*>.*?<\/li>)+/gs, (match) => {
            const isNumbered = match.includes('class="numbered"');
            const tag = isNumbered ? 'ol' : 'ul';
            return `<${tag} class="result-list">${match}</${tag}>`;
        });
        
        // Wrap <tr> elements in <table>
        formatted = formatted.replace(/(<tr>.*?<\/tr>)+/gs, (match) => {
            return `<table class="result-table">${match}</table>`;
        });
        
        return `<div class="result-formatted">${formatted}</div>`;
    }
    
    // Follow-up chat UI removed for audit; no chat interface rendered

    downloadPdf() {
        if (!this.generatedPdf) {
            showToast('No PDF to download', 'error');
            return;
        }

        const filename = `${this.creatorData.title.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
        this.generatedPdf.save(filename);
        showToast('PDF downloaded successfully', 'success');
    }

    resetCreatorMode() {
        this.creatorData = {
            title: '',
            description: '',
            files: []
        };
        this.renderImageFileList();
        this.generatedPdf = null;
        this.chatHistoryId = null;

        document.getElementById('audit-title').value = '';
        document.getElementById('audit-description').value = '';
        document.getElementById('pdf-preview-container').style.display = 'none';
        document.getElementById('results-panel-creator').style.display = 'none';
        document.getElementById('empty-state-creator').style.display = 'flex';

        showToast('Creator mode reset', 'info');
    }

    // ==================== CHECKER MODE ====================

    handlePdfSelection(files) {
        if (files.length === 0) return;

        const file = files[0];

        if (file.type !== 'application/pdf') {
            showToast('Please select a valid PDF file', 'error');
            return;
        }

        this.selectedPdf = {
            name: file.name,
            size: file.size,
            file: file
        };

        this.displaySelectedFile();
        document.getElementById('check-pdf-btn').disabled = false;
    }

    displaySelectedFile() {
        const container = document.getElementById('selected-file-info');
        const nameEl = document.getElementById('selected-pdf-name');
        const sizeEl = document.getElementById('selected-pdf-size');

        container.style.display = 'block';
        nameEl.textContent = this.selectedPdf.name;
        sizeEl.textContent = this.formatFileSize(this.selectedPdf.size);
    }

    removePdf() {
        this.selectedPdf = null;
        document.getElementById('selected-file-info').style.display = 'none';
        document.getElementById('pdf-file-input').value = '';
        document.getElementById('check-pdf-btn').disabled = true;
        document.getElementById('results-panel-checker').style.display = 'none';
        document.getElementById('empty-state-checker').style.display = 'flex';
    }

    async checkPdf() {
        if (!this.selectedPdf) {
            showToast('Please select a PDF file', 'error');
            return;
        }

        try {
            const btn = document.getElementById('check-pdf-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="spinner"></span> Checking...';
            btn.disabled = true;
            this.displayCheckLoading();

            const formData = new FormData();
            formData.append('file', this.selectedPdf.file);

            const response = await fetch('/api/audit-doc-check', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok || result.status !== 'success') {
                this.displayCheckError('Error');
                const detail = sanitizeDetail(result.detail);
                showToast(detail || 'Audit Brain error', 'error');
                btn.innerHTML = originalText;
                btn.disabled = false;
                return;
            }

            this.displayCheckResults(result.analysis, result.chatHistoryId);
            btn.innerHTML = originalText;
            btn.disabled = false;
            showToast('PDF analysis completed', 'success');

        } catch (error) {
            console.error('Error checking PDF:', error);
            this.displayCheckError('Not Authenticated');
            showToast('Error checking PDF', 'error');
            document.getElementById('check-pdf-btn').disabled = false;
        }
    }

    displayCheckLoading() {
        const emptyState = document.getElementById('empty-state-checker');
        const resultsPanel = document.getElementById('results-panel-checker');
        const statusBadge = document.getElementById('status-badge-checker');
        const resultsContent = document.getElementById('results-content-checker');

        emptyState.style.display = 'none';
        resultsPanel.style.display = 'flex';
        resultsContent.innerHTML = '<div class="loading"><span class="spinner"></span> Checking with Audit Brain...</div>';
        statusBadge.className = 'status-badge info';
        statusBadge.textContent = 'Checking...';
    }

    displayCheckResults(analysisText, chatHistoryId) {
        const emptyState = document.getElementById('empty-state-checker');
        const resultsPanel = document.getElementById('results-panel-checker');
        const statusBadge = document.getElementById('status-badge-checker');
        const resultsContent = document.getElementById('results-content-checker');

        emptyState.style.display = 'none';
        resultsPanel.style.display = 'flex';

        // Display results only (no follow-up chat)
        this.chatHistoryId = null;
        resultsContent.innerHTML = this.formatAnalysisResult(analysisText || 'No analysis returned.');

        statusBadge.className = 'status-badge success';
        statusBadge.textContent = 'Complete';
    }

    displayCheckError(message) {
        const emptyState = document.getElementById('empty-state-checker');
        const resultsPanel = document.getElementById('results-panel-checker');
        const statusBadge = document.getElementById('status-badge-checker');
        const resultsContent = document.getElementById('results-content-checker');

        emptyState.style.display = 'none';
        resultsPanel.style.display = 'flex';
        statusBadge.className = 'status-badge error';
        statusBadge.textContent = message || 'Error';
        resultsContent.innerHTML = '';
    }

    resetCheckerMode() {
        this.removePdf();
        this.chatHistoryId = null;
        showToast('Checker mode reset', 'info');
    }

    // ==================== UTILITY METHODS ====================

    isImage(mimeType) {
        return mimeType.startsWith('image/');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    calculateTotalSize() {
        return this.creatorData.files.reduce((total, file) => total + file.size, 0);
    }
}

function sanitizeDetail(detail) {
    if (!detail) return '';
    const trimmed = detail.trim();
    return trimmed.startsWith('Auth Error') ? 'Auth Error' : trimmed;
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    // Initialize app
    window.auditApp = new AuditCheckApp();
});
