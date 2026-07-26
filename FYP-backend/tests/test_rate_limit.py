"""
Rate limiting on the auth surface.

The monolith had none: /login accepted unlimited guesses at unlimited speed,
which is the entire attack. Flask-Limiter now enforces two INDEPENDENT windows
on every credential endpoint:

  per-IP     stops one machine hammering the endpoint.
  per-EMAIL  stops a botnet spread over a thousand addresses from grinding ONE
             account -- which per-IP limiting does nothing about, because every
             request comes from a different IP.

Whichever budget runs out first produces the 429.

THE BUDGETS (app/core/rate_limit.py LIMITS, documented in docs/api-contract.md)

  endpoint            per IP              per email
  ----------------------------------------------------------
  /login              30/min, 200/hour    10/min, 50/hour
  /auth/login         30/min, 200/hour    10/min, 50/hour
  /auth/check-email   60/min, 600/hour    --
  /register           10/min,  40/hour     5/min, 20/hour
  /auth/register      10/min,  40/hour     5/min, 20/hour
  /forgot-password    10/min,  40/hour     3/min, 10/hour
  /resend-otp         10/min,  60/hour     5/min, 20/hour

A human demoing the app logs in maybe five times a minute; a credential
stuffing run wants thousands. These sit an order of magnitude above the first
and three below the second, which is the whole design brief: nobody doing a viva
demo ever sees a 429.

DISABLED BY DEFAULT (dev and test). The `limited` fixture below turns it on for
one test at a time and resets the counters afterwards, because the Limiter is a
process-wide singleton and a leaked budget would fail an unrelated test twenty
minutes later.
"""

import pytest

from tests.authkit import DEFAULT_PASSWORD, install_mailbox, make_user

RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a moment and try again."


@pytest.fixture(autouse=True)
def mail(monkeypatch):
    """Autouse: these tests fire dozens of credential requests, and not one of
    them may reach a real SMTP server."""
    return install_mailbox(monkeypatch)


@pytest.fixture(scope="module")
def limited_app():
    """A SECOND application with limiting switched on.

    It cannot be the shared `app` fixture: Flask-Limiter reads RATELIMIT_ENABLED
    inside init_app and returns immediately when it is false -- no storage, no
    before_request hook. Flipping `limiter.enabled` afterwards therefore does
    nothing at all, which is why this builds a fresh app with the flag already
    true. TestingConfig is patched for the duration of create_app() only, so no
    other test in the session inherits a throttled app.
    """
    from app import create_app
    from app.config import TestingConfig
    from app.extensions import limiter

    original = TestingConfig.RATELIMIT_ENABLED
    TestingConfig.RATELIMIT_ENABLED = True
    try:
        application = create_app("testing")
    finally:
        TestingConfig.RATELIMIT_ENABLED = original

    application.config.update(TESTING=True)
    with application.app_context():
        yield application

    limiter.enabled = False


@pytest.fixture()
def limited(limited_app):
    """A test client for the throttled app, with the counters wiped.

    The Limiter is a process-wide singleton: a budget left half-spent by one
    test would fail an unrelated test later for a reason that has nothing to do
    with what it was asserting.
    """
    from app.extensions import limiter

    limiter.enabled = True
    limiter.reset()
    yield limited_app.test_client()
    limiter.reset()


def _post(client, path, body, ip="203.0.113.10"):
    """POST from a named source address. X-Forwarded-For is what
    rate_limit.client_ip() keys on, so this is how one test plays a botnet."""
    return client.post(path, json=body, headers={"X-Forwarded-For": ip})


# ======================================================================
# OFF BY DEFAULT
# ======================================================================
def test_nothing_is_throttled_when_the_flag_is_off(client, db):
    """Dev and test must never see a 429: a suite that trips the limiter fails
    for a reason that has nothing to do with what it was testing."""
    for _ in range(25):
        response = client.post("/auth/check-email", json={"email": "quiet@aiderma.local"})
        assert response.status_code == 200


# ======================================================================
# PER-EMAIL
# ======================================================================
def test_one_email_gets_three_reset_mails_a_minute(limited, db):
    """Each successful call sends a real email to a real inbox, so this is the
    tightest budget on the surface."""
    body = {"email": "target@aiderma.local"}

    for attempt in range(3):
        assert _post(limited,"/auth/forgot-password", body).status_code == 200, attempt

    blocked = _post(limited,"/auth/forgot-password", body)
    assert blocked.status_code == 429


def test_a_botnet_cannot_grind_one_account_from_many_addresses(limited, db):
    """The per-EMAIL window is the one that survives a rotating IP pool -- which
    is exactly what credential stuffing uses."""
    make_user(db, "victim@aiderma.local")

    statuses = []
    for i in range(12):
        response = _post(
            limited, "/auth/login",
            {"email": "victim@aiderma.local", "password": f"guess-{i}"},
            ip=f"198.51.100.{i}",           # a different address every time
        )
        statuses.append(response.status_code)

    assert statuses[:10] == [401] * 10      # 10 per minute, per email
    assert 429 in statuses[10:]


def test_a_different_email_has_its_own_budget(limited, db):
    for _ in range(3):
        _post(limited,"/auth/forgot-password", {"email": "first@aiderma.local"})
    assert _post(limited,"/auth/forgot-password",
                 {"email": "first@aiderma.local"}).status_code == 429

    # Someone else's password reset is unaffected.
    assert _post(limited,"/auth/forgot-password",
                 {"email": "second@aiderma.local"}).status_code == 200


# ======================================================================
# PER-IP
# ======================================================================
def test_one_machine_cannot_spray_reset_mails_across_many_addresses(limited, db):
    statuses = []
    for i in range(12):
        statuses.append(_post(
            limited, "/auth/forgot-password", {"email": f"spray{i}@aiderma.local"}
        ).status_code)

    assert statuses[:10] == [200] * 10      # 10 per minute, per IP
    assert statuses[10] == 429


def test_another_machine_is_not_punished_for_it(limited, db):
    for i in range(11):
        _post(limited,"/auth/forgot-password", {"email": f"noisy{i}@aiderma.local"})

    innocent = _post(limited,"/auth/forgot-password",
                     {"email": "innocent@aiderma.local"}, ip="192.0.2.99")
    assert innocent.status_code == 200


# ======================================================================
# THE 429 ITSELF
# ======================================================================
def test_the_429_is_the_json_envelope_with_a_retry_after(limited, db):
    body = {"email": "envelope@aiderma.local"}
    for _ in range(4):
        response = _post(limited,"/auth/forgot-password", body)

    assert response.status_code == 429
    assert response.is_json, "a JSON API must not answer with Werkzeug's HTML page"

    payload = response.get_json()
    assert payload["success"] is False
    assert payload["error"] == RATE_LIMIT_MESSAGE
    assert "message" not in payload         # the envelope omits falsy keys

    retry_after = response.headers.get("Retry-After")
    assert retry_after is not None
    assert 0 < int(retry_after) <= 3600


def test_the_429_never_says_whether_the_account_exists(limited, db):
    make_user(db, "real.person@aiderma.local")

    for _ in range(4):
        real = _post(limited,"/auth/forgot-password", {"email": "real.person@aiderma.local"})
    for _ in range(4):
        fake = _post(limited,"/auth/forgot-password", {"email": "nobody.here@aiderma.local"},
                     ip="203.0.113.55")

    assert real.status_code == fake.status_code == 429
    assert real.get_json() == fake.get_json()


# ======================================================================
# SCOPE
# ======================================================================
def test_each_endpoint_has_its_own_budget(limited, db):
    """Spending the /auth/forgot-password budget must not lock a user out of
    logging in -- they are different buckets."""
    make_user(db, "scoped@aiderma.local")

    for _ in range(4):
        _post(limited,"/auth/forgot-password", {"email": "scoped@aiderma.local"})

    login = _post(limited,"/auth/login",
                  {"email": "scoped@aiderma.local", "password": DEFAULT_PASSWORD})
    assert login.status_code == 200


def test_the_legacy_login_route_is_limited_too(limited, db):
    """Leaving /login unlimited while /auth/login is limited would be a hole in
    the shape of the endpoint the CURRENT frontend actually calls."""
    make_user(db, "legacy.limited@aiderma.local")

    statuses = [
        _post(limited,"/login",
              {"email": "legacy.limited@aiderma.local", "password": "wrong"}).status_code
        for _ in range(12)
    ]
    assert statuses[:10] == [401] * 10
    assert 429 in statuses[10:]


def test_a_demo_session_is_never_throttled(limited, db):
    """The constraint was 'must not throttle the demo/test flows into
    uselessness'. Eight logins plus a handful of check-email calls -- more than
    any live demo does -- must all sail through."""
    make_user(db, "demo.user@aiderma.local")

    for _ in range(8):
        response = _post(limited,"/auth/login",
                         {"email": "demo.user@aiderma.local", "password": DEFAULT_PASSWORD})
        assert response.status_code == 200

    for _ in range(20):
        assert _post(limited,"/auth/check-email",
                     {"email": "demo.user@aiderma.local"}).status_code == 200
