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
  file_type_counts: FileTypeCount[];
  file_size_by_type: FileTypeCount[];
  top_largest_files: LargestFile[];
  depth_distribution: DepthCount[];
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
