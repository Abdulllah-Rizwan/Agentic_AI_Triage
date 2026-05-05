"""Uvicorn launcher that works without a terminal (isatty-safe)."""
import io
import os
import sys
import traceback

LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server_out.log")
_logfile = open(LOG_PATH, "w", buffering=1, encoding="utf-8")


def _log(msg):
    _logfile.write(msg + "\n")
    _logfile.flush()


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

_log("=== run_server.py starting ===")

try:
    import logging
    logging.basicConfig(
        stream=_logfile,
        level=logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    _log("logging configured")

    import uvicorn
    _log("uvicorn imported")

    _log("calling uvicorn.run ...")
    uvicorn.run(
        "app.main:socket_app",
        host="127.0.0.1",
        port=3001,
        log_level="warning",
        log_config=None,
        access_log=False,
    )
    _log("uvicorn.run returned (server stopped)")
except Exception as e:
    _log(f"EXCEPTION: {e}")
    _log(traceback.format_exc())
