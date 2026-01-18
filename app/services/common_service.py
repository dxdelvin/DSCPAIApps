"""
Common service utilities shared across all Brain-based features.
Contains chat history, file uploads, and API calling functions.
"""
import httpx
import os
from typing import Optional, List, Tuple
from fastapi import HTTPException, UploadFile
from app.services.brain_auth import get_brain_access_token


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
    
    files_data = []
    for file in files:
        content = await file.read()
        files_data.append(("files", (file.filename, content, file.content_type)))
        await file.seek(0)
    
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
