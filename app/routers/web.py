import os
import base64
from typing import Optional, List
from fastapi import APIRouter, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.core.config import TEMPLATES_DIR
from app.services.bpmn_service import (
    call_brain_chat, 
    call_brain_workflow_chat,
    get_signavio_bpmn_xml, 
    create_chat_history,
    upload_attachments,
    _build_analysis_prompt,
    ANALYSIS_BEHAVIOUR,
    BPMN_GENERATE_BEHAVIOUR
)

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
    
    # Build the analysis prompt
    prompt = _build_analysis_prompt(data.model_dump())
    
    # Get initial analysis using custom behaviour (no code)
    response = await call_brain_chat(
        brain_id, 
        prompt, 
        use_gpt_knowledge=False,
        chat_history_id=chat_history_id,
        custom_behaviour=ANALYSIS_BEHAVIOUR
    )

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

    # Build context if form data is provided (for refinement requests)
    prompt = data.message
    if data.formData:
        prompt = f"User request: {data.message}\n\nCurrent process context:\n{_build_analysis_prompt(data.formData)}"

    response = await call_brain_chat(
        brain_id, 
        prompt, 
        use_gpt_knowledge=False,
        chat_history_id=data.chatHistoryId,
        custom_behaviour=ANALYSIS_BEHAVIOUR
    )

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

    prompt = _build_analysis_prompt(data)
    response = await call_brain_chat(
        brain_id, 
        prompt, 
        use_gpt_knowledge=False,
        custom_behaviour=ANALYSIS_BEHAVIOUR
    )

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
    brain_id = os.getenv("AUDIT_CHECK_BRAIN_ID")
    if not brain_id:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": "AUDIT_CHECK_BRAIN_ID is not configured.",
            },
        )

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

    # Create a chat history for the audit session
    chat_result = await create_chat_history(brain_id)
    if chat_result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": chat_result.get("message", "Failed to start audit session"),
                "detail": chat_result.get("detail", "Could not create chat history."),
            },
        )

    chat_history_id = chat_result.get("chatHistoryId")

    # Upload the file as an attachment
    upload_result = await upload_attachments(brain_id, [file])
    if upload_result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": upload_result.get("message", "Failed to upload file"),
                "detail": upload_result.get("detail", "Could not upload attachment."),
            },
        )

    attachment_ids = upload_result.get("attachmentIds", [])
    
    # Validate that we got attachment IDs
    if not attachment_ids or len(attachment_ids) == 0:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Attachment upload failed",
                "detail": "No attachment IDs returned from upload.",
            },
        )

    # Simple prompt - Brain agent handles the audit workflow
    prompt = f"Please check and analyze this audit document: {file.filename}"

    # Use workflow endpoint for audit with attachments
    response = await call_brain_workflow_chat(
        brain_id, 
        prompt,
        chat_history_id=chat_history_id,
        attachment_ids=attachment_ids
    )

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
        "chatHistoryId": chat_history_id
    }


@router.post("/api/audit-chat")
async def audit_chat(
    chatHistoryId: str = Form(...),
    message: str = Form(...),
    file: Optional[UploadFile] = File(None)
):
    """Continue audit conversation with optional file attachment."""
    brain_id = os.getenv("AUDIT_CHECK_BRAIN_ID")
    if not brain_id:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": "AUDIT_CHECK_BRAIN_ID is not configured.",
            },
        )

    attachment_ids = None
    
    # Upload new file if provided
    if file and file.filename:
        upload_result = await upload_attachments(brain_id, [file])
        if upload_result.get("error"):
            return JSONResponse(
                status_code=500,
                content={
                    "status": "error",
                    "message": upload_result.get("message", "Failed to upload file"),
                    "detail": upload_result.get("detail", "Could not upload attachment."),
                },
            )
        attachment_ids = upload_result.get("attachmentIds", [])
        if not attachment_ids:
            attachment_ids = None

    response = await call_brain_workflow_chat(
        brain_id,
        message,
        chat_history_id=chatHistoryId,
        attachment_ids=attachment_ids
    )

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
        "response": response.get("result"),
        "chatHistoryId": chatHistoryId
    }


@router.get("/health")
async def health_check():
    """Service health check."""
    return {"status": "healthy"}