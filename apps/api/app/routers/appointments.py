from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.security import CurrentUser, get_current_user, get_device_user_optional
from app.models import schemas
from app.models.db import (
    Appointment,
    AppointmentStatus,
    Case,
    Practitioner,
    PractitionerSlot,
    SoapReport,
)

router = APIRouter(tags=["appointments"])


# ── GET /practitioners ────────────────────────────────────────────────────────
# Public endpoint — no auth required (device or dashboard can call it)

@router.get("/practitioners", response_model=schemas.PractitionerListResponse)
async def list_practitioners(
    specialty: str | None = None,
    city: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Practitioner).where(Practitioner.is_active == True)
    if specialty:
        q = q.where(Practitioner.specialty == specialty)
    if city:
        q = q.where(Practitioner.city.ilike(f"%{city}%"))

    rows = (await db.scalars(q.options(joinedload(Practitioner.slots)))).unique().all()

    items = [
        schemas.PractitionerItem(
            id=p.id,
            org_id=p.org_id,
            name=p.name,
            specialty=p.specialty,
            city=p.city,
            clinic_name=p.clinic_name,
            phone=p.phone,
            bio=p.bio,
            available_slot_count=sum(1 for s in p.slots if not s.is_booked),
        )
        for p in rows
    ]
    return schemas.PractitionerListResponse(practitioners=items)


# ── GET /practitioners/{id}/slots ─────────────────────────────────────────────

@router.get("/practitioners/{practitioner_id}/slots",
            response_model=schemas.PractitionerDetailResponse)
async def get_practitioner_slots(
    practitioner_id: str,
    db: AsyncSession = Depends(get_db),
):
    p: Practitioner | None = (
        await db.scalars(
            select(Practitioner)
            .options(joinedload(Practitioner.slots))
            .where(Practitioner.id == practitioner_id, Practitioner.is_active == True)
        )
    ).first()

    if not p:
        raise HTTPException(status_code=404, detail="Practitioner not found")

    available = [
        schemas.PractitionerSlotItem(
            id=s.id,
            slot_date=s.slot_date,
            slot_time=s.slot_time,
            is_booked=s.is_booked,
        )
        for s in sorted(p.slots, key=lambda s: (s.slot_date, s.slot_time))
        if not s.is_booked
    ]

    return schemas.PractitionerDetailResponse(
        id=p.id,
        org_id=p.org_id,
        name=p.name,
        specialty=p.specialty,
        city=p.city,
        clinic_name=p.clinic_name,
        phone=p.phone,
        bio=p.bio,
        slots=available,
    )


# ── POST /appointments ────────────────────────────────────────────────────────
# Callable from the mobile app (device token optional) or dashboard

@router.post("/appointments", response_model=schemas.AppointmentResponse, status_code=201)
async def book_appointment(
    body: schemas.BookAppointmentRequest,
    db: AsyncSession = Depends(get_db),
    _device: str | None = Depends(get_device_user_optional),
):
    # Verify slot exists and is not already booked
    slot: PractitionerSlot | None = await db.get(PractitionerSlot, body.slot_id)
    if not slot or slot.practitioner_id != body.practitioner_id:
        raise HTTPException(status_code=404, detail="Slot not found")
    if slot.is_booked:
        raise HTTPException(status_code=409, detail="Slot already booked")

    # Validate case_id if provided
    if body.case_id:
        case = await db.get(Case, body.case_id)
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

    practitioner: Practitioner | None = await db.get(Practitioner, body.practitioner_id)
    if not practitioner or not practitioner.is_active:
        raise HTTPException(status_code=404, detail="Practitioner not found")

    # Mark slot booked and create appointment atomically
    slot.is_booked = True

    appointment = Appointment(
        practitioner_id=body.practitioner_id,
        slot_id=body.slot_id,
        case_id=body.case_id,
        patient_name=body.patient_name,
        patient_phone=body.patient_phone,
        chief_complaint=body.chief_complaint,
        triage_level=body.triage_level,
        status=AppointmentStatus.PENDING,
    )
    db.add(appointment)
    await db.commit()
    await db.refresh(appointment)

    return schemas.AppointmentResponse(
        id=appointment.id,
        practitioner_name=practitioner.name,
        clinic_name=practitioner.clinic_name,
        slot_date=slot.slot_date,
        slot_time=slot.slot_time,
        status=appointment.status.value,
        booked_at=appointment.booked_at,
    )


# ── GET /appointments — dashboard view (org-scoped) ───────────────────────────

@router.get("/appointments", response_model=schemas.AppointmentListResponse)
async def list_appointments(
    db: AsyncSession = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Returns appointments for practitioners belonging to the current user's org.
    ADMIN sees all appointments.
    """
    q = (
        select(Appointment)
        .options(
            joinedload(Appointment.practitioner),
            joinedload(Appointment.slot),
            joinedload(Appointment.case).joinedload(Case.soap_report),
        )
        .join(Practitioner, Appointment.practitioner_id == Practitioner.id)
    )

    if current_user.role != "ADMIN":
        q = q.where(Practitioner.org_id == current_user.org_id)

    q = q.order_by(Appointment.booked_at.desc())
    rows = (await db.scalars(q)).unique().all()

    items = []
    for a in rows:
        soap = None
        if a.case and a.case.soap_report:
            sr = a.case.soap_report
            soap = schemas.SoapReportSchema(
                subjective=sr.subjective,
                objective=sr.objective,
                assessment=sr.assessment,
                plan=sr.plan,
                generated_at=sr.generated_at,
                model_used=sr.model_used,
            )

        items.append(schemas.AppointmentDetailResponse(
            id=a.id,
            practitioner_name=a.practitioner.name,
            practitioner_specialty=a.practitioner.specialty,
            clinic_name=a.practitioner.clinic_name,
            city=a.practitioner.city,
            slot_date=a.slot.slot_date,
            slot_time=a.slot.slot_time,
            patient_name=a.patient_name,
            patient_phone=a.patient_phone,
            chief_complaint=a.chief_complaint,
            triage_level=a.triage_level,
            status=a.status.value,
            booked_at=a.booked_at,
            notes=a.notes,
            soap_report=soap,
        ))

    return schemas.AppointmentListResponse(appointments=items)
