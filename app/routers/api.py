import os
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

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
from app.services.fs_br_document_service import generate_functional_spec_docx, generate_br_docx
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
)

router = APIRouter()

# Request models for better type safety
class BPMNSessionRequest(BaseModel):
    processName: str = ""
    poolName: str = ""
    participants: str = ""
    subLanes: str = ""
    startTriggers: str = ""
    processActivities: str = ""
    processEnding: str = ""
    intermediateEvents: str = ""
    reviewOverride: str = ""


class BPMNChatRequest(BaseModel):
    chatHistoryId: str
    message: str
    formData: Optional[dict] = None


class BPMNGenerateRequest(BaseModel):
    chatHistoryId: Optional[str] = None
    processName: str = ""
    poolName: str = ""
    participants: str = ""
    subLanes: str = ""
    startTriggers: str = ""
    processActivities: str = ""
    processEnding: str = ""
    intermediateEvents: str = ""
    reviewOverride: str = ""


class ClientLogRequest(BaseModel):
    level: str = "error"
    message: str = ""
    metadata: Optional[str] = None
    path: Optional[str] = None
    userAgent: Optional[str] = None
    ts: Optional[str] = None


@router.post("/client-log")
async def client_log(payload: ClientLogRequest, request: Request):
    """Collect frontend logs for production diagnostics."""
    level = (payload.level or "error").upper()
    path = payload.path or request.url.path
    ip = request.client.host if request.client else "unknown"
    print(f"[CLIENT][{level}] {path} {payload.message} | ip={ip}")
    if payload.metadata:
        print(f"[CLIENT][META] {payload.metadata}")
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
    allowed_types = [
        "image/png", "image/jpeg", "image/jpg",
        "application/pdf",
    ]
    if not file.content_type or file.content_type not in allowed_types:
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "Invalid file type",
                "detail": "Please upload a PNG, JPG, or PDF file.",
            },
        )

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
        "bpmn_valid": result.get("bpmn_valid", False),
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
    # Validate file type
    if not file.content_type or not file.content_type.startswith('application/pdf'):
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "Invalid file type",
                "detail": "Please upload a PDF file.",
            },
        )

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
                "detail": str(e),
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
                "detail": str(e),
            },
        )


# ============== PPT Creator API Endpoints ==============

@router.post("/ppt/extract")
async def ppt_extract(
    files: List[UploadFile] = File(...),
    username: str = Form(...),
    instructions: Optional[str] = Form(None),
):
    """Upload PDF files → AI structures content into presentation slides."""
    MAX_TOTAL_SIZE = 10 * 1024 * 1024  # 10MB total across all files
    file_bytes_list = []
    total_size = 0
    
    for f in files:
        if not f.filename.lower().endswith(".pdf"):
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Invalid file type",
                    "detail": f"'{f.filename}' is not a PDF file. Only .pdf files are supported.",
                },
            )
        content = await f.read()
        total_size += len(content)
        
        # Check total size across all files
        if total_size > MAX_TOTAL_SIZE:
            return JSONResponse(
                status_code=413,
                content={
                    "status": "error",
                    "message": "Total upload size too large",
                    "detail": f"Combined file size exceeds the 10 MB limit. Current total: {total_size / (1024*1024):.1f} MB.",
                },
            )
        
        file_bytes_list.append((f.filename, content))

    result = await extract_pdf_content(file_bytes_list, instructions or "", username)

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
    """Upload PDF files → AI analyzes content and suggests diagram types."""
    MAX_TOTAL_SIZE = 10 * 1024 * 1024  # 10MB total
    file_bytes_list = []
    total_size = 0

    for f in files:
        if not f.filename.lower().endswith(".pdf"):
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Invalid file type",
                    "detail": f"'{f.filename}' is not a PDF file. Only .pdf files are supported.",
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

        file_bytes_list.append((f.filename, content))

    result = await diagram_analyze_pdf(file_bytes_list, instructions or "")

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


@router.post("/ppt/refine")
async def ppt_refine(data: PptRefineRequest):
    """Continue conversation to refine presentation content."""
    result = await refine_ppt_content(data.chatHistoryId, data.message, data.currentContent)

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
        buf = generate_pptx_file(content, username)
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
                "detail": str(e),
            },
        )
