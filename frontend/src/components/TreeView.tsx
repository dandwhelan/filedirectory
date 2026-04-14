import { useState, useEffect, useCallback } from "react";
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
  Loader2,
  ChevronsDown,
} from "lucide-react";
import { fetchTreeChildren, type LazyTreeNode } from "@/lib/api";
import { formatSize, cn } from "@/lib/utils";

const PAGE_SIZE = 100;

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

function nodeMatches(node: LazyTreeNode, filter: string): boolean {
  if (!filter) return true;
  const text = `${node.name} ${node.path}`.toLowerCase();
  return text.includes(filter.toLowerCase());
}

interface LazyTreeNodeItemProps {
  node: LazyTreeNode;
  depth: number;
  filter: string;
  exportId: number;
}

function LazyTreeNodeItem({ node, depth, filter, exportId }: LazyTreeNodeItemProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<LazyTreeNode[]>(node.children || []);
  const [loaded, setLoaded] = useState(node.loaded || false);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const isDir = node.is_dir;
  const Icon = isDir ? Folder : getFileIcon(node.name);
  const hasChildren = isDir && node.has_children;
  const matches = nodeMatches(node, filter);

  // Filter: hide non-matching leaf nodes
  if (filter && !matches && !isDir) return null;

  const handleToggle = useCallback(async () => {
    if (!hasChildren) return;

    if (!loaded) {
      setLoading(true);
      try {
        const result = await fetchTreeChildren(exportId, node.id, 0, PAGE_SIZE);
        setChildren(result.children);
        setHasMore(result.has_more);
        setTotalCount(result.total_count);
        setLoaded(true);
        setOpen(true);
      } catch (e) {
        console.error("Failed to load children:", e);
      } finally {
        setLoading(false);
      }
    } else {
      setOpen(!open);
    }
  }, [hasChildren, loaded, open, exportId, node.id]);

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const result = await fetchTreeChildren(exportId, node.id, children.length, PAGE_SIZE);
      setChildren((prev) => [...prev, ...result.children]);
      setHasMore(result.has_more);
      setTotalCount(result.total_count);
    } catch (e) {
      console.error("Failed to load more children:", e);
    } finally {
      setLoadingMore(false);
    }
  }, [exportId, node.id, children.length]);

  return (
    <div>
      <button
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent",
          hasChildren ? "cursor-pointer" : "cursor-default",
          filter && matches && "bg-primary/5"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          loading ? (
            <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
          ) : open ? (
            <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
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
      {hasChildren && open && children.length > 0 && (
        <div>
          {children
            .filter((child) => {
              if (!filter) return true;
              // Show matching nodes and all directories (they might have matching descendants)
              return nodeMatches(child, filter) || child.is_dir;
            })
            .map((child) => (
              <LazyTreeNodeItem
                key={child.id}
                node={child}
                depth={depth + 1}
                filter={filter}
                exportId={exportId}
              />
            ))}
          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-primary transition-colors hover:bg-accent"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              {loadingMore ? (
                <Loader2 size={12} className="shrink-0 animate-spin" />
              ) : (
                <ChevronsDown size={12} className="shrink-0" />
              )}
              Load more ({totalCount - children.length} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface LazyTreeViewProps {
  exportId: number;
  filter: string;
}

export function LazyTreeView({ exportId, filter }: LazyTreeViewProps) {
  const [roots, setRoots] = useState<LazyTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchTreeChildren(exportId, undefined, 0, PAGE_SIZE)
      .then((result) => {
        setRoots(result.children);
        setHasMore(result.has_more);
        setTotalCount(result.total_count);
      })
      .catch((e) => console.error("Failed to load tree roots:", e))
      .finally(() => setLoading(false));
  }, [exportId]);

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const result = await fetchTreeChildren(exportId, undefined, roots.length, PAGE_SIZE);
      setRoots((prev) => [...prev, ...result.children]);
      setHasMore(result.has_more);
      setTotalCount(result.total_count);
    } catch (e) {
      console.error("Failed to load more roots:", e);
    } finally {
      setLoadingMore(false);
    }
  }, [exportId, roots.length]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-card py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!roots || roots.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No files in this export.
      </p>
    );
  }

  return (
    <div>
      <div className="max-h-[600px] overflow-auto rounded-lg border border-border bg-card p-1">
        {roots
          .filter((node) => {
            if (!filter) return true;
            return nodeMatches(node, filter) || node.is_dir;
          })
          .map((node) => (
            <LazyTreeNodeItem
              key={node.id}
              node={node}
              depth={0}
              filter={filter}
              exportId={exportId}
            />
          ))}
        {hasMore && (
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs text-primary transition-colors hover:bg-accent"
          >
            {loadingMore ? (
              <Loader2 size={12} className="shrink-0 animate-spin" />
            ) : (
              <ChevronsDown size={12} className="shrink-0" />
            )}
            Load more ({totalCount - roots.length} remaining)
          </button>
        )}
      </div>
    </div>
  );
}
