"""
Logging setup.

Mirrors the monolith's single `logging.basicConfig(level=INFO,
format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')` (line 45) so
existing log-scraping habits still work, but routes it through the app factory
so it can be configured per environment and optionally written to a file.
"""

import logging
import os
import sys

_CONFIGURED = False


def init_logging(app=None):
    global _CONFIGURED

    level_name = (app.config.get("LOG_LEVEL") if app else os.environ.get("LOG_LEVEL")) or "INFO"
    fmt = (
        app.config.get("LOG_FORMAT")
        if app
        else "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    log_file = app.config.get("LOG_FILE") if app else os.environ.get("LOG_FILE")

    level = getattr(logging, str(level_name).upper(), logging.INFO)

    root = logging.getLogger()
    if not _CONFIGURED:
        logging.basicConfig(level=level, format=fmt, stream=sys.stdout)
        _CONFIGURED = True
    root.setLevel(level)

    if log_file:
        already = any(
            isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", None) == os.path.abspath(log_file)
            for h in root.handlers
        )
        if not already:
            os.makedirs(os.path.dirname(os.path.abspath(log_file)) or ".", exist_ok=True)
            handler = logging.FileHandler(log_file, encoding="utf-8")
            handler.setFormatter(logging.Formatter(fmt))
            root.addHandler(handler)

    # TensorFlow and APScheduler are extremely chatty at INFO.
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    logging.getLogger("werkzeug").setLevel(level)

    if app is not None:
        app.logger.setLevel(level)

    return root


def get_logger(name):
    return logging.getLogger(name)
