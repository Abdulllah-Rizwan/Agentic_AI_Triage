from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

router = APIRouter(tags=["knowledge"])


@router.get("/version")
async def get_version(db: AsyncSession = Depends(get_db)):
    pass


@router.get("/index")
async def download_index():
    pass


@router.post("/query")
async def query_knowledge(body: dict, db: AsyncSession = Depends(get_db)):
    pass
