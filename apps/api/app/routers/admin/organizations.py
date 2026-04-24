from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

router = APIRouter(tags=["admin-organizations"])


@router.get("")
async def list_organizations(db: AsyncSession = Depends(get_db)):
    pass


@router.patch("/{org_id}/approve")
async def approve_organization(org_id: str, db: AsyncSession = Depends(get_db)):
    pass


@router.patch("/{org_id}/suspend")
async def suspend_organization(org_id: str, body: dict, db: AsyncSession = Depends(get_db)):
    pass
