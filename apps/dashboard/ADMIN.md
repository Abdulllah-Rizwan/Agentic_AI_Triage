# ADMIN.md — Agentic AI Triage Admin Layer

This file documents the admin role, all admin-only screens, the knowledge base lifecycle, and the organization approval workflow. Read this before touching any file in `apps/api/app/routers/admin/` or `apps/dashboard/app/admin/`.

---

## What Is the Admin Role?

The admin is a special user role within the existing dashboard. There is no separate admin portal or separate URL — admins log in at the same page as responders. Once logged in, they see everything a responder sees, plus an additional **Admin** section at the bottom of the sidebar.

The three roles and what they can do:

| Capability | VIEWER | RESPONDER | ADMIN |
|---|---|---|---|
| View cases and SOAP reports | ✓ | ✓ | ✓ |
| Claim and resolve cases | — | ✓ | ✓ |
| View analytics | ✓ | ✓ | ✓ |
| Upload knowledge base documents | — | — | ✓ |
| Archive / delete documents | — | — | ✓ |
| Approve / suspend organizations | — | — | ✓ |
| View system health dashboard | — | — | ✓ |

**How role is enforced:**
- Backend: every `/api/v1/admin/*` route checks `current_user.role == "ADMIN"` via a FastAPI dependency. Any other role receives HTTP 403.
- Frontend: the Admin sidebar section is hidden using a conditional render that checks the role from the JWT. Hidden in UI but also blocked at API level — both must be enforced.

---

## Admin Route Guard (FastAPI dependency)

**File:** `apps/api/app/core/security.py`

```python
from fastapi import Depends, HTTPException, status
from app.core.security import get_current_user

async def require_admin(current_user = Depends(get_current_user)):
    if current_user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required"
        )
    return current_user
```

Usage in every admin router:
```python
from app.core.security import require_admin

@router.post("/documents", dependencies=[Depends(require_admin)])
async def upload_document(...):
    ...
```

---

## Admin Frontend Guard (Next.js middleware)

**File:** `apps/dashboard/middleware.ts`

```typescript
import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

export async function middleware(request) {
  if (request.nextUrl.pathname.startsWith('/admin')) {
    const token = await getToken({ req: request });
    if (!token || token.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/cases', request.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
```

---

## Knowledge Base Lifecycle

This is the most important thing to understand about the admin layer. Every step below is automated — the admin only does step 1.

```
1. Admin uploads a PDF via the dashboard
        ↓
2. Server saves the file to /uploads/ (or S3)
   Creates a KnowledgeDocument row with status=PROCESSING
   Returns 202 immediately
        ↓
3. Celery ingestion worker picks up the job:
   - Parses the PDF with PyPDF
   - Splits into 512-token chunks
   - Embeds each chunk with all-MiniLM-L6-v2
   - Saves chunks + embeddings into knowledge_chunks (pgvector)
   - Sets document status=ACTIVE
        ↓
4. index_exporter.py runs:
   - Fetches ALL active chunk embeddings from pgvector
   - Builds a new FAISS flat index
   - Saves it to exports/knowledge_index.faiss
   - Bumps KnowledgeBaseVersion.version by 1
        ↓
5. Mobile apps:
   - On next launch with internet, call GET /api/v1/knowledge/version
   - If server version > local version: download new index silently
   - New index used immediately for all subsequent RAG queries
```

**What happens when admin archives a document:**
Same flow from step 4 — the archived document's chunks are excluded from the new index, version is bumped, mobile apps sync the smaller index.

**What happens when a document fails:**
- Status is set to `FAILED` with `error_message` populated
- The document does NOT affect the knowledge base (it was never set to ACTIVE)
- Admin can click "Re-process" to retry the ingestion job

---

## Admin Screen: Knowledge Base (`/admin/knowledge`)

### Document Upload

The upload form accepts PDF files up to 50MB. On submit:

1. Frontend sends `multipart/form-data` POST to `/api/v1/admin/knowledge/documents`
2. Server validates: PDF only (check MIME type with `python-magic`), max 50MB
3. Server saves file to `apps/api/uploads/{uuid}_{filename}`
4. Server creates `KnowledgeDocument` row with `status=PROCESSING`
5. Server enqueues `ingest_document_task.delay(document_id)`
6. Server returns 202 with `{ document_id, status: "PROCESSING" }`
7. Frontend adds the new row to the table immediately with a spinning amber badge

**Frontend polling:** After upload, poll `GET /api/v1/admin/knowledge/documents/{id}` every 5 seconds until status is `ACTIVE` or `FAILED`. Stop polling once terminal state is reached.

### Document Table

Each row shows:
- **Title** — clickable, expands to show description and chunk count
- **Status badge** — color-coded pill
- **Chunks** — number of indexed chunks (populated after ACTIVE)
- **Size** — file size in MB
- **Uploaded by** — user email
- **Date** — formatted relative time (e.g. "3 days ago")
- **Actions:**
  - Archive button — soft-delete; removes from RAG but preserves the record
  - Re-process button — only shown if status is FAILED
  - Delete button — hard delete, removes file + all chunks + triggers index rebuild

### Knowledge Base Stats Footer

```
┌──────────────────────────────────────────────────────────────────┐
│  Knowledge Base v7  ·  4 active documents  ·  1,247 chunks       │
│  Last updated: 2 hours ago                                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Admin Screen: Organizations (`/admin/organizations`)

### Purpose
New organizations register on the dashboard but cannot log in until an admin approves them. This prevents unauthorized access to patient case data.

### Registration Flow (from the org's perspective)
1. An NGO visits the dashboard and clicks "Register Organization"
2. They fill in: org name, type, contact email, access code they want
3. Their account is created with `status=PENDING_APPROVAL`
4. They see a message: "Your registration is pending admin approval"
5. Admin approves → status becomes `ACTIVE` → they can log in

### Organization Table

Columns: Name | Type | Status | Users | Cases (total) | Registered | Actions

Sorted by: PENDING_APPROVAL first (needs attention), then ACTIVE alphabetically, then SUSPENDED last.

**Actions by status:**
- `PENDING_APPROVAL` → **Approve** (green button) + **Reject** (red, soft-delete)
- `ACTIVE` → **Suspend** (suspending blocks all users in that org from logging in)
- `SUSPENDED` → **Reactivate**

### What suspension does
- Sets `org.status = SUSPENDED` in the database
- The auth endpoint checks org status on login: `if org.status != "ACTIVE": return 403`
- Existing sessions are not invalidated immediately (JWT expiry handles this naturally within 15 minutes)

---

## Admin Screen: System Health (`/admin/system`)

### Purpose
Quick operational visibility without needing server access or logs.

### Health Cards (top row)

Each card shows a green "Operational" or red "Down" status with a last-checked timestamp:

| Card | How it's checked |
|------|-----------------|
| API Server | Always green if this response came back |
| PostgreSQL | `SELECT 1` query within 200ms |
| Redis | `PING` command within 200ms |
| Celery Workers | `celery inspect active` — shows count of active workers |

**API route:** `GET /api/v1/admin/system/health`
```python
{
  "api": "ok",
  "postgres": "ok",
  "redis": "ok",
  "celery_workers": 2,
  "checked_at": "2024-01-15T10:30:00Z"
}
```

### Queue Panel

**API route:** `GET /api/v1/admin/system/queue`
```python
{
  "soap_generation": { "pending": 3, "active": 1, "failed": 0 },
  "document_ingestion": { "pending": 1, "active": 0, "failed": 0 }
}
```

Display as a simple two-row table. Show a yellow warning banner if any queue has `pending > 50` (worker may be overwhelmed).

### RAG Stats Panel

**API route:** `GET /api/v1/admin/knowledge/stats`
```python
{
  "kb_version": 7,
  "active_documents": 4,
  "total_chunks": 1247,
  "index_size_mb": 18.4,
  "last_updated": "2024-01-15T08:00:00Z",
  "top_retrieved_documents": [
    { "title": "WHO Emergency Field Handbook", "retrievals_7d": 284 },
    { "title": "NDMA Flood Protocol", "retrievals_7d": 91 }
  ]
}
```

The `top_retrieved_documents` list is useful for the FYP presentation — it shows which documents the AI actually used when responding to patients, demonstrating that the RAG system is working.

**To track retrieval frequency:** Add a `retrieval_count` column to `KnowledgeDocument` and increment it in `rag_service.py` every time a chunk from that document is returned in a query.

---

## Creating the First Admin User

There is no admin signup page. The first admin is created via a CLI script to avoid a chicken-and-egg problem (you need an admin to approve orgs, but orgs need to be approved to log in).

**File:** `apps/api/scripts/create_admin.py`

```python
# Usage: python scripts/create_admin.py --email admin@medireach.app --password securepass123
import argparse
from app.core.database import sync_session
from app.models.db import User, Organization
from app.core.security import hash_password
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--email", required=True)
parser.add_argument("--password", required=True)
args = parser.parse_args()

with sync_session() as db:
    # Admin users belong to a special "System" org
    system_org = db.query(Organization).filter_by(name="MediReach System").first()
    if not system_org:
        system_org = Organization(
            name="MediReach System",
            type="GOVT",
            access_code="SYSTEM",
            status="ACTIVE"
        )
        db.add(system_org)
        db.flush()

    admin = User(
        email=args.email,
        password_hash=hash_password(args.password),
        role="ADMIN",
        org_id=system_org.id,
    )
    db.add(admin)
    db.commit()
    print(f"Admin user created: {args.email}")
```

Run once after migrations:
```bash
cd apps/api && source .venv/bin/activate
python scripts/create_admin.py --email admin@medireach.app --password your_secure_password
```

---

## Enabling pgvector in PostgreSQL

pgvector must be enabled as a PostgreSQL extension before Alembic migrations run. This is handled automatically by the `init_db.sql` file that docker-compose runs on first startup:

**File:** `apps/api/init_db.sql`
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

If you are connecting to an existing PostgreSQL instance (not docker-compose), run this manually:
```sql
-- Connect to your medireach database and run:
CREATE EXTENSION IF NOT EXISTS vector;
```

The Alembic migration that creates the `knowledge_chunks` table uses `Vector(384)` from `pgvector.sqlalchemy`. If pgvector is not enabled, this migration will fail with: `type "vector" does not exist`.
