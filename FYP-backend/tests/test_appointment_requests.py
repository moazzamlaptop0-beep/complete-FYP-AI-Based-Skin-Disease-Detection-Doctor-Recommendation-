"""
Multi-doctor appointment requests, the non-destructive booking edits, and the
rating relationship gate.

These are DB-backed and skip unless TEST_DATABASE_URL points at a dedicated
database (see tests/conftest.py). The pure-logic triage assertions live in
tests/test_triage.py and always run.

WHAT IS BEING DEFENDED
----------------------
* Booking no longer requires /send_report to have pinned ONE doctor first, and
  no longer requires an emergency to reach a taken slot.
* FIRST DOCTOR TO ACCEPT WINS -- the loser gets a clean 409, not a second
  appointment and not a 500 from the double-booking unique index.
* /rebook and /reschedule INSERT; they never overwrite the original row.
* A patient can finally cancel their own appointment.
* /api/rate-doctor refuses a rating with no clinical relationship behind it.
"""

import datetime

import pytest

from tests.authkit import make_doctor, make_user

pytestmark = pytest.mark.usefixtures("db")


# ======================================================================
# HELPERS
# ======================================================================
def _future_date(days=2):
    return (datetime.datetime.utcnow() + datetime.timedelta(days=days)).strftime("%Y-%m-%d")


def _past_date(days=2):
    return (datetime.datetime.utcnow() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")


def _data(response):
    payload = response.get_json() or {}
    return payload.get("data") or {}


def _error(response):
    return (response.get_json() or {}).get("error")


def _make_scan(db, user_id, prediction="2. Melanoma", confidence=90.0):
    from app.models import AIScan

    scan = AIScan(
        image_url="static/uploads/test.png",
        prediction_result=prediction,
        confidence=confidence,
        user_id=user_id,
        status="Local",
        review_status="Pending",
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)
    return scan


def _payload(scan_id, doctor_ids, slot_date=None, slot_time="09:00", **overrides):
    body = {
        "scan_id": scan_id,
        "doctor_ids": doctor_ids,
        "preferred_slots": [
            {"slot_date": slot_date or _future_date(), "slot_time": slot_time, "rank": 0},
        ],
        "answers": None,
        "patient_note": "Itchy for three weeks.",
        "express": False,
        "consent_share_scan": True,
    }
    body.update(overrides)
    return body


@pytest.fixture()
def cast(db):
    """One patient and two approved doctors, committed."""
    patient = make_user(db, "req.patient@aiderma.test")
    doctor_a = make_doctor(db, "req.doc.a@aiderma.test", license_no="LIC-REQ-A")
    doctor_b = make_doctor(db, "req.doc.b@aiderma.test", license_no="LIC-REQ-B")
    return {"patient": patient, "a": doctor_a, "b": doctor_b}


@pytest.fixture(autouse=True)
def _no_smtp(monkeypatch):
    """Every route here emails. Swallow it -- an SMTP timeout in CI is not a
    test signal, and the send is deliberately non-fatal in production too."""
    monkeypatch.setattr("app.services.email_service.send_email", lambda *a, **k: True)
    monkeypatch.setattr("app.services.request_matching.send_email", lambda *a, **k: True)
    monkeypatch.setattr("app.api.appointment_requests.routes.send_email", lambda *a, **k: True)
    monkeypatch.setattr("app.api.appointments.routes.send_email", lambda *a, **k: True)


# ======================================================================
# CREATE
# ======================================================================
def test_create_request_fans_out_to_several_doctors(client, db, cast, auth_headers):
    scan = _make_scan(db, cast["patient"].id)
    response = client.post(
        "/api/appointment-requests",
        json=_payload(scan.id, [cast["a"].id, cast["b"].id]),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 201, response.get_json()
    data = _data(response)

    assert data["status"] == "Open"
    assert data["severity_level"] == "CRITICAL"          # melanoma @ 90% (0-100 normalised)
    assert data["express"] is True                        # CRITICAL enters the express lane
    assert [d["doctor_id"] for d in data["doctors"]] == [cast["a"].id, cast["b"].id]
    assert all(d["response"] == "Pending" for d in data["doctors"])
    assert len(data["slots"]) == 1
    assert data["matched_doctor_id"] is None
    assert data["triage_reasons"]

    # The whole point: NO doctor is assigned to the scan yet.
    db.expire_all()
    from app.models import AIScan

    stored = db.query(AIScan).filter(AIScan.id == scan.id).first()
    assert stored.doctor_id is None
    assert stored.severity_level == "CRITICAL"
    assert stored.patient_notes == "Itchy for three weeks."


def test_create_request_records_the_scan_share_consent(client, db, cast, auth_headers):
    scan = _make_scan(db, cast["patient"].id)
    client.post(
        "/api/appointment-requests",
        json=_payload(scan.id, [cast["a"].id]),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    from app.models import UserConsent

    consent = db.query(UserConsent).filter(
        UserConsent.user_id == cast["patient"].id,
        UserConsent.consent_type == "scan_share",
    ).first()
    assert consent is not None
    assert consent.target_ref == f"scan:{scan.id}"
    assert consent.granted is True


def test_create_request_works_without_a_scan_at_all(client, db, cast, auth_headers):
    """Booking must not require having scanned anything first."""
    response = client.post(
        "/api/appointment-requests",
        json=_payload(None, [cast["a"].id], disease="1. Eczema", confidence=88.0),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 201, response.get_json()
    data = _data(response)
    assert data["scan_id"] is None
    assert data["severity_level"] == "ROUTINE"
    assert data["express"] is False


def test_create_request_rejects_an_unapproved_doctor(client, db, cast, auth_headers):
    pending = make_doctor(db, "req.doc.pending@aiderma.test",
                          license_no="LIC-REQ-P", verification_status="pending")
    response = client.post(
        "/api/appointment-requests",
        json=_payload(None, [cast["a"].id, pending.id]),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 400
    assert _data(response)["rejected_doctor_ids"] == [pending.id]


def test_create_request_rejects_a_past_slot(client, db, cast, auth_headers):
    response = client.post(
        "/api/appointment-requests",
        json=_payload(None, [cast["a"].id], slot_date=_past_date()),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 400
    assert "past" in _error(response).lower()


def test_create_request_rejects_more_than_three_doctors(client, db, cast, auth_headers):
    extra = [make_doctor(db, f"req.doc.x{i}@aiderma.test", license_no=f"LIC-REQ-X{i}").id
             for i in range(3)]
    response = client.post(
        "/api/appointment-requests",
        json=_payload(None, [cast["a"].id] + extra),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 400


def test_create_request_rejects_someone_elses_scan(client, db, cast, auth_headers):
    stranger = make_user(db, "req.stranger@aiderma.test")
    scan = _make_scan(db, stranger.id)
    response = client.post(
        "/api/appointment-requests",
        json=_payload(scan.id, [cast["a"].id]),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 403


# ======================================================================
# ACCEPT -- first doctor wins
# ======================================================================
def _open_request(client, db, cast, auth_headers, **overrides):
    scan = _make_scan(db, cast["patient"].id)
    response = client.post(
        "/api/appointment-requests",
        json=_payload(scan.id, [cast["a"].id, cast["b"].id], **overrides),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 201, response.get_json()
    return _data(response), scan


def test_first_doctor_to_accept_wins_and_the_second_gets_409(client, db, cast, auth_headers):
    request_data, scan = _open_request(client, db, cast, auth_headers)
    request_id = request_data["request_id"]
    slot_id = request_data["slots"][0]["slot_id"]

    first = client.post(
        f"/api/appointment-requests/{request_id}/accept",
        json={"slot_id": slot_id},
        headers=auth_headers(cast["a"].id, "Doctor"),
    )
    assert first.status_code == 200, first.get_json()
    accepted = _data(first)
    assert accepted["status"] == "Matched"
    assert accepted["appointment_status"] == "Scheduled"
    assert accepted["withdrawn_doctor_ids"] == [cast["b"].id]

    second = client.post(
        f"/api/appointment-requests/{request_id}/accept",
        json={"slot_id": slot_id},
        headers=auth_headers(cast["b"].id, "Doctor"),
    )
    assert second.status_code == 409, second.get_json()

    from app.models import AIScan, Appointment, AppointmentRequestDoctor

    db.expire_all()
    appointments = db.query(Appointment).filter(Appointment.request_id == request_id).all()
    assert len(appointments) == 1
    assert appointments[0].doctor_id == cast["a"].id
    assert appointments[0].status == "Scheduled"
    assert appointments[0].slot_start is not None

    # The scan is re-pointed at ACCEPT time, not at request time.
    assert db.query(AIScan).filter(AIScan.id == scan.id).first().doctor_id == cast["a"].id

    loser = db.query(AppointmentRequestDoctor).filter_by(
        request_id=request_id, doctor_id=cast["b"].id
    ).first()
    assert loser.response == "Withdrawn"


def test_accept_without_a_slot_id_takes_the_top_ranked_slot(client, db, cast, auth_headers):
    request_data, _scan = _open_request(client, db, cast, auth_headers)
    response = client.post(
        f"/api/appointment-requests/{request_data['request_id']}/accept",
        json={},
        headers=auth_headers(cast["a"].id, "Doctor"),
    )
    assert response.status_code == 200, response.get_json()
    assert _data(response)["slot"]["slot_id"] == request_data["slots"][0]["slot_id"]


def test_an_uninvited_doctor_cannot_accept(client, db, cast, auth_headers):
    outsider = make_doctor(db, "req.doc.out@aiderma.test", license_no="LIC-REQ-O")
    request_data, _scan = _open_request(client, db, cast, auth_headers)
    response = client.post(
        f"/api/appointment-requests/{request_data['request_id']}/accept",
        json={},
        headers=auth_headers(outsider.id, "Doctor"),
    )
    assert response.status_code == 403


def test_accept_on_a_taken_slot_is_409_for_a_routine_request(client, db, cast, auth_headers):
    """Emergency is a lane, not a gate -- but a ROUTINE request still cannot
    steal an occupied slot."""
    slot_date = _future_date()
    from app.models import Appointment

    db.add(Appointment(
        patient_id=cast["patient"].id, doctor_id=cast["a"].id,
        appointment_date=slot_date, appointment_time="09:00",
        status="Scheduled",
    ))
    db.commit()

    response = client.post(
        "/api/appointment-requests",
        json=_payload(None, [cast["a"].id], slot_date=slot_date,
                      disease="1. Eczema", confidence=90.0),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    request_id = _data(response)["request_id"]

    accepted = client.post(
        f"/api/appointment-requests/{request_id}/accept",
        json={},
        headers=auth_headers(cast["a"].id, "Doctor"),
    )
    assert accepted.status_code == 409
    assert "already booked" in _error(accepted).lower()


def test_express_accept_on_a_taken_slot_falls_into_pending_conflict(client, db, cast, auth_headers):
    """The EXISTING conflict machinery keeps ownership -- no second resolver."""
    slot_date = _future_date()
    from app.models import Appointment

    other = Appointment(
        patient_id=cast["patient"].id, doctor_id=cast["a"].id,
        appointment_date=slot_date, appointment_time="09:00",
        status="Scheduled",
    )
    db.add(other)
    db.commit()
    db.refresh(other)

    scan = _make_scan(db, cast["patient"].id)   # melanoma @ 90 => CRITICAL => express
    created = client.post(
        "/api/appointment-requests",
        json=_payload(scan.id, [cast["a"].id], slot_date=slot_date),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert _data(created)["express"] is True

    accepted = client.post(
        f"/api/appointment-requests/{_data(created)['request_id']}/accept",
        json={},
        headers=auth_headers(cast["a"].id, "Doctor"),
    )
    assert accepted.status_code == 200, accepted.get_json()
    payload = _data(accepted)
    assert payload["appointment_status"] == "Pending-Conflict"
    assert payload["conflict_with_id"] == other.id

    db.expire_all()
    refreshed = db.query(Appointment).filter(Appointment.id == other.id).first()
    assert refreshed.status == "Pending-Conflict"
    assert refreshed.conflict_with_id == payload["appointment_id"]


def test_client_declared_express_cannot_bump_a_confirmed_patient(client, db, cast, auth_headers):
    """`express` comes straight out of the request BODY (TriageService.is_express
    returns `bool(requested) or ...`), so it must not be the key that unlocks the
    slot-override path -- otherwise any patient flips a switch and forces a
    stranger's Confirmed booking into Pending-Conflict. /api/book-slot has always
    read severity from the DB scan for exactly this reason."""
    slot_date = _future_date()
    from app.models import Appointment

    victim = make_user(db, "req.victim@aiderma.test")
    held = Appointment(
        patient_id=victim.id, doctor_id=cast["a"].id,
        appointment_date=slot_date, appointment_time="09:00",
        status="Confirmed",
    )
    db.add(held)
    db.commit()
    db.refresh(held)

    created = client.post(
        "/api/appointment-requests",
        json=_payload(None, [cast["a"].id], slot_date=slot_date,
                      disease="1. Eczema", confidence=90.0, express=True),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert created.status_code == 201
    assert _data(created)["express"] is True            # the flag is still honoured...
    assert _data(created)["severity_level"] == "ROUTINE"

    accepted = client.post(
        f"/api/appointment-requests/{_data(created)['request_id']}/accept",
        json={},
        headers=auth_headers(cast["a"].id, "Doctor"),
    )
    # ...but it buys no override without a server-verified CRITICAL/URGENT scan.
    assert accepted.status_code == 409
    assert "already booked" in _error(accepted).lower()

    db.expire_all()
    assert db.query(Appointment).filter(Appointment.id == held.id).first().status == "Confirmed"


def test_express_accept_never_overrides_a_completed_consultation(client, db, cast, auth_headers):
    """A visit that already happened must not be rewritten into a conflict pair:
    the SLA resolver would then mark it "Reassigned", erasing it from the
    patient's history and from rating_service."""
    slot_date = _future_date()
    from app.models import Appointment

    done = Appointment(
        patient_id=cast["patient"].id, doctor_id=cast["a"].id,
        appointment_date=slot_date, appointment_time="09:00",
        status="Completed",
    )
    db.add(done)
    db.commit()
    db.refresh(done)

    scan = _make_scan(db, cast["patient"].id)   # melanoma @ 90 => CRITICAL => express
    created = client.post(
        "/api/appointment-requests",
        json=_payload(scan.id, [cast["a"].id], slot_date=slot_date),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert _data(created)["express"] is True

    accepted = client.post(
        f"/api/appointment-requests/{_data(created)['request_id']}/accept",
        json={},
        headers=auth_headers(cast["a"].id, "Doctor"),
    )
    assert accepted.status_code == 409

    db.expire_all()
    assert db.query(Appointment).filter(Appointment.id == done.id).first().status == "Completed"


def test_preferred_slots_are_stored_in_one_canonical_spelling(client, db, cast, auth_headers):
    """"9:00 AM" and "09:00" are the same instant, and every occupancy check in
    the codebase is raw string equality -- so an un-normalised slot renders as
    free in the grid and slips past the double-booking guards."""
    created = client.post(
        "/api/appointment-requests",
        json=_payload(None, [cast["a"].id], slot_time="9:00 AM"),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert created.status_code == 201, created.get_json()
    slot = _data(created)["slots"][0]
    assert slot["slot_time"] == "09:00"
    assert slot["slot_date"] == _future_date()


# ======================================================================
# DECLINE / CANCEL / INBOX
# ======================================================================
def test_decline_keeps_the_request_open_until_everyone_says_no(client, db, cast, auth_headers):
    request_data, _scan = _open_request(client, db, cast, auth_headers)
    request_id = request_data["request_id"]

    first = client.post(f"/api/appointment-requests/{request_id}/decline",
                        json={"reason": "Fully booked"},
                        headers=auth_headers(cast["a"].id, "Doctor"))
    assert first.status_code == 200
    assert _data(first)["status"] == "Open"
    assert _data(first)["remaining_pending"] == 1

    second = client.post(f"/api/appointment-requests/{request_id}/decline",
                         json={},
                         headers=auth_headers(cast["b"].id, "Doctor"))
    assert _data(second)["status"] == "Declined"
    assert _data(second)["remaining_pending"] == 0


def test_a_doctor_cannot_respond_twice(client, db, cast, auth_headers):
    request_data, _scan = _open_request(client, db, cast, auth_headers)
    request_id = request_data["request_id"]
    client.post(f"/api/appointment-requests/{request_id}/decline", json={},
                headers=auth_headers(cast["a"].id, "Doctor"))
    again = client.post(f"/api/appointment-requests/{request_id}/accept", json={},
                        headers=auth_headers(cast["a"].id, "Doctor"))
    assert again.status_code == 409


def test_patient_can_withdraw_an_open_request(client, db, cast, auth_headers):
    request_data, _scan = _open_request(client, db, cast, auth_headers)
    request_id = request_data["request_id"]

    response = client.post(f"/api/appointment-requests/{request_id}/cancel",
                           json={"reason": "Feeling better"},
                           headers=auth_headers(cast["patient"].id, "AI User"))
    assert response.status_code == 200, response.get_json()
    assert _data(response)["status"] == "Withdrawn"
    assert sorted(_data(response)["withdrawn_doctor_ids"]) == sorted([cast["a"].id, cast["b"].id])

    # And a doctor can no longer accept it.
    late = client.post(f"/api/appointment-requests/{request_id}/accept", json={},
                       headers=auth_headers(cast["a"].id, "Doctor"))
    assert late.status_code == 409


def test_doctor_inbox_shows_only_my_actionable_invitations(client, db, cast, auth_headers):
    _open_request(client, db, cast, auth_headers)
    outsider = make_doctor(db, "req.doc.none@aiderma.test", license_no="LIC-REQ-N")

    mine = client.get("/api/doctor/appointment-requests",
                      headers=auth_headers(cast["a"].id, "Doctor"))
    assert mine.status_code == 200
    body = _data(mine)
    assert body["total"] == 1
    assert body["items"][0]["my_response"] == "Pending"

    theirs = client.get("/api/doctor/appointment-requests",
                        headers=auth_headers(outsider.id, "Doctor"))
    assert _data(theirs)["total"] == 0


def test_list_and_detail_are_scoped_to_the_owner(client, db, cast, auth_headers):
    request_data, _scan = _open_request(client, db, cast, auth_headers)
    stranger = make_user(db, "req.nosy@aiderma.test")

    listed = client.get("/api/appointment-requests",
                        headers=auth_headers(cast["patient"].id, "AI User"))
    assert _data(listed)["total"] == 1

    forbidden = client.get(f"/api/appointment-requests/{request_data['request_id']}",
                           headers=auth_headers(stranger.id, "AI User"))
    assert forbidden.status_code == 403

    invited = client.get(f"/api/appointment-requests/{request_data['request_id']}",
                         headers=auth_headers(cast["b"].id, "Doctor"))
    assert invited.status_code == 200
    assert _data(invited)["my_response"] == "Pending"


def test_scan_image_is_withheld_without_consent(client, db, cast, auth_headers):
    scan = _make_scan(db, cast["patient"].id)
    created = client.post(
        "/api/appointment-requests",
        json=_payload(scan.id, [cast["a"].id], consent_share_scan=False),
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    inbox = client.get("/api/doctor/appointment-requests",
                       headers=auth_headers(cast["a"].id, "Doctor"))
    item = _data(inbox)["items"][0]
    assert item["scan"]["image_shared"] is False
    assert item["scan"]["image_url"] is None
    assert item["scan"]["disease"] == "2. Melanoma"      # diagnosis still shown
    assert _data(created)["consent_share_scan"] is False


# ======================================================================
# EXPIRY JOB
# ======================================================================
def test_expire_stale_requests_closes_open_requests(client, db, cast, auth_headers):
    request_data, _scan = _open_request(client, db, cast, auth_headers)
    from app.models import AppointmentRequest, AppointmentRequestDoctor
    from app.services.request_matching import expire_stale_requests

    row = db.query(AppointmentRequest).filter(
        AppointmentRequest.id == request_data["request_id"]
    ).first()
    row.expires_at = datetime.datetime.utcnow() - datetime.timedelta(hours=1)
    db.commit()

    assert expire_stale_requests(notify=False) == 1

    db.expire_all()
    assert db.query(AppointmentRequest).filter(
        AppointmentRequest.id == request_data["request_id"]
    ).first().status == "Expired"
    assert all(
        link.response == "Withdrawn"
        for link in db.query(AppointmentRequestDoctor).filter_by(
            request_id=request_data["request_id"]
        ).all()
    )


# ======================================================================
# NON-DESTRUCTIVE REBOOK / RESCHEDULE / PATIENT CANCEL
# ======================================================================
def _appointment(db, cast, status="Completed", date=None, time="09:00"):
    from app.models import Appointment

    appointment = Appointment(
        patient_id=cast["patient"].id, doctor_id=cast["a"].id,
        appointment_date=date or _past_date(), appointment_time=time,
        status=status, duration="30min",
    )
    db.add(appointment)
    db.commit()
    db.refresh(appointment)
    return appointment


def test_book_slot_refuses_someone_elses_scan(client, db, cast, auth_headers):
    """IDOR: /api/book-slot took scan_id on trust, and /api/patient-appointments
    then echoed that scan's disease, confidence, severity, doctor_comment and
    image_url back to the booking account -- every logged-in user holds
    APPOINTMENT_BOOK, so it was mass exfiltration by incrementing an integer."""
    from app.models import Appointment

    victim = make_user(db, "book.victim@aiderma.test")
    victim_scan = _make_scan(db, victim.id)

    response = client.post(
        "/api/book-slot",
        json={
            "patient_id": cast["patient"].id,
            "doctor_id": cast["a"].id,
            "slot_date": _future_date(),
            "slot_time": "09:00",
            "scan_id": victim_scan.id,
        },
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 403
    assert "different patient" in _error(response).lower()
    assert db.query(Appointment).filter(
        Appointment.patient_id == cast["patient"].id
    ).count() == 0

    # ...and the caller's OWN scan still books normally.
    own = _make_scan(db, cast["patient"].id)
    ok = client.post(
        "/api/book-slot",
        json={
            "patient_id": cast["patient"].id,
            "doctor_id": cast["a"].id,
            "slot_date": _future_date(),
            "slot_time": "09:00",
            "scan_id": own.id,
        },
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert ok.status_code == 201, ok.get_json()


def test_book_slot_sees_a_taken_slot_written_in_another_time_format(client, db, cast, auth_headers):
    """The occupancy check was raw string equality, so "09:00" did not match a
    stored "9:00 AM" and a second patient was inserted onto the same instant --
    with no Pending-Conflict row, no conflict email and no SLA resolution."""
    from app.models import Appointment

    slot_date = _future_date(6)
    legacy = _appointment(db, cast, status="Confirmed", date=slot_date, time="9:00 AM")
    # Rows written by the routes carry the typed shadow column; it is what lets
    # the check see through the free-text spelling. (New writes are also stored
    # canonically now, so this pair can no longer be created through the API.)
    legacy.slot_start = datetime.datetime.strptime(
        f"{slot_date} 09:00", "%Y-%m-%d %H:%M"
    )
    db.commit()

    other_patient = make_user(db, "book.other@aiderma.test")
    response = client.post(
        "/api/book-slot",
        json={
            "patient_id": other_patient.id,
            "doctor_id": cast["a"].id,
            "slot_date": slot_date,
            "slot_time": "09:00",
        },
        headers=auth_headers(other_patient.id, "AI User"),
    )
    assert response.status_code == 400
    assert "already booked" in _error(response).lower()
    assert db.query(Appointment).filter(
        Appointment.patient_id == other_patient.id
    ).count() == 0


def test_rebook_inserts_a_new_row_and_never_touches_the_original(client, db, cast, auth_headers):
    original = _appointment(db, cast, status="Cancelled")
    new_date = _future_date(3)

    response = client.post(
        f"/api/appointments/{original.id}/rebook",
        json={"slot_date": new_date, "slot_time": "10:00", "note": "Same rash, still there."},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 201, response.get_json()
    data = _data(response)
    assert data["appointment_id"] != original.id
    assert data["rebooked_from_id"] == original.id
    assert data["status"] == "Scheduled"
    assert data["slot_start"] is not None
    assert data["note"] == "Same rash, still there."

    db.expire_all()
    from app.models import Appointment

    untouched = db.query(Appointment).filter(Appointment.id == original.id).first()
    assert untouched.status == "Cancelled"
    assert untouched.appointment_date == original.appointment_date
    assert untouched.appointment_time == "09:00"


def test_rebook_refuses_a_taken_slot(client, db, cast, auth_headers):
    original = _appointment(db, cast, status="Cancelled")
    taken_date = _future_date(4)
    _appointment(db, cast, status="Scheduled", date=taken_date, time="11:00")

    response = client.post(
        f"/api/appointments/{original.id}/rebook",
        json={"slot_date": taken_date, "slot_time": "11:00"},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 409


def test_rebook_refuses_a_past_date(client, db, cast, auth_headers):
    original = _appointment(db, cast, status="Cancelled")
    response = client.post(
        f"/api/appointments/{original.id}/rebook",
        json={"slot_date": _past_date(), "slot_time": "10:00"},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 400


def test_patient_can_cancel_their_own_appointment(client, db, cast, auth_headers):
    appointment = _appointment(db, cast, status="Scheduled", date=_future_date())
    response = client.post(
        f"/api/patient-appointments/{appointment.id}/cancel",
        json={"reason": "Out of town"},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 200, response.get_json()
    assert _data(response)["status"] == "Cancelled"
    assert _data(response)["cancellation_reason"] == "Out of town"


def test_another_patient_cannot_cancel_my_appointment(client, db, cast, auth_headers):
    appointment = _appointment(db, cast, status="Scheduled", date=_future_date())
    stranger = make_user(db, "req.thief@aiderma.test")
    response = client.post(
        f"/api/patient-appointments/{appointment.id}/cancel",
        json={},
        headers=auth_headers(stranger.id, "AI User"),
    )
    assert response.status_code == 403


def test_a_completed_appointment_cannot_be_cancelled(client, db, cast, auth_headers):
    appointment = _appointment(db, cast, status="Completed")
    response = client.post(
        f"/api/patient-appointments/{appointment.id}/cancel",
        json={},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 400


def test_reschedule_keeps_the_original_row_as_history(client, db, cast, auth_headers):
    appointment = _appointment(db, cast, status="Scheduled", date=_future_date())
    new_date = _future_date(5)

    response = client.post(
        f"/api/patient-appointments/{appointment.id}/reschedule",
        json={"slot_date": new_date, "slot_time": "14:00"},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 200, response.get_json()
    data = _data(response)
    assert data["previous_appointment_id"] == appointment.id
    assert data["appointment_id"] != appointment.id
    assert data["slot_date"] == new_date

    db.expire_all()
    from app.models import Appointment

    old = db.query(Appointment).filter(Appointment.id == appointment.id).first()
    assert old.status == "Cancelled"
    assert old.cancellation_reason == "Rescheduled by the patient."
    new = db.query(Appointment).filter(Appointment.id == data["appointment_id"]).first()
    assert new.rebooked_from_id == appointment.id


# ======================================================================
# TRIAGE PREVIEW / MULTI SLOTS
# ======================================================================
def test_triage_preview_reports_severity_before_submitting(client, db, cast, auth_headers):
    response = client.post(
        "/api/triage-preview",
        json={"disease": "2. Melanoma", "confidence": 91.2, "answers": {"is_bleeding": True}},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 200
    data = _data(response)
    assert data["severity"] == "CRITICAL"
    assert data["is_emergency"] is True
    assert data["express_recommended"] is True
    assert data["expires_in_hours"] == 4
    assert data["confidence"] == pytest.approx(0.912)


def test_triage_preview_routine_case(client, db, cast, auth_headers):
    response = client.post(
        "/api/triage-preview",
        json={"disease": "10. Healthy Skin", "confidence": 0.99, "answers": None},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    data = _data(response)
    assert data["severity"] == "ROUTINE"
    assert data["expires_in_hours"] == 72


def test_multi_slots_returns_the_envelope_not_a_bare_array(client, db, cast):
    from app.models import DoctorAvailability, DoctorFees

    day_name = (datetime.datetime.utcnow() + datetime.timedelta(days=2)).strftime("%A")
    for doctor in (cast["a"], cast["b"]):
        db.add(DoctorAvailability(doctor_id=doctor.id, day=day_name,
                                  start_time="09:00", end_time="12:00", is_off=False))
        db.add(DoctorFees(doctor_id=doctor.id, pkr=1000.0, usd=5.0,
                          duration="30min", buffer_time=0))
    db.commit()

    response = client.get(
        f"/api/slots/multi?doctor_ids={cast['a'].id},{cast['b'].id}&date={_future_date()}"
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["success"] is True                       # NOT the bare-array quirk
    by_doctor = body["data"]["by_doctor"]
    assert set(by_doctor) == {str(cast["a"].id), str(cast["b"].id)}
    assert by_doctor[str(cast["a"].id)][0]["time"] == "09:00"
    assert by_doctor[str(cast["a"].id)][0]["status"] == "available"


def test_multi_slots_rejects_a_bad_date(client, cast):
    response = client.get(f"/api/slots/multi?doctor_ids={cast['a'].id}&date=not-a-date")
    assert response.status_code == 400


def test_legacy_single_slots_route_still_returns_a_bare_array(client, db, cast):
    """The envelope-breaker must survive next to its new sibling."""
    response = client.get(f"/api/slots/{cast['a'].id}?date={_future_date()}")
    assert response.status_code == 200
    assert isinstance(response.get_json(), list)


# ======================================================================
# SLOT GENERATION SKIPS THE DECLARED BREAK
# ======================================================================
def test_generated_slots_skip_the_declared_break_window(db, cast):
    from app.core.db import SessionLocal
    from app.models import DoctorAvailability, DoctorFees
    from app.services.scheduling_service import _generate_slots_for_date

    date_str = _future_date(2)
    day_name = datetime.datetime.strptime(date_str, "%Y-%m-%d").strftime("%A")
    db.add(DoctorAvailability(
        doctor_id=cast["a"].id, day=day_name,
        start_time="09:00", end_time="13:00", is_off=False,
        break_start_time="11:00", break_end_time="12:00", break_name="Lunch",
    ))
    db.add(DoctorFees(doctor_id=cast["a"].id, pkr=0.0, usd=0.0,
                      duration="60min", buffer_time=0))
    db.commit()

    session = SessionLocal()
    try:
        slots = _generate_slots_for_date(session, cast["a"].id, date_str)
    finally:
        session.close()

    times = [s["time"] for s in slots]
    assert "09:00" in times and "10:00" in times and "12:00" in times
    assert "11:00" not in times, "a slot inside the doctor's lunch break was offered"


# ======================================================================
# RATING RELATIONSHIP GATE
# ======================================================================
def test_rating_without_any_relationship_is_refused(client, db, cast, auth_headers):
    response = client.post(
        "/api/rate-doctor",
        json={"doctor_id": cast["a"].id, "rating": 1, "review": "terrible"},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 403
    from app.models import DoctorRating

    assert db.query(DoctorRating).count() == 0


def test_rating_after_a_completed_appointment_is_allowed_and_upserts(client, db, cast, auth_headers):
    appointment = _appointment(db, cast, status="Completed")

    first = client.post(
        "/api/rate-doctor",
        json={"doctor_id": cast["a"].id, "rating": 5, "review": "great"},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert first.status_code == 200
    assert first.get_json()["message"] == "Rating successfully submitted."

    # No ids sent, so the completed appointment is ATTACHED -- which gives the
    # row an upsert key and makes the spam loop an UPDATE, not another row.
    second = client.post(
        "/api/rate-doctor",
        json={"doctor_id": cast["a"].id, "rating": 1, "review": "changed my mind"},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert second.status_code == 200
    assert second.get_json()["message"] == "Rating successfully updated."

    from app.models import DoctorRating

    rows = db.query(DoctorRating).all()
    assert len(rows) == 1
    assert rows[0].appointment_id == appointment.id
    assert rows[0].rating == 1


def test_rating_a_scheduled_appointment_is_refused(client, db, cast, auth_headers):
    appointment = _appointment(db, cast, status="Scheduled", date=_future_date())
    response = client.post(
        "/api/rate-doctor",
        json={"doctor_id": cast["a"].id, "appointment_id": appointment.id, "rating": 5},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 400


def test_rating_someone_elses_appointment_is_refused(client, db, cast, auth_headers):
    appointment = _appointment(db, cast, status="Completed")
    stranger = make_user(db, "req.rater@aiderma.test")
    response = client.post(
        "/api/rate-doctor",
        json={"doctor_id": cast["a"].id, "appointment_id": appointment.id, "rating": 1},
        headers=auth_headers(stranger.id, "AI User"),
    )
    assert response.status_code == 403


def test_rating_a_reviewed_scan_is_allowed(client, db, cast, auth_headers):
    scan = _make_scan(db, cast["patient"].id)
    scan.doctor_id = cast["a"].id
    scan.status = "Reviewed"
    scan.review_status = "Reviewed"
    db.commit()

    response = client.post(
        "/api/rate-doctor",
        json={"doctor_id": cast["a"].id, "scan_id": scan.id, "rating": 4, "review": "helpful"},
        headers=auth_headers(cast["patient"].id, "AI User"),
    )
    assert response.status_code == 200, response.get_json()
