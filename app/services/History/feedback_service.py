import json
import logging
import uuid
from datetime import datetime, timezone, timedelta

from app.services.History import storage_service as store
from app.services.History.analytics_service import APP_LABELS

logger = logging.getLogger(__name__)

_RETENTION_YEARS = 5
_RETENTION_DELTA = timedelta(days=_RETENTION_YEARS * 365)


def _feedback_key(app_key: str, feedback_id: str) -> str:
    return f"feedback/{app_key}/{feedback_id}.json"


def _aggregate_key(app_key: str) -> str:
    return f"feedback/aggregate/{app_key}.json"


async def save_feedback(
    app_key: str,
    gen_id: str | None,
    rating: int,
) -> bool:
    """Persist a single reaction record and best-effort update the aggregate.

    All records are kept indefinitely until the lazy 5-year cleanup runs.
    """
    if app_key not in APP_LABELS:
        return False

    feedback_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    record = {
        "feedback_id": feedback_id,
        "app_key": app_key,
        "gen_id": gen_id,
        "rating": rating,
        "created_at": created_at,
    }
    key = _feedback_key(app_key, feedback_id)
    ok = await store.put_object(key, json.dumps(record).encode(), "application/json")
    if not ok:
        logger.error("feedback_service: failed to save record for app=%s", app_key)
        return False

    try:
        await _update_aggregate(app_key, rating, created_at)
    except Exception:
        logger.exception("feedback_service: aggregate update failed for app=%s", app_key)

    # Best-effort: delete one expired record per submission (gradual cleanup).
    try:
        await _delete_one_expired(app_key)
    except Exception:
        logger.exception("feedback_service: expired cleanup failed for app=%s", app_key)

    return True


async def _update_aggregate(app_key: str, rating: int, created_at: str) -> None:
    key = _aggregate_key(app_key)
    raw = await store.get_object(key)
    agg = None
    if raw:
        try:
            agg = json.loads(raw)
        except Exception:
            agg = None

    if not agg or not isinstance(agg, dict):
        agg = {
            "total_count": 0,
            "score_sum": 0,
            "scores": {"1": 0, "2": 0, "3": 0, "4": 0},
            "last_updated": created_at,
        }

    agg["total_count"] = agg.get("total_count", 0) + 1
    agg["score_sum"] = agg.get("score_sum", 0) + rating
    scores = agg.setdefault("scores", {"1": 0, "2": 0, "3": 0, "4": 0})
    scores[str(rating)] = scores.get(str(rating), 0) + 1
    agg["last_updated"] = created_at

    await store.put_object(key, json.dumps(agg).encode(), "application/json")


async def _delete_one_expired(app_key: str) -> None:
    """Find and delete at most one record older than _RETENTION_YEARS for app_key."""
    prefix = f"feedback/{app_key}/"
    cutoff = datetime.now(timezone.utc) - _RETENTION_DELTA
    objects = await store.list_objects(prefix)
    for obj in objects:
        # Skip the aggregate file stored under feedback/aggregate/
        if obj["key"].endswith(".json") and "/aggregate/" not in obj["key"]:
            last_mod = obj["last_modified"]
            # Ensure tz-aware for comparison
            if last_mod.tzinfo is None:
                last_mod = last_mod.replace(tzinfo=timezone.utc)
            if last_mod < cutoff:
                await store.delete_object(obj["key"])
                logger.info("feedback_service: expired record deleted key=%r", obj["key"])
                return  # one per submission — slow but safe


async def get_all_feedback_aggregates() -> dict[str, dict | None]:
    """Return the aggregate record for every known app key."""
    results: dict[str, dict | None] = {}
    for app_key in APP_LABELS:
        key = _aggregate_key(app_key)
        raw = await store.get_object(key)
        if raw:
            try:
                results[app_key] = json.loads(raw)
            except Exception:
                results[app_key] = None
        else:
            results[app_key] = None
    return results
