from datetime import datetime, timezone

from celery import Celery
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import require_admin
from app.models import schemas

router = APIRouter(tags=["admin-system"])

# Celery app used only for broker inspection — no tasks registered here
_celery = Celery("medireach_inspect", broker=settings.REDIS_URL)

_SOAP_TASK = "app.workers.soap_worker.generate_soap_task"
_INGEST_TASK = "app.workers.ingestion_worker.ingest_document_task"


def _count_by_name(task_map: dict | None, task_name: str) -> int:
    """Sum tasks matching task_name across all workers."""
    if not task_map:
        return 0
    return sum(
        1
        for tasks in task_map.values()
        for t in tasks
        if t.get("name") == task_name
    )


# ── GET /health ───────────────────────────────────────────────────────────────


@router.get("/health", response_model=schemas.SystemHealthResponse)
async def system_health(
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
):
    # PostgreSQL
    try:
        await db.execute(text("SELECT 1"))
        postgres_status = "ok"
    except Exception:
        postgres_status = "down"

    # Redis
    try:
        import redis as redis_lib
        r = redis_lib.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        r.ping()
        redis_status = "ok"
    except Exception:
        redis_status = "down"

    # Celery workers
    celery_workers = 0
    try:
        inspector = _celery.control.inspect(timeout=2.0)
        ping_result = inspector.ping()
        celery_workers = len(ping_result) if ping_result else 0
    except Exception:
        pass

    return schemas.SystemHealthResponse(
        api="ok",
        postgres=postgres_status,
        redis=redis_status,
        celery_workers=celery_workers,
        checked_at=datetime.now(timezone.utc),
    )


# ── GET /queue ────────────────────────────────────────────────────────────────


@router.get("/queue", response_model=schemas.QueueStatsResponse)
async def queue_stats(_admin=Depends(require_admin)):
    active_tasks: dict | None = None
    reserved_tasks: dict | None = None

    try:
        inspector = _celery.control.inspect(timeout=2.0)
        active_tasks = inspector.active()
        reserved_tasks = inspector.reserved()
    except Exception:
        pass

    soap = schemas.QueueJobStats(
        pending=_count_by_name(reserved_tasks, _SOAP_TASK),
        active=_count_by_name(active_tasks, _SOAP_TASK),
        failed=0,
    )

    ingestion = schemas.QueueJobStats(
        pending=_count_by_name(reserved_tasks, _INGEST_TASK),
        active=_count_by_name(active_tasks, _INGEST_TASK),
        failed=0,
    )

    return schemas.QueueStatsResponse(
        soap_generation=soap,
        document_ingestion=ingestion,
        checked_at=datetime.now(timezone.utc),
    )
