from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import (
    create_access_token,
    create_device_token,
    create_refresh_token,
    decode_refresh_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.models import schemas
from app.models.db import OrgStatus, OrgType, Organization, User

router = APIRouter(tags=["auth"])


@router.post("/register", response_model=schemas.RegisterResponse, status_code=201)
async def register(body: schemas.RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing_user = await db.scalar(select(User).where(User.email == body.email))
    if existing_user:
        raise HTTPException(status_code=409, detail="Email already registered")

    existing_org = await db.scalar(
        select(Organization).where(Organization.access_code == body.access_code)
    )
    if existing_org:
        raise HTTPException(status_code=409, detail="Access code already taken")

    try:
        org_type = OrgType(body.org_type)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid org_type: {body.org_type}")

    # Bootstrap: if no ACTIVE orgs exist yet, auto-approve so the first admin can log in
    active_org_count = await db.scalar(
        select(func.count(Organization.id)).where(Organization.status == OrgStatus.ACTIVE)
    )
    is_first_org = (active_org_count or 0) == 0
    initial_status = OrgStatus.ACTIVE if is_first_org else OrgStatus.PENDING_APPROVAL

    org = Organization(
        name=body.org_name,
        type=org_type,
        access_code=body.access_code,
        status=initial_status,
    )
    db.add(org)
    await db.flush()

    # First registration becomes the system ADMIN; all subsequent orgs get RESPONDER
    role = "ADMIN" if is_first_org else "RESPONDER"

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        role=role,
        org_id=org.id,
    )
    db.add(user)
    await db.commit()

    if is_first_org:
        message = "Registration successful. Your organization has been automatically approved — you can log in now."
    else:
        message = "Registration submitted. Awaiting admin approval before you can log in."

    return schemas.RegisterResponse(
        org_id=org.id,
        message=message,
    )


@router.post("/login", response_model=schemas.LoginResponse)
async def login(body: schemas.LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.email == body.email))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    org = await db.get(Organization, user.org_id)
    if org.status == OrgStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=403,
            detail="Your organization is pending admin approval. You cannot log in yet.",
        )
    if org.status == OrgStatus.SUSPENDED:
        raise HTTPException(
            status_code=403,
            detail="Your organization has been suspended. Contact the administrator.",
        )

    return schemas.LoginResponse(
        access_token=create_access_token(user.id, user.role, user.org_id),
        refresh_token=create_refresh_token(user.id),
        user=schemas.UserInfo(
            id=user.id,
            email=user.email,
            role=user.role,
            org_id=user.org_id,
            org_name=org.name,
            org_type=org.type.value,
        ),
    )


@router.post("/refresh", response_model=schemas.RefreshResponse)
async def refresh(body: schemas.RefreshRequest, db: AsyncSession = Depends(get_db)):
    user_id_str = decode_refresh_token(body.refresh_token)
    user = await db.get(User, UUID(user_id_str))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return schemas.RefreshResponse(
        access_token=create_access_token(user.id, user.role, user.org_id)
    )


@router.post("/device-register", response_model=schemas.DeviceRegisterResponse)
async def device_register(body: schemas.DeviceRegisterRequest):
    return schemas.DeviceRegisterResponse(
        device_token=create_device_token(body.device_id),
        expires_in_days=30,
    )


# ── Dev-only helpers (disabled in production) ────────────────────────────────

from app.core.config import settings  # noqa: E402


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="New password must be at least 8 characters")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=422, detail="New password must differ from current password")
    current_user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"message": "Password updated successfully"}


@router.get("/dev/users", include_in_schema=True, tags=["dev"])
async def dev_list_users(db: AsyncSession = Depends(get_db)):
    """DEV ONLY — lists all user emails + org status so you can recover forgotten credentials."""
    if not settings.is_development:
        raise HTTPException(status_code=404, detail="Not found")
    rows = (await db.execute(
        select(User.email, User.role, Organization.name, Organization.status)
        .join(Organization, User.org_id == Organization.id)
    )).all()
    return [
        {"email": r[0], "role": r[1], "org_name": r[2], "org_status": r[3]}
        for r in rows
    ]


class DevResetRequest(BaseModel):
    email: str
    new_password: str


@router.post("/dev/reset-password", include_in_schema=True, tags=["dev"])
async def dev_reset_password(body: DevResetRequest, db: AsyncSession = Depends(get_db)):
    """DEV ONLY — resets a user's password without auth (development environments only)."""
    if not settings.is_development:
        raise HTTPException(status_code=404, detail="Not found")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    user = await db.scalar(select(User).where(User.email == body.email))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"message": f"Password reset for {body.email}. You can now log in."}


class DevSetRoleRequest(BaseModel):
    email: str
    role: str  # ADMIN | RESPONDER | VIEWER


@router.post("/dev/set-role", include_in_schema=True, tags=["dev"])
async def dev_set_role(body: DevSetRoleRequest, db: AsyncSession = Depends(get_db)):
    """DEV ONLY — changes a user's role."""
    if not settings.is_development:
        raise HTTPException(status_code=404, detail="Not found")
    if body.role not in ("ADMIN", "RESPONDER", "VIEWER"):
        raise HTTPException(status_code=422, detail="role must be ADMIN, RESPONDER, or VIEWER")
    user = await db.scalar(select(User).where(User.email == body.email))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = body.role
    await db.commit()
    return {"message": f"{body.email} is now {body.role}"}
