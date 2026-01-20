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
    "You are a BPMN 2.0 expert. Analyze the uploaded BPMN diagram image/PDF carefully. "
    "Identify structural errors, gateway issues, flow logic problems, naming issues, and best practice violations. "
    "Provide a quality score from 0-100 and categorize findings as errors (critical), warnings, or suggestions. "
    "Format your response with clear markdown sections. Do not ask follow-up questions."
)


def build_checker_prompt(filename: str, context: Optional[str] = None) -> str:
    """Build the analysis prompt for BPMN diagram checking."""
    prompt = f"""You are a BPMN 2.0 expert. Carefully analyze the uploaded BPMN diagram image/PDF.

FIRST, describe what you see in the diagram - the process flow, elements, pools, lanes, gateways, tasks, events, etc.

THEN, identify any issues and provide actionable solutions.

## OUTPUT FORMAT:

### 📊 Diagram Overview
Describe the BPMN diagram: What process does it represent? What are the main elements you can see?

### 🔍 Findings & Solutions

For each issue found, use this format:

**Problem:** [Describe what is wrong or could be improved]
**Solution:** [Provide a specific, actionable fix the user can implement]

---

(List all findings with problems and solutions separated by ---)

### ✅ What's Done Well
List any positive aspects of the diagram (good practices, clear labeling, proper structure, etc.)

### 📝 Overall Assessment
Provide a brief summary with:
- Quality Score: X/100
- Main strengths
- Priority actions to take

File being analyzed: {filename}"""

    if context:
        prompt += f"\n\nAdditional context from user: {context}"
    
    return prompt


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

    return {
        "result": response.get("result", ""),
        "chatHistoryId": chat_history_id
    }
