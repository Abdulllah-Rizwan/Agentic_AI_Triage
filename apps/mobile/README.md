# Agentic AI Triage Mobile App

React Native (Expo) patient-facing application. Works fully offline using an on-device SLM (Llama 3.2 1B). Collects symptoms, performs triage, and dispatches compressed reports when connectivity is available.

---

## Prerequisites

- Node.js 20 or higher
- Expo CLI: `npm install -g expo-cli`
- EAS CLI (for building APKs): `npm install -g eas-cli`
- Android Studio (for the Android emulator — code can be written in VS Code/Cursor)
- A physical Android phone or emulator for testing (see Testing section)

---

## First-Time Setup

```bash
cd apps/mobile
npm install
cp .env.example .env
# Fill in EXPO_PUBLIC_API_BASE_URL with your API server URL
```

---

## Running the App

### On a physical phone with Expo Go (quickest, no build needed)
```bash
npx expo start
```
Install Expo Go from the Play Store on your phone. Scan the QR code.

**Limitation:** The on-device SLM and encrypted SQLite will NOT work in Expo Go because they require compiled native code. Everything else works. Good for UI development.

### On Android emulator (via Android Studio)
```bash
# Open Android Studio, start an emulator, then:
npx expo run:android
```
This compiles the full app including native modules. Takes 5-10 minutes the first time.

### On a physical Android phone (full native build — recommended)
```bash
# One-time: build a development APK via EAS cloud
eas build --profile development --platform android
# Download the .apk from the EAS dashboard link, install it on your phone
# Then for daily development (instant JS updates):
npx expo start --dev-client
```

---

## The On-Device SLM

The app bundles `Llama-3.2-1B-Instruct.Q4_K_M.gguf` (~700MB) inside the app assets. This is the model used when the phone is offline.

**The GGUF model file is stored at:** `apps/mobile/src/assets/models/`
**It is NOT in git** (700MB is too large for git). Download it once:
```bash
cd apps/mobile/src/assets/models
# Download from HuggingFace
curl -L "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf" \
     -o "Llama-3.2-1B-Instruct-Q4_K_M.gguf"
```

**Local dev without the model file:**
Set `EXPO_PUBLIC_ENVIRONMENT=development` in `.env`. The SLM adapter will route all offline calls to a local Ollama instance instead:
```bash
# Install Ollama from https://ollama.com, then:
ollama pull llama3.2:1b
# Your phone and computer must be on the same WiFi
# Set EXPO_PUBLIC_OLLAMA_URL=http://<your-computer-IP>:11434 in .env
```

---

## Folder Structure

```
apps/mobile/
├── src/
│   ├── agents/
│   │   └── SymptomCollectorAgent.ts   # Chat agent loop (hand-written, not ADK)
│   ├── components/                    # Reusable UI pieces (buttons, cards, etc.)
│   ├── screens/                       # One file per screen
│   │   ├── SplashScreen.tsx
│   │   ├── RegistrationScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── ChatScreen.tsx             # Symptom collection chat
│   │   └── TriageResultScreen.tsx
│   ├── services/
│   │   ├── network/NetworkOrchestrator.ts  # Detects connectivity, picks LLM adapter
│   │   ├── llm/
│   │   │   ├── LLMAdapter.interface.ts     # Shared interface both adapters implement
│   │   │   ├── CloudLLMAdapter.ts          # Calls Gemini API
│   │   │   └── SLMAdapter.ts               # Calls on-device llama.rn model
│   │   ├── rag/LocalRAG.ts                 # Searches bundled WHO knowledge base
│   │   ├── triage/TriageEngine.ts          # Rule-based RED/AMBER/GREEN logic
│   │   ├── transmission/TransmissionService.ts  # Payload caching + retry loop
│   │   └── encryption/AESEncryption.ts     # Encrypts cached payloads
│   ├── store/                         # Zustand global state
│   ├── db/                            # SQLite queries
│   ├── proto/                         # Generated protobuf types
│   └── assets/
│       ├── models/                    # GGUF model file (not in git, download manually)
│       └── knowledge/                 # FAISS index (built by docs/knowledge-base/build_index.py)
├── app.json
├── .env.example
└── package.json
```

---

## Environment Variables

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `EXPO_PUBLIC_API_BASE_URL` | Yes | `http://192.168.1.5:3001` | Your API server URL (use LAN IP for local dev) |
| `EXPO_PUBLIC_GEMINI_API_KEY` | Yes | `AIza...` | For cloud LLM path |
| `EXPO_PUBLIC_ENVIRONMENT` | No | `development` | Set to `development` to use Ollama instead of bundled SLM |
| `EXPO_PUBLIC_OLLAMA_URL` | Dev only | `http://192.168.1.5:11434` | Ollama server URL (only needed in development) |

**Important:** All mobile env variables must be prefixed with `EXPO_PUBLIC_` to be accessible in the app.

---

## Common Errors

**`Unable to resolve module`**
Run `npm install` again. If it persists, delete `node_modules` and reinstall:
```bash
rm -rf node_modules && npm install
```

**App stuck on splash screen / SLM not loading**
The GGUF model file is missing. Download it (see instructions above) or switch to development mode with Ollama.

**`Network request failed` when calling the API**
- Check `EXPO_PUBLIC_API_BASE_URL` — it must be your computer's LAN IP, not `localhost`. Your phone and computer are different devices.
- Find your computer's IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux), look for the WiFi IP (usually 192.168.x.x).
- Make sure your phone and computer are on the same WiFi network.

**Chat messages send but get no response**
Check which LLM adapter is active. In dev mode, check that Ollama is running and the model is pulled. In production mode, check your Gemini API key.
