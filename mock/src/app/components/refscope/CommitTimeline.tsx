import { GitMerge, ShieldCheck, AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import type { Commit, CompareResult, GitRef } from "./data";

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
      <CompareBar
        refs={refs}
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
      <CommitActivityGraph commits={commits} />

      <div className="overflow-y-auto" style={{ flex: 1 }}>
        {loading ? (
          <StateMessage title="Loading commits" message="Reading allowlisted repository history." />
        ) : commits.length ? (
          <ul role="list" className="pb-6">
            {commits.map((c, i) => (
              <CommitRow
                key={c.hash}
                commit={c}
                prev={commits[i - 1]}
                next={commits[i + 1]}
                selected={c.hash === selected}
                onClick={() => onSelect(c.hash)}
              />
            ))}
          </ul>
        ) : (
          <StateMessage title={emptyState.title} message={emptyState.message} />
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
      className="mx-4 mt-3 rounded-md px-3 py-2"
      aria-label={`Commit activity overview: ${commits.length} commits, ${totalAdded} additions, ${totalDeleted} deletions, ${signedCount} signed commits, ${mergeCount} merge commits`}
      style={{
        background: "var(--rs-bg-panel)",
        border: "1px solid var(--rs-border)",
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
  return (
    <section
      className="mx-4 mt-3 rounded-md px-3 py-2"
      style={{
        background: active ? "var(--rs-bg-elevated)" : "var(--rs-bg-panel)",
        border: "1px solid var(--rs-border)",
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
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyCommand label="Copy log" command={result.commands.log} />
            <CopyCommand label="Copy stat" command={result.commands.stat} />
            <CopyCommand label="Copy diff" command={result.commands.diff} />
          </div>
        </>
      ) : active ? (
        <CompareSummary>Choose both base and target to compare.</CompareSummary>
      ) : (
        <CompareSummary>Pin a selected commit or ref to compare branch movement.</CompareSummary>
      )}
    </section>
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

function CommitRow({
  commit,
  prev,
  next,
  selected,
  onClick,
}: {
  commit: Commit;
  prev?: Commit;
  next?: Commit;
  selected: boolean;
  onClick: () => void;
}) {
  const laneColor = LANE_COLORS[commit.lane] ?? LANE_COLORS[0];
  const fileCount = commit.fileCount ?? commit.files.length;
  const hasStats = commit.added > 0 || commit.deleted > 0 || fileCount > 0;

  return (
    <li
      role="listitem"
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 11,
              color: "var(--rs-text-muted)",
            }}
          >
            {commit.hash.slice(0, 7)}
          </span>
          <span
            className="truncate"
            style={{
              fontSize: 13,
              color: "var(--rs-text-primary)",
              fontWeight: commit.isMerge ? 500 : 400,
            }}
          >
            {commit.subject}
          </span>
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
            </>
          ) : null}
        </div>
      </div>

      <div
        className="self-center opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ fontSize: 11, color: "var(--rs-text-muted)", fontFamily: "var(--rs-mono)" }}
      >
        ↵ open
      </div>
    </li>
  );
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
