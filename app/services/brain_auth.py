import httpx
import os
from fastapi import HTTPException
from app.core.config import get_ssl_context


async def get_brain_access_token():
    """Fetches a Bearer token that expires after 2 hours."""

    tenant_id = os.getenv("BRAIN_TENANT_ID")
    client_id = os.getenv("BRAIN_CLIENT_ID")
    client_secret = os.getenv("BRAIN_CLIENT_SECRET")
    
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
    
    async with httpx.AsyncClient(**request_kwargs) as client:
        try:
            response = await client.post(url, data=data, timeout=30.0)
            response.raise_for_status()
            return response.json().get("access_token")
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail="Brain authentication failed.")
        except httpx.RequestError:
            raise HTTPException(status_code=503, detail="Could not reach the authentication service. Please try again.")
