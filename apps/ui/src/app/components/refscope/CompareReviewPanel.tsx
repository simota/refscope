import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ClipboardCopy, Download, FileText, GitCommitHorizontal } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  fetchCompareCommits,
  fetchCompareDiff,
  type CompareCommitsResult,
  type CompareDiffResult,
  type CompareMode,
} from "../../api";
import type { Commit, CompareResult } from "./data";
import { DiffViewer } from "./DiffViewer";
import { buildCompareReport, fileStatusLabel, shortRev } from "../../lib/compareReview";
import { fileToDiffText, parseUnifiedDiff } from "../../lib/parseUnifiedDiff";

type ReviewTab = "commits" | "files" | "diff";

type LoadState<T> = { status: "idle" | "loading" | "ready" | "error"; data: T | null; error: string };

const IDLE = { status: "idle", data: null, error: "" } as const;

/**
 * Compare review workbench: the commits behind ahead/behind, the changed
 * files, and the range diff — so reviewing a branch or release no longer
 * means copying commands into a terminal. Opt-in (collapsed by default) to
 * keep the timeline calm; once open it refreshes when the compare summary
 * refreshes (refs moved) or the diff mode changes.
 */
export function CompareReviewPanel({
  repoId,
  base,
  target,
  summary,
  mode,
  onModeChange,
  selectedHash,
  onSelectCommit,
  onOpenFileHistory,
}: {
  repoId: string;
  base: string;
  target: string;
  /** Latest compare summary; a new object means the compared refs moved. */
  summary: CompareResult;
  mode: CompareMode;
  onModeChange: (mode: CompareMode) => void;
  selectedHash: string;
  onSelectCommit: (hash: string) => void;
  onOpenFileHistory?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ReviewTab>("commits");
  const [commits, setCommits] = useState<LoadState<CompareCommitsResult>>(IDLE);
  const [diff, setDiff] = useState<LoadState<CompareDiffResult>>(IDLE);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different pair is a different review: drop the old data and file focus.
  useEffect(() => {
    setCommits(IDLE);
    setDiff(IDLE);
    setFocusPath(null);
  }, [repoId, base, target]);

  useEffect(() => {
    if (!open || !repoId || !base || !target) return;
    const controller = new AbortController();
    // Live refreshes keep the previous rows on screen instead of flashing.
    setCommits((prev) => (prev.data ? prev : { status: "loading", data: null, error: "" }));
    fetchCompareCommits(repoId, base, target, controller.signal)
      .then((data) => setCommits({ status: "ready", data, error: "" }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setCommits((prev) => ({ status: "error", data: prev.data, error: errorText(err) }));
      });
    return () => controller.abort();
  }, [open, repoId, base, target, summary]);

  useEffect(() => {
    if (!open || !repoId || !base || !target) return;
    const controller = new AbortController();
    setDiff((prev) =>
      prev.data && prev.data.requestedMode === mode ? prev : { status: "loading", data: null, error: "" },
    );
    fetchCompareDiff(repoId, base, target, mode, controller.signal)
      .then((data) => setDiff({ status: "ready", data, error: "" }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setDiff((prev) => ({ status: "error", data: prev.data, error: errorText(err) }));
      });
    return () => controller.abort();
  }, [open, repoId, base, target, mode, summary]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const parsedDiff = useMemo(() => (diff.data ? parseUnifiedDiff(diff.data.diff) : null), [diff.data]);
  const focusedDiffText = useMemo(() => {
    if (!focusPath || !parsedDiff) return null;
    const file = parsedDiff.files.find((entry) => entry.newPath === focusPath || entry.oldPath === focusPath);
    return file ? fileToDiffText(file) : "";
  }, [focusPath, parsedDiff]);

  const report = useMemo(() => {
    if (!commits.data) return "";
    return buildCompareReport({
      base,
      target,
      mode: diff.data?.mode ?? mode,
      fallback: diff.data?.fallback,
      mergeBase: diff.data?.mergeBase ?? summary.mergeBase,
      ahead: commits.data.ahead,
      behind: commits.data.behind,
      aheadTruncated: commits.data.aheadTruncated,
      behindTruncated: commits.data.behindTruncated,
      files: diff.data?.files ?? null,
      added: diff.data?.added,
      deleted: diff.data?.deleted,
    });
  }, [base, target, mode, commits.data, diff.data, summary.mergeBase]);

  function flash(message: string) {
    setCopyStatus(message);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus(""), 2000);
  }

  async function copyReport() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      flash("Report copied");
    } catch {
      flash("Copy failed — use Download instead");
    }
  }

  function downloadReport() {
    if (!report) return;
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `compare-${safeFileName(shortRev(base))}-${safeFileName(shortRev(target))}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 0);
    flash("Report downloaded");
  }

  function openFile(path: string) {
    setFocusPath(path);
    setTab("diff");
  }

  const fileCount = diff.data?.files.length ?? summary.files;

  return (
    <div className="mt-2" style={{ borderTop: "1px solid var(--rs-border)", paddingTop: 6 }}>
      <button
        type="button"
        className="rs-compact-button"
        aria-expanded={open}
        aria-controls="rs-compare-review"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown
          size={12}
          aria-hidden
          style={{ marginRight: 4, transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms" }}
        />
        Review changes
      </button>
      {open ? (
        <div id="rs-compare-review" className="mt-2">
          <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 11 }}>
            <div role="group" aria-label="Diff mode" className="inline-flex" style={{ gap: 2 }}>
              <ModeButton
                active={mode === "three-dot"}
                onClick={() => onModeChange("three-dot")}
                title="Changes the target introduced since it diverged from base (git diff base...target) — the pull-request view"
              >
                Since merge base
              </ModeButton>
              <ModeButton
                active={mode === "two-dot"}
                onClick={() => onModeChange("two-dot")}
                title="Direct tree difference between base and target (git diff base target), including base-only changes"
              >
                Direct
              </ModeButton>
            </div>
            <button type="button" className="rs-compact-button" onClick={copyReport} disabled={!report}>
              <ClipboardCopy size={12} aria-hidden style={{ marginRight: 4 }} />
              Copy report
            </button>
            <button type="button" className="rs-compact-button" onClick={downloadReport} disabled={!report}>
              <Download size={12} aria-hidden style={{ marginRight: 4 }} />
              Download .md
            </button>
            <span role="status" aria-live="polite" style={{ color: "var(--rs-text-muted)" }}>
              {copyStatus}
            </span>
          </div>
          {diff.data?.fallback ? (
            <p style={{ marginTop: 6, fontSize: 11, color: "var(--rs-warning)" }}>
              These histories share no merge base — showing the direct difference instead.
            </p>
          ) : null}

          <Tabs value={tab} onValueChange={(value) => setTab(value as ReviewTab)} className="mt-2">
            <TabsList
              aria-label="Compare review"
              className="!bg-transparent !rounded-none !p-0 !h-auto !w-fit !inline-flex !justify-start"
              style={{ gap: 4 }}
            >
              <TabsTrigger value="commits" className="rs-review-tab">
                Commits{" "}
                {commits.data
                  ? `(${commits.data.ahead.length}${commits.data.aheadTruncated ? "+" : ""} / ${commits.data.behind.length}${commits.data.behindTruncated ? "+" : ""})`
                  : `(${summary.ahead} / ${summary.behind})`}
              </TabsTrigger>
              <TabsTrigger value="files" className="rs-review-tab">
                Files ({fileCount})
              </TabsTrigger>
              <TabsTrigger value="diff" className="rs-review-tab">
                Diff
              </TabsTrigger>
            </TabsList>

            <TabsContent value="commits" style={{ margin: 0 }}>
              <LoadGate state={commits} label="commits">
                {commits.data ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <CommitSection
                      title={`In ${shortRev(target)}, not in ${shortRev(base)}`}
                      hint="What the target would bring in"
                      accent="var(--rs-git-added)"
                      commits={commits.data.ahead}
                      truncated={commits.data.aheadTruncated}
                      selectedHash={selectedHash}
                      onSelect={onSelectCommit}
                    />
                    <CommitSection
                      title={`In ${shortRev(base)}, not in ${shortRev(target)}`}
                      hint="What the target is missing"
                      accent="var(--rs-git-deleted)"
                      commits={commits.data.behind}
                      truncated={commits.data.behindTruncated}
                      selectedHash={selectedHash}
                      onSelect={onSelectCommit}
                    />
                  </div>
                ) : null}
              </LoadGate>
            </TabsContent>

            <TabsContent value="files" style={{ margin: 0 }}>
              <LoadGate state={diff} label="changed files">
                {diff.data ? (
                  diff.data.files.length === 0 ? (
                    <Muted>No file differences.</Muted>
                  ) : (
                    <ul
                      aria-label="Changed files"
                      style={{ maxHeight: 320, overflow: "auto", margin: 0, padding: 0, listStyle: "none" }}
                    >
                      {diff.data.files.map((file) => (
                        <li key={`${file.oldPath ?? ""}\0${file.path}`}>
                          <button
                            type="button"
                            className="rs-review-row"
                            onClick={() => openFile(file.path)}
                            onContextMenu={(event) => {
                              if (!onOpenFileHistory) return;
                              event.preventDefault();
                              onOpenFileHistory(file.path);
                            }}
                            title={`Show the diff for ${file.path}${onOpenFileHistory ? " (right-click: file history)" : ""}`}
                          >
                            <StatusBadge status={file.status} />
                            <FileText size={12} aria-hidden style={{ color: "var(--rs-text-muted)", flexShrink: 0 }} />
                            <span className="truncate" style={{ fontFamily: "var(--rs-mono)", flex: 1, minWidth: 0 }}>
                              {file.oldPath ? (
                                <>
                                  <span style={{ color: "var(--rs-text-muted)" }}>{file.oldPath} → </span>
                                  {file.path}
                                </>
                              ) : (
                                file.path
                              )}
                            </span>
                            {file.binary ? (
                              <span style={{ color: "var(--rs-text-muted)" }}>binary</span>
                            ) : (
                              <span style={{ fontFamily: "var(--rs-mono)", flexShrink: 0 }}>
                                <span style={{ color: "var(--rs-git-added)" }}>+{file.added}</span>{" "}
                                <span style={{ color: "var(--rs-git-deleted)" }}>−{file.deleted}</span>
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </LoadGate>
            </TabsContent>

            <TabsContent value="diff" style={{ margin: 0 }}>
              <LoadGate state={diff} label="diff">
                {diff.data ? (
                  <div>
                    {focusPath ? (
                      <div className="flex items-center gap-2" style={{ fontSize: 11, marginBottom: 6 }}>
                        <span style={{ color: "var(--rs-text-secondary)" }}>
                          Showing <code style={{ fontFamily: "var(--rs-mono)" }}>{focusPath}</code>
                        </span>
                        <button type="button" className="rs-compact-button" onClick={() => setFocusPath(null)}>
                          Show all files
                        </button>
                      </div>
                    ) : null}
                    {focusedDiffText === "" ? (
                      <Muted>
                        This file's patch is beyond the {formatBytes(diff.data.maxBytes)} display limit. Copy the diff
                        command to read it locally.
                      </Muted>
                    ) : diff.data.diff ? (
                      <div style={{ maxHeight: 560, overflow: "auto" }}>
                        <DiffViewer
                          diff={focusedDiffText ?? diff.data.diff}
                          truncated={focusedDiffText ? false : diff.data.truncated}
                          maxBytes={diff.data.maxBytes}
                          commitHash={`compare:${diff.data.fromHash}:${diff.data.toHash}:${focusPath ?? ""}`}
                          onOpenFileHistory={onOpenFileHistory}
                        />
                      </div>
                    ) : (
                      <Muted>No textual differences.</Muted>
                    )}
                  </div>
                ) : null}
              </LoadGate>
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="rs-compact-button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      style={
        active
          ? {
              color: "var(--rs-text-primary)",
              borderColor: "var(--rs-accent)",
              background: "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 14%)",
            }
          : undefined
      }
    >
      {children}
    </button>
  );
}

function LoadGate<T>({
  state,
  label,
  children,
}: {
  state: LoadState<T>;
  label: string;
  children: ReactNode;
}) {
  if (state.status === "loading" || (state.status === "idle" && !state.data)) {
    return <Muted>Loading {label}…</Muted>;
  }
  return (
    <>
      {state.status === "error" ? (
        <p role="alert" style={{ fontSize: 11, color: "var(--rs-git-deleted)", margin: "6px 0" }}>
          Could not load {label}: {state.error}
          {state.data ? " (showing the last result)" : ""}
        </p>
      ) : null}
      {children}
    </>
  );
}

function CommitSection({
  title,
  hint,
  accent,
  commits,
  truncated,
  selectedHash,
  onSelect,
}: {
  title: string;
  hint: string;
  accent: string;
  commits: Commit[];
  truncated: boolean;
  selectedHash: string;
  onSelect: (hash: string) => void;
}) {
  return (
    <section aria-label={title}>
      <div style={{ fontSize: 11, color: "var(--rs-text-secondary)", marginBottom: 2 }}>
        <span style={{ color: accent, fontWeight: 650 }}>{title}</span>{" "}
        <span style={{ color: "var(--rs-text-muted)" }}>
          · {commits.length}
          {truncated ? "+ (newest shown)" : ""} · {hint}
        </span>
      </div>
      {commits.length === 0 ? (
        <Muted>None.</Muted>
      ) : (
        <ul style={{ maxHeight: 240, overflow: "auto", margin: 0, padding: 0, listStyle: "none" }}>
          {commits.map((commit) => {
            const selected = commit.hash === selectedHash;
            return (
              <li key={commit.hash}>
                <button
                  type="button"
                  className="rs-review-row"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(commit.hash)}
                  title={`${commit.subject}\n${commit.author} · ${commit.authorDate ?? ""}`}
                >
                  <GitCommitHorizontal size={12} aria-hidden style={{ color: accent, flexShrink: 0 }} />
                  <code style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-muted)", flexShrink: 0 }}>
                    {commit.shortHash ?? commit.hash.slice(0, 7)}
                  </code>
                  <span className="truncate" style={{ flex: 1, minWidth: 0, color: "var(--rs-text-primary)" }}>
                    {commit.subject}
                  </span>
                  {commit.isMerge ? <span style={{ color: "var(--rs-git-merge)", flexShrink: 0 }}>merge</span> : null}
                  <span className="truncate" style={{ color: "var(--rs-text-muted)", maxWidth: 120, flexShrink: 0 }}>
                    {commit.author}
                  </span>
                  <span style={{ color: "var(--rs-text-muted)", flexShrink: 0 }}>{commit.time}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const STATUS_COLORS: Record<string, string> = {
  A: "var(--rs-git-added)",
  D: "var(--rs-git-deleted)",
  M: "var(--rs-git-modified)",
  R: "var(--rs-git-merge)",
  C: "var(--rs-git-merge)",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "var(--rs-text-muted)";
  return (
    <span
      aria-label={fileStatusLabel(status)}
      title={fileStatusLabel(status)}
      style={{
        fontFamily: "var(--rs-mono)",
        fontWeight: 700,
        width: 16,
        textAlign: "center",
        color,
        flexShrink: 0,
      }}
    >
      {status}
    </span>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 11, color: "var(--rs-text-muted)", margin: "6px 0" }}>{children}</p>;
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || "rev";
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
