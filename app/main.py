import os
from dotenv import load_dotenv

# Load env early (repo root, then app/.env)
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, ".env"))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import APP_TITLE, STATIC_DIR
from app.routers import web
from app.services.auth_service import (
    get_login_url,
    exchange_code_for_token,
    get_logout_url,
)


# ============== Auth Middleware Class ==============

class AuthMiddleware(BaseHTTPMiddleware):
    """Check authentication for protected routes."""
    
    async def dispatch(self, request: Request, call_next):
        # Public paths that don't require auth
        public_paths = ["/login", "/auth/callback", "/logout", "/static", "/docs", "/openapi.json"]
        
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
            return RedirectResponse(url="/login", status_code=302)
        
        # Proceed with request
        return await call_next(request)


app = FastAPI(title=APP_TITLE)

# Middleware order matters! Added in reverse order (last added = first to process)
# 1. First add AuthMiddleware (will run AFTER SessionMiddleware)
app.add_middleware(AuthMiddleware)

# 2. Then add SessionMiddleware (will run FIRST, before AuthMiddleware)
SESSION_SECRET = os.getenv("SESSION_SECRET")
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
        return RedirectResponse(url=f"/login?error={error}", status_code=302)
    
    if not code:
        return RedirectResponse(url="/login", status_code=302)
    
    # Exchange code for token
    token_data = await exchange_code_for_token(code, request)
    
    # Store token in session
    request.session["access_token"] = token_data.get("access_token")
    request.session["refresh_token"] = token_data.get("refresh_token")
    
    # Redirect to home page
    return RedirectResponse(url="/", status_code=302)


@app.get("/logout")
async def logout(request: Request):
    """Clear session and redirect to XSUAA logout."""
    request.session.clear()
    
    # If running locally, just redirect to home
    if not os.getenv("VCAP_SERVICES"):
        return RedirectResponse(url="/", status_code=302)
    
    logout_url = get_logout_url()
    return RedirectResponse(url=logout_url, status_code=302)


# Routers
app.include_router(web.router)

