import os
from dotenv import load_dotenv

# Load env early (repo root, then app/.env)
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, ".env"))
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.core.config import APP_TITLE, STATIC_DIR
from app.routers import web

app = FastAPI(title=APP_TITLE)

# Static assets
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Routers
app.include_router(web.router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
