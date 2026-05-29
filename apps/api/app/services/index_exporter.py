import base64
import json
import os
import pickle
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.db import (
    DocumentStatus,
    KnowledgeBaseVersion,
    KnowledgeChunk,
    KnowledgeDocument,
)


def _write_mobile_json_exports(export_dir: str, rows: list, vectors) -> None:
    """
    Write the two JSON files consumed by LocalRAG.ts on the mobile app.

    knowledge_meta.json  — camelCase ChunkMetadata[]
    knowledge_embeddings.json — {data: base64(float32 bytes), dims: 384, count: N}

    These files are served as static assets from /exports/ and downloaded by
    KnowledgeBaseUpdateService on every version bump.
    """
    import numpy as np  # already imported in callers but kept local for clarity

    meta_list = [
        {
            "content":       r.content,
            "articleTitle":  getattr(r, "article_title", None),
            "articleUrl":    getattr(r, "article_url", None),
            "articleAuthor": getattr(r, "article_author", None),
            "articleSource": getattr(r, "article_source", None),
            # section_type enables the mobile BM25 engine to prefer action chunks
            # over symptom-description chunks when displaying post-triage guidance.
            "section_type":  getattr(r, "section_type", None),
        }
        for r in rows
    ]

    # Embeddings are already L2-normalised in `vectors`; store as flat float32 bytes
    flat_bytes = vectors.astype("float32").tobytes()
    emb_file = {
        "data":  base64.b64encode(flat_bytes).decode("ascii"),
        "dims":  384,
        "count": len(rows),
    }

    with open(os.path.join(export_dir, "knowledge_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta_list, f, ensure_ascii=False)

    with open(os.path.join(export_dir, "knowledge_embeddings.json"), "w", encoding="utf-8") as f:
        json.dump(emb_file, f)


async def bump_version_and_export(db: AsyncSession) -> int:
    """
    Rebuild the FAISS index from all ACTIVE chunks and bump KnowledgeBaseVersion.
    Also writes mobile-compatible JSON exports (knowledge_meta.json +
    knowledge_embeddings.json) so the mobile app can load without native FAISS.
    Returns the new version number.
    """
    import faiss
    import numpy as np

    rows = (
        await db.execute(
            select(
                KnowledgeChunk.id,
                KnowledgeChunk.content,
                KnowledgeChunk.embedding,
                KnowledgeChunk.article_title,
                KnowledgeChunk.article_url,
                KnowledgeChunk.article_author,
                KnowledgeChunk.article_source,
                KnowledgeChunk.section_type,
            )
            .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
            .where(KnowledgeDocument.status == DocumentStatus.ACTIVE)
            .where(KnowledgeChunk.embedding.is_not(None))
        )
    ).all()

    doc_count: int = await db.scalar(
        select(func.count(KnowledgeDocument.id)).where(
            KnowledgeDocument.status == DocumentStatus.ACTIVE
        )
    ) or 0

    version_row = await db.get(KnowledgeBaseVersion, 1)
    if version_row is None:
        version_row = KnowledgeBaseVersion(id=1, version=0)
        db.add(version_row)

    version_row.version += 1
    version_row.updated_at = datetime.utcnow()
    version_row.document_count = doc_count
    version_row.chunk_count = len(rows)

    if rows:
        texts = [r.content for r in rows]
        vectors = np.array([list(r.embedding) for r in rows], dtype="float32")

        faiss.normalize_L2(vectors)
        index = faiss.IndexFlatIP(384)
        index.add(vectors)

        os.makedirs(settings.FAISS_EXPORT_DIR, exist_ok=True)
        index_path = os.path.join(settings.FAISS_EXPORT_DIR, "knowledge_index.faiss")
        meta_path = os.path.join(settings.FAISS_EXPORT_DIR, "knowledge_meta.pkl")

        faiss.write_index(index, index_path)
        with open(meta_path, "wb") as f:
            pickle.dump({"ids": [str(r.id) for r in rows], "texts": texts}, f)

        # Mobile-compatible JSON exports (LocalRAG.ts uses pure-JS cosine similarity,
        # not native FAISS — these files are what the app actually downloads)
        _write_mobile_json_exports(settings.FAISS_EXPORT_DIR, rows, vectors)

        version_row.index_file_path = index_path
    else:
        # No active chunks — remove stale files
        for fname in ("knowledge_index.faiss", "knowledge_meta.json", "knowledge_embeddings.json"):
            stale = os.path.join(settings.FAISS_EXPORT_DIR, fname)
            if os.path.isfile(stale):
                os.remove(stale)
        version_row.index_file_path = None

    await db.commit()
    return version_row.version


def bump_version_and_export_sync(db: Session) -> int:
    """
    Sync version for Celery workers — identical logic using a sync Session.
    Commit is handled by the caller (sync_session context manager).
    """
    import faiss
    import numpy as np

    rows = db.execute(
        select(
            KnowledgeChunk.id,
            KnowledgeChunk.content,
            KnowledgeChunk.embedding,
            KnowledgeChunk.article_title,
            KnowledgeChunk.article_url,
            KnowledgeChunk.article_author,
            KnowledgeChunk.article_source,
        )
        .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
        .where(KnowledgeDocument.status == DocumentStatus.ACTIVE)
        .where(KnowledgeChunk.embedding.is_not(None))
    ).all()

    doc_count: int = db.scalar(
        select(func.count(KnowledgeDocument.id)).where(
            KnowledgeDocument.status == DocumentStatus.ACTIVE
        )
    ) or 0

    version_row = db.get(KnowledgeBaseVersion, 1)
    if version_row is None:
        version_row = KnowledgeBaseVersion(id=1, version=0)
        db.add(version_row)

    version_row.version += 1
    version_row.updated_at = datetime.utcnow()
    version_row.document_count = doc_count
    version_row.chunk_count = len(rows)

    if rows:
        texts = [r.content for r in rows]
        vectors = np.array([list(r.embedding) for r in rows], dtype="float32")

        faiss.normalize_L2(vectors)
        index = faiss.IndexFlatIP(384)
        index.add(vectors)

        os.makedirs(settings.FAISS_EXPORT_DIR, exist_ok=True)
        index_path = os.path.join(settings.FAISS_EXPORT_DIR, "knowledge_index.faiss")
        meta_path = os.path.join(settings.FAISS_EXPORT_DIR, "knowledge_meta.pkl")

        faiss.write_index(index, index_path)
        with open(meta_path, "wb") as f:
            pickle.dump({"ids": [str(r.id) for r in rows], "texts": texts}, f)

        _write_mobile_json_exports(settings.FAISS_EXPORT_DIR, rows, vectors)

        version_row.index_file_path = index_path
    else:
        for fname in ("knowledge_index.faiss", "knowledge_meta.json", "knowledge_embeddings.json"):
            stale = os.path.join(settings.FAISS_EXPORT_DIR, fname)
            if os.path.isfile(stale):
                os.remove(stale)
        version_row.index_file_path = None

    return version_row.version
