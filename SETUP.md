# MediReach — Complete Setup Guide

This guide walks you through setting up the **entire MediReach system** from scratch on a fresh PC.  
By the end you will have three things running simultaneously:

| Component | What it is | URL / Access |
|---|---|---|
| **API Server** | FastAPI backend + Socket.IO | `http://localhost:3001` |
| **Dashboard** | Next.js web app for responders | `http://localhost:3000` |
| **Mobile App** | React Native patient app | Android device or emulator |

Estimated setup time: **45–60 minutes** (most of it is downloading tools and dependencies).

---

## Table of Contents

1. [Prerequisites — What You Need to Install](#1-prerequisites)
2. [Get the Code](#2-get-the-code)
3. [Get Your API Keys](#3-get-your-api-keys)
4. [Start the Database and Redis](#4-start-the-database-and-redis)
5. [Set Up the API Server](#5-set-up-the-api-server)
6. [Set Up the Dashboard](#6-set-up-the-dashboard)
7. [Set Up the Mobile App](#7-set-up-the-mobile-app)
8. [Seed the Knowledge Base](#8-seed-the-knowledge-base)
9. [First Login and Admin Setup](#9-first-login-and-admin-setup)
10. [Running Everything Together](#10-running-everything-together)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

You need to install the following tools before anything else.  
Each heading links to the official download page.

### 1.1 Git
Used to download the code.

- **Windows:** Download from https://git-scm.com/download/win — install with all defaults.
- **Mac:** Open Terminal and type `git --version`. If not installed, macOS will prompt you to install it.
- **Linux:** `sudo apt install git`

Verify: open a terminal and run:
```
git --version
```
You should see something like `git version 2.44.0`.

---

### 1.2 Python 3.11 or newer
The backend API is written in Python.

- **Windows/Mac:** Download from https://www.python.org/downloads/ — pick the latest 3.11.x or 3.12.x installer.
  - **Important on Windows:** During installation, tick the checkbox **"Add Python to PATH"** before clicking Install.
- **Linux:** `sudo apt install python3.11 python3.11-venv python3-pip`

Verify:
```
python --version
```
Should show `Python 3.11.x` or newer.

---

### 1.3 Node.js 20 (LTS)
The dashboard and mobile app are built with Node.js.

- Download from https://nodejs.org — choose the **LTS** version (20.x).
- Install with all defaults.

Verify:
```
node --version
npm --version
```
Should show `v20.x.x` and `10.x.x` respectively.

---

### 1.4 Docker Desktop
Used to run PostgreSQL and Redis without installing them manually.

- **Windows/Mac:** Download from https://www.docker.com/products/docker-desktop/
- **Linux:** Follow https://docs.docker.com/engine/install/

After installing, open **Docker Desktop** and wait for it to say **"Engine running"** in the bottom-left corner. It must be running before you continue.

Verify:
```
docker --version
docker compose version
```

---

### 1.5 Android Studio (for mobile app)
Required to run the Android emulator or connect a physical Android device.

- Download from https://developer.android.com/studio
- During installation, make sure **Android SDK**, **Android SDK Platform**, and **Android Virtual Device** are all ticked.

After installation:
1. Open Android Studio → More Actions → SDK Manager
2. Under **SDK Platforms** tab: install **Android 14 (API 34)**
3. Under **SDK Tools** tab: make sure **Android SDK Build-Tools** and **Android Emulator** are checked

Add these to your system PATH (the exact paths depend on your username):

**Windows** — search "Environment Variables" in Start menu → edit `Path`:
```
C:\Users\YOUR_USERNAME\AppData\Local\Android\Sdk\platform-tools
C:\Users\YOUR_USERNAME\AppData\Local\Android\Sdk\emulator
```

**Mac/Linux** — add to `~/.bashrc` or `~/.zshrc`:
```bash
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/emulator
```

Verify:
```
adb --version
```

---

### 1.6 Expo CLI
The tool that builds and runs the React Native mobile app.

```
npm install -g expo-cli
```

---

## 2. Get the Code

Open a terminal in the folder where you want to store the project.

```bash
git clone https://github.com/Abdulllah-Rizwan/Agentic_AI_Triage.git
cd Agentic_AI_Triage
```

You now have the full project. The folder structure looks like this:

```
Agentic_AI_Triage/
├── apps/
│   ├── api/          ← FastAPI backend
│   ├── dashboard/    ← Next.js web dashboard
│   └── mobile/       ← React Native patient app
├── Docs/
│   └── knowledge-base/   ← Medical articles for the AI
├── docker-compose.yml
└── SETUP.md          ← this file
```

---

## 3. Get Your API Keys

The system needs two free API keys. Both take less than 2 minutes to create.

### 3.1 Groq API Key (for the AI / LLM)

Groq provides free access to Llama 3.3 70B — this powers the symptom collection and SOAP report generation.

1. Go to https://console.groq.com
2. Sign up for a free account
3. Click **"API Keys"** in the left sidebar
4. Click **"Create API Key"**
5. Give it a name like `medireach-dev` and copy the key (starts with `gsk_...`)

> **Keep this key private — do not share it or commit it to git.**

### 3.2 Generate a JWT Secret

This is a random string used to sign login tokens. Generate one by running:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Copy the output — you'll need it in the next step.

### 3.3 Generate a NextAuth Secret

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Copy this one too (it's a different secret from the JWT one above).

---

## 4. Start the Database and Redis

The project uses PostgreSQL (with the pgvector extension for AI search) and Redis (for background job queues). Docker runs both automatically.

From the **root of the project folder** (`Agentic_AI_Triage/`):

```bash
docker compose up -d
```

This downloads the database images on first run (may take 2–3 minutes) and starts them in the background.

Verify both are running:
```bash
docker compose ps
```

You should see two containers with status **"running"** or **"healthy"**:
```
NAME                        STATUS
agentic_ai_triage           running (healthy)
agentic_ai_triage_redis     running (healthy)
```

> **Every time you restart your PC**, Docker Desktop must be open and you must run `docker compose up -d` again before starting anything else.

---

## 5. Set Up the API Server

Open a **new terminal window** and navigate to the API folder:

```bash
cd Agentic_AI_Triage/apps/api
```

### 5.1 Create the environment file

Create a file named `.env` inside `apps/api/` with the following content.  
Replace the placeholder values with your actual keys from Step 3.

```env
# Database (matches docker-compose.yml — do not change these)
DATABASE_URL=postgresql+asyncpg://agentic_ai_triage:agentic_ai_triage_dev_pass@localhost:5433/agentic_ai_triage
SYNC_DATABASE_URL=postgresql://agentic_ai_triage:agentic_ai_triage_dev_pass@localhost:5433/agentic_ai_triage

# Redis (matches docker-compose.yml — do not change)
REDIS_URL=redis://localhost:6379/0

# AI / LLM — paste your Groq key here
GROQ_API_KEY=gsk_your_groq_key_here
CLOUD_LLM=groq/llama-3.3-70b-versatile

# Auth — paste the JWT secret you generated
JWT_SECRET=your_jwt_secret_here

# URLs
DASHBOARD_URL=http://localhost:3000

# App settings
ENVIRONMENT=development
PORT=3001
UPLOAD_DIR=./uploads
FAISS_EXPORT_DIR=./exports
MAX_UPLOAD_SIZE_MB=50
```

**How to create this file:**
- **Windows:** Right-click in the `apps/api/` folder → New → Text Document → rename it to `.env` (delete the `.txt` extension). Then open it with Notepad and paste the content above.
- **Mac/Linux:** `nano apps/api/.env` then paste and save with Ctrl+O, Enter, Ctrl+X.

### 5.2 Create a Python virtual environment

A virtual environment keeps the Python packages isolated from the rest of your system.

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# Mac / Linux
python3 -m venv .venv
source .venv/bin/activate
```

Your terminal prompt should now start with `(.venv)` — this means the virtual environment is active.

### 5.3 Install Python dependencies

```bash
pip install -r requirements.txt
```

This installs FastAPI, SQLAlchemy, the AI libraries, and everything else. Takes 3–5 minutes on first run.

### 5.4 Run database migrations

This creates all the database tables:

```bash
alembic upgrade head
```

You should see output ending with something like:
```
Running upgrade  -> 20260424_0001, initial schema
Running upgrade 20260424_0001 -> 20260426_0002, add rag attribution columns
Running upgrade 20260426_0002 -> 20260427_0003, drop page number
```

### 5.5 Create the uploads and exports folders

```bash
# Windows
mkdir uploads
mkdir exports

# Mac / Linux
mkdir -p uploads exports
```

### 5.6 Start the API server

```bash
python run_server.py
```

Or alternatively:
```bash
uvicorn app.main:socket_app --reload --port 3001
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:3001 (Press CTRL+C to quit)
```

Open http://localhost:3001/docs in your browser — you should see the interactive API documentation.

> **Keep this terminal open.** The API stops if you close it.

### 5.7 Start the Celery background worker

Open a **second terminal window**, navigate to `apps/api/`, activate the virtual environment again, then run:

```bash
# Windows
cd Agentic_AI_Triage/apps/api
.venv\Scripts\activate
python run_celery.py

# Mac / Linux
cd Agentic_AI_Triage/apps/api
source .venv/bin/activate
python run_celery.py
```

Or alternatively:
```bash
celery -A app.workers.soap_worker.celery_app worker --loglevel=info
```

You should see:
```
[tasks]
  . app.workers.soap_worker.generate_soap_task
  . app.workers.ingestion_worker.ingest_document_task

[2024-...] celery@hostname ready.
```

> **Keep this terminal open too.** The Celery worker handles SOAP report generation and document processing in the background.

---

## 6. Set Up the Dashboard

Open a **new terminal window** and navigate to the dashboard folder:

```bash
cd Agentic_AI_Triage/apps/dashboard
```

### 6.1 Create the environment file

Create a file named `.env.local` inside `apps/dashboard/` with the following content:

```env
# NextAuth
NEXTAUTH_SECRET=your_nextauth_secret_here
NEXTAUTH_URL=http://localhost:3000

# API connection
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

Replace `your_nextauth_secret_here` with the second random string you generated in Step 3.3.

### 6.2 Install Node dependencies

```bash
npm install
```

Takes 1–2 minutes.

### 6.3 Start the dashboard

```bash
npm run dev
```

You should see:
```
▲ Next.js 14.x.x
- Local: http://localhost:3000
- Ready in Xs
```

Open http://localhost:3000 in your browser. You will see the MediReach login page.

> **Keep this terminal open.**

---

## 7. Set Up the Mobile App

Open a **new terminal window** and navigate to the mobile folder:

```bash
cd Agentic_AI_Triage/apps/mobile
```

### 7.1 Find your computer's local IP address

The mobile app needs to connect to the API server. Since the phone/emulator is a separate device, it can't use `localhost` — it needs your computer's actual network IP address.

**Windows:**
```
ipconfig
```
Look for **"IPv4 Address"** under your active adapter — it looks like `192.168.x.x`.

**Mac:**
```
ifconfig | grep "inet 192"
```

**Linux:**
```
hostname -I
```

Note this IP address — you'll use it in the next step.

### 7.2 Create the environment file

Create a file named `.env` inside `apps/mobile/` with the following content.  
Replace `192.168.x.x` with your actual IP from Step 7.1:

```env
# Replace 192.168.x.x with your computer's local IP address
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3001

# Paste your Groq API key here (same one from Step 3.1)
EXPO_PUBLIC_GROQ_API_KEY=gsk_your_groq_key_here

# Use "development" to bypass the on-device AI model (easier for testing)
EXPO_PUBLIC_ENVIRONMENT=development

# Ollama URL (only needed when EXPO_PUBLIC_ENVIRONMENT=development)
# Replace with your computer's local IP
EXPO_PUBLIC_OLLAMA_URL=http://192.168.x.x:11434
```

> **Note on `EXPO_PUBLIC_ENVIRONMENT=development`:** In development mode, the app uses Ollama (a local AI server) instead of the 700MB on-device model. This is much easier for testing. See Section 7.4 for Ollama setup.

### 7.3 Install Node dependencies

```bash
npm install
```

### 7.4 Set up Ollama (the local AI for development mode)

Ollama lets the app run AI conversations without needing the large on-device model file.

1. Download and install Ollama from https://ollama.com
2. After installation, open a terminal and pull the model:
   ```bash
   ollama pull llama3.2:3b
   ```
   This downloads a ~2GB model file (one-time only).
3. Start the Ollama server:
   ```bash
   ollama serve
   ```
   Ollama runs on port 11434 by default.

> **If you want to use the actual on-device model instead** (closer to real deployment), see `apps/mobile/SETUP_SLM.md` for instructions on downloading the 700MB GGUF file. This is optional for basic testing.

### 7.5 Start an Android emulator or connect a device

**Option A — Android emulator:**
1. Open Android Studio
2. Click the device icon in the top toolbar (or go to **Tools → Device Manager**)
3. Click **"Create Device"** → pick Pixel 6 → Next → select Android 14 → Finish
4. Click the **▶ Play** button next to your new device
5. Wait for the emulator to fully boot (may take 2–3 minutes the first time)

**Option B — Physical Android device:**
1. On your phone: go to **Settings → About Phone** → tap **Build Number** 7 times rapidly to enable Developer Options
2. Go to **Settings → Developer Options** → enable **USB Debugging**
3. Connect your phone to the PC with a USB cable
4. Run `adb devices` in a terminal — your device should appear

### 7.6 Start the mobile app

```bash
npm run android
```

Expo will compile and install the app on your device/emulator. First build takes 3–5 minutes.

You should see the MediReach splash screen appear on the device.

---

## 8. Seed the Knowledge Base

The AI uses a medical knowledge base (WHO guidelines and emergency protocols) to give accurate guidance. You need to upload these articles to the server once.

### 8.1 Install the seeding script dependencies

Open a **new terminal window**:

```bash
cd Agentic_AI_Triage/Docs/knowledge-base
pip install requests pyyaml
```

### 8.2 Run the seeding script

```bash
python seed_server_knowledge.py
```

The script will ask you three questions:
- **API base URL:** type `http://localhost:3001`
- **Admin email:** the email you'll register with (see Section 9)
- **Admin password:** your chosen password

> **Wait:** First complete Section 9 (register the admin account), then come back and run this script.

The script uploads all 27 medical articles and waits for each one to finish processing. This takes about 5–10 minutes total. You'll see progress like:
```
[ 1/27] basic_first_aid.txt
        Title  : Basic First Aid for Disaster Zones
        Uploaded → doc_id abc-123. Waiting for processing ...
        ACTIVE — 18 chunks indexed.
[ 2/27] ...
```

### 8.3 Build the mobile RAG index (optional but recommended)

This builds the offline knowledge index that the mobile app uses when there's no internet:

```bash
cd Agentic_AI_Triage/Docs/knowledge-base
pip install faiss-cpu sentence-transformers langchain langchain-community pyyaml numpy
python build_baseline_index.py
```

Takes 2–3 minutes. Files are written directly into the mobile app's assets.

---

## 9. First Login and Admin Setup

### 9.1 Register the first admin account

1. Open http://localhost:3000 in your browser
2. Click **"Register here"**
3. Fill in the form:
   - **Organization Name:** e.g. `Test NGO`
   - **Organization Type:** pick any (e.g. NGO)
   - **Email:** your email address
   - **Password:** choose a strong password (at least 8 characters)
   - **Access Code:** choose any code (e.g. `testorg2024`) — this is what other users from the same org enter when registering

4. Click **Register**

> **Important:** The **first organization to register is automatically approved and becomes the admin**. All subsequent registrations require admin approval. So register your account first, before anyone else.

### 9.2 Log in

Go to http://localhost:3000/login, enter your email and password. You should land on the Cases dashboard.

Since you're the first user, your account has the **ADMIN** role — you'll see an "Admin" section in the left sidebar.

### 9.3 Go back and seed the knowledge base

Now that you have an admin account, go back to Section 8.2 and run the seeding script.

---

## 10. Running Everything Together

Every time you want to run the project, you need **5 things running simultaneously** in separate terminal windows:

| # | Terminal | Command | Directory |
|---|---|---|---|
| 1 | Docker | `docker compose up -d` | `Agentic_AI_Triage/` |
| 2 | API Server | `python run_server.py` | `apps/api/` (with `.venv` active) |
| 3 | Celery Worker | `python run_celery.py` | `apps/api/` (with `.venv` active) |
| 4 | Dashboard | `npm run dev` | `apps/dashboard/` |
| 5 | Mobile | `npm run android` | `apps/mobile/` |
| 6 | Ollama | `ollama serve` | anywhere |

### Quick checklist every session:

```
□ Docker Desktop is open and engine is running
□ docker compose up -d (in project root)
□ API server is running (see http://localhost:3001/docs)
□ Celery worker is running
□ Dashboard is running (see http://localhost:3000)
□ Ollama is running (ollama serve)
□ Mobile app started (npm run android)
```

---

## 11. Troubleshooting

### "docker compose" says command not found
You have an older version of Docker that uses `docker-compose` (with a hyphen) instead of `docker compose`. Try:
```bash
docker-compose up -d
```

### Database connection error when starting the API
Make sure Docker is running and the containers are healthy:
```bash
docker compose ps
```
If they show "Exit" status, restart them:
```bash
docker compose down
docker compose up -d
```

### "alembic: command not found"
The virtual environment is not activated. Run:
```bash
# Windows
.venv\Scripts\activate

# Mac / Linux
source .venv/bin/activate
```
Then try the alembic command again.

### Mobile app can't connect to API ("Network Error")
- Make sure the API server is running on port 3001
- Check your IP address in `apps/mobile/.env` — it must be your computer's LAN IP, not `localhost`
- Make sure your phone/emulator is on the same Wi-Fi network as your computer
- Check Windows Firewall: go to Windows Defender Firewall → Allow an app → make sure Node.js is allowed

### "Module not found" errors when starting the dashboard
Run `npm install` again in `apps/dashboard/`.

### Celery worker keeps restarting / crashing
Check if Redis is running:
```bash
docker compose ps
```
If Redis shows as unhealthy or stopped, restart it:
```bash
docker compose restart redis
```

### Knowledge base articles stuck in "PROCESSING"
The Celery worker handles document processing. Make sure it's running (Terminal #3). Check its output for error messages.

### Login redirects back to login page
The API server might be down. Open http://localhost:3001/docs — if that page doesn't load, restart the API server.

### Android emulator is very slow
Enable **Hardware Acceleration** in your BIOS (Intel VT-x or AMD-V). In Android Studio, go to **SDK Tools** and install **Intel HAXM** (Windows) or ensure **KVM** is enabled (Linux).

---

## Summary of Ports

| Service | Port | URL |
|---|---|---|
| Dashboard | 3000 | http://localhost:3000 |
| API Server | 3001 | http://localhost:3001 |
| PostgreSQL | 5433 | (internal — used by API) |
| Redis | 6379 | (internal — used by Celery) |
| Ollama | 11434 | (internal — used by mobile app) |

---

## Environment Files Reference

These files are **not included in the repository** (they contain secrets). You must create them manually.

| File | Purpose |
|---|---|
| `apps/api/.env` | API keys, database URL, JWT secret |
| `apps/dashboard/.env.local` | NextAuth secret, API URL |
| `apps/mobile/.env` | API URL, Groq key, Ollama URL |

Templates for all three are shown in their respective setup sections above.

---

*MediReach — Disaster Medical Intelligence System*  
*FYP Project — For questions contact the repository owner.*
