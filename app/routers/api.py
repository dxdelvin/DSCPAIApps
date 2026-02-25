import os
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Import from organized service files
from app.services.common_service import create_chat_history
from app.services.signavio_service import (
    get_signavio_bpmn_xml,
    analyze_process,
    continue_chat as signavio_continue_chat,
)
from app.services.audit_service import (
    check_audit_document,
    continue_audit_chat,
)
from app.services.bpmn_checker_service import check_bpmn_diagram
from app.services.functional_spec_service import generate_functional_spec_docx
from app.services.ppt_creator_service import (
    extract_ppt_content,
    refine_ppt_content,
    generate_pptx_file,
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

@router.post("/export-functional-spec")
async def export_functional_spec(
    form_data: str = Form(...),
    problem_screenshots: List[UploadFile] = File(default=[]),
    solution_screenshots: List[UploadFile] = File(default=[]),
):
    """Generate a .docx Functional Specification document from form data + optional screenshots."""
    from fastapi.responses import StreamingResponse
    import json

    try:
        data = json.loads(form_data)

        # Read uploaded images into memory
        problem_images = []
        for f in problem_screenshots:
            content = await f.read()
            if content:
                problem_images.append({"name": f.filename, "data": content, "type": f.content_type})

        solution_images = []
        for f in solution_screenshots:
            content = await f.read()
            if content:
                solution_images.append({"name": f.filename, "data": content, "type": f.content_type})

        buffer = generate_functional_spec_docx(data, problem_images, solution_images)
        role = data.get("userStory", {}).get("role", "Functional_Spec")
        safe_name = "".join(c if c.isalnum() or c in "_ -" else "" for c in role).replace(" ", "_") or "Functional_Spec"
        filename = f"{safe_name}_Functional_Specification.docx"

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


# ============== PPT Creator API Endpoints ==============

@router.post("/ppt/extract")
async def ppt_extract(
    files: List[UploadFile] = File(...),
    instructions: Optional[str] = Form(None),
):
    """Upload PowerPoint files → AI extracts & structures content."""
    # Validate files
    allowed_types = (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
    )
    file_bytes_list = []
    for f in files:
        if not f.filename.lower().endswith((".pptx", ".ppt")):
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "Invalid file type",
                    "detail": f"'{f.filename}' is not a PowerPoint file. Only .pptx files are supported.",
                },
            )
        content = await f.read()
        file_bytes_list.append((f.filename, content))

    result = await extract_ppt_content(file_bytes_list, instructions or "")

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


@router.post("/ppt/refine")
async def ppt_refine(
    chatHistoryId: str = Form(...),
    message: str = Form(...),
    currentContent: Optional[str] = Form(None),
):
    """Continue conversation to refine presentation content."""
    import json as _json

    current = None
    if currentContent:
        try:
            current = _json.loads(currentContent)
        except _json.JSONDecodeError:
            pass

    result = await refine_ppt_content(chatHistoryId, message, current)

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


@router.post("/ppt/download")
async def ppt_download(data: dict):
    """Generate and download the .pptx file from structured content."""
    from fastapi.responses import StreamingResponse

    content = data.get("content")
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
        buf = generate_pptx_file(content)
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
