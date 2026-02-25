import os
from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates

from app.core.config import TEMPLATES_DIR, CSS_VERSION
from app.services.auth_service import get_current_user

router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

@router.get("/")
async def home(request: Request):
    # Get current user info for welcome message
    user_info = get_current_user(request)
    username = user_info.get("user", "Guest")
    
    return templates.TemplateResponse("index.html", {
        "request": request,
        "username": username,
        "css_version": CSS_VERSION,
    })

@router.get("/signavio-bpmn")
async def signavio_bpmn(request: Request):
    return templates.TemplateResponse("signavio_bpmn.html", {
        "request": request,
        "css_version": CSS_VERSION,
    })

@router.get("/audit-check")
async def audit_check(request: Request):
    return templates.TemplateResponse("audit_check.html", {
        "request": request,
        "css_version": CSS_VERSION,
    })

@router.get("/bpmn-checker")
async def bpmn_checker(request: Request):
    return templates.TemplateResponse("bpmn_checker.html", {
        "request": request,
        "css_version": CSS_VERSION,
    })

@router.get("/spec-builder")
async def spec_builder(request: Request):
    return templates.TemplateResponse("functional_spec.html", {
        "request": request,
        "css_version": CSS_VERSION,
    })

@router.get("/ppt-creator")
async def ppt_creator(request: Request):
    return templates.TemplateResponse("ppt_creator.html", {
        "request": request,
        "css_version": CSS_VERSION,
    })

@router.get("/health")
async def health_check():
    """Service health check."""
    return {"status": "healthy"}
