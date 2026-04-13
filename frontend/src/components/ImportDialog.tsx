import { useState, useCallback } from "react";
import { Upload, X, FileJson, AlertTriangle } from "lucide-react";
import { importExport } from "@/lib/api";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ImportDialog({ open, onClose, onImported }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "error" | "confirm";
    message: string;
  }>({ type: "idle", message: "" });

  const reset = () => {
    setFile(null);
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
      setStatus({ type: "idle", message: "" });
    }
  };

  const doImport = async (overwrite: boolean) => {
    if (!file) return;
    setStatus({ type: "loading", message: "Importing..." });

    try {
      const content = await file.text();
      const { status: httpStatus, data } = await importExport(
        file.name,
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
              <label className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Choose file
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleFileSelect}
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
            disabled={!file || status.type === "loading"}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status.type === "loading" ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
