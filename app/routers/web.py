import os
import base64
from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.templating import Jinja2Templates

from app.core.config import TEMPLATES_DIR
from app.services.bpmn_service import call_brain_chat, get_signavio_bpmn_xml

router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

# Page Routes 
@router.get("/")
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@router.get("/signavio-bpmn")
async def signavio_bpmn(request: Request):
    return templates.TemplateResponse("signavio_bpmn.html", {"request": request})

@router.get("/audit-check")
async def audit_check(request: Request):
    return templates.TemplateResponse("audit_check.html", {"request": request})

# API Endpoints

@router.post("/api/generate-bpmn")
async def generate_bpmn(data: dict):
    result = await get_signavio_bpmn_xml(data)

    if result.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": result.get("message", "API Not Active"),
                "detail": result.get("detail", "Connection to Brain failed."),
            },
        )

    process_name = data.get("processName", "bpmn_diagram")
    filename = f"{process_name.replace(' ', '_')}.xml"

    return {"status": "success", "xml": result.get("result"), "filename": filename}

@router.post("/api/make-bpmn-analysis")
async def make_bpmn_analysis(data: dict):
    """ Ask the Signavio Brain to summarize its understanding of the provided process inputs. """
    brain_id = os.getenv("SIGNAVIO_BRAIN_ID")
    if not brain_id:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": "SIGNAVIO_BRAIN_ID is not configured.",
            },
        )

    prompt = (
        "You are assisting BPMN creation. Summarize your understanding of the process from the inputs.\n"
        "List: objectives, participants/lanes, start triggers, key activities/branches, end states, delays/intermediates.\n"
        "Give the Information to the User what do you understand about the process and how are you going to design it in BPMN format and what elements you will try to use"
        "also make sure to share gap or ideas if user input doesnt satisfy in proper making of BPMN"
        "Do not Provide the code, no XML, no markdown fences.\n"
        f"Inputs: {data}"
    )

    response = await call_brain_chat(brain_id, prompt, use_gpt_knowledge=False )

    if response.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": response.get("detail", "Brain authentication failed."),
            },
        )

    return {"status": "success", "analysis": response.get("result")}


@router.post("/api/audit-doc-check")
async def audit_doc_check(file: UploadFile = File(...)):
    """Send an uploaded audit PDF to the Audit Brain for analysis."""
    brain_id = os.getenv("AUDIT_CHECK_BRAIN_ID")
    if not brain_id:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": "AUDIT_CHECK_BRAIN_ID is not configured.",
            },
        )

    raw_bytes = await file.read()
    b64_content = base64.b64encode(raw_bytes).decode("utf-8")

    prompt = (
        "You are an audit reviewer. Analyze the attached PDF content. "
        "Return findings, risks, and recommendations as concise bullets. "
        "Do NOT return XML or code fences.\n"
        f"File name: {file.filename}\n"
        f"File size: {len(raw_bytes)} bytes\n"
        f"Content (base64 PDF): {b64_content}"
    )

    response = await call_brain_chat(brain_id, prompt)

    if response.get("error"):
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "API Not Active",
                "detail": response.get("detail", "Brain authentication failed."),
            },
        )

    return {"status": "success", "analysis": response.get("result")}

@router.get("/health")
async def health_check():
    """Service health check."""
    return {"status": "healthy"}