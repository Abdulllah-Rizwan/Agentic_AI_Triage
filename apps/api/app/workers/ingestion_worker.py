import asyncio
import os
import re
import uuid as uuid_module
from datetime import datetime
from functools import lru_cache
from typing import Optional

import yaml
from sentence_transformers import SentenceTransformer
from sqlalchemy import func, select

from app.core.database import sync_session
from app.models.db import DocumentStatus, KnowledgeChunk, KnowledgeDocument
from app.services import socket_emitter
from app.services.index_exporter import bump_version_and_export_sync
from app.workers.celery_app import celery_app

# ── Section-aware chunking ─────────────────────────────────────────────────────

# Matches an ALL-CAPS section header line (optionally ending with colon).
# Allows spaces, hyphens, em/en-dashes, parentheses, slashes, commas, periods.
_HEADER_RE = re.compile(r"^([A-Z][A-Z\s\-–—()/,\.!]+):?\s*$")

_MAX_SECTION_CHARS = 1400  # split oversized sections into sub-chunks


def _classify_section(header: str) -> str:
    """Map a section header string to a section_type tag."""
    h = header.upper()
    if "TOPIC" in h:
        return "topic"
    if any(k in h for k in (
        "WHAT TO DO",
        "IMMEDIATE TREATMENT",
        "IMMEDIATE ACTIONS FOR",
        "HOW TO MAKE ORS",
        "GIVING ORS",
        "EMERGENCY ACTIONS",
        "ACTIONS FOR HEAT",
        "ACTIONS AFTER",
        "IMMEDIATE ASSESSMENT",
    )):
        return "action"
    if any(k in h for k in (
        "WHEN TO SEEK",
        "EMERGENCY CARE",
        "GO TO HOSPITAL",
        "HOSPITAL IMMEDIATELY",
        "HOSPITAL REQUIREMENT",
        "CALL FOR EMERGENCY",
        "WHEN TO CALL",
        "SEEK EMERGENCY",
        "EMERGENCY WARNING",
        "SEVERITY ASSESSMENT",
    )):
        return "emergency"
    if any(k in h for k in (
        "RECOGNIZING",
        "RECOGNISE",
        "SYMPTOMS",
        "SIGNS OF",
        "STAGES",
        "WHAT A SEIZURE",
        "WHAT TRIAGE",
        "FORMS OF",
        "HEAT-RELATED ILLNESS",
        "CRUSH SYNDROME",
        "DANGERS SPECIFIC",
        "HIGH-RISK SITUATIONS",
        "HIGH-RISK GROUPS",
        "ANAPHYLAXIS TRIGGERS",
        "RECOGNIZING ANAPHYLAXIS IN",
    )):
        return "symptoms"
    if any(k in h for k in (
        "PREVENTION",
        "PREVENTING",
        "PROTECT",
    )):
        return "prevention"
    if any(k in h for k in ("DO NOT", "DON'T")):
        return "action"
    return "general"


def split_by_sections(text: str) -> tuple[list[dict], Optional[str]]:
    """
    Split article text into section chunks, each tagged with section_type.

    Returns (chunks, topic_keywords) where:
      - chunks: list of {content: str, section_type: str}
      - topic_keywords: str from the TOPIC: line, or None
    """
    # Strip the TOPIC: line (metadata only, not content for RAG)
    topic_keywords: Optional[str] = None
    clean_lines: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.upper().startswith("TOPIC:"):
            topic_keywords = stripped[6:].strip()
        else:
            clean_lines.append(line)

    # Split text at ALL-CAPS section headers
    sections: list[dict] = []
    current_type = "general"
    current_lines: list[str] = []

    for line in clean_lines:
        m = _HEADER_RE.match(line.rstrip())
        if m:
            # Flush accumulated content
            content = "\n".join(current_lines).strip()
            if content:
                sections.append({"content": content, "section_type": current_type})
            current_type = _classify_section(m.group(1).strip())
            current_lines = [line]
        else:
            current_lines.append(line)

    # Flush final section
    content = "\n".join(current_lines).strip()
    if content:
        sections.append({"content": content, "section_type": current_type})

    # Split any section that exceeds _MAX_SECTION_CHARS while preserving section_type
    result: list[dict] = []
    for section in sections:
        if len(section["content"]) <= _MAX_SECTION_CHARS:
            result.append(section)
        else:
            paragraphs = [p for p in section["content"].split("\n\n") if p.strip()]
            chunk_lines: list[str] = []
            chunk_len = 0
            for para in paragraphs:
                if chunk_len + len(para) > _MAX_SECTION_CHARS and chunk_lines:
                    result.append({
                        "content": "\n\n".join(chunk_lines).strip(),
                        "section_type": section["section_type"],
                    })
                    chunk_lines = [para]
                    chunk_len = len(para)
                else:
                    chunk_lines.append(para)
                    chunk_len += len(para) + 2
            if chunk_lines:
                result.append({
                    "content": "\n\n".join(chunk_lines).strip(),
                    "section_type": section["section_type"],
                })

    return result, topic_keywords


# ── YAML metadata loader ───────────────────────────────────────────────────────


def load_yaml_metadata(txt_file_path: str) -> dict:
    """
    Given /uploads/article_001_content.txt, look for a companion YAML.
    Returns article_title, article_url, article_author, article_source.
    All values are None when no YAML file is found.
    """
    base = os.path.splitext(txt_file_path)[0]
    candidates = [
        base.replace("_content", "_metadata") + ".yaml",
        base + "_metadata.yaml",
        base + ".yaml",
    ]
    for path in candidates:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            return {
                "article_title":  data.get("title"),
                "article_url":    data.get("url"),
                "article_author": data.get("author"),
                "article_source": data.get("source"),
            }
    return {
        "article_title":  None,
        "article_url":    None,
        "article_author": None,
        "article_source": None,
    }


# ── Embedding model ────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _get_embedding_model() -> SentenceTransformer:
    """Load once per worker process and reuse across tasks."""
    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


# ── Celery task ────────────────────────────────────────────────────────────────


@celery_app.task(bind=True, max_retries=3)
def ingest_document_task(
    self,
    document_id: str,
    *,
    article_title: str | None = None,
    article_author: str | None = None,
    article_source: str | None = None,
    article_url: str | None = None,
):
    """
    Full ingestion pipeline: .txt → section-aware chunks → embed → pgvector → FAISS export.

    Attribution metadata can be supplied directly (admin upload form fields).
    Falls back to reading a companion .yaml file.
    """
    try:
        new_version = None
        doc_count = 0

        with sync_session() as db:
            doc = db.get(KnowledgeDocument, uuid_module.UUID(document_id))
            if not doc:
                return

            # Step 1: Resolve attribution metadata
            if article_title or article_author or article_source or article_url:
                metadata = {
                    "article_title":  article_title,
                    "article_url":    article_url,
                    "article_author": article_author,
                    "article_source": article_source,
                }
            else:
                metadata = load_yaml_metadata(doc.file_path)

            # Step 2: Read file and split by sections
            with open(doc.file_path, "r", encoding="utf-8") as f:
                text = f.read()

            chunks, topic_keywords = split_by_sections(text)

            # Store topic_keywords on the document for LLM-routing lookup
            if topic_keywords:
                doc.topic_keywords = topic_keywords

            # Filter out 'topic' section_type chunks — they are metadata, not RAG content
            rag_chunks = [c for c in chunks if c["section_type"] != "topic"]

            # Step 3: Embed all chunks
            model = _get_embedding_model()
            texts = [c["content"] for c in rag_chunks]
            embeddings = model.encode(texts, show_progress_bar=False, batch_size=32)

            # Step 4: Save chunks + embeddings into pgvector
            for i, (chunk, embedding) in enumerate(zip(rag_chunks, embeddings)):
                db.add(KnowledgeChunk(
                    document_id=uuid_module.UUID(document_id),
                    content=chunk["content"],
                    chunk_index=i,
                    section_type=chunk["section_type"],
                    embedding=embedding.tolist(),
                    article_title=metadata["article_title"],
                    article_url=metadata["article_url"],
                    article_author=metadata["article_author"],
                    article_source=metadata["article_source"],
                ))

            # Step 5: Mark document ACTIVE
            doc.status = DocumentStatus.ACTIVE
            doc.chunk_count = len(rag_chunks)
            doc.processed_at = datetime.utcnow()

            # Step 6: Bump knowledge base version + export new FAISS index
            new_version = bump_version_and_export_sync(db)

            doc_count = db.scalar(
                select(func.count(KnowledgeDocument.id)).where(
                    KnowledgeDocument.status == DocumentStatus.ACTIVE
                )
            ) or 0

        if new_version is not None:
            asyncio.run(
                socket_emitter.emit_kb_updated(
                    new_version=new_version,
                    document_count=doc_count,
                )
            )

    except Exception as exc:
        try:
            with sync_session() as db:
                doc = db.get(KnowledgeDocument, uuid_module.UUID(document_id))
                if doc:
                    doc.status = DocumentStatus.FAILED
                    doc.error_message = str(exc)
        except Exception:
            pass

        raise self.retry(exc=exc, countdown=60)
