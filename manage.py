#!/usr/bin/env python
import os, sys

def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cesium_aqi.settings')
    try:
        import django
        django.setup()

        # Run once immediately on runserver, then start the 60s scheduler
        if len(sys.argv) > 1 and sys.argv[1] == 'runserver':
            from aqi.ingest import run_ingest_once
            from aqi.scheduler import start_every_minute, REQUIRED_TABLES
            from django.db import connection

            existing = set(connection.introspection.table_names())
            if REQUIRED_TABLES.issubset(existing):
                try:
                    print("[manage.py] Initial one-shot ingest…")
                    run_ingest_once()
                except Exception as e:
                    print(f"[manage.py] Initial ingest skipped/failed: {e}")
            else:
                print("[manage.py] Skipping initial ingest: tables not created yet. Run `python manage.py migrate` first.")

            # Start background “every minute” loop
            start_every_minute(run_ingest_once, interval_seconds=60)

    except Exception as setup_err:
        print(f"[manage.py] Django setup failed before ingest: {setup_err}")

    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)

if __name__ == '__main__':
    main()
