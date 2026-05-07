import {
  GitMerge,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  RefreshCw,
  Copy,
  GitCompareArrows,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Commit, CompareResult, GitRef, StructuralKind } from "./data";
import { StructuralDiffBadge } from "./StructuralDiffBadge";
import {
  compareCherry as fetchCompareCherry,
  type CompareCherryResult,
  type CherryEntry,
  type WorkTreeResponse,
} from "../../api";
import { parseConventionalCommit } from "../../lib/conventionalCommit";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";

const LANE_COLORS = ["var(--rs-accent)", "var(--rs-git-merge)", "var(--rs-git-modified)"];

export function CommitTimeline({
  commits,
  selected,
  onSelect,
  loading,
  error,
  eventNotice,
  eventStatus,
  livePaused,
  pendingUpdates,
  liveAnnouncement,
  activeFilters,
  refs,
  repoId,
  selectedRef,
  selectedCommit,
  selectionNotice,
  compareBase,
  compareTarget,
  compareResult,
  compareLoading,
  onCompareBaseChange,
  onCompareTargetChange,
  onPinSelectedAsBase,
  onPinCurrentRefAsTarget,
  onClearCompare,
  compareBarCollapsed,
  activityGraphCollapsed,
  onToggleCompareBar,
  onToggleActivityGraph,
  summaryViewOpen,
  workTree,
  isWorkTreeSelected,
  onSelectWorkTree,
  onRefreshWorkTree,
  onSetCommitAsCompareBase,
  onSetCommitAsCompareTarget,
  onFilterByAuthor,
  commitKindFilter = "all",
  onCommitKindFilterChange,
}: {
  commits: Commit[];
  selected: string;
  onSelect: (hash: string) => void;
  loading: boolean;
  error: string;
  eventNotice: string;
  eventStatus: "connecting" | "connected" | "error";
  livePaused: boolean;
  pendingUpdates: number;
  liveAnnouncement: string;
  activeFilters?: string[];
  refs: GitRef[];
  repoId: string;
  selectedRef: string;
  selectedCommit: Commit | null;
  selectionNotice: string;
  compareBase: string;
  compareTarget: string;
  compareResult: CompareResult | null;
  compareLoading: boolean;
  onCompareBaseChange: (value: string) => void;
  onCompareTargetChange: (value: string) => void;
  onPinSelectedAsBase: () => void;
  onPinCurrentRefAsTarget: () => void;
  onClearCompare: () => void;
  compareBarCollapsed: boolean;
  activityGraphCollapsed: boolean;
  onToggleCompareBar: () => void;
  onToggleActivityGraph: () => void;
  summaryViewOpen: boolean;
  // Working-tree pseudo-row inputs. The timeline only renders the row when
  // `workTree` is non-null (parent gates this on "any side has fileCount > 0").
  // Refscope never infers worktree state itself — this is the parent's
  // observation fact handed in.
  workTree: WorkTreeResponse | null;
  isWorkTreeSelected: boolean;
  onSelectWorkTree: () => void;
  onRefreshWorkTree: () => void;
  // Per-row right-click handlers. All optional so the timeline still renders
  // (with a smaller menu) if a parent doesn't wire them.
  onSetCommitAsCompareBase?: (hash: string) => void;
  onSetCommitAsCompareTarget?: (hash: string) => void;
  onFilterByAuthor?: (author: string) => void;
  // Commit kind filter (D-2). Controlled by App.tsx; CommitTimeline renders
  // only the toggle UI — filtering is done upstream (filteredCommits).
  commitKindFilter?: "all" | "refactor" | "logic";
  onCommitKindFilterChange?: (value: "all" | "refactor" | "logic") => void;
}) {
  const emptyState = activeFilters?.length
    ? {
        title: "No matching commits",
        message: `No commits matched ${activeFilters.join(", ")} on the selected ref.`,
      }
    : {
        title: "No commits",
        message: "No commits were returned for the selected ref.",
      };

  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!selected || !listRef.current) return;
    // Defer to the next frame so the layout read happens after React has
    // committed and the browser has computed layout naturally — calling
    // scrollIntoView synchronously here forces a sync reflow on top of a
    // freshly mutated DOM, which dominates frame budget when a large diff
    // is mounted in a sibling panel.
    const handle = requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-hash="${selected}"]`);
      el?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(handle);
  }, [selected]);

  return (
    <main
      className="flex flex-col overflow-hidden"
      style={{ background: "var(--rs-bg-canvas)", flex: 1, minWidth: 0 }}
    >
      {error ? <MessageBanner tone="warning" title="API error" message={error} /> : null}
      {isApiConnectionError(error) ? <ApiRecoveryHint /> : null}
      {selectionNotice ? (
        <MessageBanner tone="warning" title="Selection changed" message={selectionNotice} />
      ) : null}
      {eventNotice ? <MessageBanner title="Realtime update" message={eventNotice} /> : null}
      <div aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>
      <CompareBarCollapsible
        refs={refs}
        repoId={repoId}
        selectedRef={selectedRef}
        selectedCommit={selectedCommit}
        compareBase={compareBase}
        compareTarget={compareTarget}
        compareResult={compareResult}
        compareLoading={compareLoading}
        onCompareBaseChange={onCompareBaseChange}
        onCompareTargetChange={onCompareTargetChange}
        onPinSelectedAsBase={onPinSelectedAsBase}
        onPinCurrentRefAsTarget={onPinCurrentRefAsTarget}
        onClearCompare={onClearCompare}
        collapsed={compareBarCollapsed}
        onToggle={onToggleCompareBar}
      />
      <ActivityGraphCollapsible
        commits={commits}
        collapsed={activityGraphCollapsed}
        onToggle={onToggleActivityGraph}
        summaryViewOpen={summaryViewOpen}
      />
      {onCommitKindFilterChange ? (
        <CommitKindFilterBar
          value={commitKindFilter}
          onChange={onCommitKindFilterChange}
        />
      ) : null}

      <div className="overflow-y-auto" style={{ flex: 1 }}>
        {loading ? (
          <StateMessage title="Loading commits" message="Reading allowlisted repository history." />
        ) : commits.length ? (
          <ul role="list" className="pb-6" ref={listRef}>
            {workTree ? (
              <WorkTreeRow
                workTree={workTree}
                selected={isWorkTreeSelected}
                onSelect={onSelectWorkTree}
                onRefresh={onRefreshWorkTree}
              />
            ) : null}
            {commits.map((c, i) => (
              <CommitRow
                key={c.hash}
                commit={c}
                prev={commits[i - 1]}
                next={commits[i + 1]}
                selected={c.hash === selected && !isWorkTreeSelected}
                onClick={() => onSelect(c.hash)}
                onSetAsCompareBase={onSetCommitAsCompareBase}
                onSetAsCompareTarget={onSetCommitAsCompareTarget}
                onFilterByAuthor={onFilterByAuthor}
              />
            ))}
          </ul>
        ) : (
          <>
            {workTree ? (
              <ul role="list">
                <WorkTreeRow
                  workTree={workTree}
                  selected={isWorkTreeSelected}
                  onSelect={onSelectWorkTree}
                  onRefresh={onRefreshWorkTree}
                />
              </ul>
            ) : null}
            <StateMessage title={emptyState.title} message={emptyState.message} />
          </>
        )}
      </div>

      <StatusBar
        status={eventStatus}
        paused={livePaused}
        pendingUpdates={pendingUpdates}
        head={commits[0]?.shortHash ?? commits[0]?.hash.slice(0, 7)}
        count={commits.length}
      />
    </main>
  );
}

function CommitActivityGraph({ commits }: { commits: Commit[] }) {
  const totalAdded = commits.reduce((sum, commit) => sum + commit.added, 0);
  const totalDeleted = commits.reduce((sum, commit) => sum + commit.deleted, 0);
  const signedCount = commits.filter((commit) => commit.signed).length;
  const mergeCount = commits.filter((commit) => commit.isMerge).length;
  const newCount = commits.filter((commit) => commit.isNew).length;
  const maxChange = Math.max(1, ...commits.map((commit) => commit.added + commit.deleted));
  const visibleCommits = commits.slice(0, 24);
  const authors = summarizeAuthors(commits);

  return (
    <section
      className="px-3 py-2"
      aria-label={`Commit activity overview: ${commits.length} commits, ${totalAdded} additions, ${totalDeleted} deletions, ${signedCount} signed commits, ${mergeCount} merge commits`}
      style={{
        background: "var(--rs-bg-panel)",
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <GraphMetric label="Commits" value={commits.length.toString()} />
        <GraphMetric label="Added" value={`+${totalAdded}`} tone="added" />
        <GraphMetric label="Deleted" value={`-${totalDeleted}`} tone="deleted" />
        <GraphMetric label="Signed" value={signedCount.toString()} tone="accent" />
        <GraphMetric label="Merge" value={mergeCount.toString()} tone="merge" />
        {newCount ? <GraphMetric label="New" value={newCount.toString()} tone="accent" /> : null}
      </div>
      <div
        className="mt-2 flex items-end gap-1"
        aria-hidden
        style={{ height: 34, minWidth: 0 }}
      >
        {visibleCommits.length ? (
          visibleCommits.map((commit) => {
            const height = Math.max(4, Math.round(((commit.added + commit.deleted) / maxChange) * 30));
            return (
              <div
                key={commit.hash}
                title={`${commit.subject}: +${commit.added} -${commit.deleted}`}
                className="rounded-sm"
                style={{
                  width: 8,
                  height,
                  background: commit.deleted > commit.added ? "var(--rs-git-deleted)" : "var(--rs-git-added)",
                  opacity: commit.isMerge ? 0.55 : 0.9,
                  outline: commit.isNew ? "1px solid var(--rs-accent)" : undefined,
                  outlineOffset: 1,
                }}
              />
            );
          })
        ) : (
          <div style={{ color: "var(--rs-text-muted)", fontSize: 12 }}>
            Activity appears after commits load.
          </div>
        )}
      </div>
      {authors.length ? <AuthorGraph authors={authors} total={commits.length} /> : null}
    </section>
  );
}

function ActivityGraphCollapsible({
  commits,
  collapsed,
  onToggle,
  summaryViewOpen,
}: {
  commits: Commit[];
  collapsed: boolean;
  onToggle: () => void;
  summaryViewOpen: boolean;
}) {
  const isOpen = summaryViewOpen || !collapsed;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={(open) => {
        // summary view overrides collapse: only toggle when not forced open by summary
        if (!summaryViewOpen) {
          if (open !== isOpen) onToggle();
        }
      }}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="mx-4 mt-3 w-[calc(100%-2rem)] flex items-center justify-between px-3 rounded-t-md"
          style={{
            minHeight: 28,
            background: "var(--rs-bg-panel)",
            border: "1px solid var(--rs-border)",
            borderBottomColor: isOpen ? "transparent" : "var(--rs-border)",
            borderRadius: isOpen ? "var(--rs-radius-md) var(--rs-radius-md) 0 0" : "var(--rs-radius-md)",
            color: "var(--rs-text-secondary)",
            fontSize: 11,
            cursor: "pointer",
          }}
          aria-controls="rs-activity-graph-content"
        >
          <span>Activity</span>
          <ChevronDown
            size={13}
            aria-hidden
            style={{
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 120ms ease-out",
            }}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent id="rs-activity-graph-content">
        <div
          className="mx-4 rounded-b-md"
          style={{
            border: "1px solid var(--rs-border)",
            borderTop: "none",
          }}
        >
          <CommitActivityGraph commits={commits} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function summarizeAuthors(commits: Commit[]) {
  const counts = new Map<string, number>();
  for (const commit of commits) {
    counts.set(commit.author, (counts.get(commit.author) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count], index) => ({ name, count, color: authorColor(index) }));
}

function AuthorGraph({
  authors,
  total,
}: {
  authors: Array<{ name: string; count: number; color: string }>;
  total: number;
}) {
  return (
    <div
      className="mt-2 grid gap-1.5"
      aria-label={`Author distribution for ${total} commits`}
      style={{ maxWidth: 560 }}
    >
      {authors.map((author) => {
        const width = total ? Math.max(8, Math.round((author.count / total) * 100)) : 0;
        return (
          <div
            key={author.name}
            className="grid items-center gap-2"
            style={{ gridTemplateColumns: "86px 1fr 32px" }}
          >
            <span
              className="truncate"
              title={author.name}
              style={{ color: "var(--rs-text-muted)", fontSize: 10 }}
            >
              {author.name}
            </span>
            <span
              className="rounded-sm"
              style={{ height: 5, background: "var(--rs-bg-canvas)", overflow: "hidden" }}
              aria-hidden
            >
              <span className="block h-full rounded-sm" style={{ width: `${width}%`, background: author.color }} />
            </span>
            <span style={{ color: "var(--rs-text-secondary)", fontSize: 10, fontFamily: "var(--rs-mono)" }}>
              {author.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function authorColor(index: number) {
  const colors = ["var(--rs-accent)", "var(--rs-git-added)", "var(--rs-git-merge)", "var(--rs-git-modified)"];
  return colors[index] ?? "var(--rs-text-muted)";
}

function GraphMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "added" | "deleted" | "accent" | "merge";
}) {
  const color =
    tone === "added"
      ? "var(--rs-git-added)"
      : tone === "deleted"
      ? "var(--rs-git-deleted)"
      : tone === "merge"
      ? "var(--rs-git-merge)"
      : tone === "accent"
      ? "var(--rs-accent)"
      : "var(--rs-text-primary)";
  return (
    <div className="flex items-baseline gap-1.5" style={{ minWidth: 0 }}>
      <span style={{ color, fontFamily: "var(--rs-mono)", fontSize: 12, fontWeight: 700 }}>
        {value}
      </span>
      <span style={{ color: "var(--rs-text-muted)", fontSize: 10 }}>
        {label}
      </span>
    </div>
  );
}

function CompareBar({
  refs,
  repoId,
  selectedRef,
  selectedCommit,
  base,
  target,
  result,
  loading,
  onBaseChange,
  onTargetChange,
  onPinSelectedAsBase,
  onPinCurrentRefAsTarget,
  onClear,
}: {
  refs: GitRef[];
  repoId: string;
  selectedRef: string;
  selectedCommit: Commit | null;
  base: string;
  target: string;
  result: CompareResult | null;
  loading: boolean;
  onBaseChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onPinSelectedAsBase: () => void;
  onPinCurrentRefAsTarget: () => void;
  onClear: () => void;
}) {
  const active = Boolean(base || target);
  // Cherry-pick equivalence is opt-in: it computes patch-ids server-side and
  // is heavier than the regular ahead/behind summary, so we only fetch when
  // the user clicks the button. State resets when base/target change so the
  // panel never shows results from a previous compare config.
  const [cherry, setCherry] = useState<CompareCherryResult | null>(null);
  const [cherryLoading, setCherryLoading] = useState(false);
  const [cherryError, setCherryError] = useState<string>("");
  // Graded equivalence threshold (D-6). Local to CompareBar — no lift to
  // App.tsx needed. Clamped server-side to [1, 50]; default matches the
  // server default (10). Changing the threshold only takes effect on the
  // next "Cherry-pick status" fetch.
  const [threshold, setThreshold] = useState<number>(10);
  useEffect(() => {
    setCherry(null);
    setCherryError("");
  }, [base, target]);
  async function loadCherry() {
    if (!repoId || !base || !target) return;
    setCherryLoading(true);
    setCherryError("");
    try {
      const data = await fetchCompareCherry(repoId, base, target, threshold);
      setCherry(data);
    } catch (err) {
      setCherryError(err instanceof Error ? err.message : String(err));
    } finally {
      setCherryLoading(false);
    }
  }
  return (
    <section
      className="px-3 py-2"
      style={{
        background: active ? "var(--rs-bg-elevated)" : "var(--rs-bg-panel)",
      }}
      aria-label="Compare refs and commits"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ color: "var(--rs-text-primary)", fontSize: 12, fontWeight: 650 }}>
          Compare
        </span>
        <CompareSelect label="Base" value={base} refs={refs} onChange={onBaseChange} />
        <span style={{ color: "var(--rs-text-muted)", fontFamily: "var(--rs-mono)", fontSize: 12 }}>
          ..
        </span>
        <CompareSelect label="Target" value={target} refs={refs} onChange={onTargetChange} />
        <button className="rs-compact-button" type="button" onClick={onPinSelectedAsBase} disabled={!selectedCommit}>
          Base = selected
        </button>
        <button className="rs-compact-button" type="button" onClick={onPinCurrentRefAsTarget} disabled={!selectedRef}>
          Target = current ref
        </button>
        <button className="rs-compact-button" type="button" onClick={onClear} disabled={!active}>
          Clear
        </button>
      </div>
      {loading ? (
        <CompareSummary>Comparing refs...</CompareSummary>
      ) : result ? (
        <>
          <CompareSummary>
            Ahead {result.ahead} / Behind {result.behind} / Files {result.files} / +{result.added} -{result.deleted}
          </CompareSummary>
          <CompareGraph result={result} />
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            <CopyCommand label="Copy log" command={result.commands.log} />
            <CopyCommand label="Copy stat" command={result.commands.stat} />
            <CopyCommand label="Copy diff" command={result.commands.diff} />
            <button
              type="button"
              className="rs-compact-button"
              onClick={loadCherry}
              disabled={cherryLoading || !base || !target}
              title="Detect cherry-pick equivalents (patch-id correlation, opt-in)"
            >
              {cherryLoading ? "Checking…" : "Cherry-pick status"}
            </button>
            <label
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--rs-text-muted)" }}
              title="Near-identical threshold: equivalent entries with ≤ N changed lines are graded 'near-identical'; more than N lines = 'divergent'. Default 10 is a derived heuristic — adjust per your repo's typical commit size."
            >
              Threshold
              <input
                type="number"
                min={1}
                max={50}
                value={threshold}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isInteger(v) && v >= 1 && v <= 50) setThreshold(v);
                }}
                style={{
                  width: 44,
                  padding: "1px 4px",
                  fontSize: 11,
                  borderRadius: "var(--rs-radius-sm)",
                  border: "1px solid var(--rs-border)",
                  background: "var(--rs-bg-input, var(--rs-bg-elevated))",
                  color: "var(--rs-text-primary)",
                }}
              />
              lines
            </label>
          </div>
          {cherryError ? (
            <CompareSummary>Cherry-pick check failed: {cherryError}</CompareSummary>
          ) : null}
          {cherry ? <CherryStatus cherry={cherry} threshold={threshold} /> : null}
        </>
      ) : active ? (
        <CompareSummary>Choose both base and target to compare.</CompareSummary>
      ) : (
        <CompareSummary>Pin a selected commit or ref to compare branch movement.</CompareSummary>
      )}
    </section>
  );
}

function CompareBarCollapsible({
  refs,
  repoId,
  selectedRef,
  selectedCommit,
  compareBase,
  compareTarget,
  compareResult,
  compareLoading,
  onCompareBaseChange,
  onCompareTargetChange,
  onPinSelectedAsBase,
  onPinCurrentRefAsTarget,
  onClearCompare,
  collapsed,
  onToggle,
}: {
  refs: GitRef[];
  repoId: string;
  selectedRef: string;
  selectedCommit: Commit | null;
  compareBase: string;
  compareTarget: string;
  compareResult: CompareResult | null;
  compareLoading: boolean;
  onCompareBaseChange: (value: string) => void;
  onCompareTargetChange: (value: string) => void;
  onPinSelectedAsBase: () => void;
  onPinCurrentRefAsTarget: () => void;
  onClearCompare: () => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const isCompareActive = Boolean(compareBase || compareTarget);
  // When compare is active, force open regardless of collapsed setting
  const isOpen = isCompareActive || !collapsed;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={(open) => {
        // Only allow toggling when compare is not active (active forces expansion)
        if (!isCompareActive) {
          if (open !== isOpen) onToggle();
        }
      }}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="mx-4 mt-3 w-[calc(100%-2rem)] flex items-center justify-between px-3 rounded-t-md"
          style={{
            minHeight: 28,
            background: isCompareActive ? "var(--rs-bg-elevated)" : "var(--rs-bg-panel)",
            border: "1px solid var(--rs-border)",
            borderBottomColor: isOpen ? "transparent" : "var(--rs-border)",
            borderRadius: isOpen ? "var(--rs-radius-md) var(--rs-radius-md) 0 0" : "var(--rs-radius-md)",
            color: "var(--rs-text-secondary)",
            fontSize: 11,
            cursor: "pointer",
          }}
          aria-controls="rs-compare-bar-content"
        >
          <span>Compare</span>
          <ChevronDown
            size={13}
            aria-hidden
            style={{
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 120ms ease-out",
            }}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent id="rs-compare-bar-content">
        <div
          className="mx-4 rounded-b-md overflow-hidden"
          style={{
            border: "1px solid var(--rs-border)",
            borderTop: "none",
          }}
        >
          <CompareBar
            refs={refs}
            repoId={repoId}
            selectedRef={selectedRef}
            selectedCommit={selectedCommit}
            base={compareBase}
            target={compareTarget}
            result={compareResult}
            loading={compareLoading}
            onBaseChange={onCompareBaseChange}
            onTargetChange={onCompareTargetChange}
            onPinSelectedAsBase={onPinSelectedAsBase}
            onPinCurrentRefAsTarget={onPinCurrentRefAsTarget}
            onClear={onClearCompare}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CherryStatus({ cherry, threshold }: { cherry: CompareCherryResult; threshold: number }) {
  // Bound the rendered list — large compares can produce thousands of lines
  // and we'd freeze the panel. The user already sees the full count so
  // truncation is honest, not silent.
  const CAP = 50;
  const activeThreshold = cherry.threshold ?? threshold;
  return (
    <div className="mt-3" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <GradedCherryList
        entries={cherry.equivalent}
        cap={CAP}
        threshold={activeThreshold}
      />
      <CherryList
        title="Missing on target"
        hint="Base has these, target does not."
        accent="var(--rs-git-deleted)"
        entries={cherry.missing}
        cap={CAP}
      />
    </div>
  );
}

/** Grade colour tokens for the cherry-pick equivalence panel (D-6). */
const GRADE_COLORS = {
  identical: "var(--rs-git-added)",
  "near-identical": "var(--color-amber-500, #f59e0b)",
  divergent: "var(--rs-git-deleted)",
  ungraded: "var(--rs-text-muted)",
} as const;

const GRADE_LABELS = {
  identical: "identical",
  "near-identical": "near-identical",
  divergent: "divergent",
  ungraded: "ungraded",
} as const;

/** Inline diff viewer for cherry-pick equivalence hunks. */
function CherryDiffHunks({ hunks, truncated }: { hunks: string; truncated?: boolean }) {
  const lines = hunks.split("\n");
  return (
    <div
      style={{
        marginTop: 4,
        padding: "4px 6px",
        borderRadius: "var(--rs-radius-sm)",
        background: "var(--rs-bg-input, var(--rs-bg-panel))",
        border: "1px solid var(--rs-border)",
        overflow: "auto",
        maxHeight: 200,
        fontSize: 10,
        fontFamily: "var(--rs-mono)",
        lineHeight: 1.5,
        whiteSpace: "pre",
      }}
    >
      {lines.map((line, i) => {
        const isAdded = line.startsWith("+") && !line.startsWith("+++");
        const isDeleted = line.startsWith("-") && !line.startsWith("---");
        return (
          <div
            key={i}
            style={{
              color: isAdded
                ? "var(--rs-git-added)"
                : isDeleted
                  ? "var(--rs-git-deleted)"
                  : "var(--rs-text-muted)",
              background: isAdded
                ? "color-mix(in oklab, transparent, var(--rs-git-added) 10%)"
                : isDeleted
                  ? "color-mix(in oklab, transparent, var(--rs-git-deleted) 10%)"
                  : "transparent",
            }}
          >
            {line || " "}
          </div>
        );
      })}
      {truncated ? (
        <div style={{ color: "var(--rs-text-muted)", marginTop: 2 }}>[truncated — diff exceeded server byte cap]</div>
      ) : null}
    </div>
  );
}

/** Single expandable row for a graded equivalent entry. */
function GradedCherryRow({ entry }: { entry: CherryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = entry.diffHunks && (entry.grade === "near-identical" || entry.grade === "divergent");
  const gradeColor = entry.grade ? GRADE_COLORS[entry.grade] : "var(--rs-text-muted)";
  const gradeLabel = entry.grade ? GRADE_LABELS[entry.grade] : undefined;

  return (
    <li style={{ lineHeight: 1.6 }}>
      <div
        className="flex items-center gap-1"
        style={{ cursor: hasDetail ? "pointer" : "default" }}
        onClick={() => { if (hasDetail) setExpanded((v) => !v); }}
        title={`${entry.hash} ${entry.subject}`}
      >
        {/* grade badge */}
        {gradeLabel ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.04em",
              padding: "0 4px",
              borderRadius: "var(--rs-radius-sm)",
              background: `color-mix(in oklab, var(--rs-bg-elevated), ${gradeColor} 20%)`,
              color: gradeColor,
              border: `1px solid color-mix(in oklab, var(--rs-border), ${gradeColor} 40%)`,
              flexShrink: 0,
              textTransform: "uppercase",
            }}
          >
            {gradeLabel}
          </span>
        ) : null}
        {/* diff line count */}
        {entry.diffLines && entry.grade !== "identical" ? (
          <span style={{ fontSize: 9, color: "var(--rs-text-muted)", flexShrink: 0 }}>
            +{entry.diffLines.added} -{entry.diffLines.deleted}
          </span>
        ) : null}
        {/* expand chevron */}
        {hasDetail ? (
          <span
            style={{
              fontSize: 9,
              color: "var(--rs-text-muted)",
              flexShrink: 0,
              transform: expanded ? "rotate(180deg)" : "none",
              display: "inline-block",
              transition: "transform 100ms",
            }}
          >
            ▾
          </span>
        ) : null}
        {/* hash + subject */}
        <span
          className="truncate"
          style={{ fontSize: 11, fontFamily: "var(--rs-mono)", color: "var(--rs-text-primary)" }}
        >
          <span style={{ color: "var(--rs-text-muted)" }}>{entry.shortHash}</span>{" "}
          {entry.subject}
        </span>
      </div>
      {expanded && entry.diffHunks ? (
        <CherryDiffHunks hunks={entry.diffHunks} truncated={entry.truncated} />
      ) : null}
    </li>
  );
}

/**
 * Equivalent cherry-pick list with 3-tier grade badges (D-6).
 * Maintains the existing group structure; groups equivalent entries into
 * identical / near-identical / divergent sub-groups within the same panel.
 */
function GradedCherryList({
  entries,
  cap,
  threshold,
}: {
  entries: CherryEntry[];
  cap: number;
  threshold: number;
}) {
  const accent = "var(--rs-git-added)";
  const visible = entries.slice(0, cap);

  // Sub-group counts for the header summary.
  const identicalCount = entries.filter((e) => e.grade === "identical").length;
  const nearCount = entries.filter((e) => e.grade === "near-identical").length;
  const divergentCount = entries.filter((e) => e.grade === "divergent").length;
  const ungradedCount = entries.filter((e) => !e.grade || e.grade === "ungraded").length;

  const hasGrades = identicalCount + nearCount + divergentCount > 0;

  return (
    <div
      style={{
        border: `1px solid color-mix(in oklab, var(--rs-border), ${accent} 30%)`,
        borderRadius: "var(--rs-radius-sm)",
        background: `color-mix(in oklab, var(--rs-bg-elevated), ${accent} 6%)`,
        padding: "6px 8px",
      }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span style={{ fontSize: 11, fontWeight: 650, color: accent }}>
          Equivalent on target ({entries.length})
        </span>
        <span style={{ fontSize: 10, color: "var(--rs-text-muted)" }}>
          {hasGrades
            ? `${identicalCount} identical · ${nearCount} near (≤${threshold}) · ${divergentCount} divergent${ungradedCount > 0 ? ` · ${ungradedCount} ungraded` : ""}`
            : "Already cherry-picked (patch-id match)."}
        </span>
      </div>
      {entries.length === 0 ? (
        <span style={{ fontSize: 11, color: "var(--rs-text-muted)" }}>None.</span>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {visible.map((entry) => (
            <GradedCherryRow key={entry.hash} entry={entry} />
          ))}
          {entries.length > cap ? (
            <li style={{ fontSize: 10, color: "var(--rs-text-muted)", marginTop: 4 }}>
              … {entries.length - cap} more not shown
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function CherryList({
  title,
  hint,
  accent,
  entries,
  cap,
}: {
  title: string;
  hint: string;
  accent: string;
  entries: CompareCherryResult["equivalent"];
  cap: number;
}) {
  const visible = entries.slice(0, cap);
  return (
    <div
      style={{
        border: `1px solid color-mix(in oklab, var(--rs-border), ${accent} 30%)`,
        borderRadius: "var(--rs-radius-sm)",
        background: `color-mix(in oklab, var(--rs-bg-elevated), ${accent} 6%)`,
        padding: "6px 8px",
      }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span style={{ fontSize: 11, fontWeight: 650, color: accent }}>
          {title} ({entries.length})
        </span>
        <span style={{ fontSize: 10, color: "var(--rs-text-muted)" }}>{hint}</span>
      </div>
      {entries.length === 0 ? (
        <span style={{ fontSize: 11, color: "var(--rs-text-muted)" }}>None.</span>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {visible.map((entry) => (
            <li
              key={entry.hash}
              className="truncate"
              style={{
                fontSize: 11,
                fontFamily: "var(--rs-mono)",
                color: "var(--rs-text-primary)",
                lineHeight: 1.6,
              }}
              title={`${entry.hash} ${entry.subject}`}
            >
              <span style={{ color: "var(--rs-text-muted)" }}>{entry.shortHash}</span>{" "}
              {entry.subject}
            </li>
          ))}
          {entries.length > cap ? (
            <li style={{ fontSize: 10, color: "var(--rs-text-muted)", marginTop: 4 }}>
              … {entries.length - cap} more not shown
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function CompareGraph({ result }: { result: CompareResult }) {
  const totalDivergence = result.ahead + result.behind;
  const aheadPercent = totalDivergence ? Math.round((result.ahead / totalDivergence) * 100) : 0;
  const behindPercent = totalDivergence ? 100 - aheadPercent : 0;
  const totalChurn = result.added + result.deleted;
  const addedPercent = totalChurn ? Math.round((result.added / totalChurn) * 100) : 0;
  const deletedPercent = totalChurn ? 100 - addedPercent : 0;

  return (
    <div
      className="mt-2 grid gap-2"
      aria-label={`Compare graph: ${result.ahead} ahead, ${result.behind} behind, ${result.added} additions, ${result.deleted} deletions`}
      style={{ maxWidth: 520 }}
    >
      <CompareGraphRow
        label="Divergence"
        leftLabel={`${result.behind} behind`}
        rightLabel={`${result.ahead} ahead`}
        leftPercent={behindPercent}
        rightPercent={aheadPercent}
        leftColor="var(--rs-warning)"
        rightColor="var(--rs-accent)"
      />
      <CompareGraphRow
        label="Churn"
        leftLabel={`-${result.deleted}`}
        rightLabel={`+${result.added}`}
        leftPercent={deletedPercent}
        rightPercent={addedPercent}
        leftColor="var(--rs-git-deleted)"
        rightColor="var(--rs-git-added)"
      />
    </div>
  );
}

function CompareGraphRow({
  label,
  leftLabel,
  rightLabel,
  leftPercent,
  rightPercent,
  leftColor,
  rightColor,
}: {
  label: string;
  leftLabel: string;
  rightLabel: string;
  leftPercent: number;
  rightPercent: number;
  leftColor: string;
  rightColor: string;
}) {
  return (
    <div className="grid items-center gap-2" style={{ gridTemplateColumns: "70px 1fr 104px" }}>
      <span style={{ color: "var(--rs-text-muted)", fontSize: 10 }}>{label}</span>
      <span
        className="flex overflow-hidden rounded-sm"
        style={{ height: 7, background: "var(--rs-bg-canvas)" }}
        aria-hidden
      >
        <span style={{ width: `${leftPercent}%`, background: leftColor }} />
        <span style={{ width: `${rightPercent}%`, background: rightColor }} />
      </span>
      <span
        className="truncate"
        style={{ color: "var(--rs-text-secondary)", fontSize: 10, fontFamily: "var(--rs-mono)" }}
        title={`${leftLabel} / ${rightLabel}`}
      >
        {leftLabel} / {rightLabel}
      </span>
    </div>
  );
}

function CompareSelect({
  label,
  value,
  refs,
  onChange,
}: {
  label: string;
  value: string;
  refs: GitRef[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="rs-compare-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose...</option>
        <option value="HEAD">HEAD</option>
        {refs.map((ref) => (
          <option key={ref.name} value={ref.name}>
            {ref.type === "branch" ? ref.shortName : `${ref.type}: ${ref.shortName}`}
          </option>
        ))}
        {value && refs.every((ref) => ref.name !== value) && value !== "HEAD" ? (
          <option value={value}>{shortRevision(value)}</option>
        ) : null}
      </select>
    </label>
  );
}

function CompareSummary({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2" style={{ color: "var(--rs-text-secondary)", fontSize: 12 }}>
      {children}
    </div>
  );
}

function CopyCommand({ label, command }: { label: string; command: string }) {
  return (
    <button
      className="rs-compact-button"
      type="button"
      onClick={() => void navigator.clipboard?.writeText(command)}
      title={command}
    >
      {label}
    </button>
  );
}

function shortRevision(value: string) {
  return value.length === 40 ? value.slice(0, 7) : value;
}

function isApiConnectionError(message: string) {
  return message.startsWith("Cannot reach API at ");
}

function ApiRecoveryHint() {
  return (
    <div
      className="mx-4 mt-2 rounded-md px-3 py-2.5"
      style={{
        background: "var(--rs-bg-elevated)",
        border: "1px solid var(--rs-border)",
        color: "var(--rs-text-secondary)",
        fontSize: 12,
      }}
    >
      <div style={{ color: "var(--rs-text-primary)", fontWeight: 600 }}>Start local services</div>
      <div style={{ marginTop: 4 }}>
        From the repository root, run this command, then reload the browser:
      </div>
      <code
        className="mt-2 block rounded px-2 py-1.5"
        style={{
          background: "var(--rs-bg-canvas)",
          color: "var(--rs-text-primary)",
          fontFamily: "var(--rs-mono)",
          fontSize: 11,
          whiteSpace: "pre-wrap",
        }}
      >
        make dev-self
      </code>
      <div style={{ marginTop: 6 }}>
        To inspect another repository, run{" "}
        <code style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-primary)" }}>
          make dev-app RTGV_REPOS=viewer=/absolute/path
        </code>
        .
      </div>
    </div>
  );
}

function MessageBanner({
  title,
  message,
  tone = "accent",
}: {
  title: string;
  message: string;
  tone?: "accent" | "warning";
}) {
  const color = tone === "warning" ? "var(--rs-warning)" : "var(--rs-accent)";
  return (
    <div
      className="mx-4 mt-3 px-3 py-2.5 rounded-md flex items-start gap-2.5"
      role="alert"
      style={{
        background: `color-mix(in oklab, var(--rs-bg-elevated), ${color} 12%)`,
        border: `1px solid color-mix(in oklab, var(--rs-border), ${color} 55%)`,
      }}
    >
      <AlertTriangle size={14} style={{ color, marginTop: 2 }} />
      <div className="flex-1" style={{ fontSize: 12 }}>
        <div style={{ color, fontWeight: 600 }}>{title}</div>
        <div
          style={{
            color: "var(--rs-text-secondary)",
            marginTop: 2,
            fontFamily: "var(--rs-mono)",
            fontSize: 11,
          }}
        >
          {message}
        </div>
      </div>
    </div>
  );
}

function StateMessage({ title, message }: { title: string; message: string }) {
  return (
    <div
      className="m-4 rounded-md px-4 py-5"
      style={{
        background: "var(--rs-bg-panel)",
        border: "1px solid var(--rs-border)",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--rs-text-primary)", fontWeight: 600 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "var(--rs-text-secondary)", marginTop: 4 }}>
        {message}
      </div>
    </div>
  );
}

/**
 * Priority order for aggregating per-file structural kinds into a commit-level
 * badge. "Worst" kind wins — a commit with one logic_change file is flagged.
 * This is a DERIVATION (heuristic); see StructuralDiffBadge for tooltip text.
 */
const KIND_PRIORITY: Record<StructuralKind, number> = {
  whitespace_only: 0,
  comment_only: 1,
  rename_only: 2,
  symmetric: 3,
  mixed: 4,
  logic_change: 5,
};

function aggregateCommitKind(files: Commit["files"]): StructuralKind | undefined {
  if (!files || files.length === 0) return undefined;
  const kinds = files
    .map((f) => f.structuralKind)
    .filter((k): k is StructuralKind => Boolean(k));
  if (kinds.length === 0) return undefined;
  return kinds.reduce((worst, current) => {
    const w = KIND_PRIORITY[worst] ?? 4;
    const c = KIND_PRIORITY[current] ?? 4;
    return c > w ? current : worst;
  }, "whitespace_only" as StructuralKind);
}

function CommitRow({
  commit,
  prev,
  next,
  selected,
  onClick,
  onSetAsCompareBase,
  onSetAsCompareTarget,
  onFilterByAuthor,
}: {
  commit: Commit;
  prev?: Commit;
  next?: Commit;
  selected: boolean;
  onClick: () => void;
  onSetAsCompareBase?: (hash: string) => void;
  onSetAsCompareTarget?: (hash: string) => void;
  onFilterByAuthor?: (author: string) => void;
}) {
  const laneColor = LANE_COLORS[commit.lane] ?? LANE_COLORS[0];
  const fileCount = commit.fileCount ?? commit.files.length;
  const hasStats = commit.added > 0 || commit.deleted > 0 || fileCount > 0;
  const shortHash = commit.shortHash ?? commit.hash.slice(0, 7);
  const commitStructuralKind = aggregateCommitKind(commit.files);

  const row = (
    <li
      role="listitem"
      aria-current={selected ? "true" : undefined}
      tabIndex={0}
      data-hash={commit.hash}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      className="grid cursor-pointer items-stretch group"
      style={{
        gridTemplateColumns: "56px 1fr auto",
        gap: 12,
        padding: "10px 16px",
        background: selected
          ? "color-mix(in oklab, var(--rs-bg-panel), var(--rs-accent) 10%)"
          : commit.isNew
          ? "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 4%)"
          : "transparent",
        boxShadow: selected ? "inset 2px 0 0 var(--rs-accent)" : undefined,
        borderTop: "1px solid color-mix(in oklab, var(--rs-border), transparent 55%)",
      }}
      onMouseEnter={(e) => {
        if (!selected)
          (e.currentTarget as HTMLElement).style.background =
            "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 4%)";
      }}
      onMouseLeave={(e) => {
        if (!selected)
          (e.currentTarget as HTMLElement).style.background = commit.isNew
            ? "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 4%)"
            : "transparent";
      }}
    >
      <GraphCell commit={commit} prev={prev} next={next} laneColor={laneColor} />

      <div className="min-w-0 flex flex-col" style={{ gap: 3 }}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 min-w-0">
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 11,
              color: "var(--rs-text-muted)",
            }}
          >
            {commit.hash.slice(0, 7)}
          </span>
          <ConventionalSubject subject={commit.subject} bold={commit.isMerge} />
          {commit.isNew ? <Badge tone="accent" ariaLabel="New commit from live update">New</Badge> : null}
          {commit.isMerge ? (
            <Badge tone="merge" ariaLabel="Merge commit">
              <GitMerge size={10} aria-hidden /> Merge
            </Badge>
          ) : null}
          {commit.signed ? (
            <Badge tone="accent" ariaLabel={`Commit signature status: ${formatSignatureStatus(commit.signatureStatus)}`}>
              <ShieldCheck size={10} aria-hidden /> {formatSignatureStatus(commit.signatureStatus)}
            </Badge>
          ) : null}
          {commit.refs?.map((r) => (
            <Badge key={r} tone="branch" ariaLabel={`Commit ref ${r}`}>
              {r}
            </Badge>
          ))}
          {commit.branch ? <Badge tone="branchAlt" ariaLabel={`Commit branch ${commit.branch}`}>{commit.branch}</Badge> : null}
        </div>
        <div
          className="flex items-center gap-2"
          style={{ fontSize: 11, color: "var(--rs-text-muted)" }}
        >
          <Avatar name={commit.author} />
          <span>{commit.author}</span>
          <span>·</span>
          <span>{commit.time}</span>
          {hasStats ? (
            <>
              <span>·</span>
              <span style={{ color: "var(--rs-git-added)", fontFamily: "var(--rs-mono)" }}>
                +{commit.added}
              </span>
              <span style={{ color: "var(--rs-git-deleted)", fontFamily: "var(--rs-mono)" }}>
                -{commit.deleted}
              </span>
              <span>· {fileCount} files</span>
              {commitStructuralKind ? (
                <StructuralDiffBadge kind={commitStructuralKind} compact />
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="self-center flex items-center gap-2">
        <span
          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
          style={{ fontSize: 11, color: "var(--rs-text-muted)", fontFamily: "var(--rs-mono)" }}
        >
          ↵ open
        </span>
      </div>
    </li>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => void navigator.clipboard?.writeText(commit.hash)}
        >
          <Copy />
          Copy commit hash
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void navigator.clipboard?.writeText(shortHash)}
        >
          <Copy />
          Copy short hash
          <span
            className="ml-auto"
            style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-muted)" }}
          >
            {shortHash}
          </span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void navigator.clipboard?.writeText(commit.subject)}
        >
          <Copy />
          Copy subject
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!onSetAsCompareBase}
          onSelect={() => onSetAsCompareBase?.(commit.hash)}
        >
          <GitCompareArrows />
          Set as compare base
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!onSetAsCompareTarget}
          onSelect={() => onSetAsCompareTarget?.(commit.hash)}
        >
          <GitCompareArrows />
          Set as compare target
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!onFilterByAuthor || !commit.author}
          onSelect={() => onFilterByAuthor?.(commit.author)}
        >
          <User />
          Filter by author "{commit.author}"
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Pseudo-row representing the working tree (HEAD vs index + index vs worktree).
 *
 * Boundary discipline:
 * - The summary numbers come straight from the API's numstat aggregation —
 *   the literal sum of Git's `--numstat` output, not a refscope-derived
 *   total.
 * - The "Not yet committed" badge plus the dashed top border mark this row
 *   as an observation-zone artefact that is *not* a commit. The visual
 *   treatment is intentionally distinct from a committed `CommitRow` so
 *   users never confuse uncommitted state for history.
 * - The row is keyboard-accessible (Enter/Space) and exposes
 *   `aria-pressed` so assistive tech reads selection state correctly.
 */
function WorkTreeRow({
  workTree,
  selected,
  onSelect,
  onRefresh,
}: {
  workTree: WorkTreeResponse;
  selected: boolean;
  onSelect: () => void;
  onRefresh: () => void;
}) {
  const totalFiles =
    workTree.staged.summary.fileCount + workTree.unstaged.summary.fileCount;
  const totalAdded =
    workTree.staged.summary.added + workTree.unstaged.summary.added;
  const totalDeleted =
    workTree.staged.summary.deleted + workTree.unstaged.summary.deleted;
  const stagedFiles = workTree.staged.summary.fileCount;
  const unstagedFiles = workTree.unstaged.summary.fileCount;

  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Working tree: ${totalFiles} files changed (staged ${stagedFiles}, unstaged ${unstagedFiles}). Not yet committed.`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className="grid cursor-pointer items-stretch group"
      style={{
        gridTemplateColumns: "56px 1fr auto",
        gap: 12,
        padding: "10px 16px",
        background: selected
          ? "color-mix(in oklab, var(--rs-bg-panel), var(--rs-warning) 12%)"
          : "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-warning) 4%)",
        boxShadow: selected ? "inset 2px 0 0 var(--rs-warning)" : undefined,
        // Dashed top border + solid bottom border: observation-zone vs
        // history-zone separator. Same token palette as the rest of the
        // timeline — no new variables introduced.
        borderTop: "1px dashed color-mix(in oklab, var(--rs-border), var(--rs-warning) 50%)",
        borderBottom: "1px solid var(--rs-border)",
      }}
      onMouseEnter={(e) => {
        if (!selected)
          (e.currentTarget as HTMLElement).style.background =
            "color-mix(in oklab, var(--rs-bg-panel), var(--rs-warning) 8%)";
      }}
      onMouseLeave={(e) => {
        if (!selected)
          (e.currentTarget as HTMLElement).style.background =
            "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-warning) 4%)";
      }}
    >
      <div className="relative" style={{ width: 56 }} aria-hidden>
        <span
          className="absolute"
          style={{
            left: 9,
            top: "calc(50% - 7px)",
            width: 14,
            height: 14,
            borderRadius: 4,
            border: "1.5px dashed var(--rs-warning)",
            background: "transparent",
          }}
        />
      </div>

      <div className="min-w-0 flex flex-col" style={{ gap: 3 }}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 10,
              letterSpacing: "0.06em",
              color: "var(--rs-warning)",
              fontWeight: 700,
            }}
          >
            WORKING TREE
          </span>
          <span
            className="px-1.5 rounded-full inline-flex items-center"
            style={{
              fontSize: 10,
              fontFamily: "var(--rs-mono)",
              height: 18,
              padding: "1px 8px",
              color: "var(--rs-warning)",
              background:
                "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 14%)",
              border:
                "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 50%)",
            }}
          >
            Not yet committed
          </span>
          <span
            className="px-1.5 rounded-full inline-flex items-center"
            style={{
              fontSize: 10,
              fontFamily: "var(--rs-mono)",
              height: 18,
              padding: "1px 8px",
              color: "var(--rs-text-muted)",
              border: "1px solid var(--rs-border)",
            }}
            title="Derived view: aggregated from `git diff` and `git diff --cached`"
          >
            DRV
          </span>
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}
        >
          <span style={{ color: "var(--rs-text-primary)", fontWeight: 600 }}>
            {totalFiles} {totalFiles === 1 ? "file" : "files"} changed
          </span>
          <span>·</span>
          <span style={{ color: "var(--rs-git-added)", fontFamily: "var(--rs-mono)" }}>
            +{totalAdded}
          </span>
          <span style={{ color: "var(--rs-git-deleted)", fontFamily: "var(--rs-mono)" }}>
            -{totalDeleted}
          </span>
          <span>·</span>
          <span style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-muted)" }}>
            staged: {stagedFiles}
          </span>
          <span style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-muted)" }}>
            unstaged: {unstagedFiles}
          </span>
          <span>·</span>
          <span style={{ color: "var(--rs-text-muted)" }}>
            {formatRelativeTime(workTree.snapshotAt)}
          </span>
        </div>
      </div>

      <div className="self-center flex items-center gap-1">
        <button
          type="button"
          className="rs-icon-btn"
          aria-label="Refresh working tree"
          title="Refresh working tree"
          onClick={(e) => {
            // Prevent the row's click handler from firing — refreshing
            // should not change selection.
            e.stopPropagation();
            onRefresh();
          }}
          onKeyDown={(e) => {
            // Stop Space/Enter from bubbling to the row's keydown handler.
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
            }
          }}
          style={{ width: 22, height: 22 }}
        >
          <RefreshCw size={12} aria-hidden />
        </button>
      </div>
    </li>
  );
}

/**
 * Simple "Xs ago" / "Xm ago" formatter for the snapshot timestamp. Mirrors
 * the relative-time helper in `api.ts` but kept local so this component
 * doesn't need to import from outside its visual scope.
 */
function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatSignatureStatus(status: Commit["signatureStatus"]) {
  if (!status || status === "valid") return "Signed";
  return status
    .split("-")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function GraphCell({
  commit,
  prev,
  next,
  laneColor,
}: {
  commit: Commit;
  prev?: Commit;
  next?: Commit;
  laneColor: string;
}) {
  const x = 14 + commit.lane * 14;
  return (
    <div className="relative" style={{ width: 56 }}>
      <svg width="56" height="100%" style={{ position: "absolute", inset: 0 }}>
        {prev ? (
          <line
            x1={x}
            y1={0}
            x2={14 + (prev.lane * 14)}
            y2={"50%" as unknown as number}
            stroke={laneColor}
            strokeWidth={1.5}
          />
        ) : null}
        {next ? (
          <line
            x1={x}
            y1={"50%" as unknown as number}
            x2={14 + (next.lane * 14)}
            y2={"100%" as unknown as number}
            stroke={LANE_COLORS[next.lane] ?? laneColor}
            strokeWidth={1.5}
          />
        ) : null}
        {commit.isMerge ? (
          <line
            x1={x}
            y1={"50%" as unknown as number}
            x2={x + 14}
            y2={"50%" as unknown as number}
            stroke="var(--rs-git-merge)"
            strokeWidth={2}
          />
        ) : null}
      </svg>
      <span
        className="absolute rounded-full"
        style={{
          left: x - 5,
          top: "calc(50% - 5px)",
          width: 10,
          height: 10,
          background: commit.isMerge ? "var(--rs-git-merge)" : laneColor,
          boxShadow: commit.isNew
            ? `0 0 0 4px color-mix(in oklab, ${laneColor}, transparent 70%)`
            : `0 0 0 2px var(--rs-bg-canvas)`,
        }}
      />
    </div>
  );
}

// Type → CSS variable mapping for Conventional Commits. The palette reuses
// existing Refscope tokens so the badges visually agree with the diff /
// merge / git-status colors users already learned. Unknown types fall
// through to muted gray (treated as `chore`-like noise).
const CONVENTIONAL_TYPE_COLORS: Record<string, string> = {
  feat: "var(--rs-git-added)",
  fix: "var(--rs-git-deleted)",
  perf: "var(--rs-warning)",
  refactor: "var(--rs-git-modified)",
  docs: "var(--rs-accent)",
  test: "var(--rs-git-merge)",
  build: "var(--rs-text-muted)",
  ci: "var(--rs-text-muted)",
  chore: "var(--rs-text-muted)",
  style: "var(--rs-text-muted)",
  revert: "var(--rs-git-deleted)",
};

function ConventionalSubject({
  subject,
  bold,
}: {
  subject: string;
  bold: boolean;
}) {
  const parsed = parseConventionalCommit(subject);
  const baseStyle: React.CSSProperties = {
    fontSize: 13,
    color: "var(--rs-text-primary)",
    fontWeight: bold ? 500 : 400,
  };
  // Non-conventional subjects: render as before so we never silently distort
  // arbitrary commit messages by stripping a leading word.
  if (!parsed) {
    return (
      <span className="truncate" style={baseStyle}>
        {subject}
      </span>
    );
  }
  const tint = CONVENTIONAL_TYPE_COLORS[parsed.type] ?? "var(--rs-text-muted)";
  return (
    <span className="inline-flex items-center gap-1.5 truncate" style={{ minWidth: 0 }}>
      <span
        title={`Conventional commit type: ${parsed.type}${parsed.breaking ? " (breaking)" : ""}`}
        className="inline-flex items-center rounded-full"
        aria-label={`Type ${parsed.type}${parsed.breaking ? ", breaking change" : ""}`}
        style={{
          padding: "1px 6px",
          fontSize: 10,
          fontFamily: "var(--rs-mono)",
          height: 18,
          color: tint,
          background: `color-mix(in oklab, var(--rs-bg-elevated), ${tint} 18%)`,
          border: `1px solid color-mix(in oklab, var(--rs-border), ${tint} 45%)`,
          flexShrink: 0,
        }}
      >
        {parsed.type}
        {parsed.breaking ? "!" : ""}
      </span>
      {parsed.scope ? (
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--rs-mono)",
            color: "var(--rs-text-muted)",
            flexShrink: 0,
          }}
        >
          {parsed.scope}
        </span>
      ) : null}
      <span className="truncate" style={baseStyle}>
        {parsed.description}
      </span>
    </span>
  );
}

function Badge({
  children,
  tone,
  ariaLabel,
}: {
  children: ReactNode;
  tone: "merge" | "accent" | "branch" | "branchAlt";
  ariaLabel?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    merge: {
      color: "var(--rs-git-merge)",
      background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-git-merge) 18%)",
      border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-git-merge) 40%)",
    },
    accent: {
      color: "var(--rs-accent)",
      background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 14%)",
      border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 40%)",
    },
    branch: {
      color: "var(--rs-text-primary)",
      background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 22%)",
      border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
    },
    branchAlt: {
      color: "var(--rs-text-secondary)",
      background: "var(--rs-bg-elevated)",
      border: "1px solid var(--rs-border)",
    },
  };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full"
      aria-label={ariaLabel}
      style={{
        padding: "1px 8px",
        fontSize: 10,
        fontFamily: "var(--rs-mono)",
        height: 18,
        ...styles[tone],
      }}
    >
      {children}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const palette = [
    "var(--rs-accent)",
    "var(--rs-git-merge)",
    "var(--rs-git-modified)",
    "var(--rs-git-added)",
  ];
  const color = palette[name.charCodeAt(0) % palette.length];
  return (
    <span
      className="grid place-items-center rounded-full"
      style={{
        width: 16,
        height: 16,
        background: `color-mix(in oklab, var(--rs-bg-elevated), ${color} 35%)`,
        color,
        fontSize: 9,
        fontWeight: 700,
      }}
    >
      {name[0]?.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CommitKindFilterBar (D-2)
// ---------------------------------------------------------------------------

/**
 * 3-state toggle bar for filtering commits by coarse structural kind.
 * DERIVATION — filters on `coarseKind` which is a numstat-based heuristic.
 * Hover tooltip discloses the classification logic (threshold transparency).
 */
function CommitKindFilterBar({
  value,
  onChange,
}: {
  value: "all" | "refactor" | "logic";
  onChange: (v: "all" | "refactor" | "logic") => void;
}) {
  const TOOLTIP_TEXT =
    "Coarse classification is a heuristic based on numstat totals.\n" +
    "Refactor: symmetry ≥ 90% AND total lines ≤ 50.\n" +
    "Logic: asymmetric or large diff, or contains binary files.\n" +
    "For precise classification, select a commit to see per-file structural kind.";

  const options: Array<{ key: "all" | "refactor" | "logic"; label: string }> = [
    { key: "all", label: "All" },
    { key: "refactor", label: "~Refactor" },
    { key: "logic", label: "Logic change" },
  ];

  return (
    <div
      className="flex items-center gap-2 px-4 py-1"
      style={{
        borderBottom: "1px solid var(--rs-border)",
        background: "var(--rs-bg-panel)",
        fontSize: 11,
      }}
    >
      <span style={{ color: "var(--rs-text-muted)", userSelect: "none" }}>Kind:</span>
      <div className="flex items-center gap-1">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            style={{
              padding: "1px 8px",
              borderRadius: "var(--rs-radius-sm)",
              fontSize: 11,
              cursor: "pointer",
              border: "1px solid",
              borderColor: value === opt.key ? "var(--rs-accent)" : "var(--rs-border)",
              background:
                value === opt.key
                  ? "color-mix(in srgb, var(--rs-accent) 15%, transparent)"
                  : "transparent",
              color: value === opt.key ? "var(--rs-accent)" : "var(--rs-text-secondary)",
              transition: "all 100ms",
            }}
            aria-pressed={value === opt.key}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <span
        title={TOOLTIP_TEXT}
        style={{
          cursor: "help",
          color: "var(--rs-text-muted)",
          fontSize: 11,
          userSelect: "none",
        }}
        aria-label="Classification criteria"
      >
        ?
      </span>
    </div>
  );
}

function StatusBar({
  status,
  paused,
  pendingUpdates,
  head,
  count,
}: {
  status: "connecting" | "connected" | "error";
  paused: boolean;
  pendingUpdates: number;
  head?: string;
  count: number;
}) {
  const color =
    paused
      ? "var(--rs-warning)"
      : status === "connected"
      ? "var(--rs-git-added)"
      : status === "error"
      ? "var(--rs-warning)"
      : "var(--rs-text-muted)";
  return (
    <div
      className="flex items-center gap-3 px-4"
      style={{
        height: 26,
        borderTop: "1px solid var(--rs-border)",
        background: "var(--rs-bg-panel)",
        fontSize: 11,
        color: "var(--rs-text-muted)",
        fontFamily: "var(--rs-mono)",
      }}
    >
      <span style={{ color }}>● {paused ? "paused" : status}</span>
      {paused ? <span>{pendingUpdates} pending updates</span> : null}
      <span>HEAD {head ?? "unknown"}</span>
      <span>{count} commits</span>
      <div className="flex-1" />
      <span>compact</span>
      <span>·</span>
      <span>real API</span>
    </div>
  );
}
