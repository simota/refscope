import { useEffect, useMemo, useRef } from "react";

// Central registry for application-level keyboard shortcuts. Lives as a single
// hook so that combo parsing, input-focus suppression, and modal suppression
// only have to be reasoned about in one place — and so the shortcut help
// dialog can render the same list users actually have access to.

export type ShortcutBinding = {
  /**
   * Combo grammar: tokens joined by `+`. The last token is matched against
   * `KeyboardEvent.key` (case-insensitive). Modifier tokens accepted:
   *   `Mod`   — `Cmd` on macOS, `Ctrl` elsewhere
   *   `Shift` `Alt` `Ctrl` `Meta`
   * Examples: `"Mod+K"`, `"Mod+Shift+S"`, `"j"`, `"?"`, `"Mod+Enter"`.
   */
  combo: string;
  description: string;
  category?: string;
  run: () => void;
  /**
   * When true, the binding fires even if an input is focused or a modal is
   * open. Use sparingly — intended for combos that are themselves meant to
   * dismiss the modal that suppresses everything else (notably `Mod+K`).
   */
  global?: boolean;
};

type ParsedCombo = {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
};

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function parseCombo(combo: string): ParsedCombo | null {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const key = parts[parts.length - 1].toLowerCase();
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
  return {
    key,
    mod: mods.includes("mod"),
    shift: mods.includes("shift"),
    alt: mods.includes("alt"),
    ctrl: mods.includes("ctrl"),
    meta: mods.includes("meta"),
  };
}

function eventMatches(parsed: ParsedCombo, event: KeyboardEvent): boolean {
  // Match key by `event.key` for printable/named keys (a, /, ?, Enter, Escape, ArrowUp).
  // Lowercased so combo strings stay case-insensitive.
  if (event.key.toLowerCase() !== parsed.key) return false;
  // `Mod` collapses to metaKey on macOS, ctrlKey elsewhere. We require XOR
  // semantics: e.g. `Mod+K` should NOT fire on `Ctrl+Cmd+K` on macOS, since
  // that's a different combo the user might want to bind.
  const wantMeta = parsed.meta || (parsed.mod && isMac);
  const wantCtrl = parsed.ctrl || (parsed.mod && !isMac);
  if (event.metaKey !== wantMeta) return false;
  if (event.ctrlKey !== wantCtrl) return false;
  if (event.altKey !== parsed.alt) return false;
  // For shift, only enforce when explicitly required. Shifted printable keys
  // (e.g. "?", "*") already differ in `event.key`, so demanding `event.shiftKey`
  // for them would double-match and break.
  if (parsed.shift && !event.shiftKey) return false;
  return true;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Register a set of keyboard shortcuts on `window`. The bindings list may
 * change between renders without re-attaching the listener — handlers are
 * looked up through a ref so identity churn doesn't cause re-subscription
 * thrash.
 *
 * `suppressed` should be true when an app-level modal is open or any other
 * UI takes over the keyboard. Suppressed bindings still register but won't
 * fire unless they declare `global: true`.
 */
export function useKeyboardShortcuts(
  bindings: ShortcutBinding[],
  suppressed: boolean,
): void {
  // Pre-parse combos once per bindings change. Re-parsing inside the keydown
  // loop wastes work on every keystroke (O(bindings × combo length) per key).
  const parsedBindings = useMemo(
    () =>
      bindings
        .map((binding) => ({ binding, parsed: parseCombo(binding.combo) }))
        .filter((entry): entry is { binding: ShortcutBinding; parsed: ParsedCombo } => entry.parsed !== null),
    [bindings],
  );
  const bindingsRef = useRef(parsedBindings);
  const suppressedRef = useRef(suppressed);

  useEffect(() => {
    bindingsRef.current = parsedBindings;
  }, [parsedBindings]);

  useEffect(() => {
    suppressedRef.current = suppressed;
  }, [suppressed]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Ignore IME composition — treating partial Kana/Pinyin keystrokes as
      // shortcut activations would corrupt user input in any text field.
      if (event.isComposing) return;
      const editable = isEditableTarget(event.target);
      const isSuppressed = suppressedRef.current;
      for (const { binding, parsed } of bindingsRef.current) {
        if (!eventMatches(parsed, event)) continue;
        const hasModifier =
          parsed.mod || parsed.ctrl || parsed.meta || parsed.alt;
        if (!binding.global) {
          if (isSuppressed) continue;
          // Shortcuts without a Cmd/Ctrl/Alt modifier would otherwise eat
          // every keystroke the user types into a search field. Single-key
          // bindings are silently skipped while the focus is in an input.
          if (editable && !hasModifier) continue;
        }
        event.preventDefault();
        binding.run();
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Render-friendly representation of a combo, used by the help dialog and any
 * tooltip that wants to surface "Cmd+K" / "Ctrl+K" appropriately for the
 * current platform.
 */
export function formatCombo(combo: string): string {
  const parsed = parseCombo(combo);
  if (!parsed) return combo;
  const tokens: string[] = [];
  if (parsed.mod) tokens.push(isMac ? "⌘" : "Ctrl");
  if (parsed.meta && !parsed.mod) tokens.push("⌘");
  if (parsed.ctrl && !parsed.mod) tokens.push("Ctrl");
  if (parsed.alt) tokens.push(isMac ? "⌥" : "Alt");
  if (parsed.shift) tokens.push(isMac ? "⇧" : "Shift");
  tokens.push(formatKeyLabel(parsed.key));
  return tokens.join(isMac ? "" : "+");
}

function formatKeyLabel(key: string): string {
  switch (key) {
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    case "arrowleft":
      return "←";
    case "arrowright":
      return "→";
    case "enter":
      return "↵";
    case "escape":
      return "Esc";
    case " ":
      return "Space";
    default:
      return key.length === 1 ? key.toUpperCase() : capitalize(key);
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Group bindings for display. Preserves insertion order within each group so
 * the help dialog matches the order the bindings were declared in App.tsx
 * (which is the closest thing we have to a curated reading order).
 */
export function groupBindings(
  bindings: ShortcutBinding[],
): Array<{ category: string; items: ShortcutBinding[] }> {
  const order: string[] = [];
  const groups = new Map<string, ShortcutBinding[]>();
  for (const binding of bindings) {
    const category = binding.category ?? "General";
    if (!groups.has(category)) {
      groups.set(category, []);
      order.push(category);
    }
    groups.get(category)!.push(binding);
  }
  return order.map((category) => ({ category, items: groups.get(category)! }));
}
