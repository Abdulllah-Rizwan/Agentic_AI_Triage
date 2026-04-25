import os
import pickle
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.db import DocumentStatus, KnowledgeBaseVersion, KnowledgeChunk, KnowledgeDocument


async def bump_version_and_export(db: AsyncSession) -> int:
    """
    Rebuild the FAISS index from all ACTIVE chunks and bump KnowledgeBaseVersion.
    Returns the new version number.
    Called after every admin action that changes the active document set.
    """
    import faiss
    import numpy as np

    rows = (
        await db.execute(
            select(KnowledgeChunk.id, KnowledgeChunk.content, KnowledgeChunk.embedding)
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
    version_row.updated_at = datetime.now(timezone.utc)
    version_row.document_count = doc_count
    version_row.chunk_count = len(rows)

    if rows:
        ids = [str(r.id) for r in rows]
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
            pickle.dump({"ids": ids, "texts": texts}, f)

        version_row.index_file_path = index_path
    else:
        # No active chunks — remove stale index file if it exists
        stale = os.path.join(settings.FAISS_EXPORT_DIR, "knowledge_index.faiss")
        if os.path.isfile(stale):
            os.remove(stale)
        version_row.index_file_path = None

    await db.commit()
    return version_row.version
