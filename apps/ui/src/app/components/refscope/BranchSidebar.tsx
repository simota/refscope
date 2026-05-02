import {
  GitBranch,
  Tag,
  Cloud,
  AlertTriangle,
  ChevronRight,
  Copy,
  GitCompareArrows,
  ArrowRightToLine,
  Archive,
  FolderTree,
  Lock,
  Pin,
  PinOff,
  Box,
  GitMerge,
  Crosshair,
  RotateCcw,
  Workflow,
  Undo2,
  Cherry,
} from "lucide-react";
import type { ReactNode } from "react";
import type { GitRef, RealtimeAlert } from "./data";
import type {
  RepoOperation,
  RepoStateResponse,
  StashEntry,
  SubmoduleEntry,
  WorktreeEntry,
} from "../../api";
import { usePinnedRefs } from "../../hooks/usePinnedRefs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";

export type RefDriftSummary = {
  ahead: number;
  behind: number;
  mergeBase: string | null;
};

export function BranchSidebar({
  repoId,
  refs,
  selectedRef,
  onSelectRef,
  headHash,
  alerts,
  driftMap,
  driftBaseShortName,
  onSetRefAsCompareBase,
  onSetRefAsCompareTarget,
  stashes = [],
  worktrees = [],
  submodules = [],
  repoState = null,
}: {
  // Pinned refs are scoped per-repo so favourites from one project don't
  // leak into another. The hook is no-op when repoId is empty (initial load).
  repoId: string;
  refs: GitRef[];
  selectedRef: string;
  onSelectRef: (ref: string) => void;
  headHash?: string;
  alerts: RealtimeAlert[];
  // Observation fact: each ref's literal `git rev-list --count` output. The
  // halo's bar length is the only derivation, normalised against the visible
  // max so a 1000-commit ref doesn't squash a 5-commit one to a single pixel.
  driftMap?: Map<string, RefDriftSummary>;
  // Used in halo aria-label and tooltip. Falls back to "base" when omitted so
  // the screen-reader text always says "of <something>" — the rendered halo
  // still shows raw numbers, the base label is just for context.
  driftBaseShortName?: string;
  onSetRefAsCompareBase?: (refName: string) => void;
  onSetRefAsCompareTarget?: (refName: string) => void;
  // `stash list` entries (`refs/stash` + reflog). Right-click hashes can drive
  // the same compare endpoints as branches, since each stash is a real commit.
  stashes?: StashEntry[];
  // `git worktree list` entries — the *git-worktree* feature (multiple
  // checkouts), distinct from the per-commit "working tree" view in the
  // timeline. The primary entry corresponds to the repo refscope is serving.
  worktrees?: WorktreeEntry[];
  // `git submodule status --recursive` entries.
  submodules?: SubmoduleEntry[];
  // Active in-progress operations (merge / rebase / cherry-pick / revert /
  // bisect / sequencer). `null` while the initial fetch is pending.
  repoState?: RepoStateResponse | null;
}) {
  const { isPinned, toggle: togglePin } = usePinnedRefs(repoId);
  // Resolve pinned ref names back to live refs in the current snapshot —
  // pins to deleted branches degrade to "not shown" rather than rendering
  // dangling rows.
  const pinnedRefs = refs.filter((ref) => isPinned(ref.name));
  const branches = refs.filter((ref) => ref.type === "branch");
  const tags = refs.filter((ref) => ref.type === "tag");
  const remotes = refs.filter((ref) => ref.type === "remote");
  // Halo bars are normalised against the largest observed ahead+behind across
  // currently-visible drift entries. We compute it once at the sidebar level
  // so every halo in branches + remotes shares a single scale; otherwise a
  // 50-ahead branch and a 5-ahead branch would look identical at full width.
  const driftScale = computeDriftScale(driftMap);
  const baseLabel = driftBaseShortName ?? "base";

  return (
    <aside
      className="flex flex-col overflow-y-auto h-full w-full"
      style={{
        background: "var(--rs-bg-panel)",
        borderRight: "1px solid var(--rs-border)",
      }}
    >
      {repoState && repoState.operations.length > 0 ? (
        <RepoStateBanner operations={repoState.operations} />
      ) : null}

      {pinnedRefs.length > 0 ? (
        <Section
          icon={<Pin size={11} />}
          title="PINNED"
          hint={String(pinnedRefs.length)}
        >
          {pinnedRefs.map((ref) => (
            <BranchRow
              key={`pinned:${ref.name}`}
              active={selectedRef === ref.shortName || selectedRef === ref.name}
              dot={
                ref.type === "tag"
                  ? "var(--rs-git-merge)"
                  : ref.type === "remote"
                    ? "var(--rs-text-muted)"
                    : "var(--rs-accent)"
              }
              name={ref.shortName}
              fullName={ref.name}
              hint={ref.type === "branch" ? ref.hash.slice(0, 7) : undefined}
              muted={ref.type === "remote"}
              drift={driftMap?.get(ref.name) ?? null}
              driftScale={driftScale}
              baseLabel={baseLabel}
              onClick={() => onSelectRef(ref.name)}
              onSetCompareBase={onSetRefAsCompareBase}
              onSetCompareTarget={onSetRefAsCompareTarget}
              isPinned
              onTogglePin={() => togglePin(ref.name)}
            />
          ))}
        </Section>
      ) : null}

      <Section icon={<GitBranch size={11} />} title="REF MAP">
        <RefMap refs={refs} selectedRef={selectedRef} />
      </Section>

      <Section icon={<GitBranch size={11} />} title="BRANCHES">
        {branches.length ? (
          branches.map((ref) => (
            <BranchRow
              key={ref.name}
              active={selectedRef === ref.shortName || selectedRef === ref.name}
              dot="var(--rs-accent)"
              name={ref.shortName}
              fullName={ref.name}
              hint={ref.hash.slice(0, 7)}
              drift={driftMap?.get(ref.name) ?? null}
              driftScale={driftScale}
              baseLabel={baseLabel}
              onClick={() => onSelectRef(ref.name)}
              onSetCompareBase={onSetRefAsCompareBase}
              onSetCompareTarget={onSetRefAsCompareTarget}
              isPinned={isPinned(ref.name)}
              onTogglePin={() => togglePin(ref.name)}
            />
          ))
        ) : (
          <EmptyRow>No branches</EmptyRow>
        )}
      </Section>

      <Section icon={<Tag size={11} />} title="TAGS">
        {tags.length ? (
          tags.map((ref) => (
            <TagRow
              key={ref.name}
              active={selectedRef === ref.shortName || selectedRef === ref.name}
              name={ref.shortName}
              fullName={ref.name}
              onClick={() => onSelectRef(ref.name)}
              onSetCompareBase={onSetRefAsCompareBase}
              onSetCompareTarget={onSetRefAsCompareTarget}
              isPinned={isPinned(ref.name)}
              onTogglePin={() => togglePin(ref.name)}
            />
          ))
        ) : (
          <EmptyRow>No tags</EmptyRow>
        )}
      </Section>

      <Section icon={<Cloud size={11} />} title="REMOTES">
        {remotes.length ? (
          remotes.map((ref) => (
            <BranchRow
              key={ref.name}
              name={ref.shortName}
              fullName={ref.name}
              muted
              active={selectedRef === ref.shortName || selectedRef === ref.name}
              drift={driftMap?.get(ref.name) ?? null}
              driftScale={driftScale}
              baseLabel={baseLabel}
              onClick={() => onSelectRef(ref.name)}
              onSetCompareBase={onSetRefAsCompareBase}
              onSetCompareTarget={onSetRefAsCompareTarget}
              isPinned={isPinned(ref.name)}
              onTogglePin={() => togglePin(ref.name)}
            />
          ))
        ) : (
          <EmptyRow>No remotes</EmptyRow>
        )}
      </Section>

      <Section
        icon={<Archive size={11} />}
        title="STASHES"
        hint={stashes.length ? String(stashes.length) : undefined}
      >
        {stashes.length ? (
          stashes.map((stash) => (
            <StashRow
              key={stash.name}
              stash={stash}
              onSetCompareBase={
                onSetRefAsCompareBase
                  ? () => onSetRefAsCompareBase(stash.name)
                  : undefined
              }
              onSetCompareTarget={
                onSetRefAsCompareTarget
                  ? () => onSetRefAsCompareTarget(stash.name)
                  : undefined
              }
            />
          ))
        ) : (
          <EmptyRow>No stashes</EmptyRow>
        )}
      </Section>

      <Section
        icon={<FolderTree size={11} />}
        title="WORKTREES"
        hint={worktrees.length ? String(worktrees.length) : undefined}
      >
        {worktrees.length ? (
          worktrees.map((worktree) => (
            <WorktreeRow
              key={worktree.path}
              worktree={worktree}
              onSelectBranch={
                worktree.branch
                  ? () => onSelectRef(worktree.branch as string)
                  : undefined
              }
              onSetCompareBase={
                onSetRefAsCompareBase && worktree.branch
                  ? () => onSetRefAsCompareBase(worktree.branch as string)
                  : undefined
              }
              onSetCompareTarget={
                onSetRefAsCompareTarget && worktree.branch
                  ? () => onSetRefAsCompareTarget(worktree.branch as string)
                  : undefined
              }
            />
          ))
        ) : (
          <EmptyRow>No worktrees</EmptyRow>
        )}
      </Section>

      <Section
        icon={<Box size={11} />}
        title="SUBMODULES"
        hint={submodules.length ? String(submodules.length) : undefined}
      >
        {submodules.length ? (
          submodules.map((submodule) => (
            <SubmoduleRow key={submodule.path} submodule={submodule} />
          ))
        ) : (
          <EmptyRow>No submodules</EmptyRow>
        )}
      </Section>

      <Section icon={<AlertTriangle size={11} />} title="ALERTS" tone="warning">
        {alerts.length ? (
          alerts.map((alert) => <AlertRow key={alert.id} alert={alert} />)
        ) : (
          <EmptyRow>No alerts</EmptyRow>
        )}
      </Section>

      <div className="flex-1" />

      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{
          borderTop: "1px solid var(--rs-border)",
          fontSize: 11,
          color: "var(--rs-text-muted)",
          fontFamily: "var(--rs-mono)",
        }}
      >
        <span>HEAD {headHash ?? "unknown"}</span>
        <span className="flex items-center gap-1">clean</span>
      </div>
    </aside>
  );
}

function RefMap({ refs, selectedRef }: { refs: GitRef[]; selectedRef: string }) {
  const branches = refs.filter((ref) => ref.type === "branch");
  const remotes = refs.filter((ref) => ref.type === "remote");
  const tags = refs.filter((ref) => ref.type === "tag");
  const selected = refs.find((ref) => selectedRef === ref.name || selectedRef === ref.shortName);
  const visibleRefs = refs.slice(0, 10);
  const selectedLabel = selected?.shortName ?? (selectedRef || "none");

  return (
    <div
      className="mx-1 rounded-md px-2 py-2"
      aria-label={`Ref map with ${branches.length} branches, ${remotes.length} remotes, and ${tags.length} tags`}
      style={{
        background: "var(--rs-bg-canvas)",
        border: "1px solid var(--rs-border)",
      }}
    >
      <svg
        width="100%"
        height="64"
        viewBox="0 0 216 64"
        role="img"
        aria-label={selected ? `Selected ref ${selected.shortName}` : "Repository ref map"}
      >
        <line
          x1="16"
          y1="32"
          x2="200"
          y2="32"
          stroke="var(--rs-border)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {visibleRefs.map((ref, index) => {
          const x = 20 + index * 19;
          const y = ref.type === "tag" ? 16 : ref.type === "remote" ? 48 : 32;
          const color = refColor(ref.type);
          const active = selectedRef === ref.name || selectedRef === ref.shortName;
          return (
            <g key={ref.name}>
              <line
                x1={x}
                y1="32"
                x2={x}
                y2={y}
                stroke={color}
                strokeWidth="1.5"
                strokeOpacity="0.65"
              />
              <circle
                cx={x}
                cy={y}
                r={active ? 5 : 3.5}
                fill={color}
                stroke={active ? "var(--rs-text-primary)" : "var(--rs-bg-canvas)"}
                strokeWidth={active ? 1.5 : 1}
              >
                <title>{`${ref.shortName} ${ref.hash.slice(0, 7)}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="grid gap-1.5">
        <RefMapBar label="Branches" symbol="█" count={branches.length} total={refs.length} color="var(--rs-accent)" />
        <RefMapBar label="Remotes" symbol="▒" count={remotes.length} total={refs.length} color="var(--rs-git-added)" />
        <RefMapBar label="Tags" symbol="◆" count={tags.length} total={refs.length} color="var(--rs-git-merge)" />
      </div>
      <div
        className="mt-2 truncate"
        style={{ color: "var(--rs-text-muted)", fontSize: 10, fontFamily: "var(--rs-mono)" }}
        title={selected?.name}
      >
        Selected {selectedLabel}
      </div>
    </div>
  );
}

function RefMapBar({
  label,
  symbol,
  count,
  total,
  color,
}: {
  label: string;
  symbol: string;
  count: number;
  total: number;
  color: string;
}) {
  const width = total ? Math.max(6, Math.round((count / total) * 100)) : 0;
  return (
    <div className="grid items-center gap-2" style={{ gridTemplateColumns: "56px 1fr 22px" }}>
      <span style={{ color: "var(--rs-text-muted)", fontSize: 10 }}>
        <span aria-hidden style={{ color, marginRight: 3 }}>{symbol}</span>{label}
      </span>
      <span
        className="rounded-sm"
        style={{
          height: 5,
          background: "var(--rs-bg-elevated)",
          overflow: "hidden",
        }}
      >
        <span
          className="block h-full rounded-sm"
          style={{ width: `${width}%`, background: color }}
        />
      </span>
      <span style={{ color: "var(--rs-text-secondary)", fontSize: 10, fontFamily: "var(--rs-mono)" }}>
        {count}
      </span>
    </div>
  );
}

function refColor(type: GitRef["type"]) {
  if (type === "tag") return "var(--rs-git-merge)";
  if (type === "remote") return "var(--rs-git-added)";
  if (type === "branch") return "var(--rs-accent)";
  return "var(--rs-text-muted)";
}

function AlertRow({ alert }: { alert: RealtimeAlert }) {
  const observedTime = formatObservedTime(alert.observedAt);
  const incidentNote = formatIncidentNote(alert, observedTime);
  return (
    <div
      className="px-2 py-2 mx-1 rounded-md"
      aria-label={`History rewritten on ${alert.refName}`}
      style={{
        background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 14%)",
        border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 40%)",
      }}
    >
      <div
        className="flex items-center gap-1.5"
        style={{ fontSize: 11, color: "var(--rs-warning)", fontWeight: 600 }}
      >
        <AlertTriangle size={11} aria-hidden /> History rewritten
      </div>
      <RewriteFlow previousHash={alert.previousHash} currentHash={alert.currentHash} />
      <dl
        className="mt-2 grid gap-1"
        style={{ fontSize: 10, color: "var(--rs-text-secondary)", lineHeight: 1.4 }}
      >
        <AlertFact label="Ref" value={`${alert.refName} (${alert.fullRefName})`} />
        <AlertFact label="Previous" value={alert.previousHash} mono />
        <AlertFact label="Current" value={alert.currentHash} mono />
        <AlertFact label="Observed" value={observedTime} />
        <AlertFact label="Source" value={formatDetectionSource(alert.detectionSource)} />
      </dl>
      <div
        style={{
          fontSize: 11,
          color: "var(--rs-text-secondary)",
          marginTop: 4,
          lineHeight: 1.45,
        }}
      >
        {alert.explanation}
      </div>
      <button
        className="rs-compact-button mt-2"
        type="button"
        onClick={() => void navigator.clipboard?.writeText(incidentNote)}
      >
        Copy note
      </button>
    </div>
  );
}

function RewriteFlow({
  previousHash,
  currentHash,
}: {
  previousHash: string;
  currentHash: string;
}) {
  return (
    <div
      className="mt-2 rounded-md px-2 py-2"
      aria-label={`Rewrite flow from ${previousHash} to ${currentHash}`}
      style={{
        background: "var(--rs-bg-canvas)",
        border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 35%)",
      }}
    >
      <svg width="100%" height="38" viewBox="0 0 192 38" role="img" aria-label="Rewrite before and after hashes">
        <line
          x1="22"
          y1="19"
          x2="170"
          y2="19"
          stroke="var(--rs-warning)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          strokeLinecap="round"
        />
        <circle cx="22" cy="19" r="7" fill="var(--rs-git-deleted)" />
        <path
          d="M164 13 L172 19 L164 25"
          fill="none"
          stroke="var(--rs-warning)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="170" cy="19" r="7" fill="var(--rs-git-added)" />
      </svg>
      <div
        className="grid items-center gap-2"
        style={{ gridTemplateColumns: "1fr auto 1fr", fontFamily: "var(--rs-mono)", fontSize: 10 }}
      >
        <span className="truncate" title={previousHash} style={{ color: "var(--rs-git-deleted)" }}>
          {shortHash(previousHash)}
        </span>
        <span style={{ color: "var(--rs-text-muted)" }}>to</span>
        <span className="truncate text-right" title={currentHash} style={{ color: "var(--rs-git-added)" }}>
          {shortHash(currentHash)}
        </span>
      </div>
    </div>
  );
}

function AlertFact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt style={{ color: "var(--rs-text-muted)" }}>{label}</dt>
      <dd
        className="truncate"
        title={value}
        style={{
          color: "var(--rs-text-primary)",
          fontFamily: mono ? "var(--rs-mono)" : undefined,
        }}
      >
        {mono ? shortHash(value) : value}
      </dd>
    </div>
  );
}

function formatObservedTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDetectionSource(source: RealtimeAlert["detectionSource"]) {
  if (source === "polling") return "polling snapshot comparison";
  if (source === "reconnect_recovery") return "reconnect recovery";
  return "direct ref change";
}

function formatIncidentNote(alert: RealtimeAlert, observedTime: string) {
  return [
    "History rewrite detected",
    "",
    `Repo: ${alert.repoName}`,
    `Ref: ${alert.refName} (${alert.fullRefName})`,
    `Previous: ${alert.previousHash}`,
    `Current: ${alert.currentHash}`,
    `Observed: ${observedTime}`,
    `Source: ${formatDetectionSource(alert.detectionSource)}`,
    "",
    `Reason: ${alert.explanation}`,
  ].join("\n");
}

function shortHash(value: string) {
  return value.length > 12 ? `${value.slice(0, 7)}...${value.slice(-7)}` : value;
}

function Section({
  icon,
  title,
  children,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  tone?: "warning";
  // Right-aligned count or status pill — used for STASHES / WORKTREES so the
  // header conveys "is there anything in here?" at a glance.
  hint?: string;
}) {
  return (
    <div className="pt-3 pb-1">
      <div
        className="px-3 pb-1.5 flex items-center gap-1.5"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: tone === "warning" ? "var(--rs-warning)" : "var(--rs-text-muted)",
        }}
      >
        {icon}
        <span className="flex-1">{title}</span>
        {hint ? (
          <span
            className="px-1.5 rounded"
            style={{
              fontSize: 10,
              fontFamily: "var(--rs-mono)",
              color: "var(--rs-text-muted)",
              border: "1px solid var(--rs-border)",
            }}
          >
            {hint}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function BranchRow({
  name,
  fullName,
  hint,
  active,
  dot,
  muted,
  drift,
  driftScale,
  baseLabel,
  onClick,
  onSetCompareBase,
  onSetCompareTarget,
  isPinned,
  onTogglePin,
}: {
  name: string;
  fullName?: string;
  hint?: string;
  active?: boolean;
  dot?: string;
  muted?: boolean;
  drift?: RefDriftSummary | null;
  driftScale?: number;
  baseLabel?: string;
  onClick?: () => void;
  onSetCompareBase?: (refName: string) => void;
  onSetCompareTarget?: (refName: string) => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  const button = (
    <button
      className="flex items-center gap-2 mx-1 px-2 rounded-md text-left"
      style={{
        height: 26,
        background: active
          ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 16%)"
          : "transparent",
        boxShadow: active ? "inset 2px 0 0 var(--rs-accent)" : undefined,
        color: muted ? "var(--rs-text-muted)" : "var(--rs-text-primary)",
        fontSize: 12,
        fontFamily: "var(--rs-mono)",
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLElement).style.background =
            "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 6%)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
      onClick={onClick}
    >
      <span
        className="inline-block rounded-full"
        style={{
          width: 6,
          height: 6,
          background: dot ?? "var(--rs-text-muted)",
        }}
      />
      <span className="flex-1 truncate">{name}</span>
      {isPinned ? (
        <Pin size={9} aria-label="Pinned" style={{ color: "var(--rs-accent)" }} />
      ) : null}
      {drift ? (
        <DriftHalo
          ahead={drift.ahead}
          behind={drift.behind}
          scale={driftScale ?? 1}
          baseLabel={baseLabel ?? "base"}
        />
      ) : null}
      {hint ? (
        <span
          className="px-1.5 rounded"
          style={{
            fontSize: 10,
            color: "var(--rs-git-added)",
            background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-git-added) 14%)",
          }}
        >
          {hint}
        </span>
      ) : null}
    </button>
  );

  return (
    <RefRowMenu
      shortName={name}
      fullName={fullName}
      onSwitch={onClick}
      onSetCompareBase={onSetCompareBase}
      onSetCompareTarget={onSetCompareTarget}
      isPinned={isPinned}
      onTogglePin={onTogglePin}
    >
      {button}
    </RefRowMenu>
  );
}

/**
 * Shared right-click menu for ref rows (branches / tags / remotes). Lives next
 * to the row components rather than as a one-shot inline block so the same
 * action set stays identical across all three sections — divergence here would
 * be a confusing UX cost (different menus for visually-similar rows).
 */
function RefRowMenu({
  shortName,
  fullName,
  onSwitch,
  onSetCompareBase,
  onSetCompareTarget,
  isPinned,
  onTogglePin,
  children,
}: {
  shortName: string;
  fullName?: string;
  onSwitch?: () => void;
  onSetCompareBase?: (refName: string) => void;
  onSetCompareTarget?: (refName: string) => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
  children: ReactNode;
}) {
  // Without the canonical full name we can't safely drive copy / compare on
  // the underlying ref, so the menu degrades to "no menu" rather than
  // surfacing a half-broken one. Callers should always pass `fullName`; this
  // is just a defensive escape hatch.
  if (!fullName) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => void navigator.clipboard?.writeText(shortName)}
        >
          <Copy />
          Copy ref name
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void navigator.clipboard?.writeText(fullName)}
        >
          <Copy />
          Copy full ref name
          <span
            className="ml-auto"
            style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-muted)" }}
          >
            {fullName}
          </span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!onSwitch} onSelect={() => onSwitch?.()}>
          <ArrowRightToLine />
          Switch to this ref
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!onTogglePin}
          onSelect={() => onTogglePin?.()}
        >
          {isPinned ? <PinOff /> : <Pin />}
          {isPinned ? "Unpin" : "Pin to top"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!onSetCompareBase}
          onSelect={() => onSetCompareBase?.(fullName)}
        >
          <GitCompareArrows />
          Set as compare base
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!onSetCompareTarget}
          onSelect={() => onSetCompareTarget?.(fullName)}
        >
          <GitCompareArrows />
          Set as compare target
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * DriftHalo renders the literal `ahead` / `behind` counts as two stacked SVG
 * bars. The numbers themselves come straight from `git rev-list --count` —
 * the only derivation here is the bar's pixel length, normalised against the
 * largest observed ahead+behind in the visible set so a 50-ahead branch and
 * a 5-ahead branch don't look identical.
 *
 * Accessibility: the raw numbers always reach the screen reader via
 * `aria-label`. The visual bars are decorative (`role="img"` + the same
 * label, no extra `aria-hidden` indirection). The full text also lives in
 * `title` so a hover tooltip surfaces the same fact as the screen reader.
 */
function DriftHalo({
  ahead,
  behind,
  scale,
  baseLabel,
}: {
  ahead: number;
  behind: number;
  scale: number;
  baseLabel: string;
}) {
  // Both bars are drawn on the same 18-pixel-wide track. We compute the bar
  // width as a fraction of the visible-set scale, then clamp to [0, MAX_BAR]
  // so a count of 0 collapses to invisible (not a single pixel sliver) and
  // a count exactly equal to scale fills the track end-to-end.
  const TRACK_WIDTH = 18;
  const MAX_BAR = TRACK_WIDTH;
  const aheadWidth = scale > 0 ? Math.round((ahead / scale) * MAX_BAR) : 0;
  const behindWidth = scale > 0 ? Math.round((behind / scale) * MAX_BAR) : 0;
  const label = `${ahead} ahead, ${behind} behind of ${baseLabel}`;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ display: "inline-flex", alignItems: "center", lineHeight: 0 }}
    >
      <svg width={TRACK_WIDTH} height={12} viewBox={`0 0 ${TRACK_WIDTH} 12`} aria-hidden>
        {/* ahead bar (top): accent — observation is "commits on this ref not on base" */}
        <rect
          x={0}
          y={1}
          width={TRACK_WIDTH}
          height={4}
          rx={1}
          fill="var(--rs-bg-elevated)"
        />
        {aheadWidth > 0 ? (
          <rect x={0} y={1} width={aheadWidth} height={4} rx={1} fill="var(--rs-accent)" />
        ) : null}
        {/* behind bar (bottom): muted — observation is "commits on base not on this ref" */}
        <rect
          x={0}
          y={7}
          width={TRACK_WIDTH}
          height={4}
          rx={1}
          fill="var(--rs-bg-elevated)"
        />
        {behindWidth > 0 ? (
          <rect
            x={0}
            y={7}
            width={behindWidth}
            height={4}
            rx={1}
            fill="var(--rs-text-muted)"
          />
        ) : null}
      </svg>
    </span>
  );
}

/**
 * Compute the normalisation scale for the halo. We use the largest single
 * `ahead + behind` sum across visible drift entries (not the global max of
 * each axis independently) so the halo's full width corresponds to "the most
 * total drift in this view". A floor of 1 keeps division well-defined when
 * every visible ref is exactly at base.
 */
function computeDriftScale(driftMap?: Map<string, RefDriftSummary>) {
  if (!driftMap || driftMap.size === 0) return 1;
  let max = 1;
  for (const drift of driftMap.values()) {
    const total = drift.ahead + drift.behind;
    if (total > max) max = total;
  }
  return max;
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-1 px-2"
      style={{ height: 24, fontSize: 12, color: "var(--rs-text-muted)" }}
    >
      {children}
    </div>
  );
}

/**
 * Stash entry row. Each stash is a real commit object so the right-click
 * menu can drive the same compare endpoints as branches/refs (callers wire
 * `onSetCompareBase/Target` against `stash.name`, e.g. `stash@{0}`).
 */
function StashRow({
  stash,
  onSetCompareBase,
  onSetCompareTarget,
}: {
  stash: StashEntry;
  onSetCompareBase?: () => void;
  onSetCompareTarget?: () => void;
}) {
  const button = (
    <div
      className="mx-1 px-2 flex flex-col"
      style={{
        padding: "4px 10px",
        borderRadius: 6,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--rs-mono)",
            color: "var(--rs-text-muted)",
          }}
        >
          {stash.name}
        </span>
        <span
          className="flex-1 truncate"
          title={stash.subject}
          style={{
            fontSize: 12,
            color: "var(--rs-text-primary)",
          }}
        >
          {stash.subject || "(no message)"}
        </span>
      </div>
      <div
        className="flex items-center gap-2"
        style={{ fontSize: 10, color: "var(--rs-text-muted)" }}
      >
        <span style={{ fontFamily: "var(--rs-mono)" }}>{stash.shortHash}</span>
        {stash.committedAt ? (
          <span title={stash.committedAt}>{formatRelativeTime(stash.committedAt)}</span>
        ) : null}
      </div>
    </div>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => void navigator.clipboard?.writeText(stash.hash)}
        >
          <Copy />
          Copy commit hash
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void navigator.clipboard?.writeText(stash.name)}
        >
          <Copy />
          Copy stash ref
          <span
            className="ml-auto"
            style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-muted)" }}
          >
            {stash.name}
          </span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!onSetCompareBase}
          onSelect={() => onSetCompareBase?.()}
        >
          <GitCompareArrows />
          Set as compare base
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!onSetCompareTarget}
          onSelect={() => onSetCompareTarget?.()}
        >
          <GitCompareArrows />
          Set as compare target
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Linked worktree row (`git worktree list`). The primary entry — the repo
 * refscope is reading from — is marked so users can distinguish it from
 * sibling checkouts. Compare/select actions operate on the worktree's branch
 * (when checked-out non-detached); for detached/bare entries those actions
 * are disabled because there's no safe ref to use.
 */
function WorktreeRow({
  worktree,
  onSelectBranch,
  onSetCompareBase,
  onSetCompareTarget,
}: {
  worktree: WorktreeEntry;
  onSelectBranch?: () => void;
  onSetCompareBase?: () => void;
  onSetCompareTarget?: () => void;
}) {
  const branchLabel =
    worktree.branchShortName ??
    (worktree.detached ? "detached" : worktree.bare ? "bare" : "(unknown)");
  const lastSegment = worktree.path.split("/").filter(Boolean).pop() ?? worktree.path;
  const button = (
    <div
      className="mx-1 px-2 flex flex-col"
      style={{
        padding: "4px 10px",
        borderRadius: 6,
        opacity: worktree.prunable ? 0.6 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex-1 truncate"
          title={worktree.path}
          style={{
            fontSize: 12,
            fontFamily: "var(--rs-mono)",
            color: "var(--rs-text-primary)",
          }}
        >
          {lastSegment}
        </span>
        {worktree.isPrimary ? (
          <span
            className="px-1.5 rounded"
            style={{
              fontSize: 9,
              color: "var(--rs-accent)",
              border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 40%)",
              fontFamily: "var(--rs-mono)",
            }}
          >
            primary
          </span>
        ) : null}
        {worktree.locked ? (
          <Lock
            size={10}
            aria-label="Locked"
            style={{ color: "var(--rs-warning)" }}
          />
        ) : null}
      </div>
      <div
        className="flex items-center gap-2"
        style={{ fontSize: 10, color: "var(--rs-text-muted)" }}
      >
        <GitBranch size={9} />
        <span>{branchLabel}</span>
        {worktree.head ? (
          <span style={{ fontFamily: "var(--rs-mono)" }}>
            {worktree.head.slice(0, 7)}
          </span>
        ) : null}
      </div>
    </div>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => void navigator.clipboard?.writeText(worktree.path)}
        >
          <Copy />
          Copy worktree path
        </ContextMenuItem>
        {worktree.branch ? (
          <ContextMenuItem
            onSelect={() =>
              void navigator.clipboard?.writeText(worktree.branch as string)
            }
          >
            <Copy />
            Copy branch ref
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!onSelectBranch}
          onSelect={() => onSelectBranch?.()}
        >
          <ArrowRightToLine />
          Switch to this branch
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!onSetCompareBase}
          onSelect={() => onSetCompareBase?.()}
        >
          <GitCompareArrows />
          Set branch as compare base
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!onSetCompareTarget}
          onSelect={() => onSetCompareTarget?.()}
        >
          <GitCompareArrows />
          Set branch as compare target
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Best-effort relative-time renderer for sidebar timestamps. Pure formatting
 * — refscope never *recomputes* dates, only re-presents them. Returns the
 * raw input on parse failure so the caller still sees something useful.
 */
/**
 * Submodule row. Displays the submodule path with the leaf component
 * emphasised, the SHA-1 the parent repo is pointing at, and any local
 * status flags (modified / uninitialized / conflicted). Right-click offers
 * copy of path and hash — switching into a submodule is out of scope for a
 * read-only viewer, so we don't pretend to support that.
 */
function SubmoduleRow({ submodule }: { submodule: SubmoduleEntry }) {
  const segments = submodule.path.split("/").filter(Boolean);
  const leaf = segments[segments.length - 1] ?? submodule.path;
  const prefix = segments.slice(0, -1).join("/");
  const flag = submodule.conflicted
    ? "conflict"
    : submodule.uninitialized
      ? "uninit"
      : submodule.modified
        ? "modified"
        : null;
  const flagColor =
    submodule.conflicted || submodule.modified
      ? "var(--rs-warning)"
      : "var(--rs-text-muted)";
  const button = (
    <div
      className="mx-1 px-2 flex flex-col"
      style={{
        padding: "4px 10px",
        borderRadius: 6,
        opacity: submodule.uninitialized ? 0.65 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex-1 truncate"
          title={submodule.path}
          style={{
            fontSize: 12,
            fontFamily: "var(--rs-mono)",
            color: "var(--rs-text-primary)",
          }}
        >
          {prefix ? (
            <span style={{ color: "var(--rs-text-muted)" }}>{prefix}/</span>
          ) : null}
          {leaf}
        </span>
        {flag ? (
          <span
            className="px-1.5 rounded"
            style={{
              fontSize: 9,
              color: flagColor,
              border: `1px solid color-mix(in oklab, var(--rs-border), ${flagColor} 40%)`,
              fontFamily: "var(--rs-mono)",
            }}
          >
            {flag}
          </span>
        ) : null}
      </div>
      <div
        className="flex items-center gap-2"
        style={{ fontSize: 10, color: "var(--rs-text-muted)" }}
      >
        <span style={{ fontFamily: "var(--rs-mono)" }}>
          {submodule.shortHash}
        </span>
        {submodule.describe ? (
          <span title={submodule.describe} className="truncate">
            {submodule.describe}
          </span>
        ) : null}
      </div>
    </div>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => void navigator.clipboard?.writeText(submodule.path)}
        >
          <Copy />
          Copy submodule path
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!submodule.initialized}
          onSelect={() => void navigator.clipboard?.writeText(submodule.hash)}
        >
          <Copy />
          Copy commit hash
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Banner that shows active in-progress operations (merge / rebase /
 * cherry-pick / revert / bisect / sequencer). Render order matches
 * `repoState.operations`; callers conditionally mount this only when at
 * least one operation is active so the clean case adds zero UI.
 */
function RepoStateBanner({ operations }: { operations: RepoOperation[] }) {
  return (
    <div
      role="status"
      aria-label="Repository state"
      style={{
        margin: "8px 8px 4px",
        padding: "8px 10px",
        borderRadius: 6,
        background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 14%)",
        border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 50%)",
      }}
    >
      <div
        className="flex items-center gap-1.5"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: "var(--rs-warning)",
          marginBottom: 4,
        }}
      >
        <AlertTriangle size={11} />
        IN PROGRESS
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {operations.map((op, index) => (
          <li
            key={`${op.kind}:${index}`}
            className="flex items-center gap-2"
            style={{
              fontSize: 12,
              color: "var(--rs-text-primary)",
              padding: "2px 0",
            }}
          >
            <RepoOperationIcon op={op} />
            <RepoOperationLabel op={op} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RepoOperationIcon({ op }: { op: RepoOperation }) {
  const color = "var(--rs-warning)";
  if (op.kind === "merge") return <GitMerge size={11} style={{ color }} />;
  if (op.kind === "rebase") return <RotateCcw size={11} style={{ color }} />;
  if (op.kind === "cherry-pick") return <Cherry size={11} style={{ color }} />;
  if (op.kind === "revert") return <Undo2 size={11} style={{ color }} />;
  if (op.kind === "bisect") return <Crosshair size={11} style={{ color }} />;
  return <Workflow size={11} style={{ color }} />;
}

function RepoOperationLabel({ op }: { op: RepoOperation }) {
  if (op.kind === "merge") {
    return (
      <span className="truncate">
        Merge in progress
        {op.targetHash ? (
          <span
            style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-muted)", marginLeft: 6 }}
          >
            ({op.targetHash.slice(0, 7)})
          </span>
        ) : null}
      </span>
    );
  }
  if (op.kind === "rebase") {
    return (
      <span className="truncate">
        Rebase ({op.backend}) in progress
        {op.headName ? (
          <span style={{ color: "var(--rs-text-muted)", marginLeft: 6 }}>
            {op.headName.replace(/^refs\/heads\//, "")} → {op.onto?.slice(0, 7) ?? "?"}
          </span>
        ) : null}
      </span>
    );
  }
  if (op.kind === "cherry-pick") {
    return (
      <span className="truncate">
        Cherry-pick in progress
        {op.targetHash ? (
          <span
            style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-muted)", marginLeft: 6 }}
          >
            ({op.targetHash.slice(0, 7)})
          </span>
        ) : null}
      </span>
    );
  }
  if (op.kind === "revert") {
    return (
      <span className="truncate">
        Revert in progress
        {op.targetHash ? (
          <span
            style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-muted)", marginLeft: 6 }}
          >
            ({op.targetHash.slice(0, 7)})
          </span>
        ) : null}
      </span>
    );
  }
  if (op.kind === "bisect") {
    return (
      <span className="truncate">
        Bisect in progress
        {op.start ? (
          <span style={{ color: "var(--rs-text-muted)", marginLeft: 6 }}>
            from {op.start}
          </span>
        ) : null}
      </span>
    );
  }
  return <span>Sequencer queued</span>;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const deltaSec = (Date.now() - then) / 1000;
  if (deltaSec < 60) return "just now";
  const deltaMin = deltaSec / 60;
  if (deltaMin < 60) return `${Math.floor(deltaMin)}m ago`;
  const deltaHr = deltaMin / 60;
  if (deltaHr < 24) return `${Math.floor(deltaHr)}h ago`;
  const deltaDay = deltaHr / 24;
  if (deltaDay < 30) return `${Math.floor(deltaDay)}d ago`;
  const deltaMonth = deltaDay / 30;
  if (deltaMonth < 12) return `${Math.floor(deltaMonth)}mo ago`;
  return `${Math.floor(deltaMonth / 12)}y ago`;
}

function TagRow({
  name,
  fullName,
  active,
  onClick,
  onSetCompareBase,
  onSetCompareTarget,
  isPinned,
  onTogglePin,
}: {
  name: string;
  fullName?: string;
  active?: boolean;
  onClick?: () => void;
  onSetCompareBase?: (refName: string) => void;
  onSetCompareTarget?: (refName: string) => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  const button = (
    <button
      className="mx-1 px-2 flex items-center gap-2"
      style={{
        height: 24,
        fontSize: 12,
        fontFamily: "var(--rs-mono)",
        color: active ? "var(--rs-text-primary)" : "var(--rs-text-secondary)",
        background: active
          ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-git-merge) 16%)"
          : "transparent",
        boxShadow: active ? "inset 2px 0 0 var(--rs-git-merge)" : undefined,
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLElement).style.background =
            "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-git-merge) 8%)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
      onClick={onClick}
    >
      <ChevronRight size={11} style={{ color: "var(--rs-git-merge)" }} />
      <span className="flex-1 truncate text-left">{name}</span>
      {isPinned ? (
        <Pin size={9} aria-label="Pinned" style={{ color: "var(--rs-accent)" }} />
      ) : null}
    </button>
  );

  return (
    <RefRowMenu
      shortName={name}
      fullName={fullName}
      onSwitch={onClick}
      onSetCompareBase={onSetCompareBase}
      onSetCompareTarget={onSetCompareTarget}
      isPinned={isPinned}
      onTogglePin={onTogglePin}
    >
      {button}
    </RefRowMenu>
  );
}
