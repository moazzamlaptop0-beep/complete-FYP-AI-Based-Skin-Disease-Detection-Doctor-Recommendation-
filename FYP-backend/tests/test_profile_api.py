"""
The self-service account surface: /api/profile, the avatar, the in-session
password change, and the OTP-verified email change.

WHAT THIS FILE IS PROTECTING
----------------------------
1. EVERY ROLE HAS A PROFILE NOW. Before this, `POST /api/doctor/profile` was
   the only self-write in the whole API: doctor-only, multipart-only, and it
   wrote `doctor_profiles`. A patient could not change their own name. The
   per-role tests below are the proof that is no longer true.

2. AN EMPTY STRING CLEARS A FIELD. The legacy route applied values `if value:`,
   so deleting the contents of a box and pressing Save put the old value
   straight back. That is not a cosmetic difference and it has its own test.

3. `email` AND `role` ARE REFUSED BY PATCH. The address has an OTP flow because
   changing it changes who can log in; a role is not self-service.

4. THE EMAIL-CHANGE CODE GOES TO THE NEW ADDRESS. This is the entire mechanism.
   `test_the_confirmation_code_goes_to_the_new_address_only` fails if anybody
   ever "simplifies" the recipient back to `user.email`, which is what the
   resend path used to do -- mailing the code to the one inbox that did not
   need to prove anything.

5. CHANGING A PASSWORD DOES NOT SIGN YOU OUT. `/auth/reset-password` bumps
   token_version on purpose (nobody proved they knew the old password there).
   Reusing that helper here would log the user out of the page they are typing
   on, every time. `test_changing_the_password_does_not_sign_the_caller_out`
   pins the difference.

6. THE DOCTOR-PROFILE EMAIL BYPASS STAYS CLOSED. `POST /api/doctor/profile`
   used to set `user.email` with no verification whatsoever.
"""

import datetime
import io
import os

import pytest

from tests.authkit import (
    DEFAULT_PASSWORD,
    bearer,
    data_of,
    error_of,
    install_mailbox,
    login,
    make_doctor,
    make_user,
)

PROFILE_KEYS = {
    "id", "name", "email", "role", "phone", "city", "date_of_birth", "gender",
    "avatar_url", "avatar_endpoint", "is_verified", "created_at",
    "pending_email", "doctor",
}

DOCTOR_BLOCK_KEYS = {
    "specialty", "hospital", "city", "phone", "experience", "license",
    "latitude", "longitude", "state", "country", "profile_image",
    "verification_status", "verification_note", "fees_pkr",
}


@pytest.fixture(autouse=True)
def mail(monkeypatch):
    """Autouse: no test in this file may reach a real SMTP server."""
    return install_mailbox(monkeypatch)


@pytest.fixture()
def uploads(app, tmp_path, monkeypatch):
    """Point UPLOAD_FOLDER at a throwaway directory.

    Avatar tests write real files. Without this they would litter (and, on the
    delete test, remove things from) the repository's static/uploads folder,
    which holds ~300 real images.
    """
    folder = tmp_path / "uploads"
    folder.mkdir()
    monkeypatch.setitem(app.config, "UPLOAD_FOLDER", str(folder))
    return folder


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------
def _token(client, db, email, role="AI User"):
    if role == "Doctor":
        make_doctor(db, email)
    else:
        make_user(db, email, role=role)
    return login(client, email)["token"]


def _png(width=900, height=700):
    """A real PNG, big enough that the 512px downscale is observable."""
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (180, 40, 40)).save(buffer, "PNG")
    buffer.seek(0)
    return buffer


def _get_profile(client, token):
    response = client.get("/api/profile", headers=bearer(token))
    assert response.status_code == 200, response.get_json()
    return data_of(response)


def _patch(client, token, body):
    return client.patch("/api/profile", json=body, headers=bearer(token))


def _user(db, email):
    from app.models import User

    db.expire_all()
    return db.query(User).filter(User.email == email).one()


def _backdate_otp(db, user_id, purpose, seconds):
    """Age the newest OTP row so the 45s resend cooldown can be tested."""
    from app.models import EmailOtp

    row = (
        db.query(EmailOtp)
        .filter(EmailOtp.user_id == user_id, EmailOtp.purpose == purpose)
        .order_by(EmailOtp.id.desc())
        .first()
    )
    shift = datetime.timedelta(seconds=seconds)
    row.created_at = row.created_at - shift
    row.expires_at = row.expires_at - shift
    db.commit()
    return row


# ======================================================================
# 1. READING A PROFILE -- all three roles
# ======================================================================
def test_a_patient_can_read_their_own_profile(client, db):
    token = _token(client, db, "patient.profile@aiderma.local")

    profile = _get_profile(client, token)

    assert set(profile.keys()) == PROFILE_KEYS
    assert profile["email"] == "patient.profile@aiderma.local"
    assert profile["role"] == "AI User"
    # Nothing has been filled in yet, and the API says so honestly rather than
    # inventing empty strings the form would then save back.
    assert profile["phone"] is None
    assert profile["city"] is None
    assert profile["date_of_birth"] is None
    assert profile["gender"] is None
    assert profile["avatar_url"] is None
    assert profile["avatar_endpoint"] is None
    assert profile["pending_email"] is None
    # A patient has no clinic listing.
    assert profile["doctor"] is None


def test_an_admin_can_read_their_own_profile(client, db):
    """The role with NO self-service route at all before this phase."""
    token = _token(client, db, "admin.profile@aiderma.local", role="Admin")

    profile = _get_profile(client, token)

    assert profile["role"] == "Admin"
    # An admin holds DOCTOR_PROFILE_MANAGE through the role hierarchy but has
    # no doctor_profiles row, so there is nothing to show.
    assert profile["doctor"] is None


def test_a_doctor_profile_carries_the_whole_clinic_block(client, db):
    token = _token(client, db, "dr.profile@aiderma.local", role="Doctor")

    profile = _get_profile(client, token)

    assert set(profile["doctor"].keys()) == DOCTOR_BLOCK_KEYS
    assert profile["doctor"]["specialty"] == "Dermatology"
    assert profile["doctor"]["city"] == "Lahore"
    assert profile["doctor"]["verification_status"] == "approved"
    assert profile["doctor"]["license"].startswith("LIC-")
    # None, not 0: "no fee recorded" and "free consultation" are different
    # claims, and /api/doctors/public already keeps them apart.
    assert profile["doctor"]["fees_pkr"] is None
    # Contract fields whose columns arrive with the location migration.
    assert profile["doctor"]["state"] is None
    assert profile["doctor"]["country"] is None


def test_reading_a_profile_needs_a_token(client, db):
    assert client.get("/api/profile").status_code == 401
    assert client.patch("/api/profile", json={"name": "Nobody"}).status_code == 401


# ======================================================================
# 2. WRITING -- partial, and clearing
# ======================================================================
def test_a_patient_can_edit_the_account_fields(client, db):
    token = _token(client, db, "editable@aiderma.local")

    response = _patch(client, token, {
        "name": "Ayesha Khan",
        "phone": "+92 300 1234567",
        "city": "Karachi",
        "date_of_birth": "1994-03-17",
        "gender": "Female",
    })
    assert response.status_code == 200, response.get_json()
    updated = data_of(response)

    assert updated["name"] == "Ayesha Khan"
    assert updated["phone"] == "+92 300 1234567"
    assert updated["city"] == "Karachi"
    assert updated["date_of_birth"] == "1994-03-17"
    # A closed vocabulary, stored lowercase, so "Female" and "female" cannot
    # both end up in the column.
    assert updated["gender"] == "female"

    # PATCH returns exactly what GET returns, so a client needs one parser.
    assert _get_profile(client, token) == updated


def test_an_admin_can_edit_their_own_account(client, db, uploads):
    """The role that had NO self-service route of any kind before this phase:
    `POST /api/doctor/profile` writes doctor_profiles, and an admin has no row
    there. An admin could not change their own name."""
    token = _token(client, db, "admin.editable@aiderma.local", role="Admin")

    response = _patch(client, token, {"name": "Root Operator", "phone": "0429876543"})
    assert response.status_code == 200, response.get_json()
    assert data_of(response)["name"] == "Root Operator"
    assert data_of(response)["phone"] == "0429876543"
    assert data_of(response)["doctor"] is None

    # ...including the avatar, which is not a patient-only feature either.
    avatar = client.post(
        "/api/profile/avatar", data={"avatar": (_png(), "boss.png")},
        content_type="multipart/form-data", headers=bearer(token),
    )
    assert avatar.status_code == 200
    assert data_of(avatar)["avatar_url"].startswith("/static/uploads/avatar_u")


def test_a_doctor_can_edit_the_account_fields_too(client, db):
    """A doctor is a person as well as a listing. `users.phone` is theirs;
    `doctor_profiles.phone` is the clinic's."""
    token = _token(client, db, "dr.person@aiderma.local", role="Doctor")

    response = _patch(client, token, {
        "phone": "03211234567", "date_of_birth": "1985-11-02", "gender": "male",
    })
    assert response.status_code == 200

    updated = data_of(response)
    assert updated["phone"] == "03211234567"
    assert updated["date_of_birth"] == "1985-11-02"
    assert updated["gender"] == "male"
    # The clinic listing was not touched by any of that.
    assert updated["doctor"]["phone"] is None
    assert updated["doctor"]["specialty"] == "Dermatology"


def test_a_patch_only_touches_the_keys_it_carries(client, db):
    """A form that renders four fields must be safe to submit without wiping
    the six it does not render."""
    token = _token(client, db, "partial@aiderma.local")
    _patch(client, token, {"phone": "03001234567", "city": "Multan", "gender": "male"})

    response = _patch(client, token, {"name": "Renamed Only"})
    assert response.status_code == 200

    after = data_of(response)
    assert after["name"] == "Renamed Only"
    assert after["phone"] == "03001234567"
    assert after["city"] == "Multan"
    assert after["gender"] == "male"


def test_an_empty_string_clears_a_field(client, db):
    """THE difference from legacy POST /api/doctor/profile, which applied each
    value `if value:` and so could not blank anything a user had deleted."""
    token = _token(client, db, "clearable@aiderma.local")
    _patch(client, token, {
        "phone": "03001234567", "city": "Quetta",
        "date_of_birth": "1990-01-01", "gender": "other",
    })

    response = _patch(client, token, {
        "phone": "", "city": "", "date_of_birth": "", "gender": "",
    })
    assert response.status_code == 200

    cleared = data_of(response)
    assert cleared["phone"] is None
    assert cleared["city"] is None
    assert cleared["date_of_birth"] is None
    assert cleared["gender"] is None


def test_a_blank_name_is_refused_rather_than_stored(client, db):
    """The one field "empty clears" does NOT apply to: `name` is the account's
    display identity in the directory, in every appointment row and on every
    scan a reviewer opens, and no other endpoint could put it back."""
    token = _token(client, db, "nameless@aiderma.local")

    response = _patch(client, token, {"name": "   "})
    assert response.status_code == 400
    assert data_of(response)["field"] == "name"
    assert _get_profile(client, token)["name"] == "nameless"


def test_every_rejection_names_the_field_to_highlight(client, db):
    token = _token(client, db, "fields@aiderma.local")

    cases = {
        "phone": {"phone": "call me maybe"},
        "date_of_birth": {"date_of_birth": "17/03/1994"},
        "gender": {"gender": "spaceship"},
    }
    for field, body in cases.items():
        response = _patch(client, token, body)
        assert response.status_code == 400, field
        assert data_of(response)["field"] == field


def test_a_birth_date_in_the_future_is_refused(client, db):
    token = _token(client, db, "timetraveller@aiderma.local")
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()

    response = _patch(client, token, {"date_of_birth": tomorrow})
    assert response.status_code == 400
    assert "future" in error_of(response).lower()


# ======================================================================
# 3. THE TWO FIELDS PATCH REFUSES
# ======================================================================
def test_patch_refuses_to_change_the_email(client, db):
    token = _token(client, db, "keepmyemail@aiderma.local")

    response = _patch(client, token, {"email": "hijack@evil.local"})
    assert response.status_code == 400
    assert data_of(response)["field"] == "email"
    # The message has to point somewhere, or the client is stuck.
    assert "email-change" in error_of(response)

    assert _user(db, "keepmyemail@aiderma.local").email == "keepmyemail@aiderma.local"


def test_patch_refuses_to_change_the_role(client, db):
    token = _token(client, db, "notanadmin@aiderma.local")

    response = _patch(client, token, {"role": "Admin"})
    assert response.status_code == 400
    assert data_of(response)["field"] == "role"

    assert _user(db, "notanadmin@aiderma.local").role == "AI User"


def test_a_refused_key_rolls_back_the_rest_of_the_patch(client, db):
    """A 400 must not half-apply. Otherwise "name saved, email refused" leaves
    the user staring at a form that disagrees with the database."""
    token = _token(client, db, "atomic@aiderma.local")

    response = _patch(client, token, {"name": "Should Not Stick",
                                      "email": "nope@aiderma.local"})
    assert response.status_code == 400
    assert _get_profile(client, token)["name"] == "atomic"


# ======================================================================
# 4. THE DOCTOR BLOCK
# ======================================================================
def test_a_doctor_can_edit_their_clinic_details(client, db):
    token = _token(client, db, "dr.edit@aiderma.local", role="Doctor")

    response = _patch(client, token, {
        "name": "Dr Sana Malik",
        "doctor": {
            "specialty": "Cosmetic Dermatology",
            "hospital": "Shaukat Khanum",
            "city": "Islamabad",
            "phone": "0511234567",
            "experience": 12,
            "latitude": 33.6844,
            "longitude": 73.0479,
        },
    })
    assert response.status_code == 200, response.get_json()

    block = data_of(response)["doctor"]
    assert block["specialty"] == "Cosmetic Dermatology"
    assert block["hospital"] == "Shaukat Khanum"
    assert block["city"] == "Islamabad"
    assert block["experience"] == 12
    assert block["latitude"] == pytest.approx(33.6844)
    assert block["longitude"] == pytest.approx(73.0479)
    # The account name and the clinic listing are the same PATCH.
    assert data_of(response)["name"] == "Dr Sana Malik"


def test_a_doctors_own_city_and_their_clinic_city_are_separate_facts(client, db):
    """users.city is where the person lives; doctor_profiles.city is where the
    clinic is and is what the public directory searches on. Merging them would
    publish a home address."""
    token = _token(client, db, "dr.twocities@aiderma.local", role="Doctor")

    response = _patch(client, token, {"city": "Sialkot", "doctor": {"city": "Lahore"}})
    assert response.status_code == 200

    updated = data_of(response)
    assert updated["city"] == "Sialkot"
    assert updated["doctor"]["city"] == "Lahore"


def test_a_new_licence_number_sends_the_doctor_back_to_pending(client, db):
    """Unchanged behaviour from POST /api/doctor/profile: an admin has never
    seen the new number, so the old approval does not carry over to it."""
    token = _token(client, db, "dr.relicense@aiderma.local", role="Doctor")
    assert _get_profile(client, token)["doctor"]["verification_status"] == "approved"

    response = _patch(client, token, {"doctor": {"license": "PMDC-NEW-9001"}})
    assert response.status_code == 200

    block = data_of(response)["doctor"]
    assert block["license"] == "PMDC-NEW-9001"
    assert block["verification_status"] == "pending"
    assert block["verification_note"] is None


def test_a_licence_already_held_by_someone_else_is_refused(client, db):
    make_doctor(db, "dr.incumbent@aiderma.local", license_no="PMDC-TAKEN-1")
    token = _token(client, db, "dr.copycat@aiderma.local", role="Doctor")

    response = _patch(client, token, {"doctor": {"license": "PMDC-TAKEN-1"}})
    assert response.status_code == 400
    assert data_of(response)["field"] == "doctor.license"
    assert "already registered" in error_of(response)


def test_a_patient_cannot_grow_a_doctor_profile(client, db):
    token = _token(client, db, "wannabe.dr@aiderma.local")

    response = _patch(client, token, {"doctor": {"specialty": "Dermatology"}})
    assert response.status_code == 400
    assert data_of(response)["field"] == "doctor"


def test_an_out_of_range_coordinate_is_caught(client, db):
    """A latitude of 131 is not a place. Storing it puts a pin nowhere and
    every distance calculation that reads it is silently wrong afterwards."""
    token = _token(client, db, "dr.geo@aiderma.local", role="Doctor")

    bad_latitude = _patch(client, token, {"doctor": {"latitude": 131.5}})
    assert bad_latitude.status_code == 400
    assert data_of(bad_latitude)["field"] == "doctor.latitude"

    bad_longitude = _patch(client, token, {"doctor": {"longitude": -274.0}})
    assert bad_longitude.status_code == 400
    assert data_of(bad_longitude)["field"] == "doctor.longitude"

    not_a_number = _patch(client, token, {"doctor": {"latitude": "somewhere"}})
    assert not_a_number.status_code == 400

    # Clearing them is legitimate: a doctor who removes their pin.
    cleared = _patch(client, token, {"doctor": {"latitude": "", "longitude": ""}})
    assert cleared.status_code == 200
    assert data_of(cleared)["doctor"]["latitude"] is None


def test_state_and_country_are_accepted_before_their_columns_exist(client, db):
    """They are part of the frozen shape but land in a LATER migration. A client
    built against the contract must not 400 today and must not need a second
    deploy tomorrow."""
    token = _token(client, db, "dr.location@aiderma.local", role="Doctor")

    response = _patch(client, token, {
        "doctor": {"state": "Punjab", "country": "Pakistan", "hospital": "Mayo"},
    })
    assert response.status_code == 200
    # The sibling field in the same request still landed.
    assert data_of(response)["doctor"]["hospital"] == "Mayo"


# ======================================================================
# 5. AVATAR
# ======================================================================
def test_uploading_an_avatar_stores_a_downscaled_copy(client, db, uploads):
    from PIL import Image

    token = _token(client, db, "avatar.happy@aiderma.local")

    response = client.post(
        "/api/profile/avatar",
        data={"avatar": (_png(900, 700), "me.png")},
        content_type="multipart/form-data",
        headers=bearer(token),
    )
    assert response.status_code == 200, response.get_json()

    block = data_of(response)
    assert set(block.keys()) == {"avatar_url", "avatar_endpoint"}
    assert block["avatar_endpoint"] == "/api/profile/avatar"
    # '/'-prefixed so `${API_BASE_URL}${avatar_url}` works unmodified.
    assert block["avatar_url"].startswith("/static/uploads/avatar_u")

    # THE FILENAME RULE: app/api/media/routes.py refuses any basename
    # containing "scan_", so an avatar named after the user's file would 404 on
    # the only route that serves it.
    assert "scan_" not in block["avatar_url"]

    saved = uploads / os.path.basename(block["avatar_url"])
    assert saved.is_file()
    with Image.open(saved) as image:
        assert max(image.size) <= 512
        # Re-encoded as JPEG, which is also what drops the EXIF GPS tag a phone
        # writes into the photo somebody just made their public picture.
        assert image.format == "JPEG"

    # And the profile now advertises it.
    assert _get_profile(client, token)["avatar_url"] == block["avatar_url"]


def test_the_avatar_endpoint_serves_the_bytes_back(client, db, uploads):
    token = _token(client, db, "avatar.serve@aiderma.local")
    client.post(
        "/api/profile/avatar",
        data={"avatar": (_png(), "me.png")},
        content_type="multipart/form-data",
        headers=bearer(token),
    )

    served = client.get("/api/profile/avatar", headers=bearer(token))
    assert served.status_code == 200
    assert served.data[:2] == b"\xff\xd8"          # JPEG magic
    assert "private" in served.headers.get("Cache-Control", "")


def test_the_avatar_endpoint_404s_when_there_is_no_picture(client, db, uploads):
    """404, not 403. Absence is not a permission problem."""
    token = _token(client, db, "avatar.none@aiderma.local")
    assert client.get("/api/profile/avatar", headers=bearer(token)).status_code == 404


def test_an_oversize_avatar_is_refused_without_touching_the_disk(client, db, uploads):
    token = _token(client, db, "avatar.big@aiderma.local")
    too_big = io.BytesIO(b"\0" * (6 * 1024 * 1024))

    response = client.post(
        "/api/profile/avatar",
        data={"avatar": (too_big, "huge.png")},
        content_type="multipart/form-data",
        headers=bearer(token),
    )
    assert response.status_code == 413
    assert "5 MB" in error_of(response)
    assert data_of(response)["field"] == "avatar"
    # The size is checked BEFORE anything is written, so a 40 MB payload named
    # `me.png` never lands in the uploads folder at all.
    assert list(uploads.iterdir()) == []
    assert _get_profile(client, token)["avatar_url"] is None


def test_a_wrong_file_type_is_refused(client, db, uploads):
    token = _token(client, db, "avatar.pdf@aiderma.local")

    response = client.post(
        "/api/profile/avatar",
        data={"avatar": (io.BytesIO(b"%PDF-1.4 not an image"), "resume.pdf")},
        content_type="multipart/form-data",
        headers=bearer(token),
    )
    assert response.status_code == 400
    assert data_of(response)["field"] == "avatar"
    assert list(uploads.iterdir()) == []


def test_a_file_with_an_image_name_but_no_image_inside_is_refused(client, db, uploads):
    """The extension is a claim, not evidence. Pillow is what actually decides."""
    token = _token(client, db, "avatar.liar@aiderma.local")

    response = client.post(
        "/api/profile/avatar",
        data={"avatar": (io.BytesIO(b"definitely not a png"), "trust-me.png")},
        content_type="multipart/form-data",
        headers=bearer(token),
    )
    assert response.status_code == 400
    assert _get_profile(client, token)["avatar_url"] is None
    # The staging copy is cleaned up even on the failure path.
    assert list(uploads.iterdir()) == []


def test_uploading_a_second_avatar_removes_the_first_file(client, db, uploads):
    token = _token(client, db, "avatar.replace@aiderma.local")

    first = data_of(client.post(
        "/api/profile/avatar", data={"avatar": (_png(), "one.png")},
        content_type="multipart/form-data", headers=bearer(token),
    ))["avatar_url"]

    second = data_of(client.post(
        "/api/profile/avatar", data={"avatar": (_png(600, 600), "two.png")},
        content_type="multipart/form-data", headers=bearer(token),
    ))["avatar_url"]

    assert second != first
    assert [p.name for p in uploads.iterdir()] == [os.path.basename(second)]


def test_deleting_an_avatar_clears_the_column_and_the_file(client, db, uploads):
    token = _token(client, db, "avatar.delete@aiderma.local")
    uploaded = data_of(client.post(
        "/api/profile/avatar", data={"avatar": (_png(), "me.png")},
        content_type="multipart/form-data", headers=bearer(token),
    ))["avatar_url"]
    assert (uploads / os.path.basename(uploaded)).is_file()

    response = client.delete("/api/profile/avatar", headers=bearer(token))
    assert response.status_code == 200
    assert data_of(response) == {"avatar_url": None, "avatar_endpoint": None}

    assert list(uploads.iterdir()) == []
    assert _get_profile(client, token)["avatar_url"] is None

    # Idempotent: deleting again is still a 200, not a 404.
    assert client.delete("/api/profile/avatar", headers=bearer(token)).status_code == 200


def test_posting_no_file_at_all_is_a_clear_400(client, db, uploads):
    token = _token(client, db, "avatar.empty@aiderma.local")

    response = client.post(
        "/api/profile/avatar", data={}, content_type="multipart/form-data",
        headers=bearer(token),
    )
    assert response.status_code == 400
    assert data_of(response)["field"] == "avatar"


def test_the_avatar_routes_need_a_token(client, db):
    assert client.post("/api/profile/avatar").status_code == 401
    assert client.delete("/api/profile/avatar").status_code == 401
    assert client.get("/api/profile/avatar").status_code == 401


# ======================================================================
# 6. CHANGE PASSWORD
# ======================================================================
NEW_PASSWORD = "Str0ng!NewPass2026"


def test_changing_the_password_works_and_the_old_one_stops(client, db, mail):
    make_user(db, "pw.happy@aiderma.local")
    token = login(client, "pw.happy@aiderma.local")["token"]

    response = client.post("/auth/change-password", headers=bearer(token), json={
        "current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD,
    })
    assert response.status_code == 200, response.get_json()
    assert data_of(response)["sessions_kept"] is True

    assert client.post("/auth/login", json={
        "email": "pw.happy@aiderma.local", "password": DEFAULT_PASSWORD}).status_code == 401
    assert client.post("/auth/login", json={
        "email": "pw.happy@aiderma.local", "password": NEW_PASSWORD}).status_code == 200

    # A "your password changed" notice is what catches a takeover in progress.
    assert mail.to("pw.happy@aiderma.local")


def test_changing_the_password_does_not_sign_the_caller_out(client, db):
    """THE difference from /auth/reset-password, which bumps token_version on
    purpose because nobody proved they knew the old password there. Here they
    did, so signing them out of the page they are typing on is pure damage."""
    from app.models import User

    make_user(db, "pw.stayin@aiderma.local")
    session = login(client, "pw.stayin@aiderma.local")
    token, refresh = session["token"], session["refresh_token"]

    assert client.post("/auth/change-password", headers=bearer(token), json={
        "current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD,
    }).status_code == 200

    # The very same access token still works.
    assert client.get("/auth/me", headers=bearer(token)).status_code == 200
    assert client.get("/api/profile", headers=bearer(token)).status_code == 200
    # ...and so does the refresh token that came with it.
    assert client.post("/auth/refresh", json={"refresh_token": refresh}).status_code == 200

    db.expire_all()
    assert db.query(User).filter(
        User.email == "pw.stayin@aiderma.local").one().token_version == 0


def test_a_wrong_current_password_is_refused_and_changes_nothing(client, db):
    make_user(db, "pw.wrong@aiderma.local")
    token = login(client, "pw.wrong@aiderma.local")["token"]

    response = client.post("/auth/change-password", headers=bearer(token), json={
        "current_password": "not-my-password", "new_password": NEW_PASSWORD,
    })
    assert response.status_code == 401
    assert data_of(response)["field"] == "current_password"

    # The old password still works, so nothing was applied.
    assert client.post("/auth/login", json={
        "email": "pw.wrong@aiderma.local", "password": DEFAULT_PASSWORD}).status_code == 200


def test_the_password_policy_applies_to_a_self_service_change(client, db):
    """A policy the settings page can bypass is not a policy."""
    make_user(db, "pw.weak@aiderma.local")
    token = login(client, "pw.weak@aiderma.local")["token"]

    for weak in ("short1", "1234567890", "password123"):
        response = client.post("/auth/change-password", headers=bearer(token), json={
            "current_password": DEFAULT_PASSWORD, "new_password": weak,
        })
        assert response.status_code == 400, weak
        assert data_of(response)["field"] == "new_password"

    assert client.post("/auth/login", json={
        "email": "pw.weak@aiderma.local", "password": DEFAULT_PASSWORD}).status_code == 200


def test_reusing_the_same_password_is_refused(client, db):
    make_user(db, "pw.same@aiderma.local")
    token = login(client, "pw.same@aiderma.local")["token"]

    response = client.post("/auth/change-password", headers=bearer(token), json={
        "current_password": DEFAULT_PASSWORD, "new_password": DEFAULT_PASSWORD,
    })
    assert response.status_code == 400
    assert data_of(response)["field"] == "new_password"


def test_change_password_needs_both_fields_and_a_token(client, db):
    make_user(db, "pw.missing@aiderma.local")
    token = login(client, "pw.missing@aiderma.local")["token"]

    assert client.post("/auth/change-password", json={
        "current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD,
    }).status_code == 401

    assert client.post("/auth/change-password", headers=bearer(token),
                       json={"new_password": NEW_PASSWORD}).status_code == 400
    assert client.post("/auth/change-password", headers=bearer(token),
                       json={"current_password": DEFAULT_PASSWORD}).status_code == 400


def test_a_password_change_invalidates_an_outstanding_reset_code(client, db, mail):
    """A live "reset your password" code must not survive the password being
    changed by someone who already knew it."""
    make_user(db, "pw.otp@aiderma.local")
    token = login(client, "pw.otp@aiderma.local")["token"]

    client.post("/auth/forgot-password", json={"email": "pw.otp@aiderma.local"})
    reset_code = mail.last_code("pw.otp@aiderma.local")

    assert client.post("/auth/change-password", headers=bearer(token), json={
        "current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD,
    }).status_code == 200

    stale = client.post("/auth/reset-password", json={
        "email": "pw.otp@aiderma.local", "otp": reset_code,
        "new_password": "Another!Pass2026",
    })
    assert stale.status_code == 400


# ======================================================================
# 7. EMAIL CHANGE
# ======================================================================
OLD_EMAIL = "mover.old@aiderma.local"
NEW_EMAIL = "mover.new@aiderma.local"


def _request_change(client, token, new_email=NEW_EMAIL, password=DEFAULT_PASSWORD):
    return client.post("/auth/email-change/request", headers=bearer(token), json={
        "new_email": new_email, "current_password": password,
    })


def test_the_confirmation_code_goes_to_the_new_address_only(client, db, mail):
    """THE mechanism. The only thing worth proving is that the person can read
    the inbox they are moving TO -- mailing the code to the address they are
    moving FROM verifies something nobody doubted, and lets a hijacked session
    walk the account onto an attacker's inbox unchallenged."""
    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]

    response = _request_change(client, token)
    assert response.status_code == 200, response.get_json()
    assert data_of(response)["pending_email"] == NEW_EMAIL
    assert data_of(response)["resend_in_seconds"] > 0

    assert mail.to(NEW_EMAIL), "no message reached the new address"
    assert not mail.to(OLD_EMAIL), "the code was leaked to the old address"
    assert mail.last_code(NEW_EMAIL)

    # The account is NOT moved yet -- login, notifications and password reset
    # all keep using the old address until the code is redeemed.
    stored = _user(db, OLD_EMAIL)
    assert stored.email == OLD_EMAIL
    assert stored.pending_email == NEW_EMAIL
    assert _get_profile(client, token)["pending_email"] == NEW_EMAIL


def test_the_full_email_change_round_trip(client, db, mail):
    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]
    _request_change(client, token)

    verified = client.post("/auth/email-change/verify", headers=bearer(token),
                           json={"otp": mail.last_code(NEW_EMAIL)})
    assert verified.status_code == 200, verified.get_json()
    assert data_of(verified)["email"] == NEW_EMAIL

    moved = _user(db, NEW_EMAIL)
    assert moved.pending_email is None

    # The new address is now the login, and the old one is gone.
    assert client.post("/auth/login", json={
        "email": NEW_EMAIL, "password": DEFAULT_PASSWORD}).status_code == 200
    assert client.post("/auth/login", json={
        "email": OLD_EMAIL, "password": DEFAULT_PASSWORD}).status_code == 401

    # The old inbox is told it lost the account. That is the notification that
    # catches a takeover.
    assert mail.to(OLD_EMAIL)


def test_the_email_change_writes_an_audit_row(client, db, mail):
    from app.models import AuditLog

    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]
    _request_change(client, token)
    client.post("/auth/email-change/verify", headers=bearer(token),
                json={"otp": mail.last_code(NEW_EMAIL)})

    db.expire_all()
    rows = db.query(AuditLog).filter(AuditLog.action == "auth.email_change").all()
    assert len(rows) == 1
    assert rows[0].detail == f"{OLD_EMAIL} -> {NEW_EMAIL}"


def test_a_wrong_code_does_not_move_the_address(client, db, mail):
    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]
    _request_change(client, token)

    response = client.post("/auth/email-change/verify", headers=bearer(token),
                           json={"otp": "000000"})
    assert response.status_code == 400
    assert data_of(response)["field"] == "otp"

    still = _user(db, OLD_EMAIL)
    assert still.email == OLD_EMAIL
    assert still.pending_email == NEW_EMAIL

    # The real code still works afterwards -- a wrong guess costs an attempt,
    # not the whole flow.
    assert client.post("/auth/email-change/verify", headers=bearer(token),
                       json={"otp": mail.last_code(NEW_EMAIL)}).status_code == 200


def test_verifying_with_nothing_pending_is_a_400(client, db, mail):
    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]

    response = client.post("/auth/email-change/verify", headers=bearer(token),
                           json={"otp": "123456"})
    assert response.status_code == 400
    assert "No pending email change" in error_of(response)


def test_cancelling_forgets_the_address_and_kills_the_code(client, db, mail):
    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]
    _request_change(client, token)
    code = mail.last_code(NEW_EMAIL)

    cancelled = client.post("/auth/email-change/cancel", headers=bearer(token))
    assert cancelled.status_code == 200
    assert data_of(cancelled) == {"pending_email": None, "cancelled": True}
    assert _user(db, OLD_EMAIL).pending_email is None

    # The code that is still sitting in the new inbox is now worthless. Leaving
    # it live would let an abandoned change be completed weeks later by whoever
    # read that mail.
    replayed = client.post("/auth/email-change/verify", headers=bearer(token),
                           json={"otp": code})
    assert replayed.status_code == 400
    assert _user(db, OLD_EMAIL).email == OLD_EMAIL

    # Idempotent.
    assert client.post("/auth/email-change/cancel", headers=bearer(token)).status_code == 200


def test_a_second_account_cannot_claim_a_pending_address(client, db, mail):
    """Without this check both accounts park the same address and whichever
    verifies second hits the users.email unique index as a 500 -- after its OTP
    has been consumed, so it cannot even retry."""
    make_user(db, OLD_EMAIL)
    make_user(db, "rival@aiderma.local")

    first = login(client, OLD_EMAIL)["token"]
    assert _request_change(client, first).status_code == 200

    second = login(client, "rival@aiderma.local")["token"]
    response = _request_change(client, second)
    assert response.status_code == 400
    assert data_of(response)["field"] == "new_email"
    assert "another account" in error_of(response)

    assert _user(db, "rival@aiderma.local").pending_email is None


def test_an_address_someone_already_owns_is_refused(client, db):
    make_user(db, OLD_EMAIL)
    make_user(db, "occupied@aiderma.local")
    token = login(client, OLD_EMAIL)["token"]

    response = _request_change(client, token, new_email="occupied@aiderma.local")
    assert response.status_code == 400
    assert "already registered" in error_of(response)


def test_the_address_is_re_checked_at_verify_time(client, db, mail):
    """Ten minutes can pass between the code being issued and redeemed. If
    somebody else registered the address in the meantime the swap has to fail
    cleanly, not as a unique-constraint 500."""
    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]
    _request_change(client, token)
    code = mail.last_code(NEW_EMAIL)

    make_user(db, NEW_EMAIL)          # somebody signed up in the meantime

    response = client.post("/auth/email-change/verify", headers=bearer(token),
                           json={"otp": code})
    assert response.status_code == 400
    assert "already registered" in error_of(response)
    assert _user(db, OLD_EMAIL).email == OLD_EMAIL


def test_the_current_password_gates_the_request(client, db, mail):
    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]

    response = _request_change(client, token, password="not-my-password")
    assert response.status_code == 401
    assert data_of(response)["field"] == "current_password"
    # Checked BEFORE the address lookup, so a stolen access token cannot be
    # used as an "is this email registered?" oracle.
    assert not mail
    assert _user(db, OLD_EMAIL).pending_email is None


def test_a_malformed_or_unchanged_address_is_refused(client, db):
    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]

    bad = _request_change(client, token, new_email="not-an-email")
    assert bad.status_code == 400
    assert data_of(bad)["field"] == "new_email"

    same = _request_change(client, token, new_email=OLD_EMAIL.upper())
    assert same.status_code == 400
    assert "already the email address" in error_of(same)


def test_the_email_change_endpoints_need_a_token(client, db):
    assert client.post("/auth/email-change/request", json={
        "new_email": NEW_EMAIL, "current_password": DEFAULT_PASSWORD}).status_code == 401
    assert client.post("/auth/email-change/verify", json={"otp": "123456"}).status_code == 401
    assert client.post("/auth/email-change/cancel").status_code == 401


# ======================================================================
# 8. RESEND -- the wrong-inbox bug
# ======================================================================
def test_resending_an_email_change_code_also_goes_to_the_new_address(client, db, mail):
    """`/auth/resend-otp` mailed EVERY purpose to `user.email`. For an email
    change that is the one inbox that does not need the code, and the inbox
    that does never got it -- so the resend button looked like it worked."""
    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]
    _request_change(client, token)

    user = _user(db, OLD_EMAIL)
    _backdate_otp(db, user.id, "email_change", seconds=120)   # clear the cooldown

    response = client.post("/auth/resend-otp", json={
        "email": OLD_EMAIL, "purpose": "email_change"})
    assert response.status_code == 200, response.get_json()

    assert len(mail.to(NEW_EMAIL)) == 2
    assert not mail.to(OLD_EMAIL)

    # And the resent code is the live one.
    assert client.post("/auth/email-change/verify", headers=bearer(token),
                       json={"otp": mail.last_code(NEW_EMAIL)}).status_code == 200


def test_resending_an_email_change_code_with_nothing_pending_is_a_400(client, db):
    make_user(db, OLD_EMAIL)

    response = client.post("/auth/resend-otp", json={
        "email": OLD_EMAIL, "purpose": "email_change"})
    assert response.status_code == 400
    assert "No pending email change" in error_of(response)


def test_the_unauthenticated_verify_otp_door_still_completes_the_swap(client, db, mail):
    """`/auth/verify-otp` with purpose=email_change has always been able to do
    this and had no way of ever being reached, because nothing wrote
    pending_email. It works now, and it must keep working."""
    make_user(db, OLD_EMAIL)
    token = login(client, OLD_EMAIL)["token"]
    _request_change(client, token)

    response = client.post("/auth/verify-otp", json={
        "email": OLD_EMAIL, "otp": mail.last_code(NEW_EMAIL), "purpose": "email_change",
    })
    assert response.status_code == 200, response.get_json()
    assert data_of(response)["email"] == NEW_EMAIL
    assert _user(db, NEW_EMAIL).pending_email is None


# ======================================================================
# 9. THE DOCTOR-PROFILE EMAIL BYPASS
# ======================================================================
def test_the_doctor_profile_route_no_longer_changes_the_email(client, db):
    """It used to write `user.email` outright: one multipart POST moved the
    account's identity, its password-reset destination and every notification,
    with no proof anybody could read the new inbox."""
    make_doctor(db, "dr.bypass@aiderma.local")
    token = login(client, "dr.bypass@aiderma.local")["token"]

    response = client.post(
        "/api/doctor/profile",
        data={"name": "Dr Bypass", "email": "attacker@evil.local"},
        content_type="multipart/form-data",
        headers=bearer(token),
    )
    assert response.status_code == 400
    assert "email-change" in error_of(response)

    assert _user(db, "dr.bypass@aiderma.local").email == "dr.bypass@aiderma.local"
    # The 400 rolled back the name too -- a refused request must not half-apply.
    assert _user(db, "dr.bypass@aiderma.local").name == "dr.bypass"


def test_the_doctor_profile_route_still_saves_when_the_email_is_unchanged(client, db):
    """The existing settings form posts every field it rendered, including the
    email it did not touch. 400ing that would break saving a phone number."""
    make_doctor(db, "dr.samemail@aiderma.local")
    token = login(client, "dr.samemail@aiderma.local")["token"]

    response = client.post(
        "/api/doctor/profile",
        data={"name": "Dr Same", "email": "dr.samemail@aiderma.local",
              "phone": "0421234567", "hospital": "Jinnah"},
        content_type="multipart/form-data",
        headers=bearer(token),
    )
    assert response.status_code == 200, response.get_json()

    profile = _get_profile(client, token)
    assert profile["name"] == "Dr Same"
    assert profile["doctor"]["phone"] == "0421234567"
    assert profile["doctor"]["hospital"] == "Jinnah"
