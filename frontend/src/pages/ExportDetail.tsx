import { useState, useEffect, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Search,
  Trash2,
  Building2,
  FolderOpen,
  FileText,
  Calendar,
} from "lucide-react";
import { fetchExportDetail, deleteExport, type ExportDetail as ExportDetailType } from "@/lib/api";
import { formatDate } from "@/lib/utils";
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

export function ExportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ExportDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [treeFilter, setTreeFilter] = useState("");
  const [selectedExt, setSelectedExt] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchExportDetail(Number(id))
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    if (!data) return;
    if (!window.confirm(`Delete "${data.filename}"? This cannot be undone.`))
      return;
    try {
      await deleteExport(data.id);
      navigate("/");
    } catch {
      alert("Failed to delete export");
    }
  };

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

        <button
          onClick={handleDelete}
          className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>

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
