import { useState, useEffect, useMemo } from "react";
import {
  Search,
  Plus,
  ArrowUpDown,
  Database,
  FileJson,
} from "lucide-react";
import { fetchExports, type ExportSummary } from "@/lib/api";
import { ExportCard } from "@/components/ExportCard";
import { ImportDialog } from "@/components/ImportDialog";

type SortKey = "updated_at" | "filename" | "pii_score" | "total_size";

export function Dashboard() {
  const [exports, setExports] = useState<ExportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("updated_at");
  const [importOpen, setImportOpen] = useState(false);

  const loadExports = async () => {
    setLoading(true);
    try {
      const data = await fetchExports();
      setExports(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExports();
  }, []);

  const filtered = useMemo(() => {
    let items = exports;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (e) =>
          e.filename.toLowerCase().includes(q) ||
          e.company.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.folder.toLowerCase().includes(q)
      );
    }
    return [...items].sort((a, b) => {
      switch (sortBy) {
        case "filename":
          return a.filename.localeCompare(b.filename);
        case "pii_score":
          return b.pii_score - a.pii_score;
        case "total_size":
          return b.total_size - a.total_size;
        case "updated_at":
        default:
          return b.updated_at.localeCompare(a.updated_at);
      }
    });
  }, [exports, search, sortBy]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header area */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exports</h1>
          <p className="text-sm text-muted-foreground">
            {exports.length} export{exports.length !== 1 ? "s" : ""} in database
          </p>
        </div>
        <button
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus size={16} />
          Import JSON
        </button>
      </div>

      {/* Search and sort bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Search exports by name, company, description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-sm text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2">
          <ArrowUpDown size={14} className="text-muted-foreground" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="updated_at">Recently updated</option>
            <option value="filename">Name A-Z</option>
            <option value="pii_score">PII score (high first)</option>
            <option value="total_size">Size (largest first)</option>
          </select>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-border py-20">
          {exports.length === 0 ? (
            <>
              <Database size={48} className="text-muted-foreground/50" />
              <div className="text-center">
                <p className="text-lg font-medium text-foreground">
                  No exports yet
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Import a JSON export file to get started.
                </p>
              </div>
              <button
                onClick={() => setImportOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <FileJson size={16} />
                Import your first export
              </button>
            </>
          ) : (
            <>
              <Search size={48} className="text-muted-foreground/50" />
              <p className="text-muted-foreground">
                No exports match "{search}"
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((exp) => (
            <ExportCard key={exp.id} data={exp} />
          ))}
        </div>
      )}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={loadExports}
      />
    </div>
  );
}
