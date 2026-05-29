from __future__ import annotations

from functools import lru_cache
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Section types that are directly useful as patient-facing guidance
_ACTION_TYPES = {"action", "prevention"}
_GUIDANCE_TYPES = {"action", "prevention", "emergency"}


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
    Prefers action/prevention chunks over pure symptom-description chunks.
    Falls back to all chunk types if no guidance-type chunks are found.

    Each result dict contains:
        content, article_title, article_url, article_author, article_source,
        section_type, relevance_score
    """
    model = get_embedding_model()
    query_vector = _fmt_vector(model.encode([query_text])[0].tolist())

    # Fetch a wider pool to allow section_type preference filtering
    fetch_k = max(top_k * 4, 12)

    rows = (
        await db.execute(
            text("""
                SELECT
                    kc.content,
                    kc.article_title,
                    kc.article_url,
                    kc.article_author,
                    kc.article_source,
                    kc.section_type,
                    1 - (kc.embedding <=> CAST(:qv AS vector))  AS relevance_score,
                    kc.document_id
                FROM knowledge_chunks kc
                JOIN knowledge_documents kd ON kd.id = kc.document_id
                WHERE kd.status = 'ACTIVE'
                  AND kc.embedding IS NOT NULL
                ORDER BY kc.embedding <=> CAST(:qv AS vector)
                LIMIT :fetch_k
            """),
            {"qv": query_vector, "fetch_k": fetch_k},
        )
    ).fetchall()

    if not rows:
        return []

    # Prefer action/prevention chunks; fall back to all results if none found
    preferred = [r for r in rows if r.section_type in _ACTION_TYPES]
    candidates = preferred if preferred else list(rows)
    selected = candidates[:top_k]

    # Increment retrieval_count on matched parent documents
    doc_ids = list({str(r.document_id) for r in selected})
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
            "content":         r.content,
            "article_title":   r.article_title,
            "article_url":     r.article_url,
            "article_author":  r.article_author,
            "article_source":  r.article_source,
            "section_type":    r.section_type,
            "relevance_score": round(float(r.relevance_score), 4),
        }
        for r in selected
    ]


async def query_by_document_ids(
    document_ids: list[str],
    db: AsyncSession,
    preferred_section_type: str = "action",
) -> list[dict]:
    """
    Return the best guidance chunk(s) from the given document(s).
    Prefers preferred_section_type, falls back to any chunk type.
    Used by the LLM-routing endpoint after disease identification.
    """
    if not document_ids:
        return []

    rows = (
        await db.execute(
            text("""
                SELECT
                    kc.content,
                    kc.article_title,
                    kc.article_url,
                    kc.article_author,
                    kc.article_source,
                    kc.section_type,
                    kc.document_id
                FROM knowledge_chunks kc
                JOIN knowledge_documents kd ON kd.id = kc.document_id
                WHERE kd.status = 'ACTIVE'
                  AND kc.embedding IS NOT NULL
                  AND kd.id = ANY(CAST(:doc_ids AS uuid[]))
                ORDER BY kc.chunk_index ASC
            """),
            {"doc_ids": document_ids},
        )
    ).fetchall()

    if not rows:
        return []

    # Prefer action chunks, then prevention, then emergency, then anything
    for desired in (preferred_section_type, "action", "prevention", "emergency", "general"):
        matches = [r for r in rows if r.section_type == desired]
        if matches:
            # Increment retrieval counts
            doc_ids = list({str(r.document_id) for r in matches[:2]})
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
                    "content":         r.content,
                    "article_title":   r.article_title,
                    "article_url":     r.article_url,
                    "article_author":  r.article_author,
                    "article_source":  r.article_source,
                    "section_type":    r.section_type,
                    "relevance_score": 1.0,
                }
                for r in matches[:2]  # at most 2 chunks per article
            ]

    return []
