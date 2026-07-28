"""
SMTP email sending.

`send_email` is the monolith's function (lines 198-219) with TWO differences:

1. Every knob (host, port, SSL mode, credentials, timeout, the master
   email_enabled switch) now resolves through
   app/services/settings_service.py, i.e. DB row -> current_app.config ->
   os.environ -> default. The config/env legs of that cascade are exactly the
   lookups this file used to do itself, so behaviour without any
   system_settings rows is unchanged -- including outside an app context (the
   APScheduler job and CLI commands call this without one).

2. `raise_errors`. The default (False) keeps the monolith's return contract:
   True on success, False on ANY failure, never raises -- several callers
   treat a failed send as non-fatal. POST /admin/settings/test-email passes
   raise_errors=True because its entire purpose is showing the admin the real
   smtplib error text; swallowing it there would make the button useless.
"""

import logging
import smtplib
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


def send_email(to_email, subject, body, raise_errors=False):
    from app.services import settings_service as settings

    if not settings.get_bool("EMAIL_ENABLED", True):
        logger.warning(
            "Email sending is disabled (email_enabled=false); dropping message to %s", to_email
        )
        if raise_errors:
            raise RuntimeError("Email sending is disabled (email_enabled is false).")
        return False

    sender = settings.get_effective("EMAIL_USER")
    password = settings.get_effective("EMAIL_PASS")

    if not sender or not password:
        logger.error("Email credentials missing in environment variables.")
        if raise_errors:
            raise RuntimeError(
                "Email credentials are not configured (email_user / email_pass)."
            )
        return False

    host = settings.get_effective("SMTP_HOST", "smtp.gmail.com")
    port = settings.get_int("SMTP_PORT", 465)
    use_ssl = settings.get_bool("SMTP_USE_SSL", True)
    timeout = settings.get_int("EMAIL_TIMEOUT_SECONDS", 20)

    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From'] = sender
    msg['To'] = to_email

    try:
        if use_ssl:
            # Implicit TLS (port 465 style) -- the monolith's only path.
            with smtplib.SMTP_SSL(host, port, timeout=timeout) as server:
                server.login(sender, password)
                server.sendmail(sender, [to_email], msg.as_string())
        else:
            # Plain connection upgraded via STARTTLS (port 587 style).
            with smtplib.SMTP(host, port, timeout=timeout) as server:
                server.starttls()
                server.login(sender, password)
                server.sendmail(sender, [to_email], msg.as_string())
        logger.info(f"Email sent successfully to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Email Error to {to_email}: {e}")
        if raise_errors:
            raise
        return False


__all__ = ["send_email"]
