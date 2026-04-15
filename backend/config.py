"""Paths, network config, and runtime limits."""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()
DATA_DIR = BASE_DIR / "data"
DB_DIR = BASE_DIR / "db"
WEB_DIR = BASE_DIR / "web"
DB_PATH = DB_DIR / "exports.db"

# Network binding. Loopback by default for safety; override via env vars when
# exposing behind a TLS proxy or an Azure NSG-restricted NIC.
#   JEB_HOST=0.0.0.0 JEB_PORT=8000 python3 app.py
HOST = os.environ.get("JEB_HOST", "127.0.0.1")
try:
    PORT = int(os.environ.get("JEB_PORT", "8000"))
except ValueError:
    PORT = 8000

# Request body cap for /api/import.
MAX_IMPORT_BYTES = 10 * 1024 * 1024
