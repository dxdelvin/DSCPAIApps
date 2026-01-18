"""
Audit Check Service.
Handles document auditing and compliance checking.
"""
import os
from typing import Optional, List
from fastapi import UploadFile
from app.services.common_service import (
    create_chat_history,
    upload_attachments,
    call_brain_workflow_chat,
)


# Audit-specific constants
AUDIT_WORKFLOW_ID = "tTyekWiuJ28g"

AUDIT_NO_FOLLOWUPS_BEHAVIOUR = (
    "Evaluate only the uploaded document. "
    "If the document does not contain screenshots, explicitly state that it cannot be audited."
)


async def check_audit_document(file: UploadFile) -> dict:
    """Analyze an uploaded audit PDF document."""
    brain_id = os.getenv("AUDIT_CHECK_BRAIN_ID")
    
    if not brain_id:
        return {
            "error": True,
            "message": "API Not Active",
            "detail": "AUDIT_CHECK_BRAIN_ID is not configured."
        }

    # Create a chat history first
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

    # Simple prompt - Brain agent handles the audit workflow
    prompt = f"Please check and analyze this audit document: {file.filename}"

    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        attachment_ids=attachment_ids,
        custom_behaviour=AUDIT_NO_FOLLOWUPS_BEHAVIOUR,
        workflow_id=AUDIT_WORKFLOW_ID,
    )

    if response.get("error"):
        return response

    return {
        "result": response.get("result", ""),
        "chatHistoryId": chat_history_id
    }


async def continue_audit_chat(
    chat_history_id: str,
    message: str,
    file: Optional[UploadFile] = None
) -> dict:
    """Continue audit conversation with optional file attachment."""
    brain_id = os.getenv("AUDIT_CHECK_BRAIN_ID")
    
    if not brain_id:
        return {
            "error": True,
            "message": "API Not Active",
            "detail": "AUDIT_CHECK_BRAIN_ID is not configured."
        }

    attachment_ids = None
    
    # Upload new file if provided
    if file and file.filename:
        upload_result = await upload_attachments(brain_id, [file])
        if upload_result.get("error"):
            return upload_result
        attachment_ids = upload_result.get("attachmentIds", [])
        if not attachment_ids or len(attachment_ids) == 0:
            attachment_ids = None

    response = await call_brain_workflow_chat(
        brain_id,
        message,
        chat_history_id=chat_history_id,
        attachment_ids=attachment_ids,
        custom_behaviour=AUDIT_NO_FOLLOWUPS_BEHAVIOUR,
        workflow_id=AUDIT_WORKFLOW_ID,
    )

    return response
