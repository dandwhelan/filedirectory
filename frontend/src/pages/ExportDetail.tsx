import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Search,
  Trash2,
  Building2,
  FolderOpen,
  FileText,
  Calendar,
  RefreshCcw,
  Info,
  Download,
  ScanSearch,
} from "lucide-react";
import {
  fetchExportDetail,
  deleteExport,
  rescanOne,
  fetchScoreExplanation,
  downloadRedactedExport,
  fetchPiiPatterns,
  type ExportDetail as ExportDetailType,
  type PiiPattern,
  type ScoreExplanation,
} from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { StatsRow } from "@/components/StatsRow";
import {
  FileTypeChart,
  PiiCategoryChart,
  FileSizeByTypeChart,
  TopLargestFilesChart,
  DepthDistributionChart,
} from "@/components/Charts";
import { PiiTable } from "@/components/PiiTable";
import { LazyTreeView } from "@/components/TreeView";
import { FileListPanel } from "@/components/FileListPanel";
import { SearchPanel } from "@/components/SearchPanel";

const DEEP_SCAN_TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "xml", "yaml", "yml", "log", "ini", "conf",
]);
const DEEP_SCAN_MAX_TEXT_BYTES = 2 * 1024 * 1024;
const DEEP_SCAN_MAX_ZIP_BYTES = 50 * 1024 * 1024;
const DEEP_SCAN_MAX_ZIP_ENTRIES = 4000;

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractZipEntryNames(file: File): Promise<string[]> {
  return file.arrayBuffer().then((buf) => {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const names: string[] = [];
    for (let i = 0; i + 46 < view.byteLength && names.length < DEEP_SCAN_MAX_ZIP_ENTRIES; i += 1) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      const nameLen = view.getUint16(i + 28, true);
      const extraLen = view.getUint16(i + 30, true);
      const commentLen = view.getUint16(i + 32, true);
      const nameStart = i + 46;
      const nameEnd = nameStart + nameLen;
      if (nameEnd > bytes.length) continue;
      const name = new TextDecoder().decode(bytes.slice(nameStart, nameEnd));
      if (name) names.push(name.replace(/\\/g, "/"));
      i = nameEnd + extraLen + commentLen - 1;
    }
    return names;
  });
}

type LocalDeepScanResult = {
  signals: number;
  files_selected: number;
  text_scanned: number;
  text_skipped_ext: number;
  text_skipped_size: number;
  zip_scanned: number;
  zip_skipped_size: number;
  zip_entries_reviewed: number;
};

export function ExportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<ExportDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [treeFilter, setTreeFilter] = useState("");
  const [selectedExt, setSelectedExt] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [explanation, setExplanation] = useState<ScoreExplanation | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [deepScanRunning, setDeepScanRunning] = useState(false);
  const [deepScanResult, setDeepScanResult] = useState<LocalDeepScanResult | null>(null);
  const deepScanInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    if (!id) return;
    setLoading(true);
    fetchExportDetail(Number(id))
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleDelete = async () => {
    if (!data) return;
    if (
      !window.confirm(
        `Move "${data.filename}" to trash? You can restore it later from the trash page.`
      )
    )
      return;
    try {
      await deleteExport(data.id);
      navigate("/");
    } catch {
      alert("Failed to delete export");
    }
  };

  const handleRescan = async () => {
    if (!data) return;
    setRescanning(true);
    try {
      const r = await rescanOne(data.id);
      toast.success(
        `Rescanned: score ${r.pii_score} (${r.pii_band}), ${r.signal_count} signal${r.signal_count === 1 ? "" : "s"}`
      );
      // Pull fresh detail so charts/table reflect the new findings.
      reload();
      setExplanation(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rescan failed");
    } finally {
      setRescanning(false);
    }
  };

  const handleExplain = async () => {
    if (!data) return;
    setExplainOpen(true);
    if (explanation && explanation.export_id === data.id) return;
    try {
      const r = await fetchScoreExplanation(data.id);
      setExplanation(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to explain score");
    }
  };

  const handleRedact = async () => {
    if (!data) return;
    try {
      await downloadRedactedExport(data.id, data.filename);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Redaction failed");
    }
  };

  const patternMatchCount = useCallback((text: string, patterns: PiiPattern[]) => {
    const lower = text.toLowerCase();
    let hits = 0;
    for (const pattern of patterns) {
      if (!pattern.enabled) continue;
      const matched = pattern.keywords.some((kw) => {
        const escaped = escapeRegex(String(kw || "").trim().toLowerCase());
        if (!escaped) return false;
        return new RegExp(`\\b${escaped}\\b`, "i").test(lower);
      });
      if (matched) hits += 1;
    }
    return hits;
  }, []);

  const handleDeepScanPick = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setDeepScanRunning(true);
    try {
      const patterns = await fetchPiiPatterns();
      const result: LocalDeepScanResult = {
        signals: 0,
        files_selected: files.length,
        text_scanned: 0,
        text_skipped_ext: 0,
        text_skipped_size: 0,
        zip_scanned: 0,
        zip_skipped_size: 0,
        zip_entries_reviewed: 0,
      };

      for (const file of files) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".zip")) {
          if (file.size > DEEP_SCAN_MAX_ZIP_BYTES) {
            result.zip_skipped_size += 1;
            continue;
          }
          result.zip_scanned += 1;
          const names = await extractZipEntryNames(file);
          result.zip_entries_reviewed += names.length;
          for (const entryName of names.slice(0, DEEP_SCAN_MAX_ZIP_ENTRIES)) {
            result.signals += patternMatchCount(entryName, patterns);
          }
          continue;
        }

        const ext = lower.split(".").pop() || "";
        if (!DEEP_SCAN_TEXT_EXTENSIONS.has(ext)) {
          result.text_skipped_ext += 1;
          continue;
        }
        if (file.size > DEEP_SCAN_MAX_TEXT_BYTES) {
          result.text_skipped_size += 1;
          continue;
        }
        result.text_scanned += 1;
        const text = await file.text();
        result.signals += patternMatchCount(text, patterns);
      }

      setDeepScanResult(result);
      if (result.signals === 0) {
        toast.success(
          `Deep scan complete: no keyword hits across ${result.files_selected} selected file(s).`
        );
      } else {
        toast.success(
          `Deep scan complete: ${result.signals} signal(s), ${result.zip_entries_reviewed} zip entries reviewed.`
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deep scan failed");
    } finally {
      e.target.value = "";
      setDeepScanRunning(false);
    }
  }, [patternMatchCount, toast]);

  const handleExtClick = useCallback((ext: string) => {
    // Strip the leading dot if present (e.g. ".pdf" -> "pdf")
    const cleaned = ext.replace(/^\./, "");
    setSelectedExt(cleaned);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 text-center sm:px-6">
        <p className="text-lg text-destructive">{error || "Export not found"}</p>
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft size={14} /> Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Back + title */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} /> Back to exports
          </Link>
          <h1 className="text-2xl font-bold text-foreground" title={data.filename}>
            {data.filename}
          </h1>

          {/* Metadata */}
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {data.company && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 size={14} /> {data.company}
              </span>
            )}
            {data.folder && (
              <span className="inline-flex items-center gap-1.5">
                <FolderOpen size={14} /> {data.folder}
              </span>
            )}
            {data.description && (
              <span className="inline-flex items-center gap-1.5">
                <FileText size={14} /> {data.description}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Calendar size={14} /> Imported {formatDate(data.imported_at)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRescan}
            disabled={rescanning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            title="Recompute PII findings using the current pattern set"
          >
            <RefreshCcw size={14} className={rescanning ? "animate-spin" : ""} />
            Rescan PII
          </button>
          <button
            onClick={() => deepScanInputRef.current?.click()}
            disabled={deepScanRunning}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            title="Run local deep scan against a folder on this device"
          >
            <ScanSearch size={14} className={deepScanRunning ? "animate-pulse" : ""} />
            {deepScanRunning ? "Scanning..." : "Run Deep Scan"}
          </button>
          <button
            onClick={handleExplain}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            title="Show how this score was computed"
          >
            <Info size={14} /> Explain score
          </button>
          <button
            onClick={handleRedact}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            title="Download a copy with PII-flagged file names masked"
          >
            <Download size={14} /> Redact
          </button>
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 size={14} /> Move to trash
          </button>
        </div>
      </div>
      <input
        ref={deepScanInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleDeepScanPick}
        {...({ webkitdirectory: "true", directory: "" } as Record<string, string>)}
      />

      {/* Stats */}
      <div className="mb-6">
        <StatsRow
          fileCount={data.file_count}
          dirCount={data.dir_count}
          totalSize={data.total_size}
          piiScore={data.pii_score}
          piiBand={data.pii_band}
          totalNodes={data.file_count + data.dir_count}
        />
      </div>

      {data.deep_scan_debug?.enabled && (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Deep scan debug</p>
          <p>
            Signals: {data.deep_scan_debug.deep_signals} • ZIP entries reviewed:{" "}
            {data.deep_scan_debug.zip_entries_reviewed}
          </p>
          <p>
            Text scanned: {data.deep_scan_debug.text_files_scanned} • skipped (ext/size):{" "}
            {data.deep_scan_debug.text_files_skipped_extension}/
            {data.deep_scan_debug.text_files_skipped_size}
          </p>
          <p>
            ZIP scanned/skipped(size): {data.deep_scan_debug.zip_files_scanned}/
            {data.deep_scan_debug.zip_files_skipped_size}
          </p>
        </div>
      )}

      {deepScanResult && (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Ad-hoc local deep scan (this device)</p>
          <p>Signals: {deepScanResult.signals}</p>
          <p>Selected files: {deepScanResult.files_selected}</p>
          <p>Text scanned: {deepScanResult.text_scanned} • skipped (ext/size): {deepScanResult.text_skipped_ext}/{deepScanResult.text_skipped_size}</p>
          <p>ZIP scanned/skipped(size): {deepScanResult.zip_scanned}/{deepScanResult.zip_skipped_size}</p>
          <p>ZIP entries reviewed: {deepScanResult.zip_entries_reviewed}</p>
          {deepScanResult.signals === 0 && (
            <p className="mt-1">
              No keyword matches were found. Deep scan checks supported text files plus ZIP entry names only; edit
              pattern keywords in Settings if you need broader detection.
            </p>
          )}
        </div>
      )}

      {explainOpen && (
        <ScoreExplanationPanel
          loading={!explanation || explanation.export_id !== data.id}
          explanation={explanation}
          onClose={() => setExplainOpen(false)}
        />
      )}

      {data.pii_signals_truncated && (
        <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          Showing top {data.pii_signals.length} of {data.pii_signal_total} PII
          signals (sorted by score). Lower-scoring matches are omitted from
          the table for performance.
        </div>
      )}

      {/* File Search */}
      <div className="mb-6">
        <h3 className="mb-3 text-lg font-semibold text-foreground">
          Search Files
        </h3>
        <SearchPanel exportId={data.id} />
      </div>

      {/* Charts — Row 1 */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-card-foreground">
            File Type Distribution
          </h3>
          <FileTypeChart data={data.file_type_counts} onSegmentClick={handleExtClick} />
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-card-foreground">
            Storage by File Type
          </h3>
          <FileSizeByTypeChart data={data.file_size_by_type} onBarClick={handleExtClick} />
        </div>
      </div>

      {/* File list panel — shown when a chart segment/bar is clicked */}
      {selectedExt && (
        <div className="mb-4">
          <FileListPanel
            exportId={data.id}
            extension={selectedExt}
            onClose={() => setSelectedExt(null)}
          />
        </div>
      )}

      {/* Charts — Row 2 */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-card-foreground">
            Top Largest Files
          </h3>
          <TopLargestFilesChart data={data.top_largest_files} />
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-card-foreground">
            Tree Depth Distribution
          </h3>
          <DepthDistributionChart data={data.depth_distribution} />
        </div>
      </div>

      {/* Charts — Row 3 */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-card-foreground">
            PII Categories by Weighted Score
          </h3>
          <PiiCategoryChart signals={data.pii_signals} />
        </div>
      </div>

      {/* PII Table */}
      <div className="mb-6">
        <h3 className="mb-3 text-lg font-semibold text-foreground">
          PII Signals ({data.pii_signals.length})
        </h3>
        <PiiTable signals={data.pii_signals} exportName={data.filename} />
      </div>

      {/* Tree View */}
      <div className="mb-6">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-foreground">
            File Tree
          </h3>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Filter tree by name/path..."
              value={treeFilter}
              onChange={(e) => setTreeFilter(e.target.value)}
              className="h-8 w-64 rounded-lg border border-input bg-background pl-8 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <LazyTreeView exportId={data.id} filter={treeFilter} />
      </div>
    </div>
  );
}

function ScoreExplanationPanel({
  loading,
  explanation,
  onClose,
}: {
  loading: boolean;
  explanation: ScoreExplanation | null;
  onClose: () => void;
}) {
  return (
    <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          How this score was computed
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      {loading || !explanation ? (
        <div className="py-4 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <Component
              label="Intensity"
              value={explanation.components.intensity}
              hint={`raw_total (${explanation.raw_total}) ÷ relevant_nodes (${explanation.relevant_node_count}) × 8`}
            />
            <Component
              label="Breadth"
              value={explanation.components.breadth}
              hint={`${explanation.category_count} categor${explanation.category_count === 1 ? "y" : "ies"} × 4`}
            />
            <Component
              label="Density bonus"
              value={explanation.components.density_bonus}
              hint={`${explanation.signal_count} signal${explanation.signal_count === 1 ? "" : "s"} ÷ ${explanation.relevant_node_count} nodes (capped at 20)`}
            />
          </div>
          <div className="rounded-lg bg-background/60 px-3 py-2 text-xs">
            <div className="font-mono text-muted-foreground">
              {explanation.formula}
            </div>
            <div className="mt-1 text-foreground">
              Final: <span className="font-semibold">{explanation.score}</span>{" "}
              ({explanation.band}) — stored:{" "}
              {explanation.stored_score} ({explanation.stored_band})
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                By severity
              </div>
              <div className="flex gap-2 text-xs">
                <Pill label="High" value={explanation.by_severity.high} />
                <Pill label="Medium" value={explanation.by_severity.medium} />
                <Pill label="Low" value={explanation.by_severity.low} />
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Top categories
              </div>
              <ul className="space-y-1 text-xs">
                {explanation.by_category.slice(0, 5).map((c) => (
                  <li key={c.category} className="flex justify-between">
                    <span className="text-foreground">{c.category}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {c.count} hit{c.count === 1 ? "" : "s"} · raw {c.raw_score}
                    </span>
                  </li>
                ))}
                {explanation.by_category.length === 0 && (
                  <li className="italic text-muted-foreground">No matches</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Component({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
      {label}: <span className="tabular-nums">{value}</span>
    </span>
  );
}
