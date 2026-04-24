import os

from celery import Celery

celery_app = Celery("medireach", broker=os.getenv("REDIS_URL", "redis://localhost:6379/0"))


@celery_app.task(bind=True, max_retries=3)
def ingest_document_task(self, document_id: str):
    pass
