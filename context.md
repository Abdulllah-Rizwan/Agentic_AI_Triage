Read CLAUDE.md, Apps/Mobile/CLAUDE.md,
Apps/Mobile/README.md, Apps/Api/API_ROUTES.md,
Apps/Dashboard/README.md, Apps/Dashboard/ADMIN.md,
and DECISIONS.md before doing anything.

Sessions 1-9 complete. The entire application is
built:
- FastAPI backend with all routes
- Google ADK SOAP + triage audit agents
- Celery workers for SOAP and document ingestion
- RAG pipeline with pgvector and FAISS export
- Next.js dashboard with real-time Socket.IO
- React Native mobile app with offline SLM
- TransmissionService with store-and-forward
- AES encryption for cached payloads
- KnowledgeBaseUpdateService with silent sync

Session 10 goal: End-to-end testing of the complete
system. Simulate every major flow. Fix every bug
found. Security audit. Performance checks. EAS
build. Final git commit.

Work one task at a time. Report every result and
wait for me to say "continue".

Task 1: Fix all TypeScript errors across the project

Run from Apps/Mobile:
npx tsc --noEmit

Run from Apps/Dashboard:
npx tsc --noEmit

Run from Apps/Api (if mypy installed):
mypy app/ --ignore-missing-imports

List every error found. Fix them all. Do not use
@ts-ignore or type: ignore. Report what was fixed.

Task 2: Backend integration test suite
Create Apps/Api/scripts/test_full_backend.py
This script tests every single API route in order
using the running server at localhost:3001.
Must be self-contained — creates and cleans up
its own test data.

Test sequence:

--- AUTH (5 tests) ---
1. Register test organization
   POST /api/v1/auth/register
   Expected: 201

2. Login before approval
   POST /api/v1/auth/login
   Expected: 403 pending approval message

3. Approve org as admin
   PATCH /api/v1/admin/organizations/{id}/approve
   Use admin token from env TEST_ADMIN_TOKEN
   Expected: 200

4. Login after approval
   POST /api/v1/auth/login
   Expected: 200 access_token returned
   Save as RESPONDER_TOKEN

5. Register device
   POST /api/v1/auth/device-register
   Expected: 200 device_token returned
   Save as DEVICE_TOKEN

--- CASES (8 tests) ---
6. Submit RED triage payload as protobuf
   POST /api/v1/cases/ingest
   Auth: DEVICE_TOKEN
   Content-Type: application/octet-stream
   Build a real LeanPayload and encode it:
   chief_complaint: "Severe chest pain"
   symptoms: ["chest pain", "shortness of breath"]
   severity: 9
   triage_level: RED
   lat: 24.8607, lng: 67.0011
   Expected: 202

7. Submit same case_id again (idempotency)
   Expected: 202 status DUPLICATE

8. List cases filtered by RED
   GET /api/v1/cases?triage_level=RED
   Expected: 200 case appears in list

9. Get case detail
   GET /api/v1/cases/{id}
   Expected: 200 all fields present

10. Wait for SOAP report (poll max 60s)
    Expected: soap_report not null with all 4 
    sections

11. Claim case
    PATCH /api/v1/cases/{id}/claim
    Expected: 200 status ACKNOWLEDGED

12. Claim again — conflict
    Expected: 409

13. Resolve case
    PATCH /api/v1/cases/{id}/resolve
    Expected: 200 status RESOLVED

--- ANALYTICS (4 tests) ---
14. GET /api/v1/analytics/summary
    Expected: total_cases >= 1

15. GET /api/v1/analytics/timeseries
    Expected: series array not empty

16. GET /api/v1/analytics/symptoms
    Expected: chest pain in list

17. GET /api/v1/analytics/geo
    Expected: our test case coordinates appear

--- KNOWLEDGE BASE (6 tests) ---
18. GET /api/v1/knowledge/version
    Expected: version >= 1

19. POST /api/v1/knowledge/query
    Body: {"query":"chest pain emergency","top_k":3}
    Expected: 200

20. Upload test document
    POST /api/v1/admin/knowledge/documents
    Create a small test .txt inline
    Expected: 202 PROCESSING

21. Poll until ACTIVE (max 120s)
    Expected: status ACTIVE chunk_count > 0

22. Archive test document
    PATCH /api/v1/admin/knowledge/documents/{id}/
    archive
    Expected: 200 new_kb_version incremented

23. Download FAISS index
    GET /api/v1/knowledge/index
    Expected: 200 binary file size > 0

--- ADMIN (6 tests) ---
24. GET /api/v1/admin/organizations
    Expected: test org appears

25. Suspend test org
    PATCH /api/v1/admin/organizations/{id}/suspend
    Expected: 200

26. Login with suspended org
    Expected: 403 suspended message

27. GET /api/v1/admin/system/health
    Expected: all services ok

28. GET /api/v1/admin/system/queue
    Expected: queue depths returned

29. Cleanup — delete test org if possible
    or mark it for manual cleanup

Print final summary table:
Test N | Route | Expected | Actual | PASS/FAIL

Run: python scripts/test_full_backend.py
Fix all FAILs before moving to Task 3.

Task 3: Full mobile flow test — GREEN path
Manually walk through on phone or emulator:

Step 1: Launch app
Expected: SplashScreen with network + SLM badges

Step 2: Register (if not already registered)
Complete all fields + disclaimer checkbox
Expected: navigates to HomeScreen

Step 3: Start assessment
Tap BEGIN ASSESSMENT
Expected: ChatScreen opens with agent greeting

Step 4: Report mild symptoms
"I have a mild headache since this morning,
severity 2, no other symptoms, no allergies"
Continue responding until agent produces
SUFFICIENT JSON
Expected: navigates to TriageResultScreen

Step 5: Verify GREEN screen
Expected: dark green background, checkmark,
"You Are Safe", first-aid guidance from RAG
Transmission status card should NOT appear
for GREEN (no transmission needed)

Step 6: Start new assessment
Expected: HomeScreen, chat cleared

Report any steps that failed. Fix them.

Task 4: Full mobile flow test — RED path
This is the most critical test in the project.

Step 1: Start new assessment

Step 2: Type EXACTLY this as first message:
"I have chest pain"

Step 3: Verify Emergency Bar appears IMMEDIATELY
The Emergency Notification Bar must appear
BEFORE the LLM responds — because
detectCriticalSymptom checks raw input first.

If the bar does NOT appear before the LLM
responds — this is a critical safety bug.
Fix it immediately before continuing.
The check order must be:
1. detectCriticalSymptom(userMessage) — synchronous
2. If critical: show bar, return CRITICAL response
3. Only THEN call the LLM

Step 4: Verify RED result screen
Expected: dark red background
"Critical — Emergency Response Activated"
Transmission status changing through states
ending at SENT or CACHED

Step 5: Verify API received the payload
Check API server terminal — ingest POST visible
Check Celery terminal — SOAP job running

Step 6: Verify dashboard updates
Open localhost:3000/cases
Expected: RED case card appears at top
SOAP report available within 30 seconds

Report every step. Fix any failures.

Task 5: Offline to reconnect flow test

Step 1: Enable airplane mode on device

Step 2: Complete a RED assessment
Expected: TriageResultScreen shows CACHED status
"Saved securely. Will send when signal available"

Step 3: Verify SQLite has the payload
Add a temporary console.log in
TransmissionService.sendOrCache after 
savePendingPayload to confirm it was called.
Check the output in Expo console.

Step 4: Disable airplane mode
Wait up to 60 seconds for retry loop to fire
Expected: console shows transmission attempt
Expected: SENT confirmation OR API terminal shows
the ingest request arrive

Step 5: Verify case on dashboard
Open localhost:3000/cases
Expected: the offline case now appears

Step 6: Verify payload removed from SQLite
Queue status should show 0 pending

Report every step. Fix any failures.

Task 6: Knowledge base sync test

Step 1: Upload a new document via dashboard
Go to localhost:3000/admin/knowledge
Upload a test .txt article
Wait for ACTIVE status
Note the new KB version number (e.g. v3)

Step 2: Force outdated local version on device
In SQLite set kb_local_version to 0:
Call setMetadata('kb_local_version', '0') in
a temporary debug button on HomeScreen
OR just clear and reinstall the app

Step 3: Restart app with internet enabled
Expected console log:
"Knowledge base updated: v0 → v3"

Step 4: Verify new index downloaded
Check FileSystem.documentDirectory — 
knowledge_index.faiss should exist and be
newer than app install time

Step 5: Test RAG uses new content
Start assessment, describe symptoms related to
the article you uploaded
Expected: agent response includes context
from that article

Report results. Fix any failures.

Task 7: Security audit
Verify every security requirement in CLAUDE.md.

Check 1: CNIC never stored in plaintext on server
Query PostgreSQL:
SELECT patient_cnic_hash FROM cases LIMIT 3;
Expected: long hex hashes, not readable CNICs

Check 2: Payloads encrypted before SQLite
Add temporary debug log in sendOrCache to print
the encrypted_blob — it should be unreadable
ciphertext not JSON

Check 3: JWT expiry enforced
Use an access_token after 16 minutes
Expected: 401 Unauthorized
Use refresh_token to get new one
Expected: new access_token returned

Check 4: Admin routes reject non-admins
GET /api/v1/admin/organizations with 
RESPONDER_TOKEN
Expected: 403 Forbidden

Check 5: Device token cannot access dashboard routes
GET /api/v1/cases with DEVICE_TOKEN
Expected: 403 Forbidden

Check 6: Payload size limit enforced
POST /api/v1/cases/ingest with 15KB body
Expected: 413 Request Entity Too Large

Check 7: Non-diagnostic disclaimer required
On RegistrationScreen try to tap BEGIN ASSESSMENT
without checking the disclaimer checkbox
Expected: button is disabled, cannot proceed

Report PASS or FAIL for each check.
Fix all FAILs before moving on.

Task 8: Performance benchmarks
Measure and report these numbers:

Mobile:
1. SLM response time (Ollama in dev mode)
   Time agent.sendMessage() for a typical message
   Target: under 5 seconds
   
2. TriageEngine.computeTriage() time
   Time it on a full MedicalFeatureVector
   Target: under 50ms (synchronous JS)
   
3. LocalRAG.query() time
   Time it on "chest pain difficulty breathing"
   Target: under 500ms
   
4. Protobuf payload size
   Log byte count of a typical RED LeanPayload
   Target: under 2000 bytes
   If over: trim conversation_summary field

Backend:
5. POST /api/v1/cases/ingest response time
   Target: under 200ms
   
6. SOAP generation time
   Time from ingest to soap_report populated
   Target: under 30 seconds
   
7. POST /api/v1/knowledge/query response time
   Target: under 1 second

Report all numbers with pass/fail vs target.
If any target is missed by more than 2x investigate
and fix the bottleneck.

Task 9: CLAUDE.md constraints final verification
Go through EVERY non-negotiable in the
"Key Constraints and Non-Negotiables" section
of root CLAUDE.md and verify each one:

Constraint 1: Triage is rule-based, LLM is not
the sole decision maker
Verify: TriageEngine.computeTriage() is pure
JavaScript with no LLM call anywhere in it

Constraint 2: App works fully offline
Verify: enable airplane mode, complete an
assessment start to finish
Expected: everything works, payload cached

Constraint 3: Non-diagnostic disclaimer requires
explicit acknowledgment
Verify: checkbox is required, button disabled
without it

Constraint 4: Patient data never leaves device
in plaintext
Verify: encryptLeanPayload is called BEFORE
any savePendingPayload or fetch call

Constraint 5: Lean payload under 2KB
Verify: log payload byte size, must be < 2000

Constraint 6: Dashboard requires org approval
Verify: register new org, try to login before
admin approves — must get 403

Constraint 7: GPS required before assessment
Verify: on RegistrationScreen, if location
permission denied, the form cannot be submitted
The location field must be populated

Report PASS or FAIL for each.
Fix all FAILs.

Task 10: EAS development build
Build a proper development APK with all
native modules included.

Step 1: Verify EAS login
eas whoami
If not logged in: eas login with your Expo account

Step 2: Verify app.json is correct
Ensure these fields are present:
{
  "expo": {
    "name": "MediReach",
    "slug": "medireach",
    "version": "1.0.0",
    "android": {
      "package": "com.medireach.app",
      "permissions": [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "INTERNET",
        "ACCESS_NETWORK_STATE"
      ]
    },
    "plugins": [
      "expo-location",
      "expo-task-manager",
      "expo-background-fetch",
      "expo-secure-store"
    ]
  }
}

Step 3: Verify eas.json has development profile
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    }
  }
}

Step 4: Trigger the build
cd Apps/Mobile
eas build --profile development --platform android

This runs on EAS cloud servers and takes 10-15
minutes. It will give you a QR code and download
URL when done. Note the build ID.

Do not wait — move to Task 11 while it builds.

Task 11: Download SLM model (document the process)
The 700MB Llama model file is not in the repo.
Document exactly how to add it for the production
build.

Create a file Apps/Mobile/SETUP_SLM.md:

# Setting Up the On-Device SLM

## Download the model
mkdir -p src/assets/models
cd src/assets/models

curl -L "https://huggingface.co/bartowski/
Llama-3.2-1B-Instruct-GGUF/resolve/main/
Llama-3.2-1B-Instruct-Q4_K_M.gguf" \
-o "Llama-3.2-1B-Instruct-Q4_K_M.gguf"

## Verify the download
ls -lh src/assets/models/
# Should show ~700MB file

## Switch from development to production mode
In Apps/Mobile/.env change:
EXPO_PUBLIC_ENVIRONMENT=production

## Rebuild with EAS
eas build --profile preview --platform android

## What changes in production mode
- SLMAdapter loads the bundled GGUF instead of
  calling Ollama
- First model load takes 5-15 seconds depending
  on device
- Subsequent loads use cached model weights

## Minimum device requirements
- Android 7.0+ (API level 24+)
- 3GB RAM minimum (4GB recommended)
- 1.5GB free storage for model + app

Task 12: Final git commit
1. Verify .gitignore is complete:
.env
.env.local
Apps/Mobile/.env
Apps/Api/.env
Apps/Api/uploads/
Apps/Api/exports/
Apps/Mobile/src/assets/models/*.gguf
Apps/Mobile/src/assets/knowledge/*.faiss
Apps/Mobile/src/assets/knowledge/*.pkl
Apps/Mobile/src/assets/knowledge/*.bin
__pycache__/
.venv/
node_modules/
*.pyc
.DS_Store

2. Verify no .env files are tracked:
git status
If any .env files appear: git rm --cached <file>

3. Stage everything:
git add .

4. Final commit:
git commit -m "feat: MediReach complete application

Backend:
- FastAPI with pgvector RAG pipeline
- Google ADK SOAP generation agent
- Celery async workers
- All API routes per API_ROUTES.md spec

Dashboard:
- Next.js 14 with real-time Socket.IO
- Cases, analytics, admin screens
- Leaflet geospatial mapping

Mobile:
- React Native Expo offline-first
- Llama 3.2 1B on-device SLM
- AES-256 encrypted store-and-forward
- Silent knowledge base sync

Tested: full offline to reconnect to dashboard"

Rules for this session:
- The RED emergency bar test in Task 4 Step 3
  is the single most critical test — it must pass
  before anything else
- Fix every test failure before moving to the
  next task — do not skip
- Security audit checks are not optional
- EAS build requires a free Expo account —
  create one at expo.dev if needed
- Do not suppress TypeScript errors