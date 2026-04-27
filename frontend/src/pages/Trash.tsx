import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RotateCcw, Trash2, ShieldAlert } from "lucide-react";
import {
  fetchTrash,
  purgeExport,
  restoreExport,
  type TrashEntry,
} from "@/lib/api";
import { formatDate, formatSize, bandColor, cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

export function Trash() {
  const toast = useToast();
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await fetchTrash());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load trash");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRestore = async (e: TrashEntry) => {
    setBusyId(e.id);
    try {
      await restoreExport(e.id);
      toast.success(`Restored ${e.filename}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (e: TrashEntry) => {
    if (
      !window.confirm(
        `Permanently delete "${e.filename}"? This removes the JSON file from data/ and cannot be undone.`
      )
    )
      return;
    setBusyId(e.id);
    try {
      await purgeExport(e.id);
      toast.success(`Purged ${e.filename}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Purge failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link
          to="/"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} /> Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Trash</h1>
        <p className="text-sm text-muted-foreground">
          Soft-deleted exports. Restore to make them visible again, or purge
          to remove them permanently from the database and disk.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-border py-16 text-center">
          <ShieldAlert size={40} className="text-muted-foreground/50" />
          <p className="text-muted-foreground">Trash is empty.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Filename</th>
                <th className="px-3 py-2">Files</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">PII</th>
                <th className="px-3 py-2">Deleted</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {e.filename}
                    {e.company && (
                      <div className="text-xs text-muted-foreground">
                        {e.company}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-foreground">
                    {e.file_count}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {formatSize(e.total_size)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        bandColor(e.pii_band)
                      )}
                    >
                      {e.pii_band} · {e.pii_score}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDate(e.deleted_at)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleRestore(e)}
                      disabled={busyId === e.id}
                      className="mr-1 inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                    >
                      <RotateCcw size={12} /> Restore
                    </button>
                    <button
                      onClick={() => handlePurge(e)}
                      disabled={busyId === e.id}
                      className="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      <Trash2 size={12} /> Purge
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
