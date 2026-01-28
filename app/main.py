import os
from dotenv import load_dotenv

# Load env early (repo root, then app/.env)
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, ".env"))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, JSONResponse
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import APP_TITLE, STATIC_DIR
from app.routers import web
from app.services.auth_service import (
    get_login_url,
    exchange_code_for_token,
    get_logout_url,
    get_xsuaa_config,
)


app = FastAPI(title=APP_TITLE)


# ============== Startup Event ==============
@app.on_event("startup")
async def startup_event():
    """Log startup information and verify configuration."""
    print("=" * 50)
    print(f"Starting {APP_TITLE}")
    print(f"VCAP_SERVICES present: {bool(os.getenv('VCAP_SERVICES'))}")
    print(f"VCAP_APPLICATION present: {bool(os.getenv('VCAP_APPLICATION'))}")
    
    # Check XSUAA config
    config = get_xsuaa_config()
    if config:
        print(f"XSUAA configured: client_id={bool(config.get('client_id'))}, auth_url={config.get('auth_url')}")
    else:
        print("WARNING: XSUAA not configured - auth will be bypassed")
    print("=" * 50)


# ============== Auth Middleware Class ==============
class AuthMiddleware(BaseHTTPMiddleware):
    """Check authentication for protected routes."""
    
    async def dispatch(self, request: Request, call_next):
        # Public paths that don't require auth
        public_paths = [
            "/login", "/auth/callback", "/logout", 
            "/static", "/docs", "/openapi.json",
            "/health", "/debug/auth-status"
        ]
        
        # Check if path is public
        for path in public_paths:
            if request.url.path.startswith(path):
                return await call_next(request)
        
        # Check if running locally (bypass auth)
        if not os.getenv("VCAP_SERVICES"):
            return await call_next(request)
        
        # Check for valid session
        token = request.session.get("access_token")
        if not token:
            # Not authenticated - redirect to login
            print(f"Auth middleware: No token for path {request.url.path}, redirecting to login")
            return RedirectResponse(url="/login", status_code=302)
        
        # Proceed with request
        return await call_next(request)


# ============== Middleware Stack ==============
# IMPORTANT: Middleware is added in REVERSE order of execution
# Last added = First to execute
# We want: Request → Session → Auth → Route
# So we add: Auth first, then Session

SESSION_SECRET = os.getenv("SESSION_SECRET", "fallback-dev-secret-change-in-prod")

# Add Auth middleware FIRST (will execute AFTER Session)
app.add_middleware(AuthMiddleware)

# Add Session middleware LAST (will execute FIRST)
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, max_age=3600)


# Static assets (no auth required)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ============== Auth Routes ==============

@app.get("/login")
async def login(request: Request):
    """Redirect to XSUAA login page."""
    # If running locally, just redirect to home
    if not os.getenv("VCAP_SERVICES"):
        return RedirectResponse(url="/", status_code=302)
    
    login_url = get_login_url(request)
    return RedirectResponse(url=login_url, status_code=302)


@app.get("/auth/callback")
async def auth_callback(request: Request, code: str = None, error: str = None):
    """Handle OAuth2 callback from XSUAA."""
    if error:
        print(f"Auth callback error: {error}")
        return RedirectResponse(url=f"/login?error={error}", status_code=302)
    
    if not code:
        print("Auth callback: No code received")
        return RedirectResponse(url="/login", status_code=302)
    
    try:
        # Exchange code for token
        print(f"Auth callback: Exchanging code for token")
        token_data = await exchange_code_for_token(code, request)
        
        access_token = token_data.get("access_token")
        if not access_token:
            print("Auth callback: No access_token in response")
            return RedirectResponse(url="/login?error=no_token", status_code=302)
        
        # Store token in session
        request.session["access_token"] = access_token
        request.session["refresh_token"] = token_data.get("refresh_token")
        
        print("Auth callback: Token stored in session, redirecting to home")
        # Redirect to home page
        return RedirectResponse(url="/", status_code=302)
    except Exception as e:
        print(f"Auth callback exception: {e}")
        return RedirectResponse(url=f"/login?error=auth_failed", status_code=302)


@app.get("/logout")
async def logout(request: Request):
    """Clear session and redirect to XSUAA logout."""
    request.session.clear()
    
    # If running locally, just redirect to home
    if not os.getenv("VCAP_SERVICES"):
        return RedirectResponse(url="/", status_code=302)
    
    logout_url = get_logout_url()
    return RedirectResponse(url=logout_url, status_code=302)


# ============== Health & Debug Endpoints ==============

@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Foundry."""
    config = get_xsuaa_config()
    return JSONResponse({
        "status": "healthy",
        "xsuaa_configured": config is not None,
        "vcap_services": bool(os.getenv("VCAP_SERVICES")),
    })


@app.get("/debug/auth-status")
async def debug_auth_status(request: Request):
    """Debug endpoint to check auth configuration (no sensitive data)."""
    config = get_xsuaa_config()
    return JSONResponse({
        "vcap_services_present": bool(os.getenv("VCAP_SERVICES")),
        "vcap_application_present": bool(os.getenv("VCAP_APPLICATION")),
        "xsuaa_config_loaded": config is not None,
        "xsuaa_client_id_present": bool(config.get("client_id")) if config else False,
        "xsuaa_auth_url": config.get("auth_url") if config else None,
        "session_has_token": bool(request.session.get("access_token")),
        "request_scheme": request.url.scheme,
        "x_forwarded_proto": request.headers.get("x-forwarded-proto", "not set"),
    })


# Routers
app.include_router(web.router)

