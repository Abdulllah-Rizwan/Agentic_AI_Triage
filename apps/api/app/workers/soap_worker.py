import asyncio
import json
import os

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types
from sqlalchemy import select

from app.agents.soap_agent import create_soap_agent
from app.core.database import sync_session
from app.models.db import Case, SoapReport
from app.services import socket_emitter
from app.workers.celery_app import celery_app


async def _invoke_soap_agent(case_id: str, user_message: str) -> str:
    """Run the SOAP ADK agent and return the raw response text."""
    agent = create_soap_agent()
    session_service = InMemorySessionService()
    runner = Runner(agent=agent, app_name="medireach", session_service=session_service)
    session = session_service.create_session(app_name="medireach", user_id=case_id)

    async for event in runner.run_async(
        user_id=case_id,
        session_id=session.id,
        new_message=genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=user_message)],
        ),
    ):
        if event.is_final_response() and event.content:
            return event.content.parts[0].text

    return ""


def _strip_fences(text: str) -> str:
    """Strip markdown code fences that some models wrap JSON output in."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1]).strip()
    return text


@celery_app.task(bind=True, max_retries=3)
def generate_soap_task(self, case_id: str):
    try:
        org_id = None

        with sync_session() as db:
            case = db.get(Case, case_id)
            if not case:
                return

            user_message = (
                f"Triage Level: {case.triage_level.value}\n"
                f"Chief Complaint: {case.chief_complaint}\n"
                f"Reported Symptoms: {', '.join(case.symptoms)}\n"
                f"Severity (1-10): {case.severity}\n"
                f"Triage Reason: {case.triage_reason}\n"
                f"Conversation Summary: {case.conversation_summary}\n\n"
                "Generate the SOAP report for this patient."
            )

            response_text = asyncio.run(_invoke_soap_agent(case_id, user_message))
            if not response_text:
                raise ValueError("ADK agent returned an empty response")

            soap_data = json.loads(_strip_fences(response_text))

            # Idempotent on retry — only insert if no record exists yet
            existing = db.execute(
                select(SoapReport).where(SoapReport.case_id == case_id)
            ).scalar_one_or_none()

            if existing is None:
                db.add(SoapReport(
                    case_id=case_id,
                    subjective=soap_data["subjective"],
                    objective=soap_data["objective"],
                    assessment=soap_data["assessment"],
                    plan=soap_data["plan"],
                    model_used=os.getenv("CLOUD_LLM", "gemini-2.0-flash"),
                ))

            org_id = str(case.org_id) if case.org_id else None
            # sync_session context manager commits on normal exit

        asyncio.run(socket_emitter.emit_soap_ready(case_id=case_id, org_id=org_id))

    except Exception as exc:
        raise self.retry(exc=exc, countdown=60)
