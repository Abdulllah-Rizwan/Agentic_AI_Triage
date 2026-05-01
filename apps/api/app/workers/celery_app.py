import os

from celery import Celery

celery_app = Celery(
    "medireach",
    broker=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    # Both task modules are imported automatically on worker startup
    include=[
        "app.workers.soap_worker",
        "app.workers.ingestion_worker",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)

# Alias so `celery -A app.workers.celery_app` auto-detects the instance
app = celery_app
