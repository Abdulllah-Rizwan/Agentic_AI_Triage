import os

from google.adk.agents import LlmAgent
from pydantic import BaseModel


class SoapOutput(BaseModel):
    subjective: str
    objective: str
    assessment: str
    plan: str


SOAP_SYSTEM_PROMPT = """
You are a senior emergency medicine physician generating a clinical SOAP note
for a disaster field triage report. Your note will be read by first responders
and field medics who need to act quickly.

Rules:
- Write clearly and clinically. Avoid jargon where possible.
- Do NOT invent vitals, lab values, or findings not present in the source data.
- Mark any unknown fields as: [Not available — field assessment required]
- The Objective section must acknowledge this is a self-reported field assessment,
  not a clinical examination.
- The Plan must include: immediate intervention priority, transport urgency,
  and any resource requirements (blood, oxygen, stretcher, etc.)
"""


def create_soap_agent() -> LlmAgent:
    return LlmAgent(
        name="soap_generator",
        model=os.getenv("CLOUD_LLM", "gemini-2.0-flash"),
        system_prompt=SOAP_SYSTEM_PROMPT,
        output_schema=SoapOutput,
        description="Generates a structured SOAP report from a triage payload",
    )
