import httpx
import os
import logging
from fastapi import HTTPException
from app.core.config import get_ssl_context

logger = logging.getLogger(__name__)


async def get_brain_access_token():
    """Fetches a Bearer token that expires after 2 hours."""

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
            token = response.json().get("access_token")
            logger.info("Successfully obtained Brain API access token")
            return token
        except httpx.HTTPStatusError as e:
            logger.error("Brain authentication failed: HTTP %s - %s", e.response.status_code, e.response.text[:200])
            raise HTTPException(status_code=502, detail="Brain authentication failed.")
        except httpx.RequestError as e:
            logger.error("Could not reach authentication service: %s", str(e))
            raise HTTPException(status_code=503, detail="Could not reach the authentication service. Please try again.")
