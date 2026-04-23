"""
BPMN generation history — CRUD operations backed by BTP Object Store.

Storage layout (all keys inside the bound bucket):
    bpmn-history/{safe_user_id}/index.json           — list of index entries (newest first)
    bpmn-history/{safe_user_id}/{gen_id}/content.json — full generation content JSON

Index entry schema:
    {
        "id":            str (UUID4),
        "processName":   str,
        "mode":          "form" | "upload",
        "hasXml":        bool,
        "filename":      str,
        "chatHistoryId": str,
        "refinements":   int,
        "createdAt":     ISO-8601 str,
        "updatedAt":     ISO-8601 str,
    }

Content schema:
    {
        "mode":          "form" | "upload",
        "formData": {
            "processName":       str,
            "poolName":          str,
            "participants":      str,
            "subLanes":          str,
            "startTriggers":     str,
            "processActivities": str,
            "processEnding":     str,
            "intermediateEvents": str,
            "reviewOverride":    str,
            "lanes":             list,   # raw lane objects for full restore
        },
        "analysis":      str,            # markdown analysis text
        "xml":           str | None,     # generated BPMN XML
        "filename":      str,
        "chatHistoryId": str,
    }
"""
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from app.services.History.analytics_service import track_generation

from app.services.History import storage_service as store

logger = logging.getLogger(__name__)

_MAX_HISTORY_ENTRIES = 50
_SAFE_USER_RE = re.compile(r"[^a-zA-Z0-9._\-]")


def _safe_user_id(user_id: str) -> str:
    sanitised = _SAFE_USER_RE.sub("_", user_id or "anonymous")
    return sanitised[:64] or "anonymous"


def _index_key(user_id: str) -> str:
    return f"bpmn-history/{_safe_user_id(user_id)}/index.json"


def _content_key(user_id: str, gen_id: str) -> str:
    return f"bpmn-history/{_safe_user_id(user_id)}/{gen_id}/content.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def get_history(user_id: str) -> list[dict]:
    """Return the user's BPMN generation history (newest first). Empty list if none."""
    raw = await store.get_object(_index_key(user_id))
    if raw is None:
        return []
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        logger.exception("Failed to parse BPMN history index for user %r", user_id)
        return []


async def save_generation(
    user_id: str,
    content: dict,
) -> str | None:
    """Persist a new BPMN generation. Returns the new gen_id, or None on failure."""
    gen_id = str(uuid.uuid4())
    form_data = content.get("formData") or {}
    process_name = (
        form_data.get("processName")
        or (content.get("filename") or "Untitled").replace("_", " ").replace("-", " ")
    )
    entry = {
        "id": gen_id,
        "processName": process_name,
        "mode": content.get("mode", "form"),
        "hasXml": bool(content.get("xml")),
        "filename": content.get("filename", ""),
        "chatHistoryId": content.get("chatHistoryId", ""),
        "refinements": 0,
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    }

    content_ok = await store.put_object(
        _content_key(user_id, gen_id),
        json.dumps(content, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
    if not content_ok:
        return None

    history = await get_history(user_id)
    history.insert(0, entry)
    if len(history) > _MAX_HISTORY_ENTRIES:
        pruned = history[_MAX_HISTORY_ENTRIES:]
        history = history[:_MAX_HISTORY_ENTRIES]
        for old in pruned:
            await store.delete_object(_content_key(user_id, old["id"]))

    index_ok = await store.put_object(
        _index_key(user_id),
        json.dumps(history, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
    if not index_ok:
        return None

    await track_generation("bpmn")
    return gen_id


async def update_generation(
    user_id: str,
    gen_id: str,
    content: dict,
) -> bool:
    """Overwrite content and bump updatedAt + refinements. Returns True on success."""
    content_ok = await store.put_object(
        _content_key(user_id, gen_id),
        json.dumps(content, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
    if not content_ok:
        return False

    history = await get_history(user_id)
    updated = False
    form_data = content.get("formData") or {}
    for entry in history:
        if entry["id"] == gen_id:
            process_name = (
                form_data.get("processName")
                or (content.get("filename") or "").replace("_", " ").replace("-", " ")
                or entry["processName"]
            )
            entry["processName"] = process_name
            entry["hasXml"] = bool(content.get("xml"))
            entry["filename"] = content.get("filename", entry.get("filename", ""))
            entry["refinements"] = entry.get("refinements", 0) + 1
            entry["updatedAt"] = _now_iso()
            updated = True
            break

    if not updated:
        return False

    return await store.put_object(
        _index_key(user_id),
        json.dumps(history, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )


async def get_generation_content(user_id: str, gen_id: str) -> dict | None:
    """Fetch the stored content JSON for a BPMN generation."""
    raw = await store.get_object(_content_key(user_id, gen_id))
    if raw is None:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        logger.exception("Failed to parse BPMN content for gen_id=%r", gen_id)
        return None


async def delete_generation(user_id: str, gen_id: str) -> bool:
    """Delete content object and remove entry from index."""
    await store.delete_object(_content_key(user_id, gen_id))

    history = await get_history(user_id)
    new_history = [e for e in history if e["id"] != gen_id]
    if len(new_history) == len(history):
        return False

    return await store.put_object(
        _index_key(user_id),
        json.dumps(new_history, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
