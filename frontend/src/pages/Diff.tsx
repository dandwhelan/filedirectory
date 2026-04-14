import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRightLeft,
  Plus,
  Minus,
  Scale,
  FileText,
  Folder,
  ChevronDown,
} from "lucide-react";
import {
  fetchDiff,
  fetchExports,
  type DiffResult,
  type ExportSummary,
} from "@/lib/api";
import { cn, formatSize } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

const CHUNK = 200; // show this many rows at a time to keep the DOM bounded.

export function Diff() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [options, setOptions] = useState<ExportSummary[]>([]);
  const [a, setA] = useState<number | null>(
    searchParams.get("a") ? Number(searchParams.get("a")) : null
  );
  const [b, setB] = useState<number | null>(
    searchParams.get("b") ? Number(searchParams.get("b")) : null
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiffResult | null>(null);
  const [showAdded, setShowAdded] = useState(CHUNK);
  const [showRemoved, setShowRemoved] = useState(CHUNK);
  const [showChanged, setShowChanged] = useState(CHUNK);

  useEffect(() => {
    // Load all exports for the select (first 100 is plenty for the dropdown).
    fetchExports({ per_page: 100, sort: "updated_at", order: "desc" })
      .then((r) => setOptions(r.exports))
      .catch((e) => toast.error(e.message || "Failed to load exports"));
  }, [toast]);

  const runDiff = useCallback(async () => {
    if (a == null || b == null || a === b) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await fetchDiff(a, b);
      setResult(r);
      setShowAdded(CHUNK);
      setShowRemoved(CHUNK);
      setShowChanged(CHUNK);
      setSearchParams({ a: String(a), b: String(b) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Diff failed");
    } finally {
      setLoading(false);
    }
  }, [a, b, toast, setSearchParams]);

  // Auto-run when both are selected.
  useEffect(() => {
    if (a != null && b != null && a !== b) runDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b]);

  const swap = () => {
    setA(b);
    setB(a);
  };

  const summary = result?.summary;

  const netDelta = useMemo(
    () =>
      summary
        ? `${summary.net_size_delta >= 0 ? "+" : ""}${formatSize(
            Math.abs(summary.net_size_delta)
          )}`
        : "-",
    [summary]
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Compare exports</h1>
        <p className="text-sm text-muted-foreground">
          Diff two imports to see what was added, removed, or resized.
        </p>
      </div>

      {/* Selectors */}
      <div className="mb-6 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <ExportSelect
          label="From"
          value={a}
          onChange={setA}
          options={options}
          excludeId={b}
        />
        <button
          onClick={swap}
          disabled={a == null || b == null}
          className="mt-6 inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-input bg-background px-3 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-40 sm:mt-0"
          aria-label="Swap sides"
        >
          <ArrowRightLeft size={14} />
        </button>
        <ExportSelect
          label="To"
          value={b}
          onChange={setB}
          options={options}
          excludeId={a}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {!loading && !result && (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border py-20 text-center">
          <ArrowRightLeft size={36} className="text-muted-foreground/50" />
          <p className="text-muted-foreground">
            Pick two imports above to see a tree diff.
          </p>
        </div>
      )}

      {!loading && result && (
        <>
          {/* Summary row */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              icon={<Plus size={14} />}
              label="Added"
              value={result.summary.added}
              tone="added"
            />
            <SummaryCard
              icon={<Minus size={14} />}
              label="Removed"
              value={result.summary.removed}
              tone="removed"
            />
            <SummaryCard
              icon={<Scale size={14} />}
              label="Size changed"
              value={result.summary.size_changed}
              tone="changed"
            />
            <SummaryCard
              icon={<Scale size={14} />}
              label="Net size"
              value={netDelta}
              tone={result.summary.net_size_delta >= 0 ? "added" : "removed"}
            />
          </div>

          {/* Added */}
          <DiffSection
            title={`Added (${result.added.length})`}
            tone="added"
            defaultOpen={result.added.length > 0}
          >
            <DiffTable
              rows={result.added.slice(0, showAdded).map((r) => ({
                path: r.path,
                is_dir: r.is_dir,
                cells: [formatSize(r.size)],
              }))}
              headers={["Path", "Size"]}
              total={result.added.length}
              shown={showAdded}
              onShowMore={() => setShowAdded((n) => n + CHUNK)}
            />
          </DiffSection>

          {/* Removed */}
          <DiffSection
            title={`Removed (${result.removed.length})`}
            tone="removed"
            defaultOpen={result.removed.length > 0}
          >
            <DiffTable
              rows={result.removed.slice(0, showRemoved).map((r) => ({
                path: r.path,
                is_dir: r.is_dir,
                cells: [formatSize(r.size)],
              }))}
              headers={["Path", "Size"]}
              total={result.removed.length}
              shown={showRemoved}
              onShowMore={() => setShowRemoved((n) => n + CHUNK)}
            />
          </DiffSection>

          {/* Size changed */}
          <DiffSection
            title={`Size changed (${result.size_changed.length})`}
            tone="changed"
            defaultOpen={result.size_changed.length > 0 && result.added.length === 0}
          >
            <DiffTable
              rows={result.size_changed.slice(0, showChanged).map((r) => ({
                path: r.path,
                is_dir: false,
                cells: [
                  formatSize(r.size_a),
                  formatSize(r.size_b),
                  `${r.delta >= 0 ? "+" : ""}${formatSize(Math.abs(r.delta))}`,
                ],
              }))}
              headers={["Path", "From", "To", "Δ"]}
              total={result.size_changed.length}
              shown={showChanged}
              onShowMore={() => setShowChanged((n) => n + CHUNK)}
            />
          </DiffSection>

          <p className="mt-6 text-xs text-muted-foreground">
            Comparing&nbsp;
            <Link
              to={`/export/${result.a.id}`}
              className="font-medium text-primary hover:underline"
            >
              {result.a.filename}
            </Link>
            &nbsp;→&nbsp;
            <Link
              to={`/export/${result.b.id}`}
              className="font-medium text-primary hover:underline"
            >
              {result.b.filename}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

function ExportSelect({
  label,
  value,
  onChange,
  options,
  excludeId,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  options: ExportSummary[];
  excludeId: number | null;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">Select an export…</option>
        {options
          .filter((o) => o.id !== excludeId)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.filename}
              {o.company ? ` — ${o.company}` : ""}
            </option>
          ))}
      </select>
    </label>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "added" | "removed" | "changed";
}) {
  const toneCls =
    tone === "added"
      ? "text-green-600 dark:text-green-400"
      : tone === "removed"
      ? "text-red-600 dark:text-red-400"
      : "text-amber-600 dark:text-amber-400";
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <div
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-xs font-medium",
          toneCls
        )}
      >
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-lg font-bold text-card-foreground tabular-nums">
        {value}
      </span>
    </div>
  );
}

function DiffSection({
  title,
  tone,
  defaultOpen,
  children,
}: {
  title: string;
  tone: "added" | "removed" | "changed";
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const borderTone =
    tone === "added"
      ? "border-green-500/20"
      : tone === "removed"
      ? "border-red-500/20"
      : "border-amber-500/20";
  return (
    <section
      className={cn(
        "mb-4 overflow-hidden rounded-xl border bg-card",
        borderTone
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-foreground hover:bg-accent/50"
      >
        <span>{title}</span>
        <ChevronDown
          size={16}
          className={cn("transition-transform", !open && "-rotate-90")}
        />
      </button>
      {open && children}
    </section>
  );
}

function DiffTable({
  rows,
  headers,
  total,
  shown,
  onShowMore,
}: {
  rows: { path: string; is_dir: boolean; cells: string[] }[];
  headers: string[];
  total: number;
  shown: number;
  onShowMore: () => void;
}) {
  if (total === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-muted-foreground">
        Nothing to show.
      </div>
    );
  }
  return (
    <>
      <table className="min-w-full divide-y divide-border text-xs">
        <thead className="bg-muted/30 text-left uppercase tracking-wider text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border font-mono">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5">
                <span className="inline-flex items-center gap-1.5">
                  {r.is_dir ? (
                    <Folder size={12} className="text-muted-foreground" />
                  ) : (
                    <FileText size={12} className="text-muted-foreground" />
                  )}
                  <span className="truncate text-foreground">{r.path}</span>
                </span>
              </td>
              {r.cells.map((c, j) => (
                <td key={j} className="px-3 py-1.5 tabular-nums text-muted-foreground">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {shown < total && (
        <div className="flex justify-center border-t border-border bg-muted/20 py-2">
          <button
            onClick={onShowMore}
            className="text-xs font-medium text-primary hover:underline"
          >
            Show {Math.min(CHUNK, total - shown)} more ({total - shown} remaining)
          </button>
        </div>
      )}
    </>
  );
}
