# JSON Export Browser

A local web app to browse nested JSON export files, import new JSON files from the browser, and analyze file metadata.

## Features

- Browse multiple export JSON files in `data/`
- Expandable tree view with folder/file icons and sizes
- Filter by file/folder name or full path
- Built-in import button to upload `.json` files directly from the UI
- Overwrite confirmation flow when an import filename already exists
- Analysis panel with:
  - file and directory totals
  - total file size
  - file type breakdown by extension (count and bytes)
  - top largest files
  - potential PII indicators (heuristic scan of file names/paths only)
  - PII severity labels (`low`, `medium`, `high`)
  - PII category buckets focused on high-value data (NDAs/contracts, passports, driver licenses, payroll/tax, banking, health, etc.)
  - PII risk scoring (`0-100`) with low/medium/high classification bands
  - export PII findings as JSON or CSV

## Start

```bash
python3 app.py
```

Open: <http://127.0.0.1:8000>

## API endpoints

- `GET /api/exports` list json files in `data/`
- `GET /api/export?file=<name.json>` read one export file
- `POST /api/import` import a JSON file payload (`filename`, `content`, optional `overwrite` boolean)

## Notes

- PII detection is heuristic and based only on file names/paths, not deep file content scanning.
- The risk score is a weighted heuristic designed for triage, not a compliance guarantee.
- Only `.json` files are accepted for import.
