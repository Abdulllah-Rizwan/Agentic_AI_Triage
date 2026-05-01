from __future__ import annotations

import os
import uuid as uuid_module

import aiofiles
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.db import DocumentStatus, KnowledgeDocument
from app.workers.ingestion_worker import ingest_document_task


async def process_document_upload(
    content: bytes,
    filename: str,
    title: str,
    description: str | None,
    uploaded_by: uuid_module.UUID,
    db: AsyncSession,
    *,
    author: str | None = None,
    source: str | None = None,
    url: str | None = None,
) -> KnowledgeDocument:
    """
    Validate, persist, and enqueue a .txt document for ingestion.

    Raises HTTPException for any invalid input (wrong extension, too large,
    non-UTF-8 content, duplicate active filename).
    Returns the created KnowledgeDocument row (status=PROCESSING).

    author / source / url are forwarded to the ingestion task so that
    admin-uploaded documents (which have no companion YAML file) can still
    have full attribution metadata on every generated chunk.
    """
    # Validate extension
    if not filename.lower().endswith(".txt"):
        raise HTTPException(
            status_code=400,
            detail="Only .txt files are accepted",
        )

    # Validate file size
    if len(content) > settings.max_upload_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {settings.MAX_UPLOAD_SIZE_MB}MB size limit",
        )

    # Validate content is readable UTF-8 text (catches accidental binary uploads)
    try:
        content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="File content is not valid UTF-8 text",
        )

    # Reject duplicate active filename so the knowledge base stays consistent
    existing = await db.scalar(
        select(KnowledgeDocument).where(
            KnowledgeDocument.filename == filename,
            KnowledgeDocument.status == DocumentStatus.ACTIVE,
        )
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="A document with this filename is already active in the knowledge base",
        )

    # Save to UPLOAD_DIR with a UUID prefix to avoid filename collisions
    unique_name = f"{uuid_module.uuid4()}_{filename}"
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    file_path = os.path.join(settings.UPLOAD_DIR, unique_name)

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # Create the KnowledgeDocument row immediately (status=PROCESSING)
    doc = KnowledgeDocument(
        title=title,
        description=description,
        filename=filename,
        file_path=file_path,
        file_size_bytes=len(content),
        status=DocumentStatus.PROCESSING,
        uploaded_by=uploaded_by,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # Enqueue the Celery ingestion job — returns 202 immediately.
    # Pass form-provided metadata so the worker can populate chunk attribution
    # without needing a companion YAML file on disk.
    ingest_document_task.delay(
        str(doc.id),
        article_title=title,
        article_author=author,
        article_source=source,
        article_url=url,
    )

    return doc
