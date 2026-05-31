from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.db import Guideline

router = APIRouter(tags=["guidelines"])


@router.get("")
async def list_guidelines(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    result = await db.execute(select(Guideline).order_by(Guideline.uploaded_at.desc()))
    rows = result.scalars().all()
    return {
        "guidelines": [
            {
                "id": str(g.id),
                "title": g.title,
                "description": g.description,
                "original_filename": g.original_filename,
                "file_size_bytes": g.file_size_bytes,
                "uploaded_at": g.uploaded_at.isoformat() if g.uploaded_at else None,
            }
            for g in rows
        ]
    }


@router.get("/{guideline_id}/download")
async def download_guideline(
    guideline_id: str,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    result = await db.execute(select(Guideline).where(Guideline.id == guideline_id))
    g = result.scalar_one_or_none()
    if not g:
        raise HTTPException(status_code=404, detail="Guideline not found")

    return FileResponse(
        path=g.file_path,
        filename=g.original_filename,
        media_type="application/octet-stream",
    )
