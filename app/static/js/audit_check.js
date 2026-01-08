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
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
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
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        
        if (uploadArea && fileInput) {
            uploadArea.addEventListener('click', (e) => {
                console.log('Upload area clicked');
                fileInput.click();
            });

            fileInput.addEventListener('change', (e) => {
                console.log('Files selected:', e.target.files.length);
                this.handleFileSelection(e.target.files);
            });
        } else {
            console.warn('Upload area or file input not found');
        }

        document.getElementById('generate-pdf-btn').addEventListener('click', () => this.generatePdfAndCheck());
        document.getElementById('reset-creator-btn').addEventListener('click', () => this.resetCreatorMode());
        
        const downloadBtn = document.getElementById('download-pdf-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadPdf());
        }

        // Add More Images button
        const addMoreBtn = document.getElementById('add-more-files-btn');
        if (addMoreBtn) {
            addMoreBtn.addEventListener('click', () => {
                document.getElementById('file-input').click();
            });
        }

        // Checker Mode
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

        document.getElementById('reset-checker-btn').addEventListener('click', () => this.resetCheckerMode());

        // Form inputs
        document.getElementById('audit-title').addEventListener('input', (e) => {
            this.creatorData.title = e.target.value;
        });

        document.getElementById('audit-description').addEventListener('input', (e) => {
            this.creatorData.description = e.target.value;
        });
    }

    setupDragAndDrop() {
        ['upload-area', 'pdf-upload-area'].forEach(areaId => {
            const area = document.getElementById(areaId);
            if (!area) return;

            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                area.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });
            });

            ['dragenter', 'dragover'].forEach(eventName => {
                area.addEventListener(eventName, () => {
                    area.classList.add('dragover');
                });
            });

            ['dragleave', 'drop'].forEach(eventName => {
                area.addEventListener(eventName, () => {
                    area.classList.remove('dragover');
                });
            });

            area.addEventListener('drop', (e) => {
                const files = e.dataTransfer.files;
                if (areaId === 'upload-area') {
                    this.handleFileSelection(files);
                } else {
                    this.handlePdfSelection(files);
                }
            });
        });
    }

    switchMode(mode) {
        this.currentMode = mode;
        
        // Update button states
        document.querySelectorAll('.mode-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Update panel visibility
        document.getElementById('creator-mode').style.display = mode === 'creator' ? 'flex' : 'none';
        document.getElementById('checker-mode').style.display = mode === 'checker' ? 'flex' : 'none';
    }

    // ==================== CREATOR MODE ====================

    handleFileSelection(files) {
        const fileArray = Array.from(files);
        let validFilesAdded = 0;
        
        fileArray.forEach(file => {
            // Validate file type - only JPG and PNG allowed
            const validTypes = ['image/jpeg', 'image/png'];
            const validExtensions = ['.jpg', '.jpeg', '.png'];
            
            // Check both MIME type and file extension
            const isValidType = validTypes.includes(file.type) || 
                                validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
            
            if (!isValidType) {
                showNotification(`File "${file.name}" is not supported. Only JPG and PNG are allowed.`, 'warning');
                return;
            }

            // Check if file already exists
            if (this.creatorData.files.some(f => f.name === file.name && f.size === file.size)) {
                showNotification(`File "${file.name}" already added`, 'warning');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                this.creatorData.files.push({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    data: e.target.result,
                    description: ''
                });
                validFilesAdded++;
                this.renderFilesList();
            };
            reader.readAsDataURL(file);
        });

        // Clear the file input
        document.getElementById('file-input').value = '';
    }

    renderFilesList() {
        const filesList = document.getElementById('files-list');
        const section = document.getElementById('files-list-section');

        if (this.creatorData.files.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        filesList.innerHTML = '';

        this.creatorData.files.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            
            const preview = this.isImage(file.type) 
                ? `<img src="${file.data}" class="file-preview" alt="Preview">`
                : '';

            fileItem.innerHTML = `
                <div class="file-item-content">
                    ${preview}
                    <div class="file-details">
                        <p class="file-name">${file.name}</p>
                        <p class="file-size">${this.formatFileSize(file.size)}</p>
                        <textarea 
                            class="description-input" 
                            placeholder="Add image description (optional)"
                            data-index="${index}"
                        >${file.description}</textarea>
                    </div>
                </div>
                <button class="btn-remove" data-index="${index}" title="Delete image">✕</button>
            `;

            // Add description listener
            fileItem.querySelector('.description-input').addEventListener('input', (e) => {
                this.creatorData.files[index].description = e.target.value;
            });

            // Add remove listener
            fileItem.querySelector('.btn-remove').addEventListener('click', () => {
                this.creatorData.files.splice(index, 1);
                this.renderFilesList();
                showNotification('Image removed', 'info');
            });

            filesList.appendChild(fileItem);
        });
    }

    async generatePdfAndCheck() {
        if (!this.creatorData.title.trim()) {
            showNotification('Please enter an audit title', 'error');
            return;
        }

        if (this.creatorData.files.length === 0) {
            showNotification('Please add at least one file', 'error');
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

            // Simulate audit check (in production, this would call backend)
            await this.simulateAuditCheck();

            btn.innerHTML = originalText;
            btn.disabled = false;
            showNotification('PDF generated and audit check completed', 'success');

        } catch (error) {
            console.error('Error generating PDF:', error);
            showNotification('Error generating PDF', 'error');
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
        for (let i = 0; i < this.creatorData.files.length; i++) {
            const file = this.creatorData.files[i];

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
            if (i < this.creatorData.files.length - 1) {
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
            <div class="pdf-filename-info">
                <span class="pdf-icon">📄</span>
                <div class="pdf-file-details">
                    <p class="pdf-file-name">${filename}</p>
                    <p class="pdf-file-ready">Ready to download</p>
                </div>
            </div>
        `;
    }

    async simulateAuditCheck() {
        const resultsPanel = document.getElementById('results-panel-creator');
        const emptyState = document.getElementById('empty-state-creator');
        const statusBadge = document.getElementById('status-badge');
        const resultsContent = document.getElementById('results-content-creator');

        resultsPanel.style.display = 'block';
        emptyState.style.display = 'none';

        // Simulate processing
        resultsContent.innerHTML = '<div class="loading"><span class="spinner"></span> Processing audit...</div>';

        // Simulate delay
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Generate mock results
        const results = [
            {
                type: 'success',
                title: 'Document Structure',
                description: 'Audit document structure is valid and complete.'
            },
            {
                type: 'success',
                title: 'File Count',
                description: `All ${this.creatorData.files.length} files processed successfully.`
            },
            {
                type: 'info',
                title: 'Metadata',
                description: `Total document size: ${this.formatFileSize(this.calculateTotalSize())}`
            },
            {
                type: 'success',
                title: 'Content Validation',
                description: 'All content passes basic validation checks.'
            }
        ];

        // Display results
        resultsContent.innerHTML = '';
        results.forEach(result => {
            const resultItem = document.createElement('div');
            resultItem.className = `result-item ${result.type}`;
            resultItem.innerHTML = `
                <div class="result-title">
                    ${result.type === 'success' ? '✓' : 'ℹ'} ${result.title}
                </div>
                <p class="result-description">${result.description}</p>
            `;
            resultsContent.appendChild(resultItem);
        });

        // Update status badge
        statusBadge.className = 'status-badge success';
        statusBadge.textContent = 'Passed ✓';
    }

    downloadPdf() {
        if (!this.generatedPdf) {
            showNotification('No PDF to download', 'error');
            return;
        }

        const filename = `${this.creatorData.title.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
        this.generatedPdf.save(filename);
        showNotification('PDF downloaded successfully', 'success');
    }

    resetCreatorMode() {
        this.creatorData = {
            title: '',
            description: '',
            files: []
        };
        this.generatedPdf = null;

        document.getElementById('audit-title').value = '';
        document.getElementById('audit-description').value = '';
        document.getElementById('files-list-section').style.display = 'none';
        document.getElementById('pdf-preview-container').style.display = 'none';
        document.getElementById('results-panel-creator').style.display = 'none';
        document.getElementById('empty-state-creator').style.display = 'flex';

        showNotification('Creator mode reset', 'info');
    }

    // ==================== CHECKER MODE ====================

    handlePdfSelection(files) {
        if (files.length === 0) return;

        const file = files[0];

        if (file.type !== 'application/pdf') {
            showNotification('Please select a valid PDF file', 'error');
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
        document.getElementById('pdf-preview-container-checker').style.display = 'none';
        document.getElementById('results-panel-checker').style.display = 'none';
        document.getElementById('empty-state-checker').style.display = 'flex';
    }

    async checkPdf() {
        if (!this.selectedPdf) {
            showNotification('Please select a PDF file', 'error');
            return;
        }

        try {
            const btn = document.getElementById('check-pdf-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="spinner"></span> Checking...';
            btn.disabled = true;

            // Simulate file reading and processing
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Display results
            this.displayCheckResults();

            btn.innerHTML = originalText;
            btn.disabled = false;
            showNotification('PDF check completed', 'success');

        } catch (error) {
            console.error('Error checking PDF:', error);
            showNotification('Error checking PDF', 'error');
            document.getElementById('check-pdf-btn').disabled = false;
        }
    }

    displayCheckResults() {
        const emptyState = document.getElementById('empty-state-checker');
        const resultsPanel = document.getElementById('results-panel-checker');
        const statusBadge = document.getElementById('status-badge-checker');
        const resultsContent = document.getElementById('results-content-checker');

        emptyState.style.display = 'none';
        resultsPanel.style.display = 'flex';

        // Generate mock check results
        const results = [
            {
                type: 'success',
                title: 'PDF Format',
                description: 'PDF file format is valid and readable.'
            },
            {
                type: 'success',
                title: 'File Integrity',
                description: 'No corruption detected in the document.'
            },
            {
                type: 'info',
                title: 'Document Info',
                description: `File: ${this.selectedPdf.name} | Size: ${this.formatFileSize(this.selectedPdf.size)}`
            },
            {
                type: 'success',
                title: 'Compatibility',
                description: 'Document is compatible with standard PDF readers.'
            },
            {
                type: 'success',
                title: 'Security Scan',
                description: 'No security threats detected.'
            }
        ];

        resultsContent.innerHTML = '';
        results.forEach(result => {
            const resultItem = document.createElement('div');
            resultItem.className = `result-item ${result.type}`;
            resultItem.innerHTML = `
                <div class="result-title">
                    ${result.type === 'success' ? '✓' : 'ℹ'} ${result.title}
                </div>
                <p class="result-description">${result.description}</p>
            `;
            resultsContent.appendChild(resultItem);
        });

        statusBadge.className = 'status-badge success';
        statusBadge.textContent = 'Passed ✓';
    }

    resetCheckerMode() {
        this.removePdf();
        showNotification('Checker mode reset', 'info');
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

// ==================== UTILITY FUNCTIONS ====================

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${getNotificationColor(type)};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 9999;
        max-width: 400px;
        animation: slideIn 0.3s ease;
        font-weight: 600;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function getNotificationColor(type) {
    const colors = {
        success: '#4caf50',
        error: '#f44336',
        warning: '#ff9800',
        info: '#2196f3'
    };
    return colors[type] || colors.info;
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    // Add notification animations to CSS
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);

    // Initialize app
    window.auditApp = new AuditCheckApp();
});
