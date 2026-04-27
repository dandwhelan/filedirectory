import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, X, FileJson, AlertTriangle } from "lucide-react";
import { fetchPiiPatterns, importExport, type PiiPattern } from "@/lib/api";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  autoPickFolder?: boolean;
}

type SelectedImport = {
  kind: "json-file";
  file: File;
} | GeneratedFolderExport;

type GeneratedFolderExport = {
  kind: "generated-folder-export";
  filename: string;
  content: string;
  bytes: number;
  sourceFolder: string;
  totalFiles: number;
  totalDirs: number;
  deepSignals?: number;
  zipEntries?: number;
  debug?: DeepScanDebug;
};

type DeepScanDebug = {
  enabled: boolean;
  text_files_scanned: number;
  text_files_skipped_size: number;
  text_files_skipped_extension: number;
  zip_files_scanned: number;
  zip_files_skipped_size: number;
  zip_entries_reviewed: number;
  deep_signals: number;
};

interface FsFileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  children?: FsFileNode[];
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 4000;
const MAX_TEXT_SCAN_BYTES = 2 * 1024 * 1024;
const TEXT_SCAN_EXTENSIONS = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "xml",
  "yaml",
  "yml",
  "log",
  "ini",
  "conf",
]);

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractZipEntryNames(file: File): Promise<string[]> {
  return file.arrayBuffer().then((buf) => {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const names: string[] = [];

    for (let i = 0; i + 46 < view.byteLength && names.length < MAX_ZIP_ENTRIES; i += 1) {
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

export function ImportDialog({
  open,
  onClose,
  onImported,
  autoPickFolder = false,
}: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [generated, setGenerated] = useState<GeneratedFolderExport | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "error" | "confirm";
    message: string;
  }>({ type: "idle", message: "" });
  const [deepScan, setDeepScan] = useState(false);
  const autoPickedRef = useRef(false);
  const patternCacheRef = useRef<PiiPattern[] | null>(null);

  const getPatterns = useCallback(async (): Promise<PiiPattern[]> => {
    if (patternCacheRef.current) return patternCacheRef.current;
    const patterns = await fetchPiiPatterns();
    patternCacheRef.current = patterns;
    return patterns;
  }, []);

  const reset = useCallback(() => {
    setFile(null);
    setGenerated(null);
    setStatus({ type: "idle", message: "" });
    setDeepScan(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.name.endsWith(".json")) {
      setFile(dropped);
      setGenerated(null);
      setStatus({ type: "idle", message: "" });
    } else {
      setStatus({ type: "error", message: "Only .json files are supported" });
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setGenerated(null);
      setStatus({ type: "idle", message: "" });
    }
  }, []);

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

  const scanTextAgainstPatterns = useCallback(async (
    f: File,
    patterns: PiiPattern[]
  ): Promise<number> => {
    const idx = f.name.lastIndexOf(".");
    const ext = idx > -1 ? f.name.slice(idx + 1).toLowerCase() : "";
    if (!TEXT_SCAN_EXTENSIONS.has(ext) || f.size > MAX_TEXT_SCAN_BYTES) {
      return 0;
    }
    const text = await f.text();
    return patternMatchCount(text, patterns);
  }, [patternMatchCount]);

  const expandZipToVirtualTree = useCallback(async (
    zipFile: File,
    path: string,
    patterns: PiiPattern[]
  ): Promise<{ node: FsFileNode; zipEntries: number; deepSignals: number }> => {
    const zipNode: FsFileNode = {
      name: zipFile.name,
      path,
      is_dir: true,
      size: zipFile.size,
      children: [],
    };
    if (zipFile.size > MAX_ZIP_BYTES) {
      return { node: zipNode, zipEntries: 0, deepSignals: 0 };
    }

    const entryNames = await extractZipEntryNames(zipFile);
    let deepSignals = 0;

    const ensureDir = (children: FsFileNode[], parts: string[], basePath: string): FsFileNode => {
      const dirName = parts[0];
      const childPath = `${basePath}::${parts.join("/")}`;
      let dir = children.find((n) => n.is_dir && n.name === dirName && n.path === childPath);
      if (!dir) {
        dir = { name: dirName, path: childPath, is_dir: true, size: 0, children: [] };
        children.push(dir);
      }
      return dir;
    };

    for (const raw of entryNames.slice(0, MAX_ZIP_ENTRIES)) {
      const normalized = raw.replace(/^\/+/, "");
      if (!normalized || normalized.includes("../")) continue;
      deepSignals += patternMatchCount(normalized, patterns);

      const parts = normalized.split("/").filter(Boolean);
      if (parts.length === 0) continue;
      let cursor = zipNode;
      for (let i = 0; i < parts.length; i += 1) {
        const isLast = i === parts.length - 1;
        const name = parts[i];
        cursor.children ||= [];
        if (isLast && !normalized.endsWith("/")) {
          cursor.children.push({
            name,
            path: `${path}::${parts.join("/")}`,
            is_dir: false,
            size: 0,
          });
        } else {
          cursor = ensureDir(cursor.children, parts.slice(0, i + 1), path);
        }
      }
    }

    const sortTree = (nodes: FsFileNode[]) => {
      nodes.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const node of nodes) {
        if (node.children?.length) sortTree(node.children);
      }
    };
    if (zipNode.children?.length) sortTree(zipNode.children);

    return {
      node: zipNode,
      zipEntries: Math.min(entryNames.length, MAX_ZIP_ENTRIES),
      deepSignals,
    };
  }, [patternMatchCount]);

  const buildFolderExportFromPicker = useCallback(async (
    dir: FileSystemDirectoryHandle,
    withDeepScan: boolean
  ): Promise<GeneratedFolderExport> => {
    let zipEntries = 0;
    let deepSignals = 0;
    const debug: DeepScanDebug = {
      enabled: withDeepScan,
      text_files_scanned: 0,
      text_files_skipped_size: 0,
      text_files_skipped_extension: 0,
      zip_files_scanned: 0,
      zip_files_skipped_size: 0,
      zip_entries_reviewed: 0,
      deep_signals: 0,
    };
    const patterns = withDeepScan ? await getPatterns() : [];

    const walk = async (
      directory: FileSystemDirectoryHandle,
      prefix: string
    ): Promise<FsFileNode[]> => {
      const children: FsFileNode[] = [];
      for await (const entry of directory.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === "directory") {
          const nested = await walk(entry, path);
          children.push({
            name: entry.name,
            path,
            is_dir: true,
            size: 0,
            children: nested,
          });
          continue;
        }
        if (entry.kind === "file") {
          const picked = await entry.getFile();
          if (withDeepScan && picked.name.toLowerCase().endsWith(".zip")) {
            const expanded = await expandZipToVirtualTree(picked, path, patterns);
            children.push(expanded.node);
            zipEntries += expanded.zipEntries;
            deepSignals += expanded.deepSignals;
            if (picked.size > MAX_ZIP_BYTES) debug.zip_files_skipped_size += 1;
            else debug.zip_files_scanned += 1;
            debug.zip_entries_reviewed += expanded.zipEntries;
            continue;
          }
          children.push({
            name: entry.name,
            path,
            is_dir: false,
            size: picked.size,
          });
          if (withDeepScan) {
            const ext = picked.name.split(".").pop()?.toLowerCase() || "";
            if (!TEXT_SCAN_EXTENSIONS.has(ext)) debug.text_files_skipped_extension += 1;
            else if (picked.size > MAX_TEXT_SCAN_BYTES) debug.text_files_skipped_size += 1;
            else debug.text_files_scanned += 1;
            deepSignals += await scanTextAgainstPatterns(picked, patterns);
          }
        }
      }
      children.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return children;
    };

    const tree = await walk(dir, dir.name);
    let totalFiles = 0;
    let totalDirs = 0;
    const count = (nodes: FsFileNode[]) => {
      for (const node of nodes) {
        if (node.is_dir) {
          totalDirs += 1;
          if (node.children?.length) count(node.children);
        } else {
          totalFiles += 1;
        }
      }
    };
    count(tree);

    const payload = {
      company: "",
      folder: dir.name,
      description: withDeepScan
        ? "Generated from local folder selection with deep local PII scan"
        : "Generated from a local folder selection",
      _meta: withDeepScan ? { deep_scan_debug: { ...debug, deep_signals: deepSignals } } : undefined,
      children: tree,
    };
    const content = JSON.stringify(payload, null, 2);
    return {
      kind: "generated-folder-export",
      filename: `${dir.name}.json`,
      content,
      bytes: new Blob([content], { type: "application/json" }).size,
      sourceFolder: dir.name,
      totalFiles,
      totalDirs,
      deepSignals,
      zipEntries,
      debug: { ...debug, deep_signals: deepSignals },
    };
  }, [expandZipToVirtualTree, getPatterns, scanTextAgainstPatterns]);

  const handleFolderPick = useCallback(async () => {
    const maybeWin = window as DirectoryPickerWindow;
    if (!maybeWin.showDirectoryPicker) {
      setStatus({
        type: "error",
        message:
          "Folder picker isn't supported in this browser. Use the folder upload fallback below.",
      });
      return;
    }
    setStatus({ type: "loading", message: deepScan ? "Scanning folder..." : "Reading folder..." });
    try {
      const dir = await maybeWin.showDirectoryPicker();
      const generatedExport = await buildFolderExportFromPicker(dir, deepScan);
      setFile(null);
      setGenerated(generatedExport);
      setStatus({ type: "idle", message: "" });
    } catch {
      setStatus({
        type: "error",
        message: "Unable to read selected folder (cancelled or permission denied).",
      });
    }
  }, [buildFolderExportFromPicker, deepScan]);

  const handleFolderInputSelect = useCallback(async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(e.target.files ?? []);
    if (selectedFiles.length === 0) return;
    setStatus({ type: "loading", message: deepScan ? "Scanning folder..." : "Reading folder..." });
    try {
      const rootName = selectedFiles[0].webkitRelativePath.split("/")[0] || "folder";
      const nodeMap = new Map<string, FsFileNode>();
      let deepSignals = 0;
      let zipEntries = 0;
      const debug: DeepScanDebug = {
        enabled: deepScan,
        text_files_scanned: 0,
        text_files_skipped_size: 0,
        text_files_skipped_extension: 0,
        zip_files_scanned: 0,
        zip_files_skipped_size: 0,
        zip_entries_reviewed: 0,
        deep_signals: 0,
      };
      const patterns = deepScan ? await getPatterns() : [];

      const ensureDir = (dirPath: string): FsFileNode => {
        const existing = nodeMap.get(dirPath);
        if (existing) return existing;
        const parts = dirPath.split("/");
        const dirNode: FsFileNode = {
          name: parts[parts.length - 1] || rootName,
          path: dirPath,
          is_dir: true,
          size: 0,
          children: [],
        };
        nodeMap.set(dirPath, dirNode);
        if (parts.length > 1) {
          const parentPath = parts.slice(0, -1).join("/");
          const parent = ensureDir(parentPath);
          if (!parent.children?.some((c) => c.path === dirNode.path)) {
            parent.children?.push(dirNode);
          }
        }
        return dirNode;
      };

      ensureDir(rootName);

      for (const entry of selectedFiles) {
        const rel = entry.webkitRelativePath || entry.name;
        const parts = rel.split("/");
        const fileName = parts.pop() || entry.name;
        const parentPath = parts.join("/");
        const parentDir = ensureDir(parentPath || rootName);

        if (deepScan && fileName.toLowerCase().endsWith(".zip")) {
          const expanded = await expandZipToVirtualTree(entry, rel, patterns);
          parentDir.children?.push(expanded.node);
          zipEntries += expanded.zipEntries;
          deepSignals += expanded.deepSignals;
          if (entry.size > MAX_ZIP_BYTES) debug.zip_files_skipped_size += 1;
          else debug.zip_files_scanned += 1;
          debug.zip_entries_reviewed += expanded.zipEntries;
          continue;
        }

        parentDir.children?.push({
          name: fileName,
          path: rel,
          is_dir: false,
          size: entry.size,
        });

        if (deepScan) {
          const ext = fileName.split(".").pop()?.toLowerCase() || "";
          if (!TEXT_SCAN_EXTENSIONS.has(ext)) debug.text_files_skipped_extension += 1;
          else if (entry.size > MAX_TEXT_SCAN_BYTES) debug.text_files_skipped_size += 1;
          else debug.text_files_scanned += 1;
          deepSignals += await scanTextAgainstPatterns(entry, patterns);
        }
      }

      const sortTree = (nodes: FsFileNode[]) => {
        nodes.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        for (const node of nodes) {
          if (node.children?.length) sortTree(node.children);
        }
      };
      const root = nodeMap.get(rootName);
      const tree = root?.children ?? [];
      sortTree(tree);

      const payload = {
        company: "",
        folder: rootName,
        description: deepScan
          ? "Generated from local folder selection with deep local PII scan"
          : "Generated from a local folder selection",
        _meta: deepScan ? { deep_scan_debug: { ...debug, deep_signals: deepSignals } } : undefined,
        children: tree,
      };
      const content = JSON.stringify(payload, null, 2);
      const generatedExport: GeneratedFolderExport = {
        kind: "generated-folder-export",
        filename: `${rootName}.json`,
        content,
        bytes: new Blob([content], { type: "application/json" }).size,
        sourceFolder: rootName,
        totalFiles: selectedFiles.length,
        totalDirs: Math.max(0, nodeMap.size - 1),
        deepSignals,
        zipEntries,
        debug: { ...debug, deep_signals: deepSignals },
      };

      setFile(null);
      setGenerated(generatedExport);
      setStatus({ type: "idle", message: "" });
    } catch {
      setStatus({
        type: "error",
        message: "Unable to process selected folder files.",
      });
    } finally {
      e.target.value = "";
    }
  }, [deepScan, expandZipToVirtualTree, getPatterns, scanTextAgainstPatterns]);

  useEffect(() => {
    if (!open) {
      autoPickedRef.current = false;
      return;
    }
    if (!autoPickFolder || autoPickedRef.current) return;
    autoPickedRef.current = true;
    void handleFolderPick();
  }, [open, autoPickFolder, handleFolderPick]);

  const doImport = useCallback(async (overwrite: boolean) => {
    const selected: SelectedImport | null = file
      ? { kind: "json-file", file }
      : generated;
    if (!selected) return;
    setStatus({ type: "loading", message: "Importing..." });

    try {
      const filename =
        selected.kind === "json-file" ? selected.file.name : selected.filename;
      const content =
        selected.kind === "json-file"
          ? await selected.file.text()
          : selected.content;
      const { status: httpStatus, data } = await importExport(
        filename,
        content,
        overwrite
      );

      if (httpStatus === 409 && data.code === "file_exists") {
        setStatus({
          type: "confirm",
          message: `"${data.name}" already exists. Overwrite it?`,
        });
        return;
      }

      if (httpStatus >= 400) {
        setStatus({ type: "error", message: data.error || "Import failed" });
        return;
      }

      onImported();
      handleClose();
    } catch {
      setStatus({ type: "error", message: "Network error during import" });
    }
  }, [file, generated, handleClose, onImported]);

  const downloadGenerated = useCallback(() => {
    if (!generated || generated.kind !== "generated-folder-export") return;
    const blob = new Blob([generated.content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = generated.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [generated]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-card-foreground">
            Import JSON Export
          </h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-3 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={deepScan}
              onChange={(e) => setDeepScan(e.target.checked)}
            />
            Deep local PII scan (experimental): scans text files and reviews entries
            inside .zip archives locally before import.
          </label>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }`}
        >
          {file ? (
            <div className="flex items-center gap-3">
              <FileJson size={24} className="text-primary" />
              <div className="text-left">
                <p className="font-medium text-foreground">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                onClick={() => {
                  setFile(null);
                  setStatus({ type: "idle", message: "" });
                }}
                className="ml-2 rounded-md p-1 text-muted-foreground hover:bg-accent"
              >
                <X size={16} />
              </button>
            </div>
          ) : generated ? (
            <div className="w-full rounded-lg border border-border bg-muted/30 p-3 text-left">
              <div className="mb-2 flex items-center gap-2">
                <FileJson size={18} className="text-primary" />
                <p className="font-medium text-foreground">{generated.filename}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Source folder: <span className="font-medium">{generated.sourceFolder}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {generated.totalFiles} files • {generated.totalDirs} folders •{" "}
                {(generated.bytes / 1024).toFixed(1)} KB JSON
              </p>
              {deepScan && (
                <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                  <p>
                    Deep scan signals: {generated.deepSignals ?? 0} • ZIP entries reviewed: {generated.zipEntries ?? 0}
                  </p>
                  {generated.debug && (
                    <p>
                      Debug — text scanned: {generated.debug.text_files_scanned}, text skipped(ext/size):{" "}
                      {generated.debug.text_files_skipped_extension}/{generated.debug.text_files_skipped_size}, zip scanned/skipped:{" "}
                      {generated.debug.zip_files_scanned}/{generated.debug.zip_files_skipped_size}
                    </p>
                  )}
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={downloadGenerated}
                  className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
                >
                  Download JSON
                </button>
                <button
                  onClick={() => {
                    setGenerated(null);
                    setStatus({ type: "idle", message: "" });
                  }}
                  className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <>
              <Upload
                size={32}
                className="mb-2 text-muted-foreground"
              />
              <p className="mb-1 text-sm font-medium text-foreground">
                Drop a JSON file here
              </p>
              <p className="mb-3 text-xs text-muted-foreground">
                or click to browse
              </p>
              <label className="mb-2 cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Choose file
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </label>
              <button
                onClick={() => void handleFolderPick()}
                className="mb-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Choose folder (recursive)
              </button>
              <label className="cursor-pointer text-xs text-muted-foreground underline decoration-dotted underline-offset-2">
                Fallback folder upload
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void handleFolderInputSelect(e)}
                  {...({ webkitdirectory: "true", directory: "" } as Record<
                    string,
                    string
                  >)}
                />
              </label>
            </>
          )}
        </div>

        {status.type === "error" && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            <AlertTriangle size={16} />
            {status.message}
          </div>
        )}
        {status.type === "confirm" && (
          <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2">
            <p className="mb-2 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle size={16} className="mr-1 inline" />
              {status.message}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => void doImport(true)}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                Overwrite
              </button>
              <button
                onClick={() =>
                  setStatus({ type: "idle", message: "" })
                }
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => void doImport(false)}
            disabled={(!file && !generated) || status.type === "loading"}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status.type === "loading" ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
