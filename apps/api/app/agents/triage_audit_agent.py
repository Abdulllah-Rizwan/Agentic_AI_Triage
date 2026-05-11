import os
from typing import Optional

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from pydantic import BaseModel


class AuditOutput(BaseModel):
    confirmed: bool
    escalated_to: Optional[str]
    clinical_note: str


AUDIT_SYSTEM_PROMPT = """
You are reviewing a field triage assessment made by a rule-based algorithm on a patient's phone.
Your job is to confirm or escalate the triage level based on the symptom profile.
Be conservative — if in doubt, escalate.

IMPORTANT: Respond with ONLY a valid JSON object — no markdown, no explanation, no code fences.
Use exactly this format:
{"confirmed": true, "escalated_to": null, "clinical_note": "..."}
Or if escalating:
{"confirmed": false, "escalated_to": "RED", "clinical_note": "..."}
"""


def create_audit_agent() -> LlmAgent:
    model_id = os.getenv("CLOUD_LLM", "groq/llama-3.3-70b-versatile")
    return LlmAgent(
        name="triage_auditor",
        model=LiteLlm(model=model_id),
        instruction=AUDIT_SYSTEM_PROMPT,
        output_schema=AuditOutput,
        description="Audits and optionally escalates a device-computed triage level",
    )
