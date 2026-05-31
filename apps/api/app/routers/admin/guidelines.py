import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import require_admin
from app.models.db import Guideline

router = APIRouter(tags=["admin-guidelines"])

MAX_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB


@router.post("")
async def upload_guideline(
    file: UploadFile,
    title: str = Form(...),
    description: str = Form(None),
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    content = await file.read()
    if len(content) > MAX_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 100 MB limit")
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    os.makedirs(settings.GUIDELINES_DIR, exist_ok=True)

    stored_name = f"{uuid.uuid4()}_{file.filename}"
    file_path = os.path.join(settings.GUIDELINES_DIR, stored_name)

    with open(file_path, "wb") as f:
        f.write(content)

    guideline = Guideline(
        title=title.strip(),
        description=description.strip() if description else None,
        original_filename=file.filename,
        stored_filename=stored_name,
        file_path=file_path,
        file_size_bytes=len(content),
        uploaded_by=admin.id,
    )
    db.add(guideline)
    await db.commit()
    await db.refresh(guideline)

    return {
        "id": str(guideline.id),
        "title": guideline.title,
        "message": "Guideline uploaded successfully",
    }


@router.delete("/{guideline_id}")
async def delete_guideline(
    guideline_id: str,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
):
    result = await db.execute(select(Guideline).where(Guideline.id == guideline_id))
    g = result.scalar_one_or_none()
    if not g:
        raise HTTPException(status_code=404, detail="Guideline not found")

    # Remove file from disk
    if os.path.exists(g.file_path):
        os.remove(g.file_path)

    await db.delete(g)
    await db.commit()

    return {"deleted_id": guideline_id, "message": "Guideline deleted"}
