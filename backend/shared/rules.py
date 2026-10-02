from datetime import datetime
from typing import Dict, Any, List, Optional

def parse_date(date_str: Optional[str]) -> Optional[datetime]:
    if not date_str or date_str in ["N/A", "UNKNOWN", ""]:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(date_str.split("T")[0], fmt)
        except Exception:
            continue
    return None

def compute_keep_until(doc_date: datetime, years: int) -> str:
    try:
        keep_date = doc_date.replace(year=doc_date.year + years)
    except ValueError:
        keep_date = doc_date.replace(year=doc_date.year + years, day=28)
    return keep_date.strftime("%Y-%m-%d")

def check_legal_holds(file_meta: Dict[str, Any], active_holds: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    client_name = (file_meta.get("client_name") or file_meta.get("clientName") or "").lower()
    client_id = (file_meta.get("client_id") or file_meta.get("clientId") or "").lower()
    account_id = (file_meta.get("account_id") or file_meta.get("accountId") or "").lower()
    branch_id = (file_meta.get("branch_id") or file_meta.get("branchId") or "").lower()
    filename = (file_meta.get("fileId") or file_meta.get("s3Key") or "").lower()

    for hold in active_holds:
        if not hold.get("active", True):
            continue
        scope_type = hold.get("scopeType", "").upper()
        scope_value = str(hold.get("scopeValue", "")).lower()

        matched = False
        if scope_type == "CLIENT_NAME" and scope_value in client_name:
            matched = True
        elif scope_type == "CLIENT_ID" and scope_value == client_id:
            matched = True
        elif scope_type == "ACCOUNT_ID" and scope_value == account_id:
            matched = True
        elif scope_type == "BRANCH_ID" and scope_value == branch_id:
            matched = True
        elif scope_type == "KEYWORD" and (scope_value in filename or scope_value in client_name):
            matched = True

        if matched:
            return hold
    return None

def evaluate_retention(file_meta: Dict[str, Any], active_holds: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    active_holds = active_holds or []
    doc_type = (file_meta.get("doc_type") or file_meta.get("docType") or "UNKNOWN").upper()
    confidence = float(file_meta.get("confidence", 0.0))
    doc_date_raw = file_meta.get("document_date") or file_meta.get("documentDate")
    doc_date = parse_date(doc_date_raw)

    # 1. Legal Hold check (Strict override)
    hold = check_legal_holds(file_meta, active_holds)
    if hold:
        return {
            "recommendation": "RETAIN",
            "ruleApplied": "LEGAL_HOLD_OVERRIDE",
            "keepUntil": "9999-12-31",
            "rationale": f"Preservation required under active Legal Hold: {hold.get('reason', 'Subject to litigation hold')}",
            "legalHold": True,
            "holdReason": hold.get("reason"),
            "holdId": hold.get("holdId")
        }

    # 2. Low confidence or Unknown doc type -> Manual Review
    if confidence < 0.75 or doc_type in ["UNKNOWN", ""]:
        return {
            "recommendation": "REVIEW",
            "ruleApplied": "MANUAL_REVIEW_REQUIRED",
            "keepUntil": None,
            "rationale": f"Confidence ({confidence:.2f}) is below regulatory threshold (0.75) or document type unrecognized.",
            "legalHold": False,
            "holdReason": None
        }

    # 3. Draft / Personal / Non-record -> Safe for Defensible Disposal
    if "DRAFT" in doc_type or "PERSONAL" in doc_type or doc_type in ["DUPLICATE", "NON_RECORD"]:
        return {
            "recommendation": "DELETE",
            "ruleApplied": "NON_RECORD_DISPOSAL",
            "keepUntil": None,
            "rationale": f"Identified as non-business record ({doc_type}); eligible for immediate defensible disposal.",
            "legalHold": False,
            "holdReason": None
        }

    # 4. Regulated record missing date -> Manual Review
    if not doc_date:
        return {
            "recommendation": "REVIEW",
            "ruleApplied": "MISSING_RECORD_DATE",
            "keepUntil": None,
            "rationale": "Regulated business record is missing verifiable document date for retention schedule.",
            "legalHold": False,
            "holdReason": None
        }

    now = datetime.now()
    age_days = (now - doc_date).days

    # 5. Regulated 6-year retention (SEC 17a-4(c) / FINRA 4511)
    if any(k in doc_type for k in ["ACCOUNT_STATEMENT", "TRADE_CONFIRMATION", "ADVISORY_AGREEMENT", "LEDGER"]):
        retention_years = 6
        keep_until = compute_keep_until(doc_date, retention_years)
        expired = age_days >= (retention_years * 365.25)
        
        if expired:
            return {
                "recommendation": "DELETE",
                "ruleApplied": "SEC_17A4_6YR_EXPIRED",
                "keepUntil": keep_until,
                "rationale": f"6-year regulatory retention period expired on {keep_until} (SEC Rule 17a-4(c)). Defensible disposal authorized.",
                "legalHold": False,
                "holdReason": None
            }
        else:
            return {
                "recommendation": "RETAIN",
                "ruleApplied": "SEC_17A4_6YR_ACTIVE",
                "keepUntil": keep_until,
                "rationale": f"Active regulatory record must be retained until {keep_until} under SEC Rule 17a-4(c) / FINRA 4511.",
                "legalHold": False,
                "holdReason": None
            }

    # 6. Regulated 3-year retention (SEC 17a-4(b))
    if any(k in doc_type for k in ["CLIENT_COMMUNICATION", "CUSTOMER_COMMUNICATION", "CORRESPONDENCE"]):
        retention_years = 3
        keep_until = compute_keep_until(doc_date, retention_years)
        expired = age_days >= (retention_years * 365.25)

        if expired:
            return {
                "recommendation": "DELETE",
                "ruleApplied": "SEC_17A4_3YR_EXPIRED",
                "keepUntil": keep_until,
                "rationale": f"3-year communication retention period expired on {keep_until} (SEC Rule 17a-4(b)). Defensible disposal authorized.",
                "legalHold": False,
                "holdReason": None
            }
        else:
            return {
                "recommendation": "RETAIN",
                "ruleApplied": "SEC_17A4_3YR_ACTIVE",
                "keepUntil": keep_until,
                "rationale": f"Client communication record must be preserved until {keep_until} under SEC Rule 17a-4(b).",
                "legalHold": False,
                "holdReason": None
            }

    return {
        "recommendation": "REVIEW",
        "ruleApplied": "UNMATCHED_SCHEDULE",
        "keepUntil": None,
        "rationale": f"Record type '{doc_type}' requires compliance officer retention schedule determination.",
        "legalHold": False,
        "holdReason": None
    }
