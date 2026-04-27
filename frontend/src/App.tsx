import { BrowserRouter, Routes, Route, Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  ShieldCheck,
  Settings as SettingsIcon,
  GitCompare,
  Keyboard,
  Trash2,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ShortcutsModal } from "@/components/ShortcutsModal";
import { ToastProvider } from "@/hooks/useToast";
import { useHotkey } from "@/hooks/useHotkeys";
import { Dashboard } from "@/pages/Dashboard";
import { ExportDetail } from "@/pages/ExportDetail";
import { Settings } from "@/pages/Settings";
import { Diff } from "@/pages/Diff";
import { Trash } from "@/pages/Trash";

function Shell() {
  const { theme, toggle } = useTheme();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const navigate = useNavigate();

  useHotkey("?", () => setShortcutsOpen((v) => !v));
  useHotkey("g d", () => navigate("/"));
  useHotkey("g s", () => navigate("/settings"));
  useHotkey("g c", () => navigate("/diff"));
  useHotkey("g t", () => navigate("/trash"));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-md print:hidden">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-foreground transition-colors hover:text-primary"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <ShieldCheck size={18} className="text-primary-foreground" />
            </div>
            <span className="text-base font-semibold tracking-tight">
              JSON Export Browser
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <Link
              to="/diff"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Compare exports"
            >
              <GitCompare size={15} />
              <span className="hidden sm:inline">Compare</span>
            </Link>
            <Link
              to="/trash"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Trash"
            >
              <Trash2 size={15} />
              <span className="hidden sm:inline">Trash</span>
            </Link>
            <Link
              to="/settings"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Settings"
            >
              <SettingsIcon size={15} />
              <span className="hidden sm:inline">Settings</span>
            </Link>
            <button
              onClick={() => setShortcutsOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard size={16} />
            </button>
            <ThemeToggle theme={theme} onToggle={toggle} />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/export/:id" element={<ExportDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/diff" element={<Diff />} />
          <Route path="/trash" element={<Trash />} />
        </Routes>
      </main>

      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground print:hidden">
        JSON Export Browser &mdash; PII detection is heuristic, not a
        compliance guarantee.
      </footer>

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}
