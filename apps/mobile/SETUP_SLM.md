# SLM Model Setup — Llama 3.2 1B Instruct

The on-device SLM (Small Language Model) is **not bundled in the git repository** — it is 700 MB and would make the repo unusable. You must download it manually before building or running the app.

---

## What you need

| Property | Value |
|----------|-------|
| Model | Llama 3.2 1B Instruct |
| Quantisation | Q4_K_M (GGUF format) |
| File size | ~700 MB |
| File name | `Llama-3.2-1B-Instruct-Q4_K_M.gguf` |
| Destination | `apps/mobile/src/assets/models/` |

---

## Step 1 — Download the model

Download from Hugging Face:

```
https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF
```

Select the file named **`Llama-3.2-1B-Instruct-Q4_K_M.gguf`** and download it.

You can also use the Hugging Face CLI:

```bash
pip install huggingface_hub
huggingface-cli download bartowski/Llama-3.2-1B-Instruct-GGUF \
  Llama-3.2-1B-Instruct-Q4_K_M.gguf \
  --local-dir apps/mobile/src/assets/models/
```

---

## Step 2 — Place the file

```
apps/mobile/src/assets/models/
└── Llama-3.2-1B-Instruct-Q4_K_M.gguf   ← rename if needed
```

The filename must match exactly what `SLMAdapter.ts` references. Check `src/services/llm/SLMAdapter.ts` for the `modelPath` constant if the build fails to find the model.

---

## Step 3 — Verify .gitignore

The `apps/mobile/.gitignore` already excludes `*.gguf` files:

```
src/assets/models/*.gguf
```

Do **not** remove this exclusion. The model file must never be committed.

---

## Development mode — Ollama instead of bundled model

When `EXPO_PUBLIC_ENVIRONMENT=development` (set in `eas.json` development profile), `SLMAdapter` routes calls to a local Ollama instance instead of the bundled GGUF. This avoids the 5–15 second model load time during development.

```bash
# Install Ollama from https://ollama.ai
ollama pull llama3.2:1b
ollama serve   # starts on localhost:11434
```

Then run the app with:

```bash
EXPO_PUBLIC_ENVIRONMENT=development npx expo run:android
```

The app will use Ollama for all offline/SLM mode calls. No GGUF file needed for development.

---

## EAS Build — development APK

Once the model file is in place, build the development APK:

```bash
# From apps/mobile/

# 1. Login to your Expo account (one-time)
eas login

# 2. Link the project to EAS (one-time — generates the real projectId)
eas init

# 3. Build the development APK (includes expo-dev-client)
eas build --platform android --profile development

# The APK download link is printed when the build completes (~15-25 min).
# Install it on a physical Android device (Android 7.0+, 3GB+ RAM recommended).
```

After installing the development APK on a device:

```bash
# Start the Metro bundler
npx expo start --dev-client
```

Scan the QR code from the installed dev client app to load the JS bundle.

---

## Minimum device requirements

| Requirement | Minimum |
|-------------|---------|
| Android version | 7.0 (API 24) |
| RAM | 3 GB (4 GB recommended) |
| Free storage | 1.5 GB (700 MB model + app) |
| iOS version | 13.0 |

Devices with less than 3 GB RAM will fail to load the model. In that case the app falls back to FULL (cloud) mode only — offline SLM features are disabled.

---

## Troubleshooting

**Model not found at startup:**
- Confirm the file is at `src/assets/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf`
- Check the exact filename expected in `SLMAdapter.ts`
- Re-run `eas build` after adding the file (assets are bundled at build time)

**"Device AI unavailable" shown on splash:**
- The 30-second load timeout was exceeded — usually happens on low-RAM devices
- App continues in FULL (cloud) mode; all features work except offline chat

**Ollama not responding in dev mode:**
- Confirm `ollama serve` is running: `curl http://localhost:11434/api/tags`
- Confirm the model is pulled: `ollama list`
- On Android emulator, use `10.0.2.2` instead of `localhost` for the Ollama host
