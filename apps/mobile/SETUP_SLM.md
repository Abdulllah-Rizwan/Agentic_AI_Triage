# SLM Model Setup — Qwen2.5 1.5B Instruct

The on-device SLM (Small Language Model) is **not bundled in the git repository** — it is ~1 GB and would make the repo unusable. You must download it manually before building or running the app.

---

## What you need

| Property | Value |
|----------|-------|
| Model | Qwen2.5 1.5B Instruct |
| Quantisation | Q4_K_M (GGUF format) |
| File size | ~1 GB |
| File name | `Qwen2.5-1.5B-Instruct-Q4_K_M.gguf` |
| Destination | `apps/mobile/src/assets/models/` |
| Prompt format | ChatML (`<\|im_start\|>` / `<\|im_end\|>`) |

---

## Step 1 — Download the model

Download from Hugging Face:

```
https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF
```

Select the file named **`Qwen2.5-1.5B-Instruct-Q4_K_M.gguf`** and download it.

You can also use the Hugging Face CLI:

```bash
pip install huggingface_hub
huggingface-cli download bartowski/Qwen2.5-1.5B-Instruct-GGUF \
  Qwen2.5-1.5B-Instruct-Q4_K_M.gguf \
  --local-dir apps/mobile/src/assets/models/
```

---

## Step 2 — Place the file

```
apps/mobile/src/assets/models/
└── Qwen2.5-1.5B-Instruct-Q4_K_M.gguf   ← rename if needed
```

The filename must match exactly what `SLMAdapter.ts` references (`MODEL_FILENAME` constant). Check `src/services/llm/SLMAdapter.ts` if the build fails to find the model.

---

## Step 3 — Verify .gitignore

The `apps/mobile/.gitignore` already excludes `*.gguf` files:

```
src/assets/models/*.gguf
```

Do **not** remove this exclusion. The model file must never be committed.

---

## Upgrading from the old Llama 3.2 1B model

If you previously downloaded `Llama-3.2-1B-Instruct-Q4_K_M.gguf` (~807 MB), you can delete it from `src/assets/models/`. The app automatically detects and deletes the old file from device storage on first launch — no manual action needed on the user's device.

---

## Development mode — Ollama instead of bundled model

When `EXPO_PUBLIC_ENVIRONMENT=development` (set in your `apps/mobile/.env`), `SLMAdapter` routes calls to a local Ollama instance instead of the bundled GGUF. This avoids the model load time during development.

```bash
# Install Ollama from https://ollama.com
ollama pull qwen2.5:1.5b
ollama serve   # starts on localhost:11434
```

Then run the app with:

```bash
EXPO_PUBLIC_ENVIRONMENT=development npx expo run:android
```

The app will use Ollama for all offline/SLM mode calls. No GGUF file needed for development.

> If Ollama is unreachable (e.g., you turn off WiFi to test offline mode), the app will automatically try the local GGUF model as a fallback — provided it was downloaded and the model load has completed in the background.

---

## EAS Build — preview APK

Once the model file is in place, build the preview APK:

```powershell
# From apps/mobile/
cd apps/mobile

# 1. Login to your Expo account (one-time)
eas login

# 2. Build the preview APK (standalone, no Metro required)
eas build --platform android --profile preview

# The APK download link is printed when the build completes (~20-30 min).
# Install it on a physical Android device (Android 7.0+, 4GB RAM recommended).
```

> **Before building:** make sure `EXPO_PUBLIC_GROQ_API_KEY` is set as an EAS secret:
> ```powershell
> eas secret:create --scope project --name EXPO_PUBLIC_GROQ_API_KEY --value gsk_your_key_here
> ```

---

## Installing a new APK when switching EAS accounts

Android ties each installed app to the signing key of the EAS account that built it. If the EAS account changes, the new APK will fail to install with:

> "App not installed as package conflicts with an existing package."

**Fix:** Uninstall the old app from the device first (Settings → Apps → MediReach → Uninstall), then install the new APK. This is only required when the signing account changes.

---

## Minimum device requirements

| Requirement | Minimum |
|-------------|---------|
| Android version | 7.0 (API 24) |
| RAM | 3 GB (4 GB recommended) |
| Free storage | ~1.5 GB (model ~1 GB + app) |
| iOS version | 13.0 |

Devices with less than 3 GB RAM may fail to load the model. In that case the app falls back to FULL (cloud) mode only — offline SLM features are disabled.

---

## Troubleshooting

**Model not found at startup:**
- Confirm the file is at `src/assets/models/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf`
- Check the exact filename expected in `SLMAdapter.ts` (`MODEL_FILENAME` constant)
- Re-run `eas build` after adding the file (assets are bundled at build time)

**"Device AI unavailable" shown on splash:**
- The 30-second load timeout was exceeded — usually happens on low-RAM devices
- App continues in FULL (cloud) mode; all features work except offline chat

**Ollama not responding in dev mode:**
- Confirm `ollama serve` is running: `curl http://localhost:11434/api/tags`
- Confirm the model is pulled: `ollama list` — you should see `qwen2.5:1.5b`
- On Android emulator, use `10.0.2.2` instead of `localhost` for the Ollama host
- Set `EXPO_PUBLIC_OLLAMA_URL=http://10.0.2.2:11434` in your `.env` when testing on emulator

**Old Llama model still on device after update:**
The app deletes the old `Llama-3.2-1B-Instruct-Q4_K_M.gguf` automatically on first launch. If you want to free the space immediately without launching the app, delete it manually:
```
Settings → Apps → MediReach → Storage → Clear Data
```
Or using adb:
```bash
adb shell rm /data/data/com.medireach.app/files/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf
```
