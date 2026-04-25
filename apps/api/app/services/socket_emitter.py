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
    org_id: str | None,
) -> None:
    if _sio is None:
        return
    data = {
        "caseId": case_id,
        "triageLevel": triage_level,
        "lat": lat,
        "lng": lng,
        "chiefComplaint": chief_complaint,
    }
    if org_id:
        await _sio.emit("case:new", data, room=str(org_id))
    else:
        await _sio.emit("case:new", data)


async def emit_soap_ready(case_id: str, org_id: str | None) -> None:
    if _sio is None:
        return
    data = {"caseId": case_id}
    if org_id:
        await _sio.emit("case:soap_ready", data, room=str(org_id))
    else:
        await _sio.emit("case:soap_ready", data)


async def emit_case_claimed(case_id: str, claimed_by_org_name: str, org_id: str | None) -> None:
    if _sio is None:
        return
    data = {"caseId": case_id, "claimedByOrgName": claimed_by_org_name}
    if org_id:
        await _sio.emit("case:claimed", data, room=str(org_id))
    else:
        await _sio.emit("case:claimed", data)


async def emit_case_resolved(case_id: str, resolved_at: str, org_id: str | None) -> None:
    if _sio is None:
        return
    data = {"caseId": case_id, "resolvedAt": resolved_at}
    if org_id:
        await _sio.emit("case:resolved", data, room=str(org_id))
    else:
        await _sio.emit("case:resolved", data)


async def emit_kb_updated(new_version: int, document_count: int) -> None:
    if _sio is None:
        return
    await _sio.emit("kb:updated", {"newVersion": new_version, "documentCount": document_count})
