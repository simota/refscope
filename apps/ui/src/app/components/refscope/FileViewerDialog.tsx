/**
 * FileViewerDialog — the whole file as it was at a commit (or at its first
 * parent), not just the hunks a diff shows.
 *
 * Flow: open from a changed file (list / tree / diff header) → read the file
 * at the commit → flip to "Before" to read the parent's version → select
 * lines in the gutter (shift-click extends) → "Trace" runs range history
 * (`git log -L`) for exactly those lines starting at this commit → pick a
 * commit to jump the timeline/detail to it.
 *
 * "Blame" annotates every line with the commit that last changed it
 * (GET /files/blame at the shown revision); a gutter label opens that
 * commit. Read-only: content comes from GET /files/content (raw `cat-file`, capped
 * and binary-aware on the server). Copy / download act on what was fetched.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Copy, Download, FileCode, History, Search, UserRound, WrapText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  fetchFileBlame,
  fetchFileContent,
  fetchRangeHistory,
  type BlameCommit,
  type FileBlameResponse,
  type FileContentResponse,
  type RangeHistoryResponse,
} from "../../api";
import { detectLanguage, highlightLines, type HighlightedRun } from "../../lib/syntaxHighlight";
import { BLAME_AGE_BUCKETS, blameAgeBuckets, groupBlameRuns, shortAge } from "../../lib/blame";

type BlameState =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; result: FileBlameResponse };

/** Gutter view of a blame result: label at each run start, shade per line. */
type BlameView = {
  runStarts: Map<number, { commit: BlameCommit; lines: number }>;
  hashByLine: Map<number, string>;
  ages: Map<string, number>;
};

export type FileViewerTarget = {
  path: string;
  /** Commit whose version is shown on the "after" side. */
  commit: string;
  /** First parent, for the "before" side; null for a root commit. */
  parent: string | null;
  /** Path on the parent side when the file was renamed in this commit. */
  beforePath?: string;
  side: "after" | "before";
};

// Whole-file Prism passes are synchronous; beyond this the viewer renders
// plain text so a large generated file cannot freeze the tab.
const HIGHLIGHT_MAX_CHARS = 200_000;

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string; notFound: boolean }
  | { kind: "ready"; file: FileContentResponse };

type LineSelection = { start: number; end: number } | null;

export function FileViewerDialog({
  repoId,
  target,
  onClose,
  onOpenHistory,
  onSelectCommit,
}: {
  repoId: string;
  target: FileViewerTarget | null;
  onClose: () => void;
  onOpenHistory?: (path: string) => void;
  onSelectCommit?: (hash: string) => void;
}) {
  const [side, setSide] = useState<"after" | "before">(target?.side ?? "after");
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [wrap, setWrap] = useState(false);
  const [selection, setSelection] = useState<LineSelection>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [trace, setTrace] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; result: RangeHistoryResponse }
  >({ kind: "idle" });
  const traceAbortRef = useRef<AbortController | null>(null);
  const [blameOn, setBlameOn] = useState(false);
  const [blame, setBlame] = useState<BlameState>({ kind: "off" });

  // Reset per-target state whenever a different file/commit is opened.
  const targetKey = target ? `${target.commit}\0${target.path}\0${target.side}` : "";
  useEffect(() => {
    setSide(target?.side ?? "after");
    setSelection(null);
    setTrace({ kind: "idle" });
    setCopyStatus("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const revision = target ? (side === "before" ? target.parent : target.commit) : null;
  // A renamed file has a different name on the parent side.
  const viewPath = target ? (side === "before" ? target.beforePath ?? target.path : target.path) : "";

  useEffect(() => {
    if (!target || !revision || !repoId) {
      setState({ kind: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    setSelection(null);
    setTrace({ kind: "idle" });
    traceAbortRef.current?.abort();
    fetchFileContent(repoId, revision, viewPath, ctrl.signal)
      .then((file) => {
        if (!ctrl.signal.aborted) setState({ kind: "ready", file });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message, notFound: /not found at this commit/i.test(message) });
      });
    return () => ctrl.abort();
  }, [repoId, revision, target, viewPath]);

  useEffect(() => () => traceAbortRef.current?.abort(), []);

  // Blame follows the shown revision/path; it is fetched only while enabled.
  useEffect(() => {
    if (!blameOn || !target || !revision || !repoId) {
      setBlame({ kind: "off" });
      return;
    }
    const ctrl = new AbortController();
    setBlame({ kind: "loading" });
    fetchFileBlame(repoId, revision, viewPath, ctrl.signal)
      .then((result) => {
        if (!ctrl.signal.aborted) setBlame({ kind: "ready", result });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setBlame({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [blameOn, repoId, revision, target, viewPath]);

  const blameView = useMemo<BlameView | null>(() => {
    if (blame.kind !== "ready") return null;
    const commitsByHash = new Map(blame.result.commits.map((commit) => [commit.hash, commit]));
    const runStarts: BlameView["runStarts"] = new Map();
    for (const run of groupBlameRuns(blame.result.lines)) {
      const commit = commitsByHash.get(run.hash);
      if (commit) runStarts.set(run.startLine, { commit, lines: run.endLine - run.startLine + 1 });
    }
    return {
      runStarts,
      hashByLine: new Map(blame.result.lines.map((line) => [line.line, line.hash])),
      ages: blameAgeBuckets(blame.result.commits),
    };
  }, [blame]);

  const file = state.kind === "ready" ? state.file : null;
  const language = useMemo(() => (viewPath ? detectLanguage(viewPath) : null), [viewPath]);
  const lines = useMemo(() => {
    if (!file || file.content == null) return [];
    const text = file.content.endsWith("\n") ? file.content.slice(0, -1) : file.content;
    return file.content === "" ? [] : text.split("\n");
  }, [file]);
  const highlighted = useMemo<HighlightedRun[][] | null>(() => {
    if (!file || file.content == null || file.content.length > HIGHLIGHT_MAX_CHARS) return null;
    return highlightLines(file.content, language);
  }, [file, language]);

  const handleGutterClick = useCallback((line: number, extend: boolean) => {
    setSelection((current) => {
      if (extend && current) {
        const anchor = current.start;
        return { start: Math.min(anchor, line), end: Math.max(anchor, line) };
      }
      if (current && current.start === line && current.end === line) return null;
      return { start: line, end: line };
    });
  }, []);

  const runTrace = useCallback(
    async (range: { start: number; end: number }) => {
      if (!target || !revision) return;
      traceAbortRef.current?.abort();
      const ctrl = new AbortController();
      traceAbortRef.current = ctrl;
      setTrace({ kind: "loading" });
      try {
        const result = await fetchRangeHistory(
          repoId,
          { path: viewPath, lineStart: range.start, lineEnd: range.end, ref: revision },
          ctrl.signal,
        );
        if (!ctrl.signal.aborted) setTrace({ kind: "ready", result });
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setTrace({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    },
    [repoId, revision, target, viewPath],
  );

  const copyContent = useCallback(async () => {
    if (!file?.content) return;
    const text =
      selection && lines.length
        ? lines.slice(selection.start - 1, selection.end).join("\n") + "\n"
        : file.content;
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(selection ? `Copied lines ${selection.start}–${selection.end}` : "Copied file");
    } catch {
      setCopyStatus("Clipboard unavailable");
    }
  }, [file, lines, selection]);

  const download = useCallback(() => {
    if (!file?.content || !viewPath) return;
    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const base = viewPath.split("/").pop() || "file";
    anchor.download = `${file.commit.slice(0, 7)}-${base}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [file, viewPath]);

  const open = target !== null;
  const shortRevision = revision ? revision.slice(0, 7) : "";

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        className="bg-[var(--rs-bg-elevated)] border-[var(--rs-border)] text-[var(--rs-text-primary)] shadow-[0_24px_60px_rgba(0,0,0,0.55)] sm:max-w-[min(1100px,calc(100vw-2rem))] w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] p-4 gap-3 grid-rows-[auto_auto_minmax(0,1fr)_auto] [&>button]:text-[var(--rs-text-secondary)] [&>button]:opacity-100"
        style={{ height: "min(860px, calc(100dvh - 2rem))" }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="text-[var(--rs-text-primary)]">
            <span className="flex items-center gap-2 min-w-0" style={{ fontSize: 14 }}>
              <FileCode size={15} aria-hidden className="shrink-0" />
              <span className="truncate" style={{ fontFamily: "var(--rs-mono)" }} title={viewPath}>
                {viewPath}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="text-[var(--rs-text-secondary)]" style={{ fontSize: 12 }}>
            {side === "before"
              ? `As it was before this commit (parent ${shortRevision})${
                  target?.beforePath && target.beforePath !== target.path ? `, before the rename to ${target.path}` : ""
                }.`
              : `As it was at commit ${shortRevision}.`}{" "}
            {file
              ? `${file.lineCount ?? 0} lines · ${formatBytes(file.size)}${file.truncated ? " · truncated" : ""}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="File viewer actions">
          <div role="radiogroup" aria-label="Version" className="inline-flex" style={{ gap: 0 }}>
            <SideButton
              active={side === "after"}
              onClick={() => setSide("after")}
              label="At commit"
              position="first"
            />
            <SideButton
              active={side === "before"}
              onClick={() => setSide("before")}
              label="Before"
              position="last"
              disabled={!target?.parent}
              title={target?.parent ? `Parent ${target.parent.slice(0, 7)}` : "Root commit has no parent"}
            />
          </div>
          <button
            type="button"
            className="rs-compact-button"
            aria-pressed={wrap}
            onClick={() => setWrap((w) => !w)}
            title="Wrap long lines"
          >
            <WrapText size={11} aria-hidden style={{ marginRight: 4 }} />
            Wrap
          </button>
          <button
            type="button"
            className="rs-compact-button"
            onClick={() => void copyContent()}
            disabled={!file?.content}
          >
            <Copy size={11} aria-hidden style={{ marginRight: 4 }} />
            {selection ? "Copy lines" : "Copy"}
          </button>
          <button type="button" className="rs-compact-button" onClick={download} disabled={!file?.content}>
            <Download size={11} aria-hidden style={{ marginRight: 4 }} />
            Download
          </button>
          <button
            type="button"
            className="rs-compact-button"
            aria-pressed={blameOn}
            onClick={() => setBlameOn((value) => !value)}
            disabled={!file || file.binary || lines.length === 0}
            title="Show who last changed each line (git blame) at this version"
            style={
              blameOn
                ? {
                    color: "var(--rs-text-primary)",
                    borderColor: "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
                    background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 22%)",
                  }
                : undefined
            }
          >
            <UserRound size={11} aria-hidden style={{ marginRight: 4 }} />
            {blame.kind === "loading" ? "Blaming…" : "Blame"}
          </button>
          {onOpenHistory && target ? (
            <button
              type="button"
              className="rs-compact-button"
              onClick={() => {
                onOpenHistory(target.path);
                onClose();
              }}
            >
              <History size={11} aria-hidden style={{ marginRight: 4 }} />
              File history
            </button>
          ) : null}
          <TraceForm
            key={`${targetKey}\0${side}`}
            selection={selection}
            maxLine={lines.length}
            disabled={!file || file.content == null || lines.length === 0}
            busy={trace.kind === "loading"}
            onSelectionChange={setSelection}
            onTrace={(range) => void runTrace(range)}
          />
          <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--rs-text-muted)" }}>
            {copyStatus}
            {blame.kind === "ready"
              ? `${copyStatus ? " · " : ""}Blame: ${blame.result.commits.length} commit${blame.result.commits.length === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
        {blame.kind === "error" ? (
          <p role="alert" style={{ fontSize: 11, color: "var(--rs-warning)", margin: 0 }}>
            Blame unavailable: {blame.message}
          </p>
        ) : null}

        <div
          className="overflow-auto min-h-0"
          style={{
            border: "1px solid var(--rs-border)",
            borderRadius: "var(--rs-radius-sm)",
            background: "var(--rs-bg-canvas)",
          }}
        >
          {state.kind === "loading" ? (
            <ViewerMessage>Loading file…</ViewerMessage>
          ) : state.kind === "error" ? (
            <ViewerMessage tone={state.notFound ? "muted" : "warning"}>
              {state.notFound
                ? side === "before"
                  ? "This file did not exist before this commit (it was added or renamed here)."
                  : "This file does not exist at this commit (it was deleted or renamed). Try “Before”."
                : state.message}
            </ViewerMessage>
          ) : file?.binary ? (
            <ViewerMessage>Binary file ({formatBytes(file.size)}) — not shown.</ViewerMessage>
          ) : file && lines.length === 0 ? (
            <ViewerMessage>Empty file.</ViewerMessage>
          ) : file ? (
            <FileLines
              lines={lines}
              highlighted={highlighted}
              wrap={wrap}
              selection={selection}
              onGutterClick={handleGutterClick}
              blame={blameView}
              onSelectCommit={
                onSelectCommit
                  ? (hash) => {
                      onSelectCommit(hash);
                      onClose();
                    }
                  : undefined
              }
            />
          ) : null}
          {file?.truncated ? (
            <ViewerMessage tone="warning">
              Showing the first {formatBytes(file.maxBytes)} of {formatBytes(file.size)}. Use Download from a local
              checkout for the full file.
            </ViewerMessage>
          ) : null}
        </div>

        <TraceResults
          trace={trace}
          onSelectCommit={
            onSelectCommit
              ? (hash) => {
                  onSelectCommit(hash);
                  onClose();
                }
              : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}

function SideButton({
  active,
  onClick,
  label,
  position,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  position: "first" | "last";
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className="rs-compact-button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        borderRadius:
          position === "first"
            ? "var(--rs-radius-sm) 0 0 var(--rs-radius-sm)"
            : "0 var(--rs-radius-sm) var(--rs-radius-sm) 0",
        marginLeft: position === "last" ? -1 : 0,
        color: active ? "var(--rs-text-primary)" : undefined,
        background: active ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 22%)" : undefined,
        borderColor: active ? "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)" : undefined,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

/**
 * Line-range input for tracing. Mirrors the gutter selection so keyboard
 * users get the same capability as shift-clicking line numbers.
 */
function TraceForm({
  selection,
  maxLine,
  disabled,
  busy,
  onSelectionChange,
  onTrace,
}: {
  selection: LineSelection;
  maxLine: number;
  disabled: boolean;
  busy: boolean;
  onSelectionChange: (next: LineSelection) => void;
  onTrace: (range: { start: number; end: number }) => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  useEffect(() => {
    setStart(selection ? String(selection.start) : "");
    setEnd(selection ? String(selection.end) : "");
  }, [selection]);
  const parsedStart = Number.parseInt(start, 10);
  const parsedEnd = Number.parseInt(end || start, 10);
  const valid =
    Number.isInteger(parsedStart) &&
    Number.isInteger(parsedEnd) &&
    parsedStart >= 1 &&
    parsedEnd >= parsedStart &&
    parsedEnd <= Math.max(1, maxLine);
  const commit = () => {
    if (valid) onSelectionChange({ start: parsedStart, end: parsedEnd });
  };
  return (
    <form
      className="inline-flex items-center gap-1"
      style={{ marginLeft: "auto" }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSelectionChange({ start: parsedStart, end: parsedEnd });
        onTrace({ start: parsedStart, end: parsedEnd });
      }}
    >
      <label style={{ fontSize: 11, color: "var(--rs-text-secondary)" }} htmlFor="file-viewer-trace-start">
        Lines
      </label>
      <input
        id="file-viewer-trace-start"
        inputMode="numeric"
        aria-label="First line to trace"
        value={start}
        disabled={disabled}
        onChange={(e) => setStart(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        placeholder="from"
        style={LINE_INPUT_STYLE}
      />
      <span aria-hidden style={{ color: "var(--rs-text-muted)", fontSize: 11 }}>–</span>
      <input
        inputMode="numeric"
        aria-label="Last line to trace"
        value={end}
        disabled={disabled}
        onChange={(e) => setEnd(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        placeholder="to"
        style={LINE_INPUT_STYLE}
      />
      <button
        type="submit"
        className="rs-compact-button"
        disabled={disabled || !valid || busy}
        title="Show the commits that shaped these lines (git log -L), starting at this version"
      >
        <Search size={11} aria-hidden style={{ marginRight: 4 }} />
        {busy ? "Tracing…" : "Trace"}
      </button>
    </form>
  );
}

const LINE_INPUT_STYLE = {
  width: 52,
  height: 24,
  padding: "0 6px",
  fontSize: 11,
  fontFamily: "var(--rs-mono)",
  color: "var(--rs-text-primary)",
  background: "var(--rs-bg-canvas)",
  border: "1px solid var(--rs-border)",
  borderRadius: "var(--rs-radius-sm)",
} as const;

function FileLines({
  lines,
  highlighted,
  wrap,
  selection,
  onGutterClick,
  blame,
  onSelectCommit,
}: {
  lines: string[];
  highlighted: HighlightedRun[][] | null;
  wrap: boolean;
  selection: LineSelection;
  onGutterClick: (line: number, extend: boolean) => void;
  blame: BlameView | null;
  onSelectCommit?: (hash: string) => void;
}) {
  const gutterWidth = `${String(lines.length).length + 2}ch`;
  const nowMs = useMemo(() => Date.now(), [blame]);
  return (
    <div
      className="rs-prism"
      role="table"
      aria-label="File contents"
      style={{
        fontFamily: "var(--rs-mono)",
        fontSize: 12,
        lineHeight: "18px",
        minWidth: wrap ? undefined : "max-content",
      }}
    >
      {lines.map((text, index) => {
        const lineNo = index + 1;
        const isSelected = selection !== null && lineNo >= selection.start && lineNo <= selection.end;
        const runs = highlighted?.[index];
        return (
          <div
            key={index}
            role="row"
            style={{
              display: "flex",
              background: isSelected
                ? "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 18%)"
                : undefined,
            }}
          >
            {blame ? (
              <BlameCell
                start={blame.runStarts.get(lineNo) ?? null}
                age={blame.ages.get(blame.hashByLine.get(lineNo) ?? "") ?? 0}
                nowMs={nowMs}
                onSelectCommit={onSelectCommit}
              />
            ) : null}
            <span
              role="rowheader"
              onMouseDown={(event) => {
                // Shift-click would otherwise start a text selection.
                if (event.shiftKey) event.preventDefault();
              }}
              onClick={(event) => onGutterClick(lineNo, event.shiftKey)}
              title="Click to select · Shift-click to extend"
              style={{
                width: gutterWidth,
                flex: "none",
                textAlign: "right",
                paddingRight: 10,
                color: isSelected ? "var(--rs-text-primary)" : "var(--rs-text-muted)",
                userSelect: "none",
                cursor: "pointer",
                position: "sticky",
                left: blame ? BLAME_GUTTER_WIDTH : 0,
                background: isSelected
                  ? "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 18%)"
                  : "var(--rs-bg-canvas)",
                borderRight: "1px solid var(--rs-border)",
              }}
            >
              {lineNo}
            </span>
            <span
              role="cell"
              style={{
                paddingLeft: 10,
                paddingRight: 12,
                whiteSpace: wrap ? "pre-wrap" : "pre",
                overflowWrap: wrap ? "anywhere" : undefined,
                color: "var(--rs-text-primary)",
                minWidth: 0,
                flex: 1,
              }}
            >
              {runs
                ? runs.map((run, i) =>
                    run.className ? (
                      <span key={i} className={run.className}>
                        {run.text}
                      </span>
                    ) : (
                      run.text
                    ),
                  )
                : text}
              {text === "" ? "​" : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Pixels, not `ch`: the cell and the line-number column use different font
// sizes, and the line numbers stick at exactly this offset.
const BLAME_GUTTER_WIDTH = "220px";

/**
 * One blame gutter cell. The first line of each run carries the label
 * (hash · author · age) as a button that opens the commit; the left edge is
 * shaded by relative age so recent edits stand out without relying on color
 * alone (the age text is always present at the run start).
 */
function BlameCell({
  start,
  age,
  nowMs,
  onSelectCommit,
}: {
  start: { commit: BlameCommit; lines: number } | null;
  age: number;
  nowMs: number;
  onSelectCommit?: (hash: string) => void;
}) {
  const shade = 8 + Math.round((age / Math.max(1, BLAME_AGE_BUCKETS - 1)) * 40);
  const cellStyle = {
    width: BLAME_GUTTER_WIDTH,
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingLeft: 6,
    paddingRight: 6,
    borderLeft: `3px solid color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) ${shade}%)`,
    borderTop: start ? "1px solid var(--rs-border)" : undefined,
    background: "var(--rs-bg-panel)",
    color: "var(--rs-text-muted)",
    fontSize: 11,
    overflow: "hidden",
    userSelect: "none",
    position: "sticky",
    left: 0,
    zIndex: 1,
  } as const;
  if (!start) return <span role="cell" aria-hidden style={cellStyle} />;
  const { commit } = start;
  const when = commit.authorTime ? commit.authorTime.slice(0, 10) : "unknown date";
  const title = `${commit.shortHash} ${commit.summary}\n${commit.author} · ${when}${
    commit.boundary ? "\n(history boundary)" : ""
  }${onSelectCommit ? "\nClick to open this commit" : ""}`;
  return (
    <span role="cell" style={cellStyle}>
      <button
        type="button"
        disabled={!onSelectCommit}
        onClick={() => onSelectCommit?.(commit.hash)}
        title={title}
        aria-label={`Line last changed by ${commit.shortHash}, ${commit.summary}, ${commit.author}, ${when}`}
        className="truncate"
        style={{
          display: "flex",
          gap: 6,
          minWidth: 0,
          flex: 1,
          background: "transparent",
          border: "none",
          padding: 0,
          color: "inherit",
          font: "inherit",
          textAlign: "left",
          cursor: onSelectCommit ? "pointer" : "default",
        }}
      >
        <span style={{ color: "var(--rs-accent)", flex: "none" }}>{commit.shortHash}</span>
        <span className="truncate" style={{ flex: 1, minWidth: 0, color: "var(--rs-text-secondary)" }}>
          {commit.author}
        </span>
        <span style={{ flex: "none" }}>{shortAge(commit.authorTime, nowMs)}</span>
      </button>
    </span>
  );
}

function TraceResults({
  trace,
  onSelectCommit,
}: {
  trace:
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; result: RangeHistoryResponse };
  onSelectCommit?: (hash: string) => void;
}) {
  if (trace.kind === "idle") {
    return (
      <p style={{ fontSize: 11, color: "var(--rs-text-muted)", margin: 0 }}>
        Select lines in the gutter (Shift-click to extend) or type a range, then Trace to see which commits shaped
        them.
      </p>
    );
  }
  if (trace.kind === "loading") {
    return <p style={{ fontSize: 11, color: "var(--rs-text-muted)", margin: 0 }}>Tracing line history…</p>;
  }
  if (trace.kind === "error") {
    return (
      <p role="alert" style={{ fontSize: 11, color: "var(--rs-warning)", margin: 0 }}>
        {trace.message}
      </p>
    );
  }
  const { result } = trace;
  return (
    <section aria-label="Line history" style={{ maxHeight: 180, overflowY: "auto" }}>
      <div style={{ fontSize: 11, color: "var(--rs-text-secondary)", marginBottom: 4 }}>
        Lines {result.lineStart}–{result.lineEnd}: {result.entries.length} commit
        {result.entries.length === 1 ? "" : "s"}
        {result.truncated ? ` (first ${result.limit})` : ""}
      </div>
      {result.entries.length === 0 ? (
        <p style={{ fontSize: 11, color: "var(--rs-text-muted)", margin: 0 }}>No commits touched these lines.</p>
      ) : (
        <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {result.entries.map((entry) => (
            <li key={entry.hash}>
              <button
                type="button"
                disabled={!onSelectCommit}
                onClick={() => onSelectCommit?.(entry.hash)}
                className="w-full text-left flex items-center gap-2"
                title={onSelectCommit ? "Open this commit" : undefined}
                style={{
                  padding: "3px 6px",
                  fontSize: 12,
                  background: "transparent",
                  border: "none",
                  color: "var(--rs-text-primary)",
                  cursor: onSelectCommit ? "pointer" : "default",
                  borderRadius: "var(--rs-radius-sm)",
                }}
              >
                <span style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-accent)", flex: "none" }}>
                  {entry.shortHash}
                </span>
                <span className="truncate flex-1">{entry.subject}</span>
                <span style={{ color: "var(--rs-text-muted)", flex: "none", fontSize: 11 }}>
                  {entry.author} · {entry.authorDate.slice(0, 10)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ViewerMessage({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "warning";
}) {
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      style={{
        padding: 16,
        fontSize: 12,
        color: tone === "warning" ? "var(--rs-warning)" : "var(--rs-text-secondary)",
      }}
    >
      {children}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
