import os
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

@router.get("/")
async def home(request: Request):
    user_info = get_current_user(request)
    username = user_info.get("user", "Guest")

    return templates.TemplateResponse(
        request=request, 
        name="index.html", 
        context=_template_context(request, {"username": username})
    )

@router.get("/signavio-bpmn")
async def signavio_bpmn(request: Request):
    return templates.TemplateResponse(
        request=request, name="signavio_bpmn.html", context=_template_context(request)
    )

@router.get("/audit-check")
async def audit_check(request: Request):
    return templates.TemplateResponse(
        request=request, name="audit_check.html", context=_template_context(request)
    )

@router.get("/bpmn-checker")
async def bpmn_checker(request: Request):
    return templates.TemplateResponse(
        request=request, name="bpmn_checker.html", context=_template_context(request)
    )

@router.get("/spec-builder")
async def spec_builder(request: Request):
    return templates.TemplateResponse(
        request=request, name="fs_br_document.html", context=_template_context(request)
    )

@router.get("/ppt-creator")
async def ppt_creator(request: Request):
    return templates.TemplateResponse(
        request=request, name="ppt_creator.html", context=_template_context(request)
    )

@router.get("/diagram-generator")
async def diagram_generator(request: Request):
    return templates.TemplateResponse(
        request=request, name="diagram_generator.html", context=_template_context(request)
    )

@router.get("/health")
async def health_check():
    """Service health check."""