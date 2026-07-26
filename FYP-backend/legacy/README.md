# legacy/ — pre-refactor reference only

`app_monolith.py` is the ORIGINAL, unmodified `app.py` (3296 lines, 39 routes) exactly
as it was before the package refactor. It was moved here with `git mv`, so
`git log --follow legacy/app_monolith.py` still shows its full history.

## Why it is here

It is the **diffing reference** for the port. Every route body that moves into
`app/api/<blueprint>/routes.py` must produce a **byte-identical** response to the
one produced here — same URL, same HTTP method, same JSON keys, same key order,
same status codes. When in doubt about behaviour, this file is the answer, not
the new code.

## Rules

1. **READ-ONLY.** Do not edit, reformat, lint or "fix" anything in this file.
   The bugs in it are load-bearing (see `docs/api-contract.md`).
2. **Do not import it from the new package.** It is not part of the app.
3. Its imports still resolve: the repo ships thin `models.py` and `database.py`
   shim modules that re-export from `app.models` / `app.core.db`, so
   `import models` and `from database import engine, SessionLocal` find the
   same objects the new package uses.

   To actually run it you must be in `FYP-backend` (not in `legacy/`) so that
   the shims are importable:

   ```bash
   cd FYP-backend
   .venv/Scripts/python.exe -m legacy.app_monolith
   ```

   Two caveats. Its module-level `models.Base.metadata.create_all()` will try
   to create tables — harmless against the Alembic-managed schema, but Alembic
   is the authority now. And `import test_model` at line 4 prints an emoji
   banner that raises `UnicodeEncodeError` on a cp1252 Windows console; export
   `PYTHONIOENCODING=utf-8` first. (`app/services/ml_service.py` handles that
   for the new app; the monolith does not.)
4. **Delete this whole directory at the end of the refactor**, once every route
   has been ported and verified.

## Known deliberate weirdness preserved from this file

- `/doctor/update_scan/<id>` (line 981) returns a FLAT dict, not the envelope,
  including an empty `"data": {}`.
- `/api/slots/<id>` (line 2276) returns a BARE JSON array on success, but the
  envelope on every error path.
- Both SSE streams are intentionally decorator-free (comment at lines 1417-1419):
  `EventSource` cannot send an `Authorization` header.
- `TriageService` expects confidence in 0..1 but is fed the 0..100 DB value
  (line 788). Do not fix during the port — it changes stored `severity_level`
  and the persisted `triage_reasons` strings.
- `import test_model` at line 4 loads TensorFlow + the `.h5` weights at import
  time and `raise SystemExit` on failure. `app/services/ml_service.py` makes
  this lazy; the monolith's eager behaviour stays here.
