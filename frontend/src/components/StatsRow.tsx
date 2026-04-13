import {
  Files,
  FolderOpen,
  HardDrive,
  ShieldAlert,
  Layers,
} from "lucide-react";
import { formatSize, bandColor, cn } from "@/lib/utils";

interface StatsRowProps {
  fileCount: number;
  dirCount: number;
  totalSize: number;
  piiScore: number;
  piiBand: string;
  totalNodes: number;
}

export function StatsRow({
  fileCount,
  dirCount,
  totalSize,
  piiScore,
  piiBand,
  totalNodes,
}: StatsRowProps) {
  const stats = [
    {
      label: "Total Nodes",
      value: totalNodes.toLocaleString(),
      icon: Layers,
    },
    {
      label: "Files",
      value: fileCount.toLocaleString(),
      icon: Files,
    },
    {
      label: "Directories",
      value: dirCount.toLocaleString(),
      icon: FolderOpen,
    },
    {
      label: "Total Size",
      value: formatSize(totalSize),
      icon: HardDrive,
    },
    {
      label: "PII Risk Score",
      value: `${piiScore}/100`,
      icon: ShieldAlert,
      badge: piiBand,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-border bg-card p-4 shadow-sm"
        >
          <div className="mb-2 flex items-center gap-2 text-muted-foreground">
            <stat.icon size={16} />
            <span className="text-xs font-medium">{stat.label}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold text-card-foreground">
              {stat.value}
            </span>
            {stat.badge && (
              <span
                className={cn(
                  "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
                  bandColor(stat.badge)
                )}
              >
                {stat.badge}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
