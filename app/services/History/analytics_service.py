"""
Analytics tracking - best-effort, non-blocking counters backed by BTP Object Store.

Storage layout:
    analytics/clicks/{YYYY-MM-DD}.json       - per-app page-open counts for that calendar day
    analytics/users/{YYYY-MM-DD}.json        - per-app sets of unique user IDs for that day
    analytics/users_total.json               - all-time per-app unique user ID sets
    analytics/gen_daily/{YYYY-MM-DD}.json    - per-app successful generation counts for that day
    analytics/gen_failed/{YYYY-MM-DD}.json   - per-app failed generation counts for that day
    analytics/generations.json               - all-time total successful generation count per app
    analytics/gen_failed_total.json          - all-time total failed generation count per app
    analytics/downloads/{YYYY-MM-DD}.json    - per-app file download counts for that calendar day
    analytics/downloads_total.json           - all-time total download count per app
"""

import asyncio
import json
import logging
from datetime import date, timedelta

from app.services.History import storage_service as store

logger = logging.getLogger(__name__)

# Display labels for each app key
APP_LABELS: dict[str, str] = {
    "ppt":                "PPT Creator",
    "diagram":            "Diagram Generator",
    "bpmn":               "BPMN Builder",
    "audit":              "Audit Check",
    "bpmn-checker":       "BPMN Checker",
    "spec-builder":       "Spec Builder",
    "docupedia":          "Docupedia Publisher",
    "signavio-learning":  "Learn Signavio Modeling",
    "one-pager":          "One Pager Creator",
}

# Users allowed to access /dscpadmin (lowercase)
ADMIN_USERS: frozenset = frozenset({"dsd9di", "local-dev", "eim1di", "bsr1di"})


def _clicks_key(date_str: str) -> str:
    return f"analytics/clicks/{date_str}.json"


def _users_key(date_str: str) -> str:
    return f"analytics/users/{date_str}.json"


def _generations_key() -> str:
    return "analytics/generations.json"


def _gen_daily_key(date_str: str) -> str:
    return f"analytics/gen_daily/{date_str}.json"


def _downloads_key(date_str: str) -> str:
    return f"analytics/downloads/{date_str}.json"


def _downloads_total_key() -> str:
    return "analytics/downloads_total.json"


def _users_total_key() -> str:
    return "analytics/users_total.json"


def _gen_failed_daily_key(date_str: str) -> str:
    return f"analytics/gen_failed/{date_str}.json"


def _gen_failed_total_key() -> str:
    return "analytics/gen_failed_total.json"


async def track_click(app_key: str, user_id: str = "anonymous") -> None:
    """Increment today's open counter and record unique user for app_key. Best-effort - never raises."""
    try:
        today = date.today().isoformat()
        click_key  = _clicks_key(today)
        users_key  = _users_key(today)
        total_key  = _users_total_key()

        # Fetch click + daily users + all-time users concurrently
        click_raw, users_raw, total_raw = await asyncio.gather(
            store.get_object(click_key),
            store.get_object(users_key),
            store.get_object(total_key),
            return_exceptions=True,
        )

        # Update click count
        clicks: dict = {}
        if click_raw and not isinstance(click_raw, Exception):
            try:
                clicks = json.loads(click_raw.decode("utf-8"))
            except Exception:
                pass
        clicks[app_key] = clicks.get(app_key, 0) + 1

        # Update daily unique user set
        users: dict = {}
        if users_raw and not isinstance(users_raw, Exception):
            try:
                users = json.loads(users_raw.decode("utf-8"))
            except Exception:
                pass
        user_set: set = set(users.get(app_key, []))
        user_set.add(user_id)
        users[app_key] = list(user_set)

        # Update all-time unique user set
        total: dict = {}
        if total_raw and not isinstance(total_raw, Exception):
            try:
                total = json.loads(total_raw.decode("utf-8"))
            except Exception:
                pass
        total_set: set = set(total.get(app_key, []))
        total_set.add(user_id)
        total[app_key] = list(total_set)

        # Persist all three concurrently
        await asyncio.gather(
            store.put_object(click_key,  json.dumps(clicks).encode(), "application/json"),
            store.put_object(users_key,  json.dumps(users).encode(),  "application/json"),
            store.put_object(total_key,  json.dumps(total).encode(),  "application/json"),
        )
    except Exception:
        logger.exception("analytics track_click failed for app=%r user=%r", app_key, user_id)


async def track_generation(app_key: str) -> None:
    """Increment total and daily generation counters for app_key. Best-effort - never raises."""
    try:
        today_str   = date.today().isoformat()
        all_time_key = _generations_key()
        daily_key    = _gen_daily_key(today_str)

        all_time_raw, daily_raw = await asyncio.gather(
            store.get_object(all_time_key),
            store.get_object(daily_key),
            return_exceptions=True,
        )

        all_time: dict = {}
        if all_time_raw and not isinstance(all_time_raw, Exception):
            try:
                all_time = json.loads(all_time_raw.decode("utf-8"))
            except Exception:
                pass
        all_time[app_key] = all_time.get(app_key, 0) + 1

        daily: dict = {}
        if daily_raw and not isinstance(daily_raw, Exception):
            try:
                daily = json.loads(daily_raw.decode("utf-8"))
            except Exception:
                pass
        daily[app_key] = daily.get(app_key, 0) + 1

        await asyncio.gather(
            store.put_object(all_time_key, json.dumps(all_time).encode(), "application/json"),
            store.put_object(daily_key,    json.dumps(daily).encode(),    "application/json"),
        )
    except Exception:
        logger.exception("analytics track_generation failed for app=%r", app_key)


async def track_generation_failed(app_key: str) -> None:
    """Increment daily and all-time failed generation counters for app_key. Best-effort - never raises."""
    try:
        today_str  = date.today().isoformat()
        daily_key  = _gen_failed_daily_key(today_str)
        total_key  = _gen_failed_total_key()

        daily_raw, total_raw = await asyncio.gather(
            store.get_object(daily_key),
            store.get_object(total_key),
            return_exceptions=True,
        )

        daily: dict = {}
        if daily_raw and not isinstance(daily_raw, Exception):
            try:
                daily = json.loads(daily_raw.decode("utf-8"))
            except Exception:
                pass
        daily[app_key] = daily.get(app_key, 0) + 1

        total: dict = {}
        if total_raw and not isinstance(total_raw, Exception):
            try:
                total = json.loads(total_raw.decode("utf-8"))
            except Exception:
                pass
        total[app_key] = total.get(app_key, 0) + 1

        await asyncio.gather(
            store.put_object(daily_key, json.dumps(daily).encode(), "application/json"),
            store.put_object(total_key, json.dumps(total).encode(), "application/json"),
        )
    except Exception:
        logger.exception("analytics track_generation_failed for app=%r", app_key)


async def track_download(app_key: str) -> None:
    """Increment daily and all-time download counters for app_key. Best-effort - never raises."""
    try:
        today_str = date.today().isoformat()
        daily_key = _downloads_key(today_str)
        total_key = _downloads_total_key()

        daily_raw, total_raw = await asyncio.gather(
            store.get_object(daily_key),
            store.get_object(total_key),
            return_exceptions=True,
        )

        daily: dict = {}
        if daily_raw and not isinstance(daily_raw, Exception):
            try:
                daily = json.loads(daily_raw.decode("utf-8"))
            except Exception:
                pass
        daily[app_key] = daily.get(app_key, 0) + 1

        total: dict = {}
        if total_raw and not isinstance(total_raw, Exception):
            try:
                total = json.loads(total_raw.decode("utf-8"))
            except Exception:
                pass
        total[app_key] = total.get(app_key, 0) + 1

        await asyncio.gather(
            store.put_object(daily_key, json.dumps(daily).encode(), "application/json"),
            store.put_object(total_key, json.dumps(total).encode(), "application/json"),
        )
    except Exception:
        logger.exception("analytics track_download failed for app=%r", app_key)


async def get_analytics(days: int = 28) -> dict:
    """
    Fetch analytics data for the admin dashboard.

    Returns:
        {
            "daily_clicks":       {"2026-04-23": {"ppt": 3, ...}, ...},
            "daily_unique_users": {"2026-04-23": {"ppt": ["user1", ...], ...}, ...},
            "users_total":        {"ppt": ["user1", ...], ...},  # all-time per-app unique users
            "daily_generations":  {"2026-04-23": {"ppt": 2, ...}, ...},
            "daily_gen_failed":   {"2026-04-23": {"ppt": 0, ...}, ...},
            "daily_downloads":    {"2026-04-23": {"ppt": 1, ...}, ...},
            "generations":        {"ppt": 10, ...},   # all-time totals
            "gen_failed_total":   {"ppt": 1, ...},    # all-time totals
            "downloads":          {"ppt": 6, ...},
            "app_labels":         {...},
            "date_range":         ["2026-03-26", ..., "2026-04-23"],
        }
    """
    today = date.today()
    date_range = [
        (today - timedelta(days=i)).isoformat()
        for i in range(days - 1, -1, -1)
    ]

    # Fetch all daily files + all-time totals in one parallel call
    all_raws = await asyncio.gather(
        *[store.get_object(_clicks_key(d))          for d in date_range],
        *[store.get_object(_users_key(d))            for d in date_range],
        *[store.get_object(_gen_daily_key(d))        for d in date_range],
        *[store.get_object(_gen_failed_daily_key(d)) for d in date_range],
        *[store.get_object(_downloads_key(d))        for d in date_range],
        store.get_object(_generations_key()),
        store.get_object(_gen_failed_total_key()),
        store.get_object(_downloads_total_key()),
        store.get_object(_users_total_key()),
        return_exceptions=True,
    )

    n                = len(date_range)
    click_raws       = all_raws[:n]
    users_raws       = all_raws[n         : 2 * n]
    gen_daily_raws   = all_raws[2 * n     : 3 * n]
    failed_daily_raws= all_raws[3 * n     : 4 * n]
    dl_daily_raws    = all_raws[4 * n     : 5 * n]
    gen_raw          = all_raws[5 * n]
    failed_total_raw = all_raws[5 * n + 1]
    dl_raw           = all_raws[5 * n + 2]
    users_total_raw  = all_raws[5 * n + 3]

    def _parse_daily(date_iter, raws):
        result: dict[str, dict] = {}
        for d, raw in zip(date_iter, raws):
            if isinstance(raw, Exception) or raw is None:
                result[d] = {}
                continue
            try:
                result[d] = json.loads(raw.decode("utf-8"))
            except Exception:
                result[d] = {}
        return result

    def _parse_single(raw) -> dict:
        if raw and not isinstance(raw, Exception):
            try:
                return json.loads(raw.decode("utf-8"))
            except Exception:
                pass
        return {}

    daily_clicks       = _parse_daily(date_range, click_raws)
    daily_unique_users = _parse_daily(date_range, users_raws)
    daily_generations  = _parse_daily(date_range, gen_daily_raws)
    daily_gen_failed   = _parse_daily(date_range, failed_daily_raws)
    daily_downloads    = _parse_daily(date_range, dl_daily_raws)

    return {
        "daily_clicks":       daily_clicks,
        "daily_unique_users": daily_unique_users,
        "users_total":        _parse_single(users_total_raw),
        "daily_generations":  daily_generations,
        "daily_gen_failed":   daily_gen_failed,
        "daily_downloads":    daily_downloads,
        "generations":        _parse_single(gen_raw),
        "gen_failed_total":   _parse_single(failed_total_raw),
        "downloads":          _parse_single(dl_raw),
        "app_labels":         APP_LABELS,
        "date_range":         date_range,
    }
