"""
XSUAA Authentication Service for SAP BTP
Handles OAuth2 login flow directly in FastAPI (no App Router needed)
"""
import os
import json
from urllib.parse import urlencode
from fastapi import HTTPException, Request, Response
from fastapi.responses import RedirectResponse

# Lazy loading for SAP libraries to handle import errors gracefully
xssec = None
AppEnv = None

def _load_sap_libs():
    """Lazily load SAP libraries."""
    global xssec, AppEnv
    if xssec is None:
        try:
            from sap import xssec as _xssec
            from cfenv import AppEnv as _AppEnv
            xssec = _xssec
            AppEnv = _AppEnv
        except ImportError as e:
            print(f"Warning: SAP libraries not available: {e}")
            return False
    return True


def _get_uaa_service():
    """Get UAA service credentials lazily."""
    if not _load_sap_libs():
        return None
    
    try:
        env = AppEnv()
        # Try to get by name first
        service = env.get_service(name='dscp-ai-app')
        if service:
            return service
        
        # Fallback: try to get by label (xsuaa)
        service = env.get_service(label='xsuaa')
        if service:
            return service
            
        print("Warning: No XSUAA service found by name 'dscp-ai-app' or label 'xsuaa'")
        return None
    except Exception as e:
        print(f"Error getting UAA service: {e}")
        return None


def get_xsuaa_config():
    """Get XSUAA OAuth2 configuration from VCAP_SERVICES."""
    uaa_service = _get_uaa_service()
    if not uaa_service:
        print("Warning: UAA service not available")
        return None
    
    try:
        creds = uaa_service.credentials
        url = creds.get("url")
        if not url:
            print("Warning: XSUAA URL not found in credentials")
            return None
            
        return {
            "client_id": creds.get("clientid"),
            "client_secret": creds.get("clientsecret"),
            "auth_url": f"{url}/oauth/authorize",
            "token_url": f"{url}/oauth/token",
            "logout_url": f"{url}/logout",
            "xsappname": creds.get("xsappname"),
        }
    except Exception as e:
        print(f"Error reading XSUAA config: {e}")
        return None


def _get_callback_url(request: Request) -> str:
    """
    Build the callback URL, ensuring HTTPS is used in production.
    Cloud Foundry apps are behind a load balancer, so we need to check
    the X-Forwarded-Proto header.
    """
    callback_url = str(request.url_for("auth_callback"))
    
    # Check if we're behind a proxy (Cloud Foundry)
    forwarded_proto = request.headers.get("x-forwarded-proto", "").lower()
    if forwarded_proto == "https" and callback_url.startswith("http://"):
        callback_url = callback_url.replace("http://", "https://", 1)
    
    # Also check if VCAP_APPLICATION exists (running on CF)
    if os.getenv("VCAP_APPLICATION") and callback_url.startswith("http://"):
        callback_url = callback_url.replace("http://", "https://", 1)
    
    print(f"Callback URL: {callback_url}")
    return callback_url


def get_login_url(request: Request) -> str:
    """Generate the XSUAA login URL for OAuth2 authorization."""
    config = get_xsuaa_config()
    if not config:
        raise HTTPException(status_code=500, detail="XSUAA service not configured")
    
    if not config.get("client_id"):
        raise HTTPException(status_code=500, detail="XSUAA client_id not found")
    
    # Build callback URL with HTTPS fix
    callback_url = _get_callback_url(request)
    
    params = {
        "response_type": "code",
        "client_id": config["client_id"],
        "redirect_uri": callback_url,
    }
    
    login_url = f"{config['auth_url']}?{urlencode(params)}"
    print(f"Login URL: {login_url}")
    return login_url


async def exchange_code_for_token(code: str, request: Request) -> dict:
    """Exchange authorization code for access token."""
    import httpx
    
    config = get_xsuaa_config()
    if not config:
        raise HTTPException(status_code=500, detail="XSUAA service not configured")
    
    # Use the same callback URL with HTTPS fix
    callback_url = _get_callback_url(request)
    
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": callback_url,
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
    }
    
    try:
        async with httpx.AsyncClient(verify=False, timeout=30.0) as client:
            print(f"Token exchange request to: {config['token_url']}")
            response = await client.post(config["token_url"], data=data)
            
            if response.status_code != 200:
                error_detail = response.text
                print(f"Token exchange failed: {response.status_code} - {error_detail}")
                raise HTTPException(
                    status_code=401, 
                    detail=f"Failed to exchange code for token: {response.status_code}"
                )
            
            token_data = response.json()
            print(f"Token exchange successful, got access_token: {bool(token_data.get('access_token'))}")
            return token_data
    except httpx.RequestError as e:
        print(f"Token exchange request error: {e}")
        raise HTTPException(status_code=500, detail=f"Token exchange request failed: {str(e)}")


def validate_token(token: str) -> dict:
    """Validate JWT token with XSUAA and return user info."""
    uaa_service = _get_uaa_service()
    if not uaa_service:
        raise HTTPException(status_code=500, detail="XSUAA service not configured")
    
    if not _load_sap_libs():
        raise HTTPException(status_code=500, detail="SAP libraries not available")
    
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