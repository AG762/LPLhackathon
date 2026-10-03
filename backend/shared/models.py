from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional

class Decision(str, Enum):
    HOLD = "hold"
    RETAIN = "retain"
    ARCHIVE = "archive"
    DELETE = "delete"
    REVIEW = "review"

class FileType(str, Enum):
    DOCUMENT = "document"
    SPREADSHEET = "spreadsheet"
    PDF = "pdf"
    IMAGE = "image"
    OTHER = "other"

@dataclass
class File:
    file_id: str
    name: str
    owner: str
    created_at: str
    modified_at:str
    file_type: FileType
    size_bytes: int = 0
    content: str= ""
    sensitivety_score: float=0.0

@dataclass
class RetentionRule:
    rule_id: str
    name: str
    retention_days: int
    applies_to: list[str] = field(default_factory=list)

@dataclass
class LegalHold:
    hold_id: str
    name: str
    active: bool
    keywords: list[str] = field(default_factory=list)
    file_ids: list[str] = field(default_factory=list)

@dataclass
class AuditEntry:
    entry_id: str
    file_id: str
    action: str
    reason: str
    timestamp: str
    user: str
    previous_hash: Optional[str] = None
    entry_hash: Optional[str] = None
    
