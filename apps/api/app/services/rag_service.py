from __future__ import annotations

from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@lru_cache(maxsize=1)
def get_embedding_model():
    """Load once per process and reuse across all requests."""
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


def _fmt_vector(vec: list[float]) -> str:
    return "[" + ",".join(str(v) for v in vec) + "]"


async def query_knowledge_base(
    query_text: str,
    top_k: int,
    db: AsyncSession,
) -> list[dict]:
    """
    Embed the query and perform cosine similarity search against pgvector.
    Only searches chunks from ACTIVE documents.
    Increments retrieval_count on matched parent documents for admin stats.

    Each result dict contains:
        content, article_title, article_url, article_author, article_source, relevance_score
    """
    model = get_embedding_model()
    query_vector = _fmt_vector(model.encode([query_text])[0].tolist())

    # asyncpg translates :param → $1 but misparses :param::cast as a syntax error.
    # Use CAST(:param AS type) to avoid the double-colon ambiguity.
    rows = (
        await db.execute(
            text("""
                SELECT
                    kc.content,
                    kc.article_title,
                    kc.article_url,
                    kc.article_author,
                    kc.article_source,
                    1 - (kc.embedding <=> CAST(:qv AS vector))  AS relevance_score,
                    kc.document_id
                FROM knowledge_chunks kc
                JOIN knowledge_documents kd ON kd.id = kc.document_id
                WHERE kd.status = 'ACTIVE'
                  AND kc.embedding IS NOT NULL
                ORDER BY kc.embedding <=> CAST(:qv AS vector)
                LIMIT :top_k
            """),
            {"qv": query_vector, "top_k": top_k},
        )
    ).fetchall()

    if not rows:
        return []

    # Increment retrieval_count on every matched parent document for admin stats
    doc_ids = list({str(row.document_id) for row in rows})
    await db.execute(
        text("""
            UPDATE knowledge_documents
            SET retrieval_count = retrieval_count + 1
            WHERE id = ANY(CAST(:doc_ids AS uuid[]))
        """),
        {"doc_ids": doc_ids},
    )
    await db.commit()

    return [
        {
            "content":        row.content,
            "article_title":  row.article_title,
            "article_url":    row.article_url,
            "article_author": row.article_author,
            "article_source": row.article_source,
            "relevance_score": round(float(row.relevance_score), 4),
        }
        for row in rows
    ]
