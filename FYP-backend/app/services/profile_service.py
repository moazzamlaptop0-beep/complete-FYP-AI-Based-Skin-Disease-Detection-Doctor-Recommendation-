"""
Self-service account profile: read, partial write, and the account avatar.

WHY THIS MODULE EXISTS
----------------------
Until now the ONLY way any human could edit their own record was
`POST /api/doctor/profile`. That route is doctor-only, multipart-only, and
applies each field `if value:` -- so a patient had no profile at all, an admin
had no profile at all, and a doctor who cleared the "Hospital" box saved
successfully and watched the old value come straight back. It also wrote
`user.email` with no verification whatsoever, which is an account-takeover
primitive dressed as a form field.

`/api/profile` replaces all of that for every role. Three rules define it:

  1. PARTIAL. A key that is absent is not touched. This is what makes a form
     that renders four fields safe to submit without wiping the other six.
  2. AN EMPTY STRING CLEARS. `{"phone": ""}` sets the column to NULL. This is
     the exact OPPOSITE of the legacy route and it is the whole point: "I
     deleted the contents of this box" has to mean something.
  3. `email` and `role` ARE REFUSED. The address has its own OTP flow
     (/auth/email-change/*) because changing it is changing who can log in, and
     a role is not self-service at any price.

`name` IS THE ONE FIELD RULE 2 DOES NOT APPLY TO -- a blank name is a 400. It
is the account's display identity in the doctor directory, in every appointment
row and on every scan a reviewer opens; nulling it renders "null" in six places
and there is no second endpoint that could put it back.

VALIDATION PHILOSOPHY
---------------------
Every rejection names the FIELD in `data.field`, because a form that receives
"Invalid request" cannot highlight anything. Validation is deliberately loose
where the world is messy (phone numbers) and strict where a wrong value is
silently destructive (dates, coordinates, the gender vocabulary).

FORWARD COMPATIBILITY WITH THE LOCATION COLUMNS
-----------------------------------------------
`doctor.state` and `doctor.country` are part of the frozen API shape but the
columns land in a LATER migration. Every read uses getattr() and every write
checks the mapper first, so this module emits `null` and ignores incoming
values until those columns exist, and starts persisting them the moment they
do. No second edit is needed here when they arrive.
"""

import datetime
import logging
import os

from app.services import image_service, storage_service
from app.services.serializers import iso_pk, profile_image_url

logger = logging.getLogger(__name__)


# ======================================================================
# CONTRACT CONSTANTS
# ======================================================================
# The authenticated read path for the account avatar. `avatar_url` (the
# world-readable /static/uploads twin) is served alongside it because an <img>
# tag cannot send an Authorization header; the client picks whichever it can
# use. See app/api/media/routes.py for why that route still exists.
AVATAR_ENDPOINT = "/api/profile/avatar"

AVATAR_MAX_BYTES = 5 * 1024 * 1024        # 5 MB, as the frozen contract says
AVATAR_MAX_PX = 512                       # longest side after downscaling
AVATAR_EXTENSIONS = ("png", "jpg", "jpeg", "webp")

# Top-level keys PATCH accepts. Anything else is ignored EXCEPT the two below,
# which are refused loudly rather than silently dropped -- a client that thinks
# it just changed an email address must not be told "saved".
PATCH_FIELDS = ("name", "phone", "city", "date_of_birth", "gender")
PATCH_REFUSED = ("email", "role")

# Doctor-profile keys PATCH accepts under the nested `doctor` object.
DOCTOR_PATCH_FIELDS = (
    "specialty", "hospital", "city", "phone", "experience",
    "license", "latitude", "longitude", "state", "country",
)

# A closed vocabulary, stored lowercase. Free text here means the column is
# unaggregatable forever and holds whatever forty different clients felt like
# sending. The aliases exist so a client that sends "Male" or "non-binary" is
# accepted rather than 400'd over capitalisation.
GENDER_VALUES = ("male", "female", "other", "prefer_not_to_say")
GENDER_ALIASES = {
    "m": "male", "man": "male", "male": "male",
    "f": "female", "woman": "female", "female": "female",
    "other": "other", "non-binary": "other", "nonbinary": "other",
    "non binary": "other", "nb": "other",
    "prefer_not_to_say": "prefer_not_to_say",
    "prefer not to say": "prefer_not_to_say",
    "prefer-not-to-say": "prefer_not_to_say",
    "undisclosed": "prefer_not_to_say",
    "unspecified": "prefer_not_to_say",
}

# The oldest plausible birth date. A typo like "0202-05-01" is otherwise stored
# happily and every age calculation downstream reads 1800 years.
EARLIEST_BIRTH_YEAR = 1900

ERR_NAME_REQUIRED = "Please enter your name."
ERR_EMAIL_NOT_HERE = (
    "Email cannot be changed here. Request a confirmation code with "
    "/auth/email-change/request instead."
)
ERR_ROLE_NOT_HERE = "Your role cannot be changed from your own profile."
ERR_DOCTOR_ONLY_BLOCK = "Only a doctor account has a doctor profile to edit."
ERR_AVATAR_MISSING = "Choose an image to upload."
ERR_AVATAR_TYPE = "Avatars must be a PNG, JPG or WEBP image."
ERR_AVATAR_TOO_LARGE = "That image is too large. Please choose one under 5 MB."
ERR_AVATAR_UNREADABLE = "That image could not be read. Please try a different file."


class ProfileError(Exception):
    """A rejection the caller can act on: a message plus the field to highlight."""

    def __init__(self, message, field=None, status_code=400):
        super().__init__(message)
        self.message = message
        self.field = field
        self.status_code = status_code


# ======================================================================
# SMALL HELPERS
# ======================================================================
def _has_column(instance, name):
    """True when `name` is a real mapped column on this instance's table.

    Used for `doctor.state` / `doctor.country`, which are contract fields whose
    columns arrive in a later migration. setattr() on a SQLAlchemy instance
    accepts ANY name and silently drops it at flush time, so "did the write
    land?" has to be asked before writing, not after.
    """
    try:
        return name in instance.__table__.columns
    except AttributeError:  # pragma: no cover - not a mapped object
        return False


def _text(value, limit):
    """Trim, cap, and turn an empty result into None (i.e. "clear this")."""
    if value is None:
        return None
    cleaned = str(value).strip()
    if not cleaned:
        return None
    return cleaned[:limit]


def _date_string(value):
    """A date/datetime column -> 'YYYY-MM-DD', or None."""
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        return value.date().isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    return str(value)[:10] or None


# ======================================================================
# FIELD VALIDATORS  -- each returns the value to STORE, or raises ProfileError
# ======================================================================
def clean_name(value):
    cleaned = _text(value, 255)
    if cleaned is None:
        # The single exception to "empty string clears". See the module docstring.
        raise ProfileError(ERR_NAME_REQUIRED, field="name")
    return cleaned


def clean_phone(value, field="phone"):
    """Loose on shape, strict on length. Returns None to clear.

    Deliberately NOT a regex for "a valid phone number" -- that regex does not
    exist, and the ones people write reject real Pakistani landlines. The test
    is: it is made of dialable characters, and it has enough digits to be a
    number rather than a typo.
    """
    cleaned = _text(value, 32)
    if cleaned is None:
        return None
    allowed = set("0123456789+()-. /")
    if any(character not in allowed for character in cleaned):
        raise ProfileError("Please enter a valid phone number.", field=field)
    digits = sum(character.isdigit() for character in cleaned)
    if digits < 7 or digits > 15:
        raise ProfileError("Please enter a valid phone number.", field=field)
    return cleaned


def clean_city(value, field="city", limit=120):
    return _text(value, limit)


def clean_date_of_birth(value):
    """'YYYY-MM-DD' -> date. '' -> None. Anything else is a named 400."""
    if value is None:
        return None
    if isinstance(value, datetime.datetime):
        value = value.date()
    if isinstance(value, datetime.date):
        parsed = value
    else:
        raw = str(value).strip()
        if not raw:
            return None
        try:
            parsed = datetime.datetime.strptime(raw[:10], "%Y-%m-%d").date()
        except ValueError:
            raise ProfileError(
                "Date of birth must look like YYYY-MM-DD.", field="date_of_birth"
            )

    today = datetime.date.today()
    if parsed > today:
        raise ProfileError(
            "Date of birth cannot be in the future.", field="date_of_birth"
        )
    if parsed.year < EARLIEST_BIRTH_YEAR:
        raise ProfileError(
            f"Date of birth must be after {EARLIEST_BIRTH_YEAR}.", field="date_of_birth"
        )
    return parsed


def clean_gender(value):
    if value is None:
        return None
    raw = str(value).strip().lower().replace("_", " ").strip()
    if not raw:
        return None
    resolved = GENDER_ALIASES.get(raw) or GENDER_ALIASES.get(raw.replace(" ", "_"))
    if resolved is None:
        raise ProfileError(
            "Gender must be one of: " + ", ".join(GENDER_VALUES) + ".",
            field="gender",
        )
    return resolved


def clean_experience(value):
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        years = int(float(raw))
    except (TypeError, ValueError):
        raise ProfileError("Years of experience must be a whole number.",
                           field="doctor.experience")
    if years < 0 or years > 70:
        raise ProfileError("Years of experience must be between 0 and 70.",
                           field="doctor.experience")
    return years


def clean_coordinate(value, kind):
    """kind is 'latitude' or 'longitude'. Returns None to clear.

    The bounds matter: a swapped pair (lat 74.3, lon 31.5 for Lahore) puts the
    clinic in Kazakhstan, and only the latitude bound catches it.
    """
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        number = float(raw)
    except (TypeError, ValueError):
        raise ProfileError(f"{kind.title()} must be a number.", field=f"doctor.{kind}")
    limit = 90.0 if kind == "latitude" else 180.0
    if number < -limit or number > limit:
        raise ProfileError(
            f"{kind.title()} must be between -{limit:g} and {limit:g}.",
            field=f"doctor.{kind}",
        )
    return number


# ======================================================================
# SERIALIZATION  -- the shape GET, PATCH and the avatar routes all agree on
# ======================================================================
def avatar_fields(user):
    """The two avatar keys, together, so they can never disagree.

    `avatar_url` is the '/'-prefixed static path (loadable by a plain <img>);
    `avatar_endpoint` is the authenticated route. BOTH are null when there is
    no avatar, so no client ever renders an <img> that is certain to 404.
    """
    stored = getattr(user, "avatar_url", None)
    return {
        "avatar_url": profile_image_url(stored),
        "avatar_endpoint": AVATAR_ENDPOINT if stored else None,
    }


def doctor_profile_block(db, user):
    """The `doctor` key: a dict for a Doctor, None for anybody else.

    Richer than auth_service.doctor_block (which is the five fields the auth
    screen renders) because this one backs an editable form.
    """
    from app.models import DoctorFees, DoctorProfile

    if str(getattr(user, "role", "")) != "Doctor":
        return None

    profile = db.query(DoctorProfile).filter(DoctorProfile.user_id == user.id).first()
    fees = db.query(DoctorFees).filter(DoctorFees.doctor_id == user.id).first()

    if profile is None:
        # Registration creates both rows in one transaction, so this should be
        # unreachable -- but the form still needs a shape to render.
        return {
            "specialty": None, "hospital": None, "city": None, "phone": None,
            "experience": 0, "license": None, "latitude": None, "longitude": None,
            "state": None, "country": None, "profile_image": None,
            "verification_status": "pending", "verification_note": None,
            "fees_pkr": fees.pkr if fees else None,
        }

    return {
        "specialty": profile.specialty,
        "hospital": profile.hospital,
        "city": profile.city,
        "phone": profile.phone,
        "experience": profile.experience if profile.experience is not None else 0,
        "license": profile.license,
        "latitude": float(profile.latitude) if profile.latitude is not None else None,
        "longitude": float(profile.longitude) if profile.longitude is not None else None,
        # Contract fields whose columns arrive with the location migration.
        "state": getattr(profile, "state", None),
        "country": getattr(profile, "country", None),
        "profile_image": profile_image_url(profile.profile_image),
        "verification_status": profile.verification_status or "pending",
        "verification_note": profile.verification_note,
        # None, not 0. "Fee not set" and "consultation is free" are different
        # claims and /api/doctors/public already distinguishes them.
        "fees_pkr": fees.pkr if fees else None,
    }


def serialize(db, user):
    """THE profile payload. GET, PATCH and the avatar routes all return it."""
    payload = {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "phone": getattr(user, "phone", None),
        "city": getattr(user, "city", None),
        "date_of_birth": _date_string(getattr(user, "date_of_birth", None)),
        "gender": getattr(user, "gender", None),
        "is_verified": bool(user.is_verified),
        "created_at": iso_pk(user.created_at),
        # Non-null only while an email change is awaiting its code, which is
        # exactly when the UI has to show the "confirm your new address" banner.
        "pending_email": getattr(user, "pending_email", None),
        "doctor": doctor_profile_block(db, user),
    }
    payload.update(avatar_fields(user))
    return payload


# ======================================================================
# PATCH
# ======================================================================
def _apply_doctor_patch(db, user, block):
    """Write the nested `doctor` object. Returns the list of changed keys.

    Raises ProfileError for a non-doctor: an admin holds DOCTOR_PROFILE_MANAGE
    through the role hierarchy, but has no doctor_profiles row, so creating one
    from their own settings page would invent a clinician.
    """
    from app.models import DoctorProfile

    if str(getattr(user, "role", "")) != "Doctor":
        raise ProfileError(ERR_DOCTOR_ONLY_BLOCK, field="doctor")

    profile = db.query(DoctorProfile).filter(DoctorProfile.user_id == user.id).first()
    if profile is None:
        raise ProfileError(
            "This doctor account has no profile yet. Please contact support.",
            field="doctor", status_code=404,
        )

    changed = []

    if "specialty" in block or "specialization" in block:
        raw = block.get("specialty", block.get("specialization"))
        profile.specialty = _text(raw, 255)
        changed.append("doctor.specialty")

    if "hospital" in block:
        profile.hospital = _text(block["hospital"], 255)
        changed.append("doctor.hospital")

    if "city" in block:
        profile.city = clean_city(block["city"], field="doctor.city", limit=100)
        changed.append("doctor.city")

    if "phone" in block:
        profile.phone = clean_phone(block["phone"], field="doctor.phone")
        changed.append("doctor.phone")

    if "experience" in block:
        years = clean_experience(block["experience"])
        # experience is NOT NULL-ish in practice (default 0) and every listing
        # renders it as a number, so clearing it means 0, not null.
        profile.experience = 0 if years is None else years
        changed.append("doctor.experience")

    for kind in ("latitude", "longitude"):
        if kind in block:
            setattr(profile, kind, clean_coordinate(block[kind], kind))
            changed.append(f"doctor.{kind}")

    # Contract fields, columns pending. Silently ignored rather than 400'd so a
    # client built against the frozen shape works before AND after the location
    # migration lands.
    for optional in ("state", "country"):
        if optional in block:
            if _has_column(profile, optional):
                setattr(profile, optional, _text(block[optional], 120))
                changed.append(f"doctor.{optional}")
            else:
                logger.debug(
                    "doctor.%s ignored: column not present yet (user %s)",
                    optional, user.id,
                )

    if "license" in block:
        license_number = _text(block["license"], 100)
        if license_number and license_number != (profile.license or ""):
            clash = (
                db.query(DoctorProfile)
                .filter(
                    DoctorProfile.license == license_number,
                    DoctorProfile.user_id != user.id,
                )
                .first()
            )
            if clash is not None:
                raise ProfileError(
                    "This license number is already registered with another account.",
                    field="doctor.license",
                )
            # Unchanged behaviour from POST /api/doctor/profile: a NEW licence
            # number has never been seen by an admin, so the old approval does
            # not carry over to it.
            profile.license = license_number
            profile.verification_status = "pending"
            profile.verification_note = None
            profile.verified_at = None
            profile.verified_by = None
            changed.append("doctor.license")
        elif not license_number:
            # A licence is how a doctor is a doctor. Blanking it is not an edit.
            raise ProfileError(
                "A PMDC license number is required.", field="doctor.license"
            )

    return changed


def apply_patch(db, user, payload):
    """Apply a PARTIAL profile update in place. Returns the changed key list.

    Raises ProfileError (message + field + status) for anything refused. The
    caller owns the transaction, the audit row and the response.
    """
    if not isinstance(payload, dict):
        raise ProfileError("A JSON object is required.")

    for refused in PATCH_REFUSED:
        if refused in payload:
            raise ProfileError(
                ERR_EMAIL_NOT_HERE if refused == "email" else ERR_ROLE_NOT_HERE,
                field=refused,
            )

    changed = []

    if "name" in payload:
        user.name = clean_name(payload["name"])
        changed.append("name")

    if "phone" in payload:
        user.phone = clean_phone(payload["phone"])
        changed.append("phone")

    if "city" in payload:
        user.city = clean_city(payload["city"])
        changed.append("city")

    if "date_of_birth" in payload:
        user.date_of_birth = clean_date_of_birth(payload["date_of_birth"])
        changed.append("date_of_birth")

    if "gender" in payload:
        user.gender = clean_gender(payload["gender"])
        changed.append("gender")

    block = payload.get("doctor")
    if block is not None:
        if not isinstance(block, dict):
            raise ProfileError("`doctor` must be an object.", field="doctor")
        changed.extend(_apply_doctor_patch(db, user, block))

    return changed


# ======================================================================
# AVATAR
# ======================================================================
def _remove_stored_avatar(stored):
    if stored:
        storage_service.delete_file(stored)


def save_avatar(user, file_storage):
    """Validate, downscale and persist an account avatar. Returns the stored URL.

    THE ORDER IS THE POINT. Type and size are checked BEFORE a single byte is
    written to disk, so a 40 MB .exe named `me.png` never lands in the uploads
    folder at all. What is finally stored is not the uploaded file: it is a
    re-encoded JPEG at most 512px on its longest side, produced by
    image_service.make_thumbnail -- which also drops EXIF, and with it the GPS
    coordinates a phone camera writes into the photo somebody just made their
    public avatar.
    """
    if file_storage is None or not getattr(file_storage, "filename", ""):
        raise ProfileError(ERR_AVATAR_MISSING, field="avatar")

    extension = storage_service.extension_of(file_storage.filename)
    if extension not in AVATAR_EXTENSIONS:
        raise ProfileError(ERR_AVATAR_TYPE, field="avatar")

    size = storage_service.file_size(file_storage)
    if size > AVATAR_MAX_BYTES:
        raise ProfileError(ERR_AVATAR_TOO_LARGE, field="avatar", status_code=413)

    folder = storage_service.upload_folder()
    os.makedirs(folder, exist_ok=True)

    # The upload is staged under a name the media route would refuse to serve
    # anyway, and is deleted before this function returns either way.
    staging_name = f"tmp_{storage_service.build_avatar_filename(user.id, extension)}"
    staging_path = os.path.join(folder, staging_name)

    final_name = storage_service.build_avatar_filename(user.id, "jpg")
    final_path = os.path.join(folder, final_name)

    try:
        file_storage.save(staging_path)
        if not image_service.make_thumbnail(staging_path, final_path, max_px=AVATAR_MAX_PX):
            raise ProfileError(ERR_AVATAR_UNREADABLE, field="avatar")
    finally:
        try:
            if os.path.exists(staging_path):
                os.remove(staging_path)
        except OSError as exc:  # pragma: no cover - best effort
            logger.warning("Could not clean up avatar staging file %s: %s",
                           staging_path, exc)

    previous = getattr(user, "avatar_url", None)
    user.avatar_url = storage_service.stored_url(final_name)
    # Only after the replacement exists on disk, so a failed re-encode can
    # never leave the account with neither the old file nor a new one.
    if previous and previous != user.avatar_url:
        _remove_stored_avatar(previous)

    return user.avatar_url


def delete_avatar(user):
    """Unlink the file and null the column. True when there was one to remove."""
    previous = getattr(user, "avatar_url", None)
    user.avatar_url = None
    if not previous:
        return False
    _remove_stored_avatar(previous)
    return True


def avatar_path(user):
    """Absolute path of the stored avatar, or None when it is absent on disk."""
    stored = getattr(user, "avatar_url", None)
    if not stored:
        return None
    path = storage_service.absolute_path(stored)
    if not path or not os.path.isfile(path):
        return None
    return path


__all__ = [
    "AVATAR_ENDPOINT",
    "AVATAR_MAX_BYTES",
    "AVATAR_MAX_PX",
    "AVATAR_EXTENSIONS",
    "PATCH_FIELDS",
    "PATCH_REFUSED",
    "DOCTOR_PATCH_FIELDS",
    "GENDER_VALUES",
    "ERR_NAME_REQUIRED",
    "ERR_EMAIL_NOT_HERE",
    "ERR_ROLE_NOT_HERE",
    "ERR_DOCTOR_ONLY_BLOCK",
    "ERR_AVATAR_MISSING",
    "ERR_AVATAR_TYPE",
    "ERR_AVATAR_TOO_LARGE",
    "ERR_AVATAR_UNREADABLE",
    "ProfileError",
    "clean_name",
    "clean_phone",
    "clean_city",
    "clean_date_of_birth",
    "clean_gender",
    "clean_experience",
    "clean_coordinate",
    "avatar_fields",
    "doctor_profile_block",
    "serialize",
    "apply_patch",
    "save_avatar",
    "delete_avatar",
    "avatar_path",
]
