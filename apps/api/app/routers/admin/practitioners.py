from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.security import CurrentUser, require_admin
from app.models import schemas
from app.models.db import Appointment, Organization, OrgStatus, OrgType, Practitioner, PractitionerSlot, Specialty

router = APIRouter(tags=["admin-practitioners"])


@router.get("/practitioners", response_model=schemas.PractitionerListResponse)
async def admin_list_practitioners(
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    rows = (
        await db.scalars(
            select(Practitioner).options(joinedload(Practitioner.slots))
        )
    ).unique().all()

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


@router.post("/practitioners", response_model=schemas.PractitionerItem, status_code=201)
async def create_practitioner(
    body: schemas.CreatePractitionerRequest,
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    try:
        specialty = Specialty(body.specialty)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid specialty: {body.specialty}")

    org: Organization | None = await db.get(Organization, body.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if org.status != OrgStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Organization is not active")
    if org.type != OrgType.HOSPITAL:
        raise HTTPException(status_code=400, detail="Only HOSPITAL organizations can have practitioners")

    p = Practitioner(
        org_id=org.id,
        name=body.name,
        specialty=specialty.value,
        city=body.city,
        clinic_name=org.name,
        phone=body.phone,
        bio=body.bio,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)

    return schemas.PractitionerItem(
        id=p.id,
        org_id=p.org_id,
        name=p.name,
        specialty=p.specialty,
        city=p.city,
        clinic_name=p.clinic_name,
        phone=p.phone,
        bio=p.bio,
        available_slot_count=0,
    )


@router.delete("/practitioners/{practitioner_id}", status_code=204)
async def delete_practitioner(
    practitioner_id: str,
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    p: Practitioner | None = await db.get(Practitioner, practitioner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Practitioner not found")
    # Delete appointments first — FK has no cascade so PG would block the delete
    await db.execute(sa_delete(Appointment).where(Appointment.practitioner_id == p.id))
    await db.delete(p)
    await db.commit()


@router.post("/practitioners/{practitioner_id}/slots",
             response_model=dict, status_code=201)
async def add_slots(
    practitioner_id: str,
    body: schemas.AddSlotsRequest,
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    p: Practitioner | None = await db.get(Practitioner, practitioner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Practitioner not found")

    created = 0
    for slot_data in body.slots:
        slot_date = slot_data.get("slot_date", "")
        slot_time = slot_data.get("slot_time", "")
        if not slot_date or not slot_time:
            continue
        db.add(PractitionerSlot(
            practitioner_id=p.id,
            slot_date=slot_date,
            slot_time=slot_time,
        ))
        created += 1

    await db.commit()
    return {"created": created, "practitioner_id": str(practitioner_id)}


@router.delete("/practitioners/{practitioner_id}/slots/{slot_id}", status_code=204)
async def delete_slot(
    practitioner_id: str,
    slot_id: str,
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    slot: PractitionerSlot | None = await db.get(PractitionerSlot, slot_id)
    if not slot or str(slot.practitioner_id) != practitioner_id:
        raise HTTPException(status_code=404, detail="Slot not found")
    if slot.is_booked:
        raise HTTPException(status_code=409, detail="Cannot delete a booked slot")
    await db.delete(slot)
    await db.commit()
