"""Load-test dataset: as many synthetic advisor files as you ask for (synthetic data only, nothing real).

A realistic mix of what sits on a branch drive, so classification, retention rules, legal holds and the
sensitive-data scan all get exercised at volume:

    statements 24%, trade confirmations 20%, client emails 14%, drafts + finals 8%, duplicates 6%,
    marketing 6%, personal files 10%, expired SSN / ID copies 6%, unclear scans 4%,
    files for Margaret Whitaker (the demo legal-hold client) 2%

Dates run 2013-2026, so some files are past retention and some aren't. The same seed gives the same files.

    python data/generate_load.py --count 1000 --out ~/Desktop/"ShredSafe test files"/1000
"""
import argparse
import os
import random

FIRST = ["Adaeze", "Wei", "Margaret", "Daniel", "Priya", "Marcus", "Elena", "Tom", "Sofia", "James", "Aisha", "Lucas",
         "Hannah", "Omar", "Grace", "Mateo", "Chloe", "Ravi", "Nora", "Samuel", "Yuki", "Isabel", "Andre", "Leila"]
LAST = ["Okafor", "Chen", "Novak", "Ramirez", "Lindqvist", "Brennan", "Delgado", "Sato", "Patel", "Kowalski", "Haddad",
        "Fischer", "Mensah", "Moreau", "Silva", "Byrne", "Ivanova", "Tanaka", "Abebe", "Larsen", "Costa", "Weiss"]
HOLD_CLIENT = "Margaret Whitaker"  # matches the seeded demo legal hold (data/legal_hold.json)
SYMBOLS = ["AAPL", "MSFT", "NVDA", "SPY", "VTI", "BND", "AMZN", "JNJ", "KO", "VXUS", "AGG", "GOOGL"]
ADVISOR = "Jordan Reyes, Branch 214, Austin TX"


def client(rng):
    return f"{rng.choice(FIRST)} {rng.choice(LAST)}"


def date(rng, start=2013, end=2026):
    year = rng.randint(start, end)
    month = rng.randint(1, 12 if year < 2026 else 8)
    return f"{year}-{month:02d}-{rng.randint(1, 28):02d}"


def account(rng):
    return f"ACCT-{rng.randint(10000, 99999)}"


def fake_ssn(rng):
    # Area 9xx is never issued, so these can't be anyone's real number; Macie still reads the pattern.
    return f"9{rng.randint(10, 99)}-{rng.randint(10, 99)}-{rng.randint(1000, 9999)}"


def statement(rng, who):
    d = date(rng)
    value = rng.uniform(20_000, 2_000_000)
    body = f"""LPL FINANCIAL ACCOUNT STATEMENT
Statement period: {d[:7]}-01 to {d}
Client: {who}
Account: {account(rng)}

Beginning value      ${value:,.2f}
Deposits             ${rng.uniform(0, 20000):,.2f}
Withdrawals          ${rng.uniform(0, 15000):,.2f}
Ending value         ${value * rng.uniform(0.95, 1.06):,.2f}
"""
    return f"Statement_{who.split()[-1]}_{d[:7].replace('-', '_')}", body


def confirm(rng, who):
    d, sym = date(rng), rng.choice(SYMBOLS)
    body = f"""LPL FINANCIAL TRADE CONFIRMATION
Trade date: {d}
Client: {who}
Account: {account(rng)}
Action: {rng.choice(['BUY', 'SELL'])} {rng.randint(5, 900)} {sym} @ ${rng.uniform(20, 900):,.2f}
Status: EXECUTED
"""
    return f"Trade_Confirm_{sym}_{d[:7].replace('-', '_')}", body


def email(rng, who):
    d = date(rng)
    topic = rng.choice(["Rebalancing your portfolio", "Required minimum distribution", "Beneficiary update",
                        "Quarterly review notes", "Roth conversion question", "Fee schedule change"])
    body = f"""From: Jordan Reyes <jordan.reyes@example.com>
To: {who} <client@example.com>
Date: {d}
Subject: {topic}

Client: {who}

Following up on our call about {topic.lower()}. I recommend we keep the current allocation and revisit next quarter.

Jordan Reyes
{ADVISOR}
"""
    return f"Email_{who.split()[-1]}_{d[:7].replace('-', '_')}", body


def plan(rng, who, final):
    d = date(rng, 2019)
    status = "FINAL - DELIVERED TO CLIENT" if final else f"DRAFT v{rng.randint(1, 3)} - NOT FOR CLIENT DISTRIBUTION"
    body = f"""FINANCIAL PLAN PROPOSAL ({status})
Client: {who}
Prepared: {d}
Prepared by: {ADVISOR}

Goal: retirement income of ${rng.randint(60, 180)},000 a year from age {rng.randint(60, 68)}.
Recommended allocation: {rng.randint(40, 70)}% equities, the rest bonds and cash.
"""
    return f"Financial_Plan_{who.split()[-1]}_{'FINAL' if final else 'draft'}", body


def marketing(rng):
    d = date(rng)
    title = rng.choice(["Market Outlook", "Retirement Seminar", "Spring Newsletter", "Tax Season Tips", "Year in Review"])
    body = f"""{title.upper()} - {d[:4]}
Published: {d}
From the desk of {ADVISOR}

Markets were mixed this quarter. As always, stay diversified and talk to us before making changes.
"""
    return f"{title.replace(' ', '_')}_{d[:4]}", body


def personal(rng):
    kind = rng.choice(["Fantasy_Football_Draft", "Gym_Receipt", "Vacation_Itinerary", "Office_Potluck_Recipes",
                       "Kids_Soccer_Schedule", "Car_Service_Invoice", "Book_Club_List"])
    d = date(rng, 2018)
    return f"{kind}_{d[:4]}", f"{kind.replace('_', ' ')}\nDate: {d}\n\nPersonal note, not a business record.\n"


def expired_pii(rng, who):
    d = date(rng, 2013, 2018)
    body = f"""FORM W-9 (copy kept on file)
Name: {who}
Social Security Number: {fake_ssn(rng)}
Date of birth: {rng.randint(1940, 1990)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}
Account closed: {d}
"""
    return f"W9_Copy_{who.split()[-1]}_{d[:4]}", body


def unclear(rng):
    return f"scan_{rng.randint(1000, 9999)}", "Scanned page. Text could not be read clearly.\n\n....\n"


def build(count, out_dir, seed=2026):
    rng = random.Random(seed)
    os.makedirs(out_dir, exist_ok=True)
    made, names, recent = 0, set(), []
    weights = [("statement", 24), ("confirm", 20), ("email", 14), ("plan", 8), ("duplicate", 6), ("marketing", 6),
               ("personal", 10), ("pii", 6), ("unclear", 4), ("hold", 2)]
    kinds = [k for k, w in weights for _ in range(w)]
    while made < count:
        kind = rng.choice(kinds)
        who = client(rng)
        if kind == "statement":
            stem, body = statement(rng, who)
        elif kind == "confirm":
            stem, body = confirm(rng, who)
        elif kind == "email":
            stem, body = email(rng, who)
        elif kind == "plan":
            stem, body = plan(rng, who, final=rng.random() < 0.4)
        elif kind == "duplicate" and recent:
            stem, body = rng.choice(recent)
            stem = f"{stem} (copy)"
        elif kind == "marketing":
            stem, body = marketing(rng)
        elif kind == "personal":
            stem, body = personal(rng)
        elif kind == "pii":
            stem, body = expired_pii(rng, who)
        elif kind == "hold":
            stem, body = rng.choice([statement, email, confirm])(rng, HOLD_CLIENT)
        else:
            stem, body = unclear(rng)
        name, n = f"{stem}.txt", 2
        while name in names:  # several files can share a stem; keep every name unique
            name, n = f"{stem}_{n}.txt", n + 1
        names.add(name)
        with open(os.path.join(out_dir, name), "w") as f:
            f.write(body)
        if kind not in ("duplicate", "unclear"):
            recent = (recent + [(stem, body)])[-50:]
        made += 1
    return made


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, default=1000)
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=2026)
    args = parser.parse_args()
    out = os.path.expanduser(args.out)
    print(f"Wrote {build(args.count, out, args.seed)} files to {out}")


if __name__ == "__main__":
    main()
