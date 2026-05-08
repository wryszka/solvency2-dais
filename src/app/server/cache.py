"""Demo cache — pre-baked AI outputs for live-stage fallback.

Each AI agent endpoint can opt into the cache by:
  1. Computing a `cache_key` (typically scene_id + period + payload hash).
  2. Calling `cache_lookup(cache_key)` first.
  3. On miss, running live, then `cache_persist(cache_key, output_json)`.

Routes also honour `?cached=1` query param to FORCE cache even on miss
(returns 503 if no cached entry — better than running live and lying).

Toggle priority for "should I use cache":
  ?cached=1 query param  >  DEMO_MODE=cached env var  >  live (default)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from databricks.sdk.service.sql import StatementParameterListItem
from fastapi import HTTPException, Request

from server.config import fqn
from server.sql import execute_query

logger = logging.getLogger(__name__)

CACHE_TABLE = "6_ai_demo_cache"


async def ensure_cache_table() -> None:
    await execute_query(
        f"CREATE TABLE IF NOT EXISTS {fqn(CACHE_TABLE)} ("
        " cache_key STRING, agent_name STRING, scene_id STRING,"
        " reporting_period STRING, output_json STRING,"
        " cached_at TIMESTAMP, cached_by STRING)"
    )


def make_cache_key(agent_name: str, scene_id: str, period: str | None = None,
                   extra: dict | None = None) -> str:
    """Stable hash for the cache key. Same inputs → same key."""
    h = hashlib.sha256()
    h.update(agent_name.encode())
    h.update(b"|")
    h.update(scene_id.encode())
    h.update(b"|")
    h.update((period or "").encode())
    if extra:
        h.update(b"|")
        h.update(json.dumps(extra, sort_keys=True).encode())
    return h.hexdigest()[:24]


def should_use_cache(request: Request) -> bool:
    """Return True if this request should be served from cache.

    ?cached=1  →  yes
    ?cached=0  →  no (explicit live override)
    else DEMO_MODE=cached → yes
    """
    q = request.query_params.get("cached")
    if q is not None:
        return q in ("1", "true", "yes", "on")
    return os.getenv("DEMO_MODE", "").strip().lower() == "cached"


async def cache_lookup(cache_key: str) -> dict | None:
    """Return cached output dict or None on miss."""
    try:
        await ensure_cache_table()
        rows = await execute_query(
            f"SELECT output_json, cached_at, cached_by FROM {fqn(CACHE_TABLE)} WHERE cache_key = :k LIMIT 1",
            parameters=[StatementParameterListItem(name="k", value=cache_key)],
        )
        if not rows:
            return None
        try:
            payload = json.loads(rows[0]["output_json"])
        except Exception:
            return None
        # Annotate so the frontend can show "cached output" badge
        payload["_demo_cache_hit"] = True
        payload["_cached_at"] = str(rows[0].get("cached_at"))
        payload["_cached_by"] = rows[0].get("cached_by")
        return payload
    except Exception:
        logger.debug("cache_lookup failed", exc_info=True)
        return None


async def cache_persist(cache_key: str, agent_name: str, scene_id: str,
                        period: str | None, output: dict, user: str = "demo-bake") -> None:
    """Persist the live output for future cached lookups."""
    try:
        await ensure_cache_table()
        # Strip annotations before persist
        out = {k: v for k, v in output.items() if not k.startswith("_demo_cache_")}
        # Upsert pattern: delete then insert
        await execute_query(
            f"DELETE FROM {fqn(CACHE_TABLE)} WHERE cache_key = :k",
            parameters=[StatementParameterListItem(name="k", value=cache_key)],
        )
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        await execute_query(
            f"INSERT INTO {fqn(CACHE_TABLE)} "
            "(cache_key, agent_name, scene_id, reporting_period, output_json, cached_at, cached_by) "
            "VALUES (:k, :a, :s, :p, :j, CAST(:t AS TIMESTAMP), :u)",
            parameters=[
                StatementParameterListItem(name="k", value=cache_key),
                StatementParameterListItem(name="a", value=agent_name),
                StatementParameterListItem(name="s", value=scene_id),
                StatementParameterListItem(name="p", value=period or ""),
                StatementParameterListItem(name="j", value=json.dumps(out, default=str)),
                StatementParameterListItem(name="t", value=now),
                StatementParameterListItem(name="u", value=user),
            ],
        )
    except Exception:
        logger.debug("cache_persist failed", exc_info=True)


def cache_miss_503() -> HTTPException:
    """Raise this when cached=1 was forced and nothing is cached."""
    return HTTPException(
        503,
        "Cached mode requested but no cached output for this request. "
        "Either run with ?cached=0 to force live, or pre-bake via "
        "scripts/bake_cache.sh.",
    )
