"""
BPMN Diagram Checker Service.
Handles BPMN diagram analysis for errors, best practices, and quality scoring.
"""
import os
from typing import Optional
from fastapi import UploadFile
from app.services.common_service import (
    create_chat_history,
    upload_attachments,
    call_brain_workflow_chat,
)


# BPMN Checker-specific constants
BPMN_CHECKER_WORKFLOW_ID = "kjDTf2C4DkCN"

BPMN_DIAGRAM_CHECK_BEHAVIOUR = (
    "You are a BPMN 2.0 Expert Validator. "
    "Analyze the diagram for syntax errors, deadlocks, and best practices. "
    "STRICTLY return a JSON object with keys: isBPMN (bool), qualityScore (0-100), "
    "counts (problem, best_practice), topPriorityFixes (list), issues (list), diagramOverview (string). "
    "Categorize issues ONLY as 'problem' (for errors/violations) or 'best_practice' (for suggestions). "
    "Only report issues with >85% confidence. "
    "Keep recommendations concise and actionable."
)


def build_checker_prompt(filename: str, context: Optional[str] = None) -> str:
    """Build a minimal analysis prompt; workflow behavior defines output shape."""
    base = "Analyze this BPMN diagram for me."
    details = f" File: {filename}." if filename else ""
    extra = f" Context: {context}" if context else ""
    # Keep it short and let the workflow's Custom Behavior govern format
    return base + details + extra


async def check_bpmn_diagram(file: UploadFile, context: Optional[str] = None) -> dict:
    """Analyze a BPMN diagram for errors, best practices, and quality."""
    brain_id = os.getenv("BPMN_CHECKER_BRAIN_ID")
    
    # Fallback to signavio brain if specific checker brain not configured
    if not brain_id:
        brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    
    if not brain_id:
        return {
            "error": True,
            "message": "API Not Active",
            "detail": "BPMN_CHECKER_BRAIN_ID is not configured."
        }

    # Validate file type
    allowed_types = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
    allowed_extensions = ['.pdf', '.jpg', '.jpeg', '.png']
    
    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ''
    is_valid = (
        (file.content_type and file.content_type in allowed_types) or
        file_ext in allowed_extensions
    )
    
    if not is_valid:
        return {
            "error": True,
            "message": "Invalid file type",
            "detail": "Please upload a PDF or image file (JPG, JPEG, PNG) containing your BPMN diagram."
        }

    # Create a chat history
    chat_result = await create_chat_history(brain_id)
    if chat_result.get("error"):
        return chat_result

    chat_history_id = chat_result.get("chatHistoryId")
    
    if not chat_history_id:
        return {
            "error": True,
            "message": "Failed to create chat session",
            "detail": "Chat history ID is empty or null."
        }

    # Upload the file as an attachment
    upload_result = await upload_attachments(brain_id, [file])
    if upload_result.get("error"):
        return upload_result

    attachment_ids = upload_result.get("attachmentIds", [])
    
    if not attachment_ids or len(attachment_ids) == 0:
        return {
            "error": True,
            "message": "Attachment upload failed",
            "detail": "No attachment IDs returned from upload."
        }

    # Build the analysis prompt
    prompt = build_checker_prompt(file.filename, context)

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
        return response

    result_text = response.get("result", "")

    # Try to parse structured JSON; fall back to plain text if parsing fails
    structured = None
    if isinstance(result_text, str):
        txt = result_text.strip()
        # Some providers may wrap JSON in code fences; try to strip them
        if txt.startswith("```"):
            # remove first and last fenced block if present
            lines = [l for l in txt.splitlines() if not l.strip().startswith("```")]
            txt = "\n".join(lines).strip()
        try:
            import json
            structured = json.loads(txt)
        except Exception:
            structured = None

    return {
        "result": result_text,
        "structured": structured,
        "chatHistoryId": chat_history_id,
    }
