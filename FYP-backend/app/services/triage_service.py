"""
Clinical triage & severity engine.

===========================================================================
WHAT THIS PHASE FIXED (both were patient-safety bugs, not cosmetics)
===========================================================================
1. DEAD DISEASE_TIER MAP -- FIXED.
   The map used to be keyed on strings like "Melanoma Skin Cancer Nevi and
   Moles", which match NOTHING the deployed model returns. test_model.py's
   CLASS_NAMES are "1. Eczema", "2. Melanoma", ... so `DISEASE_TIER.get()`
   ALWAYS fell through to 'ROUTINE'. The questionnaire is capped at URGENT, so
   CRITICAL was literally unreachable and the whole emergency lane was dead
   code. DISEASE_TIER is now keyed on the ACTUAL class names, lookups go
   through normalize_class_name() so a renumbered dataset ("11. Melanoma")
   still resolves, and tier_coverage() asserts that EVERY class name maps to an
   explicit tier. /readyz surfaces that assertion, so drift fails loudly
   instead of silently downgrading a melanoma to ROUTINE.

2. CONFIDENCE UNIT MISMATCH -- FIXED at the boundary, not in evaluate_urgency.
   ai_scans.confidence is stored 0-100 (test_model returns percent) but
   evaluate_urgency's threshold and its "%.0f%%" formatting assume 0-1. So
   (a) the low-confidence de-escalation guard could never fire for a real scan
   and (b) reasons persisted as "AI predicted X (8734% confidence)".
   evaluate_urgency KEEPS its 0-1 signature and its decision semantics -- the
   fix is triage_for_scan()/triage(), which normalise to 0-1 BEFORE calling it.
   Only the display formatting inside evaluate_urgency is additionally hardened
   (see _confidence_pct) so no legacy caller can emit a >100% string.

TIER ASSIGNMENTS ARE A SYSTEM-DESIGN STARTING POINT. Have a dermatologist
review this table before production. The point of the code here is that the
table is REACHABLE and PROVABLY COMPLETE, not that its clinical content is
final.
===========================================================================
"""

import logging
import re

logger = logging.getLogger(__name__)

# Mirrors test_model.CLASS_NAMES. Imported from ml_service (which holds the
# same mirror WITHOUT importing TensorFlow), so this module stays free to be
# imported by anything -- including /readyz and the CLI.
from app.services.ml_service import CLASS_NAMES  # noqa: E402

# "1. Eczema" -> "Eczema";  "10. Healthy Skin" -> "Healthy Skin".
_CLASS_PREFIX_RE = re.compile(r"^\s*\d+\s*[.)\-:]?\s*")
_WHITESPACE_RE = re.compile(r"\s+")

CRITICAL = "CRITICAL"
URGENT = "URGENT"
ROUTINE = "ROUTINE"


def normalize_class_name(name):
    """Canonical key for a model class label.

    Strips the leading "N. " ordinal, collapses whitespace and casefolds, so a
    renumbered or re-ordered dataset ("11. Melanoma", "2.Melanoma", "Melanoma")
    keeps resolving to the same tier instead of silently falling through to
    ROUTINE. Returns '' for anything falsy.
    """
    if not name:
        return ""
    text = _CLASS_PREFIX_RE.sub("", str(name).strip())
    text = _WHITESPACE_RE.sub(" ", text)
    return text.casefold()


class TriageService:
    # ------------------------------------------------------------------
    # DISEASE -> TIER.
    # Keys are the EXACT strings the deployed model returns (test_model.py's
    # CLASS_NAMES). Lookup is normalised, so the ordinal prefix is optional.
    # ------------------------------------------------------------------
    DISEASE_TIER = {
        # --- CRITICAL: malignant, needs a dermatologist now ---------------
        "2. Melanoma": CRITICAL,
        "4. Basal Cell Carcinoma (BCC)": CRITICAL,

        # --- URGENT: warrants human review, not an emergency --------------
        "5. Melanocytic Nevi (NV)": URGENT,
        "6. Benign Keratosis Lesion(BKL)": URGENT,
        "8. Seborrheic Keratoses and other Benign Tumors": URGENT,
        "9. Tinea Ringworm Candidiasis and other Fungal Infections": URGENT,

        # --- ROUTINE: chronic/inflammatory or nothing at all ---------------
        "1. Eczema": ROUTINE,
        "3. Atopic Dermatitis": ROUTINE,
        "7. Psoriasis pictures Lichen Planus and related diseases": ROUTINE,
        "10. Healthy Skin": ROUTINE,
    }

    # Labels from the OLD (never-matching) map plus other public dermatology
    # datasets. Harmless to keep and they make a dataset swap degrade
    # gracefully instead of downgrading everything to ROUTINE. These are NOT
    # part of the coverage assertion -- only CLASS_NAMES is.
    LEGACY_DISEASE_TIER = {
        "Actinic Keratosis Basal Cell Carcinoma and other Malignant Lesions": CRITICAL,
        "Melanoma Skin Cancer Nevi and Moles": CRITICAL,
        "Cellulitis Impetigo and other Bacterial Infections": URGENT,
        "Bullous Disease Photos": URGENT,
        "Lupus and other Connective Tissue diseases": URGENT,
        "Systemic Disease": URGENT,
        "Vasculitis Photos": URGENT,
        "Scabies Lyme Disease and other Infestations and Bites": URGENT,
        "Herpes HPV and other STDs Photos": URGENT,
        "Exanthems and Drug Eruptions": URGENT,
    }

    # Keys MUST match the stepper's questionnaire payload exactly.
    SYMPTOM_WEIGHTS = {
        'is_bleeding': 3,
        'growing_fast': 3,
        'has_severe_pain': 2,
        'irregular_border': 2,
        'color_change': 2,
        'diameter_over_6mm': 1
    }

    TIER_RANK = {ROUTINE: 0, URGENT: 1, CRITICAL: 2}
    CONFIDENCE_THRESHOLD = 0.60  # below this, don't auto-trust a high-risk AI call
    DEFAULT_CONFIDENCE = 0.85    # evaluate_urgency's historical default

    # Express (emergency) lane windows, in hours. An express request has to be
    # answered fast or it is worthless; a routine one can sit for three days.
    EXPRESS_TTL_HOURS = 4
    ROUTINE_TTL_HOURS = 72

    # ------------------------------------------------------------------
    # LOOKUP
    # ------------------------------------------------------------------
    @classmethod
    def _index(cls):
        """{normalised label -> tier}, built once, covering both maps."""
        cached = cls.__dict__.get("_TIER_INDEX")
        if cached is None:
            cached = {}
            for source in (cls.LEGACY_DISEASE_TIER, cls.DISEASE_TIER):
                for label, tier in source.items():
                    cached[normalize_class_name(label)] = tier
            cls._TIER_INDEX = cached
        return cached

    @classmethod
    def lookup_tier(cls, disease_name):
        """The EXPLICIT tier for a label, or None when it is not in the table.

        Deliberately returns None rather than 'ROUTINE' -- "we have no opinion"
        and "we assessed this as routine" are different facts, and conflating
        them is exactly how the old map hid its own deadness.
        """
        if not disease_name:
            return None
        exact = cls.DISEASE_TIER.get(disease_name) or cls.LEGACY_DISEASE_TIER.get(disease_name)
        if exact:
            return exact
        return cls._index().get(normalize_class_name(disease_name))

    @classmethod
    def tier_for(cls, disease_name):
        """lookup_tier() with the historical ROUTINE fallback applied."""
        return cls.lookup_tier(disease_name) or ROUTINE

    # ------------------------------------------------------------------
    # COVERAGE ASSERTION  (surfaced by /readyz)
    # ------------------------------------------------------------------
    @classmethod
    def tier_coverage(cls, class_names=None):
        """Prove every model class has an explicit tier.

        Returns {ok, total, covered, missing[], tiers{}}. `ok` False means the
        dataset drifted away from DISEASE_TIER and some prediction is now
        silently ROUTINE -- which is how a melanoma stops being an emergency.
        """
        names = list(CLASS_NAMES if class_names is None else class_names)
        tiers = {}
        missing = []
        for name in names:
            tier = cls.lookup_tier(name)
            if tier is None:
                missing.append(name)
            else:
                tiers[name] = tier
        return {
            "ok": not missing,
            "total": len(names),
            "covered": len(names) - len(missing),
            "missing": missing,
            "tiers": tiers,
        }

    @classmethod
    def assert_tier_coverage(cls, class_names=None):
        """Raise RuntimeError when a model class has no explicit tier."""
        coverage = cls.tier_coverage(class_names)
        if not coverage["ok"]:
            raise RuntimeError(
                "TriageService.DISEASE_TIER does not cover every model class. "
                f"Unmapped: {coverage['missing']}. Every class MUST have an "
                "explicit tier -- an unmapped class is silently triaged ROUTINE."
            )
        return coverage

    # ------------------------------------------------------------------
    # CONFIDENCE
    # ------------------------------------------------------------------
    @classmethod
    def normalize_confidence(cls, value, default=None):
        """Coerce a confidence in EITHER unit onto the 0-1 scale.

        The model and ai_scans.confidence use 0-100; evaluate_urgency and the
        stepper preview use 0-1. Anything above 1.0 is therefore read as a
        percentage and divided by 100; anything in [0, 1] is taken as already
        normalised. The one ambiguous input is a true percentage below 1%
        (0.5 meaning "0.5%"), which cannot occur here: the model's confidence
        is the max of a 10-class softmax, so it is never under 10%.
        """
        if default is None:
            default = cls.DEFAULT_CONFIDENCE
        if value is None:
            return default
        try:
            number = float(value)
        except (TypeError, ValueError):
            return default
        if number != number:            # NaN
            return default
        if number < 0:
            return 0.0
        if number > 1.0:
            number = number / 100.0
        return min(number, 1.0)

    # ------------------------------------------------------------------
    # THE ENGINE
    # ------------------------------------------------------------------
    @staticmethod
    def evaluate_urgency(disease_name, answers, ai_confidence=0.85):
        """UNCHANGED SIGNATURE AND DECISION SEMANTICS. `ai_confidence` is 0-1.

        Callers holding a 0-100 value must normalise first -- use triage() or
        triage_for_scan(), which do it for you. The only hardening here is that
        the REASON STRING is rendered through _confidence_pct(), so a legacy
        caller that still passes 87.34 gets "87% confidence" instead of the old
        "8734% confidence". That touches text only, never the tier.
        """
        reasons = []

        # 1. Disease-based tier
        disease_tier = TriageService.tier_for(disease_name)
        shown = _confidence_pct(ai_confidence)

        if disease_tier != ROUTINE and ai_confidence < TriageService.CONFIDENCE_THRESHOLD:
            reasons.append(
                f"AI predicted {disease_name} but confidence "
                f"({shown}%) is below {int(TriageService.CONFIDENCE_THRESHOLD*100)}% "
                f"-- flagged for human review instead of auto-escalating"
            )
            disease_tier = ROUTINE
        elif disease_tier != ROUTINE:
            reasons.append(f"AI predicted {disease_name} ({shown}% confidence)")

        # 2. Symptom-based tier from the patient questionnaire (escalate-only,
        # capped at URGENT -- patient self-report alone must never reach CRITICAL)
        symptom_score = 0
        triggered = []
        if answers:
            for key, weight in TriageService.SYMPTOM_WEIGHTS.items():
                if answers.get(key):
                    symptom_score += weight
                    triggered.append(key.replace('_', ' '))

        symptom_tier = URGENT if symptom_score >= 5 else ROUTINE
        if triggered:
            reasons.append(f"Patient reported: {', '.join(triggered)}")

        # 3. Combine -- escalate only, never de-escalate
        final_severity = max(disease_tier, symptom_tier, key=lambda t: TriageService.TIER_RANK[t])

        if not reasons:
            reasons.append("No high-risk indicators detected")

        return {
            "severity": final_severity,
            "triage_score": symptom_score,
            "triage_reasons": reasons,
            "is_emergency": final_severity in [CRITICAL, URGENT]
        }

    # ------------------------------------------------------------------
    # THE CALLABLE THE NEW CODE USES
    # ------------------------------------------------------------------
    @classmethod
    def triage(cls, disease_name, confidence, answers=None):
        """evaluate_urgency() with the confidence normalised to 0-1 first.

        This is the entry point every new caller should use. The returned dict
        is evaluate_urgency's plus `normalized_confidence` and `disease_tier`
        (the tier BEFORE the questionnaire could escalate it), so the stepper
        can explain why a case is urgent.
        """
        normalized = cls.normalize_confidence(confidence)
        result = cls.evaluate_urgency(disease_name, answers, normalized)
        result["normalized_confidence"] = round(normalized, 4)
        result["disease_tier"] = cls.lookup_tier(disease_name) or ROUTINE
        result["disease_tier_known"] = cls.lookup_tier(disease_name) is not None
        return result

    @classmethod
    def triage_for_scan(cls, scan, answers=None):
        """Triage an ai_scans row. THE fix for the 0-100 vs 0-1 mismatch.

        `scan.confidence` is stored 0-100, so it is normalised here before
        evaluate_urgency sees it -- which is what finally makes the
        low-confidence de-escalation guard able to fire on a real scan and what
        keeps "8734%" out of the persisted triage_reasons.
        """
        disease_name = (getattr(scan, "prediction_result", None) or "Skin Condition")
        return cls.triage(disease_name, getattr(scan, "confidence", None), answers)

    # ------------------------------------------------------------------
    # EXPRESS LANE
    # ------------------------------------------------------------------
    @classmethod
    def is_express(cls, severity, requested=False):
        """Emergency is POSSIBLE but never a PREREQUISITE.

        A CRITICAL/URGENT triage puts the request in the express lane
        automatically; a patient may also request it. Neither is required in
        order to book -- that inversion (emergency-before-booking) is the
        behaviour this redesign removes.
        """
        return bool(requested) or severity in (CRITICAL, URGENT)

    @classmethod
    def ttl_hours(cls, severity, requested=False):
        return cls.EXPRESS_TTL_HOURS if cls.is_express(severity, requested) else cls.ROUTINE_TTL_HOURS


def _confidence_pct(value):
    """Render a confidence as an integer percentage, whatever unit it arrived in.

    DISPLAY ONLY. It never feeds a tier decision, so hardening it cannot change
    any severity -- it only stops the "8734% confidence" strings that were being
    persisted into ai_scans.triage_reasons and served verbatim to doctors.
    """
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "0"
    if number != number:
        return "0"
    if number > 1.0:
        number = number / 100.0
    number = max(0.0, min(number, 1.0))
    return f"{number * 100:.0f}"


# ----------------------------------------------------------------------
# IMPORT-TIME COVERAGE CHECK
# ----------------------------------------------------------------------
# Logged, not raised: an unimportable app cannot even serve /readyz to TELL you
# what is wrong. /readyz reports triage_tiers_ok and (unless
# TRIAGE_COVERAGE_FATAL is turned off) answers 503, so the instance is pulled
# out of rotation loudly rather than quietly mis-triaging patients.
TIER_COVERAGE = TriageService.tier_coverage()
if not TIER_COVERAGE["ok"]:  # pragma: no cover - only fires on dataset drift
    logger.critical(
        "TRIAGE TIER DRIFT: %s model class(es) have no explicit tier and will be "
        "triaged ROUTINE: %s", len(TIER_COVERAGE["missing"]), TIER_COVERAGE["missing"],
    )


__all__ = [
    "TriageService",
    "normalize_class_name",
    "TIER_COVERAGE",
    "CRITICAL",
    "URGENT",
    "ROUTINE",
]
