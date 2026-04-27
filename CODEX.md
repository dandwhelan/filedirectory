# CODEX.md

Guidance for Codex-style agents working in this repo.

## Project snapshot

JSON Export Browser is a local-first app for importing and analyzing JSON
directory exports with PII scoring. Backend is Python stdlib + SQLite; frontend
is React + Vite + Tailwind.

## Quick commands

```bash
python3 dev.py
python3 -m unittest discover tests
cd frontend && npx tsc -b
cd frontend && npm run lint
npm run build
```

## Frontend notes

- Dashboard top actions include:
  - **Import JSON** (opens the import modal)
  - **All Local Folder** (opens the import modal and auto-starts recursive
    folder selection when supported)
- `ImportDialog` supports:
  - Plain `.json` uploads
  - Recursive folder walking via `showDirectoryPicker()`
  - Fallback folder ingestion with `input[type=file][webkitdirectory]`
  - Generated JSON preview/download prior to import

## Backend notes

- Import contract remains `POST /api/import` with `filename`, `content`,
  `overwrite`.
- Schema expectations are validated in `backend/importer.py` using
  `validate_export_schema`.
