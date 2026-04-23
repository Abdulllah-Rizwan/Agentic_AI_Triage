# AGENTS.md — Agentic AI Triage Backend Agents

This file documents every AI agent in the backend, how they are structured using Google ADK, how to run them in isolation for testing, and what good vs bad output looks like.

Read this before editing any file in `apps/api/app/agents/`.

---

## What is Google ADK?

Google Agent Development Kit (ADK) is a framework for building AI agents backed by Gemini models. In this project it handles:
- The agent loop (system prompt + user message → model call → structured output)
- Enforcing structured JSON output via Pydantic schemas (`output_schema`)
- Tool-calling if agents need to call external functions

We use ADK on the **server only**. The mobile app has its own hand-written agent loop because ADK requires Python and network access.

**Install:**
```bash
pip install google-adk
```

**Key ADK concepts used here:**
- `LlmAgent` — the main agent class
- `Runner` — executes the agent given a user message
- `output_schema` — a Pydantic model; ADK forces the LLM to return valid JSON matching this schema
- `InMemorySessionService` — stores conversation history in RAM (fine for our stateless workers)

---

## Agent 1: SOAP Generation Agent

**File:** `apps/api/app/agents/soap_agent.py`
**Triggered by:** Celery worker when a RED or AMBER case is received
**Input:** Triage payload fields (chief complaint, symptoms, severity, conversation summary)
**Output:** Structured SOAP report (4 fields: subjective, objective, assessment, plan)

### What it does
Takes a compressed triage record and expands it into a full clinical SOAP note that field medics and doctors can read. It is explicitly told not to invent information — unknown fields must be marked as `[Not available — field assessment required]`.

### How to test it manually

Create a file `apps/api/test_soap_agent.py` and run it directly:

```python
# apps/api/test_soap_agent.py
import asyncio, json, os
from dotenv import load_dotenv
load_dotenv()

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types
from app.agents.soap_agent import create_soap_agent

TEST_PAYLOAD = """
Triage Level: RED
Chief Complaint: Severe chest pain with difficulty breathing
Reported Symptoms: chest pain, shortness of breath, left arm numbness, sweating
Severity (1-10): 9
Triage Reason: Keyword match on 'chest pain' and 'difficulty breathing'; severity >= 8
Conversation Summary: 55-year-old male, pain started 30 minutes ago, 
describes it as crushing, radiating to left arm. No known allergies mentioned.
No medications reported.

Generate the SOAP report for this patient.
"""

async def main():
    agent = create_soap_agent()
    session_service = InMemorySessionService()
    runner = Runner(agent=agent, app_name="test", session_service=session_service)
    session = session_service.create_session(app_name="test", user_id="test-user")

    async for event in runner.run_async(
        user_id="test-user",
        session_id=session.id,
        new_message=genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=TEST_PAYLOAD)]
        ),
    ):
        if event.is_final_response() and event.content:
            print(json.dumps(json.loads(event.content.parts[0].text), indent=2))
            break

asyncio.run(main())
```

Run it:
```bash
cd apps/api
source .venv/bin/activate
python test_soap_agent.py
```

### What good output looks like

```json
{
  "subjective": "55-year-old male presenting with severe crushing chest pain rated 9/10, onset 30 minutes ago. Pain radiates to the left arm. Associated symptoms include shortness of breath and diaphoresis. No known drug allergies reported. No current medications documented.",
  "objective": "Self-reported field assessment only — no clinical examination performed. Patient is conscious and communicative. Reports crushing chest pain 9/10. Diaphoresis noted by patient. Vital signs unavailable — field assessment required.",
  "assessment": "Clinical presentation is consistent with Acute Coronary Syndrome (ACS), rule out ST-elevation myocardial infarction (STEMI). High-priority cardiac emergency.",
  "plan": "1. IMMEDIATE transport — highest priority. 2. Administer aspirin 300mg if not contraindicated and available. 3. Maintain patient in semi-recumbent position. 4. Oxygen if available. 5. Do NOT delay transport for further assessment. 6. Alert receiving facility: suspected STEMI inbound."
}
```

### What bad output looks like (and what to do)
- **Invents vital signs** (e.g. `"BP: 140/90"`) → Tighten the system prompt: add "You MUST NOT fabricate any clinical measurement"
- **Returns plain text instead of JSON** → Check `output_schema` is correctly set on the `LlmAgent`; ADK should enforce this
- **Plan is too vague** (e.g. `"Seek medical help"`) → Add to system prompt: "The plan must include specific interventions, transport urgency, and resource requirements"

---

## Agent 2: Triage Audit Agent

**File:** `apps/api/app/agents/triage_audit_agent.py`
**Triggered by:** `/ingest` route, synchronously, only when `network_mode == "FULL"` in the payload
**Input:** Device-computed triage level + symptom profile
**Output:** Confirmation or escalation of the triage level

### What it does
The mobile device computes triage using a rule-based engine. This agent audits that result using the more capable cloud LLM. It can only escalate (e.g. AMBER → RED) — it can never de-escalate (it cannot downgrade RED to AMBER, as that would be unsafe).

### Escalation rule (enforced in code, not by the agent)
After the agent responds, the calling code checks:
```python
if audit.escalated_to == "RED" and case.triage_level == "AMBER":
    case.triage_level = "RED"
    case.triage_reason += f" [Escalated by cloud audit: {audit.clinical_note}]"
# Never downgrade — ignore audit if it suggests lower severity
```

### How to test it manually

```python
# apps/api/test_audit_agent.py
import asyncio, json, os
from dotenv import load_dotenv
load_dotenv()

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types
from app.agents.triage_audit_agent import create_audit_agent

TEST_PAYLOAD = """
Device computed triage: AMBER
Chief Complaint: Headache and confusion after building collapsed on patient
Symptoms: headache, confusion, dizziness, nausea
Severity: 6

Confirm or escalate this triage level.
"""

async def main():
    agent = create_audit_agent()
    session_service = InMemorySessionService()
    runner = Runner(agent=agent, app_name="test", session_service=session_service)
    session = session_service.create_session(app_name="test", user_id="test-user")

    async for event in runner.run_async(
        user_id="test-user",
        session_id=session.id,
        new_message=genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=TEST_PAYLOAD)]
        ),
    ):
        if event.is_final_response() and event.content:
            print(json.dumps(json.loads(event.content.parts[0].text), indent=2))
            break

asyncio.run(main())
```

### What good output looks like

```json
{
  "confirmed": false,
  "escalated_to": "RED",
  "clinical_note": "Confusion following crush injury to head suggests traumatic brain injury (TBI). Escalating to RED — altered mental status after head trauma is a neurological emergency."
}
```

---

## Switching the Model

All agents read the model name from the `CLOUD_LLM` environment variable. To test with a different model:

```bash
# In apps/api/.env
CLOUD_LLM=gemini-1.5-flash   # cheaper if 2.0-flash quota is exhausted
```

Do not hardcode model names in agent files. Always use:
```python
import os
model = os.getenv("CLOUD_LLM", "gemini-2.0-flash")
```

---

## Free Tier Limits (Gemini)

| Limit | Value | Impact |
|-------|-------|--------|
| Requests per minute | 15 RPM | Fine for demo; 1 SOAP job = 1 request |
| Tokens per day | 1,000,000 | Roughly 500–700 SOAP reports per day |
| Context window | 1M tokens | Not a concern for our payloads |

If you hit rate limits during testing, add a `time.sleep(5)` between test calls. In production the Celery queue naturally throttles submission rate.
