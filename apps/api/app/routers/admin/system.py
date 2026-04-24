from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

router = APIRouter(tags=["admin-system"])


@router.get("/health")
async def system_health(db: AsyncSession = Depends(get_db)):
    pass


@router.get("/queue")
async def queue_stats():
    pass
