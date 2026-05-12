"""Workspace configuration and identity helpers.

Two distinct concepts live here:

1. **Service principal context** (`get_workspace_client`, `get_catalog`, etc.) —
   the identity the app process runs as. Stable for the life of the process.

2. **Request user context** (`get_request_user`) — the identity of the human
   who made the current HTTP request. In Databricks Apps with on-behalf-of
   auth, this comes from the `X-Forwarded-*` headers; locally it falls back
   to the OS user. **Only call this from inside a request handler.**

Routes that audit-log "who did what" must use `get_request_user(request)`,
not `get_workspace_client().current_user.me()` — the latter returns the
service principal and is the same for every caller.
"""

import logging
import os

from databricks.sdk import WorkspaceClient
from fastapi import Request

logger = logging.getLogger(__name__)

# ── Process-level singletons ─────────────────────────────────────────────────

_workspace_client: WorkspaceClient | None = None


def is_databricks_app() -> bool:
    return os.getenv("DATABRICKS_APP_NAME") is not None


def get_workspace_client() -> WorkspaceClient:
    """Return the SDK client for the *service principal* identity.

    Thread-safe — the SDK client is reentrant. Use this for catalog/schema/
    warehouse access; do NOT use it to identify the calling user.
    """
    global _workspace_client
    if _workspace_client is None:
        if is_databricks_app():
            _workspace_client = WorkspaceClient()
        else:
            profile = os.getenv("DATABRICKS_PROFILE", "DEFAULT")
            _workspace_client = WorkspaceClient(profile=profile)
    return _workspace_client


# ── Required configuration (env vars) ────────────────────────────────────────

def _required(name: str) -> str:
    val = os.getenv(name, "").strip()
    if not val:
        raise RuntimeError(
            f"Required environment variable {name} is not set. "
            "Configure it in app.yaml (Databricks App) or your shell (local dev)."
        )
    return val


def get_catalog() -> str:
    return _required("CATALOG_NAME")


def get_schema() -> str:
    return _required("SCHEMA_NAME")


def get_warehouse_id() -> str:
    return _required("WAREHOUSE_ID")


def fqn(table: str) -> str:
    """Fully qualified table name with backtick quoting for numbered prefixes."""
    return f"`{get_catalog()}`.`{get_schema()}`.`{table}`"


# ── Optional configuration ───────────────────────────────────────────────────

# Dashboard + Genie space IDs are workspace-specific. They flow from
# databricks.yml variables → app.yaml ${var.X} substitution → env vars at app
# runtime. deploy_demo.sh creates these resources on a fresh workspace and
# overrides the bundle vars so the app gets the correct IDs without any
# manual editing.
def get_dashboard_id() -> str:
    return os.getenv("DASHBOARD_ID", "").strip()


def get_genie_space_id() -> str:
    return os.getenv("GENIE_SPACE_ID", "").strip()


def get_pricing_app_url() -> str:
    """External pricing-workbench app URL — parameterised via PRICING_APP_URL so
    the Workbench tile points at the right per-workspace deployment.
    Returns empty string if not configured (tile then hides)."""
    return os.getenv("PRICING_APP_URL", "").strip()


def get_workspace_host() -> str:
    """Return the workspace host without trailing slash."""
    host = os.getenv("DATABRICKS_HOST", "").strip()
    if not host:
        try:
            host = get_workspace_client().config.host or ""
        except Exception:
            host = ""
    host = host.rstrip("/")
    if host and not host.startswith("http"):
        host = f"https://{host}"
    return host


# ── Request-scoped user identity ─────────────────────────────────────────────

# Header set by the Databricks Apps proxy when on-behalf-of auth is enabled.
# Order is preference: email is most stable, then preferred-username, then user.
_FORWARDED_HEADERS = (
    "X-Forwarded-Email",
    "X-Forwarded-Preferred-Username",
    "X-Forwarded-User",
)


def get_request_user(request: Request) -> str:
    """Return the identity of the human who made this request.

    In Databricks Apps with OBO auth, the proxy injects forwarded headers.
    Locally (or if the proxy isn't configured), falls back to the OS user
    so the demo still runs end-to-end.
    """
    for header in _FORWARDED_HEADERS:
        val = request.headers.get(header) or request.headers.get(header.lower())
        if val:
            return val.strip()
    # Fallback for local dev / when the proxy doesn't inject headers
    return os.getenv("USER", "demo-user")
