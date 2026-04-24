"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-24 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── pgvector extension ────────────────────────────────────────────────────
    # Must run before any table with a Vector column is created.
    # init_db.sql already handles this for Docker first-boot, but Alembic
    # runs this too so migrations work against a bare PostgreSQL instance.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── Enum types ────────────────────────────────────────────────────────────
    orgtype = postgresql.ENUM(
        "NGO", "HOSPITAL", "GOVT", "RELIEF_CAMP", name="orgtype", create_type=False
    )
    orgstatus = postgresql.ENUM(
        "PENDING_APPROVAL", "ACTIVE", "SUSPENDED", name="orgstatus", create_type=False
    )
    triagelevel = postgresql.ENUM(
        "RED", "AMBER", "GREEN", name="triagelevel", create_type=False
    )
    casestatus = postgresql.ENUM(
        "PENDING", "ACKNOWLEDGED", "RESOLVED", "CLOSED", name="casestatus", create_type=False
    )
    documentstatus = postgresql.ENUM(
        "PROCESSING", "ACTIVE", "FAILED", "ARCHIVED", name="documentstatus", create_type=False
    )

    op.execute("CREATE TYPE orgtype AS ENUM ('NGO', 'HOSPITAL', 'GOVT', 'RELIEF_CAMP')")
    op.execute("CREATE TYPE orgstatus AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED')")
    op.execute("CREATE TYPE triagelevel AS ENUM ('RED', 'AMBER', 'GREEN')")
    op.execute("CREATE TYPE casestatus AS ENUM ('PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED')")
    op.execute("CREATE TYPE documentstatus AS ENUM ('PROCESSING', 'ACTIVE', 'FAILED', 'ARCHIVED')")

    # ── organizations ─────────────────────────────────────────────────────────
    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("type", orgtype, nullable=False),
        sa.Column("access_code", sa.String(), nullable=False, unique=True),
        sa.Column(
            "status",
            orgstatus,
            nullable=False,
            server_default="PENDING_APPROVAL",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # ── users ─────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False, server_default="RESPONDER"),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
    )

    # ── cases ─────────────────────────────────────────────────────────────────
    op.create_table(
        "cases",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("patient_cnic_hash", sa.String(), nullable=False),
        sa.Column("patient_name", sa.String(), nullable=False),
        sa.Column("patient_phone", sa.String(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("chief_complaint", sa.String(), nullable=False),
        sa.Column("symptoms", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("severity", sa.Integer(), nullable=False),
        sa.Column("triage_level", triagelevel, nullable=False),
        sa.Column("triage_reason", sa.String(), nullable=False),
        sa.Column("conversation_summary", sa.String(), nullable=False),
        sa.Column(
            "status",
            casestatus,
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column("claimed_by_org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column(
            "received_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["claimed_by_org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
    )

    # ── soap_reports ──────────────────────────────────────────────────────────
    op.create_table(
        "soap_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("case_id", sa.String(), nullable=False, unique=True),
        sa.Column("subjective", sa.String(), nullable=False),
        sa.Column("objective", sa.String(), nullable=False),
        sa.Column("assessment", sa.String(), nullable=False),
        sa.Column("plan", sa.String(), nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("model_used", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"]),
    )

    # ── knowledge_documents ───────────────────────────────────────────────────
    op.create_table(
        "knowledge_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("file_path", sa.String(), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            documentstatus,
            nullable=False,
            server_default="PROCESSING",
        ),
        sa.Column("chunk_count", sa.Integer(), nullable=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "uploaded_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
    )

    # ── knowledge_chunks ──────────────────────────────────────────────────────
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("embedding", Vector(384), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["knowledge_documents.id"],
            ondelete="CASCADE",
        ),
    )

    # ── knowledge_base_version ────────────────────────────────────────────────
    op.create_table(
        "knowledge_base_version",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("index_file_path", sa.String(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("document_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunk_count", sa.Integer(), nullable=False, server_default="0"),
    )

    # Seed the single KnowledgeBaseVersion row (id=1 always)
    op.execute(
        "INSERT INTO knowledge_base_version (id, version, document_count, chunk_count) "
        "VALUES (1, 1, 0, 0)"
    )

    # ── Indexes ───────────────────────────────────────────────────────────────
    # Cases: commonly filtered by triage_level and status
    op.create_index("ix_cases_triage_level", "cases", ["triage_level"])
    op.create_index("ix_cases_status", "cases", ["status"])
    op.create_index("ix_cases_received_at", "cases", ["received_at"])
    op.create_index("ix_cases_org_id", "cases", ["org_id"])

    # Knowledge chunks: IVFFlat index for fast approximate cosine search
    # Lists=100 is appropriate for up to ~1M vectors; rebuild if corpus grows.
    op.execute(
        "CREATE INDEX ix_knowledge_chunks_embedding "
        "ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) "
        "WITH (lists = 100)"
    )


def downgrade() -> None:
    op.drop_index("ix_knowledge_chunks_embedding", table_name="knowledge_chunks")
    op.drop_index("ix_cases_org_id", table_name="cases")
    op.drop_index("ix_cases_received_at", table_name="cases")
    op.drop_index("ix_cases_status", table_name="cases")
    op.drop_index("ix_cases_triage_level", table_name="cases")

    op.drop_table("knowledge_base_version")
    op.drop_table("knowledge_chunks")
    op.drop_table("knowledge_documents")
    op.drop_table("soap_reports")
    op.drop_table("cases")
    op.drop_table("users")
    op.drop_table("organizations")

    op.execute("DROP TYPE IF EXISTS documentstatus")
    op.execute("DROP TYPE IF EXISTS casestatus")
    op.execute("DROP TYPE IF EXISTS triagelevel")
    op.execute("DROP TYPE IF EXISTS orgstatus")
    op.execute("DROP TYPE IF EXISTS orgtype")

    op.execute("DROP EXTENSION IF EXISTS vector")
