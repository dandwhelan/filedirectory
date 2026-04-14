import { useState, useEffect } from "react";
import { X, Loader2, File, Search } from "lucide-react";
import { fetchFilesByType, type FileByType } from "@/lib/api";
import { formatSize } from "@/lib/utils";

interface FileListPanelProps {
  exportId: number;
  extension: string;
  onClose: () => void;
}

export function FileListPanel({ exportId, extension, onClose }: FileListPanelProps) {
  const [files, setFiles] = useState<FileByType[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchFilesByType(exportId, extension)
      .then((result) => setFiles(result.files))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [exportId, extension]);

  const filtered = filter
    ? files.filter(
        (f) =>
          f.name.toLowerCase().includes(filter.toLowerCase()) ||
          f.path.toLowerCase().includes(filter.toLowerCase())
      )
    : files;

  return (
    <div className="rounded-xl border border-primary/30 bg-card shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h4 className="text-sm font-semibold text-card-foreground">
            {extension.startsWith(".") ? extension : `.${extension}`} Files
          </h4>
          <p className="text-xs text-muted-foreground">
            {files.length} file{files.length !== 1 ? "s" : ""} found
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      {/* Filter */}
      {files.length > 5 && (
        <div className="border-b border-border px-4 py-2">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Filter by name or path..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-3 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      )}

      {/* File list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {filter ? "No files match your filter." : "No files found."}
        </p>
      ) : (
        <div className="max-h-[350px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr>
                <th className="px-4 py-2 font-medium text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-2 font-medium text-muted-foreground">
                  Path
                </th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                  Size
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((file, i) => (
                <tr
                  key={i}
                  className="transition-colors hover:bg-accent/50"
                >
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5 text-card-foreground">
                      <File size={12} className="shrink-0 text-muted-foreground" />
                      <span title={file.name} className="truncate max-w-[200px]">
                        {file.name}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      title={file.path}
                      className="block max-w-[300px] truncate font-mono text-muted-foreground"
                    >
                      {file.path}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-muted-foreground">
                    {formatSize(file.size)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
