"""
Phase 3C -- medical image privacy.

WHAT IS ACTUALLY BEING ASSERTED HERE
------------------------------------
1. The raw path is closed. `/static/./uploads/<f>` and `/static/uPloads/<f>`
   used to return full-resolution patient photographs from Flask's BUILT-IN
   static endpoint without ever entering the media blueprint. Those two tests
   are the regression guard for `static_folder=None`; if somebody "restores"
   it for convenience, they fail.
2. The blur is real. A CSS blur is a decoration over the original bytes; this
   asserts the SERVER-SIDE variant has physically lost the information, by
   showing that a 2x2 checkerboard of pure colours comes back as near-flat.
3. can_view() is a union of four clauses, and the third one (a doctor invited
   through an appointment_request, who is NOT ai_scans.doctor_id) is exercised
   explicitly -- that is the clause whose absence 403s two of three invited
   doctors on the thumbnail their own inbox renders.
4. Deleting an image keeps the medical record. The row, the prediction, the
   confidence, the doctor's comment and the linked appointment all survive.

The DB-backed tests skip without TEST_DATABASE_URL; the image-processing and
predicate tests run everywhere.
"""

import datetime
import os

import pytest

from app.services import image_service

from tests.authkit import bearer, make_doctor, make_user


# ======================================================================
# FIXTURES / HELPERS
# ======================================================================
@pytest.fixture()
def uploads(app, tmp_path, monkeypatch):
    """Point UPLOAD_FOLDER at a throwaway directory for one test."""
    folder = tmp_path / "uploads"
    folder.mkdir()
    monkeypatch.setitem(app.config, "UPLOAD_FOLDER", str(folder))
    return folder


def write_image(folder, name="scan_test_mole.png", size=(600, 400)):
    """A 2x2 checkerboard of saturated colours -- deliberately high-contrast so
    that "the blur destroyed it" is measurable rather than a matter of taste."""
    from PIL import Image

    img = Image.new("RGB", size)
    half_w, half_h = size[0] // 2, size[1] // 2
    for x in range(size[0]):
        for y in range(size[1]):
            quadrant = (x >= half_w) * 2 + (y >= half_h)
            img.putpixel((x, y), [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)][quadrant])
    path = folder / name
    img.save(path)
    return f"static/uploads/{name}", str(path)


def make_scan(db, user_id, stored_url, **kwargs):
    from app.models import AIScan

    fields = {
        "image_url": stored_url,
        "prediction_result": "Melanoma",
        "confidence": 91.5,
        "user_id": user_id,
        "status": "Pending",
        "severity_level": "URGENT",
        "triage_score": 40,
        "doctor_comment": "Looks concerning, please come in.",
        "is_sensitive": False,
    }
    fields.update(kwargs)
    scan = AIScan(**fields)
    db.add(scan)
    db.commit()
    db.refresh(scan)
    return scan


# ======================================================================
# 1. THE RAW STATIC PATH IS CLOSED
# ======================================================================
def test_builtin_static_rule_is_gone(app):
    """Flask must register NO /static/<path:filename> rule."""
    endpoints = {rule.endpoint for rule in app.url_map.iter_rules()}
    assert "static" not in endpoints
    assert app.static_folder is None


@pytest.mark.parametrize("spelling", [
    "/static/./uploads/{name}",
    "/static/uPloads/{name}",
    "/static/UPLOADS/{name}",
])
def test_static_bypass_spellings_are_404(client, uploads, spelling):
    """These returned 200 + the full image bytes before static_folder=None."""
    stored, _ = write_image(uploads, "scan_bypass_probe.png")
    name = os.path.basename(stored)

    response = client.get(spelling.format(name=name))
    assert response.status_code == 404, (
        f"{spelling} still serves bytes -- the built-in static route is back."
    )


def test_patient_scans_are_refused_on_the_legacy_media_route(client, uploads):
    """A patient scan is NEVER served by the unauthenticated media route.

    This test used to assert the opposite. The route had no owner check, so
    anyone holding the filename got the full-resolution photograph, and it
    stayed open only because the old pages rendered image_url in an <img src>
    and an <img> cannot send a bearer token. Those pages are deleted;
    <SensitiveImage> now fetches /api/scans/<id>/image, which checks
    can_view(), blurs sensitive scans server-side and audit-logs full views.

    404 rather than 403 is deliberate: someone probing for medical images must
    not learn whether a given file exists.
    """
    stored, _ = write_image(uploads, "scan_must_not_be_served.png")
    response = client.get("/" + stored)
    assert response.status_code == 404, (
        "The unauthenticated media route is serving a patient scan again. "
        "This is a PHI disclosure, not a cosmetic regression."
    )


@pytest.mark.parametrize("name", ["thumb_scan_x.png", "blur_scan_x.png"])
def test_scan_variants_are_refused_too(client, uploads, name):
    """The thumb/blur derivatives are still the patient's photograph."""
    stored, _ = write_image(uploads, name)
    assert client.get("/" + stored).status_code == 404


def test_doctor_headshots_are_still_served(client, uploads):
    """Doctor photos are a DIFFERENT kind of data and must keep working.

    They are professional headshots on a directory that logged-out visitors
    browse -- not medical data about a patient. Blanket-blocking the route
    would have blanked out every avatar in the product, which is why the rule
    keys on the filename rather than the folder.
    """
    stored, _ = write_image(uploads, "doc_7_20260101_headshot.png")
    response = client.get("/" + stored)
    assert response.status_code == 200
    assert len(response.data) > 0
    assert response.headers.get("Deprecation") == "true"


def test_static_traversal_still_400s(client, uploads):
    response = client.get("/static/uploads/../../app/config.py")
    assert response.status_code == 400
    assert response.get_json()["error"] == "Invalid filename"


# ======================================================================
# 2. SERVER-SIDE VARIANTS
# ======================================================================
def test_thumbnail_is_bounded(app, uploads):
    from PIL import Image

    stored, source = write_image(uploads, "scan_thumb_src.png", size=(1600, 1200))
    target = str(uploads / "thumb_out.jpg")

    assert image_service.make_thumbnail(source, target) is True
    with Image.open(target) as img:
        assert max(img.size) <= image_service.THUMB_MAX_PX
        assert img.format == "JPEG"       # re-encoded => EXIF/GPS dropped


def write_striped_image(folder, name="scan_detail.png", size=(800, 800), stripe=2):
    """Pure high-frequency detail: 2px black/white stripes. Any process that
    preserves fine structure keeps this image's contrast; any process that
    destroys it collapses to flat grey."""
    from PIL import Image

    img = Image.new("RGB", size)
    pixels = img.load()
    for x in range(size[0]):
        colour = (255, 255, 255) if (x // stripe) % 2 == 0 else (0, 0, 0)
        for y in range(size[1]):
            pixels[x, y] = colour
    path = folder / name
    img.save(path)
    return f"static/uploads/{name}", str(path)


def test_blur_destroys_fine_detail(app, uploads):
    """The blur must DESTROY information, not merely hide it.

    2px stripes carry ~127 units of luminance standard deviation. After
    downscale-to-32px + upscale + GaussianBlur they must be gone, i.e. the
    variant is flat grey with no recoverable structure. A CSS `filter: blur()`
    over the original would leave this number untouched, because the original
    bytes would still be the ones on the wire.
    """
    from PIL import Image, ImageStat

    stored, source = write_striped_image(uploads, "scan_detail.png")
    target = str(uploads / "blur_detail.jpg")

    with Image.open(source) as original:
        before = ImageStat.Stat(original.convert("L")).stddev[0]
    assert before > 100, "the fixture itself has no detail to destroy"

    assert image_service.make_blur(source, target) is True
    with Image.open(target) as blurred:
        assert max(blurred.size) <= image_service.BLUR_OUTPUT_PX
        after = ImageStat.Stat(blurred.convert("L")).stddev[0]

    assert after < 12, f"fine detail survived the blur (stddev {before:.1f} -> {after:.1f})"


def test_blur_output_holds_no_more_than_32px_of_information(app, uploads):
    """The privacy control is the DOWNSCALE, so prove the downscale happened.

    Round-tripping the finished variant through 32px again must change almost
    nothing -- if the output still carried detail finer than 32 samples across,
    that round trip would visibly damage it. This is what makes the blur
    irreversible: the data is not obscured, it no longer exists.
    """
    from PIL import Image, ImageChops, ImageStat

    stored, source = write_image(uploads, "scan_roundtrip.png", size=(900, 900))
    target = str(uploads / "blur_roundtrip.jpg")
    assert image_service.make_blur(source, target) is True

    with Image.open(target) as blurred:
        blurred = blurred.convert("RGB")
        tiny = blurred.resize((image_service.BLUR_DOWNSCALE_PX,) * 2, Image.BILINEAR)
        again = tiny.resize(blurred.size, Image.BICUBIC)
        difference = ImageStat.Stat(ImageChops.difference(blurred, again)).mean

    assert max(difference) < 12, f"the variant still carries sub-32px detail: {difference}"


def test_generate_variants_writes_both_files(app, uploads):
    stored, _ = write_image(uploads, "scan_variants.png")
    built = image_service.generate_variants(stored)

    assert built["thumb_url"] == "static/uploads/thumb_scan_variants.jpg"
    assert built["blur_url"] == "static/uploads/blur_scan_variants.jpg"
    assert (uploads / "thumb_scan_variants.jpg").exists()
    assert (uploads / "blur_scan_variants.jpg").exists()


def test_generate_variants_survives_a_broken_file(app, uploads):
    """A file Pillow cannot decode must not take down the upload carrying it."""
    (uploads / "scan_broken.png").write_bytes(b"this is definitely not a PNG")
    built = image_service.generate_variants("static/uploads/scan_broken.png")
    assert built == {"thumb_url": None, "blur_url": None}


# ======================================================================
# 3. VARIANT SELECTION
# ======================================================================
class _Actor:
    def __init__(self, user_id, permissions=()):
        self.id = user_id
        self.permissions = set(permissions)

    def can(self, perm):
        return perm in self.permissions


class _Scan:
    def __init__(self, user_id=1, doctor_id=None, is_sensitive=False):
        self.id = 7
        self.user_id = user_id
        self.doctor_id = doctor_id
        self.is_sensitive = is_sensitive
        self.image_url = "static/uploads/x.png"
        self.thumb_url = None
        self.blur_url = None
        self.image_deleted_at = None


def test_normalise_variant():
    assert image_service.normalise_variant(None) is None
    assert image_service.normalise_variant("") is None
    assert image_service.normalise_variant("FULL") == "full"
    with pytest.raises(ValueError):
        image_service.normalise_variant("original")


@pytest.mark.parametrize("sensitive,viewer,requested,expected", [
    (False, "owner",  None,    "full"),
    (False, "doctor", None,    "full"),
    (False, "doctor", "thumb", "thumb"),
    (True,  "owner",  None,    "full"),     # your own photo, unchanged
    (True,  "owner",  "thumb", "thumb"),
    (True,  "doctor", None,    "blur"),     # DEFAULT is blurred
    (True,  "doctor", "thumb", "blur"),     # a 400px crop is still the photo
    (True,  "doctor", "full",  "full"),     # explicit only -- and logged
])
def test_effective_variant_matrix(sensitive, viewer, requested, expected):
    scan = _Scan(user_id=1, doctor_id=2, is_sensitive=sensitive)
    actor = _Actor(1 if viewer == "owner" else 2)
    assert image_service.effective_variant(scan, actor, requested) == expected


def test_privacy_fields_shape():
    scan = _Scan()
    fields = image_service.privacy_fields(scan)
    assert set(fields) == {"is_sensitive", "image_deleted_at", "has_image", "image_endpoint"}
    assert fields["has_image"] is True
    assert fields["image_endpoint"] == "/api/scans/7/image"

    scan.image_deleted_at = datetime.datetime(2026, 7, 25, 12, 0, 0)
    gone = image_service.privacy_fields(scan)
    assert gone["has_image"] is False
    assert gone["image_endpoint"] is None       # never render a guaranteed 404
    assert gone["image_deleted_at"] == "2026-07-25T12:00:00"


def test_blur_never_falls_back_to_full(app, uploads):
    """A missing blur file must NOT degrade into the original image.

    'thumb' may fall back to 'full' -- a thumbnail is just a smaller copy of a
    picture the viewer is already cleared for. 'blur' may NEVER fall back,
    because the whole point of the variant is that this viewer is NOT cleared
    for the original. A missing file is a 404, not a downgrade to plaintext.
    """
    stored, _ = write_image(uploads, "scan_nofallback.png")

    scan = _Scan(is_sensitive=True)
    scan.image_url = stored
    # BOTH set, so ensure_variants() short-circuits and cannot quietly rebuild
    # them -- this is the "derived file was deleted off disk" case.
    scan.thumb_url = "static/uploads/thumb_does_not_exist.jpg"
    scan.blur_url = "static/uploads/blur_does_not_exist.jpg"

    path, served = image_service.resolve_file(scan, "blur")
    assert path is None, "a sensitive scan degraded to its full-resolution file"

    # thumb, by contrast, is allowed to fall back to the original.
    path, served = image_service.resolve_file(scan, "thumb")
    assert served == "full"
    assert path is not None and path.endswith("scan_nofallback.png")


# ======================================================================
# 4. THE AUTHORIZATION PREDICATE  (DB-backed)
# ======================================================================
def test_can_view_union(db, app, uploads):
    """All four clauses, including the invited-doctor one."""
    from app.core.rbac import Permission, build_actor
    from app.models import AppointmentRequest, AppointmentRequestDoctor

    patient = make_user(db, "priv.patient@x.test")
    assigned = make_doctor(db, "priv.assigned@x.test")
    invited = make_doctor(db, "priv.invited@x.test")
    stranger = make_doctor(db, "priv.stranger@x.test")
    admin = make_user(db, "priv.admin@x.test", role="Admin")

    stored, _ = write_image(uploads, "scan_union.png")
    scan = make_scan(db, patient.id, stored, doctor_id=assigned.id)

    # consent_share_scan=True: the invited-doctor clause is a PHOTO grant, and
    # the column defaults to False, so it has to be explicit here.
    request_row = AppointmentRequest(
        patient_id=patient.id, scan_id=scan.id, status="Open", consent_share_scan=True,
    )
    db.add(request_row)
    db.commit()
    db.add(AppointmentRequestDoctor(
        request_id=request_row.id, doctor_id=invited.id, response="Pending",
    ))
    db.commit()

    actor_for = lambda user: build_actor(user.id, user.role)  # noqa: E731

    assert image_service.can_view(scan, actor_for(patient), db=db) is True
    assert image_service.can_view(scan, actor_for(assigned), db=db) is True
    # THE CLAUSE THAT MATTERS: invited, but NOT ai_scans.doctor_id.
    assert scan.doctor_id != invited.id
    assert image_service.can_view(scan, actor_for(invited), db=db) is True
    assert image_service.can_view(scan, actor_for(stranger), db=db) is False
    assert actor_for(admin).can(Permission.SCAN_READ_ANY)
    assert image_service.can_view(scan, actor_for(admin), db=db) is True


def test_withdrawn_invitation_loses_access(db, app, uploads):
    from app.core.rbac import build_actor
    from app.models import AppointmentRequest, AppointmentRequestDoctor

    patient = make_user(db, "wd.patient@x.test")
    doctor = make_doctor(db, "wd.doctor@x.test")
    stored, _ = write_image(uploads, "scan_withdrawn.png")
    scan = make_scan(db, patient.id, stored)

    request_row = AppointmentRequest(
        patient_id=patient.id, scan_id=scan.id, status="Open", consent_share_scan=True,
    )
    db.add(request_row)
    db.commit()
    link = AppointmentRequestDoctor(
        request_id=request_row.id, doctor_id=doctor.id, response="Withdrawn",
    )
    db.add(link)
    db.commit()

    assert image_service.can_view(scan, build_actor(doctor.id, doctor.role), db=db) is False


def test_invited_doctor_without_photo_consent_cannot_view(db, app, uploads):
    """consent_share_scan=False must be enforced ON THE IMAGE ROUTE, not only in
    the request serializer.

    The serializer nulls `image_url` but still hands the doctor `scan_id`, and
    the doctor's inbox card fetches /api/scans/<id>/image itself -- so a consent
    check that lives only in the JSON is not a consent check at all. The column
    defaults to False, i.e. any request built without the flag fails OPEN.
    """
    from app.core.rbac import build_actor
    from app.models import AppointmentRequest, AppointmentRequestDoctor

    patient = make_user(db, "noconsent.patient@x.test")
    doctor = make_doctor(db, "noconsent.doctor@x.test")
    stored, _ = write_image(uploads, "scan_noconsent.png")
    scan = make_scan(db, patient.id, stored)

    request_row = AppointmentRequest(
        patient_id=patient.id, scan_id=scan.id, status="Open", consent_share_scan=False,
    )
    db.add(request_row)
    db.commit()
    db.add(AppointmentRequestDoctor(
        request_id=request_row.id, doctor_id=doctor.id, response="Pending",
    ))
    db.commit()

    actor = build_actor(doctor.id, doctor.role)
    assert image_service.can_view(scan, actor, db=db) is False
    assert doctor.id not in image_service.invited_doctor_ids(db, scan.id)
    # ...and the clinical fields are unaffected: the doctor is still invited.
    assert scan.doctor_id != doctor.id


# ======================================================================
# 5. THE ENDPOINT  (DB-backed)
# ======================================================================
def test_image_endpoint_permissions_and_logging(client, db, app, uploads, make_token):
    from app.models import ImageAccessLog

    patient = make_user(db, "ep.patient@x.test")
    doctor = make_doctor(db, "ep.doctor@x.test")
    stranger = make_doctor(db, "ep.stranger@x.test")

    stored, _ = write_image(uploads, "scan_endpoint.png")
    scan = make_scan(db, patient.id, stored, doctor_id=doctor.id)
    image_service.generate_variants(stored)

    # Owner, full -> 200 and ONE access-log row.
    response = client.get(
        f"/api/scans/{scan.id}/image", headers=bearer(make_token(patient.id, patient.role))
    )
    assert response.status_code == 200
    assert response.headers["X-Image-Variant"] == "full"
    assert "no-store" in response.headers["Cache-Control"]

    # thumb is NOT logged (too noisy).
    thumb = client.get(
        f"/api/scans/{scan.id}/image?variant=thumb",
        headers=bearer(make_token(doctor.id, doctor.role)),
    )
    assert thumb.status_code == 200
    assert thumb.headers["X-Image-Variant"] == "thumb"

    rows = db.query(ImageAccessLog).filter(ImageAccessLog.scan_id == scan.id).all()
    assert len(rows) == 1
    assert rows[0].variant == "full"
    assert rows[0].viewer_id == patient.id

    # A permitted-but-denied viewer gets 403, NOT 404.
    denied = client.get(
        f"/api/scans/{scan.id}/image", headers=bearer(make_token(stranger.id, stranger.role))
    )
    assert denied.status_code == 403

    # Unauthenticated is 401 -- this is the whole point of the endpoint.
    assert client.get(f"/api/scans/{scan.id}/image").status_code == 401

    # Bad variant is a 400, not a silent fallback.
    bad = client.get(
        f"/api/scans/{scan.id}/image?variant=raw",
        headers=bearer(make_token(patient.id, patient.role)),
    )
    assert bad.status_code == 400


def test_sensitive_scan_serves_blur_to_doctor(client, db, app, uploads, make_token):
    patient = make_user(db, "sens.patient@x.test")
    doctor = make_doctor(db, "sens.doctor@x.test")

    stored, _ = write_image(uploads, "scan_sensitive.png")
    scan = make_scan(db, patient.id, stored, doctor_id=doctor.id, is_sensitive=True)
    built = image_service.generate_variants(stored)
    scan.thumb_url = built["thumb_url"]
    scan.blur_url = built["blur_url"]
    db.commit()

    default = client.get(
        f"/api/scans/{scan.id}/image", headers=bearer(make_token(doctor.id, doctor.role))
    )
    assert default.status_code == 200
    assert default.headers["X-Image-Variant"] == "blur"
    assert default.headers["X-Image-Sensitive"] == "1"

    # The owner still sees their own photograph in full.
    owner = client.get(
        f"/api/scans/{scan.id}/image", headers=bearer(make_token(patient.id, patient.role))
    )
    assert owner.headers["X-Image-Variant"] == "full"

    # An explicit full request from the doctor is honoured AND logged.
    explicit = client.get(
        f"/api/scans/{scan.id}/image?variant=full",
        headers=bearer(make_token(doctor.id, doctor.role)),
    )
    assert explicit.status_code == 200
    assert explicit.headers["X-Image-Variant"] == "full"

    from app.models import ImageAccessLog
    logged = db.query(ImageAccessLog).filter(
        ImageAccessLog.scan_id == scan.id, ImageAccessLog.viewer_id == doctor.id
    ).all()
    assert len(logged) == 1


def test_patch_sensitivity_owner_only(client, db, app, uploads, make_token):
    patient = make_user(db, "flag.patient@x.test")
    doctor = make_doctor(db, "flag.doctor@x.test")

    stored, _ = write_image(uploads, "scan_flag.png")
    scan = make_scan(db, patient.id, stored, doctor_id=doctor.id)

    ok = client.patch(
        f"/api/scans/{scan.id}/sensitivity",
        json={"is_sensitive": True, "reason": "intimate_area"},
        headers=bearer(make_token(patient.id, patient.role)),
    )
    assert ok.status_code == 200
    body = ok.get_json()["data"]
    assert body["is_sensitive"] is True
    assert body["default_variant"] == "blur"

    # The REVIEWING DOCTOR cannot clear the flag -- it protects the patient
    # from them, so only the patient or an admin may change it.
    refused = client.patch(
        f"/api/scans/{scan.id}/sensitivity",
        json={"is_sensitive": False},
        headers=bearer(make_token(doctor.id, doctor.role)),
    )
    assert refused.status_code == 403

    db.expire_all()
    assert db.get(type(scan), scan.id).is_sensitive is True


# ======================================================================
# 6. CONSENT-BASED DELETION KEEPS THE RECORD
# ======================================================================
def test_delete_image_keeps_the_medical_record(client, db, app, uploads, make_token):
    from app.models import AIScan, AuditLog, UserConsent

    patient = make_user(db, "del.patient@x.test")
    doctor = make_doctor(db, "del.doctor@x.test")

    stored, path = write_image(uploads, "scan_delete.png")
    scan = make_scan(db, patient.id, stored, doctor_id=doctor.id)
    built = image_service.generate_variants(stored)
    scan.thumb_url = built["thumb_url"]
    scan.blur_url = built["blur_url"]
    db.commit()
    scan_id = scan.id

    # Guard rails first: every one of these must fail.
    headers = bearer(make_token(patient.id, patient.role))
    assert client.delete(f"/api/scans/{scan_id}/image", json={}, headers=headers).status_code == 400
    assert client.delete(
        f"/api/scans/{scan_id}/image",
        json={"reason": "changed my mind", "confirm_text": "DELETE"},
        headers=headers,
    ).status_code == 400        # consent_ack missing
    assert client.delete(
        f"/api/scans/{scan_id}/image",
        json={"reason": "changed my mind", "consent_ack": True, "confirm_text": "yes"},
        headers=headers,
    ).status_code == 400        # confirm_text wrong

    response = client.delete(
        f"/api/scans/{scan_id}/image",
        json={"reason": "changed my mind", "consent_ack": True, "confirm_text": "DELETE"},
        headers=headers,
    )
    assert response.status_code == 200, response.get_json()
    data = response.get_json()["data"]
    assert data["has_image"] is False
    assert data["image_endpoint"] is None
    assert data["purged_files"] == 3            # main + thumb + blur

    # THE FILES ARE GONE.
    assert not os.path.exists(path)
    assert not (uploads / "thumb_scan_delete.jpg").exists()
    assert not (uploads / "blur_scan_delete.jpg").exists()

    # THE RECORD IS NOT.
    db.expire_all()
    kept = db.query(AIScan).filter(AIScan.id == scan_id).first()
    assert kept is not None
    assert kept.prediction_result == "Melanoma"
    assert kept.confidence == 91.5
    assert kept.severity_level == "URGENT"
    assert kept.doctor_comment == "Looks concerning, please come in."
    assert kept.image_deleted_at is not None
    assert kept.image_deleted_by == patient.id
    assert kept.image_delete_reason == "changed my mind"
    assert kept.image_delete_consent_at is not None

    # Evidence rows.
    consent = db.query(UserConsent).filter(
        UserConsent.target_ref == f"scan:{scan_id}"
    ).first()
    assert consent is not None
    assert consent.consent_type == "image_deletion"
    assert consent.granted is True

    audit = db.query(AuditLog).filter(
        AuditLog.action == "scan.image_delete", AuditLog.target_id == scan_id
    ).first()
    assert audit is not None

    # Reading it now 404s (deleted), not 403 (forbidden).
    gone = client.get(f"/api/scans/{scan_id}/image", headers=headers)
    assert gone.status_code == 404

    # And a second delete is a 409, not a silent success.
    again = client.delete(
        f"/api/scans/{scan_id}/image",
        json={"reason": "again", "consent_ack": True, "confirm_text": "DELETE"},
        headers=headers,
    )
    assert again.status_code == 409


@pytest.mark.parametrize("status", ["Scheduled", "Confirmed", "Pending-Conflict"])
def test_delete_image_refused_while_an_appointment_needs_it(client, db, app, uploads, make_token, status):
    """"Confirmed" is the status the doctor's own Confirm button and every
    conflict resolution produce -- i.e. the most committed upcoming consultation
    there is. It was missing from ACTIVE_APPOINTMENT_STATUSES, so the 409 guard
    silently did not fire and the pixels were unlinked before the visit."""
    from app.models import Appointment

    patient = make_user(db, f"blk.{status.lower()}.patient@x.test")
    doctor = make_doctor(db, f"blk.{status.lower()}.doctor@x.test")

    stored, path = write_image(uploads, f"scan_blocked_{status.lower()}.png")
    scan = make_scan(db, patient.id, stored, doctor_id=doctor.id)

    db.add(Appointment(
        patient_id=patient.id,
        doctor_id=doctor.id,
        scan_id=scan.id,
        appointment_date="2026-08-01",
        appointment_time="09:00 AM",
        status=status,
    ))
    db.commit()

    response = client.delete(
        f"/api/scans/{scan.id}/image",
        json={"reason": "privacy", "consent_ack": True, "confirm_text": "DELETE"},
        headers=bearer(make_token(patient.id, patient.role)),
    )
    assert response.status_code == 409
    assert "appointment" in response.get_json()["error"].lower()
    assert os.path.exists(path)         # nothing was touched


def test_admin_hard_delete_removes_the_row(client, db, app, uploads, make_token):
    from app.models import AIScan, AuditLog

    patient = make_user(db, "hd.patient@x.test")
    admin = make_user(db, "hd.admin@x.test", role="Admin")
    doctor = make_doctor(db, "hd.doctor@x.test")

    stored, path = write_image(uploads, "scan_hard.png")
    scan = make_scan(db, patient.id, stored)
    scan_id = scan.id

    # A doctor cannot: scan.delete.any is ADMIN-only.
    refused = client.delete(
        f"/api/admin/scans/{scan_id}", headers=bearer(make_token(doctor.id, doctor.role))
    )
    assert refused.status_code == 403

    ok = client.delete(
        f"/api/admin/scans/{scan_id}",
        # The admin dialog makes this MANDATORY and promises it is recorded.
        json={"reason": "Duplicate upload reported by the patient", "confirm_text": "DELETE"},
        headers=bearer(make_token(admin.id, admin.role)),
    )
    assert ok.status_code == 200

    db.expire_all()
    assert db.query(AIScan).filter(AIScan.id == scan_id).first() is None
    assert not os.path.exists(path)
    audit = db.query(AuditLog).filter(
        AuditLog.action == "scan.hard_delete", AuditLog.target_id == scan_id
    ).first()
    assert audit is not None
    # WHY the record was destroyed has to survive the record.
    assert "Duplicate upload" in (audit.detail or "")


def test_admin_hard_delete_still_works_without_a_body(client, db, app, uploads, make_token):
    """The reason is recorded when sent, but it is NOT a new 400: authorization
    is complete without it and existing callers post no body."""
    from app.models import AIScan

    patient = make_user(db, "hd2.patient@x.test")
    admin = make_user(db, "hd2.admin@x.test", role="Admin")
    stored, _path = write_image(uploads, "scan_hard_nobody.png")
    scan_id = make_scan(db, patient.id, stored).id

    ok = client.delete(
        f"/api/admin/scans/{scan_id}", headers=bearer(make_token(admin.id, admin.role))
    )
    assert ok.status_code == 200
    db.expire_all()
    assert db.query(AIScan).filter(AIScan.id == scan_id).first() is None


def test_doctor_delete_scan_purges_the_derived_variants(client, db, app, uploads, make_token):
    """/doctor/delete_scan removed image_url only, so the 400px full-colour
    thumbnail and the blur survived a "Scan deleted from history" confirmation --
    with the row that named them gone, nothing could ever find them again."""
    from app.models import AIScan

    patient = make_user(db, "dds.patient@x.test")
    doctor = make_doctor(db, "dds.doctor@x.test")

    stored, path = write_image(uploads, "scan_variants_purge.png")
    scan = make_scan(db, patient.id, stored, doctor_id=doctor.id)
    image_service.ensure_variants(scan, db=db)
    db.commit()

    from app.services import storage_service

    thumb_path = storage_service.absolute_path(scan.thumb_url)
    blur_path = storage_service.absolute_path(scan.blur_url)
    assert os.path.exists(thumb_path) and os.path.exists(blur_path)

    scan_id = scan.id
    response = client.delete(
        f"/doctor/delete_scan/{scan_id}",
        headers=bearer(make_token(doctor.id, doctor.role)),
    )
    assert response.status_code == 200, response.get_json()

    db.expire_all()
    assert db.query(AIScan).filter(AIScan.id == scan_id).first() is None
    assert not os.path.exists(path)
    assert not os.path.exists(thumb_path), "the sharp thumbnail was orphaned on disk"
    assert not os.path.exists(blur_path), "the blur variant was orphaned on disk"


# ======================================================================
# 7. SERIALIZERS CARRY THE NEW KEYS
# ======================================================================
def test_scan_listings_carry_privacy_fields(client, db, app, uploads, make_token):
    patient = make_user(db, "ser.patient@x.test")
    doctor = make_doctor(db, "ser.doctor@x.test")
    stored, _ = write_image(uploads, "scan_serialize.png")
    scan = make_scan(db, patient.id, stored, doctor_id=doctor.id, is_sensitive=True)

    history = client.get(
        f"/patient/scans/{patient.id}", headers=bearer(make_token(patient.id, patient.role))
    )
    assert history.status_code == 200
    item = history.get_json()["data"][0]
    # The legacy key keeps its EXACT legacy shape ('/'-prefixed).
    assert item["image_url"] == "/" + stored
    assert item["is_sensitive"] is True
    assert item["has_image"] is True
    assert item["image_endpoint"] == f"/api/scans/{scan.id}/image"
    assert item["image_deleted_at"] is None

    queue = client.get(
        f"/doctor/scans/{doctor.id}", headers=bearer(make_token(doctor.id, doctor.role))
    )
    assert queue.status_code == 200
    card = queue.get_json()["data"][0]
    assert card["image_url"] == "/" + stored
    assert card["image_endpoint"] == f"/api/scans/{scan.id}/image"


# ======================================================================
# 8. THE RETENTION JOB
# ======================================================================
def test_purge_job_finishes_an_interrupted_delete(db, app, uploads):
    from app.jobs.purge_images import purge_soft_deleted
    from app.models import AIScan

    patient = make_user(db, "job.patient@x.test")
    stored, path = write_image(uploads, "scan_orphan.png")
    scan = make_scan(db, patient.id, stored)

    # Simulate the crash case: the row says deleted, the bytes are still there.
    scan.image_deleted_at = datetime.datetime.utcnow()
    scan.image_purged_at = None
    db.commit()

    assert os.path.exists(path)
    result = purge_soft_deleted(db, grace_hours=0)
    db.commit()

    assert result["scans"] == 1
    assert result["files"] >= 1
    assert not os.path.exists(path)

    db.expire_all()
    assert db.query(AIScan).filter(AIScan.id == scan.id).first().image_purged_at is not None

    # Idempotent: a second sweep finds nothing.
    assert purge_soft_deleted(db, grace_hours=0)["scans"] == 0
