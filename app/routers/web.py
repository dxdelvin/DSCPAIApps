import os
import base64
from typing import Optional, List
from fastapi import APIRouter, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.core.config import TEMPLATES_DIR
from app.services.bpmn_service import (
    call_brain_workflow_chat,
    get_signavio_bpmn_xml,
    create_chat_history,
    upload_attachments,
    _build_analysis_prompt,
    ANALYSIS_BEHAVIOUR,
    BPMN_GENERATE_BEHAVIOUR,
    AUDIT_NO_FOLLOWUPS_BEHAVIOUR,
    BPMN_DIAGRAM_CHECK_BEHAVIOUR,
    SIGNAVIO_WORKFLOW_ID,
    AUDIT_WORKFLOW_ID,
    BPMN_CHECKER_WORKFLOW_ID,
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
    
    # Build the analysis prompt
    prompt = _build_analysis_prompt(data.model_dump())
    
    # Get initial analysis using custom behaviour (no code)
    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        custom_behaviour=ANALYSIS_BEHAVIOUR,
        workflow_id=SIGNAVIO_WORKFLOW_ID,
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

    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=data.chatHistoryId,
        custom_behaviour=ANALYSIS_BEHAVIOUR,
        workflow_id=SIGNAVIO_WORKFLOW_ID,
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
    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        custom_behaviour=ANALYSIS_BEHAVIOUR,
        workflow_id=SIGNAVIO_WORKFLOW_ID,
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

    # Create a chat history first - workflow endpoint requires this
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
    
    if not chat_history_id:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to create chat session",
                "detail": "Chat history ID is empty or null.",
            },
        )

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
        attachment_ids=attachment_ids,
        custom_behaviour=AUDIT_NO_FOLLOWUPS_BEHAVIOUR,
        workflow_id=AUDIT_WORKFLOW_ID,
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
        if not attachment_ids or len(attachment_ids) == 0:
            attachment_ids = None

    response = await call_brain_workflow_chat(
        brain_id,
        message,
        chat_history_id=chatHistoryId if chatHistoryId else None,
        attachment_ids=attachment_ids,
        custom_behaviour=AUDIT_NO_FOLLOWUPS_BEHAVIOUR,
        workflow_id=AUDIT_WORKFLOW_ID,
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


# ============== BPMN Diagram Checker API Endpoints ==============

@router.post("/api/bpmn-diagram-check")
async def bpmn_diagram_check(
    file: UploadFile = File(...),
    context: Optional[str] = Form(None)
):
    """Analyze a BPMN diagram (PDF or image) for errors, best practices, and logical flow."""
    brain_id = os.getenv("BPMN_CHECKER_BRAIN_ID")
    if not brain_id:
        # Fallback to signavio brain if specific checker brain not configured
        brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    
    if not brain_id:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": "BPMN_CHECKER_BRAIN_ID is not configured.",
            },
        )

    # Validate file type - accept PDF and images
    allowed_types = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
    allowed_extensions = ['.pdf', '.jpg', '.jpeg', '.png']
    
    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ''
    is_valid = (
        (file.content_type and file.content_type in allowed_types) or
        file_ext in allowed_extensions
    )
    
    if not is_valid:
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "message": "Invalid file type",
                "detail": "Please upload a PDF or image file (JPG, JPEG, PNG) containing your BPMN diagram.",
            },
        )

    # Create a chat history
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
    
    if not chat_history_id:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to create chat session",
                "detail": "Chat history ID is empty or null.",
            },
        )

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
    
    if not attachment_ids or len(attachment_ids) == 0:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Attachment upload failed",
                "detail": "No attachment IDs returned from upload.",
            },
        )

    # Build the analysis prompt with clear output format
    prompt = f"""You are a BPMN 2.0 expert. Analyze the uploaded BPMN diagram and check for issues.

## ANALYSIS CATEGORIES:
1. **Structural Issues**: Missing start/end events, disconnected elements, improper pools/lanes
2. **Gateway Problems**: Incorrect gateway usage (XOR, AND, OR), missing conditions, unbalanced splits/joins
3. **Flow Logic**: Deadlocks, infinite loops, unreachable paths, dead ends
4. **Naming Conventions**: Unclear or missing labels on tasks, events, gateways
5. **Best Practices**: BPMN 2.0 compliance, proper symbol usage
6. **Logical Consistency**: Does the process flow make sense?

## REQUIRED OUTPUT FORMAT:

### Score: [X]/100
(Provide a quality score from 0-100)

### ❌ Errors (Critical Issues)
- List each critical error that MUST be fixed
- Use format: **Issue Title**: Description of the problem

### ⚠️ Warnings (Should Review)
- List issues that should be reviewed but aren't critical
- Use format: **Issue Title**: Description of the problem

### 💡 Suggestions (Improvements)
- List recommendations for better clarity and best practices
- Use format: **Suggestion Title**: Description of improvement

### 📝 Summary
Provide a brief overall assessment of the diagram quality and main areas for improvement.

File being analyzed: {file.filename}"""

    if context:
        prompt += f"\n\nAdditional context from user: {context}"

    # Call the Brain API
    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        attachment_ids=attachment_ids,
        custom_behaviour=BPMN_DIAGRAM_CHECK_BEHAVIOUR,
        workflow_id=BPMN_CHECKER_WORKFLOW_ID,
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


@router.get("/health")
async def health_check():
    """Service health check."""
    return {"status": "healthy"}