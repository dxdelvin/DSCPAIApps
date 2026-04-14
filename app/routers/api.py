import json
import logging
import os
import re
from typing import Any, Optional, List
from fastapi import APIRouter, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

_LOG_SANITIZE_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
_ALLOWED_LOG_LEVELS = {"debug", "info", "warn", "warning", "error"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB

# Magic-byte signatures for allowed upload types
_FILE_MAGIC: dict[str, bytes] = {
    "pdf":  b"%PDF-",
    "png":  b"\x89PNG\r\n",
    "jpg":  b"\xff\xd8\xff",
    "jpeg": b"\xff\xd8\xff",
}


def _validate_magic(data: bytes, filename: str) -> bool:
    """Return True when the file header matches the extension-declared type."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    sig = _FILE_MAGIC.get(ext)
    return sig is None or data[: len(sig)] == sig

# Import from organized service files
from app.services.common_service import create_chat_history
from app.services.signavio_service import (
    get_signavio_bpmn_xml,
    analyze_process,
    continue_chat as signavio_continue_chat,
    analyze_uploaded_bpmn,
)
from app.services.audit_service import (
    check_audit_document,
    continue_audit_chat,
)
from app.services.bpmn_checker_service import check_bpmn_diagram
from app.services.fs_br_document_service import generate_functional_spec_docx, generate_br_docx, generate_fs_variant_docx
from app.services.ppt_creator_service import (
    extract_pdf_content,
    refine_ppt_content,
    generate_pptx_file,
)
from app.services.diagram_generator_service import (
    analyze_pdf_content as diagram_analyze_pdf,
    generate_diagrams,
    refine_diagram,
    build_drawio_download,
    copy_image_as_diagram,
)
from app.services.confluence_builder_service import (
    generate_confluence_builder_draft,
    refine_confluence_builder_draft,
    publish_confluence_builder_page,
    verify_confluence_connection,
)
from app.services.one_pager_creator_service import (
    extract_one_pager_content,
    refine_one_pager_content,
)
router = APIRouter()

# Request models for better type safety
class BPMNSessionRequest(BaseModel):
    processName: str = Field(default="", max_length=200)
    poolName: str = Field(default="", max_length=200)
    participants: str = Field(default="", max_length=500)
    subLanes: str = Field(default="", max_length=500)
    startTriggers: str = Field(default="", max_length=2000)
    processActivities: str = Field(default="", max_length=5000)
    processEnding: str = Field(default="", max_length=2000)
    intermediateEvents: str = Field(default="", max_length=2000)
    reviewOverride: str = Field(default="", max_length=3000)


class BPMNChatRequest(BaseModel):
    chatHistoryId: str = Field(max_length=200)
    message: str = Field(max_length=5000)
    formData: Optional[dict] = None


class BPMNGenerateRequest(BaseModel):
    chatHistoryId: Optional[str] = Field(default=None, max_length=200)
    processName: str = Field(default="", max_length=200)
    poolName: str = Field(default="", max_length=200)
    participants: str = Field(default="", max_length=500)
    subLanes: str = Field(default="", max_length=500)
    startTriggers: str = Field(default="", max_length=2000)
    processActivities: str = Field(default="", max_length=5000)
    processEnding: str = Field(default="", max_length=2000)
    intermediateEvents: str = Field(default="", max_length=2000)
    reviewOverride: str = Field(default="", max_length=3000)


class ClientLogRequest(BaseModel):
    level: str = Field(default="error", max_length=20)
    message: str = Field(default="", max_length=5000)
    metadata: Optional[str] = Field(default=None, max_length=10000)
    path: Optional[str] = Field(default=None, max_length=500)
    userAgent: Optional[str] = Field(default=None, max_length=500)
    ts: Optional[str] = Field(default=None, max_length=50)


@router.post("/client-log")
async def client_log(payload: ClientLogRequest, request: Request):
    """Collect frontend logs for production diagnostics."""
    level = (payload.level or "error").upper()
    if level.lower() not in _ALLOWED_LOG_LEVELS:
        level = "ERROR"
    message = _LOG_SANITIZE_RE.sub('', payload.message or '')[:2000]
    path = _LOG_SANITIZE_RE.sub('', payload.path or request.url.path)[:500]
    metadata = _LOG_SANITIZE_RE.sub('', payload.metadata or '')[:2000] if payload.metadata else None
    ip = request.client.host if request.client else "unknown"
    print(f"[CLIENT][{level}] {path} {message} | ip={ip}")
    if metadata:
        print(f"[CLIENT][META] {metadata}")
    return {"status": "ok"}


# ============== BPMN Chat Flow API Endpoints ==============

@router.post("/bpmn/start-session")
async def start_bpmn_session(data: BPMNSessionRequest):
    """Start a new BPMN chat session: create chat history and get initial analysis."""
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    if not brain_id:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": "SIGNAVIO_BRAIN_ID is not configured.",
            },
        )

    # Create a new chat history for this session
    chat_result = await create_chat_history(brain_id)
    if chat_result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": chat_result.get("message", "Failed to start session"),
                "detail": chat_result.get("detail", "Could not create chat history."),
            },
        )

    chat_history_id = chat_result.get("chatHistoryId")
    
    # Get initial analysis using the signavio service
    response = await analyze_process(data.model_dump(), chat_history_id)

    if response.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": response.get("detail", "Brain authentication failed."),
            },
        )

    return {
        "status": "success",
        "chatHistoryId": chat_history_id,
        "analysis": response.get("result")
    }


@router.post("/bpmn/chat")
async def bpmn_chat(data: BPMNChatRequest):
    """Continue the BPMN chat conversation with follow-up messages."""
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    if not brain_id:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": "SIGNAVIO_BRAIN_ID is not configured.",
            },
        )

    if not data.chatHistoryId:
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "Missing chat session",
                "detail": "Please start a new session first.",
            },
        )

    # Use the signavio service to continue the chat
    response = await signavio_continue_chat(data.chatHistoryId, data.message, data.formData)

    if response.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": response.get("detail", "Brain authentication failed."),
            },
        )

    return {
        "status": "success",
        "chatHistoryId": data.chatHistoryId,
        "response": response.get("result")
    }


@router.post("/bpmn/upload-analyze")
async def bpmn_upload_analyze(file: UploadFile = File(...)):
    """Analyze an uploaded BPMN diagram or process image/PDF."""
    _BPMN_EXTS = (".png", ".jpg", ".jpeg", ".pdf")
    # Validate by extension — content_type header is client-controlled
    if not (file.filename or "").lower().endswith(_BPMN_EXTS):
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "Invalid file type",
                "detail": "Please upload a PNG, JPG, or PDF file.",
            },
        )

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": "File too large", "detail": "Maximum file size is 10 MB."},
        )
    if not _validate_magic(contents, file.filename or ""):
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": "Invalid file", "detail": "File content does not match its declared type."},
        )
    await file.seek(0)

    result = await analyze_uploaded_bpmn(file)

    if result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Connection to Brain failed."),
            },
        )

    return {
        "status": "success",
        "analysis": result.get("result"),
        "chatHistoryId": result.get("chatHistoryId"),
        "document_valid": result.get("document_valid", True),
    }


@router.post("/generate-bpmn")
async def generate_bpmn(data: BPMNGenerateRequest):
    """Generate BPMN XML, optionally using existing chat history for context."""
    result = await get_signavio_bpmn_xml(
        data.model_dump(), 
        chat_history_id=data.chatHistoryId
    )

    if result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Connection to Brain failed."),
            },
        )

    process_name = data.processName or "bpmn_diagram"
    filename = f"{process_name.replace(' ', '_')}.xml"

    return {"status": "success", "xml": result.get("result"), "filename": filename}


# Legacy endpoint for backward compatibility
@router.post("/make-bpmn-analysis")
async def make_bpmn_analysis(data: dict):
    """Ask the Signavio Brain to summarize its understanding of the provided process inputs.
    
    Note: This is a legacy endpoint. Use /api/bpmn/start-session for new implementations.
    """
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    if not brain_id:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": "SIGNAVIO_BRAIN_ID is not configured.",
            },
        )

    response = await analyze_process(data)

    if response.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": response.get("detail", "Brain authentication failed."),
            },
        )

    return {
        "status": "success", 
        "analysis": response.get("result"),
        "chatHistoryId": response.get("chatHistoryId")
    }


# ============== Audit API Endpoints ==============

@router.post("/audit-doc-check")
async def audit_doc_check(file: UploadFile = File(...)):
    """Send an uploaded audit PDF to the Audit Brain for analysis."""
    # Validate by extension — content_type header is client-controlled
    if not (file.filename or "").lower().endswith(".pdf"):
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "Invalid file type",
                "detail": "Please upload a PDF file.",
            },
        )

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": "File too large", "detail": "Maximum file size is 10 MB."},
        )
    if not _validate_magic(contents, file.filename or ""):
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": "Invalid file", "detail": "File content is not a valid PDF."},
        )
    await file.seek(0)

    # Use the audit service
    result = await check_audit_document(file)
    
    if result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Connection to Brain failed."),
            },
        )

    return {
        "status": "success", 
        "analysis": result.get("result"),
        "chatHistoryId": result.get("chatHistoryId")
    }


@router.post("/audit-chat")
async def audit_chat(
    chatHistoryId: str = Form(...),
    message: str = Form(...),
    file: Optional[UploadFile] = File(None)
):
    """Continue audit conversation with optional file attachment."""
    # Use the audit service
    response = await continue_audit_chat(chatHistoryId, message, file)

    if response.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": response.get("message", "API Not Active"),
                "detail": response.get("detail", "Brain authentication failed."),
            },
        )

    return {
        "status": "success",
        "response": response.get("result"),
        "chatHistoryId": chatHistoryId
    }


# ============== BPMN Diagram Checker API Endpoints ==============

@router.post("/bpmn-diagram-check")
async def bpmn_diagram_check(
    file: UploadFile = File(...),
    context: Optional[str] = Form(None)
):
    """Analyze a BPMN diagram (PDF or image) for errors, best practices, and logical flow."""
    # Use the BPMN checker service
    result = await check_bpmn_diagram(file, context)
    
    if result.get("error"):
        status_code = 400 if result.get("message") == "Invalid file type" else 500
        return JSONResponse(
            status_code=status_code,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Connection to Brain failed."),
            },
        )

    return {
        "status": "success",
        "analysis": result.get("result"),
        "analysisStructured": result.get("structured"),
        "chatHistoryId": result.get("chatHistoryId"),
    }


# ============== Functional Specification Export ==============

class FSExportRequest(BaseModel):
    title: str = ""
    date: str = ""
    version: str = ""
    author: str = ""
    responsibilities: dict = {}
    projectGoal: str = ""
    solutionDesc: str = ""
    improvementPotential: str = ""
    delimitation: str = ""
    previousSteps: list = []
    report: str = ""
    transaction: str = ""
    sourceSystem: str = ""
    functionality: str = ""
    userView: str = ""
    languageTopics: str = ""
    dataStructures: str = ""
    dataMaintenance: str = ""
    interfaces: str = ""
    authorization: str = ""
    infoSecurity: str = ""
    architecture: str = ""
    risks: str = ""
    openIssues: str = ""
    migration: str = ""
    glossary: list = []
    docHistory: list = []


@router.post("/export-functional-spec")
async def export_functional_spec(data: FSExportRequest):
    """Generate a .docx Functional Specification document from form data."""
    from fastapi.responses import StreamingResponse

    try:
        buffer = generate_functional_spec_docx(data.dict())
        safe_title = "".join(c if c.isalnum() or c in "_ -" else "" for c in data.title).replace(" ", "_") or "Functional_Spec"
        filename = f"{safe_title}_Functional_Specification.docx"

        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Document generation failed",
                "detail": "An internal error occurred while generating the document.",
            },
        )


# ============== Business Requirement Export ==============

class BRExportRequest(BaseModel):
    title: str = ""
    project: str = ""
    productOwner: str = ""
    itProduct: str = ""
    targetDate: str = ""
    requestor: str = ""
    requestorCompany: str = ""
    createDate: str = ""
    createdBy: str = ""
    responsibles: dict = {}
    description: dict = {}
    benefits: dict = {}
    signOff: dict = {}
    decision: dict = {}
    costs: dict = {}


@router.post("/export-business-requirement")
async def export_business_requirement(data: BRExportRequest):
    """Generate a .docx Business Requirement document from form data."""
    from fastapi.responses import StreamingResponse

    try:
        buffer = generate_br_docx(data.model_dump())
        title = data.title or "Business_Requirement"
        safe_name = "".join(c if c.isalnum() or c in "_ -" else "" for c in title).replace(" ", "_") or "Business_Requirement"
        filename = f"{safe_name}_Business_Requirement.docx"

        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Business Requirement document generation failed",
                "detail": "An internal error occurred while generating the document.",
            },
        )


# ============== FS Template (Variant) Export ==============

class FSVariantExportRequest(BaseModel):
    description: str = ""
    writtenBy: str = ""
    date: str = ""
    updatedBy: str = ""
    version: str = ""
    revisionHistory: list = []
    purpose: str = ""
    type: str = ""
    latency: str = ""
    frequency: str = ""
    system: str = ""
    impactedSystem: str = ""
    processingLogic: str = ""
    prerequisites: str = ""
    selectionScreen: list = []
    reportCharacteristics: dict = {}
    reportDelivery: str = ""
    reportLayout: str = ""
    reportAttributes: str = ""
    customTransitions: str = ""
    printerRequirements: str = ""
    exclusions: str = ""
    outputFileLocation: str = ""
    outputFileRemarks: str = ""
    exceptionHandling: str = ""
    constraints: str = ""
    dependencies: str = ""
    scheduling: str = ""
    roleAuthorization: str = ""
    testScenarios: list = []
    testData: str = ""
    testSystem: str = ""
    testClient: str = ""
    changeHistory: list = []


@router.post("/export-fs-variant")
async def export_fs_variant(data: FSVariantExportRequest):
    """Generate a .docx FS Template (variant) document from form data."""
    from fastapi.responses import StreamingResponse

    try:
        buffer = generate_fs_variant_docx(data.model_dump())
        safe_title = "".join(c if c.isalnum() or c in "_ -" else "" for c in data.description).replace(" ", "_") or "FS_Template"
        filename = f"{safe_title}_Functional_Specification.docx"

        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "FS Template document generation failed",
                "detail": "An internal error occurred while generating the document.",
            },
        )


# ============== PPT Creator API Endpoints ==============

@router.post("/ppt/extract")
async def ppt_extract(
    files: List[UploadFile] = File(...),
    username: str = Form(...),
    instructions: Optional[str] = Form(None),
    force_orange_theme: bool = Form(False),
):
    """Upload PDF/image files → AI structures content into presentation slides."""
    MAX_TOTAL_SIZE = 10 * 1024 * 1024  # 10MB total across all files
    MAX_IMAGES = 3
    _IMAGE_EXTS = (".png", ".jpg", ".jpeg")
    pdf_files = []
    image_files = []
    total_size = 0

    for f in files:
        fname_lower = f.filename.lower()
        if not fname_lower.endswith(".pdf") and not fname_lower.endswith(_IMAGE_EXTS):
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Invalid file type",
                    "detail": f"'{f.filename}' is not supported. Only .pdf, .png, .jpg, .jpeg files are accepted.",
                },
            )
        content = await f.read()
        total_size += len(content)

        if total_size > MAX_TOTAL_SIZE:
            return JSONResponse(
                status_code=413,
                content={
                    "status": "error",
                    "message": "Total upload size too large",
                    "detail": f"Combined file size exceeds the 10 MB limit. Current total: {total_size / (1024*1024):.1f} MB.",
                },
            )

        if not _validate_magic(content, f.filename or ""):
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Invalid file", "detail": f"'{f.filename}' content does not match its file type."},
            )

        if fname_lower.endswith(".pdf"):
            pdf_files.append((f.filename, content))
        else:
            if len(image_files) >= MAX_IMAGES:
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "message": "Too many images",
                        "detail": f"Maximum {MAX_IMAGES} images allowed per request.",
                    },
                )
            await f.seek(0)
            image_files.append(f)

    result = await extract_pdf_content(
        pdf_files,
        instructions or "",
        username,
        image_files=image_files or None,
        force_orange_theme=force_orange_theme,
    )

    if result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Connection to Brain failed."),
            },
        )

    return {
        "status": "success",
        "content": result.get("content"),
        "chatHistoryId": result.get("chatHistoryId"),
    }


# ============== Diagram Generator API Endpoints ==============

@router.post("/diagram/analyze")
async def diagram_analyze(
    files: List[UploadFile] = File(...),
    instructions: Optional[str] = Form(None),
):
    """Upload PDF/image files → AI analyzes content and suggests diagram types."""
    MAX_TOTAL_SIZE = 10 * 1024 * 1024  # 10MB total
    _IMAGE_EXTS = (".png", ".jpg", ".jpeg")
    pdf_files = []
    image_files = []
    total_size = 0

    for f in files:
        fname_lower = f.filename.lower()
        if not fname_lower.endswith(".pdf") and not fname_lower.endswith(_IMAGE_EXTS):
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Invalid file type",
                    "detail": f"'{f.filename}' is not supported. Only .pdf, .png, .jpg, .jpeg files are accepted.",
                },
            )
        content = await f.read()
        total_size += len(content)

        if total_size > MAX_TOTAL_SIZE:
            return JSONResponse(
                status_code=413,
                content={
                    "status": "error",
                    "message": "Total upload size too large",
                    "detail": f"Combined file size exceeds the 10 MB limit. Current total: {total_size / (1024*1024):.1f} MB.",
                },
            )

        if not _validate_magic(content, f.filename or ""):
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Invalid file", "detail": f"'{f.filename}' content does not match its file type."},
            )

        if fname_lower.endswith(".pdf"):
            pdf_files.append((f.filename, content))
        else:
            await f.seek(0)
            image_files.append(f)

    result = await diagram_analyze_pdf(pdf_files, instructions or "", image_files=image_files or None)

    if result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Connection to Brain failed."),
            },
        )

    return {
        "status": "success",
        "analysis": result.get("analysis"),
        "chatHistoryId": result.get("chatHistoryId"),
        "extractedText": result.get("extractedText"),
    }


class DiagramGenerateRequest(BaseModel):
    chatHistoryId: str
    analysis: dict
    extractedText: str
    selectedIndices: Optional[List[int]] = None


@router.post("/diagram/generate")
async def diagram_generate(data: DiagramGenerateRequest):
    """Generate draw.io XML diagrams from analysed content."""
    result = await generate_diagrams(
        data.chatHistoryId,
        data.analysis,
        data.extractedText,
        data.selectedIndices,
    )

    if result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Brain request failed."),
            },
        )

    return {
        "status": "success",
        "diagrams": result.get("diagrams"),
        "chatHistoryId": result.get("chatHistoryId"),
    }


class DiagramRefineRequest(BaseModel):
    chatHistoryId: str
    message: str
    currentXml: str = ""
    diagramName: str = ""


@router.post("/diagram/refine")
async def diagram_refine(data: DiagramRefineRequest):
    """Refine a specific diagram based on user feedback."""
    result = await refine_diagram(
        data.chatHistoryId,
        data.message,
        data.currentXml,
        data.diagramName,
    )

    if result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Brain request failed."),
            },
        )

    return {
        "status": "success",
        "xml": result.get("xml"),
        "chatHistoryId": result.get("chatHistoryId"),
    }


class DiagramDownloadRequest(BaseModel):
    diagrams: list


@router.post("/diagram/copy-image")
async def diagram_copy_image(
    files: List[UploadFile] = File(...),
):
    """Reproduce image-based diagram(s) as exact draw.io XML — images only, no PDFs."""
    _IMAGE_EXTS = (".png", ".jpg", ".jpeg")
    MAX_TOTAL_SIZE = 10 * 1024 * 1024
    MAX_IMAGES = 3

    image_files = []
    total_size = 0

    for f in files:
        fname_lower = f.filename.lower()

        if fname_lower.endswith(".pdf"):
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "PDFs not supported in Copy as Diagram mode",
                    "detail": "This mode only works with image files (.png, .jpg, .jpeg). Please remove all PDF files and try again.",
                },
            )

        if not any(fname_lower.endswith(ext) for ext in _IMAGE_EXTS):
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Unsupported file type",
                    "detail": f"'{f.filename}' is not a supported image. Only .png, .jpg, .jpeg files are accepted.",
                },
            )

        content = await f.read()
        total_size += len(content)

        if total_size > MAX_TOTAL_SIZE:
            return JSONResponse(
                status_code=413,
                content={
                    "status": "error",
                    "message": "Total upload size too large",
                    "detail": f"Combined file size exceeds the 10 MB limit.",
                },
            )

        if not _validate_magic(content, f.filename or ""):
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "Invalid file", "detail": f"'{f.filename}' content does not match its file type."},
            )

        await f.seek(0)
        image_files.append(f)

        if len(image_files) > 1:
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Only 1 image allowed",
                    "detail": "Copy as Diagram supports exactly 1 image at a time. Please upload a single image file.",
                },
            )

    if not image_files:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "message": "No images provided", "detail": "Please upload at least one image file."},
        )

    result = await copy_image_as_diagram(image_files)

    if result.get("error"):
        status_code = 500
        if result.get("message") in {"Request Timed Out", "Gateway Timeout"}:
            status_code = 504
        elif result.get("message") in {"AI Service Unavailable"}:
            status_code = 503
        elif result.get("message") in {"Upstream Service Error"}:
            status_code = 502
        return JSONResponse(
            status_code=status_code,
            content={
                "status": "error",
                "message": result.get("message", "Copy failed"),
                "detail": result.get("detail", ""),
            },
        )

    if result.get("not_a_diagram"):
        return {
            "status": "not_a_diagram",
            "content_type": result.get("content_type"),
            "suggestion": result.get("suggestion"),
            "chatHistoryId": result.get("chatHistoryId"),
        }

    return {
        "status": "success",
        "diagrams": result.get("diagrams"),
        "chatHistoryId": result.get("chatHistoryId"),
    }


@router.post("/diagram/download")
async def diagram_download(data: DiagramDownloadRequest):
    """Build and download a .drawio file from generated diagrams."""
    from fastapi.responses import Response

    if not data.diagrams:
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "No diagrams provided",
                "detail": "Please generate diagrams first.",
            },
        )

    drawio_content = build_drawio_download(data.diagrams)

    return Response(
        content=drawio_content,
        media_type="application/xml",
        headers={"Content-Disposition": 'attachment; filename="diagrams.drawio"'},
    )


class PptRefineRequest(BaseModel):
    chatHistoryId: str
    message: str
    currentContent: Optional[dict] = None
    forceOrangeTheme: bool = False


@router.post("/ppt/refine")
async def ppt_refine(data: PptRefineRequest):
    """Continue conversation to refine presentation content."""
    result = await refine_ppt_content(
        data.chatHistoryId,
        data.message,
        data.currentContent,
        force_orange_theme=data.forceOrangeTheme,
    )

    if result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Brain request failed."),
            },
        )

    return {
        "status": "success",
        "content": result.get("content"),
        "chatHistoryId": result.get("chatHistoryId"),
        "response": result.get("result"),
    }


class PptDownloadRequest(BaseModel):
    content: dict
    username: str = "Unknown User"
    forceOrangeTheme: bool = False


@router.post("/ppt/download")
async def ppt_download(data: PptDownloadRequest):
    """Generate and download the .pptx file from structured AI content."""
    from fastapi.responses import StreamingResponse

    content = data.content
    username = data.username

    if not content or "slides" not in content:
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "Missing content",
                "detail": "No slide content provided.",
            },
        )

    try:
        buf = generate_pptx_file(content, username, force_orange_theme=data.forceOrangeTheme)
        title = content.get("title", "Presentation").replace(" ", "_")
        safe = "".join(c if c.isalnum() or c in "_-" else "" for c in title) or "Presentation"
        filename = f"{safe}.pptx"

        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "PowerPoint generation failed",
                "detail": "An internal error occurred while generating the presentation.",
            },
        )


class ConfluenceDraftPayload(BaseModel):
    title: str = ""
    summary: str = ""
    storageXml: str = ""
    attachmentReferences: list[dict[str, Any]] = Field(default_factory=list)
    displayImages: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ConfluenceRefineRequest(BaseModel):
    chatHistoryId: str = ""
    instruction: str = ""
    draft: ConfluenceDraftPayload


class ConfluenceVerifyRequest(BaseModel):
    confluenceUrl: str = Field(default="", max_length=500)
    pat: str = Field(default="", max_length=500)
    spaceKey: str = Field(default="", max_length=200)
    parentPageId: str = Field(default="", max_length=200)


@router.post("/confluence-builder/verify-connection")
async def confluence_builder_verify(data: ConfluenceVerifyRequest):
    """Verify PAT, space key, and parent page before proceeding."""
    logger = logging.getLogger("app.routers.api")
    if not data.pat or not data.spaceKey or not data.parentPageId:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "detail": "PAT, Space Key, and Parent Page ID are required."},
        )

    logger.info("[verify-connection] Verifying space=%s parent=%s", data.spaceKey, data.parentPageId)
    try:
        result = await verify_confluence_connection(
            confluence_url=data.confluenceUrl,
            pat=data.pat,
            space_key=data.spaceKey,
            parent_page_id=data.parentPageId,
        )
    except Exception as exc:
        logger.exception("[verify-connection] Unexpected exception")
        return JSONResponse(
            status_code=500,
            content={"status": "error", "detail": "An internal error occurred"},
        )

    if result.get("error"):
        logger.warning("[verify-connection] Failed: %s", result.get("detail"))
        return JSONResponse(
            status_code=400,
            content={"status": "error", "detail": result.get("detail", "Verification failed.")},
        )

    logger.info("[verify-connection] Success: %s", result.get("displayName"))
    return {"status": "success", **result}


@router.post("/confluence-builder/generate")
async def confluence_builder_generate(
    files: List[UploadFile] = File(...),
    uploadManifest: str = Form(...),
    requestedTitle: Optional[str] = Form(None),
    instructions: Optional[str] = Form(None),
):
    """Generate a Confluence-ready draft from uploaded files."""
    if not files:
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "No files provided",
                "detail": "Upload at least one file before generating the draft.",
            },
        )

    result = await generate_confluence_builder_draft(
        files,
        uploadManifest,
        requested_title=requestedTitle or "",
        instructions=instructions or "",
    )

    if result.get("error"):
        return JSONResponse(
            status_code=result.get("status_code", 500),
            content={
                "status": "error",
                "message": result.get("message", "Draft generation failed"),
                "detail": result.get("detail", "The AI service could not generate the draft."),
            },
        )

    return {
        "status": "success",
        **result,
    }


@router.post("/confluence-builder/refine")
async def confluence_builder_refine(data: ConfluenceRefineRequest):
    """Refine an existing Confluence draft."""
    result = await refine_confluence_builder_draft(
        data.draft.model_dump(),
        data.instruction,
        chat_history_id=data.chatHistoryId,
    )

    if result.get("error"):
        return JSONResponse(
            status_code=result.get("status_code", 500),
            content={
                "status": "error",
                "message": result.get("message", "Draft refinement failed"),
                "detail": result.get("detail", "The AI service could not refine the draft."),
            },
        )

    return {
        "status": "success",
        **result,
    }


@router.post("/confluence-builder/publish")
async def confluence_builder_publish(
    uploadManifest: str = Form(...),
    draft: str = Form(...),
    confluenceUrl: str = Form(""),
    pat: str = Form(""),
    spaceKey: str = Form(""),
    parentPageId: str = Form(""),
    files: Optional[List[UploadFile]] = File(None),
):
    """Publish the reviewed Confluence draft and upload selected attachments."""
    try:
        draft_payload = json.loads(draft)
    except json.JSONDecodeError:
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "Invalid draft payload",
                "detail": "The reviewed draft could not be parsed on the server.",
            },
        )

    if not isinstance(draft_payload, dict):
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "Invalid draft payload",
                "detail": "The reviewed draft must be a JSON object.",
            },
        )

    result = await publish_confluence_builder_page(
        confluence_url=confluenceUrl,
        pat=pat,
        space_key=spaceKey,
        parent_page_id=parentPageId,
        draft=draft_payload,
        files=files or [],
        upload_manifest_json=uploadManifest,
    )

    if result.get("error"):
        return JSONResponse(
            status_code=result.get("status_code", 500),
            content={
                "status": "error",
                "message": result.get("message", "Publish failed"),
                "detail": result.get("detail", "The page could not be published to Confluence."),
            },
        )

    return result


# ── One Pager Creator ──


@router.post("/one-pager/extract")
async def one_pager_extract(
    files: List[UploadFile] = File(default=[]),
    topic: str = Form(default=""),
    keyPoints: str = Form(default=""),
    audience: str = Form(default=""),
    purpose: str = Form(default=""),
    templateStyle: str = Form(default="executive_summary"),
):
    """Extract content from uploaded docs and/or user context to build a one-pager."""
    _ALLOWED_EXTS = (".pdf", ".png", ".jpg", ".jpeg")
    MAX_TOTAL_SIZE = MAX_UPLOAD_SIZE

    pdf_bytes_list = []
    image_files = []
    total_size = 0

    for f in files:
        fname_lower = (f.filename or "").lower()
        if not any(fname_lower.endswith(ext) for ext in _ALLOWED_EXTS):
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Unsupported file type",
                    "detail": f"'{f.filename}' is not supported. Only PDF and image files (.pdf, .png, .jpg, .jpeg) are accepted.",
                },
            )

        content = await f.read()
        total_size += len(content)

        if total_size > MAX_TOTAL_SIZE:
            return JSONResponse(
                status_code=413,
                content={
                    "status": "error",
                    "message": "Total upload size too large",
                    "detail": "Combined file size exceeds the 10 MB limit.",
                },
            )

        if not _validate_magic(content, f.filename or ""):
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Invalid file",
                    "detail": f"'{f.filename}' content does not match its file type.",
                },
            )

        if fname_lower.endswith(".pdf"):
            pdf_bytes_list.append((f.filename, content))
        else:
            await f.seek(0)
            image_files.append(f)

    has_context = bool(topic or keyPoints or audience or purpose)
    if not pdf_bytes_list and not image_files and not has_context:
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "No content provided",
                "detail": "Upload at least one file or fill in topic details.",
            },
        )

    result = await extract_one_pager_content(
        pdf_bytes_list=pdf_bytes_list,
        topic=topic,
        key_points=keyPoints,
        audience=audience,
        purpose=purpose,
        template_style=templateStyle,
        image_files=image_files or None,
    )

    if result.get("error"):
        status_code = 500
        msg = result.get("message", "")
        if msg in {"Request Timed Out", "Gateway Timeout"}:
            status_code = 504
        elif msg in {"AI Service Unavailable"}:
            status_code = 503
        elif msg in {"Upstream Service Error"}:
            status_code = 502
        elif msg == "No Content":
            status_code = 400
        return JSONResponse(
            status_code=status_code,
            content={
                "status": "error",
                "message": result.get("message", "Extraction failed"),
                "detail": result.get("detail", ""),
            },
        )

    return {
        "status": "success",
        "html": result.get("html"),
        "chatHistoryId": result.get("chatHistoryId"),
    }


class OnePagerRefineRequest(BaseModel):
    chatHistoryId: str = Field(max_length=200)
    message: str = Field(max_length=5000)
    currentHtml: str = Field(default="", max_length=200000)
    templateStyle: str = Field(default="executive_summary", max_length=50)


@router.post("/one-pager/refine")
async def one_pager_refine(data: OnePagerRefineRequest):
    """Continue conversation to refine the one-pager HTML document."""
    result = await refine_one_pager_content(
        data.chatHistoryId,
        data.message,
        current_html=data.currentHtml,
        template_style=data.templateStyle,
    )

    if result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Brain request failed."),
            },
        )

    return {
        "status": "success",
        "html": result.get("html"),
        "chatHistoryId": result.get("chatHistoryId"),
    }


class OnePagerDownloadRequest(BaseModel):
    html: str = Field(max_length=200000)
    title: str = Field(default="One-Pager", max_length=200)


@router.post("/one-pager/download")
async def one_pager_download(data: OnePagerDownloadRequest):
    """Return the one-pager HTML document as a downloadable file (fallback for client-side PDF)."""
    from fastapi.responses import Response

    if not data.html or "<html" not in data.html.lower():
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "Missing content",
                "detail": "No one-pager HTML provided.",
            },
        )

    safe_title = "".join(c if c.isalnum() or c in " _-" else "" for c in data.title).strip() or "One-Pager"
    filename = safe_title.replace(" ", "_") + ".html"

    return Response(
        content=data.html.encode("utf-8"),
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )