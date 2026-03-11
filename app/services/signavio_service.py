"""
Signavio BPMN Generation Service.
Handles BPMN XML generation from process descriptions.
"""
import os
import re
from typing import Optional
from fastapi import UploadFile
from app.services.common_service import (
    create_chat_history,
    upload_attachments,
    call_brain_workflow_chat,
)


# Signavio-specific constants
SIGNAVIO_WORKFLOW_ID = "BW10nzxLhlqO"

ANALYSIS_BEHAVIOUR = (
    "Provide a structured analysis of the BPMN process. "
    "Do NOT generate any XML or code. "
    "Format your response with clear sections using markdown headers."
)

BPMN_GENERATE_BEHAVIOUR = (
    "Generate complete Signavio-compatible BPMN 2.0 XML code for the process. "
    "Only provide the XML code, no explanations. "
    "If any prior documentation conflicts with the user's provided details, ignore the documentation and follow the user's details. "
    "If information is missing, make reasonable assumptions and still produce a complete, valid BPMN XML."
)

UPLOAD_ANALYSIS_BEHAVIOUR = (
    "CRITICAL INSTRUCTION — You MUST follow this exactly. "
    "You are analyzing an uploaded file (image or PDF). "
    "Step 1: Determine if the content is a BPMN diagram, a flowchart, or text describing a business process. "
    "Step 2: Based on your determination, your VERY FIRST LINE must be one of these two tags — no exceptions: "
    "  • If it is NOT a BPMN diagram and NOT a business process description, your first line MUST be exactly: [NOT_BPMN] "
    "  • If it IS a BPMN diagram OR a business process description, your first line MUST be exactly: [BPMN_VALID] "
    "After the tag line, if NOT_BPMN: explain what the content actually is. Do NOT offer to create a BPMN. Do NOT ask for process details. "
    "After the tag line, if BPMN_VALID: provide a structured analysis of the process as-is, including participants, activities, gateways, events, and flow. "
    "Do NOT generate any XML. Do NOT try to improve or modify the process. "
    "Format the analysis body with clear sections using markdown headers."
)

# Fallback heuristics when the AI ignores prefix tags
_NOT_BPMN_INDICATORS = [
    "not a bpmn", "not bpmn", "not related to bpmn", "not a business process",
    "does not contain a bpmn", "does not include a bpmn", "no bpmn",
    "not process-related", "not a process", "photograph", "photo of",
    "does not appear to be", "cannot be used for bpmn", "unrelated to bpmn",
    "is not a flowchart", "not a flowchart", "does not depict a process",
    "i am ready to help you create", "please provide the following",
]


def _extract_xml(text: str) -> str:
    """Extract BPMN XML from the AI response."""
    pattern = r"(<\?xml.*?<bpmn2?:definitions.*?</bpmn2?:definitions>)"
    match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()

    secondary_pattern = r"(<bpmn2?:definitions.*?</bpmn2?:definitions>)"
    secondary_match = re.search(secondary_pattern, text, re.DOTALL | re.IGNORECASE)
    if secondary_match:
        return secondary_match.group(1).strip()

    return text.strip()


def build_bpmn_prompt(data: dict) -> str:
    """Structure the BPMN generation prompt to keep responses concise and XML-only."""
    return (
        "You are a expert BPMN 2.0 assistant. "
        "Generate a Signavio-compatible BPMN 2.0 XML for my following process. "
        f"Process Name: {data.get('processName', '')}\n"
        f"Pool: {data.get('poolName', '')}\n"
        f"Participants (lanes): {data.get('participants', '')}\n"
        f"Sublanes: {data.get('subLanes', '')}\n"
        f"Start Triggers: {data.get('startTriggers', '')}\n"
        f"Activities and Process Steps: {data.get('processActivities', '')}\n"
        f"End State: {data.get('processEnding', '')}\n"
        f"Intermediate/Delays: {data.get('intermediateEvents', '')}\n"
        f"Overrides/Notes: {data.get('reviewOverride', '')}\n"
    )


def build_analysis_prompt(data: dict) -> str:
    """Build a simple prompt with process inputs - Brain agent handles the analysis structure."""
    return f"""Analyze this BPMN process:

Process Name: {data.get('processName', 'Not specified')}
Pool/Department: {data.get('poolName', 'Not specified')}
Participants/Lanes: {data.get('participants', 'Not specified')}
Sub-lanes: {data.get('subLanes', 'Not specified')}
Start Triggers: {data.get('startTriggers', 'Not specified')}
Activities & Flow: {data.get('processActivities', 'Not specified')}
End States: {data.get('processEnding', 'Not specified')}
Delays/Intermediate Events: {data.get('intermediateEvents', 'Not specified')}
Additional Notes: {data.get('reviewOverride', 'None')}"""


async def get_signavio_bpmn_xml(data: dict, chat_history_id: Optional[str] = None) -> dict:
    """Generate BPMN XML using the chat history context."""
    prompt = "DSCP SIR GO GENERATE the BPMN XML for this process now." if chat_history_id else build_bpmn_prompt(data)
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    
    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        custom_behaviour=BPMN_GENERATE_BEHAVIOUR,
        workflow_id=SIGNAVIO_WORKFLOW_ID,
    )

    if response.get("error"):
        return response

    raw_text = response.get("result", "")
    extracted_xml = _extract_xml(raw_text)

    if "<bpmn" not in extracted_xml.lower():
        return {
            "error": True,
            "message": "Invalid BPMN response",
            "detail": "Brain response did not contain BPMN XML."
        }

    return {"result": extracted_xml}


async def analyze_process(data: dict, chat_history_id: Optional[str] = None) -> dict:
    """Get process analysis from Brain without generating XML."""
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    prompt = build_analysis_prompt(data)
    
    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        custom_behaviour=ANALYSIS_BEHAVIOUR,
        workflow_id=SIGNAVIO_WORKFLOW_ID,
    )
    
    return response


async def continue_chat(chat_history_id: str, message: str, form_data: dict = None) -> dict:
    """Continue a Signavio BPMN chat conversation."""
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    
    prompt = message
    if form_data:
        prompt = f"User request: {message}\n\nCurrent process context:\n{build_analysis_prompt(form_data)}"
    
    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        custom_behaviour=ANALYSIS_BEHAVIOUR,
        workflow_id=SIGNAVIO_WORKFLOW_ID,
    )
    
    return response


async def analyze_uploaded_bpmn(file: UploadFile) -> dict:
    """Analyze an uploaded BPMN diagram (PNG/PDF) using the Brain.
    
    Returns analysis with a bpmn_valid flag indicating if the content is BPMN-related.
    """
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")

    if not brain_id:
        return {
            "error": True,
            "message": "API Not Active",
            "detail": "SIGNAVIO_BRAIN_ID is not configured.",
        }

    # Create a chat history for this upload session
    chat_result = await create_chat_history(brain_id)
    if chat_result.get("error"):
        return chat_result

    chat_history_id = chat_result.get("chatHistoryId")
    if not chat_history_id:
        return {
            "error": True,
            "message": "Failed to create chat session",
            "detail": "Chat history ID is empty or null.",
        }

    # Upload the file as an attachment
    upload_result = await upload_attachments(brain_id, [file])
    if upload_result.get("error"):
        return upload_result

    attachment_ids = upload_result.get("attachmentIds", [])
    if not attachment_ids:
        return {
            "error": True,
            "message": "Attachment upload failed",
            "detail": "No attachment IDs returned from upload.",
        }

    prompt = (
        f"Analyze this uploaded file: {file.filename}. "
        "Is this a BPMN diagram, flowchart, or business process description? "
        "Remember: your first line MUST be [BPMN_VALID] or [NOT_BPMN]. "
        "Then provide your analysis."
    )

    response = await call_brain_workflow_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        attachment_ids=attachment_ids,
        custom_behaviour=UPLOAD_ANALYSIS_BEHAVIOUR,
        workflow_id=SIGNAVIO_WORKFLOW_ID,
    )

    if response.get("error"):
        return response

    result_text = response.get("result", "")
    stripped = result_text.strip()

    # Primary detection: explicit prefix tags
    if stripped.startswith("[NOT_BPMN]"):
        bpmn_valid = False
    elif stripped.startswith("[BPMN_VALID]"):
        bpmn_valid = True
    else:
        # Fallback: scan the response for non-BPMN indicator phrases
        lower_text = stripped.lower()
        has_not_bpmn_signal = any(ind in lower_text for ind in _NOT_BPMN_INDICATORS)
        bpmn_valid = not has_not_bpmn_signal

    # Strip the prefix tag from the displayed result
    clean_result = re.sub(r'^\[(?:NOT_BPMN|BPMN_VALID)\]\s*', '', stripped)

    return {
        "result": clean_result,
        "chatHistoryId": chat_history_id,
        "bpmn_valid": bpmn_valid,
    }
