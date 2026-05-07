import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, History, X } from "lucide-react";
import {
  fetchSymbolHistory,
  type SymbolHistoryEntry,
  type SymbolHistoryResponse,
} from "../../api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string; hint?: string }
  | { kind: "success"; data: SymbolHistoryResponse };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTime(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CommitEntry({ entry }: { entry: SymbolHistoryEntry }) {
  const hasRename = entry.renameInfo !== null;
  return (
    <article
      style={{
        borderBottom: "1px solid var(--rs-border)",
        padding: "10px 14px",
      }}
    >
      {/* Rename indicator */}
      {hasRename && entry.renameInfo && (
        <div
          role="note"
          aria-label="File renamed at this commit"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 6,
            padding: "3px 8px",
            borderRadius: "var(--rs-radius-sm)",
            background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 12%)",
            border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 40%)",
            fontSize: 11,
            color: "var(--rs-accent)",
          }}
        >
          <ArrowRight size={11} aria-hidden />
          <span>
            Renamed from{" "}
            <code
              style={{
                fontFamily: "var(--rs-mono)",
                background: "var(--rs-bg-code)",
                padding: "0 3px",
                borderRadius: 3,
              }}
            >
              {entry.renameInfo.from}
            </code>
            {" → "}
            <code
              style={{
                fontFamily: "var(--rs-mono)",
                background: "var(--rs-bg-code)",
                padding: "0 3px",
                borderRadius: 3,
              }}
            >
              {entry.renameInfo.to}
            </code>
            {entry.renameInfo.similarity !== null && (
              <span style={{ color: "var(--rs-text-secondary)", marginLeft: 4 }}>
                ({entry.renameInfo.similarity}% similar — Git literal)
              </span>
            )}
          </span>
        </div>
      )}

      {/* Commit subject */}
      <p
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 500,
          color: "var(--rs-text)",
          lineHeight: 1.4,
        }}
      >
        {entry.subject}
      </p>

      {/* Commit body */}
      {entry.body && (
        <pre
          style={{
            margin: "4px 0 0",
            fontSize: 11,
            color: "var(--rs-text-secondary)",
            fontFamily: "var(--rs-sans)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            lineHeight: 1.5,
            maxHeight: 80,
            overflow: "hidden",
          }}
        >
          {entry.body}
        </pre>
      )}

      {/* Meta row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 5,
          fontSize: 11,
          color: "var(--rs-text-secondary)",
        }}
      >
        <code
          style={{
            fontFamily: "var(--rs-mono)",
            background: "var(--rs-bg-code)",
            padding: "1px 4px",
            borderRadius: 3,
            fontSize: 10,
          }}
        >
          {entry.shortHash}
        </code>
        <span>{entry.author}</span>
        <time dateTime={entry.authorDate} title={entry.authorDate}>
          {formatDate(entry.authorDate)} {formatTime(entry.authorDate)}
        </time>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Symbol History View (D-1)
 *
 * Displays the commit history for a named symbol (function / method) in a file,
 * using `git log -L :<funcname>:<path>` on the API side.
 *
 * Boundary discipline:
 * - All data is observed Git output, never inferred by Refscope.
 * - Rename evidence comes from Git's literal diff output (no Refscope heuristics).
 * - Inputs are validated in the API layer; this component only passes user input
 *   to `fetchSymbolHistory` which forwards it via URL params.
 */
export function SymbolHistoryView({
  repoId,
  query,
  onClose,
  onQueryChange,
}: {
  repoId: string;
  /** Current search query. null = show the empty input form. */
  query: { path: string; funcname: string } | null;
  onClose: () => void;
  /** Called when the user submits a new search. */
  onQueryChange: (q: { path: string; funcname: string } | null) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });
  const [localPath, setLocalPath] = useState(query?.path ?? "");
  const [localFuncname, setLocalFuncname] = useState(query?.funcname ?? "");
  const abortRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Sync local inputs when parent changes query
  useEffect(() => {
    if (query) {
      setLocalPath(query.path);
      setLocalFuncname(query.funcname);
    }
  }, [query]);

  // Focus close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Trap focus within overlay
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    overlay.addEventListener("keydown", handleKeyDown);
    return () => overlay.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Fetch when query changes
  useEffect(() => {
    if (!query || !repoId) {
      setLoadState({ kind: "idle" });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadState({ kind: "loading" });

    fetchSymbolHistory(
      repoId,
      { path: query.path, funcname: query.funcname },
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setLoadState({ kind: "success", data });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : String(err);
        // Surface any hint from the server-side 404 response
        const hint =
          err instanceof Error && "hint" in err
            ? String((err as { hint?: unknown }).hint)
            : undefined;
        setLoadState({ kind: "error", message, hint });
      });

    return () => {
      controller.abort();
    };
  }, [repoId, query]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimPath = localPath.trim();
      const trimFuncname = localFuncname.trim();
      if (!trimPath || !trimFuncname) return;
      onQueryChange({ path: trimPath, funcname: trimFuncname });
    },
    [localPath, localFuncname, onQueryChange],
  );

  const handleClear = useCallback(() => {
    setLocalPath("");
    setLocalFuncname("");
    onQueryChange(null);
    setLoadState({ kind: "idle" });
  }, [onQueryChange]);

  return (
    <div
      ref={overlayRef}
      role="region"
      aria-label="Symbol History"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--rs-bg-panel)",
        borderLeft: "1px solid var(--rs-border)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--rs-border)",
          flexShrink: 0,
        }}
      >
        <History size={14} aria-hidden style={{ color: "var(--rs-accent)" }} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--rs-text)",
            flex: 1,
          }}
        >
          Symbol History
        </span>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close symbol history"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            borderRadius: "var(--rs-radius-sm)",
            color: "var(--rs-text-secondary)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      {/* Search form */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--rs-border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <label
          htmlFor="sym-hist-path"
          style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}
        >
          File path
        </label>
        <input
          id="sym-hist-path"
          type="text"
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
          placeholder="e.g. src/parser/scope.go"
          autoComplete="off"
          spellCheck={false}
          style={{
            fontSize: 12,
            fontFamily: "var(--rs-mono)",
            padding: "4px 8px",
            borderRadius: "var(--rs-radius-sm)",
            border: "1px solid var(--rs-border)",
            background: "var(--rs-bg-input)",
            color: "var(--rs-text)",
            outline: "none",
          }}
        />
        <label
          htmlFor="sym-hist-func"
          style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}
        >
          Symbol name
        </label>
        <input
          id="sym-hist-func"
          type="text"
          value={localFuncname}
          onChange={(e) => setLocalFuncname(e.target.value)}
          placeholder="e.g. parseRefScope"
          autoComplete="off"
          spellCheck={false}
          style={{
            fontSize: 12,
            fontFamily: "var(--rs-mono)",
            padding: "4px 8px",
            borderRadius: "var(--rs-radius-sm)",
            border: "1px solid var(--rs-border)",
            background: "var(--rs-bg-input)",
            color: "var(--rs-text)",
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
          <button
            type="submit"
            disabled={!localPath.trim() || !localFuncname.trim()}
            style={{
              flex: 1,
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: "var(--rs-radius-sm)",
              border: "1px solid var(--rs-border)",
              background: "var(--rs-accent)",
              color: "var(--rs-bg)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Search
          </button>
          {query && (
            <button
              type="button"
              onClick={handleClear}
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: "var(--rs-radius-sm)",
                border: "1px solid var(--rs-border)",
                background: "transparent",
                color: "var(--rs-text-secondary)",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {/* Results */}
      <div
        style={{ flex: 1, overflow: "auto" }}
        tabIndex={-1}
        aria-live="polite"
        aria-busy={loadState.kind === "loading"}
      >
        {loadState.kind === "idle" && (
          <p
            style={{
              padding: "20px 16px",
              fontSize: 12,
              color: "var(--rs-text-secondary)",
              textAlign: "center",
            }}
          >
            Enter a file path and symbol name to view its history.
          </p>
        )}

        {loadState.kind === "loading" && (
          <p
            style={{
              padding: "20px 16px",
              fontSize: 12,
              color: "var(--rs-text-secondary)",
              textAlign: "center",
            }}
          >
            Tracing symbol history…
          </p>
        )}

        {loadState.kind === "error" && (
          <div
            role="alert"
            style={{
              padding: "16px",
              margin: "12px",
              borderRadius: "var(--rs-radius-sm)",
              border: "1px solid color-mix(in oklab, var(--rs-border), red 40%)",
              background: "color-mix(in oklab, var(--rs-bg-elevated), red 8%)",
              fontSize: 12,
              color: "var(--rs-text)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              <AlertCircle size={13} aria-hidden style={{ flexShrink: 0 }} />
              {loadState.message}
            </div>
            {loadState.hint && (
              <p
                style={{
                  margin: 0,
                  color: "var(--rs-text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                {loadState.hint}
              </p>
            )}
          </div>
        )}

        {loadState.kind === "success" && (
          <>
            {/* Summary bar */}
            <div
              style={{
                padding: "6px 14px",
                borderBottom: "1px solid var(--rs-border)",
                fontSize: 11,
                color: "var(--rs-text-secondary)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <code
                style={{
                  fontFamily: "var(--rs-mono)",
                  background: "var(--rs-bg-code)",
                  padding: "1px 4px",
                  borderRadius: 3,
                  color: "var(--rs-text)",
                  fontSize: 11,
                }}
              >
                {loadState.data.funcname}
              </code>
              <span>in</span>
              <code
                style={{
                  fontFamily: "var(--rs-mono)",
                  background: "var(--rs-bg-code)",
                  padding: "1px 4px",
                  borderRadius: 3,
                  color: "var(--rs-text)",
                  fontSize: 11,
                  maxWidth: 200,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={loadState.data.path}
              >
                {loadState.data.path}
              </code>
              <span style={{ marginLeft: "auto" }}>
                {loadState.data.entries.length} commit
                {loadState.data.entries.length !== 1 ? "s" : ""}
                {loadState.data.truncated && " (truncated)"}
              </span>
            </div>

            {/* No results */}
            {loadState.data.entries.length === 0 && (
              <p
                style={{
                  padding: "20px 16px",
                  fontSize: 12,
                  color: "var(--rs-text-secondary)",
                  textAlign: "center",
                }}
              >
                No commits found for this symbol.
              </p>
            )}

            {/* Commit list */}
            {loadState.data.entries.map((entry) => (
              <CommitEntry key={entry.hash} entry={entry} />
            ))}

            {/* Truncation notice */}
            {loadState.data.truncated && (
              <p
                style={{
                  padding: "8px 14px",
                  fontSize: 11,
                  color: "var(--rs-text-secondary)",
                  textAlign: "center",
                  borderTop: "1px solid var(--rs-border)",
                }}
              >
                Showing {loadState.data.limit} of more commits. Increase{" "}
                <code style={{ fontFamily: "var(--rs-mono)" }}>limit</code> to see more.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
