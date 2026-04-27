"""
Shared CRUD helpers for all feature history services.

All history data follows this storage layout:
    {prefix}/{safe_user_id}/index.json            – list of index entries (newest first)
    {prefix}/{safe_user_id}/{gen_id}/content.json – full content blob

Each feature service only needs to define its feature-specific entry schema
(save_generation / update_generation). All generic CRUD is delegated here.
"""
import json
import logging
import uuid
from datetime import datetime, timezone

from app.services.History.user_id_utils import safe_user_id
from app.services.History import storage_service as store

logger = logging.getLogger(__name__)


# ── Time / ID helpers ────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_gen_id() -> str:
    return str(uuid.uuid4())


# ── Key builders ─────────────────────────────────────────────────────────────

def index_key(prefix: str, user_id: str) -> str:
    return f"{prefix}/{safe_user_id(user_id)}/index.json"


def content_key(prefix: str, user_id: str, gen_id: str) -> str:
    return f"{prefix}/{safe_user_id(user_id)}/{gen_id}/content.json"


# ── Read operations ───────────────────────────────────────────────────────────

async def get_history(prefix: str, user_id: str) -> list[dict]:
    """Return the user's generation index (newest first). Empty list if none or on error."""
    raw = await store.get_object(index_key(prefix, user_id))
    if raw is None:
        return []
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        logger.exception("Failed to parse history index [%s] for user %r", prefix, user_id)
        return []


async def get_generation_content(prefix: str, user_id: str, gen_id: str) -> dict | None:
    """Fetch and decode the stored content blob for a generation."""
    raw = await store.get_object(content_key(prefix, user_id, gen_id))
    if raw is None:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        logger.exception("Failed to parse content [%s] for gen_id=%r", prefix, gen_id)
        return None


# ── Write operations ──────────────────────────────────────────────────────────

async def save_content(prefix: str, user_id: str, gen_id: str, content: dict) -> bool:
    """Write the content blob to object store. Returns True on success."""
    return await store.put_object(
        content_key(prefix, user_id, gen_id),
        json.dumps(content, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )


async def save_index(prefix: str, user_id: str, history: list[dict]) -> bool:
    """Write the index list to object store. Returns True on success."""
    return await store.put_object(
        index_key(prefix, user_id),
        json.dumps(history, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )


async def append_and_prune(
    prefix: str,
    user_id: str,
    gen_id: str,
    entry: dict,
    max_entries: int = 50,
) -> bool:
    """
    Prepend *entry* to the user's index, prune excess entries (deleting their
    content objects), then save the updated index. Returns True on success.
    """
    history = await get_history(prefix, user_id)
    history.insert(0, entry)
    if len(history) > max_entries:
        pruned = history[max_entries:]
        history = history[:max_entries]
        for old in pruned:
            await store.delete_object(content_key(prefix, user_id, old["id"]))
    return await save_index(prefix, user_id, history)


# ── Delete operation ──────────────────────────────────────────────────────────

async def delete_generation(prefix: str, user_id: str, gen_id: str) -> bool:
    """Delete the content object and remove the entry from the index."""
    await store.delete_object(content_key(prefix, user_id, gen_id))
    history = await get_history(prefix, user_id)
    new_history = [e for e in history if e["id"] != gen_id]
    if len(new_history) == len(history):
        return False
    return await save_index(prefix, user_id, new_history)
