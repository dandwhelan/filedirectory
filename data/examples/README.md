# Example exports

Sample JSON export files that conform to the importer schema. Use them to
populate the app without having to produce a real export.

| File | Company | Expected PII risk | What's inside |
| ---- | ------- | ----------------- | ------------- |
| `acme-hr-share.json`      | Acme Corp          | **High**   | Offer letters, W-2s, 1099s, background checks, termination letter, salary bands. |
| `globex-engineering.json` | Globex Industries  | **Low–Med** | Source code + docs; a small `ops/credentials/` folder pushes score up slightly. |
| `initech-finance.json`    | Initech            | **High**   | Invoices, bank statements, tax forms, NDAs, MSAs, credit-card reconciliation. |

## Using them

Two options:

**Drag-and-drop** (easiest): open the dashboard, click *Import JSON*, and
drop one of the files. The import dialog accepts any of these directly.

**Startup sync**: copy a file into the repo's top-level `data/` directory,
then run `python3 app.py`. The server will pick it up on boot.

```bash
cp data/examples/acme-hr-share.json data/
python3 app.py
```

Because startup sync is idempotent (sha256 + mtime), re-running won't
re-import unchanged files.

## Writing your own

The schema is documented in the top-level [README](../../README.md#json-export-schema).
Each node needs `name`, `path`, `is_dir`, `size`, and `children` (use `[]`
for files). Paths are relative to the export root; forward slashes only.
