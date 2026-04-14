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

export interface ExportDetail extends ExportSummary {
  pii_signals: PiiSignal[];
  file_type_counts: FileTypeCount[];
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

export async function fetchTreeChildren(
  exportId: number,
  parentId?: number
): Promise<LazyTreeNode[]> {
  const qs = parentId != null ? `?parent_id=${parentId}` : "";
  const res = await fetch(`${API_BASE}/export/${exportId}/children${qs}`);
  if (!res.ok) throw new Error("Failed to load tree nodes");
  const data = await res.json();
  return data.children;
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
