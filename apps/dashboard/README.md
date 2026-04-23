# Agentic AI Triage Dashboard

Next.js web application for NGOs, hospitals, relief camps, and government responders. Displays incoming triage cases in real time, shows SOAP reports, and provides analytics and medical resources.

---

## Prerequisites

- Node.js 20 or higher
- The API server running (see `apps/api/README.md`)

---

## First-Time Setup

```bash
cd apps/dashboard
npm install
cp .env.local.example .env.local
# Fill in the API URL
```

---

## Running the Dashboard

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

You need to log in with a dashboard account. Create one via the API:
```bash
# From apps/api/ with venv active:
python scripts/create_org_and_user.py \
  --org-name "Test Hospital" \
  --org-type HOSPITAL \
  --email admin@test.com \
  --password testpass123
```

---

## Folder Structure

```
apps/dashboard/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── cases/
│   │   ├── page.tsx                 # Live cases list
│   │   └── [id]/page.tsx            # Case detail + SOAP report
│   ├── analytics/
│   │   └── page.tsx
│   ├── resources/
│   │   └── page.tsx
│   └── admin/                       # Admin-only — blocked by middleware.ts for non-admins
│       ├── knowledge/
│       │   └── page.tsx             # Document upload + management table
│       ├── organizations/
│       │   └── page.tsx             # Org approval and suspension
│       └── system/
│           └── page.tsx             # Health cards, queue stats, RAG stats
├── components/
│   ├── CaseCard.tsx
│   ├── SoapReportPanel.tsx
│   ├── CasesMap.tsx
│   ├── TriageBadge.tsx
│   └── admin/
│       ├── DocumentUploadForm.tsx   # PDF upload form with progress
│       ├── DocumentTable.tsx        # Document list with status polling
│       ├── OrgTable.tsx             # Organizations with approve/suspend actions
│       └── SystemHealthCard.tsx     # Individual health check card
├── lib/
│   ├── socket.ts
│   └── api.ts
├── middleware.ts                    # Redirects non-admins away from /admin/* routes
└── .env.local.example
```

---

## Environment Variables

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `NEXTAUTH_SECRET` | Yes | any random string | Signs NextAuth session tokens |
| `NEXTAUTH_URL` | Yes | `http://localhost:3000` | The dashboard's own URL |
| `NEXT_PUBLIC_API_URL` | Yes | `http://localhost:3001` | API server URL |
| `NEXT_PUBLIC_SOCKET_URL` | Yes | `http://localhost:3001` | Socket.IO server URL (same as API) |

---

## Real-Time Updates

The dashboard connects to the API via Socket.IO on page load. When a new case arrives or a SOAP report is generated, the dashboard updates automatically without refreshing.

If real-time updates are not working:
1. Check that the API server is running
2. Check browser console for Socket.IO connection errors
3. Verify `NEXT_PUBLIC_SOCKET_URL` matches the API server address

---

## Common Errors

**`ECONNREFUSED` or API calls failing**
The API server is not running. Start it first (see `apps/api/README.md`).

**Login fails with correct credentials**
Check that the database migrations have run and the user was created via the setup script.

**Map not showing / blank map tiles**
This is a Leaflet CSS import issue. Make sure `import 'leaflet/dist/leaflet.css'` is in the map component and that the `CasesMap` component is rendered client-side only (`dynamic(() => import('../components/CasesMap'), { ssr: false })`).
