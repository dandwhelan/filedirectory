#!/usr/bin/env python3
from __future__ import annotations

import json
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).parent.resolve()
DATA_DIR = BASE_DIR / "data"
WEB_DIR = BASE_DIR / "web"
HOST = "127.0.0.1"
PORT = 8000
MAX_IMPORT_BYTES = 10 * 1024 * 1024


class FileBrowserHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/exports":
            self._handle_exports_list()
            return

        if parsed.path == "/api/export":
            params = parse_qs(parsed.query)
            filename = params.get("file", [""])[0]
            self._handle_export_file(filename)
            return

        if parsed.path == "/":
            self.path = "/index.html"

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/import":
            self._handle_import_json()
            return

        self._error_response(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def _handle_exports_list(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)

        exports = []
        for path in sorted(DATA_DIR.glob("*.json")):
            exports.append({"name": path.name, "size": path.stat().st_size})

        self._json_response({"exports": exports})

    def _handle_export_file(self, filename: str):
        target = self._validate_filename_and_get_path(filename)
        if target is None:
            return

        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            self._error_response(HTTPStatus.UNPROCESSABLE_ENTITY, "File is not valid JSON")
            return

        self._json_response(payload)

    def _handle_import_json(self):
        content_length_raw = self.headers.get("Content-Length") or "0"

        try:
            content_length = int(content_length_raw)
        except ValueError:
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
            return

        if content_length <= 0:
            self._error_response(HTTPStatus.BAD_REQUEST, "Request body is required")
            return

        if content_length > MAX_IMPORT_BYTES:
            self._error_response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "File is too large")
            return

        try:
            body = self.rfile.read(content_length)
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._error_response(HTTPStatus.BAD_REQUEST, "Invalid JSON request payload")
            return

        filename = payload.get("filename", "")
        file_content = payload.get("content", "")
        overwrite = bool(payload.get("overwrite", False))

        if not isinstance(file_content, str):
            self._error_response(HTTPStatus.BAD_REQUEST, "File content must be a string")
            return

        target = self._validate_filename_and_get_path(filename, must_exist=False)
        if target is None:
            return

        existed_before = target.exists()

        if existed_before and not overwrite:
            self._json_response(
                {
                    "error": "File already exists. Re-submit with overwrite=true after confirmation.",
                    "code": "file_exists",
                    "name": target.name,
                },
                status=HTTPStatus.CONFLICT,
            )
            return

        try:
            parsed_file = json.loads(file_content)
        except json.JSONDecodeError:
            self._error_response(HTTPStatus.UNPROCESSABLE_ENTITY, "Uploaded file is not valid JSON")
            return

        target.write_text(json.dumps(parsed_file, indent=2), encoding="utf-8")
        self._json_response(
            {
                "message": f"Imported {target.name}",
                "name": target.name,
                "overwritten": existed_before and overwrite,
            },
            HTTPStatus.CREATED,
        )

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


if __name__ == "__main__":
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)

    server = ThreadingHTTPServer((HOST, PORT), FileBrowserHandler)
    print(f"Serving file browser at http://{HOST}:{PORT}")
    print(f"Reading export JSON files from: {DATA_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server.server_close()
