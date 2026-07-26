"""
SMTP email sending.

`send_email` is the monolith's function (lines 198-219) with ONE difference:
credentials and host/port come from config when an app context is available,
falling back to the same os.environ lookups when it is not (the APScheduler
job and CLI commands call this outside a request). The return contract is
unchanged: True on success, False on any failure -- it never raises, because
several callers treat a failed send as non-fatal.
"""

import logging
import smtplib
from email.mime.text import MIMEText

logger = logging.getLogger(__name__)


def _setting(key, env_key, default=None):
    try:
        from flask import current_app

        if current_app:
            return current_app.config.get(key, default)
    except Exception:
        pass
    import os

    return os.environ.get(env_key, default)


def send_email(to_email, subject, body):
    sender = _setting("EMAIL_USER", "EMAIL_USER")
    password = _setting("EMAIL_PASS", "EMAIL_PASS")

    if not sender or not password:
        logger.error("Email credentials missing in environment variables.")
        return False

    host = _setting("SMTP_HOST", "SMTP_HOST", "smtp.gmail.com")
    port = int(_setting("SMTP_PORT", "SMTP_PORT", 465) or 465)
    timeout = int(_setting("EMAIL_TIMEOUT_SECONDS", "EMAIL_TIMEOUT_SECONDS", 20) or 20)

    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From'] = sender
    msg['To'] = to_email

    try:
        with smtplib.SMTP_SSL(host, port, timeout=timeout) as server:
            server.login(sender, password)
            server.sendmail(sender, [to_email], msg.as_string())
        logger.info(f"Email sent successfully to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Email Error to {to_email}: {e}")
        return False


__all__ = ["send_email"]
