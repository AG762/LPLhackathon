"""The legal-hold demo scenario (STORIES.md G.3). Synthetic data only.

One client, Margaret Whitaker, is under a legal hold for a (fictional) FINRA arbitration. Three of
her files are in the advisor's drive. The 2019 email is the PLAN.md "save": it's past its 3-year
retention window and looks like clutter, but the hold blocks it from deletion.

    2019_Email_Whitaker_Rebalance.eml    client communication, past retention -> blocked by the hold
    2021_Meeting_Notes_Whitaker.txt      meeting notes about her account
    2023_Statement_Whitaker_Sept.txt     account statement, still within retention anyway
    legal_hold.json                      the LegalHolds item A.7's seed script loads

Every file names her as "Client: Margaret Whitaker" so the classifier extracts that client name,
which the hold matches (CLIENT_NAME scope, see backend/api/holds.py).

    python data/generate_legal_hold.py   # files -> data/samples/, hold -> data/legal_hold.json
"""
import json
import os

CLIENT = "Margaret Whitaker"
ACCOUNT = "LPL-731904"

HOLD = {
    "holdId": "HOLD-24-01187",
    "scopeType": "CLIENT_NAME",
    "scopeValue": CLIENT,
    "reason": "FINRA arbitration 24-01187 (synthetic demo case): preserve all records for this client",
    "createdBy": "compliance@example.com",
    "createdAt": "2024-03-04",
    "active": True,
}

FILES = {
    "2019_Email_Whitaker_Rebalance.eml": f"""From: Jordan Reyes <jordan.reyes@example.com>
To: Margaret Whitaker <margaret.whitaker@example.com>
Date: Wed, 14 Aug 2019 10:12:00 -0500
Subject: Re: Rebalancing your retirement account

Client: {CLIENT}
Account: {ACCOUNT}

Hi Margaret,

Following our call, I've moved 15% of the growth allocation into the short-term bond fund we
discussed, effective today. You'll see the trade confirmations in two to three business days.

Best,
Jordan Reyes
Branch 214, Austin TX
""",
    "2021_Meeting_Notes_Whitaker.txt": f"""CLIENT MEETING NOTES
Date: 2021-02-09
Client: {CLIENT}
Account: {ACCOUNT}
Advisor: Jordan Reyes

Reviewed the 2019 rebalance. Client questioned the timing and the bond fund's fees.
Agreed to send a fee breakdown and a summary of the August 2019 trades.
Follow-up: schedule review in Q2.
""",
    "2023_Statement_Whitaker_Sept.txt": f"""LPL FINANCIAL ACCOUNT STATEMENT
Statement period: 2023-09-01 to 2023-09-30
Client: {CLIENT}
Account: {ACCOUNT}

Beginning value      $482,915.20
Deposits                   $0.00
Withdrawals            $2,500.00
Change in value        -$3,118.44
Ending value         $477,296.76
""",
}


def build(out_dir, hold_dir=None):
    """Write the client's files into out_dir and legal_hold.json into hold_dir (default out_dir).

    Returns the names written. Keep the hold file out of data/samples/ in real runs so it isn't
    uploaded as a demo document.
    """
    hold_dir = hold_dir or out_dir
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(hold_dir, exist_ok=True)
    for name, text in FILES.items():
        with open(os.path.join(out_dir, name), "w") as f:
            f.write(text)
    with open(os.path.join(hold_dir, "legal_hold.json"), "w") as f:
        json.dump(HOLD, f, indent=2)
        f.write("\n")
    return sorted([*FILES, "legal_hold.json"])


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    build(os.path.join(here, "samples"), hold_dir=here)
    for name in FILES:
        print(f"Created: data/samples/{name}")
    print("Created: data/legal_hold.json (seed this into LegalHolds; A.7)")
