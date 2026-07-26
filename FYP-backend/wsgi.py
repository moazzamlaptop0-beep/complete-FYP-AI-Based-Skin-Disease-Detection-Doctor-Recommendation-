"""
Production WSGI entry point.

    gunicorn -w 4 -k gthread --threads 8 -b 0.0.0.0:5000 wsgi:app

SSE WARNING
-----------
/api/doctor-updates-stream and /api/patient-updates-stream hold a worker for as
long as the dashboard tab is open. With the default sync worker, N open
dashboards permanently consume N workers and the API stops responding. Use a
threaded or async worker class and generous --timeout, or put the two stream
routes behind their own process.

SCHEDULER WARNING
-----------------
The SLA conflict job must run in EXACTLY ONE process. The monolith started
APScheduler at import, so with `-w 4` it ran four times and the same conflict
could be auto-resolved (and both patients emailed) repeatedly. Here it only
starts when RUN_SCHEDULER=true, which defaults to FALSE. Either run a dedicated
single-worker process with RUN_SCHEDULER=true, or run the job from cron/systemd
via `flask ...`. Do not set RUN_SCHEDULER=true on a multi-worker gunicorn.
"""

import os

from dotenv import load_dotenv

load_dotenv()

os.environ.setdefault("APP_ENV", "production")

from app import create_app  # noqa: E402

app = create_app(os.environ.get("APP_ENV", "production"))

application = app  # some WSGI servers look for `application`
