# migrations/ — Alembic is the schema authority

Nothing else may create or alter tables. `Base.metadata.create_all()` is no
longer called during boot; it survives only behind the `AUTO_CREATE_ALL` flag
for the pytest fixture.

## Commands

Always use the project interpreter — the sibling `venv/` is stale.

```bash
PY=".venv/Scripts/python.exe"

$PY -m alembic current                        # what the DB is stamped at
$PY -m alembic history --verbose
$PY -m alembic upgrade head                   # apply everything
$PY -m alembic downgrade -1                   # step back one
$PY -m alembic revision --autogenerate -m "add x"   # after editing app/models/
```

## Why there is exactly one revision

The database was throwaway when this refactor started, so the whole final
schema — the 7 original tables plus the 10 new ones — landed in a single
initial revision. There is no drift to reconcile and nothing to baseline-stamp.
The next migration you write should be a normal incremental one.

## Things that will bite you in autogenerate

* **Partial indexes.** `uq_appt_doctor_slot`, `uq_rating_appt` and
  `uq_rating_scan` use `postgresql_where`. Alembic compares these correctly
  but writes them without the `postgresql_where` clause in some versions —
  check any generated diff that touches them before applying it.
* **The circular foreign key.** `appointments.request_id` →
  `appointment_requests.id` and `appointment_requests.matched_appointment_id`
  → `appointments.id` reference each other. The appointments side is declared
  with `use_alter=True, name="fk_appointments_request_id"` so it is emitted as
  a separate `ALTER TABLE` after both tables exist. Do not "simplify" it into
  an inline constraint — table creation will deadlock on ordering.
* **`synonym()` attributes** (`specialization`, `fees`, `image_path`,
  `prediction`, `date`, `time`) are Python-level aliases with no columns
  behind them. Autogenerate ignores them, which is correct.
* **CHECK constraints** on `doctor_ratings.rating`, `email_otps.purpose`,
  `appointment_requests.status` and `appointment_request_doctors.response` are
  named. Keep the names stable so downgrades can find them.
