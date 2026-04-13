import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSize(size: number = 0): string {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getExtension(name: string = ""): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return "none";
  return name.slice(idx + 1).toLowerCase();
}

export function severityColor(severity: string): string {
  switch (severity) {
    case "high":
      return "text-severity-high";
    case "medium":
      return "text-severity-medium";
    case "low":
      return "text-severity-low";
    default:
      return "text-muted-foreground";
  }
}

export function severityBg(severity: string): string {
  switch (severity) {
    case "high":
      return "bg-red-500/10 text-red-600 dark:text-red-400";
    case "medium":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "low":
      return "bg-green-500/10 text-green-600 dark:text-green-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function bandColor(band: string): string {
  switch (band) {
    case "High":
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    case "Medium":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
    case "Low":
      return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
    default:
      return "bg-muted text-muted-foreground";
  }
}
