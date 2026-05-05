"""Celery worker launcher that works without a terminal (isatty-safe)."""
import io
import os
import sys
import traceback

LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "celery_out.log")
_logfile = open(LOG_PATH, "w", buffering=1, encoding="utf-8")


class SafeStream:
    def __init__(self, f):
        self._f = f

    def write(self, s):
        try:
            if isinstance(s, bytes):
                s = s.decode("utf-8", errors="replace")
            self._f.write(s)
            self._f.flush()
        except Exception:
            pass
        return len(s) if s else 0

    def flush(self):
        try:
            self._f.flush()
        except Exception:
            pass

    def isatty(self):
        return False

    def fileno(self):
        raise io.UnsupportedOperation("fileno")

    def readable(self):
        return False

    def writable(self):
        return True


sys.stdout = SafeStream(_logfile)
sys.stderr = SafeStream(_logfile)

# Celery's term.py calls sys.stdin.isatty() — patch stdin too
class SafeStdin:
    def read(self, n=-1): return ""
    def readline(self): return ""
    def isatty(self): return False
    def fileno(self): raise io.UnsupportedOperation("fileno")

sys.stdin = SafeStdin()  # type: ignore[assignment]

_logfile.write("=== run_celery.py starting ===\n")
_logfile.flush()

try:
    from app.workers.celery_app import celery_app
    _logfile.write("celery_app imported\n")
    _logfile.flush()

    # pydantic-settings reads .env into Python attributes but does NOT write
    # them back into os.environ.  Google ADK reads GOOGLE_API_KEY directly
    # from os.environ, so we propagate the values here.
    from app.core.config import settings
    import os as _os
    _os.environ.setdefault("GOOGLE_API_KEY", settings.GOOGLE_API_KEY)
    _os.environ.setdefault("CLOUD_LLM", settings.CLOUD_LLM)
    _logfile.write(f"GOOGLE_API_KEY propagated (len={len(settings.GOOGLE_API_KEY)})\n")
    _logfile.flush()

    worker = celery_app.Worker(
        include=["app.workers.soap_worker", "app.workers.ingestion_worker"],
        loglevel="info",
        logfile=LOG_PATH,
        pool="solo",
    )
    _logfile.write("worker created, starting...\n")
    _logfile.flush()
    worker.start()
except Exception as e:
    _logfile.write(f"EXCEPTION: {e}\n")
    _logfile.write(traceback.format_exc())
    _logfile.flush()
