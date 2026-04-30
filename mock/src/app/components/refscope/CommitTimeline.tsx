import { Bell, GitMerge, ShieldCheck, AlertTriangle, Pause, X } from "lucide-react";
import type { Commit } from "./data";

const LANE_COLORS = ["var(--rs-accent)", "var(--rs-git-merge)", "var(--rs-git-modified)"];

export function CommitTimeline({
  commits,
  selected,
  onSelect,
}: {
  commits: Commit[];
  selected: string;
  onSelect: (hash: string) => void;
}) {
  return (
    <main
      className="flex flex-col overflow-hidden"
      style={{ background: "var(--rs-bg-canvas)", flex: 1, minWidth: 0 }}
    >
      <RewriteAlert />
      <LiveBanner />

      <div className="overflow-y-auto" style={{ flex: 1 }}>
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
      </div>

      <StatusBar />
    </main>
  );
}

function RewriteAlert() {
  return (
    <div
      className="mx-4 mt-3 px-3 py-2.5 rounded-md flex items-start gap-2.5"
      role="alert"
      style={{
        background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 12%)",
        border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 55%)",
      }}
    >
      <AlertTriangle size={14} style={{ color: "var(--rs-warning)", marginTop: 2 }} />
      <div className="flex-1" style={{ fontSize: 12 }}>
        <div style={{ color: "var(--rs-warning)", fontWeight: 600 }}>
          main history was rewritten
        </div>
        <div
          style={{
            color: "var(--rs-text-secondary)",
            marginTop: 2,
            fontFamily: "var(--rs-mono)",
            fontSize: 11,
          }}
        >
          old: 9e8f7a6 → new: a1b2c3d &nbsp;·&nbsp; possible cause: rebase / force push
        </div>
        <div className="flex gap-1.5 mt-2">
          <button className="rs-btn rs-btn--warning">Reload timeline</button>
          <button className="rs-btn rs-btn--ghost">Compare old/new</button>
          <button className="rs-btn rs-btn--ghost">View reflog</button>
        </div>
      </div>
      <button
        aria-label="dismiss"
        className="rs-icon-btn"
        style={{ color: "var(--rs-text-muted)" }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function LiveBanner() {
  return (
    <div
      className="mx-4 mt-2 px-3 py-2 rounded-md flex items-center gap-2"
      style={{
        background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 10%)",
        border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 40%)",
      }}
    >
      <Bell size={12} style={{ color: "var(--rs-accent)" }} />
      <span style={{ fontSize: 12, color: "var(--rs-text-primary)" }}>
        2 new commits on <span style={{ fontFamily: "var(--rs-mono)" }}>main</span>
      </span>
      <div className="flex-1" />
      <button className="rs-btn rs-btn--accent">Show updates</button>
      <button
        className="rs-btn rs-btn--ghost flex items-center gap-1"
        title="Pause live mode"
      >
        <Pause size={11} /> Pause
      </button>
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
        <div className="flex items-center gap-2 min-w-0">
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
          {commit.isMerge ? (
            <Badge tone="merge">
              <GitMerge size={10} /> merge
            </Badge>
          ) : null}
          {commit.signed ? (
            <Badge tone="accent">
              <ShieldCheck size={10} /> signed
            </Badge>
          ) : null}
          {commit.refs?.map((r) => (
            <Badge key={r} tone="branch">
              {r}
            </Badge>
          ))}
          {commit.branch ? <Badge tone="branchAlt">{commit.branch}</Badge> : null}
        </div>
        <div
          className="flex items-center gap-2"
          style={{ fontSize: 11, color: "var(--rs-text-muted)" }}
        >
          <Avatar name={commit.author} />
          <span>{commit.author}</span>
          <span>·</span>
          <span>{commit.time}</span>
          {commit.added || commit.deleted ? (
            <>
              <span>·</span>
              <span style={{ color: "var(--rs-git-added)", fontFamily: "var(--rs-mono)" }}>
                +{commit.added}
              </span>
              <span style={{ color: "var(--rs-git-deleted)", fontFamily: "var(--rs-mono)" }}>
                -{commit.deleted}
              </span>
              <span>· {commit.files.length} files</span>
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
}: {
  children: React.ReactNode;
  tone: "merge" | "accent" | "branch" | "branchAlt";
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

function StatusBar() {
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
      <span style={{ color: "var(--rs-git-added)" }}>● connected</span>
      <span>HEAD a1b2c3d</span>
      <span>events 1,284</span>
      <div className="flex-1" />
      <span>compact</span>
      <span>·</span>
      <span>last fetch 2s ago</span>
    </div>
  );
}
