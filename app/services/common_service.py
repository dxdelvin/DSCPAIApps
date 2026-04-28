"""
Common service utilities shared across all Brain-based features.
Contains chat history, file uploads, and API calling functions.
"""
import httpx
import os
import re
import logging
from typing import Optional, List, Tuple, Dict
from fastapi import HTTPException, UploadFile
from app.services.brain_auth import get_brain_access_token
from app.core.config import BRAIN_API_BASE_URL, get_ssl_context

logger = logging.getLogger(__name__)

logger = logging.getLogger(__name__)

_SAFE_FILENAME_RE = re.compile(r'[^a-zA-Z0-9._\- ]')

_MAX_PDF_CHARS = 90000
_MIN_MEANINGFUL_CHARS = 80


def extract_pdf_text(pdf_bytes: bytes) -> tuple[str | None, str | None]:
    """Extract text from a PDF using PyMuPDF (fitz).

    Returns (text, error). On success error is None; on failure text is None.
    """
    try:
        import fitz

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages: list[str] = []
        has_content = False
        for page in doc:
            text = page.get_text().strip()
            page_num = page.number + 1
            if text:
                pages.append(f"--- Page {page_num} ---\n{text}")
                has_content = True
            else:
                pages.append(f"--- Page {page_num} ---\n(No extractable text)")
        doc.close()

        if not has_content:
            return None, "No readable text found in the PDF. The file may be image-based or scanned."

        full_text = "\n\n".join(pages)
        full_text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', full_text)

        if len(full_text) > _MAX_PDF_CHARS:
            full_text = full_text[:_MAX_PDF_CHARS] + "\n\n[Content truncated at 90K characters. Only first portion processed.]"

        clean = re.sub(r'---\s*Page\s*\d+\s*---', '', full_text)
        clean = re.sub(r'\(No extractable text\)', '', clean).strip()
        if len(clean) < _MIN_MEANINGFUL_CHARS:
            return None, (
                "The PDF appears to be image-based or scanned. "
                "Only minimal text could be extracted (less than 80 characters). "
                "Please use a text-based PDF for best results."
            )
        return full_text, None
    except ImportError:
        return None, "PDF processing library (PyMuPDF) is not installed on the server."
    except Exception as e:
        return None, f"PDF text extraction failed: {str(e)}"


def sanitize_filename_for_prompt(filename: str) -> str:
    """Strip dangerous characters from a filename before embedding it in a prompt."""
    if not filename:
        return "uploaded_file"
    name = _SAFE_FILENAME_RE.sub('', filename)
    return name[:200] or "uploaded_file"


def _require_env(value: str, name: str) -> str:
    """Validate required environment variable."""
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing configuration: {name}")
    return value


def _friendly_http_error(e: "httpx.HTTPStatusError", context: str = "AI service") -> dict:
    status_code = e.response.status_code
    logger.error("%s returned HTTP %s", context, status_code)
    logger.error("%s returned HTTP %s", context, status_code)

    messages = {
        400: ("Invalid Request", "The request was rejected by the AI service. Please check your inputs and try again."),
        401: ("Authentication Error", "The AI service rejected the request due to an authentication issue. Please contact your administrator."),
        403: ("Access Denied", "The AI service could not be reached. This is usually a temporary access restriction - please try again in a moment."),
        404: ("Service Not Found", "The requested AI service endpoint was not found. Please contact your administrator."),
        429: ("Too Many Requests", "The AI service is currently rate-limited. Please wait a moment and try again."),
        500: ("AI Service Error", "The AI service encountered an internal error. Please try again."),
        502: ("Upstream Service Error", "The AI service returned an invalid response. Please try again."),
        503: ("AI Service Unavailable", "The AI service is temporarily unavailable. Please try again in a few minutes."),
        504: ("Gateway Timeout", "The AI service took too long to respond. Please try again."),
    }
    title, detail = messages.get(status_code, (
        "AI Service Error",
        f"The AI service returned an unexpected error (HTTP {status_code}). Please try again.",
    ))
    return {"error": True, "message": title, "detail": detail}


def _get_base_url_and_headers(token: str) -> Tuple[str, dict]:
    base_url = BRAIN_API_BASE_URL
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "PostmanRuntime/7.37.3",
        "Content-Type": "application/json"
    }
    
    return base_url, headers


async def create_chat_history(brain_id: str) -> dict:
    """Create an empty chat history for a given knowledgeBaseId."""
    _require_env(brain_id, "knowledgeBaseId")
    logger.info("Creating chat history for brain_id: %s", brain_id[:8] + "...")
    
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
            logger.info("Chat history created successfully: %s", chat_history_id[:16] + "...")
            return {"chatHistoryId": chat_history_id}
        except httpx.HTTPStatusError as e:
            logger.error("Failed to create chat history: HTTP %s", e.response.status_code)
            return _friendly_http_error(e, "create_chat_history")
        except httpx.RequestError as e:
            logger.error("Connection error creating chat history: %s", str(e))
            return {
                "error": True,
                "message": "Connection Error",
                "detail": "Could not connect to the AI service. Please check your network and try again.",
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
            return {"attachmentIds": attachment_ids}
        except httpx.HTTPStatusError as e:
            return _friendly_http_error(e, "upload_attachments")
        except httpx.RequestError as e:
            return {
                "error": True,
                "message": "Connection Error",
                "detail": "Could not connect to the AI service. Please check your network and try again.",
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
    if attachment_ids:
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
            return _friendly_http_error(e, "call_brain_workflow_chat")
        except httpx.RequestError as e:
            return {
                "error": True,
                "message": "Connection Error",
                "detail": "Could not connect to the AI service. Please check your network and try again.",
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
    logger.info("Calling Brain pure LLM chat: brain_id=%s, chat_history=%s, attachments=%s, timeout=%ss",
               brain_id[:8] + "...", bool(chat_history_id), len(attachment_ids) if attachment_ids else 0, timeout_seconds)

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
    if attachment_ids:
        payload["attachmentIds"] = attachment_ids
    if custom_behaviour:
        payload["customMessageBehaviour"] = custom_behaviour

    client_kwargs = {"verify": get_ssl_context(), "trust_env": True}

    async with httpx.AsyncClient(**client_kwargs) as client:
        try:
            response = await client.post(url, json=payload, headers=headers, timeout=timeout_seconds)
            response.raise_for_status()
            data = response.json()
            logger.info("Brain API call successful")
            return {
                "result": data.get("result", ""),
                "chatHistoryId": data.get("chatHistoryId", chat_history_id),
            }
        except httpx.TimeoutException as e:
            logger.error("Brain API timeout after %s seconds", timeout_seconds)
            return {
                "error": True,
                "message": "Request Timed Out",
                "detail": f"The AI service took too long to respond (timeout: {timeout_seconds}s). Try reducing file size or simplifying your request.",
            }
        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            logger.error("Brain API HTTP error: %s - %s", status_code, e.response.text[:200])
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
            return _friendly_http_error(e, "call_brain_pure_llm_chat")
        except httpx.RequestError as e:
            logger.error("Brain API connection error: %s", str(e))
            return {
                "error": True,
                "message": "Connection Error",
                "detail": "Could not connect to the AI service. Please check your network and try again.",
            }
