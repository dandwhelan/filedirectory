import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  RefreshCcw,
  Trash2,
  RotateCcw,
  Edit3,
  Save,
  X,
  Check,
  ShieldAlert,
} from "lucide-react";
import {
  createPiiPattern,
  checkForUpdates,
  applyUpdates,
  deletePiiPattern,
  fetchPiiPatterns,
  rescanAll,
  resetPiiPatterns,
  togglePiiPattern,
  updatePiiPattern,
  type PiiPattern,
  type PiiPatternInput,
  type UpdateCheck,
} from "@/lib/api";
import { cn, severityBg } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

type Draft = PiiPatternInput & { id?: number };

const EMPTY_DRAFT: Draft = {
  label: "",
  category: "",
  severity: "medium",
  score: 20,
  keywords: [],
};

export function Settings() {
  const toast = useToast();
  const [patterns, setPatterns] = useState<PiiPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [rescanning, setRescanning] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheck | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPiiPatterns();
      setPatterns(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load patterns");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const by: Record<string, PiiPattern[]> = {};
    for (const p of patterns) {
      (by[p.category] ||= []).push(p);
    }
    return Object.entries(by).sort(([a], [b]) => a.localeCompare(b));
  }, [patterns]);

  const startEdit = (p: PiiPattern) => {
    setEditing(p.id);
    setDraft({
      id: p.id,
      label: p.label,
      category: p.category,
      severity: p.severity,
      score: p.score,
      keywords: [...p.keywords],
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
  };

  const saveEdit = async () => {
    if (editing == null) return;
    try {
      await updatePiiPattern(editing, {
        label: draft.label,
        category: draft.category,
        severity: draft.severity,
        score: draft.score,
        keywords: draft.keywords,
      });
      toast.success("Pattern saved");
      cancelEdit();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const onToggle = async (p: PiiPattern) => {
    try {
      await togglePiiPattern(p.id, !p.enabled);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Toggle failed");
    }
  };

  const onDelete = async (p: PiiPattern) => {
    const label = p.is_builtin ? `builtin "${p.label}"` : `"${p.label}"`;
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      await deletePiiPattern(p.id);
      toast.success("Pattern deleted");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const onReset = async () => {
    if (
      !window.confirm(
        "Reset all patterns to builtin defaults? Custom patterns will be lost."
      )
    )
      return;
    try {
      await resetPiiPatterns();
      toast.success("Patterns reset to defaults");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    }
  };

  const onRescan = async () => {
    setRescanning(true);
    try {
      const r = await rescanAll();
      toast.success(`Rescanned ${r.rescanned}/${r.total} exports`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rescan failed");
    } finally {
      setRescanning(false);
    }
  };

  const onCreate = async () => {
    try {
      await createPiiPattern({
        label: newDraft.label,
        category: newDraft.category,
        severity: newDraft.severity,
        score: newDraft.score,
        keywords: newDraft.keywords,
      });
      toast.success("Pattern created");
      setCreating(false);
      setNewDraft(EMPTY_DRAFT);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const data = await checkForUpdates();
      setUpdateInfo(data);
      if (data.can_update) {
        toast.success(`Update available: ${data.behind_by} commit(s) behind origin/${data.branch}.`);
      } else {
        toast.success("Already up to date.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update check failed");
    } finally {
      setCheckingUpdates(false);
    }
  };

  const onApplyUpdate = async () => {
    setApplyingUpdate(true);
    try {
      const data = await applyUpdates();
      toast.success(data.message || "Update applied. Restart app.");
      await onCheckUpdates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setApplyingUpdate(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">PII detection settings</h1>
          <p className="text-sm text-muted-foreground">
            Edit keyword patterns, severities, and weights. Changes take effect
            for new imports immediately; use "Rescan all" to apply to existing
            imports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRescan}
            disabled={rescanning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            <RefreshCcw size={14} className={rescanning ? "animate-spin" : ""} />
            Rescan all
          </button>
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            <RotateCcw size={14} />
            Reset to defaults
          </button>
          <button
            onClick={() => {
              setCreating(true);
              setNewDraft(EMPTY_DRAFT);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus size={14} />
            New pattern
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold text-foreground">App updates</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Check GitHub for newer commits and pull the latest changes without manually copying files.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onCheckUpdates}
            disabled={checkingUpdates}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            <RefreshCcw size={14} className={checkingUpdates ? "animate-spin" : ""} />
            Check updates
          </button>
          <button
            onClick={onApplyUpdate}
            disabled={applyingUpdate || !updateInfo?.can_update}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Check size={14} />
            Update now
          </button>
        </div>
        {updateInfo && (
          <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p>Branch: <span className="font-medium text-foreground">{updateInfo.branch}</span></p>
            <p>Current: <code>{updateInfo.current_commit.slice(0, 12)}</code></p>
            <p>Latest: <code>{updateInfo.latest_commit.slice(0, 12)}</code></p>
            <p>Ahead/Behind: {updateInfo.ahead_by}/{updateInfo.behind_by}</p>
            <p className="mt-1">
              {updateInfo.can_update
                ? "Update available. Click \"Update now\" then restart app.py."
                : "You are up to date."}
            </p>
          </div>
        )}
      </div>

      {creating && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            New pattern
          </h2>
          <PatternEditor draft={newDraft} onChange={setNewDraft} />
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setCreating(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
            >
              <X size={14} /> Cancel
            </button>
            <button
              onClick={onCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Save size={14} /> Create
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-border py-16 text-center">
          <ShieldAlert size={40} className="text-muted-foreground/50" />
          <p className="text-muted-foreground">No patterns configured.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </h2>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Label</th>
                      <th className="px-3 py-2">Severity</th>
                      <th className="px-3 py-2">Score</th>
                      <th className="px-3 py-2">Keywords</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((p) =>
                      editing === p.id ? (
                        <tr key={p.id} className="bg-muted/20">
                          <td colSpan={6} className="px-3 py-3">
                            <PatternEditor draft={draft} onChange={setDraft} />
                            <div className="mt-3 flex justify-end gap-2">
                              <button
                                onClick={cancelEdit}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs hover:bg-accent"
                              >
                                <X size={12} /> Cancel
                              </button>
                              <button
                                onClick={saveEdit}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                              >
                                <Save size={12} /> Save
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={p.id} className={cn(!p.enabled && "opacity-50")}>
                          <td className="px-3 py-2 font-medium text-foreground">
                            {p.label}
                            {p.is_builtin && (
                              <span className="ml-2 inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                builtin
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                                severityBg(p.severity)
                              )}
                            >
                              {p.severity}
                            </span>
                          </td>
                          <td className="px-3 py-2 tabular-nums text-foreground">
                            {p.score}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <div className="flex max-w-md flex-wrap gap-1">
                              {p.keywords.slice(0, 6).map((kw) => (
                                <span
                                  key={kw}
                                  className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
                                >
                                  {kw}
                                </span>
                              ))}
                              {p.keywords.length > 6 && (
                                <span className="text-[11px]">
                                  +{p.keywords.length - 6}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => onToggle(p)}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                p.enabled
                                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {p.enabled ? (
                                <>
                                  <Check size={10} /> Enabled
                                </>
                              ) : (
                                "Disabled"
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => startEdit(p)}
                              className="mr-1 inline-flex rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label="Edit"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              onClick={() => onDelete(p)}
                              className="inline-flex rounded-md p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                              aria-label="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PatternEditor({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
}) {
  const [kwInput, setKwInput] = useState("");

  const addKeyword = () => {
    const s = kwInput.trim();
    if (!s) return;
    if (draft.keywords.includes(s)) {
      setKwInput("");
      return;
    }
    onChange({ ...draft, keywords: [...draft.keywords, s] });
    setKwInput("");
  };

  const removeKeyword = (kw: string) => {
    onChange({ ...draft, keywords: draft.keywords.filter((k) => k !== kw) });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-muted-foreground">Label</span>
        <input
          value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="e.g. Contract or agreement"
        />
      </label>
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-muted-foreground">Category</span>
        <input
          value={draft.category}
          onChange={(e) => onChange({ ...draft, category: e.target.value })}
          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="e.g. Legal agreements"
        />
      </label>
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-muted-foreground">Severity</span>
        <select
          value={draft.severity}
          onChange={(e) =>
            onChange({
              ...draft,
              severity: e.target.value as "high" | "medium" | "low",
            })
          }
          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-muted-foreground">
          Score (0–100)
        </span>
        <input
          type="number"
          min={0}
          max={100}
          value={draft.score}
          onChange={(e) =>
            onChange({ ...draft, score: Number(e.target.value) || 0 })
          }
          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <div className="sm:col-span-2">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">
          Keywords
        </span>
        <div className="mb-2 flex flex-wrap gap-1">
          {draft.keywords.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground"
            >
              {kw}
              <button
                onClick={() => removeKeyword(kw)}
                className="opacity-60 hover:opacity-100"
                aria-label={`Remove ${kw}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {draft.keywords.length === 0 && (
            <span className="text-xs italic text-muted-foreground">
              No keywords yet
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addKeyword();
              }
            }}
            placeholder="Type a keyword, press Enter"
            className="h-9 flex-1 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={addKeyword}
            className="inline-flex items-center gap-1 rounded-lg border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
