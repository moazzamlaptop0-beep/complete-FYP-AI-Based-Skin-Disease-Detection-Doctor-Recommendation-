"""
Gemini chatbot proxy.

Prompt text moved VERBATIM from app.py:2993-2998. Reword it and the assistant's
persona changes, which users notice.

Preserved quirk: `genai.configure()` runs PER REQUEST, exactly as in the
monolith. It is a cheap global setter, and hoisting it to import time would
make the module fail to import when GEMINI_API_KEY is absent.
"""

import logging

logger = logging.getLogger(__name__)


class GeminiKeyMissing(Exception):
    """No API key configured -> the route answers 'Service currently unavailable'."""


def _config(key, default=None):
    try:
        from flask import current_app

        if current_app:
            return current_app.config.get(key, default)
    except Exception:
        pass
    import os

    return os.environ.get(key, default)


def build_prompt(user_message, user_role):
    """Role-conditioned prompt. `user_role` is 'Doctor', 'Admin' or anything
    else (the monolith passes the literal 'Guest' for anonymous callers)."""
    if user_role == 'Doctor':
        return f"You are an advanced Medical AI Assistant helping a Dermatologist/Doctor on a SkinCare dashboard. Keep your answers highly professional, medically accurate, and concise. Do not talk to them like a patient. Doctor says: {user_message}"
    if user_role == 'Admin':
        return f"You are a System Admin AI Assistant for a SkinCare app dashboard. Help the admin with system management, general technical advice, or app overview. Admin says: {user_message}"
    return f"You are a helpful and professional Medical AI Assistant for a SkinCare app. Keep your answers concise, empathetic, and strictly related to dermatology or the user's queries. Treat the user as a patient. User says: {user_message}"


def generate_reply(user_message, user_role='Guest'):
    """Return the model's text.

    Raises GeminiKeyMissing when unconfigured (the route maps that to the 500
    'Service currently unavailable'); any other exception propagates and the
    route maps it to the 500 'AI service error'. Those two distinct messages
    are part of the contract.
    """
    import google.generativeai as genai

    api_key = _config("GEMINI_API_KEY")
    if not api_key:
        logger.error("Gemini API key missing")
        raise GeminiKeyMissing()

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(_config("GEMINI_MODEL", "gemini-2.5-flash"))

    response = model.generate_content(
        build_prompt(user_message, user_role),
        generation_config=genai.types.GenerationConfig(
            max_output_tokens=int(_config("GEMINI_MAX_OUTPUT_TOKENS", 800) or 800),
            temperature=float(_config("GEMINI_TEMPERATURE", 0.7) or 0.7),
        ),
    )
    return response.text


__all__ = ["GeminiKeyMissing", "build_prompt", "generate_reply"]
