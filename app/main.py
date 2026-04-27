import os
from dotenv import load_dotenv

# Load env early (repo root, then app/.env)
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, ".env"))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

# Strip proxy env vars in production â€” .env may set them for local VPN but
# they would break DNS resolution on SAP BTP.
if os.getenv("ENVIRONMENT", "dev").lower() == "prod":
    for _key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        os.environ.pop(_key, None)

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, JSONResponse
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import os
import secrets
import sys
from urllib.parse import quote

from app.core.config import APP_TITLE, STATIC_DIR, TEMPLATES_DIR
from app.routers import pages, api
from app.services.auth_service import (
    get_login_url,
    exchange_code_for_token,
    get_logout_url,
    get_xsuaa_config,
    validate_token,
)


app = FastAPI(title=APP_TITLE)


@app.on_event("startup")
async def startup_event():
    """Print startup information and verify configuration."""
    print("=" * 50)
    print(f"Starting {APP_TITLE}")
    
    config = get_xsuaa_config()
    if config:
        print(f"XSUAA configured: client_id={bool(config.get('client_id'))}, auth_url={config.get('auth_url')}")
    else:
        print("WARNING: XSUAA not configured - auth will be bypassed")
    print("=" * 50)



class MaxBodySizeMiddleware(BaseHTTPMiddleware):
    """Reject requests whose declared Content-Length exceeds 15 MB.

    Also guards against chunked transfer encoding (no Content-Length) by
    reading the full body before passing it downstream. BaseHTTPMiddleware
    caches the body in request._body so route handlers still receive it.
    """

    _MAX_BYTES = 15 * 1024 * 1024  # 15 MB

    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl is not None:
            try:
                if int(cl) > self._MAX_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Request body too large (max 15 MB)"},
                    )
            except ValueError:
                pass
        # Also enforce the limit for chunked-encoded bodies that carry no
        # Content-Length header. Starlette's Request.body() caches the bytes
        # so downstream handlers read the same data without re-consuming it.
        body = await request.body()
        if len(body) > self._MAX_BYTES:
            return JSONResponse(
                status_code=413,
                content={"detail": "Request body too large (max 15 MB)"},
            )
        return await call_next(request)


class AuthMiddleware(BaseHTTPMiddleware):
    """Check authentication for protected routes."""
    
    async def dispatch(self, request: Request, call_next):
        public_paths = [
            "/login", "/auth/callback", "/logout", 
            "/static", "/docs", "/openapi.json",
            "/health",
        ]
        
        for path in public_paths:
            if request.url.path.startswith(path):
                return await call_next(request)
        
        # Bypass auth only when explicitly opted in AND not on Cloud Foundry
        if not os.getenv("VCAP_SERVICES") and os.getenv("AUTH_BYPASS_LOCAL", "").lower() == "true":
            return await call_next(request)
        
        if not request.session.get("user_info") and not request.session.get("access_token"):
            print(f"Auth middleware: No session for path {request.url.path}, redirecting to login")
            return RedirectResponse(url="/login", status_code=302)
        
        return await call_next(request)



# IMPORTANT: Middleware is added in REVERSE order of execution
# Last added = First to execute
# We want: Request â†’ Session â†’ Auth â†’ Route
# So we add: Auth first, then Session

SESSION_SECRET = os.getenv("SESSION_SECRET", "")
IS_PROD_ENV = bool(os.getenv("VCAP_SERVICES")) or os.getenv("ENVIRONMENT") == "prod"

if IS_PROD_ENV and not SESSION_SECRET:
    raise RuntimeError("SESSION_SECRET must be set in production")
if not SESSION_SECRET:
    SESSION_SECRET = "fallback-dev-secret-change-in-prod"

app.add_middleware(AuthMiddleware)

app.add_middleware(
    SessionMiddleware, 
    secret_key=SESSION_SECRET, 
    max_age=3600,
    https_only=IS_PROD_ENV,  # Secure cookies in prod (requires proxy headers!)
    same_site="lax"
)

app.add_middleware(MaxBodySizeMiddleware)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to every response."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        return response


app.add_middleware(SecurityHeadersMiddleware)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")




@app.get("/login")
async def login(request: Request):
    """Redirect to XSUAA login page."""
    if not os.getenv("VCAP_SERVICES"):
        return RedirectResponse(url="/", status_code=302)
    
    login_url = get_login_url(request)
    return RedirectResponse(url=login_url, status_code=302)


@app.get("/auth/callback")
async def auth_callback(request: Request, code: str = None, error: str = None, state: str = None):
    """Handle OAuth2 callback from XSUAA."""
    if error:
        print(f"Auth callback error: {error}")
        return RedirectResponse(url=f"/login?error={quote(error)}", status_code=302)
    
    if not code:
        print("Auth callback: No code received")
        return RedirectResponse(url="/login", status_code=302)
    
    expected_state = request.session.pop("oauth_state", None)
    if not expected_state or not state or not secrets.compare_digest(expected_state, state):
        print("Auth callback: Invalid OAuth state")
        return RedirectResponse(url="/login?error=invalid_state", status_code=302)
    
    try:
        print(f"Auth callback: Exchanging code for token")
        token_data = await exchange_code_for_token(code, request)
        
        access_token = token_data.get("access_token")
        if not access_token:
            print("Auth callback: No access_token in response")
            return RedirectResponse(url="/login?error=no_token", status_code=302)
        
        # Validate and store user info (optimized for cookie size)
        try:
            user_info = validate_token(access_token)
            request.session["user_info"] = user_info
            # We explicitly do NOT store the full access_token in the session cookie
            # because XSUAA JWTs are often >4KB, causing browsers to drop the cookie.
            # This fixes the "Too many redirects" loop.
            print(f"Auth callback: User {user_info.get('user')} authenticated")
        except Exception as e:
            print(f"Token validation failed in callback: {e}")
            return RedirectResponse(url="/login?error=token_validation_failed", status_code=302)
        
        print("Auth callback: Session established, redirecting to home")
        return RedirectResponse(url="/", status_code=302)
    except Exception as e:
        print(f"Auth callback exception: {e}")
        return RedirectResponse(url=f"/login?error=auth_failed", status_code=302)


@app.get("/logout")
async def logout(request: Request):
    """Clear session and redirect to XSUAA logout."""
    request.session.clear()
    
    if not os.getenv("VCAP_SERVICES"):
        return RedirectResponse(url="/", status_code=302)
    
    logout_url = get_logout_url()
    return RedirectResponse(url=logout_url, status_code=302)




@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Foundry."""
    return JSONResponse({"status": "healthy"})


app.include_router(pages.router)
app.include_router(api.router, prefix="/api")


from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.templating import Jinja2Templates

_templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException):
    _page_templates = {401: "errors/401.html", 403: "errors/403.html", 404: "errors/404.html"}
    if exc.status_code in _page_templates:
        context = {"request": request}
        try:
            return _templates.TemplateResponse(
                request=request,
                name=_page_templates[exc.status_code],
                context=context,
                status_code=exc.status_code,
            )
        except TypeError:
            return _templates.TemplateResponse(
                _page_templates[exc.status_code],
                context,
                status_code=exc.status_code,
            )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


