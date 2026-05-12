"""Submissions archive + process-management metrics.

Both endpoints read from `gold_submissions_archive` — the single source of
truth for the demo's reporting-history (33 rows × 6 periods, seeded by
`seed_phase5_demo`). The earlier `6_ai_approvals`-based implementation
relied on a write path that's only exercised when a live user submits a
QRT, so the table stayed empty after a clean deploy and the Process tab
rendered blank.

The archive table carries pre-computed cycle_days, dq_pass_rate, and a
"feeds_complete" `X/Y` string per row, so the metric aggregation here is
straightforward and avoids re-deriving cycle time from timestamps.

The independent monitoring tables (`5_mon_dq_expectation_results` +
`5_mon_pipeline_sla_status`) still drive the period-level DQ and feed
trend charts — they're populated and live-correct.
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from server.config import fqn
from server.sql import execute_query_cached

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/archive", tags=["archive"])


# `qrt` column in the archive carries the EIOPA template label (e.g. "S.05.01")
# or a doc-type label ("SFCR", "RSR", "ORSA"). We normalise to a slug for the
# frontend so links like /report/s0501 continue to work.
_QRT_LABEL_TO_SLUG: dict[str, str] = {
    "S.05.01": "s0501",
    "S.06.02": "s0602",
    "S.12.01": "s1201",
    "S.25.01": "s2501",
    "S.26.06": "s2606",
}

_QRT_TITLES: dict[str, str] = {
    "s0501": "Premiums, Claims & Expenses",
    "s0602": "List of Assets",
    "s1201": "Life Technical Provisions",
    "s2501": "SCR — Standard Formula",
    "s2606": "Non-Life Underwriting Risk",
    "sfcr":  "Solvency and Financial Condition Report",
    "rsr":   "Regular Supervisory Report",
    "orsa":  "Own Risk & Solvency Assessment",
}


def _qrt_slug(qrt_label: str) -> str:
    if qrt_label in _QRT_LABEL_TO_SLUG:
        return _QRT_LABEL_TO_SLUG[qrt_label]
    return qrt_label.lower().replace(".", "")


def _normalised_status(raw: str | None) -> str:
    """Map archive-table statuses to the frontend's 3-state vocabulary."""
    if not raw:
        return "pending"
    r = str(raw).strip().lower()
    if r in {"approved", "submitted"}:
        return "approved"
    if r == "rejected":
        return "rejected"
    return "pending"


def _parse_feeds_complete(s: str | None) -> tuple[int, int]:
    """`'7/8'` → (received=7, total=8). Returns (0, 0) when unparseable."""
    if not s or "/" not in str(s):
        return 0, 0
    try:
        a, b = str(s).split("/", 1)
        return int(a.strip()), int(b.strip())
    except Exception:
        return 0, 0


async def _load_archive_rows() -> list[dict[str, Any]]:
    q = f"""
        SELECT period, qrt, qrt_title, doc_type, status,
               submitted_at, submitted_by, reviewed_by, reviewed_at,
               cycle_days, dq_pass_rate, feeds_complete,
               headline_metric, headline_value, narrative, audit_snapshot_id
        FROM {fqn('gold_submissions_archive')}
        ORDER BY period DESC, qrt
    """
    rows = await execute_query_cached(q, ttl_seconds=30)
    return rows or []


@router.get("/submissions")
async def list_submissions():
    """Every (qrt × period) submission with status, approver, DQ snapshot."""
    try:
        rows = await _load_archive_rows()
    except Exception as exc:
        logger.exception("Failed to read gold_submissions_archive")
        raise HTTPException(500, str(exc)) from exc

    out: list[dict[str, Any]] = []
    for r in rows:
        qrt_label = r.get("qrt") or ""
        slug = _qrt_slug(qrt_label)
        period = r.get("period") or ""
        status = _normalised_status(r.get("status"))
        cd = r.get("cycle_days")
        cycle_hours = round(float(cd) * 24, 1) if cd is not None else None
        received, total = _parse_feeds_complete(r.get("feeds_complete"))
        feeds_incomplete = max(total - received, 0) if total else 0
        out.append({
            "approval_id":     r.get("audit_snapshot_id") or f"{period}-{slug}",
            "qrt_id":          slug,
            "qrt_name":        qrt_label,
            "qrt_title":       r.get("qrt_title") or _QRT_TITLES.get(slug, qrt_label),
            "reporting_period": period,
            "status":          status,
            "submitted_by":    r.get("submitted_by"),
            "submitted_at":    str(r.get("submitted_at")) if r.get("submitted_at") else None,
            "reviewed_by":     r.get("reviewed_by"),
            "reviewed_at":     str(r.get("reviewed_at")) if r.get("reviewed_at") else None,
            "comments":        r.get("narrative"),
            "cycle_hours":     cycle_hours,
            "dq_pass_rate_pct": r.get("dq_pass_rate"),
            # Best-effort split: count all incomplete feeds as "late" — the demo
            # data doesn't distinguish late vs missing per row.
            "feeds_late":      feeds_incomplete,
            "feeds_missing":   0,
        })
    return {"data": out}


@router.get("/process-metrics")
async def process_metrics():
    """Aggregate KPIs for the process-manager dashboard."""
    try:
        dq_trend_q = f"""
            SELECT reporting_period,
                   ROUND(SUM(passing_records) * 100.0 / NULLIF(SUM(total_records), 0), 1) AS pass_rate_pct,
                   COUNT(CASE WHEN failing_records > 0 THEN 1 END) AS failing_checks
            FROM {fqn('5_mon_dq_expectation_results')}
            GROUP BY reporting_period
            ORDER BY reporting_period
        """
        sla_trend_q = f"""
            SELECT reporting_period,
                   COUNT(*) AS feed_count,
                   SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late_count,
                   SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) AS missing_count,
                   SUM(CASE WHEN status = 'on_time' THEN 1 ELSE 0 END) AS on_time_count
            FROM {fqn('5_mon_pipeline_sla_status')}
            GROUP BY reporting_period
            ORDER BY reporting_period
        """

        rows, dq_trend, sla_trend = await asyncio.gather(
            _load_archive_rows(),
            execute_query_cached(dq_trend_q, ttl_seconds=60),
            execute_query_cached(sla_trend_q, ttl_seconds=60),
            return_exceptions=True,
        )

        def _ok(x: Any) -> list:
            return [] if isinstance(x, Exception) else (x or [])

        rows = _ok(rows)
        dq_trend = _ok(dq_trend)
        sla_trend = _ok(sla_trend)

        total = len(rows)
        approved = sum(1 for r in rows if _normalised_status(r.get("status")) == "approved")
        rejected = sum(1 for r in rows if _normalised_status(r.get("status")) == "rejected")
        pending = sum(1 for r in rows if _normalised_status(r.get("status")) == "pending")
        periods = sorted({r.get("period") or "" for r in rows if r.get("period")})

        # Cycle times — only for completed submissions (cycle_days populated)
        cycle_hours: list[float] = []
        for r in rows:
            cd = r.get("cycle_days")
            if cd is None:
                continue
            try:
                cycle_hours.append(float(cd) * 24)
            except Exception:
                pass

        avg_cycle_hours = round(sum(cycle_hours) / len(cycle_hours), 1) if cycle_hours else None
        median_cycle_hours = None
        if cycle_hours:
            sorted_ch = sorted(cycle_hours)
            median_cycle_hours = round(sorted_ch[len(sorted_ch) // 2], 1)

        approval_rate = round(approved * 100.0 / total, 1) if total > 0 else None
        rejection_rate = round(rejected * 100.0 / total, 1) if total > 0 else None

        from collections import Counter
        reviewer_counter: Counter[str] = Counter()
        submitter_counter: Counter[str] = Counter()
        for r in rows:
            if r.get("reviewed_by"):
                reviewer_counter[r["reviewed_by"]] += 1
            if r.get("submitted_by"):
                submitter_counter[r["submitted_by"]] += 1
        top_reviewers = [{"name": n, "count": c} for n, c in reviewer_counter.most_common(5)]
        top_submitters = [{"name": n, "count": c} for n, c in submitter_counter.most_common(5)]

        period_counter: Counter[str] = Counter()
        for r in rows:
            if r.get("period"):
                period_counter[r["period"]] += 1
        submissions_per_period = sorted(
            [{"period": p, "count": c} for p, c in period_counter.items()],
            key=lambda x: x["period"],
        )

        return {
            "kpis": {
                "total_submissions": total,
                "approved": approved,
                "rejected": rejected,
                "pending": pending,
                "approval_rate_pct": approval_rate,
                "rejection_rate_pct": rejection_rate,
                "avg_cycle_hours": avg_cycle_hours,
                "median_cycle_hours": median_cycle_hours,
                "periods_covered": len(periods),
                "earliest_period": periods[0] if periods else None,
                "latest_period": periods[-1] if periods else None,
            },
            "dq_trend": dq_trend,
            "sla_trend": sla_trend,
            "submissions_per_period": submissions_per_period,
            "top_reviewers": top_reviewers,
            "top_submitters": top_submitters,
        }
    except Exception as exc:
        logger.exception("Failed to compute process metrics")
        raise HTTPException(500, str(exc)) from exc
