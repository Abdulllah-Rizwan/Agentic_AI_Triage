import os
import uuid as uuid_module
from uuid import UUID

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import CurrentUser, require_admin
from app.models import schemas
from app.models.db import (
    DocumentStatus,
    KnowledgeBaseVersion,
    KnowledgeChunk,
    KnowledgeDocument,
    User,
)
from app.services import socket_emitter
from app.services.index_exporter import bump_version_and_export
from app.workers.ingestion_worker import ingest_document_task

router = APIRouter(tags=["admin-knowledge"])


async def _get_doc_or_404(doc_id: str, db: AsyncSession) -> KnowledgeDocument:
    try:
        uid = UUID(doc_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = await db.get(KnowledgeDocument, uid)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


async def _kb_version(db: AsyncSession) -> int:
    row = await db.get(KnowledgeBaseVersion, 1)
    return row.version if row else 0


# ── GET /documents ────────────────────────────────────────────────────────────


@router.get("/documents", response_model=schemas.DocumentListResponse)
async def list_documents(
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    rows = (
        await db.execute(
            select(KnowledgeDocument, User.email.label("uploader_email"))
            .join(User, KnowledgeDocument.uploaded_by == User.id)
            .order_by(KnowledgeDocument.uploaded_at.desc())
        )
    ).all()

    kb_ver = await _kb_version(db)

    total_active_chunks: int = await db.scalar(
        select(func.count(KnowledgeChunk.id))
        .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
        .where(KnowledgeDocument.status == DocumentStatus.ACTIVE)
    ) or 0

    documents = [
        schemas.DocumentListItem(
            id=doc.id,
            title=doc.title,
            filename=doc.filename,
            file_size_bytes=doc.file_size_bytes,
            status=doc.status.value,
            chunk_count=doc.chunk_count,
            uploaded_by_email=email,
            uploaded_at=doc.uploaded_at,
            processed_at=doc.processed_at,
            error_message=doc.error_message,
        )
        for doc, email in rows
    ]

    return schemas.DocumentListResponse(
        documents=documents,
        kb_version=kb_ver,
        total_active_chunks=total_active_chunks,
    )


# ── POST /documents ───────────────────────────────────────────────────────────


@router.post("/documents", response_model=schemas.DocumentUploadResponse, status_code=202)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    admin: CurrentUser = Depends(require_admin),
):
    content = await file.read()

    if len(content) > settings.max_upload_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {settings.MAX_UPLOAD_SIZE_MB}MB size limit",
        )

    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    # Duplicate active filename check
    existing = await db.scalar(
        select(KnowledgeDocument).where(
            KnowledgeDocument.filename == file.filename,
            KnowledgeDocument.status == DocumentStatus.ACTIVE,
        )
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="A document with this filename is already active in the knowledge base",
        )

    # Save file with a unique name to avoid collisions
    unique_name = f"{uuid_module.uuid4()}_{file.filename}"
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    file_path = os.path.join(settings.UPLOAD_DIR, unique_name)

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    doc = KnowledgeDocument(
        title=title,
        description=description,
        filename=file.filename,
        file_path=file_path,
        file_size_bytes=len(content),
        status=DocumentStatus.PROCESSING,
        uploaded_by=admin.user_id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    ingest_document_task.delay(str(doc.id))

    return schemas.DocumentUploadResponse(
        id=doc.id,
        title=doc.title,
        status=doc.status.value,
        message="Document uploaded. Processing in background — check status in a few minutes.",
    )


# ── GET /documents/{doc_id} ───────────────────────────────────────────────────


@router.get("/documents/{doc_id}", response_model=schemas.DocumentDetailResponse)
async def get_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    doc = await _get_doc_or_404(doc_id, db)
    return schemas.DocumentDetailResponse(
        id=doc.id,
        title=doc.title,
        filename=doc.filename,
        file_size_bytes=doc.file_size_bytes,
        status=doc.status.value,
        chunk_count=doc.chunk_count,
        uploaded_at=doc.uploaded_at,
        processed_at=doc.processed_at,
        error_message=doc.error_message,
    )


# ── PATCH /documents/{doc_id}/archive ────────────────────────────────────────


@router.patch("/documents/{doc_id}/archive", response_model=schemas.DocumentArchiveResponse)
async def archive_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    doc = await _get_doc_or_404(doc_id, db)

    doc.status = DocumentStatus.ARCHIVED
    await db.flush()

    new_version = await bump_version_and_export(db)

    await socket_emitter.emit_kb_updated(
        new_version=new_version,
        document_count=await db.scalar(
            select(func.count(KnowledgeDocument.id)).where(
                KnowledgeDocument.status == DocumentStatus.ACTIVE
            )
        ) or 0,
    )

    return schemas.DocumentArchiveResponse(
        id=doc.id,
        status=DocumentStatus.ARCHIVED.value,
        new_kb_version=new_version,
    )


# ── PATCH /documents/{doc_id}/reprocess ──────────────────────────────────────


@router.patch(
    "/documents/{doc_id}/reprocess",
    response_model=schemas.DocumentReprocessResponse,
    status_code=202,
)
async def reprocess_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    doc = await _get_doc_or_404(doc_id, db)

    if doc.status != DocumentStatus.FAILED:
        raise HTTPException(
            status_code=409,
            detail="Only documents in FAILED status can be reprocessed",
        )

    doc.status = DocumentStatus.PROCESSING
    doc.error_message = None
    doc.chunk_count = None
    doc.processed_at = None
    await db.commit()

    ingest_document_task.delay(str(doc.id))

    return schemas.DocumentReprocessResponse(
        id=doc.id,
        status=DocumentStatus.PROCESSING.value,
        message="Reprocessing started.",
    )


# ── DELETE /documents/{doc_id} ────────────────────────────────────────────────


@router.delete("/documents/{doc_id}", response_model=schemas.DocumentDeleteResponse)
async def delete_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    doc = await _get_doc_or_404(doc_id, db)

    # Remove file from disk (best-effort — don't fail if already gone)
    if doc.file_path and os.path.isfile(doc.file_path):
        try:
            os.remove(doc.file_path)
        except OSError:
            pass

    await db.delete(doc)
    await db.flush()

    new_version = await bump_version_and_export(db)

    await socket_emitter.emit_kb_updated(
        new_version=new_version,
        document_count=await db.scalar(
            select(func.count(KnowledgeDocument.id)).where(
                KnowledgeDocument.status == DocumentStatus.ACTIVE
            )
        ) or 0,
    )

    return schemas.DocumentDeleteResponse(
        deleted_id=UUID(doc_id),
        new_kb_version=new_version,
        message="Document and all associated chunks deleted.",
    )


# ── GET /stats ────────────────────────────────────────────────────────────────


@router.get("/stats", response_model=schemas.KnowledgeStatsResponse)
async def get_stats(
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    version_row = await db.get(KnowledgeBaseVersion, 1)
    kb_version = version_row.version if version_row else 0
    last_updated = version_row.updated_at if version_row else None

    active_docs: int = await db.scalar(
        select(func.count(KnowledgeDocument.id)).where(
            KnowledgeDocument.status == DocumentStatus.ACTIVE
        )
    ) or 0

    total_chunks: int = await db.scalar(
        select(func.count(KnowledgeChunk.id))
        .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
        .where(KnowledgeDocument.status == DocumentStatus.ACTIVE)
    ) or 0

    # Calculate FAISS index size on disk
    index_path = os.path.join(settings.FAISS_EXPORT_DIR, "knowledge_index.faiss")
    index_size_mb = 0.0
    if os.path.isfile(index_path):
        index_size_mb = round(os.path.getsize(index_path) / (1024 * 1024), 2)

    # Top retrieved: return most recently processed active docs
    # (retrieval tracking not yet implemented — retrievals_7d reported as 0)
    top_docs_rows = (
        await db.execute(
            select(KnowledgeDocument.id, KnowledgeDocument.title)
            .where(KnowledgeDocument.status == DocumentStatus.ACTIVE)
            .order_by(KnowledgeDocument.processed_at.desc())
            .limit(5)
        )
    ).all()

    top_retrieved = [
        schemas.TopRetrievedDocument(id=row.id, title=row.title, retrievals_7d=0)
        for row in top_docs_rows
    ]

    return schemas.KnowledgeStatsResponse(
        kb_version=kb_version,
        active_documents=active_docs,
        total_chunks=total_chunks,
        index_size_mb=index_size_mb,
        last_updated=last_updated,
        top_retrieved_documents=top_retrieved,
    )
