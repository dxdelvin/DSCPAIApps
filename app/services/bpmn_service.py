import httpx
import os
import re
from typing import Optional, List, Tuple
from fastapi import HTTPException, UploadFile
from app.services.brain_auth import get_brain_access_token


def _extract_xml(text: str) -> str:
    """Extract BPMN XML from the AI response"""
    pattern = r"(<\?xml.*?<bpmn2?:definitions.*?</bpmn2?:definitions>)"
    match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()

    secondary_pattern = r"(<bpmn2?:definitions.*?</bpmn2?:definitions>)"
    secondary_match = re.search(secondary_pattern, text, re.DOTALL | re.IGNORECASE)
    if secondary_match:
        return secondary_match.group(1).strip()

    return text.strip()


def _require_env(value: str, name: str) -> str:
    """Check if the env files are working or not! Just DEBUG in UI"""
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing configuration: {name}")
    return value


def _get_proxy_and_headers(token: str) -> Tuple[str, dict]:
    """Set up proxy and return common headers."""
    proxy_url = "http://rb-proxy-de.bosch.com:8080"
    os.environ["HTTP_PROXY"] = proxy_url
    os.environ["HTTPS_PROXY"] = proxy_url
    
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "PostmanRuntime/7.37.3",
        "Content-Type": "application/json"
    }
    return proxy_url, headers


async def create_chat_history(brain_id: str) -> dict:
    """Create an empty chat history for a given knowledgeBaseId."""
    base_url = os.getenv("BRAIN_API_BASE_URL")
    _require_env(base_url, "BRAIN_API_BASE_URL")
    _require_env(brain_id, "knowledgeBaseId")
    
    token = await get_brain_access_token()
    _, headers = _get_proxy_and_headers(token)
    
    url = f"{base_url}/chat-histories/{brain_id}"
    
    async with httpx.AsyncClient(verify=False, trust_env=True) as client:
        try:
            response = await client.post(url, headers=headers, timeout=30.0)
            response.raise_for_status()
            # The API returns the chat history ID as a string
            chat_history_id = response.text.strip().strip('"')
            return {"chatHistoryId": chat_history_id}
        except httpx.HTTPStatusError as e:
            return {
                "error": True,
                "message": "Failed to create chat history",
                "detail": f"Status {e.response.status_code}: {e.response.text}"
            }
        except httpx.RequestError as e:
            return {
                "error": True,
                "message": "Failed to create chat history",
                "detail": f"Connection error: {e}"
            }


async def upload_attachments(brain_id: str, files: List[UploadFile]) -> dict:
    """Upload files as attachments for a knowledge base and return their IDs."""
    base_url = os.getenv("BRAIN_API_BASE_URL")
    _require_env(base_url, "BRAIN_API_BASE_URL")
    _require_env(brain_id, "knowledgeBaseId")
    
    token = await get_brain_access_token()
    proxy_url = "http://rb-proxy-de.bosch.com:8080"
    os.environ["HTTP_PROXY"] = proxy_url
    os.environ["HTTPS_PROXY"] = proxy_url
    
    url = f"{base_url}/chat-attachments"
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "PostmanRuntime/7.37.3"
    }
    
    # Prepare multipart form data
    files_data = []
    for file in files:
        content = await file.read()
        files_data.append(("files", (file.filename, content, file.content_type)))
        await file.seek(0)  # Reset file pointer
    
    async with httpx.AsyncClient(verify=False, trust_env=True) as client:
        try:
            response = await client.post(
                url,
                headers=headers,
                data={"knowledgeBaseId": brain_id},
                files=files_data,
                timeout=60.0
            )
            response.raise_for_status()
            attachment_ids = response.json()
            print(f"DEBUG UPLOAD: Response status {response.status_code}, attachment_ids type: {type(attachment_ids)}, value: {attachment_ids}")
            return {"attachmentIds": attachment_ids}
        except httpx.HTTPStatusError as e:
            return {
                "error": True,
                "message": "Failed to upload attachments",
                "detail": f"Status {e.response.status_code}: {e.response.text}"
            }
        except httpx.RequestError as e:
            return {
                "error": True,
                "message": "Failed to upload attachments",
                "detail": f"Connection error: {e}"
            }


async def call_brain_chat(
    brain_id: str, 
    prompt: str, 
    *, 
    use_gpt_knowledge: bool = True, 
    chat_history_id: Optional[str] = None,
    attachment_ids: Optional[List[str]] = None,
    custom_behaviour: Optional[str] = None
) -> dict:
    """Call DIA Brain retrieval-augmented chat with the provided Brain (knowledgeBaseId).
    
    Args:
        custom_behaviour: Optional custom message behaviour to modify agent response style.
    
    Returns dict with 'result', 'chatHistoryId', and optionally 'error' fields.
    """
    base_url = os.getenv("BRAIN_API_BASE_URL")
    _require_env(base_url, "BRAIN_API_BASE_URL")
    _require_env(brain_id, "knowledgeBaseId")

    token = await get_brain_access_token()
    _, headers = _get_proxy_and_headers(token)

    url = f"{base_url}/chat/retrieval-augmented"
    payload = {
        "prompt": prompt,
        "knowledgeBaseId": brain_id,
        "useGptKnowledge": use_gpt_knowledge,
    }
    if chat_history_id:
        payload["chatHistoryId"] = chat_history_id
    if attachment_ids and len(attachment_ids) > 0:
        payload["attachmentIds"] = attachment_ids
    if custom_behaviour:
        payload["customMessageBehaviour"] = custom_behaviour

    async with httpx.AsyncClient(verify=False, trust_env=True) as client:
        try:
            response = await client.post(url, json=payload, headers=headers, timeout=120.0)
            response.raise_for_status()
            data = response.json()
            return {
                "result": data.get("result", ""),
                "chatHistoryId": data.get("chatHistoryId", chat_history_id)
            }
        except httpx.HTTPStatusError as e:
            return {
                "error": True,
                "message": "API Not Active",
                "detail": f"Status {e.response.status_code}: {e.response.text}"
            }
        except httpx.RequestError as e:
            return {
                "error": True,
                "message": "API Not Active",
                "detail": f"Connection error: {e}"
            }


async def call_brain_pure_llm_chat(
    brain_id: str,
    prompt: str,
    *,
    chat_history_id: Optional[str] = None,
    attachment_ids: Optional[List[str]] = None,
    custom_behaviour: Optional[str] = None,
) -> dict:
    """Call DIA Brain pure LLM chat endpoint.

    This endpoint does not use retrieval augmentation from the knowledge base
    but can still maintain conversation via `chatHistoryId` and accept `attachmentIds`.

    Returns dict with 'result', 'chatHistoryId', and optionally 'error' fields.
    """
    base_url = os.getenv("BRAIN_API_BASE_URL")
    _require_env(base_url, "BRAIN_API_BASE_URL")
    _require_env(brain_id, "knowledgeBaseId")

    token = await get_brain_access_token()
    _, headers = _get_proxy_and_headers(token)

    url = f"{base_url}/chat/pure-llm"
    payload = {
        "prompt": prompt,
        "knowledgeBaseId": brain_id,
    }
    if chat_history_id:
        payload["chatHistoryId"] = chat_history_id
    if attachment_ids and len(attachment_ids) > 0:
        payload["attachmentIds"] = attachment_ids
    if custom_behaviour:
        payload["customMessageBehaviour"] = custom_behaviour

    async with httpx.AsyncClient(verify=False, trust_env=True) as client:
        try:
            response = await client.post(url, json=payload, headers=headers, timeout=120.0)
            response.raise_for_status()
            data = response.json()
            return {
                "result": data.get("result", ""),
                "chatHistoryId": data.get("chatHistoryId", chat_history_id),
            }
        except httpx.HTTPStatusError as e:
            return {
                "error": True,
                "message": "API Not Active",
                "detail": f"Status {e.response.status_code}: {e.response.text}",
            }
        except httpx.RequestError as e:
            return {
                "error": True,
                "message": "API Not Active",
                "detail": f"Connection error: {e}",
            }


async def call_brain_workflow_chat(
    brain_id: str,
    prompt: str,
    *,
    chat_history_id: Optional[str] = None,
    attachment_ids: Optional[List[str]] = None,
    custom_behaviour: Optional[str] = None,
    workflow_id: Optional[str] = None,
) -> dict:
    """Call DIA Brain workflow chat endpoint (designed for attachments and complex workflows).
    
    Args:
        custom_behaviour: Optional custom message behaviour to modify agent response style.
        workflow_id: Optional workflowId to route the request to a specific workflow.
    
    Returns dict with 'result', 'chatHistoryId', and optionally 'error' fields.
    """
    base_url = os.getenv("BRAIN_API_BASE_URL")
    _require_env(base_url, "BRAIN_API_BASE_URL")
    _require_env(brain_id, "knowledgeBaseId")

    token = await get_brain_access_token()
    _, headers = _get_proxy_and_headers(token)

    url = f"{base_url}/chat/workflow"
    payload = {
        "prompt": prompt,
        "knowledgeBaseId": brain_id,
    }
    if chat_history_id:
        payload["chatHistoryId"] = chat_history_id
    if attachment_ids and len(attachment_ids) > 0:
        payload["attachmentIds"] = attachment_ids
    if custom_behaviour:
        payload["customMessageBehaviour"] = custom_behaviour
    if workflow_id:
        payload["workflowId"] = workflow_id

    async with httpx.AsyncClient(verify=False, trust_env=True) as client:
        try:
            response = await client.post(url, json=payload, headers=headers, timeout=120.0)
            response.raise_for_status()
            data = response.json()
            return {
                "result": data.get("result", ""),
                "chatHistoryId": data.get("chatHistoryId", chat_history_id)
            }
        except httpx.HTTPStatusError as e:
            return {
                "error": True,
                "message": "API Not Active",
                "detail": f"Status {e.response.status_code}: {e.response.text}"
            }
        except httpx.RequestError as e:
            return {
                "error": True,
                "message": "API Not Active",
                "detail": f"Connection error: {e}"
            }


def _build_bpmn_prompt(data: dict) -> str:
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


def _build_analysis_prompt(data: dict) -> str:
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


# Custom behaviour instructions for the Brain
ANALYSIS_BEHAVIOUR = "Provide a structured analysis of the BPMN process. Do NOT generate any XML or code. Format your response with clear sections using markdown headers."
BPMN_GENERATE_BEHAVIOUR = (
    "Generate complete Signavio-compatible BPMN 2.0 XML code for the process. "
    "Only provide the XML code, no explanations. "
    "If any prior documentation conflicts with the user's provided details, ignore the documentation and follow the user's details. "
    "If information is missing, make reasonable assumptions and still produce a complete, valid BPMN XML."
)

# Audit behaviour: no follow-up questions. If no screenshots are present, clearly state
# that the document cannot be audited.
AUDIT_NO_FOLLOWUPS_BEHAVIOUR = (
    "Evaluate only the uploaded document. "
    "If the document does not contain screenshots, explicitly state that it cannot be audited."
)

# BPMN Diagram Checker behaviour: analyze diagrams for errors and best practices
BPMN_DIAGRAM_CHECK_BEHAVIOUR = (
    "You are a BPMN 2.0 expert. Analyze the uploaded BPMN diagram image/PDF carefully. "
    "Identify structural errors, gateway issues, flow logic problems, naming issues, and best practice violations. "
    "Provide a quality score from 0-100 and categorize findings as errors (critical), warnings, or suggestions. "
    "Format your response with clear markdown sections. Do not ask follow-up questions."
)

# Workflow IDs for routing to specific Brain workflows
SIGNAVIO_WORKFLOW_ID = "FA24GU3iEMCW"
AUDIT_WORKFLOW_ID = "tTyekWiuJ28g"
BPMN_CHECKER_WORKFLOW_ID = "FA24GU3iEMCW"  # Uses same workflow as Signavio


async def get_signavio_bpmn_xml(data: dict, chat_history_id: str = None) -> dict:
    """Generate BPMN XML using the chat history context."""
    prompt = "Generate the BPMN XML for this process now." if chat_history_id else _build_bpmn_prompt(data)
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
    print("\n" + "="*50)
    print("DEBUG: RAW BRAIN RESPONSE")
    print("="*50)
    print(raw_text)
    print("="*50 + "\n")
    extracted_xml = _extract_xml(raw_text)

    if "<bpmn" not in extracted_xml.lower():
        return {
            "error": True,
            "message": "Invalid BPMN response",
            "detail": "Brain response did not contain BPMN XML."
        }

    return {"result": extracted_xml}