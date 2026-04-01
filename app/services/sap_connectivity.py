"""
SAP BTP Connectivity Service helper.

When the app runs on SAP BTP Cloud Foundry with a bound Connectivity Service
instance, on-premise HTTP(S) calls must be routed through the connectivity
proxy.  This module reads the binding from VCAP_SERVICES, obtains a
short-lived OAuth token from the Connectivity Service token endpoint, and
returns the proxy URL + extra headers that httpx needs.

Locally (no VCAP_SERVICES or no connectivity binding) it returns None so
callers can fall back to a direct connection.
"""

import json
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_VCAP_CACHE: dict[str, Any] | None = None


def _get_connectivity_credentials() -> dict[str, Any] | None:
    """Extract connectivity service credentials from VCAP_SERVICES."""
    global _VCAP_CACHE
    if _VCAP_CACHE is not None:
        return _VCAP_CACHE if _VCAP_CACHE else None

    raw = os.getenv("VCAP_SERVICES")
    if not raw:
        _VCAP_CACHE = {}
        return None

    try:
        vcap = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse VCAP_SERVICES JSON")
        _VCAP_CACHE = {}
        return None

    connectivity_entries = vcap.get("connectivity", [])
    if not connectivity_entries:
        _VCAP_CACHE = {}
        return None

    creds = connectivity_entries[0].get("credentials", {})
    _VCAP_CACHE = creds
    return creds


async def _fetch_connectivity_token(creds: dict[str, Any]) -> str:
    """Get an OAuth token from the Connectivity Service token endpoint."""
    token_url = creds["token_service_url"] + "/oauth/token"
    client_id = creds["clientid"]
    client_secret = creds["clientsecret"]

    async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
        resp = await client.post(
            token_url,
            data={"grant_type": "client_credentials"},
            auth=(client_id, client_secret),
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


async def get_onpremise_proxy_config() -> dict[str, Any] | None:
    """
    Return proxy kwargs for httpx to reach on-premise hosts via SAP Cloud Connector.

    Returns a dict with keys:
        proxy_url  – the HTTPS proxy URL (e.g. http://host:20003)
        headers    – extra headers to add to every request (Proxy-Authorization, etc.)

    Returns None when no connectivity binding is available (local dev).
    """
    creds = _get_connectivity_credentials()
    if not creds:
        return None

    proxy_host = creds.get("onpremise_proxy_host")
    proxy_port = creds.get("onpremise_proxy_https_port", "20003")

    if not proxy_host:
        logger.warning("Connectivity Service bound but onpremise_proxy_host missing")
        return None

    try:
        token = await _fetch_connectivity_token(creds)
    except Exception:
        logger.exception("Failed to obtain Connectivity Service token")
        return None

    proxy_url = f"http://{proxy_host}:{proxy_port}"
    headers = {
        "Proxy-Authorization": f"Bearer {token}",
    }

    location_id = os.getenv("SAP_CONNECTIVITY_SCC_LOCATION_ID", "")
    if location_id:
        headers["SAP-Connectivity-SCC-Location_ID"] = location_id

    return {"proxy_url": proxy_url, "headers": headers}


async def build_httpx_client_kwargs(extra_headers: dict | None = None) -> dict[str, Any]:
    """
    Build kwargs dict for httpx.AsyncClient that routes through the
    Connectivity Service proxy when available, or falls back to direct.

    Usage:
        kw = await build_httpx_client_kwargs(extra_headers={...})
        async with httpx.AsyncClient(**kw) as client:
            ...
    """
    base: dict[str, Any] = {"verify": False, "trust_env": True}

    proxy_cfg = await get_onpremise_proxy_config()
    if proxy_cfg:
        base["proxy"] = proxy_cfg["proxy_url"]
        merged = {**(extra_headers or {}), **proxy_cfg["headers"]}
        base["headers"] = merged
        base["trust_env"] = False
        logger.info("Using SAP Connectivity proxy at %s", proxy_cfg["proxy_url"])
    else:
        if extra_headers:
            base["headers"] = extra_headers

    return base
