import { X } from "lucide-react";
import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["?"], description: "Show this help" },
  { keys: ["⌘", "K"], description: "Focus search (or /)" },
  { keys: ["/"], description: "Focus search" },
  { keys: ["g", "d"], description: "Go to dashboard" },
  { keys: ["g", "s"], description: "Go to settings" },
  { keys: ["g", "c"], description: "Go to compare / diff" },
  { keys: ["Esc"], description: "Close modal or blur search" },
];

export function ShortcutsModal({ open, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 print:hidden"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li
              key={s.description}
              className="flex items-center justify-between gap-4 rounded-md px-2 py-1 text-sm"
            >
              <span className="text-muted-foreground">{s.description}</span>
              <span className="flex gap-1">
                {s.keys.map((k, i) => (
                  <kbd
                    key={i}
                    className="inline-flex min-w-[24px] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
