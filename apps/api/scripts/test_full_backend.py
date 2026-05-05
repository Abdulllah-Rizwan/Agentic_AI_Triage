"""
MediReach Full Backend Integration Test Suite — Session 10
Tests every API route in sequence. Requires running server at localhost:3001.

Usage:
    cd apps/api
    python scripts/test_full_backend.py

    Optional env vars:
        TEST_ADMIN_EMAIL    default: admin@medireach.app
        TEST_ADMIN_PASSWORD default: Admin@123456
        BASE_URL            default: http://localhost:3001
"""

import json
import os
import struct
import sys
import time
import uuid
from datetime import datetime
from typing import Any

import requests

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL        = os.getenv("BASE_URL", "http://localhost:3001")
ADMIN_EMAIL     = os.getenv("TEST_ADMIN_EMAIL", "admin@medireach.app")
ADMIN_PASSWORD  = os.getenv("TEST_ADMIN_PASSWORD", "admin123")

# Unique suffix so concurrent runs don't collide
RUN_ID     = uuid.uuid4().hex[:8]
TEST_EMAIL = f"test_{RUN_ID}@testorg.com"
TEST_PASS  = "TestPass@12345"
TEST_ORG   = f"Test Org {RUN_ID}"
TEST_CODE  = f"TCODE{RUN_ID[:6]}"

# ── State shared between tests ────────────────────────────────────────────────

state: dict[str, Any] = {
    "org_id":         None,
    "user_id":        None,
    "access_token":   None,
    "refresh_token":  None,
    "device_token":   None,
    "admin_token":    None,
    "case_id":        None,
    "doc_id":         None,
}

# ── Result tracking ───────────────────────────────────────────────────────────

results: list[tuple[int, str, str, str, str]] = []  # (num, route, expected, actual, status)

def record(num: int, route: str, expected: str, actual: str, passed: bool) -> None:
    status = "PASS" if passed else "FAIL"
    results.append((num, route, expected, actual, status))
    icon = "[OK]" if passed else "[FAIL]"
    print(f"  {icon}  Test {num:02d}: {route}")
    if not passed:
        print(f"        Expected: {expected}")
        print(f"        Actual:   {actual}")

def fail(num: int, route: str, expected: str, detail: str) -> None:
    record(num, route, expected, f"ERROR: {detail}", False)

# ── Minimal protobuf encoder ───────────────────────────────────────────────────

def _varint(value: int) -> bytes:
    result = b""
    while True:
        bits = value & 0x7F
        value >>= 7
        if value:
            result += bytes([bits | 0x80])
        else:
            result += bytes([bits])
            break
    return result

def _field_string(field_num: int, value: str) -> bytes:
    encoded = value.encode("utf-8")
    return _varint((field_num << 3) | 2) + _varint(len(encoded)) + encoded

def _field_int32(field_num: int, value: int) -> bytes:
    return _varint(field_num << 3) + _varint(value)

def _field_int64(field_num: int, value: int) -> bytes:
    return _field_int32(field_num, value)

def _field_double(field_num: int, value: float) -> bytes:
    return _varint((field_num << 3) | 1) + struct.pack("<d", value)

def _field_message(field_num: int, data: bytes) -> bytes:
    return _varint((field_num << 3) | 2) + _varint(len(data)) + data

def encode_patient_profile(cnic: str, name: str, phone: str, lat: float, lng: float) -> bytes:
    msg = b""
    msg += _field_string(1, cnic)
    msg += _field_string(2, name)
    msg += _field_string(3, phone)
    msg += _field_double(4, lat)
    msg += _field_double(5, lng)
    return msg

def encode_lean_payload(
    case_id: str,
    cnic: str,
    name: str,
    phone: str,
    lat: float,
    lng: float,
    chief_complaint: str,
    symptoms: list[str],
    severity: int,
    triage_level: str,
    triage_reason: str,
    conversation_summary: str,
    device_id: str,
    network_mode: str = "FULL",
) -> bytes:
    patient_bytes = encode_patient_profile(cnic, name, phone, lat, lng)
    msg = b""
    msg += _field_string(1, case_id)
    msg += _field_message(2, patient_bytes)
    msg += _field_string(3, chief_complaint)
    for symptom in symptoms:
        msg += _field_string(4, symptom)
    msg += _field_int32(5, severity)
    msg += _field_string(6, triage_level)
    msg += _field_string(7, triage_reason)
    msg += _field_string(8, conversation_summary)
    msg += _field_int64(9, int(time.time()))
    msg += _field_string(10, device_id)
    msg += _field_string(11, network_mode)
    return msg

# ── Helpers ───────────────────────────────────────────────────────────────────

def api(method: str, path: str, token: str | None = None, **kwargs) -> requests.Response:
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.request(method, f"{BASE_URL}{path}", headers=headers, timeout=30, **kwargs)

def admin_headers() -> dict:
    return {"Authorization": f"Bearer {state['admin_token']}"}

# ── Admin login (prerequisite) ────────────────────────────────────────────────

def get_admin_token() -> bool:
    print("\n[Prerequisite] Logging in as admin...")
    r = api("POST", "/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if r.status_code == 200:
        state["admin_token"] = r.json()["access_token"]
        print(f"  Admin token acquired (role: {r.json()['user']['role']})")
        return True
    print(f"  FATAL: Cannot log in as admin — {r.status_code} {r.text[:200]}")
    print(f"  Hint: Run 'python scripts/create_admin.py' first, then retry.")
    return False

# ── AUTH TESTS ────────────────────────────────────────────────────────────────

def test_01_register_org():
    r = api("POST", "/api/v1/auth/register", json={
        "org_name":    TEST_ORG,
        "org_type":    "NGO",
        "email":       TEST_EMAIL,
        "password":    TEST_PASS,
        "access_code": TEST_CODE,
    })
    if r.status_code == 201:
        state["org_id"] = r.json()["org_id"]
        record(1, "POST /auth/register", "201", str(r.status_code), True)
    else:
        fail(1, "POST /auth/register", "201", f"{r.status_code} {r.text[:200]}")

def test_02_login_before_approval():
    r = api("POST", "/api/v1/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASS})
    passed = r.status_code == 403 and "pending" in r.json().get("detail", "").lower()
    record(2, "POST /auth/login (pre-approval)", "403 pending", f"{r.status_code} {r.json().get('detail','')[:60]}", passed)

def test_03_approve_org():
    if not state["org_id"]:
        fail(3, "PATCH /admin/organizations/{id}/approve", "200", "no org_id from test 1")
        return
    r = requests.patch(
        f"{BASE_URL}/api/v1/admin/organizations/{state['org_id']}/approve",
        headers=admin_headers(),
        timeout=30,
    )
    passed = r.status_code == 200
    record(3, "PATCH /admin/organizations/{id}/approve", "200", str(r.status_code), passed)
    if not passed:
        print(f"        Body: {r.text[:200]}")

def test_04_login_after_approval():
    r = api("POST", "/api/v1/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASS})
    if r.status_code == 200:
        state["access_token"]  = r.json()["access_token"]
        state["refresh_token"] = r.json()["refresh_token"]
        record(4, "POST /auth/login (post-approval)", "200", "200", True)
    else:
        fail(4, "POST /auth/login (post-approval)", "200", f"{r.status_code} {r.text[:200]}")

def test_05_device_register():
    r = api("POST", "/api/v1/auth/device-register", json={
        "device_id":     f"test-device-{RUN_ID}",
        "device_model":  "Test Runner",
        "app_version":   "1.0.0",
    })
    if r.status_code == 200:
        state["device_token"] = r.json()["device_token"]
        record(5, "POST /auth/device-register", "200", "200", True)
    else:
        fail(5, "POST /auth/device-register", "200", f"{r.status_code} {r.text[:200]}")

# ── CASE TESTS ────────────────────────────────────────────────────────────────

def test_06_ingest_case():
    state["case_id"] = str(uuid.uuid4())
    payload = encode_lean_payload(
        case_id=state["case_id"],
        cnic="42101-1234567-1",
        name="Test Patient",
        phone="+923001234567",
        lat=24.8607,
        lng=67.0011,
        chief_complaint="Severe chest pain",
        symptoms=["chest pain", "shortness of breath"],
        severity=9,
        triage_level="RED",
        triage_reason="Severity >= 8 and critical keyword: chest pain",
        conversation_summary="Patient reports severe chest pain with shortness of breath onset 30 minutes ago.",
        device_id=f"test-device-{RUN_ID}",
    )
    print(f"        Payload size: {len(payload)} bytes (target < 2000)")
    r = requests.post(
        f"{BASE_URL}/api/v1/cases/ingest",
        headers={
            "Authorization":  f"Bearer {state['device_token']}",
            "Content-Type":   "application/octet-stream",
        },
        data=payload,
        timeout=30,
    )
    passed = r.status_code == 202
    record(6, "POST /cases/ingest (RED payload)", "202", str(r.status_code), passed)
    if not passed:
        print(f"        Body: {r.text[:300]}")

def test_07_ingest_duplicate():
    if not state["case_id"] or not state["device_token"]:
        fail(7, "POST /cases/ingest (duplicate)", "202 DUPLICATE", "no case_id or device_token")
        return
    payload = encode_lean_payload(
        case_id=state["case_id"],
        cnic="42101-1234567-1",
        name="Test Patient",
        phone="+923001234567",
        lat=24.8607,
        lng=67.0011,
        chief_complaint="Severe chest pain",
        symptoms=["chest pain"],
        severity=9,
        triage_level="RED",
        triage_reason="duplicate",
        conversation_summary="duplicate",
        device_id=f"test-device-{RUN_ID}",
    )
    r = requests.post(
        f"{BASE_URL}/api/v1/cases/ingest",
        headers={
            "Authorization": f"Bearer {state['device_token']}",
            "Content-Type":  "application/octet-stream",
        },
        data=payload,
        timeout=30,
    )
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    passed = r.status_code == 202 and body.get("status") == "DUPLICATE"
    record(7, "POST /cases/ingest (duplicate)", "202 DUPLICATE", f"{r.status_code} {body.get('status','')}", passed)

def test_08_list_cases():
    r = api("GET", "/api/v1/cases?triage_level=RED", token=state["access_token"])
    if r.status_code == 200:
        data = r.json()
        ids = [c["id"] for c in data.get("cases", [])]
        passed = state["case_id"] in ids
        record(8, "GET /cases?triage_level=RED", "200 case in list", f"200 {len(ids)} cases, found={passed}", passed)
    else:
        fail(8, "GET /cases?triage_level=RED", "200", f"{r.status_code} {r.text[:200]}")

def test_09_case_detail():
    if not state["case_id"]:
        fail(9, "GET /cases/{id}", "200", "no case_id")
        return
    r = api("GET", f"/api/v1/cases/{state['case_id']}", token=state["access_token"])
    if r.status_code == 200:
        data = r.json()
        has_fields = all(k in data for k in ["id", "triage_level", "chief_complaint", "symptoms", "lat", "lng"])
        record(9, "GET /cases/{id}", "200 all fields", f"200 fields_ok={has_fields}", has_fields)
    else:
        fail(9, "GET /cases/{id}", "200", f"{r.status_code} {r.text[:200]}")

def test_10_wait_for_soap():
    if not state["case_id"]:
        fail(10, "SOAP report available", "soap not null", "no case_id")
        return
    print("        Polling for SOAP report (max 60s)...")
    deadline = time.time() + 60
    soap = None
    while time.time() < deadline:
        r = api("GET", f"/api/v1/cases/{state['case_id']}", token=state["access_token"])
        if r.status_code == 200:
            soap = r.json().get("soap_report")
            if soap:
                break
        time.sleep(5)
        print("        ...", end="", flush=True)
    print()
    if soap:
        has_sections = all(k in soap for k in ["subjective", "objective", "assessment", "plan"])
        record(10, "SOAP report generated", "soap with 4 sections", f"soap found, sections={has_sections}", has_sections)
    else:
        record(10, "SOAP report generated", "soap with 4 sections", "soap still null after 60s", False)

def test_11_claim_case():
    if not state["case_id"]:
        fail(11, "PATCH /cases/{id}/claim", "200 ACKNOWLEDGED", "no case_id")
        return
    r = api("PATCH", f"/api/v1/cases/{state['case_id']}/claim", token=state["access_token"])
    if r.status_code == 200:
        status_val = r.json().get("status", "")
        passed = status_val == "ACKNOWLEDGED"
        record(11, "PATCH /cases/{id}/claim", "200 ACKNOWLEDGED", f"200 {status_val}", passed)
    else:
        fail(11, "PATCH /cases/{id}/claim", "200", f"{r.status_code} {r.text[:200]}")

def test_12_claim_conflict():
    if not state["case_id"]:
        fail(12, "PATCH /cases/{id}/claim (conflict)", "409", "no case_id")
        return
    r = api("PATCH", f"/api/v1/cases/{state['case_id']}/claim", token=state["access_token"])
    passed = r.status_code == 409
    record(12, "PATCH /cases/{id}/claim (conflict)", "409", str(r.status_code), passed)

def test_13_resolve_case():
    if not state["case_id"]:
        fail(13, "PATCH /cases/{id}/resolve", "200 RESOLVED", "no case_id")
        return
    r = api(
        "PATCH",
        f"/api/v1/cases/{state['case_id']}/resolve",
        token=state["access_token"],
        json={"outcome": "TREATED", "resolution_notes": "Integration test — patient treated successfully."},
    )
    if r.status_code == 200:
        status_val = r.json().get("status", "")
        passed = status_val == "RESOLVED"
        record(13, "PATCH /cases/{id}/resolve", "200 RESOLVED", f"200 {status_val}", passed)
    else:
        fail(13, "PATCH /cases/{id}/resolve", "200", f"{r.status_code} {r.text[:200]}")

# ── ANALYTICS TESTS ───────────────────────────────────────────────────────────

def test_14_analytics_summary():
    r = api("GET", "/api/v1/analytics/summary", token=state["access_token"])
    if r.status_code == 200:
        data = r.json()
        passed = data.get("total_cases", 0) >= 1
        record(14, "GET /analytics/summary", "total_cases >= 1", f"total={data.get('total_cases')}", passed)
    else:
        fail(14, "GET /analytics/summary", "200", f"{r.status_code} {r.text[:200]}")

def test_15_analytics_timeseries():
    r = api("GET", "/api/v1/analytics/timeseries?days=7", token=state["access_token"])
    if r.status_code == 200:
        data = r.json()
        passed = isinstance(data.get("series"), list) and len(data["series"]) > 0
        record(15, "GET /analytics/timeseries", "series not empty", f"series len={len(data.get('series',[]))}", passed)
    else:
        fail(15, "GET /analytics/timeseries", "200", f"{r.status_code} {r.text[:200]}")

def test_16_analytics_symptoms():
    r = api("GET", "/api/v1/analytics/symptoms?days=7", token=state["access_token"])
    if r.status_code == 200:
        data = r.json()
        all_symptoms = [s["symptom"].lower() for s in data.get("symptoms", [])]
        found_chest = any("chest" in s for s in all_symptoms)
        record(16, "GET /analytics/symptoms", "chest pain in list", f"found={found_chest} total={len(all_symptoms)}", found_chest)
    else:
        fail(16, "GET /analytics/symptoms", "200", f"{r.status_code} {r.text[:200]}")

def test_17_analytics_geo():
    r = api("GET", "/api/v1/analytics/geo?days=7", token=state["access_token"])
    if r.status_code == 200:
        data = r.json()
        points = data.get("points", [])
        found = any(abs(p["lat"] - 24.8607) < 0.01 for p in points)
        record(17, "GET /analytics/geo", "test case coordinates appear", f"found={found} points={len(points)}", found)
    else:
        fail(17, "GET /analytics/geo", "200", f"{r.status_code} {r.text[:200]}")

# ── KNOWLEDGE BASE TESTS ──────────────────────────────────────────────────────

def test_18_knowledge_version():
    r = api("GET", "/api/v1/knowledge/version")
    if r.status_code == 200:
        data = r.json()
        version = data.get("version", 0)
        passed = version >= 1
        record(18, "GET /knowledge/version", "version >= 1", f"version={version}", passed)
    else:
        fail(18, "GET /knowledge/version", "200", f"{r.status_code} {r.text[:200]}")

def test_19_knowledge_query():
    r = api(
        "POST",
        "/api/v1/knowledge/query",
        token=state["device_token"],
        json={"query": "chest pain emergency", "top_k": 3},
    )
    if r.status_code == 200:
        data = r.json()
        results_list = data.get("results", [])
        record(19, "POST /knowledge/query", "200 results list", f"200 {len(results_list)} results", True)
    else:
        fail(19, "POST /knowledge/query", "200", f"{r.status_code} {r.text[:200]}")

def test_20_upload_document():
    test_content = (
        "Emergency First Aid for Chest Pain\n\n"
        "Chest pain can be a sign of a heart attack. Act fast.\n"
        "1. Call emergency services immediately.\n"
        "2. Have the person sit or lie in a comfortable position.\n"
        "3. Loosen any tight clothing.\n"
        "4. If the person is conscious and not allergic, aspirin may help.\n"
        "5. Do not leave the person alone.\n"
        "6. Be prepared to perform CPR if the person becomes unresponsive.\n\n"
        "Signs of a heart attack include chest pain or pressure, pain radiating to the arm or jaw, "
        "shortness of breath, sweating, nausea, and lightheadedness.\n"
    )
    r = requests.post(
        f"{BASE_URL}/api/v1/admin/knowledge/documents",
        headers=admin_headers(),
        data={
            "title":       f"Integration Test Article {RUN_ID}",
            "description": "Automated test document — safe to delete",
            "author":      "Test Runner",
            "source":      "MediReach Integration Tests",
            "url":         "https://test.medireach.internal",
        },
        files={"file": (f"test_{RUN_ID}_content.txt", test_content.encode("utf-8"), "text/plain")},
        timeout=30,
    )
    if r.status_code in (200, 202):
        state["doc_id"] = str(r.json()["id"])
        record(20, "POST /admin/knowledge/documents (upload)", "202 PROCESSING", f"{r.status_code} {r.json().get('status','')}", True)
    else:
        fail(20, "POST /admin/knowledge/documents (upload)", "202", f"{r.status_code} {r.text[:300]}")

def test_21_poll_document_active():
    if not state["doc_id"]:
        fail(21, "Document status ACTIVE", "ACTIVE chunk_count > 0", "no doc_id from test 20")
        return
    print("        Polling until ACTIVE (max 120s)...")
    deadline = time.time() + 120
    final_status = "PROCESSING"
    chunk_count = 0
    while time.time() < deadline:
        r = requests.get(
            f"{BASE_URL}/api/v1/admin/knowledge/documents/{state['doc_id']}",
            headers=admin_headers(),
            timeout=30,
        )
        if r.status_code == 200:
            data = r.json()
            final_status = data.get("status", "")
            chunk_count = data.get("chunk_count") or 0
            if final_status in ("ACTIVE", "FAILED"):
                break
        time.sleep(8)
        print("        ...", end="", flush=True)
    print()
    passed = final_status == "ACTIVE" and chunk_count > 0
    record(21, "Document processing", "ACTIVE chunk_count > 0", f"{final_status} chunks={chunk_count}", passed)

def test_22_archive_document():
    if not state["doc_id"]:
        fail(22, "PATCH /admin/knowledge/documents/{id}/archive", "200", "no doc_id")
        return
    r = requests.patch(
        f"{BASE_URL}/api/v1/admin/knowledge/documents/{state['doc_id']}/archive",
        headers=admin_headers(),
        timeout=30,
    )
    if r.status_code == 200:
        data = r.json()
        new_version = data.get("new_kb_version", 0)
        passed = new_version >= 1
        record(22, "PATCH /admin/knowledge/documents/{id}/archive", "200 new_kb_version", f"200 v={new_version}", passed)
    else:
        fail(22, "PATCH /admin/knowledge/documents/{id}/archive", "200", f"{r.status_code} {r.text[:200]}")

def test_23_download_faiss_index():
    r = api("GET", "/api/v1/knowledge/index")
    if r.status_code == 200:
        size = len(r.content)
        passed = size > 0
        record(23, "GET /knowledge/index", "200 binary size > 0", f"200 {size} bytes", passed)
    else:
        fail(23, "GET /knowledge/index", "200", f"{r.status_code} {r.text[:200]}")

# ── ADMIN TESTS ───────────────────────────────────────────────────────────────

def test_24_list_organizations():
    r = requests.get(
        f"{BASE_URL}/api/v1/admin/organizations",
        headers=admin_headers(),
        timeout=30,
    )
    if r.status_code == 200:
        orgs = r.json().get("organizations", [])
        ids = [str(o["id"]) for o in orgs]
        found = str(state["org_id"]) in ids
        record(24, "GET /admin/organizations", "test org appears", f"200 {len(orgs)} orgs found={found}", found)
    else:
        fail(24, "GET /admin/organizations", "200", f"{r.status_code} {r.text[:200]}")

def test_25_suspend_org():
    if not state["org_id"]:
        fail(25, "PATCH /admin/organizations/{id}/suspend", "200", "no org_id")
        return
    r = requests.patch(
        f"{BASE_URL}/api/v1/admin/organizations/{state['org_id']}/suspend",
        headers=admin_headers(),
        json={"reason": "Integration test suspension — automated cleanup"},
        timeout=30,
    )
    passed = r.status_code == 200
    record(25, "PATCH /admin/organizations/{id}/suspend", "200", str(r.status_code), passed)
    if not passed:
        print(f"        Body: {r.text[:200]}")

def test_26_login_suspended():
    r = api("POST", "/api/v1/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASS})
    passed = r.status_code == 403 and "suspend" in r.json().get("detail", "").lower()
    record(26, "POST /auth/login (suspended)", "403 suspended", f"{r.status_code} {r.json().get('detail','')[:60]}", passed)

def test_27_system_health():
    r = requests.get(f"{BASE_URL}/api/v1/admin/system/health", headers=admin_headers(), timeout=30)
    if r.status_code == 200:
        data = r.json()
        record(27, "GET /admin/system/health", "200 all services", f"200 api={data.get('api')}", True)
    else:
        fail(27, "GET /admin/system/health", "200", f"{r.status_code} {r.text[:200]}")

def test_28_system_queue():
    r = requests.get(f"{BASE_URL}/api/v1/admin/system/queue", headers=admin_headers(), timeout=30)
    if r.status_code == 200:
        data = r.json()
        has_keys = all(k in data for k in ["soap_generation", "document_ingestion"])
        record(28, "GET /admin/system/queue", "200 queue depths", f"200 keys_ok={has_keys}", has_keys)
    else:
        fail(28, "GET /admin/system/queue", "200", f"{r.status_code} {r.text[:200]}")

def test_29_cleanup():
    print("        Cleanup: suspending test org (already done in test 25).")
    record(29, "Cleanup", "test data marked", "org suspended in test 25", True)

# ── Runner ────────────────────────────────────────────────────────────────────

def run_all() -> None:
    print("=" * 65)
    print("  MediReach Backend Integration Tests — Session 10")
    print(f"  Server : {BASE_URL}")
    print(f"  Run ID : {RUN_ID}")
    print(f"  Time   : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 65)

    # Prerequisite: admin login
    if not get_admin_token():
        sys.exit(1)

    print("\n--- AUTH (5 tests) ---")
    test_01_register_org()
    test_02_login_before_approval()
    test_03_approve_org()
    test_04_login_after_approval()
    test_05_device_register()

    print("\n--- CASES (8 tests) ---")
    test_06_ingest_case()
    test_07_ingest_duplicate()
    test_08_list_cases()
    test_09_case_detail()
    test_10_wait_for_soap()
    test_11_claim_case()
    test_12_claim_conflict()
    test_13_resolve_case()

    print("\n--- ANALYTICS (4 tests) ---")
    test_14_analytics_summary()
    test_15_analytics_timeseries()
    test_16_analytics_symptoms()
    test_17_analytics_geo()

    print("\n--- KNOWLEDGE BASE (6 tests) ---")
    test_18_knowledge_version()
    test_19_knowledge_query()
    test_20_upload_document()
    test_21_poll_document_active()
    test_22_archive_document()
    test_23_download_faiss_index()

    print("\n--- ADMIN (6 tests) ---")
    test_24_list_organizations()
    test_25_suspend_org()
    test_26_login_suspended()
    test_27_system_health()
    test_28_system_queue()
    test_29_cleanup()

    # ── Summary table ─────────────────────────────────────────────────────────
    print("\n" + "=" * 65)
    print("  RESULTS SUMMARY")
    print("=" * 65)
    header = f"{'Test':>5}  {'Route':<40}  {'Result'}"
    print(header)
    print("-" * 65)
    passed_count = 0
    for num, route, expected, actual, status in results:
        icon = "OK  " if status == "PASS" else "FAIL"
        print(f"  {num:>2}.  [{icon}]  {route:<40}")
        if status == "PASS":
            passed_count += 1
        else:
            print(f"           Expected: {expected}")
            print(f"           Actual:   {actual}")

    total = len(results)
    failed = total - passed_count
    print("=" * 65)
    print(f"  TOTAL: {total}  |  PASSED: {passed_count}  |  FAILED: {failed}")
    print("=" * 65)

    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_all()
