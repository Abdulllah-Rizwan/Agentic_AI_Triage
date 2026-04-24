from __future__ import annotations


_sio = None


def set_sio(sio) -> None:
    global _sio
    _sio = sio


async def emit_new_case(
    case_id: str,
    triage_level: str,
    lat: float,
    lng: float,
    chief_complaint: str,
    org_id: str,
) -> None:
    pass


async def emit_soap_ready(case_id: str, org_id: str) -> None:
    pass


async def emit_case_claimed(case_id: str, claimed_by: str, org_id: str) -> None:
    pass


async def emit_case_resolved(case_id: str, org_id: str) -> None:
    pass


async def emit_kb_updated(new_version: int, document_count: int) -> None:
    pass
