"""SQLite connection, schema, and tiny additive migration runner."""
from __future__ import annotations

import sqlite3

from . import config


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(config.DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA cache_size=-8000")       # 8 MB page cache
    conn.execute("PRAGMA mmap_size=67108864")      # 64 MB memory-mapped I/O
    conn.execute("PRAGMA temp_store=MEMORY")       # temp tables in RAM
    conn.execute("PRAGMA synchronous=NORMAL")      # faster writes (safe with WAL)
    return conn


# Base schema (idempotent via IF NOT EXISTS).
BASE_SCHEMA = """
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
CREATE INDEX IF NOT EXISTS idx_nodes_export_isdir ON nodes(export_id, is_dir);
CREATE INDEX IF NOT EXISTS idx_pii_export ON pii_signals(export_id);
CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);

CREATE TABLE IF NOT EXISTS schema_migrations (
    id         INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
"""


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == column for r in rows)


def _applied(conn: sqlite3.Connection, mig_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?", (mig_id,)
    ).fetchone()
    return row is not None


def _mark_applied(conn: sqlite3.Connection, mig_id: int) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (id, applied_at) "
        "VALUES (?, datetime('now'))",
        (mig_id,),
    )


def _migrate(conn: sqlite3.Connection) -> None:
    """Apply additive migrations. Each migration is id-tracked and idempotent."""

    # 001: add source_sha256 + source_mtime columns for startup-skip logic.
    if not _applied(conn, 1):
        if not _column_exists(conn, "exports", "source_sha256"):
            conn.execute(
                "ALTER TABLE exports ADD COLUMN source_sha256 TEXT NOT NULL DEFAULT ''"
            )
        if not _column_exists(conn, "exports", "source_mtime"):
            conn.execute(
                "ALTER TABLE exports ADD COLUMN source_mtime REAL NOT NULL DEFAULT 0"
            )
        _mark_applied(conn, 1)

    # 002: pii_patterns table for editable pattern CRUD.
    if not _applied(conn, 2):
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS pii_patterns (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                label      TEXT NOT NULL,
                category   TEXT NOT NULL,
                severity   TEXT NOT NULL,
                score      INTEGER NOT NULL DEFAULT 0,
                keywords   TEXT NOT NULL,
                enabled    INTEGER NOT NULL DEFAULT 1,
                is_builtin INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pii_patterns_enabled
                ON pii_patterns(enabled);
            """
        )
        _mark_applied(conn, 2)

    # 003: soft delete for exports — adds deleted_at timestamp + index.
    if not _applied(conn, 3):
        if not _column_exists(conn, "exports", "deleted_at"):
            conn.execute(
                "ALTER TABLE exports ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''"
            )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_exports_deleted_at ON exports(deleted_at)"
        )
        _mark_applied(conn, 3)

    conn.commit()


def init_db() -> None:
    config.DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_db()
    try:
        conn.executescript(BASE_SCHEMA)
        conn.commit()
        _migrate(conn)
    finally:
        conn.close()
