"""The rest of the demo dataset (STORIES.md G.1, PLAN.md section 11). Synthetic data only.

Adds 31 files to data/samples/ (42 in all with generate.py, generate_pii.py and
generate_legal_hold.py): account statements and trade confirmations across the 6-year line,
drafts with their finals, exact duplicates, client emails on the 3-year line, marketing on the
5-year line, image scans the text pipeline can't read, and personal junk.

Dates sit at least six months away from any retention boundary, so data/expected.csv stays right
for the hackathon. No file names a client under a demo legal hold (Arthur Smith, Margaret
Whitaker). Each file states its type, date and client the way the classifier reads them.

    python data/generate_more.py   # writes into data/samples/
"""
import os
import struct
import zlib

ADVISOR = "Jordan Reyes, Branch 214, Austin TX"


def _statement(client, account, start, end, value):
    return f"""LPL FINANCIAL ACCOUNT STATEMENT
Statement period: {start} to {end}
Client: {client}
Account: {account}

Beginning value      ${value:,.2f}
Deposits                  $0.00
Withdrawals           $1,200.00
Ending value         ${value * 1.012 - 1200:,.2f}
"""


def _confirm(client, account, date, side, qty, symbol, price):
    return f"""LPL FINANCIAL TRADE CONFIRMATION
Trade date: {date}
Client: {client}
Account: {account}
Action: {side} {qty} {symbol} @ ${price:,.2f}
Status: EXECUTED
"""


def _email(client, date, subject, body):
    return f"""From: {ADVISOR.split(',')[0]} <jordan.reyes@example.com>
To: {client} <client@example.com>
Date: {date}
Subject: {subject}

Client: {client}

{body}

Jordan Reyes
{ADVISOR}
"""


def _plan(client, date, version, final):
    status = "FINAL - DELIVERED TO CLIENT" if final else f"DRAFT {version} - NOT FOR CLIENT DISTRIBUTION"
    return f"""{status}
Retirement Income Plan
Client: {client}
Date: {date}
Prepared by: {ADVISOR}

Recommended withdrawal rate: {"4.0" if final else "4.5"}% per year
Allocation: {"55% bonds / 45% equities" if final else "50% bonds / 50% equities (to be reviewed)"}
"""


def _marketing(title, date, body):
    return f"""{title}
Published: {date}
From the advisors at Branch 214

{body}

This material is for general information only and is not a recommendation.
"""


TEXT_FILES = {
    # Account statements: 6-year retention (SEC 17a-4)
    "Statement_Okafor_2017_03.txt": _statement("Daniel Okafor", "LPL-551204", "2017-03-01", "2017-03-31", 214_880.10),
    "Statement_Chen_2018_09.txt": _statement("Mei Chen", "LPL-330917", "2018-09-01", "2018-09-30", 98_412.55),
    "Statement_Lindqvist_2021_06.txt": _statement("Elena Lindqvist", "LPL-770413", "2021-06-01", "2021-06-30", 412_006.00),
    "Statement_Ramirez_2024_12.txt": _statement("Rafael Ramirez", "LPL-640288", "2024-12-01", "2024-12-31", 156_730.42),
    "Statement_Novak_2026_06.txt": _statement("Tomas Novak", "LPL-219956", "2026-06-01", "2026-06-30", 87_120.00),
    # Trade confirmations: 6-year retention (SEC 17a-4 / FINRA 4511)
    "Trade_Confirm_MSFT_2016_11.txt": _confirm("Daniel Okafor", "LPL-551204", "2016-11-14", "SOLD", 120, "MSFT", 59.43),
    "Trade_Confirm_VTI_2019_02.txt": _confirm("Mei Chen", "LPL-330917", "2019-02-20", "BOUGHT", 80, "VTI", 141.02),
    "Trade_Confirm_BND_2022_08.txt": _confirm("Elena Lindqvist", "LPL-770413", "2022-08-09", "BOUGHT", 300, "BND", 76.88),
    "Trade_Confirm_NVDA_2025_04.txt": _confirm("Rafael Ramirez", "LPL-640288", "2025-04-03", "SOLD", 40, "NVDA", 110.42),
    "Trade_Confirm_SPY_2026_03.txt": _confirm("Tomas Novak", "LPL-219956", "2026-03-16", "BOUGHT", 25, "SPY", 571.10),
    # Drafts and their finals
    "Q3_Financial_Plan_Proposal_v2_draft.txt": """DRAFT PROPOSAL v2 - NOT FOR CLIENT DISTRIBUTION
Prepared by: Advisor Associate
Date: 2023-09-08
Notes: Revised allocations after supervisor comments. Superseded by the final version.
""",
    "Q3_Financial_Plan_Proposal_FINAL.txt": _email(
        "Grace Albright", "2026-07-15", "Your Q3 financial plan",
        "Attached is your final Q3 plan. We recommend moving 10% of cash into a short-term Treasury ladder."),
    "Retirement_Income_Plan_Okafor_v1.txt": _plan("Daniel Okafor", "2025-08-04", "v1", final=False),
    "Retirement_Income_Plan_Okafor_v2.txt": _plan("Daniel Okafor", "2025-08-19", "v2", final=False),
    "Retirement_Income_Plan_Okafor_FINAL.txt": _plan("Daniel Okafor", "2025-09-02", "final", final=True),
    # Client emails: 3-year retention (SEC 17a-4(b)(4))
    "Email_Brennan_2018_05.eml": _email("Owen Brennan", "2018-05-22", "Re: 529 plan contribution",
                                        "Your May contribution to the 529 plan has been invested in the age-based portfolio."),
    "Email_Sato_2022_01.eml": _email("Hiro Sato", "2022-01-11", "Re: Rebalancing for 2022",
                                     "As discussed, we rebalanced back to your 60/40 target this morning."),
    "Email_Delgado_2025_11.eml": _email("Sofia Delgado", "2025-11-04", "Your Roth conversion",
                                       "We recommend converting $20,000 to your Roth IRA before year end."),
    # Marketing: 5-year retention (Advisers Act 204-2)
    "Newsletter_Spring_2019.txt": _marketing("SPRING 2019 CLIENT NEWSLETTER", "2019-04-02",
                                             "Markets steadied this quarter. Three questions to ask before you refinance."),
    "Seminar_Flyer_Retirement_2020.txt": _marketing("RETIREMENT READINESS SEMINAR", "2020-10-01",
                                                    "Join us Thursday at 6 pm for a free seminar on Social Security timing."),
    "Newsletter_Winter_2024.txt": _marketing("WINTER 2024 CLIENT NEWSLETTER", "2024-01-15",
                                             "What higher rates mean for your bond ladder, and a checklist for tax season."),
    "Market_Outlook_2026.txt": _marketing("2026 MARKET OUTLOOK", "2026-01-12",
                                          "Our view on rates, earnings and diversification for the year ahead."),
    # Personal files: no retention requirement
    "Fantasy_Football_Draft_2023.txt": "Branch 214 fantasy league, 2023 draft order\n1. Jordan  2. Priya  3. Marcus  4. Leah\nTrash talk channel: #ff-league\n",
    "Gym_Receipt_2024.txt": "RIVERSIDE FITNESS\nMonthly membership, March 2024\nAmount paid: $49.00\nThank you for your visit!\n",
    "Vacation_Itinerary_Cabo_2022.txt": "Cabo San Lucas, June 2022\nFlight AA 1442 departs 8:05 am\nHotel check-in: 3 pm\nSnorkel tour Tuesday\n",
}

# Exact copies: same bytes as an original already in the set
DUPLICATES = {
    "Statement_Chen_2018_09 (1).txt": "Statement_Chen_2018_09.txt",
    "Trade_Confirm_MSFT_2016_11 - Copy.txt": "Trade_Confirm_MSFT_2016_11.txt",
    "Newsletter_Spring_2019 (copy).txt": "Newsletter_Spring_2019.txt",
}

# Images the text pipeline can't read (photos and scans); size and seed make each one distinct
IMAGES = {"ID_Scan_Okafor_2015.png": (640, 400, 3), "W9_Scan_Chen_2017.png": (612, 792, 7), "Funny_Cat_Meme.png": (500, 500, 11)}


def _png(width, height, seed):
    """A small deterministic grayscale PNG (a stand-in for a scanned page or photo)."""
    rows = b"".join(b"\x00" + bytes(((x * seed + y * 3) // 8) % 64 + 160 for x in range(width)) for y in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def build(out_dir):
    """Write the files into out_dir. Returns the names written."""
    os.makedirs(out_dir, exist_ok=True)
    files = {name: text.encode() for name, text in TEXT_FILES.items()}
    files.update({copy: files[original] for copy, original in DUPLICATES.items()})
    files.update({name: _png(*args) for name, args in IMAGES.items()})
    for name, content in files.items():
        with open(os.path.join(out_dir, name), "wb") as f:
            f.write(content)
    return sorted(files)


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples")
    for name in build(out):
        print(f"Created: data/samples/{name}")
