import { GitBranch, Tag, Cloud, AlertTriangle, ChevronRight } from "lucide-react";

export function BranchSidebar() {
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
        <BranchRow active dot="var(--rs-accent)" name="main" hint="+3" />
        <BranchRow name="develop" hint="+8" />
        <BranchRow name="feature/ui" hint="" />
        <BranchRow name="fix/sse-reconnect" />
        <BranchRow name="release/2.1" />
      </Section>

      <Section icon={<Tag size={11} />} title="TAGS">
        <TagRow name="v2.1.0" />
        <TagRow name="v2.0.0" />
        <TagRow name="v1.9.4" />
      </Section>

      <Section icon={<Cloud size={11} />} title="REMOTES">
        <BranchRow name="origin/main" muted />
        <BranchRow name="origin/develop" muted />
      </Section>

      <Section icon={<AlertTriangle size={11} />} title="ALERTS" tone="warning">
        <div
          className="px-2 py-2 mx-1 rounded-md"
          style={{
            background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 14%)",
            border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 40%)",
          }}
        >
          <div
            className="flex items-center gap-1.5"
            style={{ fontSize: 11, color: "var(--rs-warning)", fontWeight: 600 }}
          >
            <AlertTriangle size={11} /> rewritten
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--rs-text-secondary)",
              marginTop: 4,
              lineHeight: 1.45,
            }}
          >
            api-server/main was force-updated 2h ago.
          </div>
        </div>
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
        <span>HEAD a1b2c3d</span>
        <span className="flex items-center gap-1">clean</span>
      </div>
    </aside>
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
}: {
  name: string;
  hint?: string;
  active?: boolean;
  dot?: string;
  muted?: boolean;
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

function TagRow({ name }: { name: string }) {
  return (
    <div
      className="mx-1 px-2 flex items-center gap-2"
      style={{
        height: 24,
        fontSize: 12,
        fontFamily: "var(--rs-mono)",
        color: "var(--rs-text-secondary)",
      }}
    >
      <ChevronRight size={11} style={{ color: "var(--rs-git-merge)" }} />
      {name}
    </div>
  );
}
