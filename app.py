#!/usr/bin/env python3
"""Thin launcher kept for backwards compatibility.

The backend lives in the ``backend/`` package; see ``backend/server.py``.
"""
from backend.server import main

if __name__ == "__main__":
    main()
