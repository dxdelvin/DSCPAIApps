"""
One Pager generation history - CRUD operations backed by BTP Object Store.

Storage layout:
    one-pager-history/{safe_user_id}/index.json              - list of index entries (newest first)
    one-pager-history/{safe_user_id}/{gen_id}/content.json   - full HTML content

Index entry schema:
    {
        "id":            str (UUID4),
        "title":         str,
        "templateStyle": str,
        "orientation":   str,
        "chatHistoryId": str,
        "refinements":   int,
        "createdAt":     ISO-8601 str,
        "updatedAt":     ISO-8601 str,
    }
"""
import logging

from app.services.History import common_history as ch
from app.services.History.analytics_service import track_generation

logger = logging.getLogger(__name__)

_PREFIX = "one-pager-history"
_MAX_HISTORY_ENTRIES = 100


async def get_history(user_id: str) -> list[dict]:
    """Return the user's generation history (newest first). Empty list if none."""
    return await ch.get_history(_PREFIX, user_id)


async def save_generation(
    user_id: str,
    title: str,
    html: str,
    template_style: str,
    orientation: str,
    chat_history_id: str,
) -> str | None:
    """Persist a new generation. Returns the new gen_id, or None on failure."""
    gen_id = ch.new_gen_id()
    entry = {
        "id": gen_id,
        "title": title or "Untitled",
        "templateStyle": template_style,
        "orientation": orientation,
        "chatHistoryId": chat_history_id,
        "refinements": 0,
        "createdAt": ch.now_iso(),
        "updatedAt": ch.now_iso(),
    }
    content = {
        "title": title or "Untitled",
        "templateStyle": template_style,
        "orientation": orientation,
        "chatHistoryId": chat_history_id,
        "html": html,
    }
    if not await ch.save_content(_PREFIX, user_id, gen_id, content):
        return None
    if not await ch.append_and_prune(_PREFIX, user_id, gen_id, entry, _MAX_HISTORY_ENTRIES):
        return None
    await track_generation("one-pager")
    return gen_id


async def update_generation(
    user_id: str,
    gen_id: str,
    html: str,
    chat_history_id: str,
    title: str | None = None,
) -> bool:
    """Overwrite HTML and bump updatedAt + refinements count. Returns True on success."""
    existing = await get_generation_content(user_id, gen_id)
    if existing is None:
        return False
    updated_content = {
        **existing,
        "html": html,
        "chatHistoryId": chat_history_id or existing.get("chatHistoryId", ""),
    }
    if title:
        updated_content["title"] = title
    if not await ch.save_content(_PREFIX, user_id, gen_id, updated_content):
        return False
    history = await get_history(user_id)
    for e in history:
        if e["id"] == gen_id:
            if title:
                e["title"] = title
            e["refinements"] = e.get("refinements", 0) + 1
            e["updatedAt"] = ch.now_iso()
            return await ch.save_index(_PREFIX, user_id, history)
    return False


async def get_generation_content(user_id: str, gen_id: str) -> dict | None:
    """Fetch stored one-pager content for a generation."""
    return await ch.get_generation_content(_PREFIX, user_id, gen_id)


async def delete_generation(user_id: str, gen_id: str) -> bool:
    """Delete content object and remove entry from index."""
    return await ch.delete_generation(_PREFIX, user_id, gen_id)
