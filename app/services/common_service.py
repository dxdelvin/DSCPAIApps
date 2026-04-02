"""
Common service utilities shared across all Brain-based features.
Contains chat history, file uploads, and API calling functions.
"""
import httpx
import os
import re
from typing import Optional, List, Tuple, Dict
from fastapi import HTTPException, UploadFile
from app.services.brain_auth import get_brain_access_token
from app.core.config import BRAIN_API_BASE_URL, get_ssl_context

_SAFE_FILENAME_RE = re.compile(r'[^a-zA-Z0-9._\- ]')


def sanitize_filename_for_prompt(filename: str) -> str:
    """Strip dangerous characters from a filename before embedding it in a prompt."""
    if not filename:
        return "uploaded_file"
    name = _SAFE_FILENAME_RE.sub('', filename)
    return name[:200] or "uploaded_file"


def _require_env(value: str, name: str) -> str:
    """Check if the env files are working or not! Just DEBUG in UI"""
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing configuration: {name}")
    return value


def _get_base_url_and_headers(token: str) -> Tuple[str, dict]:
    """Get base URL and headers."""
    base_url = BRAIN_API_BASE_URL
    
    # Build headers
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "PostmanRuntime/7.37.3",
        "Content-Type": "application/json"
    }
    
    return base_url, headers


async def create_chat_history(brain_id: str) -> dict:
    """Create an empty chat history for a given knowledgeBaseId."""
    _require_env(brain_id, "knowledgeBaseId")
    
    token = await get_brain_access_token()
    base_url, headers = _get_base_url_and_headers(token)
    _require_env(base_url, "BRAIN_API_BASE_URL")
    
    url = f"{base_url}/chat-histories/{brain_id}"
    
    client_kwargs = {"verify": get_ssl_context(), "trust_env": True}
    
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
    base_url, _ = _get_base_url_and_headers(token)
    _require_env(base_url, "BRAIN_API_BASE_URL")
    
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
    
    client_kwargs = {"verify": get_ssl_context(), "trust_env": True}
    
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
            # print(f"DEBUG: Files uploaded successfully, IDs: {attachment_ids}")
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
    base_url, headers = _get_base_url_and_headers(token)
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

    client_kwargs = {"verify": get_ssl_context(), "trust_env": True}

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
    base_url, headers = _get_base_url_and_headers(token)
    _require_env(base_url, "BRA                         IN_API_BASE_URL")

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

    client_kwargs = {"verify": get_ssl_context(), "trust_env": True}

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
    timeout_seconds: float = 120.0,
) -> dict:
    """Call DIA Brain pure LLM chat endpoint.

    This endpoint does not use retrieval augmentation from the knowledge base
    but can still maintain conversation via `chatHistoryId` and accept `attachmentIds`.

    Returns dict with 'result', 'chatHistoryId', and optionally 'error' fields.
    """
    _require_env(brain_id, "knowledgeBaseId")

    token = await get_brain_access_token()
    base_url, headers = _get_base_url_and_headers(token)
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

    client_kwargs = {"verify": get_ssl_context(), "trust_env": True}

    async with httpx.AsyncClient(**client_kwargs) as client:
        try:
            response = await client.post(url, json=payload, headers=headers, timeout=timeout_seconds)
            response.raise_for_status()
            data = response.json()
            return {
                "result": data.get("result", ""),
                "chatHistoryId": data.get("chatHistoryId", chat_history_id),
            }
        except httpx.TimeoutException as e:
            return {
                "error": True,
                "message": "Request Timed Out",
                "detail": f"The AI service took too long to respond: {e}",
            }
        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            if status_code == 504:
                return {
                    "error": True,
                    "message": "Gateway Timeout",
                    "detail": "The AI service took too long while processing this diagram. This usually happens with dense or highly detailed images. Try a cleaner crop, a straighter screenshot, or split the diagram into smaller sections.",
                }
            if status_code == 503:
                return {
                    "error": True,
                    "message": "AI Service Unavailable",
                    "detail": "The AI service is temporarily unavailable. Please try again in a few minutes.",
                }
            if status_code == 502:
                return {
                    "error": True,
                    "message": "Upstream Service Error",
                    "detail": "The AI service returned an invalid response while processing the diagram. Please try again.",
                }
            return {
                "error": True,
                "message": "AI Service Error",
                "detail": f"Status {e.response.status_code}: {e.response.text}",
            }
        except httpx.RequestError as e:
            return {
                "error": True,
                "message": "Connection Error",
                "detail": f"Connection error: {e}",
            }
