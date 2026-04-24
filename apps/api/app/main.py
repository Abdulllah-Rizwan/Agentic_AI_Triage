import os

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.security import _decode_token
from app.routers import analytics, auth, cases, knowledge_base
from app.routers.admin import knowledge as admin_knowledge
from app.routers.admin import organizations as admin_orgs
from app.routers.admin import system as admin_system
from app.services import socket_emitter

# ── Socket.IO ─────────────────────────────────────────────────────────────────

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
socket_emitter.set_sio(sio)

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="MediReach API",
    version="1.0.0",
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.DASHBOARD_URL],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# ── Routers ───────────────────────────────────────────────────────────────────

# Public routes
app.include_router(auth.router,           prefix="/api/v1/auth")
app.include_router(cases.router,          prefix="/api/v1/cases")
app.include_router(analytics.router,      prefix="/api/v1/analytics")
app.include_router(knowledge_base.router, prefix="/api/v1/knowledge")

# Admin routes (role=ADMIN enforced inside each router)
app.include_router(admin_knowledge.router, prefix="/api/v1/admin/knowledge")
app.include_router(admin_orgs.router,      prefix="/api/v1/admin/organizations")
app.include_router(admin_system.router,    prefix="/api/v1/admin/system")

# ── Static file serving ───────────────────────────────────────────────────────

os.makedirs(settings.FAISS_EXPORT_DIR, exist_ok=True)
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

app.mount(
    "/exports",
    StaticFiles(directory=settings.FAISS_EXPORT_DIR),
    name="exports",
)

# ── Health check ──────────────────────────────────────────────────────────────


@app.get("/api/v1/health", tags=["utility"])
async def health_check():
    return {"status": "ok", "version": "1.0.0"}


# ── Socket.IO event handlers ──────────────────────────────────────────────────


@sio.event
async def connect(sid: str, environ: dict, auth: dict | None = None):
    """
    Validate the JWT passed in the auth object on connection.
    Disconnects unauthenticated clients immediately.
    """
    token = (auth or {}).get("token")
    if not token:
        return False  # reject connection

    try:
        payload = _decode_token(token)
        org_id = payload.get("org_id")
        if not org_id:
            return False
        # Store org_id in the session so join:org can reference it
        await sio.save_session(sid, {"org_id": org_id})
    except Exception:
        return False


@sio.event
async def disconnect(sid: str):
    pass


@sio.event
async def join_org(sid: str, data: dict):
    """
    Dashboard client emits join:org after connecting.
    Joins the room named after the org_id so broadcasts are scoped per org.
    """
    session = await sio.get_session(sid)
    org_id = session.get("org_id")
    if org_id:
        await sio.enter_room(sid, org_id)


# ── ASGI app (wraps FastAPI with Socket.IO) ───────────────────────────────────

socket_app = socketio.ASGIApp(sio, app)
