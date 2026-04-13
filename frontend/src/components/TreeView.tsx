import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  File,
  FileText,
  FileImage,
  FileCode,
  FileSpreadsheet,
  FileArchive,
} from "lucide-react";
import type { TreeNode } from "@/lib/api";
import { formatSize, cn } from "@/lib/utils";

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "bmp", "ico", "webp"];
  const codeExts = [
    "js",
    "ts",
    "jsx",
    "tsx",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "c",
    "cpp",
    "h",
    "html",
    "css",
    "scss",
    "json",
    "yaml",
    "yml",
    "xml",
    "sh",
    "bash",
  ];
  const sheetExts = ["csv", "xls", "xlsx", "tsv"];
  const archiveExts = ["zip", "tar", "gz", "rar", "7z", "bz2"];
  const docExts = ["pdf", "doc", "docx", "txt", "md", "rtf"];

  if (imageExts.includes(ext)) return FileImage;
  if (codeExts.includes(ext)) return FileCode;
  if (sheetExts.includes(ext)) return FileSpreadsheet;
  if (archiveExts.includes(ext)) return FileArchive;
  if (docExts.includes(ext)) return FileText;
  return File;
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  filter: string;
  defaultOpen: boolean;
}

function nodeMatches(node: TreeNode, filter: string): boolean {
  if (!filter) return true;
  const text = `${node.name} ${node.path}`.toLowerCase();
  return text.includes(filter.toLowerCase());
}

function hasMatchingDescendant(node: TreeNode, filter: string): boolean {
  if (!node.children?.length) return false;
  return node.children.some(
    (c) => nodeMatches(c, filter) || hasMatchingDescendant(c, filter)
  );
}

function TreeNodeItem({ node, depth, filter, defaultOpen }: TreeNodeItemProps) {
  const [open, setOpen] = useState(defaultOpen || Boolean(filter));

  const matches = nodeMatches(node, filter);
  const descendantMatches = hasMatchingDescendant(node, filter);
  if (filter && !matches && !descendantMatches) return null;

  const isDir = node.is_dir;
  const Icon = isDir ? Folder : getFileIcon(node.name);
  const hasChildren = isDir && node.children && node.children.length > 0;

  return (
    <div>
      <button
        onClick={() => hasChildren && setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent",
          hasChildren ? "cursor-pointer" : "cursor-default",
          filter && matches && "bg-primary/5"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          open ? (
            <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight
              size={14}
              className="shrink-0 text-muted-foreground"
            />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Icon
          size={15}
          className={cn(
            "shrink-0",
            isDir ? "text-amber-500" : "text-muted-foreground"
          )}
        />
        <span className="truncate font-mono text-xs text-foreground">
          {node.name}
        </span>
        {!isDir && node.size > 0 && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {formatSize(node.size)}
          </span>
        )}
      </button>
      {hasChildren && open && (
        <div>
          {node.children!.map((child, i) => (
            <TreeNodeItem
              key={`${child.path}-${i}`}
              node={child}
              depth={depth + 1}
              filter={filter}
              defaultOpen={defaultOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TreeViewProps {
  nodes: TreeNode[];
  filter: string;
}

export function TreeView({ nodes, filter }: TreeViewProps) {
  const [allOpen, setAllOpen] = useState(false);

  if (!nodes || nodes.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No files in this export.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-2 flex gap-2">
        <button
          onClick={() => setAllOpen(true)}
          className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          Expand all
        </button>
        <button
          onClick={() => setAllOpen(false)}
          className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
        >
          Collapse all
        </button>
      </div>
      <div className="max-h-[600px] overflow-auto rounded-lg border border-border bg-card p-1">
        {/* Force remount on allOpen change to reset all states */}
        <div key={allOpen ? "open" : "closed"}>
          {nodes.map((node, i) => (
            <TreeNodeItem
              key={`${node.path}-${i}`}
              node={node}
              depth={0}
              filter={filter}
              defaultOpen={allOpen}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
