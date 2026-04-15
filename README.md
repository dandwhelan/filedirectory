# JSON Export Browser

A modern local web app to browse, import, and analyze nested JSON export files with built-in PII risk detection.

## Features

- **Dashboard** — grid of import cards with PII score badges, file counts, and sizes; searchable and sortable by name, date, PII score, or size; one-click Print (browser save-as-PDF) and Compare
- **Import** — drag-and-drop or file picker; schema validation rejects non-conforming JSON; overwrite confirmation flow
- **Export detail view** — interactive file tree, stat cards, and PII findings table with filtering, sorting, and JSON/CSV export
- **Compare two exports** — side-by-side diff showing added, removed, and resized paths, with a net-size-delta summary
- **Settings** — edit, disable, or add PII patterns (label, category, severity, weighted score, keyword list) through the UI; "Rescan all" applies new rules to existing imports
- **Charts** — donut chart for file type distribution, horizontal bar chart for PII categories by weighted score
- **Expanded PII detection** — 29 keyword-based patterns across 12 categories (legal, government ID, personal identifiers, contact info, tax/payroll, financial, health, employment, education, credentials, IT security) with density-weighted scoring. Patterns live in SQLite and are editable.
- **Startup skip** — `data/*.json` files are hashed on startup; unchanged files are skipped (no reimport), keeping boot fast even with a large `data/` directory
- **SQLite database** — all imported exports stored with full tree and PII signals; enables fast listing, searching, and querying across imports
- **Dark / light mode** — toggle in the top nav; respects system preference on first visit
- **Keyboard shortcuts** — `?` opens a cheatsheet; `g d / g s / g c` navigate to dashboard / settings / compare; `⌘K` or `/` focuses search
- **Error boundary + toasts** — graceful error UI and non-blocking notifications
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

## Development setup

### Single command (recommended)

Start both the backend API and frontend dev server together:

```bash
# Option A: using npm (requires one-time npm install at root)
npm install
npm run dev

# Option B: using Python only (no extra root dependencies)
python3 dev.py
```

Both options start:
- **Backend** at `http://127.0.0.1:8000` (Python API + SQLite)
- **Frontend** at `http://localhost:5173` (Vite dev server with hot reload)

The Vite dev server proxies `/api` requests to the backend automatically.

### Manual (two terminals)

```bash
# Terminal 1: backend
python3 app.py

# Terminal 2: frontend
cd frontend
npm install
npm run dev
```

### Build for production

Compiles the React app into `web/`, which the Python server serves directly:

```bash
npm run build        # from root
# or
cd frontend && npm run build
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

### Concrete example

```json
{
  "company": "Acme Corp",
  "folder": "hr-share",
  "description": "Snapshot of the HR team share at 2026-04-01.",
  "children": [
    {
      "name": "employees",
      "path": "employees",
      "is_dir": true,
      "size": 0,
      "children": [
        {
          "name": "offer-letter-jane-doe.pdf",
          "path": "employees/offer-letter-jane-doe.pdf",
          "is_dir": false,
          "size": 184320,
          "children": []
        },
        {
          "name": "w2-2025-jane-doe.pdf",
          "path": "employees/w2-2025-jane-doe.pdf",
          "is_dir": false,
          "size": 98234,
          "children": []
        }
      ]
    },
    {
      "name": "policies",
      "path": "policies",
      "is_dir": true,
      "size": 0,
      "children": [
        {
          "name": "handbook.md",
          "path": "policies/handbook.md",
          "is_dir": false,
          "size": 42100,
          "children": []
        }
      ]
    }
  ]
}
```

Every node — file or directory — must include `name`, `path`, `is_dir`,
`size`, and `children` (use `[]` for files). `path` should be the full path
relative to the export root, with forward slashes. `size` is bytes (`0` is
fine for directories).

Ready-to-import examples live in [`data/examples/`](./data/examples). Copy
any of them into `data/` (or drop them on the dashboard) to see the UI
populated with realistic fixtures.

Files that do not match this schema are rejected with a descriptive error message.

## API endpoints

| Method   | Path                  | Description                                 |
| -------- | --------------------- | ------------------------------------------- |
| `GET`    | `/api/exports`        | List all imports with metadata               |
| `GET`    | `/api/export/<id>`    | Full detail: tree, PII signals, stats        |
| `GET`    | `/api/export/<id>/children` | Lazy tree children (paginated)        |
| `GET`    | `/api/export/<id>/search?q=` | Search names and paths inside an export |
| `GET`    | `/api/search?q=`      | Global search across all imports (names + paths)   |
| `GET`    | `/api/export/<id>/files-by-type?ext=` | All files of an extension    |
| `POST`   | `/api/import`         | Import a JSON file (`filename`, `content`, optional `overwrite`) |
| `DELETE` | `/api/export/<id>`    | Delete an import from DB and `data/`         |
| `GET`    | `/api/diff?a=&b=`     | Diff two exports (added / removed / size changes) |
| `GET`    | `/api/pii-patterns`   | List patterns                                |
| `POST`   | `/api/pii-patterns`   | Create a new pattern                         |
| `PUT`    | `/api/pii-patterns/<id>` | Update (full) or toggle (`{enabled}`)     |
| `DELETE` | `/api/pii-patterns/<id>` | Delete                                    |
| `POST`   | `/api/pii-patterns/reset` | Reset patterns to builtin defaults       |
| `POST`   | `/api/pii-rescan`     | Recompute PII for all imports                |
| `POST`   | `/api/pii-rescan/<id>`| Recompute PII for one import                 |
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
├── app.py                    # Thin launcher → backend.server.main
├── backend/                  # Python API package
│   ├── config.py             # Paths, host/port, limits
│   ├── db.py                 # SQLite + migrations
│   ├── pii.py                # Pattern engine (DB-backed)
│   ├── importer.py           # Schema validation, store_export, startup sync
│   ├── handlers.py           # HTTP handler + route dispatch
│   └── server.py             # Main entry (ThreadingHTTPServer)
├── tests/                    # stdlib unittest suite
├── data/                     # Raw JSON files (backup + startup sync source)
├── db/                       # SQLite database (auto-created, gitignored)
├── web/                      # Built React app (served by Python)
├── frontend/                 # React source code
│   ├── src/
│   │   ├── App.tsx           # Router + layout shell
│   │   ├── pages/            # Dashboard, ExportDetail, Settings, Diff
│   │   ├── components/       # TreeView, Charts, PiiTable, ErrorBoundary, ShortcutsModal, etc.
│   │   ├── hooks/            # useToast, useHotkeys
│   │   └── lib/              # API client, utils, theme
│   ├── vite.config.ts
│   └── package.json
├── CLAUDE.md                 # Agent / contributor guide
└── README.md
```

## Testing

```bash
python3 -m unittest discover tests    # backend unit tests
cd frontend && npx tsc -b             # TypeScript type-check
cd frontend && npm run lint           # ESLint
```
