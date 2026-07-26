# AI Dermatologist — Backend

Flask application-factory package. Skin-lesion classification (MobileNetV2),
triage, multi-doctor appointment requests, and role-based access control.

## Quick start

```bash
python -m venv .venv && .venv/Scripts/activate      # Windows
pip install -r requirements.txt
cp .env.example .env                                 # then fill it in
alembic upgrade head
flask --app run seed-root                            # first admin, from .env
python run.py                                        # http://localhost:5000
```

`seeds/seed_demo.py` adds a demo doctor and patient for local testing.

## Layout

```
app/
  __init__.py        create_app() — the application factory
  config.py          per-environment config; production refuses a weak JWT_SECRET
  core/              rbac, security, db, errors, responses, validation, logging
  models/            SQLAlchemy models, one module per aggregate
  api/<domain>/      one blueprint per domain (auth, scans, appointments, ...)
  services/          triage, image, email, otp, scheduling, matching, ...
  jobs/              APScheduler jobs (conflict SLA, image purge)
migrations/          Alembic
seeds/ scripts/      root admin, demo data, consent documents, backfills
tests/               pytest
legacy/              the pre-refactor monolith, kept for diffing
```

## Access control

`app/core/rbac.py` is the single source of truth. Roles form a strict
hierarchy, built by explicit set union so it cannot silently drift:

```
PATIENT (8 perms)  ⊂  DOCTOR (14)  ⊂  ADMIN (24)
```

A doctor therefore holds every patient permission and can run a scan or book
an appointment **on their own account** — the reason the old code pushed
people into second accounts was that `patient_required` rejected doctors
outright.

Routes declare intent, not roles:

```python
@require_permission(Permission.SCAN_REVIEW_ASSIGNED)
```

Ownership goes through one primitive, `resolve_actor(target_id, own_perm,
any_perm)`: you may act on your own row, or on anyone's if you hold the
`.any` variant.

**Acting as another user.** An admin sends `X-Act-As-User-Id`. The target must
be strictly lower-ranked and must not be `is_root`; effective permissions are
the intersection of the target's role and the admin's own. Every mutation
writes an `audit_logs` row against the *admin's* id. It is read-write on
purpose — an admin genuinely performs the action rather than previewing it.

**Root.** Created only by `flask seed-root` from `ROOT_ADMIN_EMAIL` /
`ROOT_ADMIN_PASSWORD`. `is_root` is never settable over HTTP, never an
act-as target, and cannot be suspended or deleted.

## Medical image privacy

Scan photographs are **not** static files.

- `GET /api/scans/<id>/image?variant=thumb|blur|full` — authorised by
  `image_service.can_view()`: the owning patient, the assigned doctor, any
  doctor invited on an open request for that scan, or a `scan.read.any` holder.
- The `blur` variant is generated server-side by downscaling to ~32px and
  re-encoding. CSS blur is not privacy; the server sends different bytes.
- Every `full` view writes an `image_access_log` row.
- `/static/uploads/scan_*` returns **404** to everyone. Doctor headshots
  (`doc_*`) still serve there, and have their own route at
  `/api/doctors/<id>/photo`.
- `DELETE /api/scans/<id>/image` purges the file and records consent while
  keeping the row, the diagnosis, triage, doctor comments and appointments.

## Streaming

`EventSource` cannot send an `Authorization` header, so clients `POST
/api/stream-ticket` for a short-lived signed ticket and pass `?ticket=`.
Unticketed connections are rejected in every environment.

## Testing

```bash
pytest tests/ -q          # needs TEST_DATABASE_URL (a dedicated database)
```

`TEST_DATABASE_URL` must differ from `DATABASE_URL`; the fixtures drop and
recreate the schema.
