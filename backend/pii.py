"""PII pattern engine.

Patterns live in the ``pii_patterns`` table and can be edited via the Settings
UI. On first boot, the table is seeded from ``BUILTIN_PATTERNS`` below. A small
in-process cache compiles keyword regexes lazily and invalidates itself when a
pattern is created/updated/deleted.
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
import threading


# ---------------------------------------------------------------------------
# Builtin defaults (seeded into DB on first run, also used by "Reset").
# ---------------------------------------------------------------------------

BUILTIN_PATTERNS: list[dict] = [
    # Legal agreements
    {"label": "Contract or agreement", "category": "Legal agreements", "severity": "high", "score": 35,
     "keywords": ["contract", "agreement", "msa", "sow", "statement of work", "order form", "master service"]},
    {"label": "NDA / confidentiality", "category": "Legal agreements", "severity": "high", "score": 42,
     "keywords": ["nda", "non-disclosure", "non disclosure", "confidentiality agreement", "mutual nda"]},
    {"label": "Terms of service / policy", "category": "Legal agreements", "severity": "medium", "score": 18,
     "keywords": ["terms of service", "tos", "privacy policy", "acceptable use", "eula", "license agreement"]},

    # Government ID
    {"label": "Passport or travel identity", "category": "Government ID", "severity": "high", "score": 40,
     "keywords": ["passport", "travel document", "resident permit", "visa", "immigration"]},
    {"label": "Driver license records", "category": "Government ID", "severity": "high", "score": 38,
     "keywords": ["driver license", "drivers license", "driving licence", "dmv", "vehicle registration"]},
    {"label": "National ID / SSN", "category": "Government ID", "severity": "high", "score": 44,
     "keywords": ["ssn", "social security", "national id", "national insurance", "sin number", "tax id", "ein", "tin"]},
    {"label": "Birth certificate", "category": "Government ID", "severity": "high", "score": 40,
     "keywords": ["birth certificate", "birth record", "certificate of birth"]},

    # Personal identifiers
    {"label": "Date of birth records", "category": "Personal identifiers", "severity": "high", "score": 30,
     "keywords": ["date of birth", "dob", "birthdate", "birth date"]},
    {"label": "Biometric data", "category": "Personal identifiers", "severity": "high", "score": 45,
     "keywords": ["biometric", "fingerprint", "retina", "facial recognition", "face scan", "voice print"]},
    {"label": "Photo identification", "category": "Personal identifiers", "severity": "medium", "score": 24,
     "keywords": ["photo id", "headshot", "id photo", "badge photo", "mugshot"]},

    # Contact info
    {"label": "Contact / address records", "category": "Contact information", "severity": "medium", "score": 20,
     "keywords": ["address book", "contact list", "phone directory", "mailing list", "emergency contact", "home address"]},
    {"label": "Email lists", "category": "Contact information", "severity": "medium", "score": 18,
     "keywords": ["email list", "email directory", "distribution list", "mailing list", "subscriber"]},

    # Tax & payroll
    {"label": "Tax forms and identifiers", "category": "Tax & payroll", "severity": "high", "score": 36,
     "keywords": ["w-2", "w2", "w-9", "w9", "1099", "tax return", "irs", "tax form"]},
    {"label": "Payroll / compensation records", "category": "Tax & payroll", "severity": "medium", "score": 24,
     "keywords": ["payroll", "salary", "bonus", "compensation", "payslip", "direct deposit", "wage", "overtime"]},

    # Financial accounts
    {"label": "Banking / payment instructions", "category": "Financial accounts", "severity": "high", "score": 34,
     "keywords": ["bank account", "routing number", "iban", "swift", "wire transfer", "payment instruction", "ach"]},
    {"label": "Credit card data", "category": "Financial accounts", "severity": "high", "score": 42,
     "keywords": ["credit card", "card number", "cvv", "cardholder", "pci", "debit card"]},
    {"label": "Invoice / billing records", "category": "Financial accounts", "severity": "medium", "score": 16,
     "keywords": ["invoice", "billing", "purchase order", "receipt", "accounts payable", "accounts receivable"]},
    {"label": "Expense / reimbursement", "category": "Financial accounts", "severity": "low", "score": 12,
     "keywords": ["expense report", "reimbursement", "travel expense", "per diem"]},
    {"label": "Equity / stock grants", "category": "Financial accounts", "severity": "medium", "score": 22,
     "keywords": ["stock grant", "equity", "rsu", "stock option", "vesting", "espp", "cap table"]},

    # Health data
    {"label": "Medical / health records", "category": "Health data", "severity": "high", "score": 32,
     "keywords": ["medical", "health record", "patient", "diagnosis", "prescription", "phi", "hipaa"]},
    {"label": "Insurance claims", "category": "Health data", "severity": "high", "score": 28,
     "keywords": ["insurance claim", "health insurance", "dental", "vision", "benefits enrollment", "cobra"]},

    # Employment / HR
    {"label": "Performance reviews", "category": "Employment records", "severity": "medium", "score": 20,
     "keywords": ["performance review", "annual review", "evaluation", "appraisal", "feedback", "pip", "performance improvement"]},
    {"label": "Termination / disciplinary", "category": "Employment records", "severity": "high", "score": 30,
     "keywords": ["termination", "disciplinary", "separation agreement", "severance", "exit interview", "dismissal"]},
    {"label": "Offer letters / employment", "category": "Employment records", "severity": "medium", "score": 22,
     "keywords": ["offer letter", "employment agreement", "hire letter", "onboarding", "i-9", "work authorization", "e-verify"]},
    {"label": "Background checks", "category": "Sensitive personnel", "severity": "medium", "score": 26,
     "keywords": ["background check", "criminal record", "fingerprint", "screening", "drug test", "reference check"]},

    # Education
    {"label": "Education / student records", "category": "Education records", "severity": "medium", "score": 20,
     "keywords": ["transcript", "student record", "ferpa", "diploma", "enrollment", "academic record", "gpa"]},

    # IT / Security
    {"label": "Credentials / secret tokens", "category": "Credentials & secrets", "severity": "high", "score": 36,
     "keywords": ["api key", "api_key", "secret", "token", "passwd", "password", "private key", "ssh key", "credential"]},
    {"label": "Certificates / keystores", "category": "Credentials & secrets", "severity": "medium", "score": 24,
     "keywords": ["certificate", "keystore", "truststore", "pem", "pfx", "p12", "ssl cert"]},
    {"label": "Audit / access logs", "category": "IT security", "severity": "medium", "score": 18,
     "keywords": ["audit log", "access log", "auth log", "login history", "access control", "acl", "permission"]},
]


# File extensions relevant for PII scanning (business/document files).
# Source code, config, and dev artifacts are excluded.
PII_RELEVANT_EXTENSIONS = {
    # Documents
    "pdf", "doc", "docx", "txt", "rtf", "odt", "pages", "wpd",
    # Presentations
    "ppt", "pptx", "odp", "key",
    # Spreadsheets
    "xls", "xlsx", "csv", "ods", "numbers", "tsv",
    # Images
    "jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "svg", "webp", "heic", "raw", "ico",
    # Archives
    "zip", "rar", "7z", "tar", "gz", "bz2",
    # Email
    "eml", "msg", "pst", "mbox", "ost",
    # Database files
    "mdb", "accdb", "sql", "db", "sqlite", "dbf",
    # Media
    "mp3", "mp4", "avi", "mov", "wav", "wmv", "flv", "mkv", "m4a", "aac",
}


ALLOWED_SEVERITIES = ("high", "medium", "low")


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------

def seed_builtin_patterns(conn: sqlite3.Connection) -> None:
    """Insert builtin patterns if the table is empty. Idempotent."""
    count = conn.execute("SELECT COUNT(*) FROM pii_patterns").fetchone()[0]
    if count > 0:
        return
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    conn.executemany(
        """INSERT INTO pii_patterns
           (label, category, severity, score, keywords, enabled, is_builtin, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 1, ?)""",
        [
            (
                p["label"], p["category"], p["severity"], p["score"],
                json.dumps(p["keywords"]), now,
            )
            for p in BUILTIN_PATTERNS
        ],
    )
    conn.commit()


def reset_to_builtins(conn: sqlite3.Connection) -> None:
    """Wipe pii_patterns and reseed from BUILTIN_PATTERNS."""
    conn.execute("DELETE FROM pii_patterns")
    conn.commit()
    seed_builtin_patterns(conn)
    invalidate_cache()


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

_cache_lock = threading.Lock()
_cached_patterns: list[dict] | None = None


def invalidate_cache() -> None:
    global _cached_patterns
    with _cache_lock:
        _cached_patterns = None


def load_patterns(conn: sqlite3.Connection) -> list[dict]:
    """Load enabled patterns with compiled regexes. Cached in-process."""
    global _cached_patterns
    with _cache_lock:
        if _cached_patterns is not None:
            return _cached_patterns

        rows = conn.execute(
            """SELECT id, label, category, severity, score, keywords, enabled, is_builtin
               FROM pii_patterns WHERE enabled = 1"""
        ).fetchall()

        compiled: list[dict] = []
        for r in rows:
            try:
                keywords = json.loads(r["keywords"])
                if not isinstance(keywords, list):
                    keywords = []
            except (ValueError, TypeError):
                keywords = []
            compiled.append({
                "id": r["id"],
                "label": r["label"],
                "category": r["category"],
                "severity": r["severity"],
                "score": int(r["score"]),
                "keywords": keywords,
                "is_builtin": bool(r["is_builtin"]),
                "_re": [
                    re.compile(r"\b" + re.escape(kw) + r"\b", re.IGNORECASE)
                    for kw in keywords if isinstance(kw, str) and kw
                ],
            })
        _cached_patterns = compiled
        return compiled


def list_patterns(conn: sqlite3.Connection) -> list[dict]:
    """Return all patterns (enabled + disabled) for the Settings UI."""
    rows = conn.execute(
        """SELECT id, label, category, severity, score, keywords, enabled, is_builtin,
                  updated_at
           FROM pii_patterns
           ORDER BY category ASC, label ASC"""
    ).fetchall()
    out = []
    for r in rows:
        try:
            keywords = json.loads(r["keywords"])
        except (ValueError, TypeError):
            keywords = []
        out.append({
            "id": r["id"],
            "label": r["label"],
            "category": r["category"],
            "severity": r["severity"],
            "score": int(r["score"]),
            "keywords": keywords,
            "enabled": bool(r["enabled"]),
            "is_builtin": bool(r["is_builtin"]),
            "updated_at": r["updated_at"],
        })
    return out


def validate_pattern_input(data: dict) -> tuple[dict | None, str | None]:
    """Normalize and validate a pattern dict from the API."""
    label = str(data.get("label", "")).strip()
    category = str(data.get("category", "")).strip()
    severity = str(data.get("severity", "")).strip().lower()
    try:
        score = int(data.get("score", 0))
    except (TypeError, ValueError):
        return None, "score must be an integer"
    keywords = data.get("keywords", [])

    if not label:
        return None, "label is required"
    if not category:
        return None, "category is required"
    if severity not in ALLOWED_SEVERITIES:
        return None, f"severity must be one of {ALLOWED_SEVERITIES}"
    if score < 0 or score > 100:
        return None, "score must be between 0 and 100"
    if not isinstance(keywords, list):
        return None, "keywords must be an array of strings"
    clean_kw: list[str] = []
    for kw in keywords:
        if not isinstance(kw, str):
            return None, "keywords must be strings"
        s = kw.strip()
        if s:
            clean_kw.append(s)
    if not clean_kw:
        return None, "at least one keyword is required"

    return {
        "label": label,
        "category": category,
        "severity": severity,
        "score": score,
        "keywords": clean_kw,
    }, None


def create_pattern(conn: sqlite3.Connection, data: dict) -> int:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cur = conn.execute(
        """INSERT INTO pii_patterns
           (label, category, severity, score, keywords, enabled, is_builtin, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 0, ?)""",
        (data["label"], data["category"], data["severity"], data["score"],
         json.dumps(data["keywords"]), now),
    )
    conn.commit()
    invalidate_cache()
    return int(cur.lastrowid)


def update_pattern(conn: sqlite3.Connection, pattern_id: int, data: dict,
                   enabled: bool | None = None) -> bool:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    existing = conn.execute(
        "SELECT id FROM pii_patterns WHERE id = ?", (pattern_id,)
    ).fetchone()
    if not existing:
        return False
    if enabled is None:
        conn.execute(
            """UPDATE pii_patterns
               SET label=?, category=?, severity=?, score=?, keywords=?, updated_at=?
               WHERE id=?""",
            (data["label"], data["category"], data["severity"], data["score"],
             json.dumps(data["keywords"]), now, pattern_id),
        )
    else:
        conn.execute(
            """UPDATE pii_patterns
               SET label=?, category=?, severity=?, score=?, keywords=?, enabled=?,
                   updated_at=?
               WHERE id=?""",
            (data["label"], data["category"], data["severity"], data["score"],
             json.dumps(data["keywords"]), 1 if enabled else 0, now, pattern_id),
        )
    conn.commit()
    invalidate_cache()
    return True


def set_enabled(conn: sqlite3.Connection, pattern_id: int, enabled: bool) -> bool:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cur = conn.execute(
        "UPDATE pii_patterns SET enabled=?, updated_at=? WHERE id=?",
        (1 if enabled else 0, now, pattern_id),
    )
    conn.commit()
    invalidate_cache()
    return cur.rowcount > 0


def delete_pattern(conn: sqlite3.Connection, pattern_id: int) -> bool:
    cur = conn.execute("DELETE FROM pii_patterns WHERE id = ?", (pattern_id,))
    conn.commit()
    invalidate_cache()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def is_pii_relevant(node: dict) -> bool:
    """Return True if a node should be considered for PII scanning."""
    if node.get("is_dir"):
        return True  # Always scan directory names
    name = node.get("name", "")
    idx = name.rfind(".")
    if idx <= 0:
        return True  # No extension — could be anything
    ext = name[idx + 1:].lower()
    return ext in PII_RELEVANT_EXTENSIONS


def _text_matches_pattern(text: str, pattern: dict) -> bool:
    for regex in pattern["_re"]:
        if regex.search(text):
            return True
    return False


def compute_pii(nodes_flat: list[dict],
                patterns: list[dict]) -> tuple[list[dict], int, str]:
    """Run PII detection. Returns (signals, normalized_score, band)."""
    relevant_nodes = [n for n in nodes_flat if is_pii_relevant(n)]
    signals: list[dict] = []
    for node in relevant_nodes:
        text = f"{node.get('name', '')} {node.get('path', '')}"
        for pat in patterns:
            if _text_matches_pattern(text, pat):
                signals.append({
                    "pattern_label": pat["label"],
                    "category": pat["category"],
                    "severity": pat["severity"],
                    "score": pat["score"],
                    "location": node.get("path") or node.get("name") or "(unknown)",
                })

    total_raw = sum(s["score"] for s in signals)
    categories = set(s["category"] for s in signals)
    total_nodes = max(len(relevant_nodes), 1)

    # Density bonus: many PII hits in small tree = much higher risk
    density = len(signals) / total_nodes
    density_bonus = min(20, round(density * 40))

    normalized = min(100, round(
        (total_raw / total_nodes) * 8
        + len(categories) * 4
        + density_bonus
    ))

    if normalized >= 70:
        band = "High"
    elif normalized >= 35:
        band = "Medium"
    else:
        band = "Low"

    return signals, normalized, band
