import os
from typing import Optional
from fastapi import APIRouter, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.core.config import TEMPLATES_DIR

# Import from organized service files
from app.services.common_service import create_chat_history, call_brain_workflow_chat
from app.services.signavio_service import (
    get_signavio_bpmn_xml,
    build_analysis_prompt,
    analyze_process,
    continue_chat as signavio_continue_chat,
    ANALYSIS_BEHAVIOUR,
    SIGNAVIO_WORKFLOW_ID,
)
from app.services.audit_service import (
    check_audit_document,
    continue_audit_chat,
)
from app.services.bpmn_checker_service import check_bpmn_diagram

router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


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


# Page Routes 
@router.get("/")
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@router.get("/signavio-bpmn")
async def signavio_bpmn(request: Request):
    return templates.TemplateResponse("signavio_bpmn.html", {"request": request})

@router.get("/audit-check")
async def audit_check(request: Request):
    return templates.TemplateResponse("audit_check.html", {"request": request})

@router.get("/bpmn-checker")
async def bpmn_checker(request: Request):
    return templates.TemplateResponse("bpmn_checker.html", {"request": request})


# ============== BPMN Chat Flow API Endpoints ==============

@router.post("/api/bpmn/start-session")
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


@router.post("/api/bpmn/chat")
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


@router.post("/api/generate-bpmn")
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
@router.post("/api/make-bpmn-analysis")
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

@router.post("/api/audit-doc-check")
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


@router.post("/api/audit-chat")
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

@router.post("/api/bpmn-diagram-check")
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


@router.get("/health")
async def health_check():
    """Service health check."""
    return {"status": "healthy"}