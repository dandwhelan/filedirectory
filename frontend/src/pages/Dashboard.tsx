import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  Plus,
  ArrowUpDown,
  Database,
  FileJson,
  ChevronLeft,
  ChevronRight,
  Files,
  FolderOpen,
  HardDrive,
  ShieldAlert,
  Command,
  Printer,
  GitCompare,
} from "lucide-react";
import { fetchExports, fetchOverview, type ExportSummary, type OverviewStats } from "@/lib/api";
import { formatSize, bandColor, cn } from "@/lib/utils";
import { ExportCard } from "@/components/ExportCard";
import { ImportDialog } from "@/components/ImportDialog";

type SortKey = "updated_at" | "filename" | "pii_score" | "total_size";
const PER_PAGE = 18;

export function Dashboard() {
  const [exports, setExports] = useState<ExportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("updated_at");
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounce search so we don't fire on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Keyboard shortcut: Ctrl+K or "/" to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && e.target === document.body)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        searchRef.current?.blur();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const loadExports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchExports({
        page,
        per_page: PER_PAGE,
        search: debouncedSearch,
        sort: sortBy,
        order: sortBy === "filename" ? "asc" : "desc",
      });
      setExports(data.exports);
      setTotalPages(data.total_pages);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, sortBy]);

  useEffect(() => {
    loadExports();
  }, [loadExports]);

  // Load overview stats
  useEffect(() => {
    fetchOverview().then(setOverview).catch(console.error);
  }, []);

  // Refresh overview after imports
  const handleImported = useCallback(() => {
    loadExports();
    fetchOverview().then(setOverview).catch(console.error);
  }, [loadExports]);

  // Reset to page 1 when sort changes
  useEffect(() => {
    setPage(1);
  }, [sortBy]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header area */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Exports</h1>
          <p className="text-sm text-muted-foreground">
            {total} export{total !== 1 ? "s" : ""} in database
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Link
            to="/diff"
            className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <GitCompare size={14} />
            Compare
          </Link>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Printer size={14} />
            Print
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={16} />
            Import JSON
          </button>
        </div>
      </div>

      {/* Overview stats */}
      {overview && overview.export_count > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
              <Database size={14} />
              <span className="text-xs font-medium">Total Exports</span>
            </div>
            <span className="text-lg font-bold text-card-foreground">
              {overview.export_count.toLocaleString()}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
              <Files size={14} />
              <span className="text-xs font-medium">Total Files</span>
            </div>
            <span className="text-lg font-bold text-card-foreground">
              {overview.total_files.toLocaleString()}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
              <FolderOpen size={14} />
              <span className="text-xs font-medium">Total Directories</span>
            </div>
            <span className="text-lg font-bold text-card-foreground">
              {overview.total_dirs.toLocaleString()}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
              <HardDrive size={14} />
              <span className="text-xs font-medium">Total Storage</span>
            </div>
            <span className="text-lg font-bold text-card-foreground">
              {formatSize(overview.total_size)}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
              <ShieldAlert size={14} />
              <span className="text-xs font-medium">Avg PII Risk</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-card-foreground">
                {overview.avg_pii_score}/100
              </span>
              <div className="flex gap-1">
                {Object.entries(overview.pii_band_distribution).map(([band, count]) => (
                  <span
                    key={band}
                    className={cn(
                      "inline-flex rounded-full border px-1.5 py-0 text-[10px] font-semibold",
                      bandColor(band)
                    )}
                  >
                    {count} {band}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search and sort bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row print:hidden">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search exports by name, company, description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-20 text-sm text-foreground outline-none transition-colors focus:ring-2 focus:ring-ring"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
            <Command size={10} />K
          </kbd>
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
      ) : exports.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-border py-20">
          {total === 0 && !debouncedSearch ? (
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
                No exports match "{debouncedSearch}"
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-1 print:gap-2">
            {exports.map((exp) => (
              <div key={exp.id} className="print-card">
                <ExportCard data={exp} />
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
      />
    </div>
  );
}
