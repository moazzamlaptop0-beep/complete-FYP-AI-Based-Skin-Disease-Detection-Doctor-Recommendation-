"""
The API envelope.

`generate_response` below is a BYTE-IDENTICAL copy of app.py:54-63 (now
legacy/app_monolith.py). Do not "improve" it. The semantics the frontend
depends on:

  * `message` and `error` are OMITTED when falsy -- an empty string does not
    produce a null key, it produces no key at all.
  * `data` IS emitted when it is `[]` or `{}`, because the guard is
    `is not None`. /doctor/update_scan/<id> relies on the empty `{}` surviving.
  * Flask 3.1 serialises with app.json.sort_keys=True, so keys come out
    alphabetically. Do not swap the JSON provider (orjson etc.) and do not flip
    sort_keys -- either changes the bytes on the wire.

Two endpoints deliberately do NOT use this function on their success path:
  * /doctor/update_scan/<int:scan_id>  -> flat dict   (monolith line 981)
  * /api/slots/<int:doctor_id>         -> bare array  (monolith line 2276)
Their ERROR paths do use it.
"""

from flask import jsonify

__all__ = ["generate_response"]


def generate_response(success, message="", error="", data=None, status_code=200):
    """Consistent API Response format (TASK 17)"""
    res = {"success": success}
    if message:
        res["message"] = message
    if error:
        res["error"] = error
    if data is not None:
        res["data"] = data
    return jsonify(res), status_code
