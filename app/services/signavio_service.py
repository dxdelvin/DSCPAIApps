"""
Signavio BPMN Generation Service.
Handles BPMN XML generation from process descriptions.
"""
import os
import re
from typing import Optional
from app.services.common_service import call_brain_workflow_chat


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
