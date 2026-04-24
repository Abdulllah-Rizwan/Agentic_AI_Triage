from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import schemas

router = APIRouter(tags=["auth"])


@router.post("/register", status_code=201)
async def register(body: schemas.RegisterRequest, db: AsyncSession = Depends(get_db)):
    pass


@router.post("/login", response_model=schemas.LoginResponse)
async def login(body: schemas.LoginRequest, db: AsyncSession = Depends(get_db)):
    pass


@router.post("/refresh", response_model=schemas.RefreshResponse)
async def refresh(body: schemas.RefreshRequest):
    pass


@router.post("/device-register", response_model=schemas.DeviceRegisterResponse)
async def device_register(body: schemas.DeviceRegisterRequest, db: AsyncSession = Depends(get_db)):
    pass
