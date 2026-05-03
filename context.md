Read CLAUDE.md, Apps/Mobile/CLAUDE.md, Apps/Mobile/README.md, 
and DECISIONS.md before doing anything.

Session 1: Backend scaffold complete
Session 2: All 7 API route files implemented
Session 3: ADK agents, Celery workers, socket emitter, 
           RAG service, document processor, index exporter
Session 4: RAG pipeline complete and tested end to end
Session 5: Dashboard scaffold, auth, layout, cases page,
           CaseCard, SoapReportPanel, CasesMap, real-time 
           Socket.IO
Session 6: Analytics, admin screens (Knowledge Base, 
           Organizations, System Health), resources page,
           full visual consistency review

Session 7 goal: Build the React Native mobile app foundation.
This covers the project scaffold, navigation structure, 
all screens up to and including the home screen, the 
NetworkOrchestrator service, both LLM adapters (cloud and 
SLM), and the SQLite database setup. The SLM will use 
llama.rn with Llama 3.2 1B — this works on all Android 
and iOS devices with 3GB+ RAM.

Work one task at a time. Tell me what you built after each 
task and wait for me to say "continue".

Task 1: Initialise the Expo project
Inside Apps/Mobile/ initialise a new Expo project:
npx create-expo-app . --template blank-typescript

After scaffolding install all required dependencies:

# Navigation
npm install @react-navigation/native @react-navigation/stack
npm install react-native-screens react-native-safe-area-context

# State management
npm install zustand

# Local database
npm install expo-sqlite

# Location
npm install expo-location

# Network detection  
npm install @react-native-community/netinfo

# Encryption
npm install react-native-aes-crypto

# File system
npm install expo-file-system

# Background tasks
npm install expo-task-manager expo-background-fetch

# Device info
npm install expo-device expo-constants

# LLM — cloud
npm install @google/generative-ai

# LLM — on device (llama.rn for Llama 3.2 1B)
npm install llama.rn

# RAG — embeddings and FAISS (JS port)
npm install @xenova/transformers

# Protobuf
npm install protobufjs

# i18n
npm install i18next react-i18next

# UI utilities
npm install date-fns

After installing, create the full folder structure 
defined in Apps/Mobile/CLAUDE.md:

src/
  agents/
    SymptomCollectorAgent.ts
  components/
    (empty for now)
  screens/
    SplashScreen.tsx
    RegistrationScreen.tsx
    HomeScreen.tsx
    ChatScreen.tsx
    TriageResultScreen.tsx
  services/
    network/
      NetworkOrchestrator.ts
    llm/
      LLMAdapter.interface.ts
      CloudLLMAdapter.ts
      SLMAdapter.ts
    rag/
      LocalRAG.ts
    knowledge/
      KnowledgeBaseUpdateService.ts
    triage/
      TriageEngine.ts
    transmission/
      TransmissionService.ts
    encryption/
      AESEncryption.ts
  store/
    networkStore.ts
    userStore.ts
    chatStore.ts
  db/
    database.ts
    migrations.ts
    queries.ts
  proto/
    triage.ts
  assets/
    knowledge/
      .gitkeep
    models/
      .gitkeep
  i18n/
    en.json
    ur.json
    index.ts

Create all files as empty stubs with correct imports only.

Task 2: SQLite database setup
Implement Apps/Mobile/src/db/database.ts:
- Opens the SQLite database using expo-sqlite
- Exports a singleton db instance
- Exports an initDatabase() function that runs all 
  migrations on first call

Implement Apps/Mobile/src/db/migrations.ts:
Create all three tables exactly as defined in 
Apps/Mobile/CLAUDE.md:

user_profile table:
  id TEXT PRIMARY KEY DEFAULT 'local_user'
  full_name TEXT NOT NULL
  phone TEXT NOT NULL
  cnic TEXT NOT NULL
  lat REAL
  lng REAL
  registered_at INTEGER NOT NULL

pending_payloads table:
  case_id TEXT PRIMARY KEY
  encrypted_blob TEXT NOT NULL
  triage_level TEXT NOT NULL
  created_at INTEGER NOT NULL
  attempts INTEGER DEFAULT 0
  last_attempt INTEGER

completed_cases table:
  case_id TEXT PRIMARY KEY
  triage_level TEXT NOT NULL
  chief_complaint TEXT NOT NULL
  completed_at INTEGER NOT NULL
  acknowledged INTEGER DEFAULT 0

app_metadata table (add this — needed by 
KnowledgeBaseUpdateService):
  key TEXT PRIMARY KEY
  value TEXT NOT NULL

Implement Apps/Mobile/src/db/queries.ts:
Typed query functions for every table operation needed:

User profile:
  saveUserProfile(profile) → void
  getUserProfile() → UserProfile | null

Pending payloads:
  savePendingPayload(payload) → void
  getPendingPayloads(maxAttempts: number) → PendingPayload[]
  deletePendingPayload(caseId) → void
  incrementPayloadAttempts(caseId) → void

Completed cases:
  saveCompletedCase(case) → void
  getCompletedCases() → CompletedCase[]
  markCaseAcknowledged(caseId) → void

App metadata:
  getMetadata(key) → string | null
  setMetadata(key, value) → void

Task 3: Zustand state stores
Implement Apps/Mobile/src/store/networkStore.ts:
State: 
  mode: 'OFFLINE' | 'DEGRADED' | 'FULL'
  isConnected: boolean
  lastChecked: number
Actions:
  setMode(mode)
  setConnected(connected)

Implement Apps/Mobile/src/store/userStore.ts:
State:
  profile: UserProfile | null
  isRegistered: boolean
  deviceId: string
Actions:
  setProfile(profile)
  setRegistered(registered)
  loadFromDatabase() — reads user_profile from SQLite 
    on app start

Implement Apps/Mobile/src/store/chatStore.ts:
State:
  messages: ChatMessage[]
  isAgentTyping: boolean
  emergencyDetected: boolean
  emergencyTrigger: string | null
  collectionStatus: 'IDLE'|'COLLECTING'|'SUFFICIENT'|'CRITICAL'
Actions:
  addMessage(message)
  setAgentTyping(typing)
  setEmergencyDetected(trigger)
  setCollectionStatus(status)
  clearChat()

ChatMessage type:
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: number

Task 4: LLM Adapter interface and Cloud adapter
Implement Apps/Mobile/src/services/llm/LLMAdapter.interface.ts:

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LLMAdapter {
  chat(
    messages: ChatMessage[], 
    systemPrompt: string
  ): Promise<string>
  isAvailable(): Promise<boolean>
}

Implement Apps/Mobile/src/services/llm/CloudLLMAdapter.ts:
- Implements LLMAdapter interface
- Uses @google/generative-ai SDK
- Model: gemini-2.0-flash
- API key from EXPO_PUBLIC_GEMINI_API_KEY env var
- chat() method: prepends systemPrompt as first system 
  message, sends all messages, returns text response
- isAvailable(): makes a lightweight test call, returns 
  true if response received within 5 seconds
- Retry logic: 3 attempts with exponential backoff 
  (1s, 2s, 4s) on network errors
- Timeout: 30 seconds per request
- On timeout or all retries exhausted: throw a typed 
  LLMUnavailableError so the caller can fall back to SLM

Task 5: SLM Adapter using llama.rn
Implement Apps/Mobile/src/services/llm/SLMAdapter.ts:
- Implements LLMAdapter interface
- Uses llama.rn to load and run Llama 3.2 1B
- Model file path: 
  require('../../assets/models/
  Llama-3.2-1B-Instruct-Q4_K_M.gguf')
- In development mode (EXPO_PUBLIC_ENVIRONMENT === 
  'development'): route ALL calls to Ollama at 
  EXPO_PUBLIC_OLLAMA_URL instead of the bundled model.
  This avoids needing the 700MB model file during dev.

Private state:
  private llm: LlamaContext | null = null
  private isReady: boolean = false
  private isLoading: boolean = false

Public methods:

initialize(): Promise<void>
  - If EXPO_PUBLIC_ENVIRONMENT === 'development': 
    set isReady = true immediately (Ollama needs 
    no initialisation)
  - Otherwise: load the GGUF model using 
    llama.rn initLlama()
  - Set isReady = true on success
  - Set isReady = false on failure, log the error
  - Must be idempotent — calling twice does nothing 
    if already loaded

isAvailable(): Promise<boolean>
  - Returns isReady

chat(messages, systemPrompt): Promise<string>
  - If development mode: call Ollama HTTP API at 
    EXPO_PUBLIC_OLLAMA_URL/api/chat with model 
    llama3.2:1b
  - Otherwise: use this.llm.completion() from llama.rn
  - Format messages as Llama 3.2 instruct template:
    <|system|>{systemPrompt}<|user|>{last_user_message}
    <|assistant|>
  - maxTokens: 512 (sufficient for symptom collection)
  - temperature: 0.3 (low — we want consistent 
    structured responses not creative ones)
  - On error: throw LLMUnavailableError

isModelReady(): boolean
  - Returns isReady synchronously (used by splash screen)

Task 6: Network Orchestrator
Implement Apps/Mobile/src/services/network/
NetworkOrchestrator.ts exactly as defined in 
Apps/Mobile/CLAUDE.md.

This is the most important service in the mobile app — 
everything routes through it.

Responsibilities:
- Subscribes to @react-native-community/netinfo
- Classifies connection as OFFLINE, DEGRADED, or FULL:
  OFFLINE: isConnected === false OR isInternetReachable 
           === false
  DEGRADED: connected but type is 'cellular' and 
            effectiveType is '2g' or '3g'  
  FULL: WiFi, or cellular 4G/5G
- Updates networkStore.mode on every change
- Exposes getLLMAdapter(): returns CloudLLMAdapter if 
  FULL, SLMAdapter if DEGRADED or OFFLINE
- Exposes start(): begins monitoring — call this once 
  at app startup
- Exposes stop(): unsubscribes — call on app teardown
- On mode change OFFLINE→DEGRADED or OFFLINE→FULL: 
  emit a 'connectivity_restored' event so 
  TransmissionService can flush the queue

The NetworkOrchestrator must be a singleton — export 
a single instance, not a class to instantiate.

Task 7: App entry point and navigation
Implement App.tsx as the root component:

On mount (useEffect):
1. Call initDatabase() to create SQLite tables
2. Call networkOrchestrator.start()
3. Call slmAdapter.initialize() — run in background, 
   do not await (splash screen shows while loading)
4. Call userStore.loadFromDatabase() to check if 
   user is already registered

Navigation structure using React Navigation:
Stack Navigator with these screens:

SplashScreen (no header, no back button)
↓ (navigates to Registration if not registered, 
   Home if registered)
RegistrationScreen (no header)
↓
HomeScreen (header: "MediReach", right: network badge)
↓
ChatScreen (header: "Assessment", back disabled once 
           triage computed)
↓
TriageResultScreen (no back button)

Pass slmAdapter.isModelReady as a prop to SplashScreen
so it can show the loading state.

Task 8: Splash screen
Implement Apps/Mobile/src/screens/SplashScreen.tsx
exactly as defined in Apps/Mobile/CLAUDE.md.

Layout — full screen dark background (#0a0a0a):
Center column with:
  - App logo: large "M" in a red circle (use a View 
    with borderRadius, no image file needed for now)
  - "MediReach" text: white, 32px, bold, marginTop 16
  - "Emergency Medical Assessment" text: gray, 16px
  - marginTop 48: status section

Status section:
  SLM status indicator:
  - If isModelReady === false AND slmLoading === true:
    amber pulsing dot + "Loading Device AI..."
  - If isModelReady === true:  
    green dot + "Device AI Ready"
  - If failed (timeout after 30s):
    red dot + "Device AI Unavailable — Cloud Only"

  Network badge (below SLM status):
  - Read from networkStore
  - FULL: green badge "CLOUD AI ACTIVE"
  - DEGRADED: amber badge "DEVICE AI ACTIVE"  
  - OFFLINE: red badge "OFFLINE MODE"

OFFLINE READY badge at bottom of screen:
  A pill badge: "OFFLINE READY" with wifi-off icon
  Always shown — reassures user app works without internet

Navigation logic (useEffect watching isModelReady 
and a 30-second timeout):
  Once model is ready OR 30 seconds pass:
    Check userStore.isRegistered
    Navigate to RegistrationScreen or HomeScreen

Task 9: Registration screen
Implement Apps/Mobile/src/screens/RegistrationScreen.tsx

Layout — dark background, scrollable, centered card:
Header: "Create Your Profile" white 24px bold
Subtext: "Your information helps responders find you" 
         gray 14px

Form fields (in order):
1. Full Name
   Placeholder: "Ahmed Khan"
   Validation: required, min 2 chars

2. Phone Number  
   Placeholder: "+92-300-1234567"
   Keyboard type: phone-pad
   Validation: must match Pakistan format regex:
   /^\+92-\d{3}-\d{7}$/
   Error: "Enter a valid Pakistan number: +92-300-1234567"

3. CNIC
   Placeholder: "42201-1234567-8"
   Keyboard type: numeric
   Validation: must match /^\d{5}-\d{7}-\d{1}$/
   Error: "Enter a valid CNIC: 42201-1234567-8"

4. Location (auto-filled, not editable directly)
   Shows: "📍 Detecting location..." while loading
   Shows: "📍 24.8607, 67.0011" when detected
   Shows: "📍 Location unavailable" if permission denied
   "Update Location" button below the field

On mount: request location permission and get current 
coords using expo-location getCurrentPositionAsync().

Non-Diagnostic Disclaimer (MUST appear before submit):
A red-bordered box (border border-red-600 bg-red-950 
rounded-lg p-4) containing:
Title: "⚠️ Medical Disclaimer" in red-400 bold
Text: "This application provides AI-assisted symptom 
collection only. It is NOT a substitute for professional 
medical diagnosis or treatment. In a life-threatening 
emergency, contact emergency services immediately."
A checkbox: "I understand this is not a medical 
diagnosis tool" — user MUST check this before 
the submit button is enabled

Submit button: "BEGIN ASSESSMENT"
  Disabled until: all fields valid + checkbox checked
  Shows loading spinner while saving
  On success: save to SQLite via saveUserProfile(), 
  update userStore, navigate to HomeScreen

Task 10: Home screen
Implement Apps/Mobile/src/screens/HomeScreen.tsx

Layout — dark background:

Header area:
  "Good [morning/afternoon/evening], {firstName}" 
  in white 22px (derive time-based greeting)
  Network mode badge (same as splash screen badges)
  Below name: "Stay safe. Help is connected." in gray

Status card (bg-gray-900 rounded-xl border 
border-gray-800 p-5 marginTop 24):
  Icon: shield check in green
  "System Ready" in white bold
  "Device AI loaded · Location active" in gray-400 
  small text
  If offline: amber shield + "Offline Mode — 
  Assessment available without internet"

Main CTA button:
  "BEGIN ASSESSMENT" 
  Large, full-width, bg-red-600 rounded-xl p-4
  White text 18px bold
  Below: "AI-guided symptom collection · 
         Takes 2-3 minutes" in gray small text
  On press: navigate to ChatScreen

Past assessments section (below CTA):
  Heading: "My Assessments" gray uppercase small
  If completed_cases table is empty: 
    "No assessments yet" in gray centered
  Otherwise: flat list of completed case rows:
    Triage level colored dot + chief complaint + date
    Tap row → show a simple modal with case details

Rules:
- Do not attempt to run the app yet — just build 
  the files
- SLM model file (700MB GGUF) is NOT in the repo — 
  the SLMAdapter must handle the missing file 
  gracefully in development mode by falling back 
  to Ollama automatically
- EXPO_PUBLIC_ENVIRONMENT=development must be set 
  in Apps/Mobile/.env for all dev work so Ollama 
  is used instead of the bundled model
- All screens use StyleSheet.create() — no inline 
  styles
- All screens are dark: background #0a0a0a, cards 
  #111111, text white/#9ca3af
- TypeScript strict — no any types
- Do not use React Native Paper or any UI library — 
  raw React Native components only, styled manually