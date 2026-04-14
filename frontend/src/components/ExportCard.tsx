import { Link } from "react-router-dom";
import {
  FileJson,
  FolderOpen,
  Files,
  HardDrive,
  ShieldAlert,
  Calendar,
} from "lucide-react";
import type { ExportSummary } from "@/lib/api";
import { formatSize, formatDate, bandColor, cn } from "@/lib/utils";

interface ExportCardProps {
  data: ExportSummary;
}

export function ExportCard({ data }: ExportCardProps) {
  return (
    <Link
      to={`/export/${data.id}`}
      className="group block rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:border-primary/30"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <FileJson size={20} className="text-primary" />
          </div>
          <div>
            <h3
              title={data.filename}
              className="font-semibold text-card-foreground group-hover:text-primary transition-colors line-clamp-1"
            >
              {data.filename}
            </h3>
            {data.company && (
              <p className="text-xs text-muted-foreground">{data.company}</p>
            )}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
            bandColor(data.pii_band)
          )}
        >
          <ShieldAlert size={12} />
          {data.pii_score}
        </span>
      </div>

      {data.description && (
        <p title={data.description} className="mb-3 text-sm text-muted-foreground line-clamp-2">
          {data.description}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Files size={13} />
          <span>{data.file_count} files</span>
        </div>
        <div className="flex items-center gap-1">
          <FolderOpen size={13} />
          <span>{data.dir_count} dirs</span>
        </div>
        <div className="flex items-center gap-1">
          <HardDrive size={13} />
          <span>{formatSize(data.total_size)}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground/70">
        <Calendar size={12} />
        <span>{formatDate(data.imported_at)}</span>
      </div>
    </Link>
  );
}
