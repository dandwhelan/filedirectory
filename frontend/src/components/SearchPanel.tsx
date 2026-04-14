import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  X,
  Loader2,
  File,
  Folder,
  Command,
} from "lucide-react";
import { searchExport, type SearchResult } from "@/lib/api";
import { formatSize, cn } from "@/lib/utils";

interface SearchPanelProps {
  exportId: number;
}

export function SearchPanel({ exportId }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Ctrl+F or Ctrl+K focuses the search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        if (query) {
          setQuery("");
          setResults([]);
          setSearched(false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [query]);

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchExport(exportId, query);
        setResults(data.results);
        setTotalCount(data.count);
        setSearched(true);
      } catch (e) {
        console.error("Search failed:", e);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, exportId]);

  const handleClear = useCallback(() => {
    setQuery("");
    setResults([]);
    setSearched(false);
    inputRef.current?.focus();
  }, []);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      {/* Search input */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Search size={16} className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search file names, paths, keywords..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {loading && (
          <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
        )}
        {query && (
          <button
            onClick={handleClear}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
        <kbd className="pointer-events-none hidden items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
          <Command size={10} />F
        </kbd>
      </div>

      {/* Results */}
      {searched && (
        <div>
          <div className="border-b border-border px-4 py-2">
            <span className="text-xs text-muted-foreground">
              {totalCount === 0
                ? `No results for "${query}"`
                : `${totalCount} result${totalCount !== 1 ? "s" : ""}${totalCount >= 200 ? " (showing first 200)" : ""}`}
            </span>
          </div>

          {results.length > 0 && (
            <div className="max-h-[400px] overflow-auto">
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
                  {results.map((item, i) => (
                    <tr key={i} className="transition-colors hover:bg-accent/50">
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1.5 text-card-foreground">
                          {item.is_dir ? (
                            <Folder size={12} className="shrink-0 text-amber-500" />
                          ) : (
                            <File size={12} className="shrink-0 text-muted-foreground" />
                          )}
                          <span
                            title={item.name}
                            className={cn(
                              "max-w-[200px] truncate",
                              item.is_dir && "font-medium"
                            )}
                          >
                            <Highlight text={item.name} query={query} />
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          title={item.path}
                          className="block max-w-[350px] truncate font-mono text-muted-foreground"
                        >
                          <Highlight text={item.path} query={query} />
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-muted-foreground">
                        {item.is_dir ? "-" : formatSize(item.size)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Highlight matching substrings in search results. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let lastIndex = 0;

  let idx = lowerText.indexOf(lowerQuery);
  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push({ text: text.slice(lastIndex, idx), match: false });
    }
    parts.push({ text: text.slice(idx, idx + query.length), match: true });
    lastIndex = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), match: false });
  }

  return (
    <>
      {parts.map((part, i) =>
        part.match ? (
          <mark
            key={i}
            className="rounded-sm bg-primary/20 px-0.5 text-foreground"
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}
