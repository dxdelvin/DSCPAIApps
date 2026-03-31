from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates

from app.core.config import TEMPLATES_DIR, CSS_VERSION, APP_ENV, CLIENT_LOGGING_ENABLED, CLIENT_LOG_LEVEL
from app.services.auth_service import get_current_user

router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


def _template_context(request: Request, extra: dict | None = None):
    context = {
        "request": request,
        "css_version": CSS_VERSION,
        "app_env": APP_ENV,
        "client_logging_enabled": CLIENT_LOGGING_ENABLED,
        "client_log_level": CLIENT_LOG_LEVEL,
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
    return _render_template(request, "signavio_bpmn.html")

@router.get("/audit-check")
async def audit_check(  request: Request):
    return _render_template(request, "audit_check.html")

@router.get("/bpmn-checker")
async def bpmn_checker(request: Request):
    return _render_template(request, "bpmn_checker.html")

@router.get("/spec-builder")
async def spec_builder(request: Request):
    return _render_template(request, "fs_br_document.html")

@router.get("/ppt-creator")
async def ppt_creator(request: Request):
    return _render_template(request, "ppt_creator.html")

@router.get("/diagram-generator")
async def diagram_generator(request: Request):
    return _render_template(request, "diagram_generator.html")


@router.get("/confluence-builder")
async def confluence_builder(request: Request):
    return _render_template(request, "confluence_builder.html")

@router.get("/health")
async def health_check():
    """Service health check."""
