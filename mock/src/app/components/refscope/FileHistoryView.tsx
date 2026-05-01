import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, History, Network, X } from "lucide-react";
import {
  fetchFileHistory,
  fetchRelatedFiles,
  type FileHistoryEntry,
  type FileHistoryResponse,
  type RelatedFileEntry,
  type RelatedFilesResponse,
} from "../../api";
import {
  countFileChanges,
  parseUnifiedDiff,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type ParsedDiff,
} from "../../lib/parseUnifiedDiff";

type ParsedEntry = {
  entry: FileHistoryEntry;
  parsed: ParsedDiff;
};

type DateGroup = {
  /** Stable key used to render the section header, e.g. `2026-05-02`. */
  key: string;
  /** Human-readable label, e.g. `Today`, `Yesterday`, `Apr 30, 2026`. */
  label: string;
  items: ParsedEntry[];
};

/**
 * Hunk-timeline view: a per-file commit history that stacks each commit's
 * literal diff hunks newest-first, with a left-side timeline rail that lists
 * every commit grouped by author date.
 *
 * Boundary discipline:
 * - The API delivers the raw `git log --patch --follow` output as `entry.patch`.
 * - We feed that text straight into `parseUnifiedDiff` once at this level — no
 *   rename re-judgment, no synthetic AST. Git's own `R<NN>` similarity marker
 *   rides through unchanged and is surfaced verbatim below the file header.
 * - Date grouping in the sidebar is observable too — it uses Git's `authorDate`
 *   formatted in the user's locale; we never invent ordering.
 * - When the API caps at `limit + 1` and reports `truncated: true`, we surface
 *   that fact instead of pretending we have the full history.
 */
export function FileHistoryView({
  repoId,
  filePath,
  refName,
  onClose,
  onSwitchFile,
}: {
  repoId: string;
  filePath: string;
  refName: string;
  onClose: () => void;
  /**
   * Switch the overlay's target path to a sibling discovered via the related
   * files (co-change) panel. The parent (App.tsx) re-uses the same handler the
   * file-history prompt feeds, so recent-paths persistence stays unified.
   */
  onSwitchFile?: (path: string) => void;
}) {
  const [data, setData] = useState<FileHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeHash, setActiveHash] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  // Map from commit hash → article element. Used by both the IntersectionObserver
  // (to compute the topmost-visible commit for the sidebar's active state) and
  // the click-to-jump handler (to call scrollIntoView on a specific commit).
  const articleRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Fetch lifecycle: cancel in-flight request when inputs change or the view
  // unmounts. `refName` is the git ref (renamed from `ref` to avoid React's
  // reserved prop name — see App.tsx render site).
  useEffect(() => {
    if (!repoId || !filePath) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchFileHistory(repoId, { path: filePath, ref: refName }, controller.signal)
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
  }, [repoId, filePath, refName]);

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

  // Parse every patch once. Sharing one ParsedDiff between the sidebar (which
  // needs added/deleted counts) and the main column (which renders the hunks)
  // avoids parsing the same patch twice per render.
  const parsedEntries = useMemo<ParsedEntry[]>(() => {
    if (!data) return [];
    return data.entries.map((entry) => ({
      entry,
      parsed: parseUnifiedDiff(entry.patch),
    }));
  }, [data]);

  // Date grouping for the sidebar. Buckets preserve insertion order, which is
  // newest-first because the API returns entries in `git log` order. Empty
  // / unparseable `authorDate` values fall into a literal `"unknown"` bucket
  // rather than being silently merged into today.
  const dateGroups = useMemo<DateGroup[]>(
    () => groupByDate(parsedEntries),
    [parsedEntries],
  );

  // Default the active commit to the newest one as soon as data lands so the
  // sidebar shows a highlighted row before the user scrolls.
  useEffect(() => {
    if (!parsedEntries.length) {
      setActiveHash(null);
      return;
    }
    setActiveHash((prev) => prev ?? parsedEntries[0].entry.hash);
  }, [parsedEntries]);

  // Track which commit is currently at the top of the main scroll area. We
  // weight the top of the viewport (rootMargin offsets) so a commit becomes
  // "active" when its header reaches the upper third — matching the natural
  // reading anchor.
  useEffect(() => {
    if (!parsedEntries.length) return;
    const root = mainScrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        );
        const hash = (topmost.target as HTMLElement).dataset.commitHash;
        if (hash) setActiveHash(hash);
      },
      {
        root,
        rootMargin: "0px 0px -65% 0px",
        threshold: 0,
      },
    );
    for (const el of articleRefs.current.values()) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [parsedEntries]);

  const registerArticle = useCallback((hash: string, el: HTMLElement | null) => {
    if (el) {
      articleRefs.current.set(hash, el);
    } else {
      articleRefs.current.delete(hash);
    }
  }, []);

  const handleJump = useCallback((hash: string) => {
    const el = articleRefs.current.get(hash);
    if (!el) return;
    setActiveHash(hash);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  const showContent = !loading && !error && data;
  const hasEntries = showContent && data.entries.length > 0;

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
        {hasEntries ? (
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 11,
              color: "var(--rs-text-muted)",
            }}
          >
            {data.entries.length} commit{data.entries.length === 1 ? "" : "s"}
          </span>
        ) : null}
        <span
          style={{
            fontFamily: "var(--rs-mono)",
            fontSize: 11,
            color: "var(--rs-text-muted)",
          }}
        >
          {refName}
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
      {hasEntries ? (
        <ChangeFrequencyGraph
          entries={parsedEntries}
          activeHash={activeHash}
          onJump={handleJump}
        />
      ) : null}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {hasEntries ? (
          <aside
            aria-label="Commit timeline"
            className="overflow-y-auto"
            style={{
              width: 280,
              borderRight: "1px solid var(--rs-border)",
              background: "var(--rs-bg-panel)",
              flexShrink: 0,
            }}
          >
            <CommitList
              groups={dateGroups}
              activeHash={activeHash}
              onJump={handleJump}
            />
            <RelatedFilesPanel
              repoId={repoId}
              filePath={filePath}
              refName={refName}
              onSelectPath={onSwitchFile}
            />
          </aside>
        ) : null}
        <div
          ref={mainScrollRef}
          className="overflow-y-auto"
          style={{ flex: 1, minHeight: 0 }}
        >
          {loading ? <Empty>Loading file history…</Empty> : null}
          {error ? <Empty>{error}</Empty> : null}
          {showContent && data.entries.length === 0 ? (
            <Empty>No commits touch this file in the current ref.</Empty>
          ) : null}
          {showContent
            ? parsedEntries.map(({ entry, parsed }) => (
                <CommitCard
                  key={entry.hash}
                  entry={entry}
                  parsed={parsed}
                  active={entry.hash === activeHash}
                  registerRef={registerArticle}
                />
              ))
            : null}
        </div>
      </div>
    </div>
  );
}

/**
 * A horizontal time-series strip placed between the header and the body. Shows
 * one stacked bar per commit (added on top of a 1-px baseline, deleted below)
 * in chronological order — oldest on the left, newest on the right — so the
 * shape of the file's edit history is visible at a glance.
 *
 * Boundary discipline:
 * - Heights are normalized against the maximum churn (added + deleted) seen in
 *   the loaded history. The numerical labels (`peak +N -M`) and tooltips
 *   restate the literal git counts so the visual normalization never hides the
 *   underlying observed values.
 * - Day labels come straight from `authorDate`. Empty / unparseable dates fall
 *   off the axis instead of being mapped to "today".
 */
function ChangeFrequencyGraph({
  entries,
  activeHash,
  onJump,
}: {
  entries: ParsedEntry[];
  activeHash: string | null;
  onJump: (hash: string) => void;
}) {
  const stats = useMemo(() => {
    // git log order is newest-first; reverse for the chronological strip.
    const ordered = [...entries].reverse();
    let maxChurn = 0;
    let maxAdded = 0;
    let maxDeleted = 0;
    const items = ordered.map((item) => {
      const file = item.parsed.files[0];
      const counts = file ? countFileChanges(file) : { added: 0, deleted: 0 };
      const churn = counts.added + counts.deleted;
      if (churn > maxChurn) maxChurn = churn;
      if (counts.added > maxAdded) maxAdded = counts.added;
      if (counts.deleted > maxDeleted) maxDeleted = counts.deleted;
      return {
        hash: item.entry.hash,
        shortHash: item.entry.shortHash,
        authorDate: item.entry.authorDate,
        subject: item.entry.subject,
        author: item.entry.author,
        added: counts.added,
        deleted: counts.deleted,
        churn,
      };
    });
    return { items, maxChurn, maxAdded, maxDeleted };
  }, [entries]);

  // Day-boundary labels: emit one label at the index where the local-day key
  // first changes. Skips anything we cannot parse so synthetic dates never
  // appear on the axis.
  const dayLabels = useMemo(() => {
    const labels: Array<{ index: number; label: string }> = [];
    let prevKey: string | null = null;
    stats.items.forEach((item, index) => {
      if (!item.authorDate) return;
      const date = new Date(item.authorDate);
      if (Number.isNaN(date.getTime())) return;
      const key = date.toISOString().slice(0, 10);
      if (key === prevKey) return;
      prevKey = key;
      labels.push({
        index,
        label: date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      });
    });
    return labels;
  }, [stats]);

  const { items, maxChurn, maxAdded, maxDeleted } = stats;
  const n = items.length;
  if (n === 0 || maxChurn === 0) return null;

  // ~26px on each side of a 1-px midline = 53px chart, leaving headroom for
  // the heading/legend and the day-label row inside the 96-px container.
  const halfHeight = 26;

  return (
    <div
      style={{
        background: "var(--rs-bg-elevated)",
        borderBottom: "1px solid var(--rs-border)",
        padding: "8px 16px 6px",
        flexShrink: 0,
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 4 }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            fontWeight: 600,
            color: "var(--rs-text-muted)",
            textTransform: "uppercase",
          }}
        >
          Changes over time
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--rs-mono)",
            color: "var(--rs-text-muted)",
          }}
        >
          peak{" "}
          <span style={{ color: "var(--rs-git-added)" }}>+{maxAdded}</span>{" "}
          <span style={{ color: "var(--rs-git-deleted)" }}>-{maxDeleted}</span>
        </span>
      </div>
      <div
        role="group"
        aria-label="Change frequency over time"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          height: 56,
          position: "relative",
        }}
      >
        {items.map((item) => {
          const isActive = item.hash === activeHash;
          const addedH = maxChurn === 0 ? 0 : (item.added / maxChurn) * halfHeight;
          const deletedH =
            maxChurn === 0 ? 0 : (item.deleted / maxChurn) * halfHeight;
          const dateLabel = formatDate(item.authorDate);
          return (
            <button
              key={item.hash}
              type="button"
              onClick={() => onJump(item.hash)}
              aria-current={isActive ? "true" : undefined}
              aria-label={`${item.shortHash} — ${item.subject} (+${item.added} -${item.deleted})`}
              title={`${item.shortHash}  ${item.subject}\n${item.author} · ${dateLabel}\n+${item.added} -${item.deleted}`}
              style={{
                flex: 1,
                minWidth: 2,
                maxWidth: 18,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                gap: 1,
                background: isActive
                  ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 14%)"
                  : "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                borderRadius: "var(--rs-radius-sm)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: "70%",
                  height: addedH,
                  minHeight: item.added > 0 ? 1 : 0,
                  background: isActive
                    ? "var(--rs-git-added)"
                    : "color-mix(in oklab, var(--rs-git-added), transparent 25%)",
                  borderRadius: "1px 1px 0 0",
                  alignSelf: "flex-end",
                  transformOrigin: "bottom",
                }}
              />
              <span
                aria-hidden
                style={{
                  width: "85%",
                  height: 1,
                  background: isActive
                    ? "var(--rs-accent)"
                    : "var(--rs-border)",
                }}
              />
              <span
                aria-hidden
                style={{
                  width: "70%",
                  height: deletedH,
                  minHeight: item.deleted > 0 ? 1 : 0,
                  background: isActive
                    ? "var(--rs-git-deleted)"
                    : "color-mix(in oklab, var(--rs-git-deleted), transparent 25%)",
                  borderRadius: "0 0 1px 1px",
                  alignSelf: "flex-start",
                }}
              />
            </button>
          );
        })}
      </div>
      <div
        style={{
          height: 14,
          position: "relative",
          marginTop: 2,
        }}
      >
        {dayLabels.map(({ index, label }) => {
          // Center the label over the chosen bar. (index + 0.5) / n matches the
          // flex-distributed bar centers when minWidth ≤ each slot ≤ maxWidth.
          const left = ((index + 0.5) / n) * 100;
          return (
            <span
              key={`${index}-${label}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                fontSize: 9,
                color: "var(--rs-text-muted)",
                fontFamily: "var(--rs-mono)",
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function CommitList({
  groups,
  activeHash,
  onJump,
}: {
  groups: DateGroup[];
  activeHash: string | null;
  onJump: (hash: string) => void;
}) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {groups.map((group) => (
        <li key={group.key}>
          <div
            className="px-3"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 1,
              height: 24,
              display: "flex",
              alignItems: "center",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 600,
              color: "var(--rs-text-muted)",
              background: "var(--rs-bg-panel)",
              borderBottom: "1px solid var(--rs-border)",
            }}
          >
            {group.label}
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {group.items.map(({ entry, parsed }) => {
              const file = parsed.files[0];
              const counts = file ? countFileChanges(file) : { added: 0, deleted: 0 };
              const isActive = entry.hash === activeHash;
              return (
                <li key={entry.hash}>
                  <button
                    type="button"
                    onClick={() => onJump(entry.hash)}
                    aria-current={isActive ? "true" : undefined}
                    title={`${entry.subject} — ${entry.author}`}
                    className="w-full text-left px-3 py-2"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "12px 1fr",
                      gap: 8,
                      alignItems: "start",
                      background: isActive
                        ? "color-mix(in oklab, var(--rs-bg-panel), var(--rs-accent) 14%)"
                        : "transparent",
                      borderLeft: isActive
                        ? "2px solid var(--rs-accent)"
                        : "2px solid transparent",
                      cursor: "pointer",
                      borderBottom:
                        "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        position: "relative",
                        display: "block",
                        width: 12,
                        height: "100%",
                        minHeight: 36,
                      }}
                    >
                      {/* Vertical rail line. */}
                      <span
                        style={{
                          position: "absolute",
                          left: 5,
                          top: 0,
                          bottom: 0,
                          width: 2,
                          background:
                            "color-mix(in oklab, var(--rs-border), transparent 30%)",
                        }}
                      />
                      {/* Commit dot. */}
                      <span
                        style={{
                          position: "absolute",
                          left: 2,
                          top: 6,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: isActive
                            ? "var(--rs-accent)"
                            : "var(--rs-bg-elevated)",
                          border: `1px solid ${
                            isActive ? "var(--rs-accent)" : "var(--rs-border)"
                          }`,
                        }}
                      />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        className="truncate"
                        style={{
                          display: "block",
                          fontSize: 12,
                          fontWeight: isActive ? 600 : 500,
                          color: "var(--rs-text-primary)",
                        }}
                      >
                        {entry.subject || "(no subject)"}
                      </span>
                      <span
                        className="flex items-center gap-2"
                        style={{
                          fontSize: 10,
                          color: "var(--rs-text-muted)",
                          marginTop: 2,
                          fontFamily: "var(--rs-mono)",
                        }}
                      >
                        <span>{entry.shortHash}</span>
                        <span>·</span>
                        <span
                          className="truncate"
                          style={{ flex: 1, minWidth: 0 }}
                        >
                          {entry.author}
                        </span>
                        <span>{formatRelativeTime(entry.authorDate)}</span>
                      </span>
                      <span
                        className="flex items-center gap-2"
                        style={{
                          fontSize: 10,
                          marginTop: 2,
                          fontFamily: "var(--rs-mono)",
                        }}
                      >
                        <span style={{ color: "var(--rs-git-added)" }}>
                          +{counts.added}
                        </span>
                        <span style={{ color: "var(--rs-git-deleted)" }}>
                          -{counts.deleted}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/**
 * Sidebar section that shows files frequently edited together with the active
 * target. Observation contract:
 * - We render literally what the API returns. The list is already top-K and
 *   sorted (count desc, lastCoChangeAt desc) on the server side; this view
 *   does not re-rank.
 * - Each entry is a clickable button that swaps the overlay's `filePath` for
 *   that sibling — same overlay, same ref, just a new target. The fetch hook
 *   already keys on `filePath`, so the new history + change graph re-load on
 *   click without extra plumbing.
 * - Loading / error / empty states are explicit; we never silently hide failures.
 *
 * Boundary discipline:
 * - The "co-change count" is the literal commit count from Git, not an inferred
 *   coupling score. The "last edited together" timestamp is `lastCoChangeAt`
 *   verbatim — we format it with the same `formatRelativeTime` helper used by
 *   the commit list so the visual cadence matches.
 */
function RelatedFilesPanel({
  repoId,
  filePath,
  refName,
  onSelectPath,
}: {
  repoId: string;
  filePath: string;
  refName: string;
  onSelectPath?: (path: string) => void;
}) {
  const [data, setData] = useState<RelatedFilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [expandedAll, setExpandedAll] = useState(false);

  // Fetch lifecycle mirrors the parent: cancel any in-flight request when the
  // inputs change (e.g. user clicks a related entry, switching the target).
  useEffect(() => {
    if (!repoId || !filePath) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchRelatedFiles(repoId, { path: filePath, ref: refName }, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setData(next);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setData(null);
        setError(err instanceof Error ? err.message : "Failed to load related files");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [repoId, filePath, refName]);

  // Reset the "show all" toggle every time the target path switches — the
  // user's intent on file A doesn't carry over to file B.
  useEffect(() => {
    setExpandedAll(false);
  }, [filePath]);

  const visibleEntries: RelatedFileEntry[] = (() => {
    if (!data) return [];
    if (expandedAll) return data.related;
    return data.related.slice(0, RELATED_PANEL_INITIAL_LIMIT);
  })();
  const hiddenCount = data ? Math.max(0, data.related.length - visibleEntries.length) : 0;

  return (
    <section
      aria-label="Related files"
      style={{
        borderTop: "1px solid var(--rs-border)",
        background: "var(--rs-bg-panel)",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        className="w-full px-3 flex items-center gap-2"
        style={{
          height: 28,
          background: "transparent",
          border: "none",
          color: "var(--rs-text-muted)",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {collapsed ? (
          <ChevronRight size={12} aria-hidden />
        ) : (
          <ChevronDown size={12} aria-hidden />
        )}
        <Network size={12} aria-hidden style={{ color: "var(--rs-accent)" }} />
        <span style={{ flex: 1, textAlign: "left" }}>Related files</span>
        {data ? (
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 10,
              color: "var(--rs-text-muted)",
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            {data.related.length}
            {data.truncated ? "+" : ""}
          </span>
        ) : null}
      </button>
      {collapsed ? null : (
        <div className="px-2 pb-3" style={{ paddingTop: 2 }}>
          {loading ? (
            <div
              className="px-2 py-2"
              style={{ fontSize: 11, color: "var(--rs-text-muted)" }}
            >
              Loading related files…
            </div>
          ) : null}
          {!loading && error ? (
            <div
              className="px-2 py-2"
              role="alert"
              style={{ fontSize: 11, color: "var(--rs-git-deleted)" }}
            >
              {error}
            </div>
          ) : null}
          {!loading && !error && data && data.related.length === 0 ? (
            <div
              className="px-2 py-2"
              style={{ fontSize: 11, color: "var(--rs-text-muted)" }}
            >
              No related files yet.
            </div>
          ) : null}
          {!loading && !error && data && data.related.length > 0 ? (
            <>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {visibleEntries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => onSelectPath?.(entry.path)}
                      disabled={!onSelectPath}
                      title={`${entry.path} — co-changed with ${filePath} in ${entry.coChangeCount} commit${entry.coChangeCount === 1 ? "" : "s"}`}
                      className="w-full text-left px-2 py-1"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        columnGap: 8,
                        rowGap: 1,
                        alignItems: "baseline",
                        background: "transparent",
                        border: "none",
                        borderRadius: "var(--rs-radius-sm)",
                        cursor: onSelectPath ? "pointer" : "default",
                      }}
                      onMouseEnter={(event) => {
                        if (!onSelectPath) return;
                        event.currentTarget.style.background =
                          "color-mix(in oklab, var(--rs-bg-panel), var(--rs-accent) 10%)";
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span
                        className="truncate"
                        style={{
                          fontFamily: "var(--rs-mono)",
                          fontSize: 12,
                          color: "var(--rs-text-primary)",
                          minWidth: 0,
                        }}
                      >
                        {entry.path}
                      </span>
                      <span
                        aria-label={`Co-changed in ${entry.coChangeCount} commit${entry.coChangeCount === 1 ? "" : "s"}`}
                        style={{
                          fontFamily: "var(--rs-mono)",
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: 999,
                          color: "var(--rs-text-primary)",
                          background:
                            "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 20%)",
                        }}
                      >
                        ×{entry.coChangeCount}
                      </span>
                      <span
                        style={{
                          gridColumn: "1 / -1",
                          fontFamily: "var(--rs-mono)",
                          fontSize: 10,
                          color: "var(--rs-text-muted)",
                        }}
                      >
                        last together {formatRelativeTime(entry.lastCoChangeAt) || "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setExpandedAll(true)}
                  className="px-2 py-1"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--rs-text-muted)",
                    fontSize: 10,
                    fontFamily: "var(--rs-mono)",
                    cursor: "pointer",
                  }}
                >
                  +{hiddenCount} more
                </button>
              ) : null}
              {data.truncated ? (
                <p
                  className="px-2"
                  style={{
                    fontSize: 10,
                    color: "var(--rs-text-muted)",
                    marginTop: 4,
                    fontFamily: "var(--rs-mono)",
                  }}
                >
                  Scanned the {data.scannedCommits} most-recent commits touching this file.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

const RELATED_PANEL_INITIAL_LIMIT = 10;

function CommitCard({
  entry,
  parsed,
  active,
  registerRef,
}: {
  entry: FileHistoryEntry;
  parsed: ParsedDiff;
  active: boolean;
  registerRef: (hash: string, el: HTMLElement | null) => void;
}) {
  const file = parsed.files[0] ?? null;

  return (
    <article
      data-commit-hash={entry.hash}
      ref={(el) => registerRef(entry.hash, el)}
      style={{
        borderBottom: "1px solid var(--rs-border)",
        scrollMarginTop: 0,
      }}
    >
      <header
        className="px-4 py-3"
        style={{
          background: active
            ? "color-mix(in oklab, var(--rs-bg-panel), var(--rs-accent) 8%)"
            : "var(--rs-bg-panel)",
          borderBottom: "1px solid var(--rs-border)",
          borderLeft: active
            ? "3px solid var(--rs-accent)"
            : "3px solid transparent",
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

function formatRelativeTime(value?: string) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function groupByDate(entries: ParsedEntry[]): DateGroup[] {
  if (entries.length === 0) return [];
  const today = startOfDayUTC(new Date());
  const yesterday = startOfDayUTC(new Date(today.getTime() - 86_400_000));

  const groupsByKey = new Map<string, DateGroup>();
  for (const item of entries) {
    const date = item.entry.authorDate ? new Date(item.entry.authorDate) : null;
    let key: string;
    let label: string;
    if (date && !Number.isNaN(date.getTime())) {
      const start = startOfDayUTC(date);
      key = isoDate(start);
      if (start.getTime() === today.getTime()) {
        label = "Today";
      } else if (start.getTime() === yesterday.getTime()) {
        label = "Yesterday";
      } else {
        label = date.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }
    } else {
      key = "unknown";
      label = "Unknown date";
    }

    const existing = groupsByKey.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groupsByKey.set(key, { key, label, items: [item] });
    }
  }
  // Insertion order = git log order = newest first, preserved by Map.
  return Array.from(groupsByKey.values());
}

function startOfDayUTC(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
