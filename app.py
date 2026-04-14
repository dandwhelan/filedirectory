#!/usr/bin/env python3
from __future__ import annotations

import json
import sqlite3
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).parent.resolve()
DATA_DIR = BASE_DIR / "data"
DB_DIR = BASE_DIR / "db"
WEB_DIR = BASE_DIR / "web"
HOST = "127.0.0.1"
PORT = 8000
MAX_IMPORT_BYTES = 10 * 1024 * 1024
DB_PATH = DB_DIR / "exports.db"

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS exports (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            filename    TEXT    NOT NULL UNIQUE,
            company     TEXT    NOT NULL DEFAULT '',
            folder      TEXT    NOT NULL DEFAULT '',
            description TEXT    NOT NULL DEFAULT '',
            imported_at TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL,
            file_count  INTEGER NOT NULL DEFAULT 0,
            dir_count   INTEGER NOT NULL DEFAULT 0,
            total_size  INTEGER NOT NULL DEFAULT 0,
            pii_score   INTEGER NOT NULL DEFAULT 0,
            pii_band    TEXT    NOT NULL DEFAULT 'Low',
            raw_json    TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS nodes (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            export_id INTEGER NOT NULL REFERENCES exports(id) ON DELETE CASCADE,
            name      TEXT    NOT NULL DEFAULT '',
            path      TEXT    NOT NULL DEFAULT '',
            is_dir    INTEGER NOT NULL DEFAULT 0,
            size      INTEGER NOT NULL DEFAULT 0,
            parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
            depth     INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS pii_signals (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            export_id     INTEGER NOT NULL REFERENCES exports(id) ON DELETE CASCADE,
            node_id       INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
            pattern_label TEXT NOT NULL,
            category      TEXT NOT NULL,
            severity      TEXT NOT NULL,
            score         INTEGER NOT NULL DEFAULT 0,
            location      TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_nodes_export ON nodes(export_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_export_parent ON nodes(export_id, parent_id);
        CREATE INDEX IF NOT EXISTS idx_pii_export ON pii_signals(export_id);
        CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);
    """)
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# PII detection patterns (expanded)
# ---------------------------------------------------------------------------

PII_PATTERNS: list[dict] = [
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


# ---------------------------------------------------------------------------
# Common file extensions for PII scanning (business / document files).
# Source code, config, and dev artifacts are excluded.
# ---------------------------------------------------------------------------

PII_RELEVANT_EXTENSIONS = {
    # Documents
    "pdf", "doc", "docx", "txt", "rtf", "odt", "pages", "wpd",
    # Presentations
    "ppt", "pptx", "odp", "key",
    # Spreadsheets
    "xls", "xlsx", "csv", "ods", "numbers", "tsv",
    # Images
    "jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "svg", "webp", "heic", "raw", "ico",
    # Archives (may contain sensitive docs)
    "zip", "rar", "7z", "tar", "gz", "bz2",
    # Email
    "eml", "msg", "pst", "mbox", "ost",
    # Database files
    "mdb", "accdb", "sql", "db", "sqlite", "dbf",
    # Media
    "mp3", "mp4", "avi", "mov", "wav", "wmv", "flv", "mkv", "m4a", "aac",
}


def _is_pii_relevant(node: dict) -> bool:
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
    text_lower = text.lower()
    for kw in pattern["keywords"]:
        if kw in text_lower:
            return True
    return False


def _flatten_nodes(children: list[dict], depth: int = 0, parent_id: int | None = None):
    """Yield (node_dict, depth, parent_id) tuples for a nested tree."""
    for child in children:
        yield child, depth, parent_id
        if child.get("children"):
            yield from _flatten_nodes(child["children"], depth + 1, None)


def _compute_pii(nodes_flat: list[dict]) -> tuple[list[dict], int, str]:
    """Run PII detection, return (signals_list, normalized_score, band).

    Only scans directories and common file types (documents, images,
    spreadsheets, etc.).  Source code and dev config files are skipped.
    """
    relevant_nodes = [n for n in nodes_flat if _is_pii_relevant(n)]
    signals: list[dict] = []
    for node in relevant_nodes:
        text = f"{node.get('name', '')} {node.get('path', '')}"
        for pat in PII_PATTERNS:
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


def _validate_export_schema(data: dict) -> str | None:
    """Return an error message if the JSON doesn't match expected schema, else None."""
    if not isinstance(data, dict):
        return "Expected a JSON object at the top level"
    if "children" not in data:
        return "Missing required 'children' array"
    if not isinstance(data["children"], list):
        return "'children' must be an array"

    def _check_node(node, path="root"):
        if not isinstance(node, dict):
            return f"Node at {path} is not an object"
        if "name" not in node:
            return f"Node at {path} missing 'name' field"
        if "children" in node and not isinstance(node.get("children"), list):
            return f"Node at {path} 'children' must be an array"
        for i, child in enumerate(node.get("children", [])):
            err = _check_node(child, f"{path}.children[{i}]")
            if err:
                return err
        return None

    for i, child in enumerate(data["children"]):
        err = _check_node(child, f"children[{i}]")
        if err:
            return err
    return None


def _flatten_children(children: list[dict]) -> list[dict]:
    """Return a flat list of all nodes."""
    result: list[dict] = []
    for child in children:
        result.append(child)
        if child.get("children"):
            result.extend(_flatten_children(child["children"]))
    return result


def _store_export(conn: sqlite3.Connection, filename: str, data: dict, overwrite: bool) -> dict:
    """Insert or replace an export in the database. Returns summary dict."""
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    raw_json = json.dumps(data, indent=2)

    all_nodes = _flatten_children(data.get("children", []))
    files = [n for n in all_nodes if not n.get("is_dir")]
    dirs = [n for n in all_nodes if n.get("is_dir")]
    total_size = sum(int(n.get("size", 0)) for n in files)

    signals, pii_score, pii_band = _compute_pii(all_nodes)

    existing = conn.execute("SELECT id, imported_at FROM exports WHERE filename = ?", (filename,)).fetchone()

    if existing and overwrite:
        export_id = existing["id"]
        conn.execute("DELETE FROM nodes WHERE export_id = ?", (export_id,))
        conn.execute("DELETE FROM pii_signals WHERE export_id = ?", (export_id,))
        conn.execute("""
            UPDATE exports SET company=?, folder=?, description=?, updated_at=?,
                file_count=?, dir_count=?, total_size=?, pii_score=?, pii_band=?, raw_json=?
            WHERE id=?
        """, (
            data.get("company", ""), data.get("folder", ""), data.get("description", ""),
            now, len(files), len(dirs), total_size, pii_score, pii_band, raw_json, export_id
        ))
        overwritten = True
    elif existing and not overwrite:
        return {"conflict": True, "name": filename}
    else:
        cur = conn.execute("""
            INSERT INTO exports (filename, company, folder, description, imported_at, updated_at,
                file_count, dir_count, total_size, pii_score, pii_band, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            filename, data.get("company", ""), data.get("folder", ""), data.get("description", ""),
            now, now, len(files), len(dirs), total_size, pii_score, pii_band, raw_json
        ))
        export_id = cur.lastrowid
        overwritten = False

    # Store nodes
    def _insert_nodes(children, parent_id=None, depth=0):
        for child in children:
            cur = conn.execute("""
                INSERT INTO nodes (export_id, name, path, is_dir, size, parent_id, depth)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                export_id, child.get("name", ""), child.get("path", ""),
                1 if child.get("is_dir") else 0, int(child.get("size", 0)),
                parent_id, depth
            ))
            node_id = cur.lastrowid
            if child.get("children"):
                _insert_nodes(child["children"], node_id, depth + 1)

    _insert_nodes(data.get("children", []))

    # Store PII signals
    for sig in signals:
        conn.execute("""
            INSERT INTO pii_signals (export_id, pattern_label, category, severity, score, location)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (export_id, sig["pattern_label"], sig["category"], sig["severity"], sig["score"], sig["location"]))

    conn.commit()

    return {
        "id": export_id,
        "name": filename,
        "overwritten": overwritten,
    }


def sync_data_dir_to_db():
    """Import all JSON files from data/ into the database on startup."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_db()

    for path in sorted(DATA_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if _validate_export_schema(data) is not None:
            continue
        _store_export(conn, path.name, data, overwrite=True)

    conn.close()


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class FileBrowserHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, format, *args):
        pass  # suppress request logging noise

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/api/exports":
            self._handle_exports_list(params)
            return
        if parsed.path.startswith("/api/export/"):
            parts = parsed.path.split("/")
            if len(parts) >= 4:
                try:
                    export_id = int(parts[3])
                except ValueError:
                    self._error_response(HTTPStatus.BAD_REQUEST, "Invalid export ID")
                    return
                # /api/export/<id>/children — lazy tree loading
                if len(parts) >= 5 and parts[4] == "children":
                    self._handle_export_children(export_id, params)
                    return
                self._handle_export_detail(export_id)
                return
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid export ID")
            return
        if parsed.path == "/api/export":
            filename = params.get("file", [""])[0]
            self._handle_export_file(filename)
            return
        if parsed.path == "/api/pii-patterns":
            self._json_response({"patterns": PII_PATTERNS})
            return

        # SPA fallback: serve index.html for any non-file, non-api path
        if not parsed.path.startswith("/api/") and "." not in parsed.path.split("/")[-1]:
            self.path = "/index.html"

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/import":
            self._handle_import_json()
            return

        self._error_response(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def do_DELETE(self):
        parsed = urlparse(self.path)

        if parsed.path.startswith("/api/export/"):
            parts = parsed.path.split("/")
            if len(parts) >= 4:
                try:
                    export_id = int(parts[3])
                    self._handle_delete_export(export_id)
                    return
                except ValueError:
                    pass
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid export ID")
            return

        self._error_response(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    # -- List exports (paginated, searchable, sortable) --

    def _handle_exports_list(self, params: dict):
        page = max(1, int(params.get("page", ["1"])[0]))
        per_page = min(100, max(1, int(params.get("per_page", ["20"])[0])))
        search = params.get("search", [""])[0].strip()
        sort = params.get("sort", ["updated_at"])[0]
        order = params.get("order", ["desc"])[0].upper()

        allowed_sort = {"updated_at", "filename", "pii_score", "total_size", "imported_at"}
        if sort not in allowed_sort:
            sort = "updated_at"
        if order not in ("ASC", "DESC"):
            order = "DESC"

        conn = get_db()

        where_clause = ""
        where_params: list = []
        if search:
            where_clause = "WHERE filename LIKE ? OR company LIKE ? OR description LIKE ? OR folder LIKE ?"
            like = f"%{search}%"
            where_params = [like, like, like, like]

        # Total count
        total = conn.execute(
            f"SELECT COUNT(*) FROM exports {where_clause}", where_params
        ).fetchone()[0]

        # Paginated results
        offset = (page - 1) * per_page
        rows = conn.execute(f"""
            SELECT id, filename, company, folder, description, imported_at, updated_at,
                   file_count, dir_count, total_size, pii_score, pii_band
            FROM exports {where_clause}
            ORDER BY {sort} {order}
            LIMIT ? OFFSET ?
        """, where_params + [per_page, offset]).fetchall()
        conn.close()

        total_pages = max(1, (total + per_page - 1) // per_page)
        self._json_response({
            "exports": [dict(row) for row in rows],
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages,
        })

    # -- Get single export detail (without full tree) --

    def _handle_export_detail(self, export_id: int):
        conn = get_db()
        row = conn.execute("""
            SELECT id, filename, company, folder, description, imported_at, updated_at,
                   file_count, dir_count, total_size, pii_score, pii_band
            FROM exports WHERE id = ?
        """, (export_id,)).fetchone()
        if not row:
            conn.close()
            self._error_response(HTTPStatus.NOT_FOUND, "Export not found")
            return

        export_data = dict(row)

        # PII signals
        pii_rows = conn.execute("""
            SELECT pattern_label, category, severity, score, location
            FROM pii_signals WHERE export_id = ? ORDER BY score DESC
        """, (export_id,)).fetchall()
        export_data["pii_signals"] = [dict(r) for r in pii_rows]

        # File type distribution (computed from nodes table)
        file_rows = conn.execute(
            "SELECT name, size FROM nodes WHERE export_id = ? AND is_dir = 0",
            (export_id,)
        ).fetchall()
        ext_counts: dict[str, int] = {}
        ext_sizes: dict[str, int] = {}
        for r in file_rows:
            name = r["name"]
            idx = name.rfind(".")
            ext = name[idx + 1:].lower() if idx > 0 else "other"
            ext_counts[ext] = ext_counts.get(ext, 0) + 1
            ext_sizes[ext] = ext_sizes.get(ext, 0) + r["size"]

        top_exts = sorted(ext_counts.items(), key=lambda x: x[1], reverse=True)[:8]
        export_data["file_type_counts"] = [
            {"name": f".{ext}", "value": cnt} for ext, cnt in top_exts
        ]

        # File size by extension (top 10)
        top_size_exts = sorted(ext_sizes.items(), key=lambda x: x[1], reverse=True)[:10]
        export_data["file_size_by_type"] = [
            {"name": f".{ext}", "value": sz} for ext, sz in top_size_exts
        ]

        # Top 10 largest individual files
        largest_rows = conn.execute(
            "SELECT name, path, size FROM nodes WHERE export_id = ? AND is_dir = 0 ORDER BY size DESC LIMIT 10",
            (export_id,)
        ).fetchall()
        export_data["top_largest_files"] = [
            {"name": r["name"], "path": r["path"], "size": r["size"]} for r in largest_rows
        ]

        # Depth distribution
        depth_rows = conn.execute(
            "SELECT depth, COUNT(*) as count FROM nodes WHERE export_id = ? GROUP BY depth ORDER BY depth",
            (export_id,)
        ).fetchall()
        export_data["depth_distribution"] = [
            {"depth": r["depth"], "count": r["count"]} for r in depth_rows
        ]

        conn.close()
        self._json_response(export_data)

    # -- Lazy tree: get children of a node --

    def _handle_export_children(self, export_id: int, params: dict):
        parent_id_str = params.get("parent_id", [""])[0]
        limit = min(500, max(1, int(params.get("limit", ["100"])[0])))
        offset = max(0, int(params.get("offset", ["0"])[0]))

        conn = get_db()

        # Verify export exists
        if not conn.execute("SELECT 1 FROM exports WHERE id = ?", (export_id,)).fetchone():
            conn.close()
            self._error_response(HTTPStatus.NOT_FOUND, "Export not found")
            return

        if parent_id_str:
            try:
                parent_id = int(parent_id_str)
            except ValueError:
                conn.close()
                self._error_response(HTTPStatus.BAD_REQUEST, "Invalid parent_id")
                return
            total_count = conn.execute(
                "SELECT COUNT(*) FROM nodes WHERE export_id = ? AND parent_id = ?",
                (export_id, parent_id)
            ).fetchone()[0]
            rows = conn.execute("""
                SELECT n.id, n.name, n.path, n.is_dir, n.size,
                       EXISTS(SELECT 1 FROM nodes c WHERE c.parent_id = n.id) AS has_children
                FROM nodes n
                WHERE n.export_id = ? AND n.parent_id = ?
                ORDER BY n.is_dir DESC, n.name ASC
                LIMIT ? OFFSET ?
            """, (export_id, parent_id, limit, offset)).fetchall()
        else:
            total_count = conn.execute(
                "SELECT COUNT(*) FROM nodes WHERE export_id = ? AND parent_id IS NULL",
                (export_id,)
            ).fetchone()[0]
            rows = conn.execute("""
                SELECT n.id, n.name, n.path, n.is_dir, n.size,
                       EXISTS(SELECT 1 FROM nodes c WHERE c.parent_id = n.id) AS has_children
                FROM nodes n
                WHERE n.export_id = ? AND n.parent_id IS NULL
                ORDER BY n.is_dir DESC, n.name ASC
                LIMIT ? OFFSET ?
            """, (export_id, limit, offset)).fetchall()

        conn.close()

        children = [
            {
                "id": r["id"],
                "name": r["name"],
                "path": r["path"],
                "is_dir": bool(r["is_dir"]),
                "size": r["size"],
                "has_children": bool(r["has_children"]),
            }
            for r in rows
        ]
        self._json_response({
            "children": children,
            "total_count": total_count,
            "has_more": offset + limit < total_count,
        })

    # -- Legacy: load by filename --

    def _handle_export_file(self, filename: str):
        target = self._validate_filename_and_get_path(filename)
        if target is None:
            return
        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            self._error_response(HTTPStatus.UNPROCESSABLE_ENTITY, "File is not valid JSON")
            return
        self._json_response(payload)

    # -- Import --

    def _handle_import_json(self):
        content_length_raw = self.headers.get("Content-Length") or "0"
        try:
            content_length = int(content_length_raw)
        except ValueError:
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
            return

        if content_length <= 0:
            self._error_response(HTTPStatus.BAD_REQUEST, "Request body is required")
            return
        if content_length > MAX_IMPORT_BYTES:
            self._error_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "File is too large (max 10MB)")
            return

        try:
            body = self.rfile.read(content_length)
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid JSON request payload")
            return

        filename = payload.get("filename", "")
        file_content = payload.get("content", "")
        overwrite = bool(payload.get("overwrite", False))

        if not isinstance(file_content, str):
            self._error_response(HTTPStatus.BAD_REQUEST, "File content must be a string")
            return

        target = self._validate_filename_and_get_path(filename, must_exist=False)
        if target is None:
            return

        try:
            parsed_file = json.loads(file_content)
        except json.JSONDecodeError:
            self._error_response(HTTPStatus.UNPROCESSABLE_ENTITY, "Uploaded file is not valid JSON")
            return

        # Validate schema
        schema_err = _validate_export_schema(parsed_file)
        if schema_err:
            self._error_response(HTTPStatus.UNPROCESSABLE_ENTITY,
                                 f"JSON does not match expected export schema: {schema_err}")
            return

        # Store in DB
        conn = get_db()
        result = _store_export(conn, filename, parsed_file, overwrite)
        conn.close()

        if result.get("conflict"):
            self._json_response({
                "error": "File already exists. Re-submit with overwrite=true after confirmation.",
                "code": "file_exists",
                "name": result["name"],
            }, status=HTTPStatus.CONFLICT)
            return

        # Also write to data/ dir as backup
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(parsed_file, indent=2), encoding="utf-8")

        self._json_response({
            "message": f"Imported {result['name']}",
            "id": result["id"],
            "name": result["name"],
            "overwritten": result["overwritten"],
        }, HTTPStatus.CREATED)

    # -- Delete --

    def _handle_delete_export(self, export_id: int):
        conn = get_db()
        row = conn.execute("SELECT filename FROM exports WHERE id = ?", (export_id,)).fetchone()
        if not row:
            conn.close()
            self._error_response(HTTPStatus.NOT_FOUND, "Export not found")
            return

        filename = row["filename"]
        conn.execute("DELETE FROM exports WHERE id = ?", (export_id,))
        conn.commit()
        conn.close()

        # Also remove from data/ if present
        data_file = DATA_DIR / filename
        if data_file.exists():
            data_file.unlink()

        self._json_response({"message": f"Deleted {filename}", "name": filename})

    # -- Helpers --

    def _validate_filename_and_get_path(self, filename: str, must_exist: bool = True) -> Path | None:
        if not filename or "/" in filename or "\\" in filename:
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid filename")
            return None

        target = (DATA_DIR / filename).resolve()
        if not str(target).startswith(str(DATA_DIR.resolve())):
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid path")
            return None
        if target.suffix.lower() != ".json":
            self._error_response(HTTPStatus.BAD_REQUEST, "Only .json files are supported")
            return None
        if must_exist and not target.exists():
            self._error_response(HTTPStatus.NOT_FOUND, "Export file not found")
            return None
        return target

    def _json_response(self, payload: dict, status: HTTPStatus = HTTPStatus.OK):
        response = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def _error_response(self, status: HTTPStatus, message: str):
        self._json_response({"error": message}, status=status)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)

    print("Initializing database...")
    init_db()
    sync_data_dir_to_db()

    server = ThreadingHTTPServer((HOST, PORT), FileBrowserHandler)
    print(f"Serving file browser at http://{HOST}:{PORT}")
    print(f"Reading export JSON files from: {DATA_DIR}")
    print(f"Database: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server.server_close()
