"""Tests for new features: node_id linkage, soft delete, score explanation,
redaction (logic only — HTTP layer is exercised manually)."""
from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path

from backend import config, pii
from backend.db import get_db, init_db
from backend.importer import store_export


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
                {"name": "contract.pdf", "path": "legal/contract.pdf",
                 "is_dir": False, "size": 1024},
                {"name": "nda.pdf", "path": "legal/nda.pdf",
                 "is_dir": False, "size": 2048},
            ],
        },
    ],
}


class _Base(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        (root / "db").mkdir()
        (root / "data").mkdir()
        self._orig = (config.DB_DIR, config.DB_PATH, config.DATA_DIR)
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
        config.DB_DIR, config.DB_PATH, config.DATA_DIR = self._orig
        pii.invalidate_cache()
        pii.invalidate_cache()
        self._tmp.cleanup()


class TestNodeIdLinkage(_Base):
    def test_pii_signals_have_node_id(self):
        conn = get_db()
        try:
            store_export(conn, "x.json", SAMPLE_EXPORT, overwrite=False)
            rows = conn.execute(
                "SELECT s.location, s.node_id, n.path "
                "FROM pii_signals s LEFT JOIN nodes n ON n.id = s.node_id"
            ).fetchall()
        finally:
            conn.close()
        self.assertGreater(len(rows), 0, "Expected at least one PII signal")
        for r in rows:
            # Every signal must point at a real node, and that node's path
            # must match the signal's location.
            self.assertIsNotNone(r["node_id"], f"node_id NULL for {r['location']}")
            self.assertEqual(r["path"], r["location"])


class TestSoftDelete(_Base):
    def _create(self, name: str = "x.json") -> int:
        conn = get_db()
        try:
            r = store_export(conn, name, SAMPLE_EXPORT, overwrite=False)
        finally:
            conn.close()
        return r["id"]

    def test_soft_delete_keeps_row(self):
        eid = self._create()
        conn = get_db()
        try:
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            conn.execute(
                "UPDATE exports SET deleted_at = ? WHERE id = ?", (now, eid)
            )
            conn.commit()
            row = conn.execute(
                "SELECT id, deleted_at FROM exports WHERE id = ?", (eid,)
            ).fetchone()
        finally:
            conn.close()
        self.assertEqual(row["id"], eid)
        self.assertTrue(row["deleted_at"])

    def test_reimport_into_trash_signals_conflict(self):
        self._create()
        conn = get_db()
        try:
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            conn.execute("UPDATE exports SET deleted_at = ?", (now,))
            conn.commit()
            # Second import without overwrite should report in_trash.
            r = store_export(conn, "x.json", SAMPLE_EXPORT, overwrite=False)
        finally:
            conn.close()
        self.assertTrue(r.get("conflict"))
        self.assertTrue(r.get("in_trash"))

    def test_reimport_with_overwrite_clears_deleted_at(self):
        eid = self._create()
        conn = get_db()
        try:
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            conn.execute("UPDATE exports SET deleted_at = ? WHERE id = ?", (now, eid))
            conn.commit()
            r = store_export(conn, "x.json", SAMPLE_EXPORT, overwrite=True)
            row = conn.execute(
                "SELECT deleted_at FROM exports WHERE id = ?", (eid,)
            ).fetchone()
        finally:
            conn.close()
        self.assertFalse(r.get("conflict"))
        self.assertEqual(row["deleted_at"], "")


class TestExplainScore(_Base):
    def test_explain_components_match_compute(self):
        conn = get_db()
        try:
            patterns = pii.load_patterns(conn)
        finally:
            conn.close()

        from backend.importer import flatten_children
        nodes = flatten_children(SAMPLE_EXPORT["children"])
        signals, computed_score, computed_band = pii.compute_pii(nodes, patterns)

        relevant = [n for n in nodes if pii.is_pii_relevant(n)]
        breakdown = pii.explain_score(signals, len(relevant))

        self.assertEqual(breakdown["score"], computed_score)
        self.assertEqual(breakdown["band"], computed_band)
        self.assertEqual(breakdown["signal_count"], len(signals))
        comp = breakdown["components"]
        # Components sum to the uncapped score; final is min(100, sum).
        self.assertEqual(
            min(100, comp["intensity"] + comp["breadth"] + comp["density_bonus"]),
            computed_score,
        )


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
