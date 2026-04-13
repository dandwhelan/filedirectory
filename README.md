# JSON Export Browser

A modern local web app to browse, import, and analyze nested JSON export files with built-in PII risk detection.

## Features

- **Dashboard** — grid of import cards with PII score badges, file counts, and sizes; searchable and sortable by name, date, PII score, or size
- **Import** — drag-and-drop or file picker; schema validation rejects non-conforming JSON; overwrite confirmation flow
- **Export detail view** — interactive file tree, stat cards, and PII findings table with filtering, sorting, and JSON/CSV export
- **Charts** — donut chart for file type distribution, horizontal bar chart for PII categories by weighted score
- **Expanded PII detection** — 28 keyword-based patterns across 12 categories (legal, government ID, personal identifiers, contact info, tax/payroll, financial, health, employment, education, credentials, IT security) with density-weighted scoring
- **SQLite database** — all imported exports stored with full tree and PII signals; enables fast listing, searching, and querying across imports
- **Dark / light mode** — toggle in the top nav; respects system preference on first visit
- **Single-command startup** — `python3 app.py` serves the pre-built React frontend and API

## Tech stack

| Layer    | Technology                                       |
| -------- | ------------------------------------------------ |
| Backend  | Python 3 stdlib (`http.server`, `sqlite3`, `json`) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4       |
| Charts   | Recharts                                          |
| Icons    | Lucide React                                      |
| Database | SQLite (via Python `sqlite3`)                     |
| Storage  | `data/` directory (raw JSON backup) + `db/exports.db` |

## Quick start

```bash
python3 app.py
```

Open: <http://127.0.0.1:8000>

Any `.json` files already in `data/` are automatically imported into the database on startup.

## Frontend development

To work on the React frontend with hot reload:

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` requests to `http://127.0.0.1:8000`, so run the Python backend in a separate terminal.

To build for production (outputs to `web/`):

```bash
cd frontend
npm run build
```

## JSON export schema

Imported files must match this structure:

```json
{
  "company": "string (optional)",
  "folder": "string (optional)",
  "description": "string (optional)",
  "children": [
    {
      "name": "file-or-folder-name",
      "path": "full/path/to/item",
      "is_dir": true,
      "size": 0,
      "children": []
    }
  ]
}
```

Files that do not match this schema are rejected with a descriptive error message.

## API endpoints

| Method   | Path                  | Description                                 |
| -------- | --------------------- | ------------------------------------------- |
| `GET`    | `/api/exports`        | List all imports with metadata               |
| `GET`    | `/api/export/<id>`    | Full detail: tree, PII signals, stats        |
| `POST`   | `/api/import`         | Import a JSON file (`filename`, `content`, optional `overwrite`) |
| `DELETE` | `/api/export/<id>`    | Delete an import from DB and `data/`         |
| `GET`    | `/api/pii-patterns`   | List all PII detection patterns              |
| `GET`    | `/api/export?file=<name>` | Legacy: load raw JSON by filename        |

## PII detection

Detection is heuristic — it scans file/folder **names and paths only**, not file contents. 28 keyword patterns are organized into categories:

- Legal agreements (contracts, NDAs, terms of service)
- Government ID (passports, driver licenses, SSN, birth certificates)
- Personal identifiers (date of birth, biometrics, photo ID)
- Contact information (address books, email/phone lists)
- Tax & payroll (W-2, 1099, salary, compensation)
- Financial accounts (banking, credit cards, invoices, equity)
- Health data (medical records, insurance claims)
- Employment records (reviews, terminations, offer letters)
- Education records (transcripts, student records)
- Sensitive personnel (background checks, screening)
- Credentials & secrets (API keys, passwords, certificates)
- IT security (audit logs, access control)

The risk score (0–100) uses weighted pattern scores, category breadth, and density bonuses. It is designed for triage, not as a compliance guarantee.

## Project structure

```
.
├── app.py                    # Python backend + SQLite + HTTP server
├── data/                     # Raw JSON files (backup)
├── db/                       # SQLite database (auto-created)
├── web/                      # Built React app (served by Python)
├── frontend/                 # React source code
│   ├── src/
│   │   ├── App.tsx           # Router + layout shell
│   │   ├── pages/            # Dashboard, ExportDetail
│   │   ├── components/       # ExportCard, TreeView, Charts, PiiTable, etc.
│   │   └── lib/              # API client, utils, theme
│   ├── vite.config.ts
│   └── package.json
└── README.md
```
