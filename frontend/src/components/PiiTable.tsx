import { useState, useMemo } from "react";
import {
  ArrowUpDown,
  Download,
  Search,
  ShieldAlert,
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

export function PiiTable({ signals, exportName }: PiiTableProps) {
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState("");

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
    const rows = [["severity", "category", "pattern", "score", "location"]];
    signals.forEach((s) => {
      rows.push([
        s.severity,
        s.category,
        s.pattern_label,
        String(s.score),
        s.location,
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
        <div className="flex gap-2">
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

      <div className="max-h-[400px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr>
              {(
                [
                  ["severity", "Severity"],
                  ["category", "Category"],
                  ["pattern_label", "Pattern"],
                  ["score", "Score"],
                ] as [SortField, string][]
              ).map(([field, label]) => (
                <th
                  key={field}
                  className="cursor-pointer px-4 py-2.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => toggleSort(field)}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <ArrowUpDown size={12} />
                  </span>
                </th>
              ))}
              <th className="px-4 py-2.5 font-medium text-muted-foreground">
                Location
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((signal, i) => (
              <tr
                key={i}
                className="transition-colors hover:bg-accent/50"
              >
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
                <td className="px-4 py-2.5 text-card-foreground">
                  {signal.category}
                </td>
                <td className="px-4 py-2.5 text-card-foreground">
                  {signal.pattern_label}
                </td>
                <td className="px-4 py-2.5 font-mono font-semibold text-card-foreground">
                  {signal.score}
                </td>
                <td className="max-w-[300px] truncate px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  {signal.location}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {filtered.length} of {signals.length} signals
      </div>
    </div>
  );
}
