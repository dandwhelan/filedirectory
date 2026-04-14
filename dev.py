#!/usr/bin/env python3
"""Start both the backend API server and frontend Vite dev server."""
from __future__ import annotations

import os
import platform
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
FRONTEND = ROOT / "frontend"


def main():
    if not (FRONTEND / "node_modules").exists():
        print("Installing frontend dependencies...")
        subprocess.check_call(["npm", "install"], cwd=str(FRONTEND))

    print("Starting backend (http://127.0.0.1:8000) and frontend (http://localhost:5173)...")
    print("Press Ctrl+C to stop both.\n")

    backend = subprocess.Popen(
        [sys.executable, "app.py"],
        cwd=str(ROOT),
    )
    frontend = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(FRONTEND),
        # On Windows npm is a .cmd — shell=True is needed
        shell=(platform.system() == "Windows"),
    )

    def shutdown(sig=None, frame=None):
        for proc in (frontend, backend):
            try:
                proc.terminate()
            except OSError:
                pass
        for proc in (frontend, backend):
            proc.wait()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Wait for either process to exit
    while True:
        if backend.poll() is not None:
            print(f"\nBackend exited with code {backend.returncode}")
            frontend.terminate()
            frontend.wait()
            sys.exit(backend.returncode)
        if frontend.poll() is not None:
            print(f"\nFrontend exited with code {frontend.returncode}")
            backend.terminate()
            backend.wait()
            sys.exit(frontend.returncode)
        try:
            backend.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            pass


if __name__ == "__main__":
    main()
