import asyncio
import os
import uuid as uuid_module
from datetime import datetime
from functools import lru_cache

import yaml
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import TextLoader
from sentence_transformers import SentenceTransformer
from sqlalchemy import func, select

from app.core.database import sync_session
from app.models.db import DocumentStatus, KnowledgeChunk, KnowledgeDocument
from app.services import socket_emitter
from app.services.index_exporter import bump_version_and_export_sync
from app.workers.celery_app import celery_app


def load_yaml_metadata(txt_file_path: str) -> dict:
    """
    Given /uploads/article_001_content.txt, look for a companion YAML using
    the _content/_metadata naming convention, then two fallback patterns.
    Returns a dict with article_title, article_url, article_author, article_source.
    All values are None when no YAML file is found.
    """
    base = os.path.splitext(txt_file_path)[0]  # strip .txt
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


@lru_cache(maxsize=1)
def _get_embedding_model() -> SentenceTransformer:
    """Load once per worker process and reuse across tasks."""
    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


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
    Full ingestion pipeline: .txt → chunk → embed → pgvector → FAISS export.

    Attribution metadata (article_title / author / source / url) can be
    supplied directly by the caller (admin upload via form fields).  When
    they are not provided the worker falls back to reading a companion .yaml
    file alongside the document on disk — this is the path taken for the
    seed script and any other tooling that places files directly in UPLOAD_DIR.
    """
    try:
        new_version = None
        doc_count = 0

        with sync_session() as db:
            doc = db.get(KnowledgeDocument, uuid_module.UUID(document_id))
            if not doc:
                return

            # Step 1: Resolve attribution metadata.
            # Prefer form-supplied values; fall back to companion YAML.
            if article_title or article_author or article_source or article_url:
                metadata = {
                    "article_title":  article_title,
                    "article_url":    article_url,
                    "article_author": article_author,
                    "article_source": article_source,
                }
            else:
                metadata = load_yaml_metadata(doc.file_path)

            # Step 2: Load plain text file
            loader = TextLoader(doc.file_path, encoding="utf-8")
            pages = loader.load()

            # Step 3: Split into chunks
            # chunk_size=512 ≈ 400 words — good balance for medical text
            # chunk_overlap=64 ensures context is not lost at chunk boundaries
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=512,
                chunk_overlap=64,
                separators=["\n\n", "\n", ". ", " ", ""],
            )
            chunks = splitter.split_documents(pages)

            # Step 4: Embed all chunks with all-MiniLM-L6-v2
            model = _get_embedding_model()
            texts = [c.page_content for c in chunks]
            embeddings = model.encode(texts, show_progress_bar=False, batch_size=32)

            # Step 5: Save chunks + embeddings into pgvector
            # Metadata from YAML is denormalised onto every chunk of this document
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                db.add(KnowledgeChunk(
                    document_id=uuid_module.UUID(document_id),
                    content=chunk.page_content,
                    chunk_index=i,
                    embedding=embedding.tolist(),
                    article_title=metadata["article_title"],
                    article_url=metadata["article_url"],
                    article_author=metadata["article_author"],
                    article_source=metadata["article_source"],
                ))

            # Step 6: Mark document as ACTIVE
            doc.status = DocumentStatus.ACTIVE
            doc.chunk_count = len(chunks)
            doc.processed_at = datetime.utcnow()

            # Step 7: Bump knowledge base version + export new FAISS index
            new_version = bump_version_and_export_sync(db)

            doc_count = db.scalar(
                select(func.count(KnowledgeDocument.id)).where(
                    KnowledgeDocument.status == DocumentStatus.ACTIVE
                )
            ) or 0
            # sync_session context manager commits on normal exit

        # Notify dashboard clients after the DB session is closed and committed
        if new_version is not None:
            asyncio.run(
                socket_emitter.emit_kb_updated(
                    new_version=new_version,
                    document_count=doc_count,
                )
            )

    except Exception as exc:
        # Mark the document as FAILED in a separate session so the admin can see the error
        try:
            with sync_session() as db:
                doc = db.get(KnowledgeDocument, uuid_module.UUID(document_id))
                if doc:
                    doc.status = DocumentStatus.FAILED
                    doc.error_message = str(exc)
        except Exception:
            pass

        raise self.retry(exc=exc, countdown=60)
