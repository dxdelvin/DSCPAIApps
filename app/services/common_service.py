"""
Common service utilities shared across all Brain-based features.
Contains chat history, file uploads, and API calling functions.
"""
import httpx
import os
from typing import Optional, List, Tuple, Dict
from fastapi import HTTPException, UploadFile
from app.services.brain_auth import get_brain_access_token
from app.core.config import USE_SAP_CONNECTIVITY, DESTINATION_NAME, BRAIN_API_BASE_URL
from app.services.sap_connectivity_service import get_sap_connectivity


def _require_env(value: str, name: str) -> str:
    """Check if the env files are working or not! Just DEBUG in UI"""
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing configuration: {name}")
    return value


async def _get_sap_config() -> Tuple[Optional[str], Optional[Dict], Dict[str, str]]:
    """Get SAP connectivity configuration (base_url, proxies, proxy_headers)."""
    if USE_SAP_CONNECTIVITY:
        sap_conn = get_sap_connectivity()
        return await sap_conn.prepare_request_config(DESTINATION_NAME)
    return None, None, {}


async def _get_base_url_and_headers(token: str) -> Tuple[str, dict, Optional[Dict], Dict[str, str]]:
    """Get base URL, headers, proxies, and SAP proxy headers."""
    # Get SAP configuration if enabled
    sap_base_url, proxies, sap_proxy_headers = await _get_sap_config()
    
    # Use SAP destination URL if available, otherwise use env variable
    base_url = sap_base_url if sap_base_url else BRAIN_API_BASE_URL
    
    # Build headers
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "PostmanRuntime/7.37.3",
        "Content-Type": "application/json"
    }
    
    # Merge SAP proxy headers if available
    headers.update(sap_proxy_headers)
    
    return base_url, headers, proxies, sap_proxy_headers


async def create_chat_history(brain_id: str) -> dict:
    """Create an empty chat history for a given knowledgeBaseId."""
    _require_env(brain_id, "knowledgeBaseId")
    
    token = await get_brain_access_token()
    base_url, headers, proxies, _ = await _get_base_url_and_headers(token)
    _require_env(base_url, "BRAIN_API_BASE_URL")
    
    url = f"{base_url}/chat-histories/{brain_id}"
    
    client_kwargs = {"verify": False, "trust_env": not USE_SAP_CONNECTIVITY}
    if proxies:
        client_kwargs["proxies"] = proxies
    
    async with httpx.AsyncClient(**client_kwargs) as client:
        try:
            response = await client.post(url, headers=headers, timeout=30.0)
            response.raise_for_status()
            chat_history_id = response.text.strip().strip('"')
            return {"chatHistoryId": chat_history_id}
        except httpx.HTTPStatusError as e:
            return {
                "error": True,
                "message": "Failed to create chat history ",
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
    _require_env(brain_id, "knowledgeBaseId")
    
    token = await get_brain_access_token()
    base_url, _, proxies, sap_proxy_headers = await _get_base_url_and_headers(token)
    _require_env(base_url, "BRAIN_API_BASE_URL")
    
    url = f"{base_url}/chat-attachments"
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "PostmanRuntime/7.37.3"
    }
    headers.update(sap_proxy_headers)
    
    files_data = []
    for file in files:
        content = await file.read()
        files_data.append(("files", (file.filename, content, file.content_type)))
        await file.seek(0)
    
    client_kwargs = {"verify": False, "trust_env": not USE_SAP_CONNECTIVITY}
    if proxies:
        client_kwargs["proxies"] = proxies
    
    async with httpx.AsyncClient(**client_kwargs) as client:
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
    _require_env(brain_id, "knowledgeBaseId")

    token = await get_brain_access_token()
    base_url, headers, proxies, _ = await _get_base_url_and_headers(token)
    _require_env(base_url, "BRAIN_API_BASE_URL")

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

    client_kwargs = {"verify": False, "trust_env": not USE_SAP_CONNECTIVITY}
    if proxies:
        client_kwargs["proxies"] = proxies

    async with httpx.AsyncClient(**client_kwargs) as client:
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
    
    Returns dict with 'result', 'chatHistoryId', and optionally 'error' fields.
    """
    _require_env(brain_id, "knowledgeBaseId")

    token = await get_brain_access_token()
    base_url, headers, proxies, _ = await _get_base_url_and_headers(token)
    _require_env(base_url, "BRAIN_API_BASE_URL")

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

    client_kwargs = {"verify": False, "trust_env": not USE_SAP_CONNECTIVITY}
    if proxies:
        client_kwargs["proxies"] = proxies

    async with httpx.AsyncClient(**client_kwargs) as client:
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
    _require_env(brain_id, "knowledgeBaseId")

    token = await get_brain_access_token()
    base_url, headers, proxies, _ = await _get_base_url_and_headers(token)
    _require_env(base_url, "BRAIN_API_BASE_URL")

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

    client_kwargs = {"verify": False, "trust_env": not USE_SAP_CONNECTIVITY}
    if proxies:
        client_kwargs["proxies"] = proxies

    async with httpx.AsyncClient(**client_kwargs) as client:
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
