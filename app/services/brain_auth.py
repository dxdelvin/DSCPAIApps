import httpx
import os
import time
import logging
from fastapi import HTTPException
from app.core.config import get_ssl_context

logger = logging.getLogger(__name__)

_cached_token: str | None = None
_token_expiry: float = 0.0


async def get_brain_access_token():
    """Returns a cached Bearer token, fetching a new one only when within 5 min of expiry."""
    global _cached_token, _token_expiry

    if _cached_token and time.monotonic() < _token_expiry:
        return _cached_token

    tenant_id = os.getenv("BRAIN_TENANT_ID")
    client_id = os.getenv("BRAIN_CLIENT_ID")
    client_secret = os.getenv("BRAIN_CLIENT_SECRET")
    
    if not all([tenant_id, client_id, client_secret]):
        logger.error("Missing Brain API credentials: tenant_id=%s, client_id=%s, client_secret=%s", 
                    bool(tenant_id), bool(client_id), bool(client_secret))
        raise HTTPException(status_code=500, detail="Brain API credentials not configured.")
    
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "api://dia-brain/.default",
        "grant_type": "client_credentials"
    }
    

    request_kwargs = {
        "verify": get_ssl_context(),
        "trust_env": True
    }
    
    logger.info("Requesting Brain API access token from Microsoft")
    
    async with httpx.AsyncClient(**request_kwargs) as client:
        try:
            response = await client.post(url, data=data, timeout=30.0)
            response.raise_for_status()
            token_data = response.json()
            token = token_data.get("access_token")
            expires_in = int(token_data.get("expires_in", 3600))
            _cached_token = token
            _token_expiry = time.monotonic() + expires_in - 300
            logger.info("Successfully obtained Brain API access token")
            return token
        except httpx.HTTPStatusError as e:
            logger.error("Brain authentication failed: HTTP %s", e.response.status_code)
            raise HTTPException(status_code=502, detail="Brain authentication failed.")
        except httpx.RequestError as e:
            logger.error("Could not reach authentication service: %s", type(e).__name__)
            raise HTTPException(status_code=503, detail="Could not reach the authentication service. Please try again.")
