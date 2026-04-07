"""
Confluence Builder Service.
Generates Confluence storage-format drafts from uploaded files and publishes them
to Confluence using a Personal Access Token.
"""
import io
import json
import logging
import os
import re
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import UploadFile

from app.core.config import CONFLUENCE_PROXY, get_ssl_context
from app.services.common_service import (
    call_brain_pure_llm_chat,
    create_chat_history,
    upload_attachments,
)


DEFAULT_CONFLUENCE_URL = "https://inside-docupedia.bosch.com/confluence2"
MAX_DISPLAY_IMAGES = 10

# Allowlist — only HTTPS requests to these hostnames are permitted.
_CONFLUENCE_ALLOWED_HOSTS = {
    h.strip().lower()
    for h in os.getenv("CONFLUENCE_ALLOWED_HOSTS", "inside-docupedia.bosch.com").split(",")
    if h.strip()
}


def _get_confluence_client_kwargs() -> dict:
    """Base httpx.AsyncClient kwargs for all Confluence API calls.
    If CONFLUENCE_PROXY is set, routes traffic through it (needed on SAP BTP
    where direct access to inside-docupedia.bosch.com is blocked by SSO).
    """
    kwargs: dict = {"verify": get_ssl_context(), "trust_env": False}
    if CONFLUENCE_PROXY:
        kwargs["proxies"] = {"http://": CONFLUENCE_PROXY, "https://": CONFLUENCE_PROXY}
    return kwargs


def _validate_confluence_url(url: str) -> str:
    """Return the sanitized URL or raise ValueError if it fails the allowlist check."""
    raw = (url.strip() or DEFAULT_CONFLUENCE_URL).rstrip("/")
    try:
        parsed = urlparse(raw)
    except Exception:
        raise ValueError("Malformed Confluence URL.")
    if parsed.scheme != "https":
        raise ValueError("Confluence URL must use HTTPS.")
    host = (parsed.hostname or "").lower()
    if not any(host == allowed or host.endswith("." + allowed) for allowed in _CONFLUENCE_ALLOWED_HOSTS):
        raise ValueError(f"Confluence URL host '{host}' is not in the allowed list.")
    return raw

logger = logging.getLogger(__name__)
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".svg"}
PDF_EXTENSIONS = {".pdf"}
SUPPORTED_UPLOAD_EXTENSIONS = IMAGE_EXTENSIONS | PDF_EXTENSIONS | {
    ".txt",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".zip",
    ".msg",
}

GENERATE_BEHAVIOUR = (
    "You are a BSH documentation specialist who creates Confluence storage format content.\n"
    "Return ONLY valid JSON with these exact keys:\n"
    "{\n"
    '  "title": "string",\n'
    '  "summary": "string",\n'
    '  "storageXml": "string",\n'
    '  "warnings": ["string"]\n'
    "}\n\n"
    "Rules:\n"
    "1. The storageXml must be valid Confluence storage format markup, not markdown or plain HTML.\n"
    "2. Use only filenames explicitly provided in the prompt.\n"
    "3. Include every display image exactly once with <ac:image><ri:attachment ri:filename=\"...\" /></ac:image>.\n"
    "4. Use real Confluence storage tags when useful, including patterns like <ac:layout>, <ac:layout-section>, <ac:layout-cell>, <ac:image>, <ac:link>, and <ri:attachment>.\n"
    "5. Keep the page business-ready with headings, paragraphs, lists, tables, links, and layout sections when useful.\n"
    "6. If there are two related images, you may place them in a two-column <ac:layout-section ac:type=\"two_equal\"> block.\n"
    "7. If a title is provided by the user, use it exactly.\n"
    "8. Do not invent attachments, page IDs, or Confluence macros that depend on unknown metadata.\n"
    "9. Do not wrap the JSON in markdown fences.\n"
)

REFINE_BEHAVIOUR = (
    "You refine an existing Confluence storage-format draft.\n"
    "Return ONLY valid JSON with these exact keys:\n"
    "{\n"
    '  "title": "string",\n'
    '  "summary": "string",\n'
    '  "storageXml": "string",\n'
    '  "warnings": ["string"]\n'
    "}\n\n"
    "Rules:\n"
    "1. Preserve valid attachment filenames exactly as provided.\n"
    "2. Keep the output in Confluence storage format markup.\n"
    "3. Preserve or improve real Confluence storage structures such as <ac:layout>, <ac:image>, <ac:link>, and <ri:attachment> where relevant.\n"
    "4. Apply the user's changes across title, summary, and storage format where relevant.\n"
    "5. Do not wrap the JSON in markdown fences.\n"
)


def _is_image(filename: str) -> bool:
    return os.path.splitext(filename or "")[1].lower() in IMAGE_EXTENSIONS


def _is_pdf(filename: str) -> bool:
    return os.path.splitext(filename or "")[1].lower() in PDF_EXTENSIONS


def _sanitize_filename(filename: str) -> str:
    name = os.path.basename((filename or "").strip()) or "attachment"
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    name = re.sub(r'[<>:"/\\|?*]', "-", name)
    if not name:
        return "attachment"
    root, ext = os.path.splitext(name)
    root = root.strip(" .") or "attachment"
    ext = ext[:15]
    return f"{root}{ext}"


def _dedupe_filename(filename: str, used: set[str]) -> str:
    root, ext = os.path.splitext(filename)
    candidate = filename
    counter = 2
    while candidate.lower() in used:
        candidate = f"{root} ({counter}){ext}"
        counter += 1
    used.add(candidate.lower())
    return candidate


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _parse_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_warnings(value: Any) -> list[str]:
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _fallback_title(file_plan: list[dict[str, Any]]) -> str:
    first_ai_file = next((item for item in file_plan if item.get("useForAi")), None)
    if first_ai_file:
        base = os.path.splitext(first_ai_file["originalName"])[0].strip()
        if base:
            return base[:90]
    return "AI Confluence Draft"


def parse_upload_manifest(
    files: list[UploadFile],
    upload_manifest_json: str,
) -> tuple[list[dict[str, Any]] | None, list[str]]:
    try:
        raw_manifest = json.loads(upload_manifest_json or "[]")
    except json.JSONDecodeError:
        return None, ["Upload manifest is not valid JSON."]

    if not isinstance(raw_manifest, list):
        return None, ["Upload manifest must be a list."]

    if len(raw_manifest) != len(files):
        return None, ["Upload manifest does not match the number of uploaded files."]

    normalized: list[dict[str, Any]] = []
    errors: list[str] = []

    for index, (file, item) in enumerate(zip(files, raw_manifest), start=1):
        if not isinstance(item, dict):
            errors.append(f"Manifest entry {index} must be an object.")
            continue

        original_name = file.filename or item.get("name") or f"upload-{index}"
        extension = os.path.splitext(original_name)[1].lower()
        if extension not in SUPPORTED_UPLOAD_EXTENSIONS:
            errors.append(
                f"'{original_name}' is not supported. Allowed types: "
                f"{', '.join(sorted(SUPPORTED_UPLOAD_EXTENSIONS))}."
            )
            continue

        is_image = extension in IMAGE_EXTENSIONS
        is_pdf = extension in PDF_EXTENSIONS
        source_id = str(item.get("id") or f"file-{index}")
        display_in_page = _coerce_bool(item.get("displayInPage")) and is_image
        use_for_ai = _coerce_bool(item.get("useForAi")) and (is_image or is_pdf)
        attach_to_page = _coerce_bool(item.get("attachToPage")) or display_in_page
        display_order = _parse_int(item.get("displayOrder"), index)

        if _coerce_bool(item.get("displayInPage")) and not is_image:
            errors.append(f"'{original_name}' cannot be displayed in-page because it is not an image.")

        if _coerce_bool(item.get("useForAi")) and not (is_image or is_pdf):
            errors.append(f"'{original_name}' cannot be used for AI drafting because it is not a PDF or image.")

        normalized.append(
            {
                "sourceId": source_id,
                "index": index - 1,
                "originalName": original_name,
                "manifestName": str(item.get("name") or original_name),
                "extension": extension,
                "isImage": is_image,
                "isPdf": is_pdf,
                "displayInPage": display_in_page,
                "useForAi": use_for_ai,
                "attachToPage": attach_to_page,
                "displayOrder": display_order,
            }
        )

    if errors:
        return None, errors

    display_items = sorted(
        (item for item in normalized if item["displayInPage"]),
        key=lambda item: (item["displayOrder"], item["index"]),
    )
    if len(display_items) > MAX_DISPLAY_IMAGES:
        return None, [f"You can select at most {MAX_DISPLAY_IMAGES} display images."]

    used_names: set[str] = set()

    for position, item in enumerate(display_items, start=1):
        canonical_name = f"display-image-{position:02d}{item['extension']}"
        item["canonicalName"] = canonical_name
        item["displayOrder"] = position
        item["displaySlot"] = position
        used_names.add(canonical_name.lower())

    for item in normalized:
        if item.get("canonicalName"):
            continue
        if item["attachToPage"]:
            sanitized = _sanitize_filename(item["originalName"])
            item["canonicalName"] = _dedupe_filename(sanitized, used_names)
        else:
            item["canonicalName"] = None
        item["displaySlot"] = None

    return normalized, []


def extract_attachment_filenames(storage_xml: str) -> list[str]:
    if not storage_xml:
        return []
    matches = re.findall(r'ri:filename="([^"]+)"', storage_xml)
    deduped: list[str] = []
    seen: set[str] = set()
    for match in matches:
        if match not in seen:
            deduped.append(match)
            seen.add(match)
    return deduped


def build_draft_reference_state(
    file_plan: list[dict[str, Any]],
    storage_xml: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    referenced = set(extract_attachment_filenames(storage_xml))
    warnings: list[str] = []

    attachment_references: list[dict[str, Any]] = []
    display_images: list[dict[str, Any]] = []
    allowed_names: set[str] = set()

    for item in file_plan:
        canonical_name = item.get("canonicalName")
        if not canonical_name:
            continue

        allowed_names.add(canonical_name)
        payload = {
            "sourceId": item["sourceId"],
            "originalName": item["originalName"],
            "canonicalName": canonical_name,
            "attachToPage": bool(item["attachToPage"]),
            "displayInPage": bool(item["displayInPage"]),
            "useForAi": bool(item.get("useForAi")),
            "displayOrder": item.get("displayOrder"),
            "usedInXml": canonical_name in referenced,
        }
        attachment_references.append(payload)

        if item["displayInPage"]:
            display_images.append(
                {
                    "sourceId": item["sourceId"],
                    "originalName": item["originalName"],
                    "canonicalName": canonical_name,
                    "displayOrder": item["displayOrder"],
                    "usedInXml": canonical_name in referenced,
                }
            )

    unknown_references = sorted(name for name in referenced if name not in allowed_names)
    if unknown_references:
        warnings.append(
            "Storage format references attachment names that are not selected for upload: "
            + ", ".join(unknown_references)
        )

    missing_display_images = [
        item["canonicalName"] for item in display_images if not item["usedInXml"]
    ]
    if missing_display_images:
        warnings.append(
            "Some selected display images are not referenced in the storage format yet: "
            + ", ".join(missing_display_images)
        )

    display_images.sort(key=lambda item: item["displayOrder"] or 999)
    attachment_references.sort(
        key=lambda item: (
            0 if item["displayInPage"] else 1,
            item["displayOrder"] or 999,
            item["canonicalName"],
        )
    )

    return attachment_references, display_images, warnings


def draft_file_plan_from_draft(draft: dict[str, Any]) -> list[dict[str, Any]]:
    file_plan: list[dict[str, Any]] = []
    for item in draft.get("attachmentReferences", []):
        if not isinstance(item, dict):
            continue
        file_plan.append(
            {
                "sourceId": str(item.get("sourceId") or item.get("canonicalName") or "attachment"),
                "originalName": str(item.get("originalName") or item.get("canonicalName") or "attachment"),
                "canonicalName": str(item.get("canonicalName") or ""),
                "attachToPage": _coerce_bool(item.get("attachToPage")),
                "displayInPage": _coerce_bool(item.get("displayInPage")),
                "useForAi": _coerce_bool(item.get("useForAi")),
                "displayOrder": _parse_int(item.get("displayOrder"), 0),
            }
        )
    return file_plan


def _extract_pdf_text(pdf_bytes: bytes) -> tuple[str | None, str | None]:
    try:
        from PyPDF2 import PdfReader

        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages: list[str] = []
        meaningful_pages = 0

        for index, page in enumerate(reader.pages, start=1):
            page_text = (page.extract_text() or "").strip()
            if page_text:
                meaningful_pages += 1
                pages.append(f"--- Page {index} ---\n{page_text}")
            else:
                pages.append(f"--- Page {index} ---\n(No extractable text)")

        if not meaningful_pages:
            return None, "No readable text found in the PDF. It may be scanned or image-based."

        full_text = "\n\n".join(pages)
        full_text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", full_text)
        if len(full_text) > 90000:
            full_text = full_text[:90000] + "\n\n[Content truncated at 90K characters.]"
        return full_text, None
    except ImportError:
        return None, "PyPDF2 is not installed on the server."
    except Exception as exc:
        return None, f"PDF text extraction failed: {exc}"


def _parse_ai_json(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"```(?:json)?", "", text or "").strip().rstrip("`").strip()
    if not cleaned:
        return {}

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}

    return {}


def _default_summary(file_plan: list[dict[str, Any]]) -> str:
    ai_count = sum(1 for item in file_plan if item.get("useForAi"))
    attachment_count = sum(1 for item in file_plan if item.get("attachToPage"))
    return (
        f"AI generated a Confluence-ready draft from {ai_count} AI source file(s) "
        f"with {attachment_count} attachment(s) prepared for publishing."
    )


def normalize_draft(
    ai_payload: dict[str, Any],
    file_plan: list[dict[str, Any]],
    *,
    requested_title: str = "",
) -> dict[str, Any]:
    title = (ai_payload.get("title") or requested_title or _fallback_title(file_plan)).strip()
    summary = (ai_payload.get("summary") or _default_summary(file_plan)).strip()
    storage_xml = str(ai_payload.get("storageXml") or "").strip()
    warnings = _normalize_warnings(ai_payload.get("warnings"))

    attachment_references, display_images, validation_warnings = build_draft_reference_state(
        file_plan,
        storage_xml,
    )

    merged_warnings: list[str] = []
    seen: set[str] = set()
    for warning in warnings + validation_warnings:
        cleaned = warning.strip()
        if cleaned and cleaned not in seen:
            merged_warnings.append(cleaned)
            seen.add(cleaned)

    return {
        "title": title,
        "summary": summary,
        "storageXml": storage_xml,
        "attachmentReferences": attachment_references,
        "displayImages": display_images,
        "warnings": merged_warnings,
    }


def _build_generate_prompt(
    *,
    requested_title: str,
    instructions: str,
    file_plan: list[dict[str, Any]],
    extracted_pdf_blocks: list[str],
) -> str:
    display_images = [item for item in file_plan if item.get("displayInPage")]
    attachable_files = [item for item in file_plan if item.get("attachToPage") and not item.get("displayInPage")]
    ai_sources = [item for item in file_plan if item.get("useForAi")]

    prompt_parts = [
        "Create a business-ready Confluence page draft in Confluence storage format.",
        f"User requested title: {requested_title or '[Generate a concise title]'}",
        (
            "AI source files: "
            + ", ".join(item["originalName"] for item in ai_sources)
            if ai_sources
            else "AI source files: none"
        ),
    ]

    if display_images:
        prompt_parts.append(
            "Display images to include exactly once and in this order: "
            + ", ".join(
                f"{item['canonicalName']} (source: {item['originalName']})" for item in display_images
            )
        )
    else:
        prompt_parts.append("Display images to include: none")

    if attachable_files:
        prompt_parts.append(
            "Additional attachments available for optional link references: "
            + ", ".join(
                f"{item['canonicalName']} (source: {item['originalName']})" for item in attachable_files
            )
        )
    else:
        prompt_parts.append("Additional attachments available: none")

    if instructions:
        prompt_parts.append(f"User drafting instructions:\n{instructions}")

    if extracted_pdf_blocks:
        prompt_parts.append("Text extracted from uploaded PDF files:\n" + "\n\n".join(extracted_pdf_blocks))
    else:
        prompt_parts.append(
            "No PDF text was extracted. Base the structure on the uploaded images and the user's instructions."
        )

    prompt_parts.append(
        "Use clean, practical Confluence storage format structure. If there are display images, place them naturally in the body."
    )
    return "\n\n".join(prompt_parts)


def _build_refine_prompt(draft: dict[str, Any], instruction: str) -> str:
    attachment_names = [
        item["canonicalName"]
        for item in draft.get("attachmentReferences", [])
        if isinstance(item, dict) and item.get("canonicalName")
    ]
    display_names = [
        item["canonicalName"]
        for item in draft.get("displayImages", [])
        if isinstance(item, dict) and item.get("canonicalName")
    ]

    return (
        "Refine the current Confluence draft.\n\n"
        f"User instruction:\n{instruction}\n\n"
        "Allowed attachment filenames:\n"
        + ("\n".join(f"- {name}" for name in attachment_names) if attachment_names else "- none")
        + "\n\nDisplay images that must remain valid in the storage format:\n"
        + ("\n".join(f"- {name}" for name in display_names) if display_names else "- none")
        + "\n\nCurrent draft JSON:\n"
        + json.dumps(
            {
                "title": draft.get("title", ""),
                "summary": draft.get("summary", ""),
                "storageXml": draft.get("storageXml", ""),
                "warnings": draft.get("warnings", []),
            },
            ensure_ascii=True,
        )
    )


async def generate_confluence_builder_draft(
    files: list[UploadFile],
    upload_manifest_json: str,
    requested_title: str = "",
    instructions: str = "",
) -> dict[str, Any]:
    brain_id = os.getenv("DSCP_BRAIN_ID")
    if not brain_id:
        return {
            "error": True,
            "status_code": 500,
            "message": "API Not Active",
            "detail": "DSCP_BRAIN_ID is not configured.",
        }

    file_plan, manifest_errors = parse_upload_manifest(files, upload_manifest_json)
    if manifest_errors:
        return {
            "error": True,
            "status_code": 400,
            "message": "Invalid upload setup",
            "detail": " ".join(manifest_errors),
        }

    assert file_plan is not None

    ai_sources = [item for item in file_plan if item.get("useForAi")]
    if not ai_sources:
        return {
            "error": True,
            "status_code": 400,
            "message": "No AI source selected",
            "detail": "Select at least one PDF or image as an AI source before generating the draft.",
        }

    pdf_blocks: list[str] = []
    extraction_errors: list[str] = []
    image_ai_sources: list[UploadFile] = []

    for file, item in zip(files, file_plan):
        if not item["useForAi"]:
            continue
        if item["isPdf"]:
            file_bytes = await file.read()
            text, error = _extract_pdf_text(file_bytes)
            await file.seek(0)
            if error:
                extraction_errors.append(f"{item['originalName']}: {error}")
            elif text:
                pdf_blocks.append(f"=== File: {item['originalName']} ===\n{text}")
        elif item["isImage"]:
            image_ai_sources.append(file)

    if extraction_errors and not image_ai_sources and not pdf_blocks:
        return {
            "error": True,
            "status_code": 400,
            "message": "No readable AI content",
            "detail": " ".join(extraction_errors),
        }

    chat_result = await create_chat_history(brain_id)
    if chat_result.get("error"):
        return {
            "error": True,
            "status_code": 500,
            "message": chat_result.get("message", "Failed to start draft session"),
            "detail": chat_result.get("detail", "Could not create chat history."),
        }

    chat_history_id = chat_result.get("chatHistoryId")
    attachment_ids = None

    if image_ai_sources:
        upload_result = await upload_attachments(brain_id, image_ai_sources)
        if upload_result.get("error"):
            return {
                "error": True,
                "status_code": 500,
                "message": upload_result.get("message", "Image upload failed"),
                "detail": upload_result.get("detail", "Could not upload image sources."),
            }
        attachment_ids = upload_result.get("attachmentIds")

    prompt = _build_generate_prompt(
        requested_title=requested_title.strip(),
        instructions=instructions.strip(),
        file_plan=file_plan,
        extracted_pdf_blocks=pdf_blocks,
    )
    response = await call_brain_pure_llm_chat(
        brain_id,
        prompt,
        chat_history_id=chat_history_id,
        attachment_ids=attachment_ids,
        custom_behaviour=GENERATE_BEHAVIOUR,
    )

    if response.get("error"):
        return {
            "error": True,
            "status_code": 500,
            "message": response.get("message", "Draft generation failed"),
            "detail": response.get("detail", "The AI service could not generate the Confluence draft."),
        }

    parsed = _parse_ai_json(response.get("result", ""))
    if not parsed:
        return {
            "error": True,
            "status_code": 500,
            "message": "Could not parse AI response",
            "detail": "The AI did not return a valid JSON draft.",
        }

    draft = normalize_draft(parsed, file_plan, requested_title=requested_title.strip())
    if extraction_errors:
        draft["warnings"] = draft["warnings"] + extraction_errors

    return {
        "chatHistoryId": response.get("chatHistoryId", chat_history_id),
        **draft,
    }


async def refine_confluence_builder_draft(
    draft: dict[str, Any],
    instruction: str,
    chat_history_id: str = "",
) -> dict[str, Any]:
    brain_id = os.getenv("DSCP_BRAIN_ID")
    if not brain_id:
        return {
            "error": True,
            "status_code": 500,
            "message": "API Not Active",
            "detail": "DSCP_BRAIN_ID is not configured.",
        }

    if not instruction.strip():
        return {
            "error": True,
            "status_code": 400,
            "message": "Missing refinement instruction",
            "detail": "Tell the AI what you want to change before refining the draft.",
        }

    file_plan = draft_file_plan_from_draft(draft)
    if not file_plan:
        return {
            "error": True,
            "status_code": 400,
            "message": "Missing attachment plan",
            "detail": "The current draft does not contain attachment mapping information.",
        }

    response = await call_brain_pure_llm_chat(
        brain_id,
        _build_refine_prompt(draft, instruction.strip()),
        chat_history_id=chat_history_id or None,
        custom_behaviour=REFINE_BEHAVIOUR,
    )

    if response.get("error"):
        return {
            "error": True,
            "status_code": 500,
            "message": response.get("message", "Draft refinement failed"),
            "detail": response.get("detail", "The AI service could not refine the Confluence draft."),
        }

    parsed = _parse_ai_json(response.get("result", ""))
    if not parsed:
        return {
            "error": True,
            "status_code": 500,
            "message": "Could not parse AI response",
            "detail": "The AI did not return a valid JSON refinement.",
        }

    refined_draft = normalize_draft(parsed, file_plan, requested_title=str(draft.get("title", "")))
    return {
        "chatHistoryId": response.get("chatHistoryId", chat_history_id),
        **refined_draft,
    }


def extract_confluence_error_message(response_text: str, status_code: int | None = None) -> str:
    cleaned_text = (response_text or "").strip()
    if not cleaned_text:
        return f"Confluence request failed with status {status_code}." if status_code else "Confluence request failed."

    try:
        payload = json.loads(cleaned_text)
    except json.JSONDecodeError:
        return cleaned_text[:500]

    if isinstance(payload, dict):
        for key in ("message", "reason", "detail"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        data = payload.get("data")
        if isinstance(data, dict):
            errors = data.get("errors")
            if isinstance(errors, list):
                flattened = [str(item.get("message") or item) for item in errors]
                flattened = [item.strip() for item in flattened if item.strip()]
                if flattened:
                    return "; ".join(flattened)

    return cleaned_text[:500]


async def verify_confluence_connection(
    confluence_url: str,
    pat: str,
    space_key: str,
    parent_page_id: str,
) -> dict[str, Any]:
    try:
        base = _validate_confluence_url(confluence_url)
    except ValueError as exc:
        return {"error": True, "detail": str(exc)}
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {pat}",
    }

    logger.info("[verify] Starting connection check for %s, space=%s, parent=%s", base, space_key, parent_page_id)

    # Do NOT follow redirects automatically — a redirect itself usually means
    # SSO is intercepting.  Handle it explicitly so the auth header isn't
    # silently stripped during the redirect chain.
    async with httpx.AsyncClient(**_get_confluence_client_kwargs(), timeout=20.0, follow_redirects=False) as client:
        # 1. Verify PAT by fetching current user
        user_url = f"{base}/rest/api/user/current"
        try:
            logger.info("[verify] GET %s", user_url)
            user_resp = await client.get(user_url, headers=headers)
            logger.info("[verify] user/current status=%s headers=%s", user_resp.status_code, dict(user_resp.headers))
        except httpx.ConnectError as exc:
            logger.error("[verify] ConnectError reaching %s: %s", user_url, exc)
            return {"error": True, "detail": f"Cannot reach Confluence at {base}. Connection refused."}
        except httpx.TimeoutException as exc:
            logger.error("[verify] Timeout reaching %s: %s", user_url, exc)
            return {"error": True, "detail": "Connection timed out. Check the base URL."}
        except Exception as exc:
            logger.exception("[verify] Unexpected error calling %s", user_url)
            return {"error": True, "detail": f"Unexpected error: {exc}"}

        # Redirect means SSO or URL misconfiguration
        if user_resp.is_redirect:
            location = user_resp.headers.get("location", "unknown")
            logger.error("[verify] Got redirect %s -> %s", user_resp.status_code, location)
            return {"error": True, "detail": f"Confluence redirected (HTTP {user_resp.status_code}) to {location}. This usually means SSO is intercepting the request. Verify VPN is connected and PAT is valid."}

        if user_resp.is_error:
            body = user_resp.text[:500]
            logger.error("[verify] PAT check failed: status=%s body=%s", user_resp.status_code, body)
            return {"error": True, "detail": f"Invalid PAT (HTTP {user_resp.status_code}). Check your token."}

        try:
            user_data = user_resp.json()
        except json.JSONDecodeError:
            body = user_resp.text[:500]
            logger.error("[verify] PAT check received non-JSON: status=%s body=%s", user_resp.status_code, body)
            return {"error": True, "detail": f"Got HTML instead of JSON (HTTP {user_resp.status_code}). This usually means SSO/login is intercepting the API call. Check VPN and that your PAT has not expired. Response starts with: {body[:150]}"}

        logger.info("[verify] Authenticated as: %s", user_data)
        display_name = user_data.get("displayName") or user_data.get("username") or "Unknown"

        # 2. Verify space key
        space_url = f"{base}/rest/api/space/{space_key}"
        try:
            logger.info("[verify] GET %s", space_url)
            space_resp = await client.get(space_url, headers=headers)
            logger.info("[verify] space status=%s", space_resp.status_code)
        except Exception as exc:
            logger.exception("[verify] Error checking space %s", space_key)
            return {"error": True, "detail": f"Error checking space: {exc}"}

        if space_resp.is_error:
            body = space_resp.text[:500]
            logger.error("[verify] Space check failed: status=%s body=%s", space_resp.status_code, body)
            return {"error": True, "detail": f"Space '{space_key}' not found (HTTP {space_resp.status_code})."}

        # 3. Verify parent page
        page_url = f"{base}/rest/api/content/{parent_page_id}"
        try:
            logger.info("[verify] GET %s", page_url)
            page_resp = await client.get(page_url, headers=headers)
            logger.info("[verify] parent page status=%s", page_resp.status_code)
        except Exception as exc:
            logger.exception("[verify] Error checking parent page %s", parent_page_id)
            return {"error": True, "detail": f"Error checking parent page: {exc}"}

        if page_resp.is_error:
            body = page_resp.text[:500]
            logger.error("[verify] Parent page check failed: status=%s body=%s", page_resp.status_code, body)
            return {"error": True, "detail": f"Parent page '{parent_page_id}' not found (HTTP {page_resp.status_code})."}

        try:
            page_title = page_resp.json().get("title", "")
        except json.JSONDecodeError:
            page_title = "Unknown (non-JSON response)"

    logger.info("[verify] All checks passed. user=%s space=%s parent='%s'", display_name, space_key, page_title)
    return {
        "error": False,
        "displayName": display_name,
        "spaceKey": space_key,
        "parentPageTitle": page_title,
    }


async def _create_confluence_page(
    *,
    confluence_url: str,
    pat: str,
    space_key: str,
    parent_page_id: str,
    title: str,
    storage_xml: str,
) -> dict[str, Any]:
    api_url = f"{_validate_confluence_url(confluence_url)}/rest/api/content"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {pat}",
    }
    payload = {
        "type": "page",
        "title": title,
        "space": {"key": space_key},
        "ancestors": [{"id": str(parent_page_id)}],
        "body": {"storage": {"value": storage_xml, "representation": "storage"}},
    }

    async with httpx.AsyncClient(**_get_confluence_client_kwargs()) as client:
        response = await client.post(api_url, headers=headers, json=payload, timeout=30.0)
        if response.is_error:
            detail = extract_confluence_error_message(response.text, response.status_code)
            return {
                "error": True,
                "status_code": response.status_code,
                "detail": detail,
            }

        page_data = response.json()
        page_id = str(page_data.get("id") or "")
        version = page_data.get("version", {}).get("number")
        webui = page_data.get("_links", {}).get("webui", "")
        base = page_data.get("_links", {}).get("base") or confluence_url.rstrip("/")
        if webui.startswith("/"):
            page_link = f"{base}{webui}"
        else:
            page_link = webui or f"{confluence_url.rstrip('/')}/pages/viewpage.action?pageId={page_id}"

        return {
            "id": page_id,
            "title": page_data.get("title") or title,
            "version": version,
            "pageLink": page_link,
        }


async def _upload_confluence_attachment(
    *,
    confluence_url: str,
    pat: str,
    page_id: str,
    file_name: str,
    file_bytes: bytes,
    content_type: str | None,
) -> dict[str, Any]:
    api_url = f"{_validate_confluence_url(confluence_url)}/rest/api/content/{page_id}/child/attachment"
    headers = {
        "Accept": "application/json",
        "X-Atlassian-Token": "nocheck",
        "Authorization": f"Bearer {pat}",
    }

    async with httpx.AsyncClient(**_get_confluence_client_kwargs()) as client:
        response = await client.post(
            api_url,
            headers=headers,
            files={"file": (file_name, file_bytes, content_type or "application/octet-stream")},
            timeout=60.0,
        )
        if response.is_error:
            return {
                "success": False,
                "statusCode": response.status_code,
                "detail": extract_confluence_error_message(response.text, response.status_code),
            }
        return {"success": True}


async def publish_confluence_builder_page(
    *,
    confluence_url: str,
    pat: str,
    space_key: str,
    parent_page_id: str,
    draft: dict[str, Any],
    files: list[UploadFile],
    upload_manifest_json: str,
) -> dict[str, Any]:
    normalized_url = (confluence_url or DEFAULT_CONFLUENCE_URL).strip()
    if not normalized_url:
        return {
            "error": True,
            "status_code": 400,
            "message": "Missing Confluence URL",
            "detail": "Enter the Confluence base URL before publishing.",
        }
    if not pat.strip():
        return {
            "error": True,
            "status_code": 400,
            "message": "Missing PAT",
            "detail": "Enter your Confluence Personal Access Token before publishing.",
        }
    if not space_key.strip():
        return {
            "error": True,
            "status_code": 400,
            "message": "Missing Space Key",
            "detail": "Enter the Confluence space key before publishing.",
        }
    if not parent_page_id.strip():
        return {
            "error": True,
            "status_code": 400,
            "message": "Missing Parent Page ID",
            "detail": "Enter the required parent page ID before publishing.",
        }

    file_plan, manifest_errors = parse_upload_manifest(files, upload_manifest_json)
    if manifest_errors:
        return {
            "error": True,
            "status_code": 400,
            "message": "Invalid upload setup",
            "detail": " ".join(manifest_errors),
        }

    assert file_plan is not None

    title = str(draft.get("title") or "").strip()
    storage_xml = str(draft.get("storageXml") or "").strip()
    if not title:
        return {
            "error": True,
            "status_code": 400,
            "message": "Missing draft title",
            "detail": "Review the draft title before publishing.",
        }
    if not storage_xml:
        return {
            "error": True,
            "status_code": 400,
            "message": "Missing storage format",
            "detail": "Review the Confluence storage format before publishing.",
        }

    attachment_references, _, validation_warnings = build_draft_reference_state(file_plan, storage_xml)
    unknown_reference_warnings = [
        warning for warning in validation_warnings if warning.startswith("Storage format references attachment names")
    ]
    if unknown_reference_warnings:
        return {
            "error": True,
            "status_code": 400,
            "message": "Unknown attachment references",
            "detail": " ".join(unknown_reference_warnings),
        }

    create_result = await _create_confluence_page(
        confluence_url=normalized_url,
        pat=pat.strip(),
        space_key=space_key.strip(),
        parent_page_id=parent_page_id.strip(),
        title=title,
        storage_xml=storage_xml,
    )
    if create_result.get("error"):
        detail = create_result.get("detail", "Confluence page creation failed.")
        message = "Confluence page creation failed"
        if "title already exists" in detail.lower():
            message = "Confluence title conflict"
        return {
            "error": True,
            "status_code": create_result.get("status_code", 500),
            "message": message,
            "detail": detail,
        }

    page_id = create_result["id"]
    upload_results: list[dict[str, Any]] = []

    for file, item in zip(files, file_plan):
        if not item.get("attachToPage"):
            continue

        file_bytes = await file.read()
        await file.seek(0)
        upload_result = await _upload_confluence_attachment(
            confluence_url=normalized_url,
            pat=pat.strip(),
            page_id=page_id,
            file_name=item["canonicalName"],
            file_bytes=file_bytes,
            content_type=file.content_type,
        )
        upload_results.append(
            {
                "sourceId": item["sourceId"],
                "originalName": item["originalName"],
                "uploadedAs": item["canonicalName"],
                **upload_result,
            }
        )

    uploaded_count = sum(1 for result in upload_results if result.get("success"))
    failed_uploads = [result for result in upload_results if not result.get("success")]
    warnings = list(draft.get("warnings", []))
    if failed_uploads:
        warnings.append(
            f"{len(failed_uploads)} attachment(s) failed to upload. Review the upload results before sharing the page."
        )

    return {
        "status": "partial_success" if failed_uploads else "success",
        "pageId": page_id,
        "title": create_result["title"],
        "version": create_result.get("version"),
        "pageLink": create_result.get("pageLink"),
        "uploadedCount": uploaded_count,
        "failedUploadCount": len(failed_uploads),
        "uploadResults": upload_results,
        "attachmentReferences": attachment_references,
        "warnings": warnings,
    }
