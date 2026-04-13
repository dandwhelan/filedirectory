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

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children?: TreeNode[];
}

export interface PiiSignal {
  pattern_label: string;
  category: string;
  severity: string;
  score: number;
  location: string;
}

export interface ExportDetail extends ExportSummary {
  tree: {
    company?: string;
    folder?: string;
    description?: string;
    children: TreeNode[];
  };
  pii_signals: PiiSignal[];
  raw_json?: string;
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

export async function fetchExports(): Promise<ExportSummary[]> {
  const res = await fetch(`${API_BASE}/exports`);
  if (!res.ok) throw new Error("Failed to load exports");
  const data = await res.json();
  return data.exports;
}

export async function fetchExportDetail(id: number): Promise<ExportDetail> {
  const res = await fetch(`${API_BASE}/export/${id}`);
  if (!res.ok) throw new Error("Failed to load export");
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
