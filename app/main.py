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
