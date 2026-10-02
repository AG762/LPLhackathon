from datetime import datetime

def is_older_than_years(doc_date_str: str, years: int) -> bool:
    if not doc_date_str:
        return False
    try:
        doc_date = datetime.strptime(doc_date_str, "%Y-%m-%d")
        delta_years = (datetime.now() - doc_date).days / 365.25
        return delta_years >= years
    except Exception:
        return False

def decide(doc_type: str, doc_date_str: str, client_name: str = None, active_holds: list = None) -> tuple:
    active_holds = active_holds or []

    # 1. Legal Hold check (Overrides all rules)
    if client_name and any(hold.lower() in client_name.lower() for hold in active_holds):
        return ("RETAIN", f"Locked: Client '{client_name}' is subject to an active legal hold.", "LEGAL_HOLD_OVERRIDE")

    # 2. Regulated 6-year retention (SEC 17a-4 / FINRA 4511)
    if doc_type in ["ACCOUNT_STATEMENT", "TRADE_CONFIRMATION", "ADVISORY_AGREEMENT"]:
        if is_older_than_years(doc_date_str, 6):
            return ("DELETE", "6-year retention period expired under SEC Rule 17a-4.", "SEC_17A4_EXPIRED")
        return ("RETAIN", "Must be preserved under SEC Rule 17a-4 (within 6-year window).", "SEC_17A4_ACTIVE")

    # 3. Communications (3-year retention)
    if doc_type == "CLIENT_COMMUNICATION":
        if is_older_than_years(doc_date_str, 3):
            return ("DELETE", "3-year retention expired under SEC Rule 17a-4(b)(4).", "SEC_17A4_COMM_EXPIRED")
        return ("RETAIN", "Active 3-year communication retention under SEC 17a-4.", "SEC_17A4_COMM_ACTIVE")

    # 4. Drafts and non-business files
    if doc_type in ["DRAFT", "PERSONAL"]:
        return ("DELETE", "Non-record business file; safe for defensible disposal.", "NON_RECORD_DISPOSAL")

    return ("REVIEW", "Classification requires manual compliance review.", "MANUAL_REVIEW")
