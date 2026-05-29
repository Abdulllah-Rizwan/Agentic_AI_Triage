import json
import os
from datetime import datetime, timezone

import httpx
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

# Generic first-aid guidance shown when no article matches
_GENERIC_GUIDANCE = (
    "Rest and stay hydrated — drink clean water or ORS (1 litre water + 6 teaspoons sugar "
    "+ 1/2 teaspoon salt). Give paracetamol for fever or pain. Monitor symptoms closely. "
    "If your condition worsens, seek medical care at the nearest health facility. "
    "Call Rescue 1122 or Edhi Foundation 115 if you feel your situation is serious."
)


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


# ── POST /route ───────────────────────────────────────────────────────────────


@router.post("/route", response_model=schemas.KnowledgeRouteResponse)
async def route_to_article(
    body: schemas.KnowledgeRouteRequest,
    db: AsyncSession = Depends(get_db),
    _device: str = Depends(get_device_user),
):
    """
    LLM-based disease routing endpoint.

    1. Fetches all active article topic_keywords from the database.
    2. Calls Groq LLM with the patient's conversation summary + article list.
    3. LLM selects 1-2 matching article topics.
    4. Returns action-type chunks from the matched article(s).
    5. Falls back to generic first-aid guidance when no match is found.
    """
    # Step 1: Get all active documents with their topic_keywords
    rows = (
        await db.execute(
            select(KnowledgeDocument.id, KnowledgeDocument.topic_keywords)
            .where(
                KnowledgeDocument.status == DocumentStatus.ACTIVE,
                KnowledgeDocument.topic_keywords.isnot(None),
            )
        )
    ).fetchall()

    if not rows:
        return schemas.KnowledgeRouteResponse(
            matched_topics=[],
            results=[schemas.KnowledgeQueryResult(
                content=_GENERIC_GUIDANCE,
                section_type="action",
                relevance_score=1.0,
            )],
            fallback=True,
        )

    # Build the article list for the LLM prompt
    # Format: slug → topic_keywords line
    article_list_lines = []
    slug_to_doc_id: dict[str, str] = {}
    for row in rows:
        # Use the first keyword as the slug (e.g. "malaria" from "malaria, mosquito fever, ...")
        slug = row.topic_keywords.split(",")[0].strip().lower()
        article_list_lines.append(f'- "{slug}": {row.topic_keywords}')
        slug_to_doc_id[slug] = str(row.id)

    article_list = "\n".join(article_list_lines)

    # Step 2: Call Groq LLM
    prompt = f"""You are a medical article routing assistant. Your only job is to identify which medical articles are relevant to a patient's symptoms.

Patient summary (may be in English, Urdu, or Roman Urdu):
{body.conversation_summary}

Available medical articles (slug: keywords):
{article_list}

Which 1-2 article slugs best match the patient's condition?
Rules:
- Return ONLY a JSON array of slug strings exactly as listed above (e.g. ["malaria"] or ["cholera", "dehydration"])
- Use only slugs from the list above — do not invent new ones
- If no article clearly matches, return []
- Do not explain your answer — return only the JSON array"""

    matched_slugs: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.0,
                    "max_tokens": 64,
                },
            )
        if response.status_code == 200:
            raw = response.json()["choices"][0]["message"]["content"].strip()
            # Extract JSON array from response (may have markdown fences)
            if "```" in raw:
                raw = raw.split("```")[1].strip()
                if raw.startswith("json"):
                    raw = raw[4:].strip()
            # Find the first [ ... ] substring
            start = raw.find("[")
            end = raw.rfind("]")
            if start != -1 and end != -1:
                matched_slugs = json.loads(raw[start:end + 1])
                # Validate — keep only slugs that exist in our map
                matched_slugs = [s for s in matched_slugs if s in slug_to_doc_id]
    except Exception:
        # LLM call failed — fall through to generic guidance
        pass

    # Step 3: If LLM matched articles, retrieve their action chunks
    if matched_slugs:
        doc_ids = [slug_to_doc_id[s] for s in matched_slugs]
        chunks = await rag_service.query_by_document_ids(doc_ids, db)
        if chunks:
            return schemas.KnowledgeRouteResponse(
                matched_topics=matched_slugs,
                results=[schemas.KnowledgeQueryResult(**c) for c in chunks],
                fallback=False,
            )

    # Step 4: No match or empty chunks — return generic guidance
    return schemas.KnowledgeRouteResponse(
        matched_topics=[],
        results=[schemas.KnowledgeQueryResult(
            content=_GENERIC_GUIDANCE,
            section_type="action",
            relevance_score=1.0,
        )],
        fallback=True,
    )
