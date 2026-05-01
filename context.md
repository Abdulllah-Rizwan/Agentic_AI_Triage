Read CLAUDE.md, Apps/Dashboard/README.md, Apps/Dashboard/ADMIN.md,
Apps/Api/API_ROUTES.md, and DECISIONS.md before doing anything.

Session 1: Backend scaffold complete
Session 2: All 7 API route files implemented
Session 3: ADK agents, Celery workers, socket emitter, RAG 
           service, document processor, index exporter
Session 4: RAG pipeline complete and tested end to end
Session 5: Dashboard scaffold, auth, layout, cases page, 
           CaseCard, SoapReportPanel, CasesMap, case detail 
           page, real-time Socket.IO updates

Session 6 goal: Complete the dashboard — analytics screen, 
all three admin screens (Knowledge Base, Organizations, 
System Health), the resources screen, and the case history 
table. After all screens are built, do a full visual review 
pass to ensure consistent dark styling across every page.

Work one task at a time. Tell me what you built after each 
task and wait for me to say "continue".

Task 1: Case history table on the cases page
The cases page currently shows only active (PENDING + 
ACKNOWLEDGED) cases. Add a history section below the 
active cases list.

In app/cases/page.tsx add a second API call:
getCases({ status: "RESOLVED,CLOSED", limit: 20 })

Below the active cases section add a "Past Cases" heading 
and a table component:

Create components/CaseHistoryTable.tsx:
Props: cases (CaseListItem[])
Table with these columns:
- Case ID: first 8 chars of UUID in monospace gray-500
- Status: colored pill — RESOLVED (green), CLOSED (gray)
- Triage: TriageBadge component
- Chief Complaint: truncated to 40 chars
- Location: lat, lng truncated to 4 decimal places
- Received: formatted date (Jan 15, 2024 10:30)
- Duration: time between received_at and resolved_at 
  formatted as "1h 23m" (calculate client side)
- Actions: "View Report" link to /cases/[id]

Table styling:
- bg-gray-900 rounded-xl border border-gray-800
- Header row: bg-gray-800 text-gray-400 text-xs uppercase 
  tracking-wider
- Body rows: text-gray-300 text-sm, hover:bg-gray-800 
  transition
- Alternating row backgrounds: every odd row bg-gray-900, 
  even row bg-gray-850 (use bg-opacity trick)
- Empty state: "No resolved cases yet" centered in the table

Task 2: Analytics page — KPI cards
Create app/analytics/page.tsx.
On mount fetch getAnalyticsSummary() and render four KPI 
cards in a top row.

Create components/analytics/KPICard.tsx:
Props: title, value, subtitle, icon (lucide-react), 
       trend? (number — positive is good)
Card styling: bg-gray-900 border border-gray-800 rounded-xl 
p-6, icon in top-right corner in muted color

Four cards using data from /analytics/summary:
1. Total Cases — value: total_cases
   icon: Users, subtitle: "Last 7 days"
2. Critical Cases — value: critical_cases  
   icon: AlertTriangle, color accent: red-500
   subtitle: "Require immediate response"
3. Avg Response Time — value: avg_response_time_minutes 
   formatted as "12.4 min"
   icon: Clock, subtitle: "Claim to resolve"
4. Resolution Rate — value: resolution_rate_percent 
   formatted as "78%"
   icon: CheckCircle, color accent: green-500
   subtitle: "Cases resolved"

Task 3: Analytics page — cases over time chart
Fetch getTimeseries({ days: 7 }) and render a line chart.

Create components/analytics/CasesTimelineChart.tsx:
Uses Recharts LineChart.
Three lines:
- RED cases: stroke #ef4444 (red-500)
- AMBER cases: stroke #f59e0b (amber-500)  
- GREEN cases: stroke #22c55e (green-500)
X-axis: date labels formatted as "Jan 15"
Y-axis: case count, no decimals
Legend at bottom with colored indicators
Tooltip showing exact counts on hover
Chart background: transparent
Grid lines: stroke gray-800, strokeDasharray "3 3"
Container: bg-gray-900 border border-gray-800 rounded-xl p-6
Title: "Cases Over Time" above the chart

Add a time range toggle above the chart:
Three buttons: 7D | 30D | 90D
Clicking refetches getTimeseries with the new days value
Active button: bg-gray-700, inactive: bg-transparent

Task 4: Analytics page — symptoms bar chart
Fetch getSymptoms({ days: 7 }) and render a bar chart.

Create components/analytics/TopSymptomsChart.tsx:
Uses Recharts BarChart horizontal layout.
X-axis: count
Y-axis: symptom name (truncate to 25 chars)
Bar fill: #3b82f6 (blue-500) with rounded corners
Show top 10 symptoms only
Tooltip showing exact count
Container: bg-gray-900 border border-gray-800 rounded-xl p-6
Title: "Top Reported Symptoms"

Task 5: Analytics page — geographic heatmap
Fetch getGeoData({ days: 7 }) and render a heatmap.

Create components/analytics/GeoHeatmap.tsx:
Uses Leaflet with the HeatLayer plugin.
Same dark CartoDB tiles as CasesMap.
Import L.heatLayer — install leaflet.heat:
npm install leaflet.heat @types/leaflet.heat

Convert geo points to heatmap format:
[lat, lng, weight] where weight is from the API response.
Initial center: Karachi (24.8607, 67.0011), zoom 10.
This MUST be a client component with dynamic import 
ssr:false in the parent page — same pattern as CasesMap.
Container: bg-gray-900 border border-gray-800 rounded-xl 
overflow-hidden height 400px
Title: "Geographic Distribution" above the map

Full analytics page layout:
- KPI cards row at top (4 columns)
- Below: two-column grid
  Left: CasesTimelineChart (full width on mobile, 
        60% on large screens)
  Right: TopSymptomsChart (40% on large screens)
- Below: GeoHeatmap full width
- All charts share the same days state — 
  changing the toggle refetches all charts

Task 6: Medical Resources page
Create app/resources/page.tsx.
This is a static page — no API calls needed.
Layout: grid of resource cards, 2 columns on desktop.

Four sections, each with a heading and cards below:

Section 1 — Guidelines (downloadable documents):
Create components/resources/ResourceCard.tsx
Props: title, description, badge, actionLabel, 
       actionHref, icon
Card: bg-gray-900 border border-gray-800 rounded-xl p-5
Icon in top-left (lucide-react FileText in blue-500)
Title in white, description in gray-400 text-sm
Badge pill in top-right (e.g. "WHO", "NDMA")
Action button at bottom: outline style

Four guideline cards:
- WHO Emergency Field Handbook
  badge: "WHO" · action: "Download PDF" (link to #)
- Pakistan NDMA Flood Response Protocol  
  badge: "NDMA" · action: "Download PDF"
- Earthquake Trauma Management Guide
  badge: "WHO" · action: "Download PDF"
- Pediatric Emergency Quick Reference
  badge: "WHO" · action: "Download PDF"

Section 2 — Interactive Tools:
Two tool cards with "Open Tool" buttons:
- Glasgow Coma Scale Calculator
  icon: Brain · description: "Calculate GCS score for 
  head injury assessment"
- Burn Surface Area Estimator
  icon: Thermometer · description: "Rule of Nines 
  calculator for burn coverage"
Both open a modal — create stub modals for now with 
"Coming soon" placeholder content.

Section 3 — Emergency Directory:
A single card listing contacts in a clean table format:
Contact name | Number | Type
Aga Khan Hospital Emergency | 021-3493-0051 | Hospital
EDHI Foundation             | 115           | Ambulance
Pakistan Red Crescent       | 1716          | Relief
NDMA Helpline               | 1700          | Government
Each row has a phone icon and "Call" label.

Section 4 — Training:
One card:
- AI System Onboarding Module
  Progress bar (hardcoded at 0% for now — 
  localStorage can track progress later)
  "Start Training" button

Task 7: Admin — Knowledge Base page
Create app/admin/knowledge/page.tsx.
This is the most complex admin screen. 
Read ADMIN.md carefully before implementing.

Left panel (Upload form):
Create components/admin/DocumentUploadForm.tsx
Form fields:
- Title (required text input)
- Author (optional text input, placeholder: 
  "World Health Organization")
- Source (optional text input, placeholder: "WHO")  
- URL (optional url input)
- Description (optional textarea)
- File upload zone: dashed border, drag-and-drop area
  Shows file name after selection
  Only accepts .txt files
  "Browse" link inside the zone
Submit button: "Upload and Process" — disabled while 
submitting, shows spinner

On submit:
1. Build FormData with all fields + file
2. Call uploadDocument(formData) from lib/api.ts
3. On success: clear form, show success toast, 
   trigger document list refresh
4. On error: show error message below the form

Right panel (Document table):
Create components/admin/DocumentTable.tsx
Props: documents[], onRefresh(), isLoading

Table columns:
- Title (bold white)
- Status badge:
  PROCESSING: amber spinner + "Processing" text
  ACTIVE: green dot + "Active"
  FAILED: red dot + "Failed" 
  ARCHIVED: gray dot + "Archived"
- Chunks: number or "—" if still processing
- Size: formatted as "1.8 MB"
- Uploaded by: user email (truncated)
- Date: relative time "3 days ago"
- Actions column:
  ACTIVE: Archive button (gray outline)
  FAILED: Re-process button (amber outline) + 
          Delete button (red outline)
  ARCHIVED: Delete button (red outline)
  PROCESSING: disabled spinner only

Auto-polling: while any document has status=PROCESSING,
poll GET /api/v1/admin/knowledge/documents/{id} every 
5 seconds for that document. Stop when terminal state.

Footer below table:
"Knowledge Base v{version} · {n} active documents · 
 {n} total chunks · Last updated {relative time}"
Fetch this from getKBStats().

Socket.IO: listen for kb:updated event and refresh 
the document list and footer stats automatically.

Page layout:
Heading: "Knowledge Base Management" 
Two columns: upload form left (35%), document table right (65%)
Below table: stats footer

Task 8: Admin — Organizations page
Create app/admin/organizations/page.tsx.
Read ADMIN.md for full spec.

Create components/admin/OrgTable.tsx:
Props: organizations[], onApprove(id), onSuspend(id), 
       onReactivate(id)

Table columns:
- Name (bold white)
- Type badge: colored pill per org type
  NGO: blue, HOSPITAL: purple, GOVT: red, 
  RELIEF_CAMP: orange
- Status badge: 
  PENDING_APPROVAL: amber pulsing dot + "Pending"
  ACTIVE: green dot + "Active"
  SUSPENDED: red dot + "Suspended"
- Users: count
- Cases: total count
- Registered: relative time
- Actions:
  PENDING_APPROVAL: green "Approve" + red "Reject"
  ACTIVE: gray "Suspend" (opens confirmation modal)
  SUSPENDED: blue "Reactivate"

Confirmation modal for Suspend:
Shows org name, reason text input (required), 
confirm/cancel buttons.
Calls suspendOrg(id, reason) on confirm.

Sorting: PENDING_APPROVAL rows always appear first.

Page layout:
Heading: "Organization Management"
Subtitle: count summary "3 pending approval · 
           12 active · 1 suspended"
Full-width OrgTable below

Task 9: Admin — System Health page
Create app/admin/system/page.tsx.
Read ADMIN.md for full spec.

Create components/admin/SystemHealthCard.tsx:
Props: label, status ("ok" | "down"), value?, 
       lastChecked
Card: bg-gray-900 border rounded-xl p-5
Green left border if ok, red left border if down
Icon: CheckCircle (green) or XCircle (red) from lucide
Label in white, status text below in gray-400
Refresh on a 30-second polling interval.

Four health cards in a 2x2 grid:
- API Server
- PostgreSQL  
- Redis
- Celery Workers (shows worker count if ok)

Queue panel below health cards:
Table showing SOAP generation and document ingestion 
queue depths.
If pending > 50: show yellow warning banner 
"Queue depth is high — worker may be overwhelmed"

RAG Stats panel below queue:
Four stats in a row:
- KB Version: number
- Active Documents: number
- Total Chunks: number with comma formatting
- Index Size: formatted as "18.4 MB"

Top retrieved documents list:
Table: Document title | Retrievals (7 days)
Sorted by retrievals desc, show top 5.

Auto-refresh: poll all health endpoints every 30 seconds.
Show "Last updated X seconds ago" counter that increments.

Task 10: Full visual consistency review
Go through every page that exists and ensure:

1. All pages use the same dark color palette:
   - Page background: bg-gray-950
   - Card/panel background: bg-gray-900
   - Elevated elements: bg-gray-800
   - Primary text: text-white
   - Secondary text: text-gray-400
   - Muted text: text-gray-500
   - Borders: border-gray-800

2. All pages have consistent spacing:
   - Page padding: p-6 or p-8
   - Card padding: p-5 or p-6
   - Gap between cards: gap-4 or gap-6

3. All interactive elements have hover states

4. All loading states show skeleton loaders 
   (not spinners on full pages)

5. All empty states have an icon + message

6. The sidebar active item is highlighted 
   on every page

7. The TriageBadge component is used everywhere 
   a triage level is displayed — no raw text

Fix any inconsistencies found.

Rules:
- "use client" only where genuinely needed — 
  prefer server components for data fetching
- All charts (Recharts) are client components
- All map components are client components with 
  dynamic import ssr:false
- No hardcoded colors outside of Tailwind classes
- All admin pages must check session.user.role 
  server-side and redirect if not ADMIN — 
  middleware.ts handles routing but the page 
  should also verify
- TypeScript strict — no any types anywhere
- Do not modify lib/api.ts or lib/socket.ts 
  unless a function is genuinely missing