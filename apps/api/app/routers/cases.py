from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import schemas

router = APIRouter(tags=["cases"])


@router.post("/ingest", response_model=schemas.CaseIngestResponse, status_code=202)
async def ingest_case(request: Request, db: AsyncSession = Depends(get_db)):
    pass


@router.get("", response_model=schemas.CaseListResponse)
async def list_cases(
    triage_level: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    sort: str = "received_at:desc",
    db: AsyncSession = Depends(get_db),
):
    pass


@router.get("/{case_id}", response_model=schemas.CaseDetailResponse)
async def get_case(case_id: str, db: AsyncSession = Depends(get_db)):
    pass


@router.patch("/{case_id}/claim")
async def claim_case(case_id: str, db: AsyncSession = Depends(get_db)):
    pass


@router.patch("/{case_id}/resolve")
async def resolve_case(case_id: str, body: schemas.ResolveRequest, db: AsyncSession = Depends(get_db)):
    pass
