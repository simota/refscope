import { GitBranch, Tag, Cloud, AlertTriangle, ChevronRight } from "lucide-react";
import type { GitRef, RealtimeAlert } from "./data";

export function BranchSidebar({
  refs,
  selectedRef,
  onSelectRef,
  headHash,
  alerts,
}: {
  refs: GitRef[];
  selectedRef: string;
  onSelectRef: (ref: string) => void;
  headHash?: string;
  alerts: RealtimeAlert[];
}) {
  const branches = refs.filter((ref) => ref.type === "branch");
  const tags = refs.filter((ref) => ref.type === "tag");
  const remotes = refs.filter((ref) => ref.type === "remote");

  return (
    <aside
      className="flex flex-col overflow-y-auto"
      style={{
        width: 248,
        background: "var(--rs-bg-panel)",
        borderRight: "1px solid var(--rs-border)",
      }}
    >
      <Section icon={<GitBranch size={11} />} title="BRANCHES">
        {branches.length ? (
          branches.map((ref) => (
            <BranchRow
              key={ref.name}
              active={selectedRef === ref.shortName || selectedRef === ref.name}
              dot="var(--rs-accent)"
              name={ref.shortName}
              hint={ref.hash.slice(0, 7)}
              onClick={() => onSelectRef(ref.name)}
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
              onClick={() => onSelectRef(ref.name)}
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
              muted
              active={selectedRef === ref.shortName || selectedRef === ref.name}
              onClick={() => onSelectRef(ref.name)}
            />
          ))
        ) : (
          <EmptyRow>No remotes</EmptyRow>
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

function AlertRow({ alert }: { alert: RealtimeAlert }) {
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
      <div
        style={{
          fontSize: 11,
          color: "var(--rs-text-secondary)",
          marginTop: 4,
          lineHeight: 1.45,
        }}
      >
        {alert.refName} moved from {alert.previousHash.slice(0, 7)} to{" "}
        {alert.currentHash.slice(0, 7)}.
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--rs-text-muted)",
          marginTop: 3,
          fontFamily: "var(--rs-mono)",
        }}
      >
        {alert.time}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  tone?: "warning";
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
        {icon} {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function BranchRow({
  name,
  hint,
  active,
  dot,
  muted,
  onClick,
}: {
  name: string;
  hint?: string;
  active?: boolean;
  dot?: string;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
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

function TagRow({
  name,
  active,
  onClick,
}: {
  name: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
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
    </button>
  );
}
