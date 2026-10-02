import os

os.makedirs("data/samples", exist_ok=True)

samples = [
    (
        "2017_Client_Tax_Records_Legacy.csv",
        "Name,SSN,DOB,Account_Number\n"
        "John Doe,123-45-6789,1980-01-15,LPL-908123\n"
        "Jane Smith,987-65-4321,1975-06-22,LPL-443211\n"
        "Alice Brown,555-01-9988,1992-11-04,LPL-112233\n"
        "Robert White,444-22-1133,1964-03-30,LPL-998877\n"
    ),
    (
        "2024_Trade_Confirm_AAPL.txt",
        "LPL FINANCIAL TRADE CONFIRMATION\n"
        "Account: LPL-882190\n"
        "Date: 2024-04-12\n"
        "Action: BOUGHT 150 AAPL @ $172.50\n"
        "Client: Marcus Vance\n"
        "Status: EXECUTED\n"
    ),
    (
        "2020_Client_Communication_Smith.txt",
        "CONFIDENTIAL EMAIL ARCHIVE\n"
        "Date: 2020-08-14\n"
        "Client: Arthur Smith\n"
        "Subject: Dispute regarding options allocation\n"
        "Message: Arthur Smith disputed execution pricing on August transactions.\n"
    ),
    (
        "Q3_Financial_Plan_Proposal_v1_draft.txt",
        "DRAFT PROPOSAL - NOT FOR CLIENT DISTRIBUTION\n"
        "Prepared by: Advisor Associate\n"
        "Date: 2023-09-01\n"
        "Notes: Preliminary portfolio allocations before supervisor review.\n"
    ),
    (
        "Office_Potluck_Recipes_2022.txt",
        "Branch #402 Holiday Party Recipe List:\n"
        "- Grandma's Apple Pie\n"
        "- Smoked Brisket Rub\n"
    ),
]

for filename, content in samples:
    path = os.path.join("data/samples", filename)
    with open(path, "w") as f:
        f.write(content)
    print(f"Created: {path}")

print("\nSample dataset ready in data/samples/!")
