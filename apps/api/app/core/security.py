from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db

ALGORITHM = "HS256"

# Token type values stored in the "type" claim
_TYPE_ACCESS = "access"
_TYPE_REFRESH = "refresh"
_TYPE_DEVICE = "device"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()


# ── Password helpers ──────────────────────────────────────────────────────────


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── Token creation ────────────────────────────────────────────────────────────


def _create_token(payload: dict, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {**payload, "iat": now, "exp": now + expires_delta}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGORITHM)


def create_access_token(user_id: UUID, role: str, org_id: UUID) -> str:
    return _create_token(
        {"sub": str(user_id), "role": role, "org_id": str(org_id), "type": _TYPE_ACCESS},
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )


def create_refresh_token(user_id: UUID) -> str:
    return _create_token(
        {"sub": str(user_id), "type": _TYPE_REFRESH},
        timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )


def create_device_token(device_id: str) -> str:
    return _create_token(
        {"sub": device_id, "type": _TYPE_DEVICE},
        timedelta(days=settings.DEVICE_TOKEN_EXPIRE_DAYS),
    )


# ── Token decoding ────────────────────────────────────────────────────────────


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


def decode_refresh_token(token: str) -> str:
    payload = _decode_token(token)
    if payload.get("type") != _TYPE_REFRESH:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not a refresh token")
    return payload["sub"]


def decode_device_token(token: str) -> str:
    payload = _decode_token(token)
    if payload.get("type") != _TYPE_DEVICE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not a device token")
    return payload["sub"]


# ── FastAPI dependencies ──────────────────────────────────────────────────────


class CurrentUser:
    def __init__(self, user_id: UUID, role: str, org_id: UUID):
        self.user_id = user_id
        self.role = role
        self.org_id = org_id


def _parse_dashboard_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> CurrentUser:
    payload = _decode_token(credentials.credentials)
    if payload.get("type") != _TYPE_ACCESS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not an access token")
    return CurrentUser(
        user_id=UUID(payload["sub"]),
        role=payload["role"],
        org_id=UUID(payload["org_id"]),
    )


def get_current_user(
    current_user: CurrentUser = Depends(_parse_dashboard_token),
) -> CurrentUser:
    return current_user


def require_admin(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_responder(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    if current_user.role not in ("ADMIN", "RESPONDER"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Responder or Admin access required",
        )
    return current_user


def get_device_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    return decode_device_token(credentials.credentials)
