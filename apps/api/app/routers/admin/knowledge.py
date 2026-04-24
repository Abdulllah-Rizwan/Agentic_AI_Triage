from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

router = APIRouter(tags=["admin-knowledge"])


@router.get("/documents")
async def list_documents(db: AsyncSession = Depends(get_db)):
    pass


@router.post("/documents", status_code=202)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    pass


@router.get("/documents/{doc_id}")
async def get_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    pass


@router.patch("/documents/{doc_id}/archive")
async def archive_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    pass


@router.patch("/documents/{doc_id}/reprocess", status_code=202)
async def reprocess_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    pass


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    pass


@router.get("/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    pass
