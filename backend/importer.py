"""Schema validation, DB writes, and startup sync from data/."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from pathlib import Path

from . import config
from .db import get_db
from .pii import compute_pii, load_patterns


def validate_export_schema(data: dict) -> str | None:
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


def flatten_children(children: list[dict]) -> list[dict]:
    """Return a flat list of all nodes (depth-first)."""
    result: list[dict] = []
    for child in children:
        result.append(child)
        if child.get("children"):
            result.extend(flatten_children(child["children"]))
    return result


def store_export(
    conn: sqlite3.Connection,
    filename: str,
    data: dict,
    overwrite: bool,
    *,
    source_sha256: str = "",
    source_mtime: float = 0.0,
) -> dict:
    """Insert or replace an export in the database. Returns summary dict."""
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    raw_json = json.dumps(data, indent=2)

    all_nodes = flatten_children(data.get("children", []))
    files = [n for n in all_nodes if not n.get("is_dir")]
    dirs = [n for n in all_nodes if n.get("is_dir")]
    total_size = sum(int(n.get("size", 0)) for n in files)

    patterns = load_patterns(conn)
    signals, pii_score, pii_band = compute_pii(all_nodes, patterns)

    existing = conn.execute(
        "SELECT id FROM exports WHERE filename = ?", (filename,)
    ).fetchone()

    if existing and overwrite:
        export_id = existing["id"]
        conn.execute("DELETE FROM nodes WHERE export_id = ?", (export_id,))
        conn.execute("DELETE FROM pii_signals WHERE export_id = ?", (export_id,))
        conn.execute(
            """UPDATE exports SET company=?, folder=?, description=?, updated_at=?,
                   file_count=?, dir_count=?, total_size=?, pii_score=?, pii_band=?,
                   raw_json=?, source_sha256=?, source_mtime=?
               WHERE id=?""",
            (
                data.get("company", ""), data.get("folder", ""), data.get("description", ""),
                now, len(files), len(dirs), total_size, pii_score, pii_band, raw_json,
                source_sha256, source_mtime, export_id,
            ),
        )
        overwritten = True
    elif existing and not overwrite:
        return {"conflict": True, "name": filename}
    else:
        cur = conn.execute(
            """INSERT INTO exports (filename, company, folder, description, imported_at,
                   updated_at, file_count, dir_count, total_size, pii_score, pii_band,
                   raw_json, source_sha256, source_mtime)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                filename, data.get("company", ""), data.get("folder", ""),
                data.get("description", ""), now, now, len(files), len(dirs),
                total_size, pii_score, pii_band, raw_json, source_sha256, source_mtime,
            ),
        )
        export_id = cur.lastrowid
        overwritten = False

    # Insert nodes (recursive; batching per subtree keeps the code simple).
    def _insert_nodes(children, parent_id=None, depth=0):
        for child in children:
            cur = conn.execute(
                """INSERT INTO nodes (export_id, name, path, is_dir, size, parent_id, depth)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    export_id, child.get("name", ""), child.get("path", ""),
                    1 if child.get("is_dir") else 0, int(child.get("size", 0)),
                    parent_id, depth,
                ),
            )
            node_id = cur.lastrowid
            if child.get("children"):
                _insert_nodes(child["children"], node_id, depth + 1)

    _insert_nodes(data.get("children", []))

    if signals:
        conn.executemany(
            """INSERT INTO pii_signals (export_id, pattern_label, category, severity, score, location)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [
                (export_id, s["pattern_label"], s["category"], s["severity"],
                 s["score"], s["location"])
                for s in signals
            ],
        )

    conn.commit()

    return {
        "id": export_id,
        "name": filename,
        "overwritten": overwritten,
    }


def rescan_export(conn: sqlite3.Connection, export_id: int) -> dict | None:
    """Recompute PII for an existing export using the current pattern set."""
    row = conn.execute(
        "SELECT raw_json FROM exports WHERE id = ?", (export_id,)
    ).fetchone()
    if not row:
        return None
    try:
        data = json.loads(row["raw_json"])
    except (ValueError, TypeError):
        return None

    all_nodes = flatten_children(data.get("children", []))
    patterns = load_patterns(conn)
    signals, pii_score, pii_band = compute_pii(all_nodes, patterns)

    conn.execute("DELETE FROM pii_signals WHERE export_id = ?", (export_id,))
    if signals:
        conn.executemany(
            """INSERT INTO pii_signals
               (export_id, pattern_label, category, severity, score, location)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [
                (export_id, s["pattern_label"], s["category"], s["severity"],
                 s["score"], s["location"])
                for s in signals
            ],
        )
    conn.execute(
        "UPDATE exports SET pii_score = ?, pii_band = ? WHERE id = ?",
        (pii_score, pii_band, export_id),
    )
    conn.commit()
    return {"id": export_id, "pii_score": pii_score, "pii_band": pii_band,
            "signal_count": len(signals)}


def rescan_all(conn: sqlite3.Connection) -> dict:
    ids = [row["id"] for row in conn.execute("SELECT id FROM exports").fetchall()]
    updated = 0
    for eid in ids:
        if rescan_export(conn, eid) is not None:
            updated += 1
    return {"rescanned": updated, "total": len(ids)}


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sync_data_dir_to_db() -> dict:
    """Import JSON files from data/, skipping unchanged ones.

    A file is skipped if its sha256 matches the DB's stored hash *and* its mtime
    matches. If either differs, the file is re-parsed and reimported. Returns a
    summary dict suitable for logging.
    """
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_db()

    skipped = 0
    imported = 0
    failed = 0

    try:
        # Prefetch existing metadata in one query to avoid N+1 lookups at scale.
        existing: dict[str, dict] = {
            row["filename"]: {
                "source_sha256": row["source_sha256"],
                "source_mtime": row["source_mtime"],
            }
            for row in conn.execute(
                "SELECT filename, source_sha256, source_mtime FROM exports"
            ).fetchall()
        }

        for path in sorted(config.DATA_DIR.glob("*.json")):
            try:
                stat = path.stat()
                file_bytes = path.read_bytes()
            except OSError:
                failed += 1
                continue

            sha = _sha256_bytes(file_bytes)
            mtime = stat.st_mtime

            prev = existing.get(path.name)
            if prev and prev["source_sha256"] == sha and prev["source_mtime"] == mtime:
                skipped += 1
                continue

            try:
                data = json.loads(file_bytes.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                failed += 1
                continue
            if validate_export_schema(data) is not None:
                failed += 1
                continue

            store_export(
                conn, path.name, data, overwrite=True,
                source_sha256=sha, source_mtime=mtime,
            )
            imported += 1
    finally:
        conn.close()

    return {"skipped": skipped, "imported": imported, "failed": failed}


def hash_file_path(path: Path) -> str:
    """Compute sha256 of a file (exposed for handlers that persist uploaded JSON)."""
    return _sha256_bytes(path.read_bytes())
