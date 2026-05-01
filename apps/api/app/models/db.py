from datetime import datetime
import enum
import uuid

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


# ── Enums ─────────────────────────────────────────────────────────────────────


class OrgType(str, enum.Enum):
    NGO = "NGO"
    HOSPITAL = "HOSPITAL"
    GOVT = "GOVT"
    RELIEF_CAMP = "RELIEF_CAMP"


class OrgStatus(str, enum.Enum):
    PENDING_APPROVAL = "PENDING_APPROVAL"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"


class TriageLevel(str, enum.Enum):
    RED = "RED"
    AMBER = "AMBER"
    GREEN = "GREEN"


class CaseStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"


class DocumentStatus(str, enum.Enum):
    PROCESSING = "PROCESSING"
    ACTIVE = "ACTIVE"
    FAILED = "FAILED"
    ARCHIVED = "ARCHIVED"


# ── Core Tables ───────────────────────────────────────────────────────────────


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    type = Column(Enum(OrgType), nullable=False)
    access_code = Column(String, unique=True, nullable=False)
    status = Column(Enum(OrgStatus), default=OrgStatus.PENDING_APPROVAL)
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="org")
    cases = relationship(
        "Case",
        back_populates="org",
        foreign_keys="Case.org_id",
    )


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    # Role hierarchy: ADMIN > RESPONDER > VIEWER
    # ADMIN:     full access including all /api/v1/admin/* routes
    # RESPONDER: can view cases, claim, resolve
    # VIEWER:    read-only dashboard access
    role = Column(String, nullable=False, default="RESPONDER")
    org_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    org = relationship("Organization", back_populates="users")
    uploaded_docs = relationship("KnowledgeDocument", back_populates="uploaded_by_user")


class Case(Base):
    __tablename__ = "cases"

    id = Column(String, primary_key=True)
    patient_cnic_hash = Column(String, nullable=False)
    patient_name = Column(String, nullable=False)
    patient_phone = Column(String, nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    chief_complaint = Column(String, nullable=False)
    symptoms = Column(ARRAY(String), nullable=False)
    severity = Column(Integer, nullable=False)
    triage_level = Column(Enum(TriageLevel), nullable=False)
    triage_reason = Column(String, nullable=False)
    conversation_summary = Column(String, nullable=False)
    status = Column(Enum(CaseStatus), default=CaseStatus.PENDING)
    claimed_by_org_id = Column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True
    )
    claimed_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)
    device_id = Column(String, nullable=False)
    org_id = Column(
        UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True
    )

    soap_report = relationship("SoapReport", back_populates="case", uselist=False)
    org = relationship(
        "Organization", back_populates="cases", foreign_keys=[org_id]
    )


class SoapReport(Base):
    __tablename__ = "soap_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id = Column(String, ForeignKey("cases.id"), unique=True)
    subjective = Column(String, nullable=False)
    objective = Column(String, nullable=False)
    assessment = Column(String, nullable=False)
    plan = Column(String, nullable=False)
    generated_at = Column(DateTime, default=datetime.utcnow)
    model_used = Column(String, nullable=False)

    case = relationship("Case", back_populates="soap_report")


# ── Knowledge Base Tables ─────────────────────────────────────────────────────


class KnowledgeDocument(Base):
    """
    One row per uploaded PDF. Created immediately on upload (PROCESSING).
    The Celery ingestion worker chunks + embeds it, then sets status=ACTIVE
    and bumps KnowledgeBaseVersion.version.
    """

    __tablename__ = "knowledge_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_size_bytes = Column(Integer, nullable=False)
    status = Column(Enum(DocumentStatus), default=DocumentStatus.PROCESSING)
    chunk_count = Column(Integer, nullable=True)
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    retrieval_count = Column(Integer, default=0, nullable=False, server_default="0")

    uploaded_by_user = relationship("User", back_populates="uploaded_docs")
    chunks = relationship(
        "KnowledgeChunk",
        back_populates="document",
        cascade="all, delete-orphan",
    )


class KnowledgeChunk(Base):
    """
    One row per text chunk extracted from a document.
    The embedding column is a 384-dim pgvector vector from all-MiniLM-L6-v2.
    RAG queries do cosine similarity search against this column.
    """

    __tablename__ = "knowledge_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(
        UUID(as_uuid=True),
        ForeignKey("knowledge_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    content = Column(Text, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    # Source attribution — populated from companion .yaml at ingestion time
    article_title  = Column(String, nullable=True)
    article_url    = Column(String, nullable=True)
    article_author = Column(String, nullable=True)
    article_source = Column(String, nullable=True)
    embedding = Column(Vector(384), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("KnowledgeDocument", back_populates="chunks")


class KnowledgeBaseVersion(Base):
    """
    Always a single row (id=1). Version is incremented each time the
    knowledge base changes. Mobile apps compare their cached version
    against this to decide whether to download a fresh offline FAISS index.
    """

    __tablename__ = "knowledge_base_version"

    id = Column(Integer, primary_key=True, default=1)
    version = Column(Integer, nullable=False, default=1)
    index_file_path = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)
    document_count = Column(Integer, default=0)
    chunk_count = Column(Integer, default=0)
