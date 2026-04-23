"""
Analytics tracking — best-effort, non-blocking counters backed by BTP Object Store.

Storage layout:
    analytics/clicks/{YYYY-MM-DD}.json  — per-app page-open counts for that calendar day
    analytics/users/{YYYY-MM-DD}.json   — per-app sets of unique user IDs for that day
    analytics/generations.json          — all-time total generation count per app
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
}

# Users allowed to access /dscpadmin (lowercase)
ADMIN_USERS: frozenset = frozenset({"dsd9di", "local-dev"})


def _clicks_key(date_str: str) -> str:
    return f"analytics/clicks/{date_str}.json"


def _users_key(date_str: str) -> str:
    return f"analytics/users/{date_str}.json"


def _generations_key() -> str:
    return "analytics/generations.json"


async def track_click(app_key: str, user_id: str = "anonymous") -> None:
    """Increment today's open counter and record unique user for app_key. Best-effort — never raises."""
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
    """Increment total generation counter for app_key. Best-effort — never raises."""
    try:
        key = _generations_key()
        raw = await store.get_object(key)
        data: dict = {}
        if raw:
            try:
                data = json.loads(raw.decode("utf-8"))
            except Exception:
                data = {}
        data[app_key] = data.get(app_key, 0) + 1
        await store.put_object(key, json.dumps(data).encode(), "application/json")
    except Exception:
        logger.exception("analytics track_generation failed for app=%r", app_key)


async def get_analytics(days: int = 14) -> dict:
    """
    Fetch analytics data for the admin dashboard.

    Returns:
        {
            "daily_clicks": {"2026-04-23": {"ppt": 3, ...}, ...},  # oldest → newest
            "generations":  {"ppt": 10, ...},
            "app_labels":   {...},
            "date_range":   ["2026-04-10", ..., "2026-04-23"],
        }
    """
    today = date.today()
    date_range = [
        (today - timedelta(days=i)).isoformat()
        for i in range(days - 1, -1, -1)
    ]

    # Fetch click files, user files, and generation totals all in parallel
    all_raws = await asyncio.gather(
        *[store.get_object(_clicks_key(d)) for d in date_range],
        *[store.get_object(_users_key(d))  for d in date_range],
        store.get_object(_generations_key()),
        return_exceptions=True,
    )

    n = len(date_range)
    click_raws = all_raws[:n]
    users_raws = all_raws[n : 2 * n]
    gen_raw    = all_raws[2 * n]

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

    generations: dict = {}
    if gen_raw and not isinstance(gen_raw, Exception):
        try:
            generations = json.loads(gen_raw.decode("utf-8"))
        except Exception:
            pass

    return {
        "daily_clicks": daily_clicks,
        "daily_unique_users": daily_unique_users,
        "generations": generations,
        "app_labels": APP_LABELS,
        "date_range": date_range,
    }
