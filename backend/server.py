"""Entry point: initialize DB, sync data/, and start the HTTP server."""
from __future__ import annotations

from http.server import ThreadingHTTPServer

from .config import DATA_DIR, DB_PATH, HOST, PORT, WEB_DIR
from .db import get_db, init_db
from .handlers import FileBrowserHandler
from .importer import sync_data_dir_to_db
from .pii import seed_builtin_patterns


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)

    print("Initializing database...")
    init_db()

    conn = get_db()
    try:
        seed_builtin_patterns(conn)
    finally:
        conn.close()

    summary = sync_data_dir_to_db()
    print(
        f"Startup sync: {summary['skipped']} skipped, "
        f"{summary['imported']} imported, {summary['failed']} failed"
    )

    server = ThreadingHTTPServer((HOST, PORT), FileBrowserHandler)
    print(f"Serving file browser at http://{HOST}:{PORT}")
    print(f"Reading export JSON files from: {DATA_DIR}")
    print(f"Database: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server.server_close()


if __name__ == "__main__":
    main()
