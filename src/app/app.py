import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.routes import reports, approvals, monitoring, regulator, genie, supervisor, archive, landing, orsa, afr, sfcr, rsr, model_governance, internal_controls, life, overlays, governance, audit, agents, demo
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


async def _ensure_agent_audit_table():
    """Create 5_mon_agent_audit table — populated by the audit middleware."""
    try:
        from server.sql import execute_query
        from server.config import fqn
        await execute_query(
            f"CREATE TABLE IF NOT EXISTS {fqn('5_mon_agent_audit')} ("
            " call_id STRING, called_at TIMESTAMP, user_email STRING,"
            " method STRING, path STRING, status_code INT,"
            " duration_ms BIGINT, status STRING)"
        )
    except Exception:
        logger.exception("Failed to ensure 5_mon_agent_audit table")


@asynccontextmanager
async def lifespan(application: FastAPI):
    logger.info("Starting Solvency II QRT Reporting App")
    try:
        await approvals.ensure_approvals_table()
        logger.info("Approvals table ready")
    except Exception:
        logger.exception("Failed to ensure approvals table — will retry on first request")
    try:
        await _ensure_agent_audit_table()
    except Exception:
        logger.exception("Failed to ensure agent audit table")
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
app.include_router(orsa.router)
app.include_router(afr.router)
app.include_router(sfcr.router)
app.include_router(rsr.router)
app.include_router(model_governance.router)
app.include_router(internal_controls.router)
app.include_router(life.router)
app.include_router(overlays.router)
app.include_router(governance.router)
app.include_router(audit.router)
app.include_router(agents.router)
app.include_router(demo.router)
from server.routes import model_development as _model_development
app.include_router(_model_development.router)


@app.middleware("http")
async def audit_log_middleware(request: Request, call_next):
    """Log every API request to stdout AND persist to 5_mon_agent_audit.

    Skips static SPA assets, healthcheck, and the audit fetch itself (so
    the page that reads the table doesn't write to the table).
    """
    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)
    if path in ("/api/health", "/api/me") or path.startswith("/api/internal-controls/audit"):
        return await call_next(request)

    try:
        user = get_request_user(request)
    except Exception:
        user = "unknown"
    started = time.monotonic()
    response = None
    err = None
    try:
        response = await call_next(request)
        return response
    except Exception as exc:
        err = exc
        raise
    finally:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        status_code = response.status_code if response is not None else 500
        status_label = "ok" if (response is not None and 200 <= status_code < 400) else (
            "error" if response is not None else "exception"
        )
        # stdout audit
        if err:
            logger.exception(
                "[audit] %s %s user=%s status=ERROR duration_ms=%d",
                request.method, path, user, elapsed_ms,
            )
        else:
            logger.info(
                "[audit] %s %s user=%s status=%s duration_ms=%d",
                request.method, path, user, status_code, elapsed_ms,
            )
        # Persist — best-effort. Never break the request loop.
        try:
            import uuid
            from datetime import datetime, timezone
            from databricks.sdk.service.sql import StatementParameterListItem
            from server.config import fqn
            from server.sql import execute_query
            now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            await execute_query(
                f"INSERT INTO {fqn('5_mon_agent_audit')} "
                "(call_id, called_at, user_email, method, path, status_code, duration_ms, status) "
                "VALUES (:cid, CAST(:ts AS TIMESTAMP), :u, :m, :p, :sc, :d, :st)",
                parameters=[
                    StatementParameterListItem(name="cid", value=str(uuid.uuid4())),
                    StatementParameterListItem(name="ts",  value=now),
                    StatementParameterListItem(name="u",   value=user),
                    StatementParameterListItem(name="m",   value=request.method),
                    StatementParameterListItem(name="p",   value=path),
                    StatementParameterListItem(name="sc",  value=str(status_code), type="INT"),
                    StatementParameterListItem(name="d",   value=str(elapsed_ms),  type="LONG"),
                    StatementParameterListItem(name="st",  value=status_label),
                ],
            )
        except Exception:
            logger.debug("Audit persist failed (non-fatal)", exc_info=True)


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
    from server.config import get_pricing_app_url
    host = get_workspace_host()
    dashboard_id = get_dashboard_id()
    genie_space_id = get_genie_space_id()
    return {
        "dashboard_url": f"{host}/embed/dashboardsv3/{dashboard_id}",
        "genie_url": f"{host}/embed/genie/spaces/{genie_space_id}",
        "dashboard_id": dashboard_id,
        "genie_space_id": genie_space_id,
        "pricing_app_url": get_pricing_app_url(),
    }


@app.get("/api/backstage-url")
async def backstage_url(request: Request):
    """Return a deep link to the technical-deep-dive notebook in the workspace.

    Path is sourced from BACKSTAGE_NOTEBOOK_PATH (set by the bundle's
    backstage_notebook_path variable in databricks.yml). When unset, the
    sidebar Backstage icon stays hidden — the frontend treats an empty URL
    as "no link", so this function returns no URL when the path is missing.
    """
    import os
    nb_path = os.getenv("BACKSTAGE_NOTEBOOK_PATH", "").strip()
    if not nb_path:
        return {"url": ""}
    host = get_workspace_host()
    return {"url": f"{host}#notebook{nb_path}"}


if FRONTEND_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = FRONTEND_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIR / "index.html")
