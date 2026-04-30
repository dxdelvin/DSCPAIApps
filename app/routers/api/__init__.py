"""API router aggregator.

Every feature has its own module under `app.routers.api.<feature>`,
each exposing an `APIRouter` named `router`. This file mounts them all
onto a single parent router that `app.main` includes under `/api`.
"""
from fastapi import APIRouter

from . import (
    client_log, bpmn, audit, bpmn_checker, spec_builder,
    ppt, diagram, confluence, one_pager,
    favorites, admin, feedback,
)

router = APIRouter()
router.include_router(client_log.router)
router.include_router(bpmn.router)
router.include_router(audit.router)
router.include_router(bpmn_checker.router)
router.include_router(spec_builder.router)
router.include_router(ppt.router)
router.include_router(diagram.router)
router.include_router(confluence.router)
router.include_router(one_pager.router)
router.include_router(favorites.router)
router.include_router(admin.router)
router.include_router(feedback.router)

__all__ = ["router"]
