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
