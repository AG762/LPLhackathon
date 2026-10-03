from .models import File, LegalHold

def matches_legal_hold(file: File, holds: list[LehalHold]) -> bool:
    for hold  in holds:
        if not hold.active:
            continue

if file.file_id in hold.file_ids:
    return True
searchable_text = (
    f"{file.name}{file.content}"
).lower()
for keyword in hold.keywords:
        if keyword.lower() in searchable_text:
            return True
return False
