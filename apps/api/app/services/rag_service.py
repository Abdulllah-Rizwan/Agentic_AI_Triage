from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import DocumentStatus

_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    return _model


def _fmt_vector(vec: list[float]) -> str:
    return "[" + ",".join(str(v) for v in vec) + "]"


async def query_knowledge_base(
    query_text: str,
    top_k: int,
    db: AsyncSession,
) -> list[dict]:
    model = _get_model()
    query_vector = _fmt_vector(model.encode([query_text])[0].tolist())

    rows = await db.execute(
        text("""
            SELECT
                kc.content,
                kc.page_number,
                kd.title,
                1 - (kc.embedding <=> :qv::vector)   AS relevance_score
            FROM knowledge_chunks kc
            JOIN knowledge_documents kd ON kd.id = kc.document_id
            WHERE kd.status = 'ACTIVE'
              AND kc.embedding IS NOT NULL
            ORDER BY kc.embedding <=> :qv::vector
            LIMIT :top_k
        """),
        {"qv": query_vector, "top_k": top_k},
    )

    return [
        {
            "content": row.content,
            "document_title": row.title,
            "page_number": row.page_number,
            "relevance_score": round(float(row.relevance_score), 4),
        }
        for row in rows
    ]
