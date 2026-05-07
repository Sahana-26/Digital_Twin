# aqi/scheduler.py
import os
import threading
import time
from django.db import connection, connections

_started = False

REQUIRED_TABLES = {"waqi_stations", "waqi_readings", "waqi_temp_readings"}

def _tables_exist() -> bool:
    try:
        existing = set(connection.introspection.table_names())
        return REQUIRED_TABLES.issubset(existing)
    except Exception:
        return False

def start_every_minute(worker_func, interval_seconds: int = 60):
    """
    Starts a daemon thread that runs worker_func every `interval_seconds`.
    Designed to be called from manage.py *only on runserver*.
    """
    global _started
    # Avoid double-start with Django's autoreloader (only start in the reloaded process)
    if _started or os.environ.get("RUN_MAIN") != "true":
        return
    _started = True

    def loop():
        print("[scheduler] started: ingest every", interval_seconds, "seconds")
        while True:
            try:
                if _tables_exist():
                    worker_func()
                else:
                    print("[scheduler] tables not ready yet; skipping this tick")
            except Exception as e:
                print(f"[scheduler] worker error: {e}")
            finally:
                # Close DB connections to avoid leaks in long-running thread
                connections.close_all()
            time.sleep(interval_seconds)

    t = threading.Thread(target=loop, name="aqi-ingest-scheduler", daemon=True)
    t.start()
