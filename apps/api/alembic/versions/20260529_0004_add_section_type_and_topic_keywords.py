"""add section_type to knowledge_chunks and topic_keywords to knowledge_documents

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-29 00:00:00.000000

section_type classifies each chunk by its article section:
    symptoms | emergency | action | prevention | general
This enables the RAG pipeline to prefer actionable "WHAT TO DO" chunks
over purely informational "RECOGNIZING" chunks.

topic_keywords stores the TOPIC: line from each article, used by the
LLM-routing endpoint to match patient symptoms to the correct article.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "knowledge_chunks",
        sa.Column("section_type", sa.String(), nullable=True),
    )
    op.add_column(
        "knowledge_documents",
        sa.Column("topic_keywords", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("knowledge_chunks", "section_type")
    op.drop_column("knowledge_documents", "topic_keywords")
