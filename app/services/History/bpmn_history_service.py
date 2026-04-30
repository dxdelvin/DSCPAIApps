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
import logging

from app.services.History import common_history as ch
from app.services.History import storage_service as store
from app.services.History.analytics_service import track_generation

logger = logging.getLogger(__name__)

_PREFIX = "bpmn-history"
_MAX_HISTORY_ENTRIES = 100


async def get_history(user_id: str) -> list[dict]:
    """Return the user's BPMN generation history (newest first). Empty list if none."""
    return await ch.get_history(_PREFIX, user_id)


async def save_generation(
    user_id: str,
    content: dict,
) -> str | None:
    """Persist a new BPMN generation. Returns the new gen_id, or None on failure."""
    gen_id = ch.new_gen_id()
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
        "createdAt": ch.now_iso(),
        "updatedAt": ch.now_iso(),
    }
    if not await ch.save_content(_PREFIX, user_id, gen_id, content):
        logger.warning("Failed to save BPMN content for user=%r gen_id=%r", user_id, gen_id)
        return None
    if not await ch.append_and_prune(_PREFIX, user_id, gen_id, entry, _MAX_HISTORY_ENTRIES):
        logger.error("Failed to update index for user=%r gen_id=%r - rolling back", user_id, gen_id)
        await store.delete_object(ch.content_key(_PREFIX, user_id, gen_id))
        return None
    await track_generation("bpmn")
    return gen_id


async def update_generation(
    user_id: str,
    gen_id: str,
    content: dict,
) -> bool:
    """Overwrite content and bump updatedAt + refinements. Returns True on success."""
    if not await ch.save_content(_PREFIX, user_id, gen_id, content):
        logger.warning("Failed to update BPMN content for user=%r gen_id=%r", user_id, gen_id)
        return False
    history = await get_history(user_id)
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
            entry["updatedAt"] = ch.now_iso()
            index_ok = await ch.save_index(_PREFIX, user_id, history)
            if not index_ok:
                logger.error("Failed to update index for user=%r gen_id=%r", user_id, gen_id)
            return index_ok
    logger.warning("Generation not found in index for user=%r gen_id=%r", user_id, gen_id)
    return False


async def get_generation_content(user_id: str, gen_id: str) -> dict | None:
    """Fetch the stored content JSON for a BPMN generation."""
    return await ch.get_generation_content(_PREFIX, user_id, gen_id)


async def delete_generation(user_id: str, gen_id: str) -> bool:
    """Delete content object and remove entry from index."""
    return await ch.delete_generation(_PREFIX, user_id, gen_id)
