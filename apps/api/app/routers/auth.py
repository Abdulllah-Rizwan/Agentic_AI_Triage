from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import (
    create_access_token,
    create_device_token,
    create_refresh_token,
    decode_refresh_token,
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

    org = Organization(
        name=body.org_name,
        type=org_type,
        access_code=body.access_code,
        status=OrgStatus.PENDING_APPROVAL,
    )
    db.add(org)
    await db.flush()

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        role="ADMIN",
        org_id=org.id,
    )
    db.add(user)
    await db.commit()

    return schemas.RegisterResponse(
        org_id=org.id,
        message="Registration submitted. Awaiting admin approval before you can log in.",
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
