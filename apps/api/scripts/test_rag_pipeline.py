"""
End-to-end RAG pipeline test.

Steps:
  A — Upload a sample .txt document via POST /admin/knowledge/documents
  B — Poll GET /admin/knowledge/documents/{id} until status is ACTIVE or FAILED
  C — GET /knowledge/version  (check version + chunk count)
  D — POST /knowledge/query   (semantic search)
  E — GET /knowledge/index    (download FAISS binary)

Requires:
  TEST_ADMIN_TOKEN  env var — a valid admin dashboard JWT
  TEST_BASE_URL     env var — API base URL (default: http://localhost:3001)

Usage:
  TEST_ADMIN_TOKEN=<token> python scripts/test_rag_pipeline.py
"""

import io
import os
import sys
import tempfile
import time
import uuid as _uuid

import httpx

BASE_URL = os.getenv("TEST_BASE_URL", "http://localhost:3001")
TOKEN    = os.getenv("TEST_ADMIN_TOKEN", "")

if not TOKEN:
    sys.exit("TEST_ADMIN_TOKEN is not set.  Export it before running this script.")

HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# Register a throwaway device so we have a device_jwt for the /query endpoint
_device_resp = httpx.post(
    f"{BASE_URL}/api/v1/auth/device-register",
    json={"device_id": "test-device-pipeline-01", "device_model": "Test Runner", "app_version": "0.0.1"},
    timeout=10,
)
if _device_resp.status_code != 200:
    sys.exit(f"Could not register test device: HTTP {_device_resp.status_code}\n{_device_resp.text}")
DEVICE_HEADERS = {"Authorization": f"Bearer {_device_resp.json()['device_token']}"}

SAMPLE_TEXT = """\
Earthquake First Aid Guidelines

When an earthquake occurs, immediate medical response is critical.
Assess the scene for ongoing hazards before approaching victims.

Crush Injuries:
Crush syndrome occurs when large muscle groups are compressed for extended
periods.  Do not rapidly remove debris from a victim who has been trapped
for more than 15 minutes without IV access available.  Reperfusion can
trigger fatal cardiac arrhythmias.

Bleeding Control:
Apply direct pressure to all external bleeding wounds.  For limb haemorrhage
uncontrolled by direct pressure, apply a tourniquet 5-7 cm above the wound.
Note the application time clearly on the patient.

Spinal Precautions:
Any victim found unconscious or complaining of neck/back pain after structural
collapse should be treated as a potential spinal injury.  Maintain inline
cervical stabilisation during extrication.

Triage Priorities:
RED  — airway compromise, uncontrolled haemorrhage, altered consciousness
AMBER — fractures, lacerations requiring closure, stable chest injuries
GREEN — minor injuries, ambulatory patients
"""


def _sep(title: str) -> None:
    print(f"\n{'-' * 60}")
    print(f"  {title}")
    print(f"{'-' * 60}")


# ── Step A: Upload ────────────────────────────────────────────────────────────

_sep("Step A — Upload test document")

upload_response = httpx.post(
    f"{BASE_URL}/api/v1/admin/knowledge/documents",
    headers=HEADERS,
    data={
        "title":       "Earthquake First Aid Guidelines (Test)",
        "author":      "MediReach Test Suite",
        "source":      "Test",
        "url":         "http://test.local/earthquake",
        "description": "Automated test document — safe to delete",
    },
    files={
        "file": (f"earthquake_test_{_uuid.uuid4().hex[:8]}.txt", io.BytesIO(SAMPLE_TEXT.encode()), "text/plain"),
    },
    timeout=30,
)

if upload_response.status_code != 202:
    print(f"FAILED  HTTP {upload_response.status_code}")
    print(upload_response.text)
    sys.exit(1)

upload_data = upload_response.json()
doc_id = upload_data["id"]
print(f"OK  document_id = {doc_id}")
print(f"    status      = {upload_data['status']}")
print(f"    title       = {upload_data['title']}")


# ── Step B: Poll until ACTIVE / FAILED ───────────────────────────────────────

_sep("Step B — Poll until ACTIVE (timeout 120 s)")

POLL_INTERVAL = 3
TIMEOUT       = 120
elapsed       = 0
final_status  = None

while elapsed < TIMEOUT:
    time.sleep(POLL_INTERVAL)
    elapsed += POLL_INTERVAL

    poll_response = httpx.get(
        f"{BASE_URL}/api/v1/admin/knowledge/documents/{doc_id}",
        headers=HEADERS,
        timeout=10,
    )
    poll_data    = poll_response.json()
    final_status = poll_data["status"]
    chunk_count  = poll_data.get("chunk_count")
    print(f"  [{elapsed:>3}s]  status={final_status}  chunks={chunk_count}")

    if final_status in ("ACTIVE", "FAILED"):
        break

if final_status == "ACTIVE":
    print(f"\nOK  document is ACTIVE with {poll_data['chunk_count']} chunks")
elif final_status == "FAILED":
    print(f"\nFAILED  error_message: {poll_data.get('error_message')}")
    sys.exit(1)
else:
    print(f"\nTIMEOUT — document still in {final_status} after {TIMEOUT}s")
    print("Is the Celery worker running?  celery -A app.workers.celery_app worker --loglevel=info")
    sys.exit(1)


# ── Step C: Version check ─────────────────────────────────────────────────────

_sep("Step C — Knowledge base version")

version_response = httpx.get(
    f"{BASE_URL}/api/v1/knowledge/version",
    timeout=10,
)

if version_response.status_code != 200:
    print(f"FAILED  HTTP {version_response.status_code}")
    print(version_response.text)
    sys.exit(1)

ver_data = version_response.json()
print(f"OK  version        = {ver_data['version']}")
print(f"    document_count = {ver_data['document_count']}")
print(f"    chunk_count    = {ver_data['chunk_count']}")
print(f"    updated_at     = {ver_data['updated_at']}")


# ── Step D: RAG query ─────────────────────────────────────────────────────────

_sep("Step D — RAG query")

query_response = httpx.post(
    f"{BASE_URL}/api/v1/knowledge/query",
    headers=DEVICE_HEADERS,
    json={"query": "patient with chest pain and difficulty breathing", "top_k": 3},
    timeout=30,
)

if query_response.status_code != 200:
    print(f"FAILED  HTTP {query_response.status_code}")
    print(query_response.text)
    sys.exit(1)

query_data = query_response.json()
results    = query_data.get("results", [])
print(f"OK  {len(results)} result(s) returned\n")

for i, r in enumerate(results, 1):
    print(f"  [{i}] relevance_score : {r['relevance_score']}")
    print(f"      article_title   : {r['article_title']}")
    print(f"      content snippet : {r['content'][:120].replace(chr(10), ' ')} …")
    print()


# ── Step E: FAISS index download ──────────────────────────────────────────────

_sep("Step E — Download FAISS index binary")

index_response = httpx.get(
    f"{BASE_URL}/api/v1/knowledge/index",
    timeout=60,
)

if index_response.status_code != 200:
    print(f"FAILED  HTTP {index_response.status_code}")
    print(index_response.text)
    sys.exit(1)

with tempfile.NamedTemporaryFile(suffix=".faiss", delete=False) as tmp:
    tmp.write(index_response.content)
    tmp_path = tmp.name

size_kb = os.path.getsize(tmp_path) / 1024
os.unlink(tmp_path)

print(f"OK  downloaded {size_kb:.1f} KB")
print(f"    Content-Type        : {index_response.headers.get('content-type')}")
print(f"    Content-Disposition : {index_response.headers.get('content-disposition')}")

# ── Summary ───────────────────────────────────────────────────────────────────

_sep("All steps passed")
print(f"  Document uploaded and indexed : {doc_id}")
print(f"  KB version after upload       : {ver_data['version']}")
print(f"  RAG results returned          : {len(results)}")
print(f"  FAISS index download size     : {size_kb:.1f} KB")
print()
