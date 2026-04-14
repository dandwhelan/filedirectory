import { useState, useMemo, useRef, useEffect } from "react";
import {
  ArrowUpDown,
  Download,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import type { PiiSignal } from "@/lib/api";
import { severityBg, cn } from "@/lib/utils";

interface PiiTableProps {
  signals: PiiSignal[];
  exportName: string;
}

type SortField = "severity" | "category" | "score" | "pattern_label";
type SortDir = "asc" | "desc";

const severityOrder: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

type ColumnKey = "severity" | "category" | "pattern" | "score" | "folder" | "fileName";

const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "severity", label: "Severity" },
  { key: "category", label: "Category" },
  { key: "pattern", label: "Pattern" },
  { key: "score", label: "Score" },
  { key: "folder", label: "Folder" },
  { key: "fileName", label: "File Name" },
];

const DEFAULT_VISIBLE: Record<ColumnKey, boolean> = {
  severity: true,
  category: true,
  pattern: true,
  score: true,
  folder: true,
  fileName: true,
};

function splitLocation(location: string): { folder: string; fileName: string } {
  const lastSlash = location.lastIndexOf("/");
  if (lastSlash === -1) return { folder: "", fileName: location };
  return {
    folder: location.slice(0, lastSlash + 1),
    fileName: location.slice(lastSlash + 1),
  };
}

export function PiiTable({ signals, exportName }: PiiTableProps) {
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("");
  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>(DEFAULT_VISIBLE);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);

  // Close column dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) {
        setColumnsOpen(false);
      }
    }
    if (columnsOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [columnsOpen]);

  const toggleColumn = (key: ColumnKey) => {
    setColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const filtered = useMemo(() => {
    if (!filter) return signals;
    const q = filter.toLowerCase();
    return signals.filter(
      (s) =>
        s.pattern_label.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.location.toLowerCase().includes(q) ||
        s.severity.toLowerCase().includes(q)
    );
  }, [signals, filter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "severity") {
        cmp =
          (severityOrder[a.severity] || 0) - (severityOrder[b.severity] || 0);
      } else if (sortField === "score") {
        cmp = a.score - b.score;
      } else {
        cmp = (a[sortField] || "").localeCompare(b[sortField] || "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(signals, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName}-pii-signals.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const rows = [["severity", "category", "pattern", "score", "folder", "file_name"]];
    signals.forEach((s) => {
      const { folder, fileName } = splitLocation(s.location);
      rows.push([
        s.severity,
        s.category,
        s.pattern_label,
        String(s.score),
        folder,
        fileName,
      ]);
    });
    const csv = rows
      .map((r) =>
        r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName}-pii-signals.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (signals.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-8 text-center">
        <ShieldAlert size={32} className="text-green-500" />
        <p className="font-medium text-card-foreground">
          No PII indicators detected
        </p>
        <p className="text-sm text-muted-foreground">
          No suspicious patterns were found in file names or paths.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Filter signals..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 rounded-lg border border-input bg-background pl-8 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Column toggle */}
          <div className="relative" ref={columnsRef}>
            <button
              onClick={() => setColumnsOpen((o) => !o)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                columnsOpen
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input bg-secondary text-secondary-foreground hover:bg-secondary/80"
              )}
            >
              <SlidersHorizontal size={13} /> Columns
            </button>
            {columnsOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-border bg-card p-2 shadow-lg">
                {ALL_COLUMNS.map((col) => (
                  <label
                    key={col.key}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-card-foreground transition-colors hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={columns[col.key]}
                      onChange={() => toggleColumn(col.key)}
                      className="rounded"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={exportJson}
            className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <Download size={13} /> JSON
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="max-h-[400px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr>
              {columns.severity && (
                <th
                  className="cursor-pointer px-4 py-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSort("severity")}
                >
                  <span className="inline-flex items-center gap-1">
                    Severity <ArrowUpDown size={12} />
                  </span>
                </th>
              )}
              {columns.category && (
                <th
                  className="cursor-pointer px-4 py-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSort("category")}
                >
                  <span className="inline-flex items-center gap-1">
                    Category <ArrowUpDown size={12} />
                  </span>
                </th>
              )}
              {columns.pattern && (
                <th
                  className="cursor-pointer px-4 py-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSort("pattern_label")}
                >
                  <span className="inline-flex items-center gap-1">
                    Pattern <ArrowUpDown size={12} />
                  </span>
                </th>
              )}
              {columns.score && (
                <th
                  className="cursor-pointer px-4 py-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSort("score")}
                >
                  <span className="inline-flex items-center gap-1">
                    Score <ArrowUpDown size={12} />
                  </span>
                </th>
              )}
              {columns.folder && (
                <th className="px-4 py-2.5 font-medium text-muted-foreground">
                  Folder
                </th>
              )}
              {columns.fileName && (
                <th className="px-4 py-2.5 font-medium text-muted-foreground">
                  File Name
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((signal, i) => {
              const { folder, fileName } = splitLocation(signal.location);
              return (
                <tr
                  key={i}
                  className="transition-colors hover:bg-accent/50"
                >
                  {columns.severity && (
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize",
                          severityBg(signal.severity)
                        )}
                      >
                        {signal.severity}
                      </span>
                    </td>
                  )}
                  {columns.category && (
                    <td className="px-4 py-2.5 text-card-foreground">
                      {signal.category}
                    </td>
                  )}
                  {columns.pattern && (
                    <td className="px-4 py-2.5 text-card-foreground">
                      {signal.pattern_label}
                    </td>
                  )}
                  {columns.score && (
                    <td className="px-4 py-2.5 font-mono font-semibold text-card-foreground">
                      {signal.score}
                    </td>
                  )}
                  {columns.folder && (
                    <td className="max-w-[250px] truncate px-4 py-2.5 font-mono text-xs text-muted-foreground" title={folder}>
                      {folder || "-"}
                    </td>
                  )}
                  {columns.fileName && (
                    <td className="max-w-[250px] truncate px-4 py-2.5 font-mono text-xs text-card-foreground" title={fileName}>
                      {fileName}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {filtered.length} of {signals.length} signals
      </div>
    </div>
  );
}
