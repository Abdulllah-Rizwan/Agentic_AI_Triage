import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_device_user
from app.models import schemas
from app.models.db import DocumentStatus, KnowledgeBaseVersion, KnowledgeDocument
from app.services import rag_service

router = APIRouter(tags=["knowledge"])


# ── GET /version ──────────────────────────────────────────────────────────────


@router.get("/version", response_model=schemas.KnowledgeVersionResponse)
async def get_version(db: AsyncSession = Depends(get_db)):
    row = await db.get(KnowledgeBaseVersion, 1)
    if row is None:
        return schemas.KnowledgeVersionResponse(
            version=0,
            document_count=0,
            chunk_count=0,
            updated_at=datetime.now(timezone.utc),
        )
    return schemas.KnowledgeVersionResponse(
        version=row.version,
        document_count=row.document_count,
        chunk_count=row.chunk_count,
        updated_at=row.updated_at,
    )


# ── GET /index ────────────────────────────────────────────────────────────────


@router.get("/index")
async def download_index():
    index_path = os.path.join(settings.FAISS_EXPORT_DIR, "knowledge_index.faiss")
    if not os.path.isfile(index_path):
        raise HTTPException(
            status_code=503,
            detail="No knowledge base index available yet. Upload documents via the admin panel first.",
        )
    return FileResponse(
        path=index_path,
        media_type="application/octet-stream",
        filename="knowledge_index.faiss",
    )


# ── POST /query ───────────────────────────────────────────────────────────────


@router.post("/query", response_model=schemas.KnowledgeQueryResponse)
async def query_knowledge(
    body: schemas.KnowledgeQueryRequest,
    db: AsyncSession = Depends(get_db),
    _device: str = Depends(get_device_user),
):
    active_count = await db.scalar(
        select(func.count(KnowledgeDocument.id)).where(
            KnowledgeDocument.status == DocumentStatus.ACTIVE
        )
    )
    if not active_count:
        raise HTTPException(status_code=503, detail="Knowledge base is empty")

    top_k = min(body.top_k, 10)
    results = await rag_service.query_knowledge_base(body.query, top_k, db)

    return schemas.KnowledgeQueryResponse(
        results=[schemas.KnowledgeQueryResult(**r) for r in results]
    )
