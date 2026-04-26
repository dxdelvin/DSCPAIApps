"""
BPMN generation history - CRUD operations backed by BTP Object Store.

Storage layout:
    bpmn-history/{safe_user_id}/index.json           - list of index entries (newest first)
    bpmn-history/{safe_user_id}/{gen_id}/content.json - full generation content JSON

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
"""
import json
import logging
import uuid
from datetime import datetime, timezone

from app.services.History.analytics_service import track_generation
from app.services.History.user_id_utils import safe_user_id
from app.services.History import storage_service as store

logger = logging.getLogger(__name__)

_MAX_HISTORY_ENTRIES = 50


def _index_key(user_id: str) -> str:
    return f"bpmn-history/{safe_user_id(user_id)}/index.json"


def _content_key(user_id: str, gen_id: str) -> str:
    return f"bpmn-history/{safe_user_id(user_id)}/{gen_id}/content.json"


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

    content_key = _content_key(user_id, gen_id)
    content_ok = await store.put_object(
        content_key,
        json.dumps(content, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
    if not content_ok:
        logger.warning("Failed to save BPMN content for user=%r gen_id=%r", user_id, gen_id)
        return None

    history = await get_history(user_id)
    history.insert(0, entry)
    
    pruned_entries = []
    if len(history) > _MAX_HISTORY_ENTRIES:
        pruned_entries = history[_MAX_HISTORY_ENTRIES:]
        history = history[:_MAX_HISTORY_ENTRIES]

    index_ok = await store.put_object(
        _index_key(user_id),
        json.dumps(history, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
    
    if not index_ok:
        logger.error("Failed to update index for user=%r gen_id=%r - rolling back", user_id, gen_id)
        await store.delete_object(content_key)
        return None

    for old in pruned_entries:
        deleted = await store.delete_object(_content_key(user_id, old["id"]))
        if not deleted:
            logger.warning("Failed to delete pruned content for user=%r gen_id=%r", user_id, old["id"])

    await track_generation("bpmn")
    return gen_id


async def update_generation(
    user_id: str,
    gen_id: str,
    content: dict,
) -> bool:
    """Overwrite content and bump updatedAt + refinements. Returns True on success."""
    content_key = _content_key(user_id, gen_id)
    content_ok = await store.put_object(
        content_key,
        json.dumps(content, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
    if not content_ok:
        logger.warning("Failed to update BPMN content for user=%r gen_id=%r", user_id, gen_id)
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
        logger.warning("Generation not found in index for user=%r gen_id=%r", user_id, gen_id)
        return False

    index_ok = await store.put_object(
        _index_key(user_id),
        json.dumps(history, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
    
    if not index_ok:
        logger.error("Failed to update index for user=%r gen_id=%r", user_id, gen_id)
    
    return index_ok


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
    content_deleted = await store.delete_object(_content_key(user_id, gen_id))
    if not content_deleted:
        logger.warning("Failed to delete BPMN content for user=%r gen_id=%r", user_id, gen_id)

    history = await get_history(user_id)
    new_history = [e for e in history if e["id"] != gen_id]
    
    if len(new_history) == len(history):
        logger.warning("Generation not found in index for user=%r gen_id=%r", user_id, gen_id)
        return False

    index_ok = await store.put_object(
        _index_key(user_id),
        json.dumps(new_history, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
    
    if not index_ok:
        logger.error("Failed to update index after deleting content for user=%r gen_id=%r", user_id, gen_id)
    
    return index_ok
