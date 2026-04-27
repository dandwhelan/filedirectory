export interface ExportSummary {
  id: number;
  filename: string;
  company: string;
  folder: string;
  description: string;
  imported_at: string;
  updated_at: string;
  file_count: number;
  dir_count: number;
  total_size: number;
  pii_score: number;
  pii_band: string;
}

export interface LazyTreeNode {
  id: number;
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  has_children: boolean;
  children?: LazyTreeNode[];
  loaded?: boolean;
}

export interface PiiSignal {
  pattern_label: string;
  category: string;
  severity: string;
  score: number;
  location: string;
}

export interface FileTypeCount {
  name: string;
  value: number;
}

export interface LargestFile {
  name: string;
  path: string;
  size: number;
}

export interface DepthCount {
  depth: number;
  count: number;
}

export interface ExportDetail extends ExportSummary {
  pii_signals: PiiSignal[];
  pii_signal_total: number;
  pii_signals_truncated: boolean;
  file_type_counts: FileTypeCount[];
  file_size_by_type: FileTypeCount[];
  top_largest_files: LargestFile[];
  depth_distribution: DepthCount[];
  deep_scan_debug?: {
    enabled: boolean;
    text_files_scanned: number;
    text_files_skipped_size: number;
    text_files_skipped_extension: number;
    zip_files_scanned: number;
    zip_files_skipped_size: number;
    zip_entries_reviewed: number;
    deep_signals: number;
  };
}

export interface TrashEntry extends ExportSummary {
  deleted_at: string;
}

export interface ScoreExplanation {
  export_id: number;
  filename: string;
  score: number;
  band: string;
  stored_score: number;
  stored_band: string;
  signal_count: number;
  relevant_node_count: number;
  components: {
    intensity: number;
    breadth: number;
    density_bonus: number;
  };
  raw_total: number;
  category_count: number;
  by_category: { category: string; count: number; raw_score: number }[];
  by_severity: { high: number; medium: number; low: number };
  formula: string;
}

export interface PaginatedExports {
  exports: ExportSummary[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface ImportResult {
  message?: string;
  id?: number;
  name: string;
  overwritten?: boolean;
  error?: string;
  code?: string;
}

export interface OverviewStats {
  export_count: number;
  total_files: number;
  total_dirs: number;
  total_size: number;
  avg_pii_score: number;
  pii_band_distribution: Record<string, number>;
  top_file_types: FileTypeCount[];
}

export interface FileByType {
  name: string;
  path: string;
  size: number;
}

export interface SearchResult {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  count: number;
}

export interface GlobalSearchResult extends SearchResult {
  export_id: number;
  export_filename: string;
}

export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
  count: number;
}

export interface FilesByTypeResult {
  extension: string;
  files: FileByType[];
  count: number;
}

const API_BASE = "/api";

export async function fetchExports(params?: {
  page?: number;
  per_page?: number;
  search?: string;
  sort?: string;
  order?: string;
}): Promise<PaginatedExports> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.per_page) qs.set("per_page", String(params.per_page));
  if (params?.search) qs.set("search", params.search);
  if (params?.sort) qs.set("sort", params.sort);
  if (params?.order) qs.set("order", params.order);
  const res = await fetch(`${API_BASE}/exports?${qs}`);
  if (!res.ok) throw new Error("Failed to load exports");
  return res.json();
}

export async function fetchExportDetail(id: number): Promise<ExportDetail> {
  const res = await fetch(`${API_BASE}/export/${id}`);
  if (!res.ok) throw new Error("Failed to load export");
  return res.json();
}

export interface TreeChildrenResult {
  children: LazyTreeNode[];
  total_count: number;
  has_more: boolean;
}

export async function fetchTreeChildren(
  exportId: number,
  parentId?: number,
  offset: number = 0,
  limit: number = 100
): Promise<TreeChildrenResult> {
  const qs = new URLSearchParams();
  if (parentId != null) qs.set("parent_id", String(parentId));
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  const res = await fetch(`${API_BASE}/export/${exportId}/children?${qs}`);
  if (!res.ok) throw new Error("Failed to load tree nodes");
  return res.json();
}

export async function importExport(
  filename: string,
  content: string,
  overwrite: boolean = false
): Promise<{ status: number; data: ImportResult }> {
  const res = await fetch(`${API_BASE}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content, overwrite }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

export async function deleteExport(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/export/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete export");
}

export async function fetchOverview(): Promise<OverviewStats> {
  const res = await fetch(`${API_BASE}/overview`);
  if (!res.ok) throw new Error("Failed to load overview");
  return res.json();
}

export async function searchExport(
  exportId: number,
  query: string
): Promise<SearchResponse> {
  const res = await fetch(
    `${API_BASE}/export/${exportId}/search?q=${encodeURIComponent(query)}`
  );
  if (!res.ok) throw new Error("Failed to search");
  return res.json();
}

export async function searchGlobal(
  query: string,
  limit: number = 100,
  signal?: AbortSignal
): Promise<GlobalSearchResponse> {
  const qs = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${API_BASE}/search?${qs}`, { signal });
  if (!res.ok) throw new Error("Failed to search across imports");
  return res.json();
}

export async function fetchFilesByType(
  exportId: number,
  ext: string
): Promise<FilesByTypeResult> {
  const res = await fetch(
    `${API_BASE}/export/${exportId}/files-by-type?ext=${encodeURIComponent(ext)}`
  );
  if (!res.ok) throw new Error("Failed to load files");
  return res.json();
}

// --- PII patterns ---

export interface PiiPattern {
  id: number;
  label: string;
  category: string;
  severity: "high" | "medium" | "low";
  score: number;
  keywords: string[];
  enabled: boolean;
  is_builtin: boolean;
  updated_at?: string;
}

export interface PiiPatternInput {
  label: string;
  category: string;
  severity: "high" | "medium" | "low";
  score: number;
  keywords: string[];
  enabled?: boolean;
}

export async function fetchPiiPatterns(): Promise<PiiPattern[]> {
  const res = await fetch(`${API_BASE}/pii-patterns`);
  if (!res.ok) throw new Error("Failed to load PII patterns");
  const data = await res.json();
  return data.patterns;
}

export async function createPiiPattern(input: PiiPatternInput): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/pii-patterns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to create pattern");
  return res.json();
}

export async function updatePiiPattern(id: number, input: PiiPatternInput): Promise<void> {
  const res = await fetch(`${API_BASE}/pii-patterns/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to update pattern");
}

export async function togglePiiPattern(id: number, enabled: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/pii-patterns/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to toggle pattern");
}

export async function deletePiiPattern(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/pii-patterns/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to delete pattern");
}

export async function resetPiiPatterns(): Promise<void> {
  const res = await fetch(`${API_BASE}/pii-patterns/reset`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to reset patterns");
}

export async function rescanAll(): Promise<{ rescanned: number; total: number }> {
  const res = await fetch(`${API_BASE}/pii-rescan`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to rescan");
  return res.json();
}

export async function rescanOne(
  exportId: number
): Promise<{ id: number; pii_score: number; pii_band: string; signal_count: number }> {
  const res = await fetch(`${API_BASE}/pii-rescan/${exportId}`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to rescan export");
  return res.json();
}

// --- Self update ---
export interface UpdateCheck {
  supported?: boolean;
  branch: string;
  current_commit: string;
  latest_commit: string;
  ahead_by: number;
  behind_by: number;
  can_update: boolean;
  error?: string;
  details?: string;
}

export async function checkForUpdates(): Promise<UpdateCheck> {
  const res = await fetch(`${API_BASE}/updates/check`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.details || "Failed to check updates");
  return data;
}

export interface ApplyUpdateResult {
  message: string;
  branch: string;
  current_commit: string;
  output?: string;
}

export async function applyUpdates(): Promise<ApplyUpdateResult> {
  const res = await fetch(`${API_BASE}/updates/apply`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    const message = data.error
      ? data.details
        ? `${data.error} ${data.details}`
        : data.error
      : data.details || "Failed to apply update";
    throw new Error(message);
  }
  return data;
}

// --- Diff ---

export interface DiffItem {
  path: string;
  size: number;
  is_dir: boolean;
}

export interface DiffSizeChange {
  path: string;
  size_a: number;
  size_b: number;
  delta: number;
}

export interface DiffResult {
  a: { id: number; filename: string; total_size: number; file_count: number; dir_count: number; pii_score: number };
  b: { id: number; filename: string; total_size: number; file_count: number; dir_count: number; pii_score: number };
  added: DiffItem[];
  removed: DiffItem[];
  size_changed: DiffSizeChange[];
  summary: {
    added: number;
    removed: number;
    size_changed: number;
    net_size_delta: number;
  };
}

export async function fetchDiff(a: number, b: number): Promise<DiffResult> {
  const res = await fetch(`${API_BASE}/diff?a=${a}&b=${b}`);
  if (!res.ok) throw new Error((await res.json()).error || "Failed to compute diff");
  return res.json();
}

// --- Trash / soft delete ---

export async function fetchTrash(): Promise<TrashEntry[]> {
  const res = await fetch(`${API_BASE}/trash`);
  if (!res.ok) throw new Error("Failed to load trash");
  const data = await res.json();
  return data.trash;
}

export async function restoreExport(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/export/${id}/restore`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to restore");
}

export async function purgeExport(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/export/${id}/purge`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to purge");
}

// --- Score explanation ---

export async function fetchScoreExplanation(id: number): Promise<ScoreExplanation> {
  const res = await fetch(`${API_BASE}/export/${id}/explain`);
  if (!res.ok) throw new Error((await res.json()).error || "Failed to load explanation");
  return res.json();
}

// --- Redaction export ---

export function redactionExportUrl(id: number): string {
  return `${API_BASE}/export/${id}/redact`;
}

export async function downloadRedactedExport(id: number, filename: string): Promise<void> {
  const res = await fetch(redactionExportUrl(id));
  if (!res.ok) throw new Error("Failed to generate redacted export");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `redacted_${filename}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
