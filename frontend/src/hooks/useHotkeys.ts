import { useEffect } from "react";

type HotkeyHandler = (e: KeyboardEvent) => void;

/**
 * Register a global keyboard shortcut. Ignored while typing in inputs,
 * textareas, or contenteditable elements (unless the binding is a modifier
 * combo like Ctrl/Meta+K).
 *
 * Key format: "?" | "g d" (chord) | "mod+k" (Ctrl or Meta). Chord timeout: 1s.
 */
export function useHotkey(combo: string, handler: HotkeyHandler, deps: unknown[] = []) {
  useEffect(() => {
    const parts = combo.trim().toLowerCase().split(/\s+/);
    const isChord = parts.length > 1;

    let chordIndex = 0;
    let chordTimer: number | undefined;

    function resetChord() {
      chordIndex = 0;
      if (chordTimer) {
        window.clearTimeout(chordTimer);
        chordTimer = undefined;
      }
    }

    function matchesKey(e: KeyboardEvent, key: string): boolean {
      if (key.startsWith("mod+")) {
        const k = key.slice(4);
        return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === k;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        return e.key.toLowerCase() === key || e.key === key;
      }
      return false;
    }

    function isTyping(e: KeyboardEvent): boolean {
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable === true
      );
    }

    function onKey(e: KeyboardEvent) {
      // Allow mod+<key> bindings to fire even in inputs.
      if (isTyping(e) && !parts[0]?.startsWith("mod+")) {
        return;
      }
      const expected = parts[chordIndex];
      if (matchesKey(e, expected)) {
        if (isChord && chordIndex === 0) {
          e.preventDefault();
          chordIndex = 1;
          chordTimer = window.setTimeout(resetChord, 1000);
          return;
        }
        e.preventDefault();
        handler(e);
        resetChord();
      } else if (chordIndex > 0) {
        resetChord();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      resetChord();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo, ...deps]);
}
