import httpx
import os
from fastapi import HTTPException
from app.core.config import IS_PRODUCTION


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
    
    # trust_env: False in dev, True in prod
    request_kwargs = {
        "verify": False,
        "trust_env": IS_PRODUCTION
    }
    
    async with httpx.AsyncClient(**request_kwargs) as client:
        try:
            response = await client.post(url, data=data)
            response.raise_for_status()
            return response.json().get("access_token")
        except httpx.HTTPStatusError as e:
            print(f"Auth Error: {e.response.text}")
            raise HTTPException(status_code=e.response.status_code, detail=f"Auth Error: {e.response.text}")
