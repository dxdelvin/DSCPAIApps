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
        this.chatHistoryId = null; // Track audit chat session
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.switchMode(this.currentMode);
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
        document.querySelectorAll('.mode-panel').forEach(panel => {
            const isActive = panel.id === `${mode}-mode`;
            panel.classList.toggle('active', isActive);
            panel.style.display = isActive ? 'flex' : 'none';
        });
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
                showToast(`File "${file.name}" is not supported. Only JPG and PNG are allowed.`, 'warning');
                return;
            }

            // Check if file already exists
            if (this.creatorData.files.some(f => f.name === file.name && f.size === file.size)) {
                showToast(`File "${file.name}" already added`, 'warning');
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
                showToast('Image removed', 'info');
            });

            filesList.appendChild(fileItem);
        });
    }

    async generatePdfAndCheck() {
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

            // Store chat history for follow-up questions
            this.chatHistoryId = result.chatHistoryId;
            
            // Format and display results
            resultsContent.innerHTML = this.formatAnalysisResult(result.analysis);
            
            // Add chat interface for follow-up
            this.addChatInterface(resultsContent, 'creator');

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
    
    addChatInterface(container, mode) {
        const chatHtml = `
            <div class="audit-chat-section">
                <div class="chat-divider">
                    <span>💬 Ask Follow-up Questions</span>
                </div>
                <div class="audit-chat-messages" id="audit-chat-messages-${mode}"></div>
                <div class="audit-chat-input-container">
                    <input type="text" 
                           id="audit-chat-input-${mode}" 
                           class="audit-chat-input" 
                           placeholder="Ask a question about the analysis..."
                           onkeypress="if(event.key==='Enter') window.auditApp.sendAuditChatMessage('${mode}')">
                    <button class="btn btn-primary btn-sm" onclick="window.auditApp.sendAuditChatMessage('${mode}')">
                        Send
                    </button>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', chatHtml);
    }
    
    async sendAuditChatMessage(mode) {
        const input = document.getElementById(`audit-chat-input-${mode}`);
        const messagesContainer = document.getElementById(`audit-chat-messages-${mode}`);
        const message = input?.value?.trim();
        
        if (!message || !this.chatHistoryId) {
            showToast('Please enter a message', 'warning');
            return;
        }
        
        // Add user message to chat
        messagesContainer.insertAdjacentHTML('beforeend', `
            <div class="audit-chat-message user-message">
                <span class="message-label">You:</span>
                <span class="message-text">${this.escapeHtml(message)}</span>
            </div>
        `);
        
        input.value = '';
        input.disabled = true;
        
        // Add loading indicator
        messagesContainer.insertAdjacentHTML('beforeend', `
            <div class="audit-chat-message assistant-loading" id="audit-loading-${mode}">
                <span class="spinner"></span> Thinking...
            </div>
        `);
        
        try {
            const formData = new FormData();
            formData.append('chatHistoryId', this.chatHistoryId);
            formData.append('message', message);
            
            const response = await fetch('/api/audit-chat', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            // Remove loading indicator
            document.getElementById(`audit-loading-${mode}`)?.remove();
            
            if (!response.ok || result.status !== 'success') {
                messagesContainer.insertAdjacentHTML('beforeend', `
                    <div class="audit-chat-message assistant-message error">
                        <span class="message-label">AI:</span>
                        <span class="message-text">Sorry, I encountered an error. Please try again.</span>
                    </div>
                `);
            } else {
                messagesContainer.insertAdjacentHTML('beforeend', `
                    <div class="audit-chat-message assistant-message">
                        <span class="message-label">AI:</span>
                        <div class="message-text">${this.formatAnalysisResult(result.response)}</div>
                    </div>
                `);
            }
            
            // Scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
        } catch (error) {
            document.getElementById(`audit-loading-${mode}`)?.remove();
            messagesContainer.insertAdjacentHTML('beforeend', `
                <div class="audit-chat-message assistant-message error">
                    <span class="message-label">AI:</span>
                    <span class="message-text">Connection failed. Please try again.</span>
                </div>
            `);
        } finally {
            input.disabled = false;
            input.focus();
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

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
        this.generatedPdf = null;
        this.chatHistoryId = null;

        document.getElementById('audit-title').value = '';
        document.getElementById('audit-description').value = '';
        document.getElementById('files-list-section').style.display = 'none';
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
        document.getElementById('pdf-preview-container-checker').style.display = 'none';
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

        // Store chat history for follow-up
        this.chatHistoryId = chatHistoryId;
        
        // Format and display results
        resultsContent.innerHTML = this.formatAnalysisResult(analysisText || 'No analysis returned.');
        
        // Add chat interface for follow-up
        this.addChatInterface(resultsContent, 'checker');

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
