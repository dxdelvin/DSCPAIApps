"""User favourites persistence — stores starred app keys in Object Store."""
import json
import logging
from typing import Optional

from app.services.History.storage_service import get_object, put_object
from app.services.History.user_id_utils import safe_user_id

logger = logging.getLogger(__name__)

ALLOWED_APP_KEYS: frozenset[str] = frozenset({
    "bpmn",
    "ppt",
    "diagram",
    "one-pager",
    "audit-check",
    "bpmn-checker",
    "spec-builder",
    "docupedia-publisher",
    "signavio-learning",
})

_MAX_FAVOURITES = len(ALLOWED_APP_KEYS)


def _key(user_id: str) -> str:
    return f"favorites/{safe_user_id(user_id)}.json"


async def get_favorites(user_id: Optional[str]) -> list[str]:
    """Return the user's list of starred app keys. Returns [] on any error or missing data."""
    try:
        raw = await get_object(_key(user_id or "anonymous"))
        if raw is None:
            return []
        data = json.loads(raw)
        if not isinstance(data, list):
            return []
        return [k for k in data if k in ALLOWED_APP_KEYS]
    except Exception:
        logger.exception("Failed to read favourites for user")
        return []


async def save_favorites(user_id: Optional[str], app_keys: list[str]) -> bool:
    """Persist validated, deduplicated list of app keys. Returns True on success."""
    validated = list(dict.fromkeys(k for k in app_keys if k in ALLOWED_APP_KEYS))
    validated = validated[:_MAX_FAVOURITES]
    try:
        body = json.dumps(validated, separators=(",", ":")).encode()
        return await put_object(_key(user_id or "anonymous"), body, "application/json")
    except Exception:
        logger.exception("Failed to save favourites for user")
        return False


async def add_favorite(user_id: Optional[str], app_key: str) -> bool:
    """Add one app key to the user's favourites. No-op if already present."""
    if app_key not in ALLOWED_APP_KEYS:
        return False
    current = await get_favorites(user_id)
    if app_key not in current:
        current.append(app_key)
    return await save_favorites(user_id, current)


async def remove_favorite(user_id: Optional[str], app_key: str) -> bool:
    """Remove one app key from the user's favourites. No-op if not present."""
    if app_key not in ALLOWED_APP_KEYS:
        return False
    current = await get_favorites(user_id)
    updated = [k for k in current if k != app_key]
    return await save_favorites(user_id, updated)
