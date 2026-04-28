"""
Analytics tracking - best-effort, non-blocking counters backed by BTP Object Store.

Storage layout:
    analytics/clicks/{YYYY-MM-DD}.json      - per-app page-open counts for that calendar day
    analytics/users/{YYYY-MM-DD}.json       - per-app sets of unique user IDs for that day
    analytics/gen_daily/{YYYY-MM-DD}.json   - per-app generation counts for that calendar day
    analytics/generations.json              - all-time total generation count per app
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


async def track_click(app_key: str, user_id: str = "anonymous") -> None:
    """Increment today's open counter and record unique user for app_key. Best-effort - never raises."""
    try:
        today = date.today().isoformat()
        click_key = _clicks_key(today)
        users_key = _users_key(today)

        # Fetch click + user files concurrently
        click_raw, users_raw = await asyncio.gather(
            store.get_object(click_key),
            store.get_object(users_key),
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

        # Update unique user set
        users: dict = {}
        if users_raw and not isinstance(users_raw, Exception):
            try:
                users = json.loads(users_raw.decode("utf-8"))
            except Exception:
                pass
        user_set: set = set(users.get(app_key, []))
        user_set.add(user_id)
        users[app_key] = list(user_set)

        # Persist both concurrently
        await asyncio.gather(
            store.put_object(click_key, json.dumps(clicks).encode(), "application/json"),
            store.put_object(users_key, json.dumps(users).encode(), "application/json"),
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


async def get_analytics(days: int = 28) -> dict:
    """
    Fetch analytics data for the admin dashboard.

    Returns:
        {
            "daily_clicks":       {"2026-04-23": {"ppt": 3, ...}, ...},  # oldest → newest
            "daily_unique_users": {"2026-04-23": {"ppt": ["user1", ...], ...}, ...},
            "daily_generations":  {"2026-04-23": {"ppt": 2, ...}, ...},
            "generations":        {"ppt": 10, ...},
            "app_labels":         {...},
            "date_range":         ["2026-03-26", ..., "2026-04-23"],
        }
    """
    today = date.today()
    date_range = [
        (today - timedelta(days=i)).isoformat()
        for i in range(days - 1, -1, -1)
    ]

    # Fetch click files, user files, daily generation files, and all-time totals in parallel
    all_raws = await asyncio.gather(
        *[store.get_object(_clicks_key(d))    for d in date_range],
        *[store.get_object(_users_key(d))     for d in date_range],
        *[store.get_object(_gen_daily_key(d)) for d in date_range],
        store.get_object(_generations_key()),
        return_exceptions=True,
    )

    n          = len(date_range)
    click_raws = all_raws[:n]
    users_raws = all_raws[n : 2 * n]
    gen_daily_raws = all_raws[2 * n : 3 * n]
    gen_raw    = all_raws[3 * n]

    daily_clicks: dict[str, dict] = {}
    for d, raw in zip(date_range, click_raws):
        if isinstance(raw, Exception) or raw is None:
            daily_clicks[d] = {}
            continue
        try:
            daily_clicks[d] = json.loads(raw.decode("utf-8"))
        except Exception:
            daily_clicks[d] = {}

    daily_unique_users: dict[str, dict] = {}
    for d, raw in zip(date_range, users_raws):
        if isinstance(raw, Exception) or raw is None:
            daily_unique_users[d] = {}
            continue
        try:
            daily_unique_users[d] = json.loads(raw.decode("utf-8"))
        except Exception:
            daily_unique_users[d] = {}

    daily_generations: dict[str, dict] = {}
    for d, raw in zip(date_range, gen_daily_raws):
        if isinstance(raw, Exception) or raw is None:
            daily_generations[d] = {}
            continue
        try:
            daily_generations[d] = json.loads(raw.decode("utf-8"))
        except Exception:
            daily_generations[d] = {}

    generations: dict = {}
    if gen_raw and not isinstance(gen_raw, Exception):
        try:
            generations = json.loads(gen_raw.decode("utf-8"))
        except Exception:
            pass

    return {
        "daily_clicks":       daily_clicks,
        "daily_unique_users": daily_unique_users,
        "daily_generations":  daily_generations,
        "generations":        generations,
        "app_labels":         APP_LABELS,
        "date_range":         date_range,
    }
