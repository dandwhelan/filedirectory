"""Tests for PII scoring and pattern CRUD."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend import config, pii
from backend.db import get_db, init_db


class _PiiTestBase(unittest.TestCase):
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


class TestPiiScoring(_PiiTestBase):
    def test_word_boundary_prevents_false_positive(self):
        """'ein' should not match inside 'Vereinbarung'."""
        conn = get_db()
        patterns = pii.load_patterns(conn)
        conn.close()

        nodes = [
            {"name": "Vereinbarung.pdf", "path": "legal/Vereinbarung.pdf", "is_dir": False},
        ]
        signals, score, _ = pii.compute_pii(nodes, patterns)
        # 'ein' (in National ID / SSN pattern) must NOT match inside Vereinbarung.
        labels = [s["pattern_label"] for s in signals]
        self.assertNotIn("National ID / SSN", labels)
        self.assertEqual(score, 0)

    def test_contract_keyword_detected(self):
        conn = get_db()
        patterns = pii.load_patterns(conn)
        conn.close()
        nodes = [
            {"name": "Master Contract 2024.pdf", "path": "legal/Master Contract 2024.pdf",
             "is_dir": False},
        ]
        signals, score, band = pii.compute_pii(nodes, patterns)
        self.assertTrue(any(s["pattern_label"] == "Contract or agreement" for s in signals))
        self.assertGreater(score, 0)
        self.assertIn(band, ("Low", "Medium", "High"))

    def test_source_code_skipped(self):
        """Source code files are not relevant for PII scanning by extension filter."""
        nodes = [
            # .py is not in PII_RELEVANT_EXTENSIONS, so should be skipped.
            {"name": "contract_utils.py", "path": "src/contract_utils.py", "is_dir": False},
        ]
        conn = get_db()
        patterns = pii.load_patterns(conn)
        conn.close()
        signals, _, _ = pii.compute_pii(nodes, patterns)
        self.assertEqual(signals, [])

    def test_disabled_pattern_not_applied(self):
        conn = get_db()
        # Disable the "Contract or agreement" pattern.
        pat_rows = pii.list_patterns(conn)
        contract_id = next(p["id"] for p in pat_rows if p["label"] == "Contract or agreement")
        pii.set_enabled(conn, contract_id, False)
        patterns = pii.load_patterns(conn)
        conn.close()

        nodes = [{"name": "contract.pdf", "path": "legal/contract.pdf", "is_dir": False}]
        signals, _, _ = pii.compute_pii(nodes, patterns)
        labels = [s["pattern_label"] for s in signals]
        self.assertNotIn("Contract or agreement", labels)


class TestPatternCrud(_PiiTestBase):
    def test_create_update_delete(self):
        conn = get_db()
        try:
            before = len(pii.list_patterns(conn))
            new_id = pii.create_pattern(conn, {
                "label": "Custom pattern",
                "category": "Custom",
                "severity": "medium",
                "score": 25,
                "keywords": ["foobar"],
            })
            after_create = len(pii.list_patterns(conn))
            self.assertEqual(after_create, before + 1)

            ok = pii.update_pattern(conn, new_id, {
                "label": "Custom renamed",
                "category": "Custom",
                "severity": "high",
                "score": 40,
                "keywords": ["foobar", "baz"],
            })
            self.assertTrue(ok)

            patterns = pii.list_patterns(conn)
            updated = next(p for p in patterns if p["id"] == new_id)
            self.assertEqual(updated["label"], "Custom renamed")
            self.assertEqual(updated["score"], 40)
            self.assertIn("baz", updated["keywords"])

            self.assertTrue(pii.delete_pattern(conn, new_id))
            self.assertEqual(len(pii.list_patterns(conn)), before)
        finally:
            conn.close()

    def test_validation_rejects_bad_input(self):
        _, err = pii.validate_pattern_input({"label": "", "category": "x",
                                              "severity": "high", "score": 10,
                                              "keywords": ["a"]})
        self.assertIsNotNone(err)

        _, err = pii.validate_pattern_input({"label": "x", "category": "x",
                                              "severity": "extreme", "score": 10,
                                              "keywords": ["a"]})
        self.assertIsNotNone(err)

        _, err = pii.validate_pattern_input({"label": "x", "category": "x",
                                              "severity": "high", "score": 200,
                                              "keywords": ["a"]})
        self.assertIsNotNone(err)

        _, err = pii.validate_pattern_input({"label": "x", "category": "x",
                                              "severity": "high", "score": 10,
                                              "keywords": []})
        self.assertIsNotNone(err)

    def test_reset_restores_builtins(self):
        conn = get_db()
        try:
            pii.create_pattern(conn, {
                "label": "X", "category": "Y", "severity": "low",
                "score": 5, "keywords": ["kw"],
            })
            before = len(pii.list_patterns(conn))
            self.assertGreater(before, len(pii.BUILTIN_PATTERNS))
            pii.reset_to_builtins(conn)
            after = len(pii.list_patterns(conn))
            self.assertEqual(after, len(pii.BUILTIN_PATTERNS))
        finally:
            conn.close()


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
