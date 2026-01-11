import httpx
import os
from fastapi import HTTPException

async def get_brain_access_token():
    """Fetches a Bearer token that expires after 2 hours."""
    tenant_id = os.getenv("BRAIN_TENANT_ID")
    client_id = os.getenv("BRAIN_CLIENT_ID")
    client_secret = os.getenv("BRAIN_CLIENT_SECRET")
    
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "api://dia-brain/.default", # Standard scope for Brain [cite: 186]
        "grant_type": "client_credentials"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, data=data)
            response.raise_for_status()
            return response.json().get("access_token")
        except httpx.HTTPStatusError as e:
            # Captures authentication failures (e.g., Client ID not whitelisted) 
            raise HTTPException(status_code=e.response.status_code, detail=f"Auth Error: {e.response.text}")