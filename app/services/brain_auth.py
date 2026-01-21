import httpx
import os
from fastapi import HTTPException
from app.core.config import USE_SAP_CONNECTIVITY
from app.services.sap_connectivity_service import get_sap_connectivity

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
    
    # Get SAP connectivity configuration if enabled
    proxies = None
    proxy_headers = {}
    
    if USE_SAP_CONNECTIVITY:
        sap_conn = get_sap_connectivity()
        proxies = sap_conn.get_connectivity_proxy()
        proxy_headers = await sap_conn.get_proxy_headers()
    
    # Merge proxy headers with request (if any)
    request_kwargs = {
        "verify": False,
        "trust_env": True
    }
    
    if proxies:
        request_kwargs["proxies"] = proxies
    
    async with httpx.AsyncClient(**request_kwargs) as client:
        try:
            # Microsoft OAuth doesn't need proxy headers, but prepare for future use
            response = await client.post(url, data=data)
            response.raise_for_status()
            return response.json().get("access_token")
        except httpx.HTTPStatusError as e:
            print(f"Auth Error: {e.response.text}")
            raise HTTPException(status_code=e.response.status_code, detail=f"Auth Error: {e.response.text}")
