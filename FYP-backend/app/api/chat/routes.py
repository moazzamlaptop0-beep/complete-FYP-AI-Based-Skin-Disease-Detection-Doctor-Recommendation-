"""
Gemini-backed assistant proxy  --  PORTED

===========================================================================
ROUTES IN THIS BLUEPRINT (1 of the 39)
Reference implementation: legacy/app_monolith.py at the line ranges given.
Full request/response contract: docs/api-contract.md  (section 9)
===========================================================================
  /api/chat  POST  @require_permission(optional=True)  chat_proxy()  [monolith 2974-3012]

---------------------------------------------------------------------------
NON-NEGOTIABLES PRESERVED HERE
---------------------------------------------------------------------------
  * The optional Bearer token only selects the PROMPT VARIANT
    (Doctor / Admin / everything else, where anonymous callers become the
    LITERAL string 'Guest'). An expired or malformed token is IGNORED, never
    rejected -- FloatingChatbot.jsx is reachable from the public landing page.
  * THREE distinct responses, all required verbatim:
      missing/empty `message` -> 400 'Message cannot be empty'
      missing API key         -> 500 'Service currently unavailable'
      anything else           -> 500 'AI service error'
  * `request.get_json()` is called WITHOUT silent=True, inside the try, exactly
    as the monolith did. A non-JSON body therefore raises, is caught by the
    bare `except Exception`, and answers 500 'AI service error' -- NOT a 400.
    That looks like a bug and it is one, but it is the shipped behaviour and
    this is a move, not a redesign.
  * Success: 200 {"success": true, "data": {"reply": "<text>"}}.

---------------------------------------------------------------------------
WHAT CHANGED (deliberately, and only in the plumbing)
---------------------------------------------------------------------------
  * THE API KEY NOW COMES FROM CONFIG, not from a bare os.environ.get() in the
    handler: app/services/gemini_service.py reads current_app.config
    ["GEMINI_API_KEY"] (BaseConfig line ~133), falling back to the environment
    only when there is no app context. Model name, max_output_tokens and
    temperature are config-driven too (GEMINI_MODEL / GEMINI_MAX_OUTPUT_TOKENS
    / GEMINI_TEMPERATURE), with the monolith's values as the defaults.
  * A missing key is a TYPED exception (GeminiKeyMissing) raised by the service
    and mapped here to the contract's 500 envelope -- so an unconfigured
    deployment answers clean JSON instead of an AttributeError traceback from
    deep inside google.generativeai.
  * `import google.generativeai` happens INSIDE gemini_service.generate_reply,
    so the package is not required to import the app. If it is missing
    entirely, the ImportError lands in the generic handler -> 'AI service error'.
  * genai.configure() still runs PER REQUEST (module-level global state in the
    SDK). Hoisting it to import time would change behaviour on a rotated key.
===========================================================================
"""

import logging

from flask import Blueprint, request

from app.core.rbac import require_permission
from app.core.responses import generate_response
from app.services.gemini_service import GeminiKeyMissing, generate_reply

logger = logging.getLogger(__name__)

chat_bp = Blueprint("chat", __name__)


# ==========================================================
# 12. SECURE AI CHATBOT ROUTE
# ==========================================================
@chat_bp.route('/api/chat', methods=['POST'])
@require_permission(optional=True)
def chat_proxy():
    try:
        data = request.get_json()
        if not data or not data.get('message'):
            return generate_response(False, error="Message cannot be empty", status_code=400)

        user_message = data.get('message')
        user_role = request.current_user.get('role') if request.current_user else 'Guest'

        reply = generate_reply(user_message, user_role)

        return generate_response(True, data={"reply": reply}, status_code=200)

    except GeminiKeyMissing:
        # gemini_service already logged "Gemini API key missing".
        return generate_response(False, error="Service currently unavailable", status_code=500)
    except Exception as e:
        logger.error(f"Chatbot Error: {e}", exc_info=True)
        return generate_response(False, error="AI service error", status_code=500)


__all__ = ["chat_bp", "chat_proxy"]
