from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

router = APIRouter(tags=["analytics"])


@router.get("/summary")
async def get_summary(days: int = 7, db: AsyncSession = Depends(get_db)):
    pass


@router.get("/timeseries")
async def get_timeseries(days: int = 7, db: AsyncSession = Depends(get_db)):
    pass


@router.get("/symptoms")
async def get_symptoms(days: int = 7, db: AsyncSession = Depends(get_db)):
    pass


@router.get("/geo")
async def get_geo(days: int = 7, db: AsyncSession = Depends(get_db)):
    pass
