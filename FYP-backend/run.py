"""
Development entry point.

    .venv/Scripts/python.exe run.py

Replaces the monolith's `if __name__ == '__main__': app.run(...)`.

The scheduler is turned on here (unless $RUN_SCHEDULER says otherwise) because
`flask run` in debug mode spawns a reloader child; the guard below makes sure
the SLA job runs in exactly ONE of the two processes instead of both.
"""

import os

from dotenv import load_dotenv

load_dotenv()

# The Werkzeug reloader runs this file twice: once in the parent watcher and
# once in the child that actually serves. WERKZEUG_RUN_MAIN is only set in the
# child, so the scheduler starts exactly once.
_is_reloader_parent = os.environ.get("FLASK_DEBUG", "1") != "0" and not os.environ.get("WERKZEUG_RUN_MAIN")
if "RUN_SCHEDULER" not in os.environ:
    os.environ["RUN_SCHEDULER"] = "false" if _is_reloader_parent else "true"

from app import create_app  # noqa: E402

app = create_app(os.environ.get("APP_ENV", "development"))


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "1") != "0"

    rules = [r for r in app.url_map.iter_rules() if r.endpoint != "static"]
    print(f" * AI Dermatologist backend -- {len(rules)} routes registered")
    print(f" * http://{host}:{port}   (debug={debug})")

    # threaded=True matters: the two SSE endpoints hold a connection open
    # indefinitely, and a single-threaded dev server would block every other
    # request behind them.
    app.run(host=host, port=port, debug=debug, threaded=True)
