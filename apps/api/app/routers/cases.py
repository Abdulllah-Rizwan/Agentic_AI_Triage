import hashlib
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Request as FastAPIRequest
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.security import CurrentUser, get_current_user, get_device_user, require_responder
from app.models import schemas
from app.models.db import Case, CaseStatus, Organization, TriageLevel
from app.services import socket_emitter
from app.workers.soap_worker import generate_soap_task

router = APIRouter(tags=["cases"])

_MAX_PAYLOAD_BYTES = 10_000


def _hash_cnic(cnic: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", cnic.encode(), b"medireach_salt", 100_000
    ).hex()


def _case_to_list_item(case: Case) -> schemas.CaseListItem:
    return schemas.CaseListItem(
        id=case.id,
        triage_level=case.triage_level.value,
        status=case.status.value,
        chief_complaint=case.chief_complaint,
        triage_reason=case.triage_reason,
        lat=case.lat,
        lng=case.lng,
        severity=case.severity,
        received_at=case.received_at,
        has_soap=case.soap_report is not None,
        claimed_by_org_id=case.claimed_by_org_id,
    )


# ── POST /ingest ──────────────────────────────────────────────────────────────


@router.post("/ingest", response_model=schemas.CaseIngestResponse, status_code=202)
async def ingest_case(
    request: FastAPIRequest,
    db: AsyncSession = Depends(get_db),
    _device: str = Depends(get_device_user),
):
    raw_body = await request.body()
    if len(raw_body) > _MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")

    from app.proto import triage_pb2

    payload = triage_pb2.LeanPayload()
    try:
        payload.ParseFromString(raw_body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid protobuf payload")

    # Idempotency — same case_id submitted again
    existing = await db.get(Case, payload.case_id)
    if existing:
        return schemas.CaseIngestResponse(
            case_id=payload.case_id,
            status="DUPLICATE",
            message="Already received",
        )

    case = Case(
        id=payload.case_id,
        patient_cnic_hash=_hash_cnic(payload.patient.cnic),
        patient_name=payload.patient.name,
        patient_phone=payload.patient.phone,
        lat=payload.patient.lat,
        lng=payload.patient.lng,
        chief_complaint=payload.chief_complaint,
        symptoms=list(payload.symptoms),
        severity=payload.severity,
        triage_level=TriageLevel(payload.triage_level),
        triage_reason=payload.triage_reason,
        conversation_summary=payload.conversation_summary,
        device_id=payload.device_id,
    )
    db.add(case)
    await db.commit()

    if payload.triage_level in ("RED", "AMBER"):
        generate_soap_task.delay(payload.case_id)

    await socket_emitter.emit_new_case(
        case_id=payload.case_id,
        triage_level=payload.triage_level,
        lat=payload.patient.lat,
        lng=payload.patient.lng,
        chief_complaint=payload.chief_complaint,
        org_id=None,  # no org zone assigned yet — broadcast to all
    )

    return schemas.CaseIngestResponse(
        case_id=payload.case_id,
        status="QUEUED",
        message="Case received. SOAP report generating.",
    )


# ── GET / ─────────────────────────────────────────────────────────────────────


@router.get("", response_model=schemas.CaseListResponse)
async def list_cases(
    triage_level: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    sort: str = "received_at:desc",
    db: AsyncSession = Depends(get_db),
    _current_user: CurrentUser = Depends(get_current_user),
):
    limit = min(limit, 100)

    conditions = []

    if triage_level:
        try:
            levels = [TriageLevel(lv.strip()) for lv in triage_level.split(",") if lv.strip()]
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid triage_level: {exc}")
        conditions.append(Case.triage_level.in_(levels))

    if status:
        try:
            statuses = [CaseStatus(s.strip()) for s in status.split(",") if s.strip()]
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid status: {exc}")
        conditions.append(Case.status.in_(statuses))

    where_clause = and_(*conditions) if conditions else True

    total: int = await db.scalar(select(func.count(Case.id)).where(where_clause))

    sort_parts = sort.split(":")
    sort_field = sort_parts[0]
    sort_dir = sort_parts[1] if len(sort_parts) > 1 else "desc"

    if sort_field == "severity":
        order_col = Case.severity.desc()
    elif sort_field == "received_at" and sort_dir == "asc":
        order_col = Case.received_at.asc()
    else:
        order_col = Case.received_at.desc()

    rows = (
        await db.scalars(
            select(Case)
            .options(joinedload(Case.soap_report))
            .where(where_clause)
            .order_by(order_col)
            .limit(limit)
            .offset(offset)
        )
    ).unique().all()

    return schemas.CaseListResponse(
        total=total,
        limit=limit,
        offset=offset,
        cases=[_case_to_list_item(c) for c in rows],
    )


# ── GET /{case_id} ────────────────────────────────────────────────────────────


@router.get("/{case_id}", response_model=schemas.CaseDetailResponse)
async def get_case(
    case_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    case: Case | None = (
        await db.scalars(
            select(Case)
            .options(joinedload(Case.soap_report))
            .where(Case.id == case_id)
        )
    ).first()

    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    show_pii = current_user.role in ("ADMIN", "RESPONDER")

    soap = None
    if case.soap_report:
        soap = schemas.SoapReportSchema(
            subjective=case.soap_report.subjective,
            objective=case.soap_report.objective,
            assessment=case.soap_report.assessment,
            plan=case.soap_report.plan,
            generated_at=case.soap_report.generated_at,
            model_used=case.soap_report.model_used,
        )

    return schemas.CaseDetailResponse(
        id=case.id,
        triage_level=case.triage_level.value,
        status=case.status.value,
        chief_complaint=case.chief_complaint,
        triage_reason=case.triage_reason,
        symptoms=case.symptoms,
        severity=case.severity,
        lat=case.lat,
        lng=case.lng,
        patient_name=case.patient_name if show_pii else None,
        patient_phone=case.patient_phone if show_pii else None,
        received_at=case.received_at,
        claimed_at=case.claimed_at,
        claimed_by_org_id=case.claimed_by_org_id,
        soap_report=soap,
    )


# ── PATCH /{case_id}/claim ────────────────────────────────────────────────────


@router.patch("/{case_id}/claim", response_model=schemas.ClaimResponse)
async def claim_case(
    case_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_responder),
):
    case: Case | None = await db.get(Case, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    if case.claimed_by_org_id is not None:
        raise HTTPException(status_code=409, detail="Case already claimed by another organization")

    now = datetime.now(timezone.utc)
    case.status = CaseStatus.ACKNOWLEDGED
    case.claimed_by_org_id = current_user.org_id
    case.claimed_at = now
    await db.commit()

    # Fetch org name for the socket event
    org: Organization | None = await db.get(Organization, current_user.org_id)
    org_name = org.name if org else str(current_user.org_id)

    await socket_emitter.emit_case_claimed(
        case_id=case_id,
        claimed_by_org_name=org_name,
        org_id=str(current_user.org_id),
    )

    return schemas.ClaimResponse(
        case_id=case_id,
        status=CaseStatus.ACKNOWLEDGED.value,
        claimed_by_org_id=current_user.org_id,
        claimed_at=now,
    )


# ── PATCH /{case_id}/resolve ──────────────────────────────────────────────────


@router.patch("/{case_id}/resolve", response_model=schemas.ResolveResponse)
async def resolve_case(
    case_id: str,
    body: schemas.ResolveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(require_responder),
):
    case: Case | None = await db.get(Case, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    if case.status != CaseStatus.ACKNOWLEDGED:
        raise HTTPException(
            status_code=409,
            detail="Case must be in ACKNOWLEDGED status before it can be resolved",
        )

    if current_user.role != "ADMIN" and case.claimed_by_org_id != current_user.org_id:
        raise HTTPException(
            status_code=403,
            detail="You can only resolve cases claimed by your organization",
        )

    now = datetime.now(timezone.utc)
    case.status = CaseStatus.RESOLVED
    case.resolved_at = now
    await db.commit()

    await socket_emitter.emit_case_resolved(
        case_id=case_id,
        resolved_at=now.isoformat(),
        org_id=str(case.claimed_by_org_id) if case.claimed_by_org_id else None,
    )

    return schemas.ResolveResponse(
        case_id=case_id,
        status=CaseStatus.RESOLVED.value,
        resolved_at=now,
    )
