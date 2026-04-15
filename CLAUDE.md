# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repo.

## Project summary

**JSON Export Browser** — a single-command local web app for importing, browsing,
and analyzing nested JSON file-directory exports with built-in PII risk
detection. Backend is Python stdlib + SQLite; frontend is React 19 + Vite +
Tailwind v4. Runs entirely on `127.0.0.1` with no external services.

## Common commands

```bash
# Dev (backend + Vite together, one terminal)
python3 dev.py
# or
npm run dev

# Production-style run (serves pre-built web/)
python3 app.py

# Frontend build into web/
npm run build               # from repo root
cd frontend && npm run build

# Type-check + lint (frontend)
cd frontend && npx tsc -b
cd frontend && npm run lint

# Backend unit tests (stdlib unittest, no pip deps)
python3 -m unittest discover tests
```

## Architecture map

Backend (split from the old `app.py` monolith):

- `backend/config.py` — paths, host/port, body-size cap.
- `backend/db.py` — `get_db()`, `init_db()`, additive migration runner. Schema
  is idempotent; migrations are tracked in `schema_migrations`.
- `backend/pii.py` — `BUILTIN_PATTERNS` seed list, `pii_patterns` CRUD helpers,
  compiled-regex cache, `compute_pii()` scoring. Patterns live in SQLite and
  are edited via the Settings UI — **don't hardcode new patterns here**, add
  them through `/api/pii-patterns`.
- `backend/importer.py` — schema validation, `store_export()`, `rescan_*()`,
  `sync_data_dir_to_db()` with sha256/mtime skip.
- `backend/handlers.py` — `FileBrowserHandler` and all `_handle_*` methods.
- `backend/server.py` — `main()`: init DB, seed patterns, sync data/, start
  `ThreadingHTTPServer`.
- `app.py` — thin shim that calls `backend.server.main`.

Frontend (`frontend/src/`):

- `App.tsx` — routes: `/`, `/export/:id`, `/settings`, `/diff`. Wraps children
  in `ErrorBoundary` + `ToastProvider`; registers global hotkeys.
- `pages/Dashboard.tsx` — grid, stats cards, search/sort, Compare + Print
  buttons.
- `pages/ExportDetail.tsx` — tree + charts + PII table for one export.
- `pages/Settings.tsx` — PII pattern editor (CRUD + rescan-all).
- `pages/Diff.tsx` — side-by-side diff between two imports.
- `components/TreeView.tsx` — lazy-loaded tree (100 nodes/page).
- `components/PiiTable.tsx` — sortable findings + JSON/CSV export.
- `components/Charts.tsx` — Recharts donut + bar.
- `components/{ErrorBoundary,ShortcutsModal}.tsx` — global UX.
- `hooks/useToast.tsx`, `hooks/useHotkeys.ts` — toast + keybinding infra.
- `lib/api.ts` — typed fetch wrappers for every endpoint.

## Data flow

1. User drops JSON → `POST /api/import` validates schema.
2. File is written to `data/<name>.json` (backup) and parsed tree is inserted
   into `exports`, `nodes`, `pii_signals`. `source_sha256` + `source_mtime`
   are recorded so startup sync can skip unchanged files.
3. On boot, `sync_data_dir_to_db()` iterates `data/*.json`, skips files whose
   sha256 + mtime already match the DB, and imports the rest.
4. Dashboard / Settings / Diff pages read through `/api/*` JSON endpoints.

## API endpoints

| Method | Path | Notes |
| ------ | ---- | ----- |
| `GET`  | `/api/overview` | Aggregate stats |
| `GET`  | `/api/exports` | Paginated list |
| `GET`  | `/api/export/<id>` | Detail (metadata + PII + charts data) |
| `GET`  | `/api/export/<id>/children` | Lazy tree (paginated) |
| `GET`  | `/api/export/<id>/search?q=` | In-export name/path search |
| `GET`  | `/api/search?q=` | Global search across all imports (names + paths) |
| `GET`  | `/api/export/<id>/files-by-type?ext=` | Files of one extension |
| `POST` | `/api/import` | Import JSON (`filename`, `content`, `overwrite`) |
| `DELETE`| `/api/export/<id>` | Delete import (DB + data/ file) |
| `GET`  | `/api/diff?a=<id>&b=<id>` | Tree diff between two imports |
| `GET`  | `/api/pii-patterns` | List patterns |
| `POST` | `/api/pii-patterns` | Create |
| `PUT`  | `/api/pii-patterns/<id>` | Update (full doc or just `{enabled}`) |
| `DELETE`| `/api/pii-patterns/<id>` | Delete |
| `POST` | `/api/pii-patterns/reset` | Reset to builtins |
| `POST` | `/api/pii-rescan` | Recompute PII for all imports |
| `POST` | `/api/pii-rescan/<id>` | Recompute PII for one import |

## Conventions

- Backend is stdlib-only. Don't add pip dependencies.
- Frontend is TypeScript strict. Components are PascalCase; use Tailwind utility
  classes; hooks for state. Prefer `lucide-react` icons.
- SQLite is WAL mode with row factory = `sqlite3.Row`. Always close connections
  in `finally`.
- PII regexes use `\b…\b` word boundaries — don't loosen without retesting
  against the word-boundary tests in `tests/test_pii.py`.
- Pattern changes invalidate the in-process cache via
  `pii.invalidate_cache()`; the CRUD helpers do this automatically.

## Gotchas

- **`data/` is not gitignored** — JSON fixtures are intentionally committed.
  If you add large or sensitive fixtures, add them to `.gitignore` first.
- **Startup skip relies on sha256 + mtime.** If you edit a JSON in place and
  want a reimport, either touch the file (bumps mtime) or delete the row in
  SQLite. Don't manually poke `source_sha256` in the DB.
- **Modifying PII patterns** goes through the Settings UI or the CRUD API,
  not source edits. `BUILTIN_PATTERNS` is only the seed used on first boot
  and by "Reset to defaults".
- **Migrations are additive only.** The runner in `backend/db.py:_migrate`
  supports `ALTER TABLE ADD COLUMN` and new-table creation. Destructive
  changes still require wiping `db/exports.db`.
- **`app.py` is kept** as a tiny shim so existing docs and `dev.py` keep
  working. New code should import from `backend.*`.
- **Host/port are env-driven.** `backend/config.py` reads `JEB_HOST` /
  `JEB_PORT` with loopback defaults. Don't hardcode bindings — set the env
  vars in the deploy unit instead. There is no auth or TLS; exposing
  beyond `127.0.0.1` assumes a reverse proxy + IP allowlist in front.

## SQLite scaling

The database at `db/exports.db` is well within SQLite's comfort zone up to
tens of GB. Key facts for planning:

- Hard file-size ceiling ≈ 281 TB (page size × 2^32 pages). 3 GB is nothing.
- Single-writer lock (mitigated by WAL — already enabled — so readers never
  block the writer and vice versa).
- Full-table scans get slow without indexes. Existing indexes cover the hot
  dashboard/export queries; if you add a query, run
  `EXPLAIN QUERY PLAN` and confirm an index is used.
- `VACUUM` cost grows with DB size — prefer avoiding it in hot paths.
- Memory: the handler reads query results with cursors (no streaming to the
  client needed at current size). If the DB grows past ~50 GB, consider
  moving `exports.raw_json` blobs out to files and keeping only metadata in
  SQLite.

## Testing status

- Backend: 13 unit tests in `tests/` (PII scoring, CRUD validation, startup
  skip, content-change reimport). Run with `python3 -m unittest discover tests`.
- Frontend: `npx tsc -b` and `npm run lint`. No unit-test framework is set up;
  propose one before adding tests.

## Roadmap (future ideas — not started)

- Optional PII content scanning for small text-based files (opt-in).
- Pluggable detector interface (e.g. Microsoft Presidio, custom rulesets).
- Trend dashboard — PII score history over time across all imports.
- Redaction export — produce scrubbed JSON with flagged paths masked.
- Bulk import from .zip or drag-and-drop multi-file.
- Local auth (password gate + session cookie) for shared LAN use.
- "Explain this score" — per-import breakdown of score contributions.
