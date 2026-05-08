import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.routes import reports, approvals, monitoring, regulator, genie, supervisor, archive, landing
from server.config import get_dashboard_id, get_genie_space_id, get_workspace_host, get_request_user

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent / "frontend" / "dist"


async def _warmup_warehouse():
    """Fire a tiny query to wake the SQL warehouse so first user request isn't slow."""
    try:
        from server.sql import execute_query
        await execute_query("SELECT 1 AS warmup")
        logger.info("Warehouse warmup completed")
    except Exception:
        logger.exception("Warehouse warmup failed — will retry on first request")


@asynccontextmanager
async def lifespan(application: FastAPI):
    logger.info("Starting Solvency II QRT Reporting App")
    try:
        await approvals.ensure_approvals_table()
        logger.info("Approvals table ready")
    except Exception:
        logger.exception("Failed to ensure approvals table — will retry on first request")
    # Fire-and-forget warmup so we don't block app startup
    import asyncio
    asyncio.create_task(_warmup_warehouse())
    yield
    logger.info("Shutting down")


app = FastAPI(
    title="Solvency II QRT Reporting & Approval",
    version="2.0.0",
    lifespan=lifespan,
)

app.include_router(reports.router)
app.include_router(approvals.router)
app.include_router(monitoring.router)
app.include_router(regulator.router)
app.include_router(genie.router)
app.include_router(supervisor.router)
app.include_router(archive.router)
app.include_router(landing.router)


@app.middleware("http")
async def audit_log_middleware(request: Request, call_next):
    """Log every API request with the resolved user identity.

    Skips the static SPA assets to keep the log readable. Failures here must
    not break the request — wrap the user lookup defensively.
    """
    if not request.url.path.startswith("/api/"):
        return await call_next(request)

    try:
        user = get_request_user(request)
    except Exception:
        user = "unknown"
    started = time.monotonic()
    try:
        response = await call_next(request)
        elapsed_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "[audit] %s %s user=%s status=%s duration_ms=%d",
            request.method, request.url.path, user, response.status_code, elapsed_ms,
        )
        return response
    except Exception:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        logger.exception(
            "[audit] %s %s user=%s status=ERROR duration_ms=%d",
            request.method, request.url.path, user, elapsed_ms,
        )
        raise


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/me")
async def me(request: Request):
    """Return the identity of the current request user.

    Source order: X-Forwarded-Email -> X-Forwarded-Preferred-Username
    -> X-Forwarded-User -> $USER (local dev fallback).
    """
    return {"user": get_request_user(request)}


@app.get("/api/embeds")
async def embeds():
    host = get_workspace_host()
    dashboard_id = get_dashboard_id()
    genie_space_id = get_genie_space_id()
    return {
        "dashboard_url": f"{host}/embed/dashboardsv3/{dashboard_id}",
        "genie_url": f"{host}/embed/genie/spaces/{genie_space_id}",
        "dashboard_id": dashboard_id,
        "genie_space_id": genie_space_id,
    }


@app.get("/api/backstage-url")
async def backstage_url(request: Request):
    """Return a deep link to the technical-deep-dive notebook in the workspace.

    BACKSTAGE_NOTEBOOK_PATH (env) overrides the default; the default assumes
    the bundle synced source under the calling user's home folder.
    """
    import os
    host = get_workspace_host()
    nb_path = os.getenv("BACKSTAGE_NOTEBOOK_PATH", "").strip()
    if nb_path:
        return {"url": f"{host}#notebook{nb_path}"}
    try:
        user = get_request_user(request)
        nb_path = f"/Workspace/Users/{user}/06_backstage_technical"
        return {"url": f"{host}#notebook{nb_path}"}
    except Exception:
        return {"url": f"{host}#workspace"}


if FRONTEND_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = FRONTEND_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIR / "index.html")
