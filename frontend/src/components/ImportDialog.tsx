import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, X, FileJson, AlertTriangle } from "lucide-react";
import { importExport } from "@/lib/api";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  autoPickFolder?: boolean;
}

export function ImportDialog({
  open,
  onClose,
  onImported,
  autoPickFolder = false,
}: ImportDialogProps) {
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

  const [file, setFile] = useState<File | null>(null);
  const [generated, setGenerated] = useState<GeneratedFolderExport | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "error" | "confirm";
    message: string;
  }>({ type: "idle", message: "" });
  const autoPickedRef = useRef(false);

  const reset = () => {
    setFile(null);
    setGenerated(null);
    setStatus({ type: "idle", message: "" });
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.name.endsWith(".json")) {
      setFile(dropped);
      setStatus({ type: "idle", message: "" });
    } else {
      setStatus({ type: "error", message: "Only .json files are supported" });
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setGenerated(null);
      setStatus({ type: "idle", message: "" });
    }
  };

  const buildFolderExportFromPicker = useCallback(async (
    dir: FileSystemDirectoryHandle
  ): Promise<GeneratedFolderExport> => {
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
          const file = await entry.getFile();
          children.push({
            name: entry.name,
            path,
            is_dir: false,
            size: file.size,
          });
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
      description: "Generated from a local folder selection",
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
    };
  }, []);

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
    setStatus({ type: "loading", message: "Reading folder..." });
    try {
      const dir = await maybeWin.showDirectoryPicker();
      const generatedExport = await buildFolderExportFromPicker(dir);
      setFile(null);
      setGenerated(generatedExport);
      setStatus({ type: "idle", message: "" });
    } catch {
      setStatus({
        type: "error",
        message: "Unable to read selected folder (cancelled or permission denied).",
      });
    }
  }, [buildFolderExportFromPicker]);

  const handleFolderInputSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(e.target.files ?? []);
    if (selectedFiles.length === 0) return;
    setStatus({ type: "loading", message: "Reading folder..." });
    try {
      const rootName = selectedFiles[0].webkitRelativePath.split("/")[0] || "folder";
      const nodeMap = new Map<string, FsFileNode>();
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
        parentDir.children?.push({
          name: fileName,
          path: rel,
          is_dir: false,
          size: entry.size,
        });
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
        description: "Generated from a local folder selection",
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
  };

  const doImport = async (overwrite: boolean) => {
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
  };

  const downloadGenerated = () => {
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
  };

  useEffect(() => {
    if (!open) {
      autoPickedRef.current = false;
      return;
    }
    if (!autoPickFolder || autoPickedRef.current || file || generated) return;
    autoPickedRef.current = true;
    void handleFolderPick();
  }, [autoPickFolder, file, generated, handleFolderPick, open]);

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

        {/* Drop zone */}
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
                onClick={handleFolderPick}
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
                  onChange={handleFolderInputSelect}
                  {...({ webkitdirectory: "true", directory: "" } as Record<
                    string,
                    string
                  >)}
                />
              </label>
            </>
          )}
        </div>

        {/* Status messages */}
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
                onClick={() => doImport(true)}
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

        {/* Actions */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => doImport(false)}
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
