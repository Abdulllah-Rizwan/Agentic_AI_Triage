from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case as sa_case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import CurrentUser, require_admin
from app.models import schemas
from app.models.db import Case, Organization, OrgStatus, User

router = APIRouter(tags=["admin-organizations"])

# Status sort order: PENDING first, then ACTIVE, then SUSPENDED
_STATUS_ORDER = sa_case(
    (Organization.status == OrgStatus.PENDING_APPROVAL, 0),
    (Organization.status == OrgStatus.ACTIVE, 1),
    else_=2,
)


async def _get_org_or_404(org_id: str, db: AsyncSession) -> Organization:
    try:
        uid = UUID(org_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Organization not found")
    org = await db.get(Organization, uid)
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


# ── GET / ─────────────────────────────────────────────────────────────────────


@router.get("", response_model=schemas.OrganizationListResponse)
async def list_organizations(
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    user_count_sq = (
        select(func.count(User.id))
        .where(User.org_id == Organization.id)
        .correlate(Organization)
        .scalar_subquery()
    )

    case_count_sq = (
        select(func.count(Case.id))
        .where(Case.claimed_by_org_id == Organization.id)
        .correlate(Organization)
        .scalar_subquery()
    )

    rows = (
        await db.execute(
            select(
                Organization,
                user_count_sq.label("user_count"),
                case_count_sq.label("case_count"),
            ).order_by(_STATUS_ORDER, Organization.created_at.desc())
        )
    ).all()

    return schemas.OrganizationListResponse(
        organizations=[
            schemas.OrganizationListItem(
                id=org.id,
                name=org.name,
                type=org.type.value,
                status=org.status.value,
                access_code=org.access_code,
                user_count=user_count,
                case_count=case_count,
                created_at=org.created_at,
            )
            for org, user_count, case_count in rows
        ]
    )


# ── PATCH /{org_id}/approve ───────────────────────────────────────────────────


@router.patch("/{org_id}/approve", response_model=schemas.OrgApproveResponse)
async def approve_organization(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    _admin: CurrentUser = Depends(require_admin),
):
    org = await _get_org_or_404(org_id, db)

    if org.status != OrgStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=409,
            detail=f"Organization is not pending approval (current status: {org.status.value})",
        )

    org.status = OrgStatus.ACTIVE
    await db.commit()

    return schemas.OrgApproveResponse(
        org_id=org.id,
        status=OrgStatus.ACTIVE.value,
        message="Organization approved. Users can now log in.",
    )


# ── PATCH /{org_id}/suspend ───────────────────────────────────────────────────


@router.patch("/{org_id}/suspend", response_model=schemas.OrgSuspendResponse)
async def suspend_organization(
    org_id: str,
    body: schemas.OrgSuspendRequest,
    db: AsyncSession = Depends(get_db),
    admin: CurrentUser = Depends(require_admin),
):
    org = await _get_org_or_404(org_id, db)

    # Prevent an admin from suspending their own org (would lock everyone out)
    if org.id == admin.org_id:
        raise HTTPException(
            status_code=403,
            detail="You cannot suspend your own organization",
        )

    if org.status == OrgStatus.SUSPENDED:
        raise HTTPException(
            status_code=409,
            detail="Organization is already suspended",
        )

    org.status = OrgStatus.SUSPENDED
    await db.commit()

    return schemas.OrgSuspendResponse(
        org_id=org.id,
        status=OrgStatus.SUSPENDED.value,
    )
