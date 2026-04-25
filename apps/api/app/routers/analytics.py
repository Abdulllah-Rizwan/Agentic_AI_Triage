from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import schemas
from app.models.db import Case, CaseStatus

router = APIRouter(tags=["analytics"])

_MAX_DAYS = 90
_TRIAGE_WEIGHT = {"RED": 3, "AMBER": 2, "GREEN": 1}


def _cutoff(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def _validate_days(days: int) -> int:
    if days < 1 or days > _MAX_DAYS:
        raise HTTPException(
            status_code=422, detail=f"days must be between 1 and {_MAX_DAYS}"
        )
    return days


# ── GET /summary ──────────────────────────────────────────────────────────────


@router.get("/summary", response_model=schemas.AnalyticsSummaryResponse)
async def get_summary(
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    days = _validate_days(days)
    cutoff = _cutoff(days)
    cutoff_24h = _cutoff(1)

    result = await db.execute(
        text("""
            SELECT
                COUNT(*)                                                        AS total,
                COUNT(*) FILTER (WHERE triage_level = 'RED')                   AS critical,
                AVG(EXTRACT(EPOCH FROM (claimed_at - received_at)) / 60.0)
                    FILTER (WHERE claimed_at IS NOT NULL)                       AS avg_resp,
                COUNT(*) FILTER (WHERE status = 'RESOLVED') * 100.0
                    / NULLIF(COUNT(*), 0)                                       AS res_rate,
                COUNT(*) FILTER (WHERE received_at >= :cutoff_24h)             AS last_24h
            FROM cases
            WHERE received_at >= :cutoff
        """),
        {"cutoff": cutoff, "cutoff_24h": cutoff_24h},
    )
    r = result.one()

    pending = await db.scalar(
        select(func.count(Case.id)).where(Case.status == CaseStatus.PENDING)
    )

    return schemas.AnalyticsSummaryResponse(
        period_days=days,
        total_cases=r.total or 0,
        critical_cases=r.critical or 0,
        avg_response_time_minutes=round(float(r.avg_resp or 0.0), 2),
        resolution_rate_percent=round(float(r.res_rate or 0.0), 2),
        cases_last_24h=r.last_24h or 0,
        pending_cases=pending or 0,
    )


# ── GET /timeseries ───────────────────────────────────────────────────────────


@router.get("/timeseries", response_model=schemas.TimeseriesResponse)
async def get_timeseries(
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    days = _validate_days(days)
    cutoff = _cutoff(days)

    rows = await db.execute(
        text("""
            SELECT
                received_at::date       AS day,
                triage_level            AS level,
                COUNT(*)                AS cnt
            FROM cases
            WHERE received_at >= :cutoff
            GROUP BY day, triage_level
            ORDER BY day ASC
        """),
        {"cutoff": cutoff},
    )

    # Build lookup: date_str → {level: count}
    by_date: dict[str, dict[str, int]] = {}
    for row in rows:
        d = row.day.isoformat()
        by_date.setdefault(d, {"RED": 0, "AMBER": 0, "GREEN": 0})
        by_date[d][row.level] = row.cnt

    # Generate full date range (oldest → today) so gaps appear as zeros
    today = datetime.now(timezone.utc).date()
    date_range = [
        (today - timedelta(days=i)).isoformat()
        for i in range(days - 1, -1, -1)
    ]

    series = [
        schemas.TimeseriesPoint(
            date=d,
            RED=by_date.get(d, {}).get("RED", 0),
            AMBER=by_date.get(d, {}).get("AMBER", 0),
            GREEN=by_date.get(d, {}).get("GREEN", 0),
        )
        for d in date_range
    ]

    return schemas.TimeseriesResponse(period_days=days, series=series)


# ── GET /symptoms ─────────────────────────────────────────────────────────────


@router.get("/symptoms", response_model=schemas.SymptomsResponse)
async def get_symptoms(
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    days = _validate_days(days)
    cutoff = _cutoff(days)

    # unnest the ARRAY(String) symptoms column and count each symptom
    rows = await db.execute(
        text("""
            SELECT symptom, COUNT(*) AS cnt
            FROM cases, unnest(symptoms) AS symptom
            WHERE received_at >= :cutoff
            GROUP BY symptom
            ORDER BY cnt DESC
            LIMIT 20
        """),
        {"cutoff": cutoff},
    )

    return schemas.SymptomsResponse(
        period_days=days,
        symptoms=[
            schemas.SymptomCount(symptom=row.symptom, count=row.cnt)
            for row in rows
        ],
    )


# ── GET /geo ──────────────────────────────────────────────────────────────────


@router.get("/geo", response_model=schemas.GeoResponse)
async def get_geo(
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    days = _validate_days(days)
    cutoff = _cutoff(days)

    rows = await db.execute(
        text("""
            SELECT lat, lng, triage_level
            FROM cases
            WHERE received_at >= :cutoff
        """),
        {"cutoff": cutoff},
    )

    points = [
        schemas.GeoPoint(
            lat=row.lat,
            lng=row.lng,
            triage_level=row.triage_level,
            weight=_TRIAGE_WEIGHT.get(row.triage_level, 1),
        )
        for row in rows
    ]

    return schemas.GeoResponse(period_days=days, points=points)
