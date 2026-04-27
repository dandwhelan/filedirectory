"""HTTP request dispatcher for the JSON Export Browser API."""
from __future__ import annotations

import json
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .config import DATA_DIR, MAX_IMPORT_BYTES, WEB_DIR
from .db import get_db
from .importer import (
    hash_file_path,
    rescan_all,
    rescan_export,
    store_export,
    validate_export_schema,
)
from . import pii as pii_mod


class FileBrowserHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, format, *args):
        # Default http.server logging writes each request to stderr. Kept on
        # so deployments behind a reverse proxy / systemd can capture access
        # logs via journalctl or stdout redirection.
        super().log_message(format, *args)

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/api/overview":
            return self._handle_overview()
        if parsed.path == "/api/exports":
            return self._handle_exports_list(params)
        if parsed.path == "/api/trash":
            return self._handle_trash_list()
        if parsed.path == "/api/search":
            return self._handle_global_search(params)
        if parsed.path == "/api/diff":
            return self._handle_diff(params)
        if parsed.path == "/api/pii-patterns":
            return self._handle_list_patterns()

        if parsed.path.startswith("/api/export/"):
            parts = parsed.path.split("/")
            if len(parts) >= 4:
                try:
                    export_id = int(parts[3])
                except ValueError:
                    return self._error_response(HTTPStatus.BAD_REQUEST, "Invalid export ID")
                if len(parts) >= 5 and parts[4] == "children":
                    return self._handle_export_children(export_id, params)
                if len(parts) >= 5 and parts[4] == "files-by-type":
                    return self._handle_files_by_type(export_id, params)
                if len(parts) >= 5 and parts[4] == "search":
                    return self._handle_search(export_id, params)
                if len(parts) >= 5 and parts[4] == "explain":
                    return self._handle_explain_score(export_id)
                if len(parts) >= 5 and parts[4] == "redact":
                    return self._handle_redaction_export(export_id)
                return self._handle_export_detail(export_id)
            return self._error_response(HTTPStatus.BAD_REQUEST, "Invalid export ID")

        if parsed.path == "/api/export":
            filename = params.get("file", [""])[0]
            return self._handle_export_file(filename)

        # SPA fallback: serve index.html for any non-file, non-api path
        if not parsed.path.startswith("/api/") and "." not in parsed.path.split("/")[-1]:
            self.path = "/index.html"

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/import":
            return self._handle_import_json()
        if parsed.path == "/api/pii-patterns":
            return self._handle_create_pattern()
        if parsed.path == "/api/pii-patterns/reset":
            return self._handle_reset_patterns()
        if parsed.path == "/api/pii-rescan":
            return self._handle_rescan_all()
        if parsed.path.startswith("/api/pii-rescan/"):
            try:
                export_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                return self._error_response(HTTPStatus.BAD_REQUEST, "Invalid export ID")
            return self._handle_rescan_one(export_id)

        if parsed.path.startswith("/api/export/"):
            parts = parsed.path.split("/")
            if len(parts) >= 5:
                try:
                    export_id = int(parts[3])
                except ValueError:
                    return self._error_response(HTTPStatus.BAD_REQUEST, "Invalid export ID")
                if parts[4] == "restore":
                    return self._handle_restore_export(export_id)
                if parts[4] == "purge":
                    return self._handle_purge_export(export_id)

        return self._error_response(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/pii-patterns/"):
            try:
                pattern_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                return self._error_response(HTTPStatus.BAD_REQUEST, "Invalid pattern ID")
            return self._handle_update_pattern(pattern_id)
        return self._error_response(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def do_DELETE(self):
        parsed = urlparse(self.path)

        if parsed.path.startswith("/api/pii-patterns/"):
            try:
                pattern_id = int(parsed.path.rsplit("/", 1)[-1])
            except ValueError:
                return self._error_response(HTTPStatus.BAD_REQUEST, "Invalid pattern ID")
            return self._handle_delete_pattern(pattern_id)

        if parsed.path.startswith("/api/export/"):
            parts = parsed.path.split("/")
            if len(parts) < 4:
                return self._error_response(HTTPStatus.BAD_REQUEST, "Invalid export ID")
            try:
                export_id = int(parts[3])
            except ValueError:
                return self._error_response(HTTPStatus.BAD_REQUEST, "Invalid export ID")
            return self._handle_delete_export(export_id)

        return self._error_response(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    # ------------------------------------------------------------------
    # Exports — list
    # ------------------------------------------------------------------

    def _handle_exports_list(self, params: dict):
        try:
            page = max(1, int(params.get("page", ["1"])[0]))
            per_page = min(100, max(1, int(params.get("per_page", ["20"])[0])))
        except ValueError:
            return self._error_response(HTTPStatus.BAD_REQUEST, "page/per_page must be integers")
        search = params.get("search", [""])[0].strip()
        sort = params.get("sort", ["updated_at"])[0]
        order = params.get("order", ["desc"])[0].upper()

        allowed_sort = {"updated_at", "filename", "pii_score", "total_size", "imported_at"}
        if sort not in allowed_sort:
            sort = "updated_at"
        if order not in ("ASC", "DESC"):
            order = "DESC"

        conn = get_db()

        where_clause = "WHERE deleted_at = ''"
        where_params: list = []
        if search:
            where_clause += (
                " AND (filename LIKE ? OR company LIKE ? OR "
                "description LIKE ? OR folder LIKE ?)"
            )
            like = f"%{search}%"
            where_params = [like, like, like, like]

        total = conn.execute(
            f"SELECT COUNT(*) FROM exports {where_clause}", where_params
        ).fetchone()[0]

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

    # ------------------------------------------------------------------
    # Overview
    # ------------------------------------------------------------------

    def _handle_overview(self):
        conn = get_db()

        row = conn.execute("""
            SELECT COUNT(*) as export_count,
                   COALESCE(SUM(file_count), 0) as total_files,
                   COALESCE(SUM(dir_count), 0) as total_dirs,
                   COALESCE(SUM(total_size), 0) as total_size,
                   COALESCE(ROUND(AVG(pii_score)), 0) as avg_pii_score
            FROM exports WHERE deleted_at = ''
        """).fetchone()

        band_rows = conn.execute(
            "SELECT pii_band, COUNT(*) as count FROM exports "
            "WHERE deleted_at = '' GROUP BY pii_band"
        ).fetchall()

        ext_rows = conn.execute(
            "SELECT n.name FROM nodes n "
            "JOIN exports e ON e.id = n.export_id "
            "WHERE n.is_dir = 0 AND e.deleted_at = ''"
        ).fetchall()
        ext_counts: dict[str, int] = {}
        for r in ext_rows:
            name = r["name"]
            idx = name.rfind(".")
            ext = name[idx + 1:].lower() if idx > 0 else "other"
            ext_counts[ext] = ext_counts.get(ext, 0) + 1
        top_exts = sorted(ext_counts.items(), key=lambda x: x[1], reverse=True)[:10]

        conn.close()

        self._json_response({
            "export_count": row["export_count"],
            "total_files": row["total_files"],
            "total_dirs": row["total_dirs"],
            "total_size": row["total_size"],
            "avg_pii_score": int(row["avg_pii_score"]),
            "pii_band_distribution": {r["pii_band"]: r["count"] for r in band_rows},
            "top_file_types": [{"name": f".{ext}", "value": cnt} for ext, cnt in top_exts],
        })

    # ------------------------------------------------------------------
    # Export detail
    # ------------------------------------------------------------------

    def _handle_export_detail(self, export_id: int):
        conn = get_db()
        row = conn.execute("""
            SELECT id, filename, company, folder, description, imported_at, updated_at,
                   file_count, dir_count, total_size, pii_score, pii_band
            FROM exports WHERE id = ? AND deleted_at = ''
        """, (export_id,)).fetchone()
        if not row:
            conn.close()
            return self._error_response(HTTPStatus.NOT_FOUND, "Export not found")

        export_data = dict(row)

        # Cap signals to avoid unbounded payloads on pathological exports.
        # Total count is exposed separately so the UI can warn the user.
        pii_total = conn.execute(
            "SELECT COUNT(*) FROM pii_signals WHERE export_id = ?",
            (export_id,),
        ).fetchone()[0]
        pii_rows = conn.execute("""
            SELECT pattern_label, category, severity, score, location
            FROM pii_signals WHERE export_id = ? ORDER BY score DESC
            LIMIT 1000
        """, (export_id,)).fetchall()
        export_data["pii_signals"] = [dict(r) for r in pii_rows]
        export_data["pii_signal_total"] = pii_total
        export_data["pii_signals_truncated"] = pii_total > len(pii_rows)

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

        top_size_exts = sorted(ext_sizes.items(), key=lambda x: x[1], reverse=True)[:10]
        export_data["file_size_by_type"] = [
            {"name": f".{ext}", "value": sz} for ext, sz in top_size_exts
        ]

        largest_rows = conn.execute(
            "SELECT name, path, size FROM nodes WHERE export_id = ? AND is_dir = 0 "
            "ORDER BY size DESC LIMIT 10",
            (export_id,)
        ).fetchall()
        export_data["top_largest_files"] = [
            {"name": r["name"], "path": r["path"], "size": r["size"]} for r in largest_rows
        ]

        depth_rows = conn.execute(
            "SELECT depth, COUNT(*) as count FROM nodes WHERE export_id = ? "
            "GROUP BY depth ORDER BY depth",
            (export_id,)
        ).fetchall()
        export_data["depth_distribution"] = [
            {"depth": r["depth"], "count": r["count"]} for r in depth_rows
        ]

        conn.close()
        self._json_response(export_data)

    # ------------------------------------------------------------------
    # Lazy tree
    # ------------------------------------------------------------------

    def _handle_export_children(self, export_id: int, params: dict):
        parent_id_str = params.get("parent_id", [""])[0]
        try:
            limit = min(500, max(1, int(params.get("limit", ["100"])[0])))
            offset = max(0, int(params.get("offset", ["0"])[0]))
        except ValueError:
            return self._error_response(HTTPStatus.BAD_REQUEST, "limit/offset must be integers")

        conn = get_db()

        if not conn.execute(
            "SELECT 1 FROM exports WHERE id = ? AND deleted_at = ''", (export_id,)
        ).fetchone():
            conn.close()
            return self._error_response(HTTPStatus.NOT_FOUND, "Export not found")

        if parent_id_str:
            try:
                parent_id = int(parent_id_str)
            except ValueError:
                conn.close()
                return self._error_response(HTTPStatus.BAD_REQUEST, "Invalid parent_id")
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

    # ------------------------------------------------------------------
    # Files-by-type / search / legacy file load
    # ------------------------------------------------------------------

    def _handle_files_by_type(self, export_id: int, params: dict):
        ext = params.get("ext", [""])[0].strip().lower().lstrip(".")
        if not ext:
            return self._error_response(HTTPStatus.BAD_REQUEST, "Missing ext parameter")

        conn = get_db()
        if not conn.execute(
            "SELECT 1 FROM exports WHERE id = ? AND deleted_at = ''", (export_id,)
        ).fetchone():
            conn.close()
            return self._error_response(HTTPStatus.NOT_FOUND, "Export not found")

        rows = conn.execute("""
            SELECT name, path, size FROM nodes
            WHERE export_id = ? AND is_dir = 0 AND LOWER(name) LIKE ?
            ORDER BY name ASC
            LIMIT 500
        """, (export_id, f"%.{ext}")).fetchall()
        conn.close()

        self._json_response({
            "extension": ext,
            "files": [{"name": r["name"], "path": r["path"], "size": r["size"]} for r in rows],
            "count": len(rows),
        })

    def _handle_search(self, export_id: int, params: dict):
        query = params.get("q", [""])[0].strip()
        if not query or len(query) < 2:
            return self._json_response({"results": [], "count": 0, "query": query})

        conn = get_db()
        if not conn.execute(
            "SELECT 1 FROM exports WHERE id = ? AND deleted_at = ''", (export_id,)
        ).fetchone():
            conn.close()
            return self._error_response(HTTPStatus.NOT_FOUND, "Export not found")

        like = f"%{query}%"
        rows = conn.execute("""
            SELECT name, path, is_dir, size
            FROM nodes
            WHERE export_id = ? AND (LOWER(name) LIKE LOWER(?) OR LOWER(path) LIKE LOWER(?))
            ORDER BY is_dir DESC, name ASC
            LIMIT 200
        """, (export_id, like, like)).fetchall()
        conn.close()

        self._json_response({
            "query": query,
            "results": [
                {
                    "name": r["name"],
                    "path": r["path"],
                    "is_dir": bool(r["is_dir"]),
                    "size": r["size"],
                }
                for r in rows
            ],
            "count": len(rows),
        })

    def _handle_global_search(self, params: dict):
        query = params.get("q", [""])[0].strip()
        if len(query) < 2:
            return self._json_response({"query": query, "results": [], "count": 0})
        try:
            limit = min(200, max(1, int(params.get("limit", ["100"])[0])))
        except ValueError:
            limit = 100

        like = f"%{query}%"
        conn = get_db()
        try:
            rows = conn.execute("""
                SELECT n.name, n.path, n.is_dir, n.size,
                       n.export_id, e.filename AS export_filename
                FROM nodes n
                JOIN exports e ON e.id = n.export_id
                WHERE e.deleted_at = ''
                  AND (LOWER(n.name) LIKE LOWER(?) OR LOWER(n.path) LIKE LOWER(?))
                ORDER BY n.is_dir DESC, n.name ASC
                LIMIT ?
            """, (like, like, limit)).fetchall()
        finally:
            conn.close()

        self._json_response({
            "query": query,
            "count": len(rows),
            "results": [
                {
                    "name": r["name"],
                    "path": r["path"],
                    "is_dir": bool(r["is_dir"]),
                    "size": r["size"],
                    "export_id": r["export_id"],
                    "export_filename": r["export_filename"],
                }
                for r in rows
            ],
        })

    def _handle_export_file(self, filename: str):
        target = self._validate_filename_and_get_path(filename)
        if target is None:
            return
        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._error_response(HTTPStatus.UNPROCESSABLE_ENTITY, "File is not valid JSON")
        self._json_response(payload)

    # ------------------------------------------------------------------
    # Import + delete
    # ------------------------------------------------------------------

    def _handle_import_json(self):
        payload = self._read_json_body()
        if payload is None:
            return

        filename = payload.get("filename", "")
        file_content = payload.get("content", "")
        overwrite = bool(payload.get("overwrite", False))

        if not isinstance(file_content, str):
            return self._error_response(HTTPStatus.BAD_REQUEST, "File content must be a string")

        target = self._validate_filename_and_get_path(filename, must_exist=False)
        if target is None:
            return

        try:
            parsed_file = json.loads(file_content)
        except (ValueError, UnicodeDecodeError):
            return self._error_response(HTTPStatus.UNPROCESSABLE_ENTITY,
                                        "Uploaded file is not valid JSON")

        schema_err = validate_export_schema(parsed_file)
        if schema_err:
            return self._error_response(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                f"JSON does not match expected export schema: {schema_err}",
            )

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        # Stage the file under a temp name so a DB failure doesn't leave an
        # orphan JSON that the next startup sync would silently reimport.
        tmp_path = target.with_suffix(target.suffix + ".tmp")
        tmp_path.write_text(json.dumps(parsed_file, indent=2), encoding="utf-8")

        try:
            conn = get_db()
            try:
                stat = tmp_path.stat()
                sha = hash_file_path(tmp_path)
                result = store_export(
                    conn, filename, parsed_file, overwrite,
                    source_sha256=sha, source_mtime=stat.st_mtime,
                )
            finally:
                conn.close()
        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise

        if result.get("conflict"):
            tmp_path.unlink(missing_ok=True)
            if result.get("in_trash"):
                return self._json_response({
                    "error": (
                        f"'{result['name']}' is in the trash. "
                        "Restore or purge it before re-importing."
                    ),
                    "code": "file_in_trash",
                    "name": result["name"],
                }, status=HTTPStatus.CONFLICT)
            return self._json_response({
                "error": "File already exists. Re-submit with overwrite=true after confirmation.",
                "code": "file_exists",
                "name": result["name"],
            }, status=HTTPStatus.CONFLICT)

        # Promote temp -> final atomically, then refresh sha/mtime on the
        # renamed file (mtime can shift on rename on some filesystems).
        tmp_path.replace(target)
        try:
            stat = target.stat()
            new_sha = hash_file_path(target)
            conn = get_db()
            try:
                conn.execute(
                    "UPDATE exports SET source_sha256 = ?, source_mtime = ? WHERE id = ?",
                    (new_sha, stat.st_mtime, result["id"]),
                )
                conn.commit()
            finally:
                conn.close()
        except OSError:
            pass

        self._json_response({
            "message": f"Imported {result['name']}",
            "id": result["id"],
            "name": result["name"],
            "overwritten": result["overwritten"],
        }, HTTPStatus.CREATED)

    def _handle_delete_export(self, export_id: int):
        """Soft delete: mark deleted_at and rename the data file out of the
        glob path so startup sync ignores it. The row + JSON stay on disk
        until the user purges them from the trash UI."""
        import time as _time
        conn = get_db()
        row = conn.execute(
            "SELECT filename, deleted_at FROM exports WHERE id = ?", (export_id,)
        ).fetchone()
        if not row:
            conn.close()
            return self._error_response(HTTPStatus.NOT_FOUND, "Export not found")
        if row["deleted_at"]:
            conn.close()
            return self._error_response(HTTPStatus.CONFLICT, "Already deleted")

        filename = row["filename"]
        now = _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime())
        conn.execute(
            "UPDATE exports SET deleted_at = ? WHERE id = ?", (now, export_id)
        )
        conn.commit()
        conn.close()

        data_file = DATA_DIR / filename
        trashed = data_file.with_suffix(data_file.suffix + ".deleted")
        try:
            if data_file.exists():
                data_file.replace(trashed)
        except OSError:
            pass

        self._json_response({
            "message": f"Moved {filename} to trash",
            "name": filename,
            "deleted_at": now,
        })

    def _handle_trash_list(self):
        conn = get_db()
        rows = conn.execute(
            "SELECT id, filename, company, folder, description, "
            "imported_at, updated_at, file_count, dir_count, total_size, "
            "pii_score, pii_band, deleted_at "
            "FROM exports WHERE deleted_at != '' "
            "ORDER BY deleted_at DESC"
        ).fetchall()
        conn.close()
        self._json_response({"trash": [dict(r) for r in rows]})

    def _handle_restore_export(self, export_id: int):
        conn = get_db()
        row = conn.execute(
            "SELECT filename, deleted_at FROM exports WHERE id = ?", (export_id,)
        ).fetchone()
        if not row:
            conn.close()
            return self._error_response(HTTPStatus.NOT_FOUND, "Export not found")
        if not row["deleted_at"]:
            conn.close()
            return self._error_response(HTTPStatus.CONFLICT, "Export is not in trash")

        filename = row["filename"]
        # If a different live row now owns this filename, refuse — the user
        # must purge or rename.
        clash = conn.execute(
            "SELECT id FROM exports WHERE filename = ? AND deleted_at = '' AND id != ?",
            (filename, export_id),
        ).fetchone()
        if clash:
            conn.close()
            return self._error_response(
                HTTPStatus.CONFLICT,
                f"Cannot restore: another export already uses '{filename}'",
            )

        conn.execute("UPDATE exports SET deleted_at = '' WHERE id = ?", (export_id,))
        conn.commit()
        conn.close()

        data_file = DATA_DIR / filename
        trashed = data_file.with_suffix(data_file.suffix + ".deleted")
        try:
            if trashed.exists() and not data_file.exists():
                trashed.replace(data_file)
        except OSError:
            pass

        self._json_response({"message": f"Restored {filename}", "id": export_id})

    def _handle_purge_export(self, export_id: int):
        """Hard delete a soft-deleted export: removes DB rows + the .deleted file."""
        conn = get_db()
        row = conn.execute(
            "SELECT filename, deleted_at FROM exports WHERE id = ?", (export_id,)
        ).fetchone()
        if not row:
            conn.close()
            return self._error_response(HTTPStatus.NOT_FOUND, "Export not found")
        if not row["deleted_at"]:
            conn.close()
            return self._error_response(
                HTTPStatus.CONFLICT, "Export must be deleted before it can be purged",
            )

        filename = row["filename"]
        conn.execute("DELETE FROM exports WHERE id = ?", (export_id,))
        conn.commit()
        conn.close()

        for suffix in (".deleted", ""):
            p = DATA_DIR / (filename + suffix if suffix else filename)
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass

        self._json_response({"message": f"Purged {filename}", "id": export_id})

    # ------------------------------------------------------------------
    # Score explanation
    # ------------------------------------------------------------------

    def _handle_explain_score(self, export_id: int):
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT id, filename, pii_score, pii_band, file_count, dir_count "
                "FROM exports WHERE id = ? AND deleted_at = ''",
                (export_id,),
            ).fetchone()
            if not row:
                return self._error_response(HTTPStatus.NOT_FOUND, "Export not found")

            signals = [
                dict(r) for r in conn.execute(
                    "SELECT pattern_label, category, severity, score, location "
                    "FROM pii_signals WHERE export_id = ?", (export_id,)
                ).fetchall()
            ]
            # Mirror compute_pii's "relevant nodes" denominator.
            from .pii import is_pii_relevant, explain_score
            node_rows = conn.execute(
                "SELECT name, path, is_dir FROM nodes WHERE export_id = ?",
                (export_id,),
            ).fetchall()
        finally:
            conn.close()

        relevant = sum(
            1 for r in node_rows
            if is_pii_relevant({"name": r["name"], "path": r["path"], "is_dir": r["is_dir"]})
        )
        breakdown = explain_score(signals, relevant)
        breakdown["export_id"] = row["id"]
        breakdown["filename"] = row["filename"]
        breakdown["stored_score"] = row["pii_score"]
        breakdown["stored_band"] = row["pii_band"]
        self._json_response(breakdown)

    # ------------------------------------------------------------------
    # Redaction export
    # ------------------------------------------------------------------

    def _handle_redaction_export(self, export_id: int):
        """Return the export's raw_json with PII-flagged paths' names masked.

        Useful for sharing structure without leaking sensitive filenames.
        """
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT filename, raw_json FROM exports WHERE id = ? AND deleted_at = ''",
                (export_id,),
            ).fetchone()
            if not row:
                return self._error_response(HTTPStatus.NOT_FOUND, "Export not found")

            sig_rows = conn.execute(
                "SELECT DISTINCT location FROM pii_signals WHERE export_id = ?",
                (export_id,),
            ).fetchall()
        finally:
            conn.close()

        try:
            data = json.loads(row["raw_json"])
        except (ValueError, TypeError):
            return self._error_response(
                HTTPStatus.UNPROCESSABLE_ENTITY, "Stored JSON is not parseable"
            )

        flagged_paths = {r["location"] for r in sig_rows if r["location"]}

        def _mask_name(name: str) -> str:
            if not name:
                return "[REDACTED]"
            idx = name.rfind(".")
            if idx > 0:
                return f"[REDACTED]{name[idx:]}"
            return "[REDACTED]"

        redaction_count = 0

        def _walk(children: list) -> None:
            nonlocal redaction_count
            for child in children:
                if not isinstance(child, dict):
                    continue
                if child.get("path") in flagged_paths:
                    child["name"] = _mask_name(child.get("name", ""))
                    child["redacted"] = True
                    redaction_count += 1
                if isinstance(child.get("children"), list):
                    _walk(child["children"])

        _walk(data.get("children", []))

        data.setdefault("_meta", {})
        data["_meta"]["redacted"] = True
        data["_meta"]["redaction_count"] = redaction_count
        data["_meta"]["source_filename"] = row["filename"]

        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header(
            "Content-Disposition",
            f'attachment; filename="redacted_{row["filename"]}"',
        )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ------------------------------------------------------------------
    # PII pattern CRUD + rescan
    # ------------------------------------------------------------------

    def _handle_list_patterns(self):
        conn = get_db()
        try:
            self._json_response({"patterns": pii_mod.list_patterns(conn)})
        finally:
            conn.close()

    def _handle_create_pattern(self):
        body = self._read_json_body()
        if body is None:
            return
        clean, err = pii_mod.validate_pattern_input(body)
        if err or clean is None:
            return self._error_response(HTTPStatus.UNPROCESSABLE_ENTITY, err or "Invalid pattern")
        conn = get_db()
        try:
            new_id = pii_mod.create_pattern(conn, clean)
        finally:
            conn.close()
        self._json_response({"id": new_id}, HTTPStatus.CREATED)

    def _handle_update_pattern(self, pattern_id: int):
        body = self._read_json_body()
        if body is None:
            return
        # Allow a lightweight enabled-only toggle.
        if (
            set(body.keys()) == {"enabled"} or
            (len(body.keys()) == 1 and "enabled" in body)
        ):
            conn = get_db()
            try:
                ok = pii_mod.set_enabled(conn, pattern_id, bool(body["enabled"]))
            finally:
                conn.close()
            if not ok:
                return self._error_response(HTTPStatus.NOT_FOUND, "Pattern not found")
            return self._json_response({"id": pattern_id, "enabled": bool(body["enabled"])})

        clean, err = pii_mod.validate_pattern_input(body)
        if err or clean is None:
            return self._error_response(HTTPStatus.UNPROCESSABLE_ENTITY, err or "Invalid pattern")
        enabled = body.get("enabled")
        enabled_flag = bool(enabled) if enabled is not None else None
        conn = get_db()
        try:
            ok = pii_mod.update_pattern(conn, pattern_id, clean, enabled=enabled_flag)
        finally:
            conn.close()
        if not ok:
            return self._error_response(HTTPStatus.NOT_FOUND, "Pattern not found")
        self._json_response({"id": pattern_id})

    def _handle_delete_pattern(self, pattern_id: int):
        conn = get_db()
        try:
            ok = pii_mod.delete_pattern(conn, pattern_id)
        finally:
            conn.close()
        if not ok:
            return self._error_response(HTTPStatus.NOT_FOUND, "Pattern not found")
        self._json_response({"id": pattern_id, "deleted": True})

    def _handle_reset_patterns(self):
        conn = get_db()
        try:
            pii_mod.reset_to_builtins(conn)
        finally:
            conn.close()
        self._json_response({"reset": True})

    def _handle_rescan_all(self):
        conn = get_db()
        try:
            summary = rescan_all(conn)
        finally:
            conn.close()
        self._json_response(summary)

    def _handle_rescan_one(self, export_id: int):
        conn = get_db()
        try:
            summary = rescan_export(conn, export_id)
        finally:
            conn.close()
        if summary is None:
            return self._error_response(HTTPStatus.NOT_FOUND, "Export not found")
        self._json_response(summary)

    # ------------------------------------------------------------------
    # Diff two exports
    # ------------------------------------------------------------------

    def _handle_diff(self, params: dict):
        try:
            a = int(params.get("a", [""])[0])
            b = int(params.get("b", [""])[0])
        except (ValueError, IndexError):
            return self._error_response(HTTPStatus.BAD_REQUEST, "Both 'a' and 'b' export IDs required")

        if a == b:
            return self._error_response(HTTPStatus.BAD_REQUEST, "Cannot diff an export with itself")

        conn = get_db()
        try:
            meta_rows = conn.execute(
                "SELECT id, filename, company, total_size, file_count, dir_count, pii_score "
                "FROM exports WHERE id IN (?, ?) AND deleted_at = ''",
                (a, b),
            ).fetchall()
            by_id = {r["id"]: dict(r) for r in meta_rows}
            if a not in by_id or b not in by_id:
                return self._error_response(HTTPStatus.NOT_FOUND, "One or both exports not found")

            # Pull minimal columns for both trees.
            rows_a = conn.execute(
                "SELECT path, size, is_dir FROM nodes WHERE export_id = ?", (a,)
            ).fetchall()
            rows_b = conn.execute(
                "SELECT path, size, is_dir FROM nodes WHERE export_id = ?", (b,)
            ).fetchall()
        finally:
            conn.close()

        # Index by path — same path means "same node".
        map_a = {r["path"]: (int(r["size"]), bool(r["is_dir"])) for r in rows_a if r["path"]}
        map_b = {r["path"]: (int(r["size"]), bool(r["is_dir"])) for r in rows_b if r["path"]}

        paths_a = set(map_a.keys())
        paths_b = set(map_b.keys())

        added = [
            {"path": p, "size": map_b[p][0], "is_dir": map_b[p][1]}
            for p in sorted(paths_b - paths_a)
        ]
        removed = [
            {"path": p, "size": map_a[p][0], "is_dir": map_a[p][1]}
            for p in sorted(paths_a - paths_b)
        ]
        size_changed = []
        for p in sorted(paths_a & paths_b):
            sa, dira = map_a[p]
            sb, dirb = map_b[p]
            if dira or dirb:
                continue
            if sa != sb:
                size_changed.append({"path": p, "size_a": sa, "size_b": sb, "delta": sb - sa})

        net_delta = (
            sum(x["size"] for x in added if not x["is_dir"])
            - sum(x["size"] for x in removed if not x["is_dir"])
            + sum(x["delta"] for x in size_changed)
        )

        self._json_response({
            "a": by_id[a],
            "b": by_id[b],
            "added": added,
            "removed": removed,
            "size_changed": size_changed,
            "summary": {
                "added": len(added),
                "removed": len(removed),
                "size_changed": len(size_changed),
                "net_size_delta": net_delta,
            },
        })

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _read_json_body(self) -> dict | None:
        content_length_raw = self.headers.get("Content-Length") or "0"
        try:
            content_length = int(content_length_raw)
        except ValueError:
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
            return None
        if content_length <= 0:
            self._error_response(HTTPStatus.BAD_REQUEST, "Request body is required")
            return None
        if content_length > MAX_IMPORT_BYTES:
            self._error_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Body is too large")
            return None
        try:
            body = self.rfile.read(content_length)
            return json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid JSON request payload")
            return None

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
