"""
Pytest fixtures.

DATABASE SAFETY
---------------
The `db` fixture DROPS AND RECREATES every table it touches. It therefore
refuses to run against the development database: set TEST_DATABASE_URL to a
dedicated database (e.g. ai_derma_test), or the DB-backed tests skip. Tests
that need no database (the whole RBAC matrix, for one) run regardless.

The app fixture uses TestingConfig, which turns off the scheduler, the rate
limiter and eager model loading, so a test run never starts a background job,
never issues a 429, and never imports TensorFlow.
"""

import os
import sys

import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(BASE_DIR, ".env"))

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
DEV_DATABASE_URL = os.environ.get("DATABASE_URL")

# Never let a test suite destroy the dev database by accident.
HAS_TEST_DB = bool(TEST_DATABASE_URL) and TEST_DATABASE_URL != DEV_DATABASE_URL


@pytest.fixture(scope="session")
def app():
    """A TestingConfig app.

    AUTO_CREATE_ALL is on in TestingConfig, so the schema is built from the
    models rather than by running Alembic -- fast, and the migration is
    verified separately by `alembic upgrade head` against a real database.
    """
    os.environ["APP_ENV"] = "testing"
    os.environ["RUN_SCHEDULER"] = "false"
    os.environ["RATELIMIT_ENABLED"] = "false"
    os.environ["EAGER_MODEL_LOAD"] = "false"

    if HAS_TEST_DB:
        os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    else:
        # No test database configured: build the app WITHOUT touching the
        # schema, so pure-logic tests still run.
        os.environ["AUTO_CREATE_ALL"] = "false"

    from app import create_app

    application = create_app("testing")
    application.config.update(TESTING=True, AUTO_CREATE_ALL=HAS_TEST_DB)

    with application.app_context():
        yield application


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture(scope="session")
def _schema(app):
    """Build the schema ONCE per session.

    Previously the `db` fixture ran drop_all + create_all for every single
    test. Across ~20 tables and a suite this size that dominated the runtime
    (minutes of DDL to hand each test an empty database it could have had for
    the cost of one TRUNCATE). The schema is identical for every test, so it
    is built once here and each test only gets its ROWS cleared.
    """
    if not HAS_TEST_DB:
        pytest.skip(
            "Set TEST_DATABASE_URL to a dedicated database (not DATABASE_URL) "
            "to run DB-backed tests."
        )

    from app.core.db import get_engine
    from app.models import Base

    engine = get_engine()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db(_schema):
    """An empty database per test. Skips unless TEST_DATABASE_URL is set.

    One TRUNCATE ... RESTART IDENTITY CASCADE over every table gives the same
    isolation drop_all/create_all gave -- no rows, and sequences back at 1 so
    id-sensitive assertions stay stable -- without re-issuing the DDL.
    """
    from sqlalchemy import text

    from app.core.db import SessionLocal
    from app.models import Base

    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    if tables:
        with _schema.begin() as connection:
            connection.execute(
                text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")
            )

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def make_token(app):
    """Mint a valid access token for an arbitrary (user_id, role) pair."""

    def _make(user_id, role, hours=1):
        from app.core.security import encode_access_token

        with app.test_request_context():
            return encode_access_token(user_id, role, hours=hours)

    return _make


@pytest.fixture()
def auth_headers(make_token):
    def _headers(user_id, role, act_as=None):
        headers = {"Authorization": f"Bearer {make_token(user_id, role)}"}
        if act_as is not None:
            headers["X-Act-As-User-Id"] = str(act_as)
        return headers

    return _headers


@pytest.fixture(autouse=True)
def _clear_request_identity():
    """Wipe g.actor / g.principal around every test.

    WHY THIS IS NEEDED (it is a test-harness artifact, not a product bug):
    the `app` fixture is session-scoped and pushes ONE application context for
    the whole run. Flask only pushes a fresh app context for a request when the
    top one belongs to a different app -- so every test_client() call REUSES
    that context, and therefore reuses its `g`. The identity a request handler
    stored in g.actor then survives into the next test, where a pure-logic
    assertion like `resolve_actor(..., actor=None)` silently picks up a
    leftover admin and returns True.

    In production nothing shares a `g`: each request pushes and pops its own
    application context. Only the long-lived fixture context creates the leak,
    so it is cleared here rather than worked around in rbac.py.
    """
    from flask import g, has_app_context

    def _wipe():
        if not has_app_context():
            return
        for attribute in ("actor", "principal"):
            try:
                delattr(g, attribute)
            except (AttributeError, KeyError):
                pass

    _wipe()
    yield
    _wipe()
