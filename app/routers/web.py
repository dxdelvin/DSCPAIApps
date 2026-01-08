from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from fastapi.templating import Jinja2Templates

from app.core.config import TEMPLATES_DIR
from app.services.bpmn_service import generate_fake_bpmn

router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@router.get("/")
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@router.get("/signavio-bpmn")
async def signavio_bpmn(request: Request):
    return templates.TemplateResponse("signavio_bpmn.html", {"request": request})


@router.get("/audit-check")
async def audit_check(request: Request):
    return templates.TemplateResponse("audit_check.html", {"request": request})


@router.post("/api/generate-bpmn")
async def generate_bpmn(data: dict):
    content, filename = generate_fake_bpmn(data)
    return JSONResponse({
        "status": "success",
        "message": "BPMN generated successfully",
        "file": filename,
        "data": data,
    })


@router.get("/download-bpmn")
async def download_bpmn():
    content, filename = generate_fake_bpmn({})
    headers = {"Content-Disposition": f"attachment; filename=\"{filename}\""}
    return Response(content=content, media_type="application/xml", headers=headers)


@router.get("/health")
async def health_check():
    return {"status": "healthy"}
