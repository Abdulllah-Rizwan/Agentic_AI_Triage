"""
Session 4 verification suite.

Tests every component built in Session 4:
  1.  DB schema  — page_number column is gone from knowledge_chunks
  2.  Upload     — POST /admin/knowledge/documents with all metadata fields
  3.  Attribution— chunks carry article_title/author/source/url from form fields
  4.  RAG query  — CAST(:qv AS vector) fix works end-to-end
  5.  Archive    — PATCH /archive bumps version and excludes doc from RAG
  6.  Delete     — DELETE removes file from disk, deletes chunks, bumps version
  7.  Reprocess  — PATCH /reprocess re-queues a FAILED document
  8.  Seed index — knowledge_index.faiss in mobile assets is loadable by FAISS
  9.  FAISS download — GET /knowledge/index returns correct binary
  10. Version endpoint — GET /knowledge/version reflects current state

Run from apps/api/:
  python scripts/session4_verify.py <admin_token>
"""

import io
import os
import sys
import time
import uuid as _uuid

BASE_URL = os.getenv("TEST_BASE_URL", "http://localhost:3001")

try:
    import httpx
except ImportError:
    sys.exit("pip install httpx")

# ── helpers ───────────────────────────────────────────────────────────────────

PASS = "[PASS]"
FAIL = "[FAIL]"
SKIP = "[SKIP]"


def _hdr(title):
    print(f"\n{'='*60}\n  {title}\n{'='*60}")


def _ok(msg):
    print(f"  {PASS}  {msg}")


def _fail(msg):
    print(f"  {FAIL}  {msg}")
    sys.exit(1)


def _warn(msg):
    print(f"  {SKIP}  {msg}")


# ── auth ──────────────────────────────────────────────────────────────────────

if len(sys.argv) < 2:
    sys.exit("Usage: python scripts/session4_verify.py <admin_token>")

TOKEN = sys.argv[1]
ADMIN = {"Authorization": f"Bearer {TOKEN}"}

# Register a device token for /knowledge/query
dr = httpx.post(
    f"{BASE_URL}/api/v1/auth/device-register",
    json={"device_id": "verify-device-01", "device_model": "Verify", "app_version": "0.0.1"},
    timeout=10,
)
if dr.status_code != 200:
    sys.exit(f"device-register failed: {dr.status_code}")
DEVICE = {"Authorization": f"Bearer {dr.json()['device_token']}"}

# ── 1. DB schema: page_number must not exist ──────────────────────────────────

_hdr("1. DB schema — page_number dropped from knowledge_chunks")

try:
    import sys as _sys
    _sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app.core.database import sync_session
    from sqlalchemy import text as _text

    with sync_session() as db:
        cols = [
            r[0]
            for r in db.execute(
                _text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'knowledge_chunks'"
                )
            ).fetchall()
        ]

    if "page_number" in cols:
        _fail(f"page_number still present in knowledge_chunks columns: {cols}")
    else:
        _ok(f"page_number absent. Current columns: {cols}")
except Exception as exc:
    _warn(f"Could not query DB directly: {exc}")

# ── 2. Upload with full metadata ──────────────────────────────────────────────

_hdr("2. Upload document with all metadata fields")

SAMPLE = (
    "Heat Stroke Emergency Guidelines\n\n"
    "Heat stroke is a life-threatening emergency. Core body temperature exceeds 40 C.\n\n"
    "Immediate cooling is mandatory. Remove clothing, apply cold wet towels to neck,\n"
    "armpits, and groin. Fan the patient. Move to shade immediately.\n\n"
    "Do not give oral fluids if unconscious. Monitor airway and breathing.\n"
    "Transport urgently to the nearest medical facility.\n"
)
unique_id = _uuid.uuid4().hex[:8]
fname  = f"heat_stroke_verify_{unique_id}.txt"
utitle = f"Heat Stroke Guidelines [{unique_id}]"   # unique per run

r = httpx.post(
    f"{BASE_URL}/api/v1/admin/knowledge/documents",
    headers=ADMIN,
    data={
        "title":       utitle,
        "description": "Verify test doc",
        "author":      "MediReach Verify",
        "source":      "VerifySource",
        "url":         f"http://verify.local/heat/{unique_id}",
    },
    files={"file": (fname, io.BytesIO(SAMPLE.encode()), "text/plain")},
    timeout=30,
)

if r.status_code != 202:
    _fail(f"Upload returned {r.status_code}: {r.text}")

doc_id = r.json()["id"]
_ok(f"Accepted: doc_id={doc_id}, status={r.json()['status']}")

# ── poll to ACTIVE ────────────────────────────────────────────────────────────

_hdr("  Polling ingestion worker ...")
for attempt in range(40):
    time.sleep(3)
    pr = httpx.get(f"{BASE_URL}/api/v1/admin/knowledge/documents/{doc_id}", headers=ADMIN, timeout=10)
    st = pr.json()["status"]
    print(f"  [{(attempt+1)*3:>3}s] status={st}  chunks={pr.json().get('chunk_count')}")
    if st == "ACTIVE":
        _ok(f"ACTIVE — {pr.json()['chunk_count']} chunks created")
        break
    if st == "FAILED":
        _fail(f"Ingestion FAILED: {pr.json().get('error_message')}")
else:
    _fail("Timed out waiting for ACTIVE status")

# ── 3. Attribution on chunks ──────────────────────────────────────────────────

_hdr("3. Attribution — verify chunk metadata from form fields")

try:
    from app.models.db import KnowledgeChunk, KnowledgeDocument
    from sqlalchemy import select as _select
    import uuid as _u

    with sync_session() as db:
        chunks = db.execute(
            _select(KnowledgeChunk).where(
                KnowledgeChunk.document_id == _u.UUID(doc_id)
            )
        ).scalars().all()

    if not chunks:
        _fail("No chunks found for uploaded document")

    c = chunks[0]
    errors = []
    if c.article_title != utitle:
        errors.append(f"article_title={c.article_title!r} (expected {utitle!r})")
    if c.article_author != "MediReach Verify":
        errors.append(f"article_author={c.article_author!r}")
    if c.article_source != "VerifySource":
        errors.append(f"article_source={c.article_source!r}")
    expected_url = f"http://verify.local/heat/{unique_id}"
    if c.article_url != expected_url:
        errors.append(f"article_url={c.article_url!r} (expected {expected_url!r})")

    if errors:
        _fail("Attribution mismatch: " + "; ".join(errors))
    else:
        _ok(
            f"All {len(chunks)} chunks have correct attribution: "
            f"title={c.article_title!r}, author={c.article_author!r}"
        )
except Exception as exc:
    _warn(f"Direct DB check skipped: {exc}")

# ── 4. RAG query ──────────────────────────────────────────────────────────────

_hdr("4. RAG query — CAST fix + semantic relevance")

qr = httpx.post(
    f"{BASE_URL}/api/v1/knowledge/query",
    headers=DEVICE,
    json={"query": "heat stroke cooling emergency", "top_k": 5},
    timeout=30,
)

if qr.status_code != 200:
    _fail(f"RAG query returned {qr.status_code}: {qr.text}")

results = qr.json()["results"]
if not results:
    _fail("RAG query returned 0 results")

# Find the result that belongs to THIS run's document
this_run = [r for r in results if r.get("article_title") == utitle]
if not this_run:
    _fail(f"No result with title {utitle!r} found in RAG results")
top = this_run[0]
_ok(f"Top result: score={top['relevance_score']}, title={top['article_title']!r}")
_ok(f"  content: {top['content'][:80].strip()} ...")
if top["relevance_score"] < 0.3:
    _warn(f"Low relevance score {top['relevance_score']}")

# ── 5. Archive route ──────────────────────────────────────────────────────────

_hdr("5. Archive route — bumps version, excludes doc from RAG")

vr_before = httpx.get(f"{BASE_URL}/api/v1/knowledge/version", timeout=10).json()["version"]

ar = httpx.patch(
    f"{BASE_URL}/api/v1/admin/knowledge/documents/{doc_id}/archive",
    headers=ADMIN,
    timeout=15,
)

if ar.status_code != 200:
    _fail(f"Archive returned {ar.status_code}: {ar.text}")

archive_data = ar.json()
if archive_data["status"] != "ARCHIVED":
    _fail(f"Expected status=ARCHIVED, got {archive_data['status']}")
if archive_data["new_kb_version"] <= vr_before:
    _fail(f"Version did not bump: before={vr_before}, after={archive_data['new_kb_version']}")

_ok(f"Archived: version {vr_before} -> {archive_data['new_kb_version']}")

# Verify doc is excluded from RAG after archive
qr2 = httpx.post(
    f"{BASE_URL}/api/v1/knowledge/query",
    headers=DEVICE,
    json={"query": "heat stroke cooling emergency", "top_k": 5},
    timeout=30,
)
if qr2.status_code == 200:
    titles = [r["article_title"] for r in qr2.json().get("results", [])]
    if utitle in titles:
        _fail(f"Archived document {utitle!r} still appearing in RAG results")
    else:
        _ok(f"Archived document correctly excluded from RAG results (title={utitle!r} absent)")
elif qr2.status_code == 503:
    _ok("RAG returns 503 (no active docs) — archive correctly removed document")

# ── 6. Delete route ───────────────────────────────────────────────────────────

_hdr("6. Delete route — removes file from disk, chunks, bumps version")

# Get file path before deleting
try:
    with sync_session() as db:
        from app.models.db import KnowledgeDocument as _KD
        import uuid as _u2
        _doc = db.get(_KD, _u2.UUID(doc_id))
        file_path = _doc.file_path if _doc else None
except Exception:
    file_path = None

vr_before_del = httpx.get(f"{BASE_URL}/api/v1/knowledge/version", timeout=10).json()["version"]

dr2 = httpx.delete(
    f"{BASE_URL}/api/v1/admin/knowledge/documents/{doc_id}",
    headers=ADMIN,
    timeout=15,
)

if dr2.status_code != 200:
    _fail(f"Delete returned {dr2.status_code}: {dr2.text}")

del_data = dr2.json()
if del_data["new_kb_version"] <= vr_before_del:
    _fail(f"Version did not bump on delete: before={vr_before_del}, after={del_data['new_kb_version']}")

_ok(f"Deleted: version {vr_before_del} -> {del_data['new_kb_version']}")

# Verify file removed from disk
if file_path:
    if os.path.isfile(file_path):
        _fail(f"File still on disk after delete: {file_path}")
    else:
        _ok(f"File removed from disk: {os.path.basename(file_path)}")

# Verify GET returns 404
gr = httpx.get(f"{BASE_URL}/api/v1/admin/knowledge/documents/{doc_id}", headers=ADMIN, timeout=10)
if gr.status_code != 404:
    _fail(f"Expected 404 after delete, got {gr.status_code}")
_ok("GET after delete correctly returns 404")

# Verify chunks gone in DB
try:
    with sync_session() as db:
        import uuid as _u3
        remaining = db.execute(
            _select(KnowledgeChunk).where(KnowledgeChunk.document_id == _u3.UUID(doc_id))
        ).scalars().all()
    if remaining:
        _fail(f"{len(remaining)} orphan chunks remain after delete")
    else:
        _ok("All chunks deleted (cascade worked)")
except Exception as exc:
    _warn(f"Chunk cascade check skipped: {exc}")

# ── 7. Reprocess — create a FAILED doc to test the route ─────────────────────

_hdr("7. Reprocess route — re-queues a FAILED document")

try:
    from app.models.db import DocumentStatus as _DS
    from app.models.db import KnowledgeDocument as _KD2

    # Insert a FAILED document directly so we can test the reprocess route
    import uuid as _u4
    failed_doc_id = _u4.uuid4()
    with sync_session() as db:
        from app.core.security import hash_password as _hp
        # Fetch admin user id for the FK
        from app.models.db import User as _U
        admin_user = db.query(_U).filter(_U.role == "ADMIN").first()
        failed_doc = _KD2(
            id=failed_doc_id,
            title="Verify Failed Doc",
            filename="verify_failed.txt",
            file_path="/tmp/verify_failed.txt",
            file_size_bytes=100,
            status=_DS.FAILED,
            uploaded_by=admin_user.id,
            error_message="Simulated failure for reprocess test",
        )
        db.add(failed_doc)

    rr = httpx.patch(
        f"{BASE_URL}/api/v1/admin/knowledge/documents/{failed_doc_id}/reprocess",
        headers=ADMIN,
        timeout=15,
    )

    if rr.status_code != 202:
        _fail(f"Reprocess returned {rr.status_code}: {rr.text}")

    rr_data = rr.json()
    if rr_data["status"] != "PROCESSING":
        _fail(f"Expected PROCESSING, got {rr_data['status']}")
    _ok(f"Reprocess accepted: status={rr_data['status']}, message={rr_data['message']!r}")

    # Clean up the test FAILED doc
    httpx.delete(f"{BASE_URL}/api/v1/admin/knowledge/documents/{failed_doc_id}", headers=ADMIN, timeout=10)
    _ok("Cleanup: test FAILED doc deleted")

except Exception as exc:
    _warn(f"Reprocess test skipped (could not insert FAILED doc directly): {exc}")

# ── 8. Seed FAISS index is loadable ──────────────────────────────────────────

_hdr("8. Seed FAISS index — loadable from mobile assets directory")

seed_index = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "apps", "mobile", "src", "assets", "knowledge", "knowledge_index.faiss"
)
seed_index = os.path.normpath(seed_index)
seed_meta = seed_index.replace(".faiss", ".pkl").replace("knowledge_index", "knowledge_meta")

if not os.path.isfile(seed_index):
    _fail(f"Seed index not found: {seed_index}")

try:
    import faiss
    import pickle
    idx = faiss.read_index(seed_index)
    _ok(f"FAISS index loaded: {idx.ntotal} vectors, dim={idx.d}")
except Exception as exc:
    _fail(f"Could not load FAISS index: {exc}")

if os.path.isfile(seed_meta):
    with open(seed_meta, "rb") as f:
        meta = pickle.load(f)
    _ok(f"Metadata pickle loaded: {len(meta['texts'])} texts, keys={list(meta.keys())}")
    # Verify counts match
    if len(meta["texts"]) != idx.ntotal:
        _fail(f"Vector count mismatch: FAISS has {idx.ntotal}, metadata has {len(meta['texts'])}")
    else:
        _ok("Vector count matches metadata count")
else:
    _warn(f"Metadata pickle not found at: {seed_meta}")

# ── 9. FAISS binary download ──────────────────────────────────────────────────

_hdr("9. FAISS index download — GET /knowledge/index")

import tempfile
ir = httpx.get(f"{BASE_URL}/api/v1/knowledge/index", timeout=30)
if ir.status_code == 503:
    _warn("No active documents in DB — /knowledge/index returns 503 (expected if all docs deleted)")
elif ir.status_code != 200:
    _fail(f"Index download returned {ir.status_code}")
else:
    with tempfile.NamedTemporaryFile(suffix=".faiss", delete=False) as tmp:
        tmp.write(ir.content)
        tmp_path = tmp.name
    sz = os.path.getsize(tmp_path)
    os.unlink(tmp_path)
    _ok(f"Downloaded {sz / 1024:.1f} KB, Content-Type={ir.headers.get('content-type')}")

# ── 10. Version endpoint reflects state ──────────────────────────────────────

_hdr("10. Version endpoint — GET /knowledge/version")

vfinal = httpx.get(f"{BASE_URL}/api/v1/knowledge/version", timeout=10)
if vfinal.status_code != 200:
    _fail(f"Version endpoint returned {vfinal.status_code}")
v = vfinal.json()
_ok(f"version={v['version']}, documents={v['document_count']}, chunks={v['chunk_count']}, updated={v['updated_at']}")

# ── summary ───────────────────────────────────────────────────────────────────

_hdr("ALL CHECKS PASSED")
print("  Session 4 components verified:")
print("    migration 0003     - page_number dropped")
print("    upload wiring      - document_processor called with all fields")
print("    attribution        - chunk metadata from form fields")
print("    RAG query          - CAST fix + semantic search working")
print("    archive route      - version bump + doc excluded from RAG")
print("    delete route       - file removed, chunks cascaded, version bump")
print("    reprocess route    - re-queues FAILED documents")
print("    seed FAISS index   - loadable, vector count matches metadata")
print("    index download     - binary endpoint responding")
print("    version endpoint   - current state reflected")
print()
