"""
XSUAA Authentication Service for SAP BTP
Handles OAuth2 login flow directly in FastAPI (no App Router needed)
"""
import os
import json
import logging
import secrets
from urllib.parse import urlencode
from fastapi import HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from app.core.config import get_ssl_context

logger = logging.getLogger(__name__)

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
            logger.warning("SAP libraries not available: %s", e)
            return False
    return True


def _get_uaa_service():
    """Get UAA service credentials lazily."""
    if not _load_sap_libs():
        return None
    
    try:
        env = AppEnv()
        # Try to get by name first
        service = env.get_service(name='bsh_dscp_ai_apps')
        if service:
            return service
        
        # Fallback: try to get by label (xsuaa)
        service = env.get_service(label='xsuaa')
        if service:
            return service
            
        logger.warning("No XSUAA service found by name 'bsh_dscp_ai_apps' or label 'xsuaa'")
        return None
    except Exception as e:
        logger.error("Error getting UAA service: %s", type(e).__name__)
        return None


def get_xsuaa_config():
    """Get XSUAA OAuth2 configuration from VCAP_SERVICES."""
    uaa_service = _get_uaa_service()
    if not uaa_service:
        logger.warning("UAA service not available")
        return None
    
    try:
        creds = uaa_service.credentials
        url = creds.get("url")
        if not url:
            logger.warning("XSUAA URL not found in credentials")
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
        logger.error("Error reading XSUAA config: %s", type(e).__name__)
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
    
    logger.debug("Callback URL resolved for OAuth flow")
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
    
    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state

    params = {
        "response_type": "code",
        "client_id": config["client_id"],
        "redirect_uri": callback_url,
        "state": state,
    }
    
    login_url = f"{config['auth_url']}?{urlencode(params)}"
    logger.debug("Login URL generated")
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
        async with httpx.AsyncClient(verify=get_ssl_context(), timeout=30.0) as client:
            logger.debug("Initiating token exchange with XSUAA")
            response = await client.post(config["token_url"], data=data)
            
            if response.status_code != 200:
                logger.warning("Token exchange failed: HTTP %s", response.status_code)
                raise HTTPException(
                    status_code=401, 
                    detail=f"Failed to exchange code for token: {response.status_code}"
                )
            
            token_data = response.json()
            logger.info("Token exchange successful")
            return token_data
    except httpx.RequestError as e:
        logger.error("Token exchange request error: %s", type(e).__name__)
        raise HTTPException(status_code=500, detail="Token exchange request failed")


def validate_token(token: str) -> dict:
    """Validate JWT token with XSUAA and return user info."""
    uaa_service = _get_uaa_service()
    if not uaa_service:
        raise HTTPException(status_code=500, detail="XSUAA service not configured")
    
    if not _load_sap_libs():
        raise HTTPException(status_code=500, detail="SAP libraries not available")
    
    try:
        security_context = xssec.create_security_context(token, uaa_service.credentials)
        
        # Get user info - use safe attribute access as method names may vary by version
        user = None
        email = None
        scopes = []
        
        # Try to get logon name
        if hasattr(security_context, 'get_logon_name'):
            user = security_context.get_logon_name()
        elif hasattr(security_context, 'getLogonName'):
            user = security_context.getLogonName()
        
        # Try to get email
        if hasattr(security_context, 'get_email'):
            email = security_context.get_email()
        elif hasattr(security_context, 'getEmail'):
            email = security_context.getEmail()
        
        # Try to get scopes - different method names in different versions
        if hasattr(security_context, 'get_granted_scopes'):
            scopes = security_context.get_granted_scopes()
        elif hasattr(security_context, 'getGrantedScopes'):
            scopes = security_context.getGrantedScopes()
        elif hasattr(security_context, 'scopes'):
            scopes = security_context.scopes
        else:
            logger.warning("Could not retrieve scopes from security context")
        
        return {
            "user": user or "Unknown",
            "email": email or "",
            "scopes": scopes or [],
        }
    except Exception as e:
        logger.warning("Token validation error")
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_current_user(request: Request) -> dict:
    """
    Get current authenticated user from session.
    Redirects to login if not authenticated.
    """
    # Check if running locally without XSUAA - requires BOTH conditions to
    # prevent silent bypass if only one gate is accidentally present.
    if not os.getenv("VCAP_SERVICES") and os.getenv("AUTH_BYPASS_LOCAL", "").lower() == "true":
        return {"user": "local-dev", "email": "local@dev.local", "scopes": []}
    
    # Check session for pre-validated user info (preferred)
    user_info = request.session.get("user_info")
    if user_info:
        return user_info

    # Check session for raw token (legacy/fallback)
    token = request.session.get("access_token")
    if not token:
        # Not authenticated - will be handled by middleware
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # Validate token if not already validated
    return validate_token(token)


def get_logout_url() -> str:
    """Get XSUAA logout URL."""
    config = get_xsuaa_config()
    if config:
        return config["logout_url"]
    return "/"