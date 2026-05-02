import { useEffect, useMemo, useRef, useState } from "react";
import { History, X } from "lucide-react";

/**
 * Path-input prompt that opens the FileHistoryView for an arbitrary path.
 *
 * Design notes:
 * - The validation rules below mirror the API's `parsePathQuery`
 *   (`apps/api/src/validation.js`) so we never round-trip an obviously-bad
 *   value to the network. Server-side validation is still authoritative — this
 *   is a UX shortcut, not a security boundary.
 * - The control-character regex matches U+0000-U+001F and U+007F, identical
 *   to `CONTROL_CHARACTER_PATTERN` in validation.js.
 * - Suggestion list is rendered as a custom listbox (not a `<datalist>`) so
 *   the experience is keyboard-driven and styled with the rest of refscope.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1F\x7F]/;

export type ValidatePathResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validatePath(input: string): ValidatePathResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Path is required" };
  }
  if (trimmed.length > 200) {
    return { ok: false, error: "Path is too long (max 200 characters)" };
  }
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    return { ok: false, error: "Path contains control characters" };
  }
  if (trimmed.startsWith("/")) {
    return { ok: false, error: "Path must be relative (no leading '/')" };
  }
  if (trimmed.startsWith("-")) {
    return { ok: false, error: "Path must not start with '-'" };
  }
  if (
    trimmed
      .split("/")
      .some((component) => component === "" || component === "." || component === "..")
  ) {
    return { ok: false, error: "Path contains an invalid segment ('.', '..', or empty)" };
  }
  return { ok: true, value: trimmed };
}

export function FileHistoryPrompt({
  open,
  onSubmit,
  onClose,
  suggestions,
}: {
  open: boolean;
  onSubmit: (path: string) => void;
  onClose: () => void;
  suggestions?: string[];
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  // -1 means "no suggestion is highlighted" — Enter then submits the typed value.
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Reset transient state on each open. If the user dismissed and reopens, we
  // start fresh — opening on the previous error or the previous typed value
  // would feel haunted.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    setValue("");
    setError("");
    setActiveSuggestion(-1);
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      // Restore focus to the trigger that opened us — same a11y pattern as
      // FileHistoryView and the diff fullscreen overlay.
      triggerRef.current?.focus();
    };
  }, [open]);

  // Filter the dedup'd suggestion list by the current input. We use
  // `includes` (not just startsWith) so partial matches inside path segments
  // are visible — long monorepo paths benefit from the looser match.
  const filteredSuggestions = useMemo(() => {
    if (!suggestions || suggestions.length === 0) return [];
    const seen = new Set<string>();
    const trimmed = value.trim().toLowerCase();
    const results: string[] = [];
    for (const candidate of suggestions) {
      if (typeof candidate !== "string" || candidate.length === 0) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (trimmed && !candidate.toLowerCase().includes(trimmed)) continue;
      results.push(candidate);
      if (results.length >= 8) break;
    }
    return results;
  }, [suggestions, value]);

  // Clamp activeSuggestion when the visible list shrinks — otherwise an old
  // index can outlive its option and the keyboard model goes out of sync.
  useEffect(() => {
    setActiveSuggestion((prev) =>
      filteredSuggestions.length === 0
        ? -1
        : Math.min(prev, filteredSuggestions.length - 1),
    );
  }, [filteredSuggestions.length]);

  function commit(rawValue: string) {
    const result = validatePath(rawValue);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    onSubmit(result.value);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeSuggestion >= 0 && filteredSuggestions[activeSuggestion]) {
      commit(filteredSuggestions[activeSuggestion]);
      return;
    }
    commit(value);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (filteredSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) =>
        current >= filteredSuggestions.length - 1 ? 0 : current + 1,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) =>
        current <= 0 ? filteredSuggestions.length - 1 : current - 1,
      );
    } else if (event.key === "Tab" && activeSuggestion >= 0) {
      // Tab autocompletes the highlighted suggestion into the input. We do
      // not commit yet — the user may still want to edit before submitting.
      event.preventDefault();
      const picked = filteredSuggestions[activeSuggestion];
      if (picked) {
        setValue(picked);
        setActiveSuggestion(-1);
      }
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Open file history"
      className="fixed inset-0 grid place-items-start justify-center pt-[18vh]"
      style={{
        background: "color-mix(in oklab, black, transparent 50%)",
        zIndex: "var(--rs-z-modal)",
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl overflow-hidden"
        style={{
          background: "var(--rs-bg-elevated)",
          border: "1px solid var(--rs-border)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div
            className="flex items-center gap-2 px-4"
            style={{ height: 48, borderBottom: "1px solid var(--rs-border)" }}
          >
            <History size={14} aria-hidden style={{ color: "var(--rs-accent)" }} />
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                fontWeight: 600,
                color: "var(--rs-text-muted)",
                textTransform: "uppercase",
              }}
            >
              Open file history
            </span>
            <div className="flex-1" />
            <button
              type="button"
              className="rs-icon-btn"
              aria-label="Close file history prompt"
              title="Close (Esc)"
              onClick={onClose}
            >
              <X size={13} />
            </button>
          </div>
          <div className="px-4 py-3">
            <label
              htmlFor="rs-file-history-path"
              style={{
                display: "block",
                fontSize: 11,
                color: "var(--rs-text-muted)",
                marginBottom: 6,
                fontFamily: "var(--rs-mono)",
              }}
            >
              Path (relative to repository root)
            </label>
            <input
              id="rs-file-history-path"
              ref={inputRef}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) setError("");
                setActiveSuggestion(-1);
              }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. src/app/api.ts"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "rs-file-history-path-error" : undefined}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 outline-none"
              style={{
                height: 32,
                background: "var(--rs-bg-canvas)",
                border: error
                  ? "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 60%)"
                  : "1px solid var(--rs-border)",
                borderRadius: "var(--rs-radius-sm)",
                color: "var(--rs-text-primary)",
                fontFamily: "var(--rs-mono)",
                fontSize: 12,
              }}
            />
            {error ? (
              <div
                id="rs-file-history-path-error"
                role="alert"
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: "var(--rs-warning)",
                }}
              >
                {error}
              </div>
            ) : null}
            {filteredSuggestions.length > 0 ? (
              <ul
                role="listbox"
                aria-label="Path suggestions"
                className="rounded-md overflow-hidden"
                style={{
                  marginTop: 8,
                  border: "1px solid var(--rs-border)",
                  background: "var(--rs-bg-canvas)",
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                {filteredSuggestions.map((suggestion, index) => {
                  const isActive = index === activeSuggestion;
                  return (
                    <li
                      key={suggestion}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveSuggestion(index)}
                      onMouseDown={(event) => {
                        // mousedown (not click) so the input doesn't lose
                        // focus before the selection settles.
                        event.preventDefault();
                        setValue(suggestion);
                        setActiveSuggestion(-1);
                        commit(suggestion);
                      }}
                      className="px-3 truncate cursor-pointer"
                      style={{
                        height: 28,
                        display: "flex",
                        alignItems: "center",
                        fontFamily: "var(--rs-mono)",
                        fontSize: 12,
                        color: "var(--rs-text-primary)",
                        background: isActive
                          ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 16%)"
                          : "transparent",
                      }}
                      title={suggestion}
                    >
                      {suggestion}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          <div
            className="px-4 flex items-center justify-end gap-2"
            style={{
              height: 44,
              borderTop: "1px solid var(--rs-border)",
              background: "var(--rs-bg-panel)",
            }}
          >
            <button
              type="button"
              className="rs-compact-button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rs-btn rs-btn--accent"
              disabled={!value.trim()}
              style={{ opacity: value.trim() ? 1 : 0.55 }}
            >
              Open history
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
