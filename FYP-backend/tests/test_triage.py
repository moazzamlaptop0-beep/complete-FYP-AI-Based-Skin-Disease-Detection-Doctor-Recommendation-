"""
Triage engine: the two patient-safety bugs, pinned.

These tests need NO database and NO TensorFlow -- TriageService is pure
functions over ml_service.CLASS_NAMES (a mirror list, not an import of the
model), so they run in milliseconds and cannot be skipped by a missing
TEST_DATABASE_URL.

WHAT EACH TEST IS DEFENDING
---------------------------
1. tier coverage -- DISEASE_TIER used to be keyed on labels ("Melanoma Skin
   Cancer Nevi and Moles") that matched NOTHING the model returns, so every
   lookup fell through to ROUTINE and CRITICAL was unreachable. The coverage
   test fails the moment the map and the dataset drift apart again.
2. confidence units -- ai_scans.confidence is 0-100 and evaluate_urgency is
   0-1, so the low-confidence de-escalation guard could never fire and reasons
   persisted as "8734% confidence".
"""

import re

import pytest

from app.services.ml_service import CLASS_NAMES
from app.services.triage_service import (
    CRITICAL,
    ROUTINE,
    URGENT,
    TriageService,
    normalize_class_name,
)

PERCENT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")

HIGH_RISK_ANSWERS = {
    "is_bleeding": True,       # 3
    "growing_fast": True,      # 3
}


class _FakeScan:
    """The two ai_scans columns triage_for_scan reads. Deliberately not a real
    model instance -- the point is that triage works without a database."""

    def __init__(self, prediction_result, confidence):
        self.prediction_result = prediction_result
        self.confidence = confidence


# ======================================================================
# 1. THE MAP IS ALIVE AND COMPLETE
# ======================================================================
def test_every_model_class_has_an_explicit_tier():
    coverage = TriageService.tier_coverage()
    assert coverage["ok"], f"unmapped model classes: {coverage['missing']}"
    assert coverage["covered"] == coverage["total"] == len(CLASS_NAMES)


def test_assert_tier_coverage_raises_on_drift():
    """A renamed class must EXPLODE, not silently become ROUTINE."""
    with pytest.raises(RuntimeError):
        TriageService.assert_tier_coverage(CLASS_NAMES + ["99. Something New"])


@pytest.mark.parametrize("label,expected", [
    ("2. Melanoma", CRITICAL),
    ("4. Basal Cell Carcinoma (BCC)", CRITICAL),
    ("5. Melanocytic Nevi (NV)", URGENT),
    ("6. Benign Keratosis Lesion(BKL)", URGENT),
    ("8. Seborrheic Keratoses and other Benign Tumors", URGENT),
    ("9. Tinea Ringworm Candidiasis and other Fungal Infections", URGENT),
    ("1. Eczema", ROUTINE),
    ("3. Atopic Dermatitis", ROUTINE),
    ("7. Psoriasis pictures Lichen Planus and related diseases", ROUTINE),
    ("10. Healthy Skin", ROUTINE),
])
def test_tier_table(label, expected):
    assert TriageService.lookup_tier(label) == expected


def test_normalize_class_name_survives_renumbering():
    """A renumbered dataset must not silently break the map."""
    assert normalize_class_name("2. Melanoma") == normalize_class_name("11. Melanoma")
    assert normalize_class_name("2. Melanoma") == normalize_class_name("Melanoma")
    assert TriageService.lookup_tier("11. Melanoma") == CRITICAL
    assert TriageService.lookup_tier("Melanoma") == CRITICAL


def test_unknown_label_is_not_claimed_as_routine():
    """lookup_tier says "no opinion"; only tier_for() applies the fallback."""
    assert TriageService.lookup_tier("Some Unlisted Rash") is None
    assert TriageService.tier_for("Some Unlisted Rash") == ROUTINE


# ======================================================================
# 2. SEVERITY OUTCOMES
# ======================================================================
def test_melanoma_at_high_confidence_is_critical():
    result = TriageService.triage("2. Melanoma", 0.9)
    assert result["severity"] == CRITICAL
    assert result["is_emergency"] is True


def test_melanoma_stored_as_percent_is_also_critical():
    """The DB stores 0-100. triage_for_scan must normalise it."""
    result = TriageService.triage_for_scan(_FakeScan("2. Melanoma", 90.0))
    assert result["severity"] == CRITICAL
    assert result["normalized_confidence"] == pytest.approx(0.9)


def test_healthy_skin_is_routine():
    result = TriageService.triage("10. Healthy Skin", 0.97)
    assert result["severity"] == ROUTINE
    assert result["is_emergency"] is False
    assert result["triage_reasons"] == ["No high-risk indicators detected"]


def test_low_confidence_guard_actually_de_escalates_now():
    """THE BUG: with 0-100 confidence this branch was unreachable, because
    every real value (40.0) is >= the 0.60 threshold."""
    result = TriageService.triage_for_scan(_FakeScan("2. Melanoma", 40.0))
    assert result["severity"] == ROUTINE, "low-confidence melanoma must NOT auto-escalate"
    assert result["disease_tier"] == CRITICAL
    assert "below 60%" in result["triage_reasons"][0]


def test_high_confidence_does_not_de_escalate():
    result = TriageService.triage_for_scan(_FakeScan("4. Basal Cell Carcinoma (BCC)", 75.0))
    assert result["severity"] == CRITICAL


def test_questionnaire_escalates_but_is_capped_at_urgent():
    """Patient self-report alone must never reach CRITICAL."""
    result = TriageService.triage("1. Eczema", 95.0, HIGH_RISK_ANSWERS)
    assert result["severity"] == URGENT
    assert result["triage_score"] == 6
    assert any("Patient reported" in r for r in result["triage_reasons"])


def test_questionnaire_below_threshold_does_not_escalate():
    result = TriageService.triage("1. Eczema", 95.0, {"diameter_over_6mm": True})
    assert result["severity"] == ROUTINE
    assert result["triage_score"] == 1


def test_questionnaire_never_de_escalates_a_critical():
    result = TriageService.triage("2. Melanoma", 95.0, {})
    assert result["severity"] == CRITICAL


# ======================================================================
# 3. NO REASON STRING EVER CLAIMS OVER 100%
# ======================================================================
@pytest.mark.parametrize("confidence", [0.0, 0.4, 0.85, 1.0, 40.0, 87.34, 99.99, 100.0])
@pytest.mark.parametrize("label", ["2. Melanoma", "5. Melanocytic Nevi (NV)", "1. Eczema"])
def test_no_reason_string_reports_more_than_100_percent(label, confidence):
    result = TriageService.triage(label, confidence, HIGH_RISK_ANSWERS)
    for reason in result["triage_reasons"]:
        for found in PERCENT_RE.findall(reason):
            assert float(found) <= 100.0, f"bad percentage in reason: {reason!r}"


def test_legacy_caller_passing_percent_gets_a_sane_reason_string():
    """evaluate_urgency keeps its 0-1 decision semantics, but the DISPLAY is
    hardened so no caller can persist '8734% confidence' again."""
    result = TriageService.evaluate_urgency("2. Melanoma", None, 87.34)
    assert "8734" not in result["triage_reasons"][0]
    assert "87%" in result["triage_reasons"][0]


# ======================================================================
# 4. CONFIDENCE NORMALISATION
# ======================================================================
@pytest.mark.parametrize("raw,expected", [
    (None, 0.85),
    (0.0, 0.0),
    (0.5, 0.5),
    (1.0, 1.0),
    (50, 0.5),
    (87.34, 0.8734),
    (100.0, 1.0),
    (250.0, 1.0),
    (-5, 0.0),
    ("nonsense", 0.85),
])
def test_normalize_confidence(raw, expected):
    assert TriageService.normalize_confidence(raw) == pytest.approx(expected)


# ======================================================================
# 5. EXPRESS LANE -- emergency is possible, never a prerequisite
# ======================================================================
def test_express_lane_is_automatic_for_urgent_and_critical():
    assert TriageService.is_express(CRITICAL) is True
    assert TriageService.is_express(URGENT) is True
    assert TriageService.is_express(ROUTINE) is False


def test_a_routine_patient_may_still_request_express():
    """The whole point: you do NOT need an emergency to get a booking, and you
    do not need a severity to ask for a fast one."""
    assert TriageService.is_express(ROUTINE, requested=True) is True
    assert TriageService.ttl_hours(ROUTINE, requested=True) == TriageService.EXPRESS_TTL_HOURS
    assert TriageService.ttl_hours(ROUTINE) == TriageService.ROUTINE_TTL_HOURS
    assert TriageService.ttl_hours(CRITICAL) == TriageService.EXPRESS_TTL_HOURS
