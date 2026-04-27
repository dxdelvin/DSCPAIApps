"""
Diagram generation history - CRUD operations backed by BTP Object Store.

Storage layout:
    diagram-history/{safe_user_id}/index.json           - list of index entries (newest first)
    diagram-history/{safe_user_id}/{gen_id}/content.json - full AI diagram-content JSON

Index entry schema:
    {
        "id":              str (UUID4),
        "title":           str,
        "diagramCount":    int,
        "diagramTypes":    list[str],
        "chatHistoryId":   str,
        "refinements":     int,
        "createdAt":       ISO-8601 str,
        "updatedAt":       ISO-8601 str,
    }
"""
import logging

from app.services.History import common_history as ch
from app.services.History.analytics_service import track_generation

logger = logging.getLogger(__name__)

_PREFIX = "diagram-history"
_MAX_HISTORY_ENTRIES = 50


async def get_history(user_id: str) -> list[dict]:
    """Return the user's diagram generation history (newest first). Empty list if none."""
    return await ch.get_history(_PREFIX, user_id)


async def save_generation(
    user_id: str,
    content: dict,
    chat_history_id: str,
) -> str | None:
    """Persist a new generation. Returns the new gen_id, or None on failure."""
    gen_id = ch.new_gen_id()
    diagrams = content.get("diagrams", [])
    entry = {
        "id": gen_id,
        "title": content.get("title", "Untitled Diagram"),
        "diagramCount": len(diagrams),
        "diagramTypes": [d.get("type", "unknown") for d in diagrams],
        "chatHistoryId": chat_history_id,
        "refinements": 0,
        "createdAt": ch.now_iso(),
        "updatedAt": ch.now_iso(),
    }
    if not await ch.save_content(_PREFIX, user_id, gen_id, content):
        return None
    if not await ch.append_and_prune(_PREFIX, user_id, gen_id, entry, _MAX_HISTORY_ENTRIES):
        return None
    await track_generation("diagram")
    return gen_id


async def update_generation(
    user_id: str,
    gen_id: str,
    content: dict,
) -> bool:
    """Overwrite content and bump updatedAt + refinements. Returns True on success."""
    if not await ch.save_content(_PREFIX, user_id, gen_id, content):
        return False
    history = await get_history(user_id)
    diagrams = content.get("diagrams", [])
    for entry in history:
        if entry["id"] == gen_id:
            entry["title"] = content.get("title", entry["title"])
            entry["diagramCount"] = len(diagrams)
            entry["diagramTypes"] = [d.get("type", "unknown") for d in diagrams]
            entry["refinements"] = entry.get("refinements", 0) + 1
            entry["updatedAt"] = ch.now_iso()
            return await ch.save_index(_PREFIX, user_id, history)
    return False


async def get_generation_content(user_id: str, gen_id: str) -> dict | None:
    """Fetch the stored diagram-content JSON for a generation."""
    return await ch.get_generation_content(_PREFIX, user_id, gen_id)


async def delete_generation(user_id: str, gen_id: str) -> bool:
    """Delete content object and remove entry from index."""
    return await ch.delete_generation(_PREFIX, user_id, gen_id)
