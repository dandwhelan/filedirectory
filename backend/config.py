"""Paths, network config, and runtime limits."""
from __future__ import annotations

from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()
DATA_DIR = BASE_DIR / "data"
DB_DIR = BASE_DIR / "db"
WEB_DIR = BASE_DIR / "web"
DB_PATH = DB_DIR / "exports.db"

HOST = "127.0.0.1"
PORT = 8000

# Request body cap for /api/import.
MAX_IMPORT_BYTES = 10 * 1024 * 1024
