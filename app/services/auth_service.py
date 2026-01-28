"""
XSUAA Authentication Service for SAP BTP
Handles OAuth2 login flow directly in FastAPI (no App Router needed)
"""
import os
from urllib.parse import urlencode
from fastapi import HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sap import xssec
from cfenv import AppEnv

# Load Service Credentials
env = AppEnv()
uaa_service = env.get_service(name='dscp-ai-app')


def get_xsuaa_config():
    """Get XSUAA OAuth2 configuration from VCAP_SERVICES."""
    if not uaa_service:
        return None
    
    creds = uaa_service.credentials
    return {
        "client_id": creds.get("clientid"),
        "client_secret": creds.get("clientsecret"),
        "auth_url": f"{creds.get('url')}/oauth/authorize",
        "token_url": f"{creds.get('url')}/oauth/token",
        "logout_url": f"{creds.get('url')}/logout",
        "xsappname": creds.get("xsappname"),
    }


def get_login_url(request: Request) -> str:
    """Generate the XSUAA login URL for OAuth2 authorization."""
    config = get_xsuaa_config()
    if not config:
        raise HTTPException(status_code=500, detail="XSUAA service not configured")
    
    # Build callback URL
    callback_url = str(request.url_for("auth_callback"))
    
    params = {
        "response_type": "code",
        "client_id": config["client_id"],
        "redirect_uri": callback_url,
        "scope": f"{config['xsappname']}.Display",
    }
    
    return f"{config['auth_url']}?{urlencode(params)}"


async def exchange_code_for_token(code: str, request: Request) -> dict:
    """Exchange authorization code for access token."""
    import httpx
    
    config = get_xsuaa_config()
    if not config:
        raise HTTPException(status_code=500, detail="XSUAA service not configured")
    
    callback_url = str(request.url_for("auth_callback"))
    
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": callback_url,
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
    }
    
    async with httpx.AsyncClient(verify=False) as client:
        response = await client.post(config["token_url"], data=data)
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Failed to exchange code for token")
        return response.json()


def validate_token(token: str) -> dict:
    """Validate JWT token with XSUAA and return user info."""
    if not uaa_service:
        raise HTTPException(status_code=500, detail="XSUAA service not configured")
    
    try:
        security_context = xssec.create_security_context(token, uaa_service.credentials)
        return {
            "user": security_context.get_logon_name(),
            "email": security_context.get_email(),
            "scopes": security_context.get_granted_scopes(),
        }
    except Exception as e:
        print(f"Token validation error: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_current_user(request: Request) -> dict:
    """
    Get current authenticated user from session.
    Redirects to login if not authenticated.
    """
    # Check if running locally without XSUAA
    if not os.getenv("VCAP_SERVICES"):
        print("WARNING: Running locally without XSUAA. Auth bypassed.")
        return {"user": "local-dev", "email": "local@dev.local", "scopes": []}
    
    # Check session for token
    token = request.session.get("access_token")
    if not token:
        # Not authenticated - will be handled by middleware
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Validate token
    return validate_token(token)


def get_logout_url() -> str:
    """Get XSUAA logout URL."""
    config = get_xsuaa_config()
    if config:
        return config["logout_url"]
    return "/"