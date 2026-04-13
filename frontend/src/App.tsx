import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Dashboard } from "@/pages/Dashboard";
import { ExportDetail } from "@/pages/ExportDetail";

export default function App() {
  const { theme, toggle } = useTheme();

  return (
    <BrowserRouter>
      <div className="flex min-h-screen flex-col bg-background">
        {/* Top nav */}
        <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-md">
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
            <ThemeToggle theme={theme} onToggle={toggle} />
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/export/:id" element={<ExportDetail />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
          JSON Export Browser &mdash; PII detection is heuristic, not a
          compliance guarantee.
        </footer>
      </div>
    </BrowserRouter>
  );
}
