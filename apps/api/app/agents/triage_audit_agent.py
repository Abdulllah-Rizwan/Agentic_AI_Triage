import os
from typing import Optional

from google.adk.agents import LlmAgent
from pydantic import BaseModel


class AuditOutput(BaseModel):
    confirmed: bool
    escalated_to: Optional[str]
    clinical_note: str


AUDIT_SYSTEM_PROMPT = """
You are reviewing a field triage assessment made by a rule-based algorithm on a patient's phone.
Your job is to confirm or escalate the triage level based on the symptom profile.
Respond ONLY with the JSON schema provided. Be conservative — if in doubt, escalate.
"""


def create_audit_agent() -> LlmAgent:
    return LlmAgent(
        name="triage_auditor",
        model=os.getenv("CLOUD_LLM", "gemini-2.0-flash"),
        system_prompt=AUDIT_SYSTEM_PROMPT,
        output_schema=AuditOutput,
        description="Audits and optionally escalates a device-computed triage level",
    )
