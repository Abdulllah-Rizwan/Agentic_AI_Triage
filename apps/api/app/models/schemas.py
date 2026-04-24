from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ── Auth ──────────────────────────────────────────────────────────────────────


class RegisterRequest(BaseModel):
    org_name: str = Field(..., min_length=2, max_length=100)
    org_type: str  # NGO | HOSPITAL | GOVT | RELIEF_CAMP
    email: EmailStr
    password: str = Field(..., min_length=8)
    access_code: str = Field(..., min_length=4, max_length=20)


class RegisterResponse(BaseModel):
    org_id: UUID
    message: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserInfo(BaseModel):
    id: UUID
    email: str
    role: str
    org_id: UUID
    org_name: str
    org_type: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserInfo


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class DeviceRegisterRequest(BaseModel):
    device_id: str
    device_model: str
    app_version: str


class DeviceRegisterResponse(BaseModel):
    device_token: str
    expires_in_days: int = 30


# ── Cases ─────────────────────────────────────────────────────────────────────


class CaseIngestResponse(BaseModel):
    case_id: str
    status: str = "QUEUED"
    message: str


class SoapReportSchema(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    subjective: str
    objective: str
    assessment: str
    plan: str
    generated_at: datetime
    model_used: str


class CaseListItem(BaseModel):
    id: str
    triage_level: str
    status: str
    chief_complaint: str
    triage_reason: str
    lat: float
    lng: float
    severity: int
    received_at: datetime
    has_soap: bool
    claimed_by_org_id: Optional[UUID] = None


class CaseListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    cases: list[CaseListItem]


class CaseDetailResponse(BaseModel):
    id: str
    triage_level: str
    status: str
    chief_complaint: str
    triage_reason: str
    symptoms: list[str]
    severity: int
    lat: float
    lng: float
    patient_name: Optional[str] = None   # null for VIEWER role
    patient_phone: Optional[str] = None  # null for VIEWER role
    received_at: datetime
    claimed_at: Optional[datetime] = None
    claimed_by_org_id: Optional[UUID] = None
    soap_report: Optional[SoapReportSchema] = None


class ClaimResponse(BaseModel):
    case_id: str
    status: str
    claimed_by_org_id: UUID
    claimed_at: datetime


class ResolveRequest(BaseModel):
    outcome: str
    resolution_notes: Optional[str] = None


class ResolveResponse(BaseModel):
    case_id: str
    status: str
    resolved_at: datetime


# ── Analytics ─────────────────────────────────────────────────────────────────


class AnalyticsSummaryResponse(BaseModel):
    period_days: int
    total_cases: int
    critical_cases: int
    avg_response_time_minutes: float
    resolution_rate_percent: float
    cases_last_24h: int
    pending_cases: int


class TimeseriesPoint(BaseModel):
    date: str
    RED: int
    AMBER: int
    GREEN: int


class TimeseriesResponse(BaseModel):
    period_days: int
    series: list[TimeseriesPoint]


class SymptomCount(BaseModel):
    symptom: str
    count: int


class SymptomsResponse(BaseModel):
    period_days: int
    symptoms: list[SymptomCount]


class GeoPoint(BaseModel):
    lat: float
    lng: float
    triage_level: str
    weight: int


class GeoResponse(BaseModel):
    period_days: int
    points: list[GeoPoint]


# ── Knowledge Base (public) ───────────────────────────────────────────────────


class KnowledgeVersionResponse(BaseModel):
    version: int
    document_count: int
    chunk_count: int
    updated_at: datetime


class KnowledgeQueryRequest(BaseModel):
    query: str
    top_k: int = 3


class KnowledgeQueryResult(BaseModel):
    content: str
    document_title: str
    page_number: Optional[int] = None
    relevance_score: float


class KnowledgeQueryResponse(BaseModel):
    results: list[KnowledgeQueryResult]


# ── Admin — Knowledge ─────────────────────────────────────────────────────────


class DocumentListItem(BaseModel):
    id: UUID
    title: str
    filename: str
    file_size_bytes: int
    status: str
    chunk_count: Optional[int] = None
    uploaded_by_email: str
    uploaded_at: datetime
    processed_at: Optional[datetime] = None
    error_message: Optional[str] = None


class DocumentListResponse(BaseModel):
    documents: list[DocumentListItem]
    kb_version: int
    total_active_chunks: int


class DocumentUploadResponse(BaseModel):
    id: UUID
    title: str
    status: str
    message: str


class DocumentDetailResponse(BaseModel):
    id: UUID
    title: str
    filename: str
    file_size_bytes: int
    status: str
    chunk_count: Optional[int] = None
    uploaded_at: datetime
    processed_at: Optional[datetime] = None
    error_message: Optional[str] = None


class DocumentArchiveResponse(BaseModel):
    id: UUID
    status: str
    new_kb_version: int


class DocumentReprocessResponse(BaseModel):
    id: UUID
    status: str
    message: str


class DocumentDeleteResponse(BaseModel):
    deleted_id: UUID
    new_kb_version: int
    message: str


class TopRetrievedDocument(BaseModel):
    id: UUID
    title: str
    retrievals_7d: int


class KnowledgeStatsResponse(BaseModel):
    kb_version: int
    active_documents: int
    total_chunks: int
    index_size_mb: float
    last_updated: Optional[datetime] = None
    top_retrieved_documents: list[TopRetrievedDocument]


# ── Admin — Organizations ─────────────────────────────────────────────────────


class OrganizationListItem(BaseModel):
    id: UUID
    name: str
    type: str
    status: str
    access_code: str
    user_count: int
    case_count: int
    created_at: datetime


class OrganizationListResponse(BaseModel):
    organizations: list[OrganizationListItem]


class OrgApproveResponse(BaseModel):
    org_id: UUID
    status: str
    message: str


class OrgSuspendRequest(BaseModel):
    reason: str


class OrgSuspendResponse(BaseModel):
    org_id: UUID
    status: str


# ── Admin — System ────────────────────────────────────────────────────────────


class SystemHealthResponse(BaseModel):
    api: str
    postgres: str
    redis: str
    celery_workers: int
    checked_at: datetime


class QueueJobStats(BaseModel):
    pending: int
    active: int
    failed: int


class QueueStatsResponse(BaseModel):
    soap_generation: QueueJobStats
    document_ingestion: QueueJobStats
    checked_at: datetime
