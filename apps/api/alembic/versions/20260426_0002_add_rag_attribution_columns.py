"""add RAG attribution columns

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-26 00:00:00.000000

Adds:
  knowledge_chunks.article_title / article_url / article_author / article_source
  knowledge_documents.retrieval_count
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # knowledge_chunks — source attribution columns
    op.add_column("knowledge_chunks", sa.Column("article_title",  sa.String(), nullable=True))
    op.add_column("knowledge_chunks", sa.Column("article_url",    sa.String(), nullable=True))
    op.add_column("knowledge_chunks", sa.Column("article_author", sa.String(), nullable=True))
    op.add_column("knowledge_chunks", sa.Column("article_source", sa.String(), nullable=True))

    # knowledge_documents — retrieval frequency counter
    op.add_column(
        "knowledge_documents",
        sa.Column("retrieval_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("knowledge_documents", "retrieval_count")
    op.drop_column("knowledge_chunks", "article_source")
    op.drop_column("knowledge_chunks", "article_author")
    op.drop_column("knowledge_chunks", "article_url")
    op.drop_column("knowledge_chunks", "article_title")
