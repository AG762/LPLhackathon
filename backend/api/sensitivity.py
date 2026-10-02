"""Sensitivity score from Macie findings (STORIES.md B.6, PLAN.md section 6).

The score decides how urgent a deletion is, never whether it's allowed: legal holds and retention
rules come first. It's the weighted count of sensitive items Macie found in a file:

    SSN, passport, driver's license         10 per item
    bank account / credit card number        8 per item
    date of birth, tax ID                    5 per item
    name, address, phone, email (and other)  1 per item

Priority: HIGH >= 50, MEDIUM 10-49, LOW < 10.

Lives in backend/api (not backend/shared) because the api Lambda only packages this folder, and
D.5's /scan/ingest is the caller.
"""

HIGH_AT = 50
MEDIUM_AT = 10

# Checked in order; the first keyword found in the type name sets the weight. Macie names carry a
# country prefix (USA_SOCIAL_SECURITY_NUMBER); the classifier uses short names (SSN, DOB).
_WEIGHTS = [
    (10, ("SOCIAL_SECURITY", "SSN", "PASSPORT", "DRIVERS_LICENSE", "DRIVER_LICENSE")),
    (8, ("BANK_ACCOUNT", "CREDIT_CARD", "ACCOUNT_NUMBER", "IBAN")),
    (5, ("DATE_OF_BIRTH", "DOB", "TAX_ID", "TAXPAYER", "TAX_IDENTIFICATION", "EMPLOYER_IDENTIFICATION")),
]
_DEFAULT_WEIGHT = 1


def weight(finding_type):
    name = str(finding_type).upper().replace("-", "_").replace(" ", "_")
    for value, keywords in _WEIGHTS:
        if any(k in name for k in keywords):
            return value
    return _DEFAULT_WEIGHT


def priority_for(score):
    return "HIGH" if score >= HIGH_AT else "MEDIUM" if score >= MEDIUM_AT else "LOW"


def score_sensitivity(findings):
    """{finding type: count} -> (score, priority). Counts may be ints or DynamoDB Decimals."""
    score = sum(weight(kind) * int(count) for kind, count in (findings or {}).items())
    return score, priority_for(score)
