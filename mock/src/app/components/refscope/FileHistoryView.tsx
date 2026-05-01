import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, History, X } from "lucide-react";
import { fetchFileHistory, type FileHistoryEntry, type FileHistoryResponse } from "../../api";
import {
  countFileChanges,
  parseUnifiedDiff,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type ParsedDiff,
} from "../../lib/parseUnifiedDiff";

/**
 * Hunk-timeline view: a per-file commit history that stacks each commit's
 * literal diff hunks newest-first.
 *
 * Boundary discipline:
 * - The API delivers the raw `git log --patch --follow` output as `entry.patch`.
 * - We feed that text straight into the same `parseUnifiedDiff` used by the
 *   per-commit viewer — no rename re-judgment, no synthetic AST. Git's own
 *   `R<NN>` similarity marker rides through unchanged and is surfaced verbatim
 *   below the file header.
 * - When the API caps at `limit + 1` and reports `truncated: true`, we surface
 *   that fact instead of pretending we have the full history.
 */
export function FileHistoryView({
  repoId,
  filePath,
  ref,
  onClose,
}: {
  repoId: string;
  filePath: string;
  ref: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<FileHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Fetch lifecycle: cancel in-flight request when inputs change or the view
  // unmounts. The dependency on `repoId`, `filePath`, `ref` mirrors the
  // PeriodSummaryView pattern — the API endpoint is the only network surface.
  useEffect(() => {
    if (!repoId || !filePath) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchFileHistory(repoId, { path: filePath, ref }, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setData(next);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Failed to load file history");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [repoId, filePath, ref]);

  // Body scroll lock + initial focus + restore-focus-on-close. Mirrors the
  // DiffViewer fullscreen overlay so keyboard users land predictably.
  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const previousOverflow = document.body.style.overflow;
    try {
      document.body.style.overflow = "hidden";
    } catch {
      // Defensive: never let style writes break the overlay.
    }
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      try {
        document.body.style.overflow = previousOverflow;
      } catch {
        // Same defensive pattern.
      }
      triggerRef.current?.focus();
    };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={`File history for ${filePath}`}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--rs-z-modal)",
        background: "var(--rs-bg-canvas)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        className="flex items-center gap-3 px-4"
        style={{
          height: 44,
          background: "var(--rs-bg-elevated)",
          borderBottom: "1px solid var(--rs-border)",
          flexShrink: 0,
        }}
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
          History
        </span>
        <span
          className="truncate"
          title={filePath}
          style={{
            fontFamily: "var(--rs-mono)",
            fontSize: 12,
            color: "var(--rs-text-primary)",
            flex: 1,
            minWidth: 0,
          }}
        >
          {filePath}
        </span>
        <span
          style={{
            fontFamily: "var(--rs-mono)",
            fontSize: 11,
            color: "var(--rs-text-muted)",
          }}
        >
          {ref}
        </span>
        {data?.truncated ? (
          <span
            role="status"
            aria-live="polite"
            className="px-2 rounded-full"
            style={{
              fontSize: 10,
              fontFamily: "var(--rs-mono)",
              color: "var(--rs-text-primary)",
              background:
                "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-warning) 18%)",
              border:
                "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 50%)",
            }}
          >
            Showing first {data.limit} commits
          </span>
        ) : null}
        <button
          ref={closeButtonRef}
          type="button"
          className="rs-icon-btn"
          aria-label="Close file history"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </header>
      <div className="overflow-y-auto" style={{ flex: 1, minHeight: 0 }}>
        {loading ? <Empty>Loading file history…</Empty> : null}
        {error ? <Empty>{error}</Empty> : null}
        {!loading && !error && data && data.entries.length === 0 ? (
          <Empty>No commits touch this file in the current ref.</Empty>
        ) : null}
        {!loading && !error && data
          ? data.entries.map((entry) => (
              <CommitCard key={entry.hash} entry={entry} />
            ))
          : null}
      </div>
    </div>
  );
}

function CommitCard({ entry }: { entry: FileHistoryEntry }) {
  // Parse the raw patch with the same hand-rolled parser used by DiffViewer so
  // hunk rendering stays consistent. The parser is permissive — malformed
  // input becomes empty hunks, never an exception.
  const parsed = useMemo(() => parseUnifiedDiff(entry.patch), [entry.patch]);
  const file = parsed.files[0] ?? null;

  return (
    <article
      style={{
        borderBottom: "1px solid var(--rs-border)",
      }}
    >
      <header
        className="px-4 py-3"
        style={{
          background: "var(--rs-bg-panel)",
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 11,
              color: "var(--rs-text-muted)",
            }}
          >
            {entry.shortHash}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--rs-text-primary)",
              flex: 1,
              minWidth: 0,
            }}
            className="truncate"
            title={entry.subject}
          >
            {entry.subject}
          </span>
        </div>
        <div
          className="flex items-center gap-2 mt-1 flex-wrap"
          style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}
        >
          <span>{entry.author}</span>
          <span style={{ color: "var(--rs-text-muted)" }}>
            · {formatDate(entry.authorDate)}
          </span>
          {file ? <FileBanner file={file} /> : null}
        </div>
      </header>
      <FileBody parsed={parsed} />
    </article>
  );
}

function FileBanner({ file }: { file: DiffFile }) {
  // We only surface what Git emitted — no inferred categories. `R<NN>` only
  // appears when Git itself reported it; refscope never fabricates similarity.
  if (file.changeKind === "renamed") {
    return (
      <span
        style={{
          fontFamily: "var(--rs-mono)",
          fontSize: 10,
          color: "var(--rs-text-muted)",
        }}
      >
        Git reported rename
        {file.similarity !== null ? ` — similarity ${file.similarity}%` : ""}
      </span>
    );
  }
  if (file.changeKind === "copied") {
    return (
      <span
        style={{
          fontFamily: "var(--rs-mono)",
          fontSize: 10,
          color: "var(--rs-text-muted)",
        }}
      >
        Git reported copy
        {file.similarity !== null ? ` — similarity ${file.similarity}%` : ""}
      </span>
    );
  }
  return null;
}

function FileBody({ parsed }: { parsed: ParsedDiff }) {
  const file = parsed.files[0];
  if (!file) {
    return (
      <div
        className="px-4 py-3"
        style={{ fontSize: 11, color: "var(--rs-text-muted)" }}
      >
        No diff hunks for this commit.
      </div>
    );
  }
  if (file.isBinary) {
    return (
      <div
        className="px-4 py-3"
        style={{ fontSize: 11, color: "var(--rs-text-muted)" }}
      >
        Binary file — diff not shown.
      </div>
    );
  }
  if (file.hunks.length === 0) {
    return (
      <div
        className="px-4 py-3"
        style={{ fontSize: 11, color: "var(--rs-text-muted)" }}
      >
        {file.changeKind === "mode-changed"
          ? "File mode changed — no content diff."
          : "No content hunks for this commit."}
      </div>
    );
  }
  const counts = countFileChanges(file);
  return (
    <div
      style={{
        background: "var(--rs-bg-canvas)",
        fontFamily: "var(--rs-mono)",
        fontSize: 12,
      }}
    >
      <div
        className="px-4 flex items-center gap-3"
        style={{
          height: 24,
          fontSize: 10,
          color: "var(--rs-text-muted)",
          letterSpacing: "0.06em",
        }}
      >
        <span style={{ color: "var(--rs-git-added)" }}>+{counts.added}</span>
        <span style={{ color: "var(--rs-git-deleted)" }}>-{counts.deleted}</span>
        <span>
          {file.hunks.length} hunk{file.hunks.length === 1 ? "" : "s"}
        </span>
      </div>
      <div role="grid" aria-label="Diff lines">
        {file.hunks.map((hunk, index) => (
          <HunkBlock key={index} hunk={hunk} />
        ))}
      </div>
    </div>
  );
}

function HunkBlock({ hunk }: { hunk: DiffHunk }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <div
        role="row"
        className="grid items-center px-2"
        style={{
          gridTemplateColumns: "44px 44px auto",
          minWidth: "100%",
          minHeight: 22,
          background:
            "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 6%)",
          color: "var(--rs-text-muted)",
          borderTop:
            "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
          borderBottom:
            "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
          fontSize: 11,
        }}
      >
        <span role="gridcell">
          <button
            type="button"
            className="rs-icon-btn"
            aria-label={collapsed ? "Expand hunk" : "Collapse hunk"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
            style={{ width: 22, height: 22 }}
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        </span>
        <span role="gridcell" />
        <span role="gridcell" className="flex items-center gap-3" style={{ minWidth: 0 }}>
          <span style={{ color: "var(--rs-text-secondary)", whiteSpace: "nowrap" }}>
            {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
          </span>
          {hunk.sectionHeading ? (
            <span className="truncate" style={{ color: "var(--rs-text-muted)" }}>
              {hunk.sectionHeading}
            </span>
          ) : null}
        </span>
      </div>
      {collapsed
        ? null
        : hunk.lines.map((line, lineIndex) => (
            <DiffLineRow key={lineIndex} line={line} />
          ))}
    </>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const sigil = sigilFor(line);
  const oldNo = line.kind === "context" || line.kind === "del" ? line.oldLineNo : "";
  const newNo = line.kind === "context" || line.kind === "add" ? line.newLineNo : "";
  // Reuse the rs-diff-* classes so the CVD-safe theme's left-bar / pattern
  // signals attach automatically — no theming code is needed here.
  const rowClass = `grid px-2 rs-diff-${
    line.kind === "add" ? "add" : line.kind === "del" ? "del" : "context"
  }`;
  return (
    <div
      role="row"
      className={rowClass}
      // backgroundColor (longhand) so the CSS background-image stripe pattern
      // for CVD-safe theme survives — same reasoning as DiffViewer.tsx.
      style={{
        gridTemplateColumns: "44px 44px auto",
        minWidth: "100%",
        minHeight: 20,
        backgroundColor: backgroundForLine(line),
        color: line.kind === "no-newline" ? "var(--rs-text-muted)" : "var(--rs-text-primary)",
        fontStyle: line.kind === "no-newline" ? "italic" : "normal",
      }}
    >
      <span
        role="gridcell"
        style={{
          color: "var(--rs-text-muted)",
          fontSize: 11,
          textAlign: "right",
          paddingRight: 6,
          userSelect: "none",
        }}
      >
        {oldNo}
      </span>
      <span
        role="gridcell"
        style={{
          color: "var(--rs-text-muted)",
          fontSize: 11,
          textAlign: "right",
          paddingRight: 6,
          userSelect: "none",
        }}
      >
        {newNo}
      </span>
      <span role="gridcell" className="flex" style={{ minWidth: 0, gap: 0 }}>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 14,
            color: colorForSigil(line),
            flexShrink: 0,
            textAlign: "center",
          }}
        >
          {sigil}
        </span>
        <span style={{ whiteSpace: "pre", flexShrink: 0 }}>{line.text}</span>
      </span>
    </div>
  );
}

function sigilFor(line: DiffLine): string {
  switch (line.kind) {
    case "add":
      return "+";
    case "del":
      return "-";
    case "no-newline":
      return "\\";
    case "context":
      return " ";
  }
}

function colorForSigil(line: DiffLine): string {
  switch (line.kind) {
    case "add":
      return "var(--rs-git-added)";
    case "del":
      return "var(--rs-git-deleted)";
    default:
      return "var(--rs-text-muted)";
  }
}

function backgroundForLine(line: DiffLine): string {
  switch (line.kind) {
    case "add":
      return "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-git-added) 14%)";
    case "del":
      return "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-git-deleted) 14%)";
    case "no-newline":
      return "var(--rs-bg-elevated)";
    case "context":
      return "transparent";
  }
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6" style={{ fontSize: 12, color: "var(--rs-text-muted)" }}>
      {children}
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
