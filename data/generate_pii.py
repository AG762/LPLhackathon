"""High-PII demo files that Amazon Macie can detect (STORIES.md G.2). Synthetic data only.

These are the files behind the demo's "high exposure" moment: past retention and full of client
data, so the scan moves them to the top of the queue.

    2016_Client_List_Export.csv      50 clients: name, SSN, date of birth, address, phone
    2018_W9_Forms_Batch.txt          12 W-9 forms, each "SSN: ###-##-####" (PLAN.md's 12-SSN file)
    2019_Account_Holder_Export.pdf   20 holders: account number and date of birth, as a text PDF

Macie finds an identifier most reliably next to its keyword ("SSN", "Date of birth", "Account
number"), so every value is labelled. Output is seeded, so every run produces identical bytes.

Fake-data rules: names are invented, emails use example.com, and phones use 555-01xx (reserved for
fiction). SSNs are well formed so Macie recognizes them, but they're random, avoid 000/666/9xx
areas, and belong to no one.

    python data/generate_pii.py            # writes into data/samples/
"""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "api"))
import pdf  # noqa: E402  (the dependency-free writer used for the certificate)

SEED = 4511  # FINRA Rule 4511
FIRST = ["Avery", "Jordan", "Priya", "Marcus", "Elena", "Tomas", "Grace", "Hiro", "Nadia", "Owen",
         "Sofia", "Daniel", "Leah", "Rafael", "Mei", "Caleb", "Amara", "Victor", "Ruth", "Samir"]
LAST = ["Okafor", "Lindqvist", "Ramirez", "Chen", "Whitfield", "Novak", "Adeyemi", "Kowalski",
        "Haddad", "Brennan", "Sato", "Delgado", "Fischer", "Mensah", "Albright", "Petrov"]
STREETS = ["Maple Ave", "Cedar St", "Harbor Rd", "Ridgeview Dr", "Elm Ct", "Lakeshore Blvd", "Mill Ln"]
CITIES = [("Austin", "TX", "787"), ("Raleigh", "NC", "276"), ("Columbus", "OH", "432"), ("Tucson", "AZ", "857")]

EXPECTED_FINDINGS = {
    "2016_Client_List_Export.csv": {"USA_SOCIAL_SECURITY_NUMBER": 50, "DATE_OF_BIRTH": 50, "NAME": 50,
                                    "ADDRESS": 50, "PHONE_NUMBER": 50},
    "2018_W9_Forms_Batch.txt": {"USA_SOCIAL_SECURITY_NUMBER": 12, "NAME": 12, "ADDRESS": 12},
    "2019_Account_Holder_Export.pdf": {"BANK_ACCOUNT_NUMBER": 20, "DATE_OF_BIRTH": 20, "NAME": 20},
}


def _ssn(rng):
    area = rng.choice([a for a in range(1, 900) if a != 666])
    return f"{area:03d}-{rng.randint(1, 99):02d}-{rng.randint(1, 9999):04d}"


def _person(rng):
    first, last = rng.choice(FIRST), rng.choice(LAST)
    city, state, zip3 = rng.choice(CITIES)
    return {
        "name": f"{first} {last}",
        "ssn": _ssn(rng),
        "dob": f"{rng.randint(1938, 1990)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
        "address": f"{rng.randint(100, 9899)} {rng.choice(STREETS)}, {city}, {state} {zip3}{rng.randint(10, 99)}",
        "phone": f"({rng.randint(201, 989)}) 555-01{rng.randint(0, 99):02d}",
        "email": f"{first}.{last}@example.com".lower(),
        "account": f"{rng.randint(1000, 9999)}{rng.randint(100000, 999999)}",
    }


def _client_list(rng):
    rows = ["Name,SSN,Date of Birth,Address,Phone,Email"]
    for _ in range(50):
        p = _person(rng)
        rows.append(f'{p["name"]},{p["ssn"]},{p["dob"]},"{p["address"]}",{p["phone"]},{p["email"]}')
    return ("\n".join(rows) + "\n").encode()


def _w9_batch(rng):
    parts = ["W-9 REQUEST FOR TAXPAYER IDENTIFICATION NUMBER - SCANNED BATCH, BRANCH 214, 2018", ""]
    for n in range(1, 13):
        p = _person(rng)
        parts += [f"Form {n} of 12", f"Name: {p['name']}", f"Address: {p['address']}",
                  f"SSN: {p['ssn']}", "Certification: signed", ""]
    return "\n".join(parts).encode()


def _account_export(rng):
    lines = [("Account Holder Export, closed accounts, 2019", "title"),
             ("Exported from the branch CRM for archive. Synthetic demo data.", "small"), ("", "body")]
    for _ in range(20):
        p = _person(rng)
        lines += [(p["name"], "bold"),
                  (f"Account number: {p['account']}    Date of birth: {p['dob']}", "body"),
                  ("", "body")]
    return pdf.render(lines, title="Account Holder Export 2019")


def build(out_dir):
    """Write the three files into out_dir. Returns the file names written."""
    os.makedirs(out_dir, exist_ok=True)
    files = {
        "2016_Client_List_Export.csv": _client_list(random.Random(SEED)),
        "2018_W9_Forms_Batch.txt": _w9_batch(random.Random(SEED + 1)),
        "2019_Account_Holder_Export.pdf": _account_export(random.Random(SEED + 2)),
    }
    for name, content in files.items():
        with open(os.path.join(out_dir, name), "wb") as f:
            f.write(content)
    return sorted(files)


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples")
    for name in build(out):
        print(f"Created: {os.path.join(out, name)}")
