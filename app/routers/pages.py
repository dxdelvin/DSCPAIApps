import asyncio
import json
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app.core.config import TEMPLATES_DIR, STATIC_DIR, CSS_VERSION, APP_ENV, CLIENT_LOGGING_ENABLED, CLIENT_LOG_LEVEL, IS_PRODUCTION
from app.services.auth_service import get_current_user
from app.services.History.analytics_service import track_click, ADMIN_USERS

router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

_changelog_file = STATIC_DIR / "data" / ("changelog_prod.json" if IS_PRODUCTION else "changelog_dev.json")

def _load_changelog() -> list:
    try:
        return json.loads(_changelog_file.read_text(encoding="utf-8"))
    except Exception:
        return []


def _template_context(request: Request, extra: dict | None = None):
    context = {
        "request": request,
        "css_version": CSS_VERSION,
        "app_env": APP_ENV,
        "client_logging_enabled": CLIENT_LOGGING_ENABLED,
        "client_log_level": CLIENT_LOG_LEVEL,
        "changelog": _load_changelog(),
    }
    if extra:
        context.update(extra)
    return context


def _render_template(request: Request, name: str, extra: dict | None = None):
    context = _template_context(request, extra)
    try:
        # Newer Starlette/FastAPI signature.
        return templates.TemplateResponse(request=request, name=name, context=context)
    except TypeError:
        # Older Starlette signature.
        return templates.TemplateResponse(name, context)

@router.get("/")
async def home(request: Request):
    user_info = get_current_user(request)
    username = user_info.get("user", "Guest")

    return _render_template(request, "index.html", {"username": username})

@router.get("/signavio-bpmn")
async def signavio_bpmn(request: Request):
    user_info = get_current_user(request)
    asyncio.create_task(track_click("bpmn", user_info.get("user", "anonymous")))
    return _render_template(request, "signavio_bpmn.html", {"user_id": user_info.get("user", "Guest")})

@router.get("/audit-check")
async def audit_check(request: Request):
    user_info = get_current_user(request)
    asyncio.create_task(track_click("audit", user_info.get("user", "anonymous")))
    return _render_template(request, "audit_check.html")

@router.get("/bpmn-checker")
async def bpmn_checker(request: Request):
    user_info = get_current_user(request)
    asyncio.create_task(track_click("bpmn-checker", user_info.get("user", "anonymous")))
    return _render_template(request, "bpmn_checker.html")

@router.get("/spec-builder")
async def spec_builder(request: Request):
    user_info = get_current_user(request)
    asyncio.create_task(track_click("spec-builder", user_info.get("user", "anonymous")))
    return _render_template(request, "fs_br_document.html")

@router.get("/ppt-creator")
async def ppt_creator(request: Request):
    user_info = get_current_user(request)
    asyncio.create_task(track_click("ppt", user_info.get("user", "anonymous")))
    return _render_template(request, "ppt_creator.html", {"user_id": user_info.get("user", "Guest")})

@router.get("/diagram-generator")
async def diagram_generator(request: Request):
    user_info = get_current_user(request)
    asyncio.create_task(track_click("diagram", user_info.get("user", "anonymous")))
    return _render_template(request, "diagram_generator.html")

@router.get("/docupedia-publisher")
async def docupedia_publisher(request: Request):
    user_info = get_current_user(request)
    asyncio.create_task(track_click("docupedia", user_info.get("user", "anonymous")))
    return _render_template(request, "docupedia_publisher.html")

@router.get("/one-pager-creator")
async def one_pager_creator(request: Request):
    user_info = get_current_user(request)
    asyncio.create_task(track_click("one-pager", user_info.get("user", "anonymous")))
    return _render_template(request, "one_pager_creator.html")

@router.get("/signavio-learning")
async def signavio_learning_redirect(request: Request):
    user_info = get_current_user(request)
    asyncio.create_task(track_click("signavio-learning", user_info.get("user", "anonymous")))
    return RedirectResponse(
        url="https://pages.github-bshg.boschdevcloud.com/DSD9DI/SignavioModelling/index.html",
        status_code=302,
    )

@router.get("/dscpadmin")
async def admin_dashboard(request: Request):
    user_info = get_current_user(request)
    if user_info.get("user", "").lower() not in ADMIN_USERS:
        context = _template_context(request)
        try:
            return templates.TemplateResponse(
                request=request, name="errors/403.html", context=context, status_code=403
            )
        except TypeError:
            return templates.TemplateResponse("errors/403.html", context, status_code=403)
    return _render_template(request, "admin.html", {"username": user_info.get("user", "")})

@router.get("/health")
async def health_check():
    """Service health check."""
