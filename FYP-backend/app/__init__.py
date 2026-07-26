"""
Application factory.

    from app import create_app
    app = create_app()            # or create_app("production")

WHY root_path IS SET EXPLICITLY
-------------------------------
The monolith was `Flask(__name__)` inside FYP-backend/app.py, so `root_path`
was FYP-backend and `static_folder` resolved to FYP-backend/static. In a
PACKAGE, `Flask(__name__)` would set root_path to FYP-backend/app, quietly
moving the static folder and breaking /static/uploads/<file> for all 295
existing images. Pinning root_path to BASE_DIR reproduces the monolith exactly.

WHY static_folder IS NOW None  (phase 3C -- image privacy)
----------------------------------------------------------
It used to be BASE_DIR/static with static_url_path="/static", which registered
Flask's BUILT-IN `/static/<path:filename>` rule over the SAME directory tree as
the media blueprint's `/static/uploads/<path:filename>`. Werkzeug's specificity
ordering sent the canonical spelling to the blueprint, but these three fell
through to the built-in endpoint and returned full-resolution patient
photographs without ever entering the blueprint's view -- so no guard, no log
line, and no authentication could ever have applied to them:

    GET /static/./uploads/<file>     -> endpoint 'static', 200   (VERIFIED)
    GET /static/uPloads/<file>       -> endpoint 'static', 200   (VERIFIED,
                                        case-insensitive filesystem)
    GET /static/uploads%2F<file>     -> endpoint 'static', 200   (VERIFIED)

With static_folder=None that rule does not exist, and `/static/uploads/<file>`
is served solely by app/api/media/routes.py -- which is deprecated, logged, and
scheduled for removal once every page reads /api/scans/<id>/image instead.
NOTHING ELSE lived under static/: the whole tree is static/uploads, which holds
both scan images and doctor profile photos, and the media blueprint serves all
of it. Do not "restore" static_folder without re-reading that module.

WHAT DELIBERATELY DOES NOT HAPPEN HERE
--------------------------------------
* No Base.metadata.create_all() in the boot path. Alembic owns the schema now.
  (Guarded behind AUTO_CREATE_ALL, default False, for the test fixture only.)
* No TensorFlow import. app/services/ml_service.py loads the model on first
  prediction, so a missing .h5 no longer makes the whole app unimportable.
* No APScheduler start unless RUN_SCHEDULER is true. The monolith started it at
  import, so every gunicorn worker ran a duplicate SLA job.
"""

import logging

from flask import Flask

from app.config import BASE_DIR, get_config

__version__ = "2.0.0-refactor"

logger = logging.getLogger(__name__)


def create_app(config_name=None):
    config_class = get_config(config_name)
    config_class.validate()

    app = Flask(
        __name__,
        root_path=BASE_DIR,          # see module docstring -- do not remove
        # SECURITY: None, so Flask registers NO /static/<path:filename> rule.
        # See the module docstring for the three URL spellings this closes.
        static_folder=None,
    )
    app.config.from_object(config_class)

    # Flask 3.1 defaults to sort_keys=True. The 39 responses were captured with
    # alphabetical key order; flipping this changes bytes on the wire.
    app.json.sort_keys = app.config.get("JSON_SORT_KEYS", True)

    # ---- logging ------------------------------------------------------
    from app.core.logging import init_logging

    init_logging(app)

    # ---- database -----------------------------------------------------
    from app.core.db import init_engine

    if app.config.get("DATABASE_URL"):
        init_engine(app.config["DATABASE_URL"])

    if app.config.get("AUTO_CREATE_ALL", False):
        # Test fixtures only. Never in dev or production -- create_all() and
        # Alembic disagreeing about the schema is exactly the drift this
        # refactor exists to eliminate.
        from app.core.db import get_engine
        from app.models import Base

        Base.metadata.create_all(bind=get_engine())
        logger.warning("AUTO_CREATE_ALL is on: schema created outside Alembic.")

    # ---- extensions ---------------------------------------------------
    from app.extensions import init_extensions

    init_extensions(app)

    # ---- errors -------------------------------------------------------
    from app.core.errors import register_error_handlers

    register_error_handlers(app)

    # ---- blueprints ---------------------------------------------------
    from app.api import register_blueprints

    register_blueprints(app)

    # ---- CLI ----------------------------------------------------------
    from app.cli import register_cli

    register_cli(app)

    # ---- optional eager work -----------------------------------------
    if app.config.get("EAGER_MODEL_LOAD", False):
        from app.services import ml_service

        ml_service.warm_up()

    if app.config.get("RUN_SCHEDULER", False):
        from app.extensions import start_scheduler

        start_scheduler(app)

        # Image retention sweep (soft-deleted pixels + old image_access_log
        # rows). Same single-process guard as the SLA job -- it shares that
        # scheduler -- and it is a no-op unless IMAGE_PURGE_JOB is on.
        from app.jobs.purge_images import start_purge_job

        start_purge_job(app)

    logger.info(
        "AI Dermatologist backend ready (env=%s, rules=%d)",
        app.config.get("ENV_NAME"),
        len(list(app.url_map.iter_rules())),
    )
    return app


__all__ = ["create_app", "__version__"]
