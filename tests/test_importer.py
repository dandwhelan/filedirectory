"""Tests for the data/ → DB startup sync and diff logic."""
from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path

from backend import config, pii
from backend.db import get_db, init_db
from backend.importer import store_export, sync_data_dir_to_db


SAMPLE_EXPORT = {
    "company": "Acme",
    "folder": "exports",
    "description": "sample",
    "children": [
        {
            "name": "legal",
            "path": "legal",
            "is_dir": True,
            "size": 0,
            "children": [
                {"name": "contract.pdf", "path": "legal/contract.pdf", "is_dir": False, "size": 1024},
            ],
        },
    ],
}


class _ImporterTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        (root / "db").mkdir()
        (root / "data").mkdir()
        self._orig_db_dir = config.DB_DIR
        self._orig_db_path = config.DB_PATH
        self._orig_data = config.DATA_DIR
        config.DB_DIR = root / "db"
        config.DB_PATH = config.DB_DIR / "exports.db"
        config.DATA_DIR = root / "data"
        pii.invalidate_cache()
        init_db()
        conn = get_db()
        try:
            pii.seed_builtin_patterns(conn)
        finally:
            conn.close()

    def tearDown(self) -> None:
        config.DB_DIR = self._orig_db_dir
        config.DB_PATH = self._orig_db_path
        config.DATA_DIR = self._orig_data
        pii.invalidate_cache()
        self._tmp.cleanup()


class TestStartupSync(_ImporterTestBase):
    def _write_sample(self, filename: str, payload=SAMPLE_EXPORT) -> Path:
        p = config.DATA_DIR / filename
        p.write_text(json.dumps(payload), encoding="utf-8")
        return p

    def test_first_run_imports(self):
        self._write_sample("a.json")
        self._write_sample("b.json")
        summary = sync_data_dir_to_db()
        self.assertEqual(summary["imported"], 2)
        self.assertEqual(summary["skipped"], 0)
        self.assertEqual(summary["failed"], 0)

    def test_unchanged_files_are_skipped(self):
        self._write_sample("a.json")
        first = sync_data_dir_to_db()
        self.assertEqual(first["imported"], 1)
        second = sync_data_dir_to_db()
        self.assertEqual(second["imported"], 0)
        self.assertEqual(second["skipped"], 1)

    def test_touch_without_change_still_skips(self):
        """Stable content + changed mtime: hash should still allow skip if
        mtime also matches stored value.  If we touch, mtime changes and we
        intentionally re-import (mtime is part of the cheap check).  Assert
        that behavior is consistent — the file is reprocessed exactly once,
        not on every boot.
        """
        p = self._write_sample("a.json")
        sync_data_dir_to_db()
        # Bump mtime.
        new_time = p.stat().st_mtime + 10
        os.utime(p, (new_time, new_time))
        second = sync_data_dir_to_db()
        self.assertEqual(second["imported"], 1)
        # Third run: mtime + hash both now stable — must skip.
        third = sync_data_dir_to_db()
        self.assertEqual(third["skipped"], 1)
        self.assertEqual(third["imported"], 0)

    def test_content_change_triggers_reimport(self):
        p = self._write_sample("a.json")
        sync_data_dir_to_db()

        modified = dict(SAMPLE_EXPORT)
        modified["company"] = "Acme2"
        p.write_text(json.dumps(modified), encoding="utf-8")

        summary = sync_data_dir_to_db()
        self.assertEqual(summary["imported"], 1)

        conn = get_db()
        try:
            row = conn.execute(
                "SELECT company FROM exports WHERE filename = ?", ("a.json",)
            ).fetchone()
        finally:
            conn.close()
        self.assertEqual(row["company"], "Acme2")

    def test_invalid_schema_counts_as_failed(self):
        bad = config.DATA_DIR / "broken.json"
        bad.write_text(json.dumps({"not": "valid"}), encoding="utf-8")
        summary = sync_data_dir_to_db()
        self.assertEqual(summary["failed"], 1)


class TestStoreExportStoresHash(_ImporterTestBase):
    def test_store_export_writes_hash(self):
        conn = get_db()
        try:
            store_export(
                conn, "x.json", SAMPLE_EXPORT, overwrite=False,
                source_sha256="abc123", source_mtime=12345.0,
            )
            row = conn.execute(
                "SELECT source_sha256, source_mtime FROM exports WHERE filename = ?",
                ("x.json",),
            ).fetchone()
        finally:
            conn.close()
        self.assertEqual(row["source_sha256"], "abc123")
        self.assertEqual(row["source_mtime"], 12345.0)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
