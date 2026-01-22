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


def build_checker_prompt(filename: str, context: Optional[str] = None) -> str:
    """Build a simple analysis prompt - detailed instructions are in Brain workflow."""
    prompt = f"Analyze this BPMN diagram: {filename}"
    
    if context and context.strip():
        prompt += f" | Context: {context}"
    
    return prompt


async def check_bpmn_diagram(file: UploadFile, context: Optional[str] = None) -> dict:
    """Analyze a BPMN diagram for errors, best practices, and quality."""
    
    # Check if file is provided
    if not file or not file.filename:
        return {
            "error": True,
            "message": "No file uploaded",
            "detail": "Please upload a BPMN diagram (PDF, JPG, or PNG) to analyze."
        }
    
    brain_id = os.getenv("BPMN_CHECKER_BRAIN_ID")
    
    # Fallback to signavio brain if specific checker brain not configured
    if not brain_id:
        brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    
    if not brain_id:
        return {
            "error": True,
            "message": "Service unavailable",
            "detail": "BPMN analysis service is not configured. Please contact support."
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
            "message": "Unsupported file format",
            "detail": f"'{file.filename}' is not supported. Please upload a PDF or image (JPG, PNG)."
        }

    # Create a chat history
    chat_result = await create_chat_history(brain_id)
    if chat_result.get("error"):
        return {
            "error": True,
            "message": "Connection failed",
            "detail": "Unable to start analysis session. Please try again."
        }

    chat_history_id = chat_result.get("chatHistoryId")
    
    if not chat_history_id:
        return {
            "error": True,
            "message": "Session error",
            "detail": "Failed to initialize analysis. Please try again."
        }

    # Upload the file as an attachment
    upload_result = await upload_attachments(brain_id, [file])
    if upload_result.get("error"):
        return {
            "error": True,
            "message": "Upload failed",
            "detail": "Could not process your file. Please ensure it's a valid image or PDF and try again."
        }

    attachment_ids = upload_result.get("attachmentIds", [])
    
    if not attachment_ids:
        return {
            "error": True,
            "message": "Upload failed",
            "detail": "File was not uploaded successfully. Please try again."
        }

    # Build the simple prompt (detailed instructions are in Brain workflow)
    prompt = build_checker_prompt(file.filename, context)

    # Call the Brain API
    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        attachment_ids=attachment_ids,
        workflow_id=BPMN_CHECKER_WORKFLOW_ID,
    )

    if response.get("error"):
        return {
            "error": True,
            "message": "Analysis failed",
            "detail": "Unable to analyze the diagram. Please try again or upload a different file."
        }

    return {
        "result": response.get("result", ""),
        "chatHistoryId": chat_history_id
    }
