"""B.6: Macie findings -> sensitivity score and priority (PLAN.md section 6)."""
import pytest

from sensitivity import score_sensitivity


def test_the_twelve_ssn_file_is_high_priority():
    # PLAN.md demo moment: "This file holds 12 SSNs and is past retention. Delete first."
    assert score_sensitivity({"USA_SOCIAL_SECURITY_NUMBER": 12}) == (120, "HIGH")


def test_weights_follow_the_plan():
    findings = {
        "USA_PASSPORT_NUMBER": 1, "USA_DRIVERS_LICENSE": 1,         # 10 each
        "BANK_ACCOUNT_NUMBER": 1, "CREDIT_CARD_NUMBER": 1,          # 8 each
        "DATE_OF_BIRTH": 1, "USA_INDIVIDUAL_TAX_IDENTIFICATION_NUMBER": 1,  # 5 each
        "NAME": 1, "ADDRESS": 1, "PHONE_NUMBER": 1, "EMAIL_ADDRESS": 1,     # 1 each
    }
    assert score_sensitivity(findings)[0] == 10 + 10 + 8 + 8 + 5 + 5 + 4


@pytest.mark.parametrize("findings, priority", [
    ({"NAME": 9}, "LOW"),                            # 9
    ({"NAME": 10}, "MEDIUM"),                        # 10 is the MEDIUM floor
    ({"CREDIT_CARD_NUMBER": 6}, "MEDIUM"),           # 48
    ({"USA_SOCIAL_SECURITY_NUMBER": 5}, "HIGH"),     # 50 is the HIGH floor
    ({}, "LOW"),
])
def test_priority_thresholds(findings, priority):
    assert score_sensitivity(findings)[1] == priority


def test_short_names_from_the_classifier_count_too():
    # Bedrock's pii_detected uses short names (backend/process/prompt.py)
    assert score_sensitivity({"SSN": 1, "DOB": 1, "ACCOUNT_NUMBER": 1}) == (23, "MEDIUM")


def test_unknown_types_count_as_low_weight_items():
    assert score_sensitivity({"SOMETHING_NEW": 3}) == (3, "LOW")


def test_counts_can_arrive_as_decimals_from_dynamodb():
    from decimal import Decimal
    assert score_sensitivity({"USA_SOCIAL_SECURITY_NUMBER": Decimal(6)}) == (60, "HIGH")


# ---------- B.7: classifier fallback for files Macie can't read ----------

from sensitivity import score_file  # noqa: E402


def test_macie_findings_win_when_present():
    file = {"macieFindings": {"USA_SOCIAL_SECURITY_NUMBER": 12}, "piiTypes": ["NAME"]}
    assert score_file(file) == (120, "HIGH", "macie")


def test_a_photo_macie_cannot_read_falls_back_to_the_classifier():
    # A driver's license photo: Macie reports nothing, the classifier saw a license and a birth date.
    file = {"macieFindings": {}, "piiTypes": ["DRIVERS_LICENSE", "DOB"]}
    assert score_file(file) == (15, "MEDIUM", "classifier")


def test_each_classifier_type_counts_once():
    assert score_file({"piiTypes": ["SSN", "SSN", "NAME"]}) == (11, "MEDIUM", "classifier")


def test_no_findings_at_all_scores_zero():
    assert score_file({}) == (0, "LOW", "none")
