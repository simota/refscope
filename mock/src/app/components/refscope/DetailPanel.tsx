import { Copy, ExternalLink, Sparkles, ShieldCheck } from "lucide-react";
import type { Commit } from "./data";
import { diffSample } from "./data";

export function DetailPanel({ commit }: { commit: Commit }) {
  return (
    <aside
      className="flex flex-col overflow-hidden"
      style={{
        width: 460,
        background: "var(--rs-bg-panel)",
        borderLeft: "1px solid var(--rs-border)",
      }}
    >
      <div
        className="px-4 flex items-center justify-between"
        style={{
          height: 40,
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            fontWeight: 600,
            color: "var(--rs-text-muted)",
          }}
        >
          COMMIT
        </div>
        <div className="flex gap-1">
          <button className="rs-icon-btn" title="Copy git show">
            <ExternalLink size={13} />
          </button>
          <button className="rs-icon-btn" title="Copy hash">
            <Copy size={13} />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto" style={{ flex: 1 }}>
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--rs-border)" }}>
          <div
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 12,
              color: "var(--rs-text-secondary)",
            }}
          >
            {commit.hash}
          </div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--rs-text-primary)",
              marginTop: 6,
              lineHeight: 1.4,
            }}
          >
            {commit.subject}
          </h3>
          {commit.body ? (
            <p
              style={{
                fontSize: 12,
                color: "var(--rs-text-secondary)",
                marginTop: 8,
                lineHeight: 1.55,
              }}
            >
              {commit.body}
            </p>
          ) : null}

          <dl
            className="grid mt-3"
            style={{
              gridTemplateColumns: "72px 1fr",
              rowGap: 6,
              columnGap: 12,
              fontSize: 12,
            }}
          >
            <Meta label="Author">
              {commit.author}{" "}
              <span style={{ color: "var(--rs-text-muted)" }}>· 2026-04-30 12:30</span>
            </Meta>
            <Meta label="Parents">
              <span style={{ fontFamily: "var(--rs-mono)" }}>
                {commit.parents?.join(", ") ?? "—"}
              </span>
            </Meta>
            <Meta label="Refs">
              <span className="flex flex-wrap gap-1">
                {(commit.refs ?? []).map((r) => (
                  <span
                    key={r}
                    className="px-1.5 rounded-full"
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--rs-mono)",
                      background:
                        "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 22%)",
                      color: "var(--rs-text-primary)",
                      border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
                    }}
                  >
                    {r}
                  </span>
                ))}
                {commit.signed ? (
                  <span
                    className="px-1.5 rounded-full inline-flex items-center gap-1"
                    style={{
                      fontSize: 10,
                      color: "var(--rs-accent)",
                      border:
                        "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 40%)",
                    }}
                  >
                    <ShieldCheck size={10} /> signed
                  </span>
                ) : null}
              </span>
            </Meta>
          </dl>
        </div>

        <AISummary />

        <Section title="CHANGED FILES" hint={`${commit.files.length} files`}>
          {commit.files.length === 0 ? (
            <Empty>No file changes (merge commit)</Empty>
          ) : (
            commit.files.map((f) => (
              <div
                key={f.path}
                className="px-3 flex items-center gap-2"
                style={{
                  height: 28,
                  fontSize: 12,
                  fontFamily: "var(--rs-mono)",
                  borderBottom:
                    "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
                }}
              >
                <FileBadge status={f.status} />
                <span
                  className="flex-1 truncate"
                  style={{ color: "var(--rs-text-primary)" }}
                >
                  {f.path}
                </span>
                <span style={{ color: "var(--rs-git-added)" }}>+{f.added}</span>
                <span style={{ color: "var(--rs-git-deleted)" }}>-{f.deleted}</span>
              </div>
            ))
          )}
        </Section>

        <Section title="DIFF" hint="src/api/events.ts">
          <Diff />
        </Section>
      </div>
    </aside>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt
        style={{
          color: "var(--rs-text-muted)",
          fontSize: 11,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </dt>
      <dd style={{ color: "var(--rs-text-primary)", fontSize: 12 }}>{children}</dd>
    </>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--rs-border)" }}>
      <div
        className="px-4 flex items-center justify-between"
        style={{
          height: 30,
          fontSize: 10,
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: "var(--rs-text-muted)",
          background: "var(--rs-bg-canvas)",
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <span>{title}</span>
        {hint ? (
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontWeight: 400,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            {hint}
          </span>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 py-4"
      style={{ fontSize: 12, color: "var(--rs-text-muted)" }}
    >
      {children}
    </div>
  );
}

function FileBadge({ status }: { status: "M" | "A" | "D" }) {
  const map = {
    M: { color: "var(--rs-git-modified)", bg: "var(--rs-git-modified)" },
    A: { color: "var(--rs-git-added)", bg: "var(--rs-git-added)" },
    D: { color: "var(--rs-git-deleted)", bg: "var(--rs-git-deleted)" },
  } as const;
  const c = map[status];
  return (
    <span
      className="grid place-items-center rounded"
      style={{
        width: 16,
        height: 16,
        fontSize: 10,
        fontWeight: 700,
        color: c.color,
        background: `color-mix(in oklab, var(--rs-bg-elevated), ${c.bg} 22%)`,
        border: `1px solid color-mix(in oklab, var(--rs-border), ${c.bg} 40%)`,
      }}
    >
      {status}
    </span>
  );
}

function AISummary() {
  return (
    <div
      className="mx-3 my-3 p-3 rounded-md"
      style={{
        background: "var(--rs-bg-elevated)",
        border: "1px solid var(--rs-border)",
      }}
    >
      <div
        className="flex items-center gap-1.5"
        style={{ fontSize: 11, color: "var(--rs-accent)", fontWeight: 600 }}
      >
        <Sparkles size={11} /> AI Summary
        <span
          className="ml-auto px-1.5 rounded-full"
          style={{
            fontSize: 10,
            color: "var(--rs-warning)",
            background:
              "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-warning) 14%)",
            border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 40%)",
          }}
        >
          risk: medium
        </span>
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--rs-text-primary)",
          lineHeight: 1.55,
          marginTop: 6,
        }}
      >
        Adds SSE-based realtime updates to the commit timeline.
      </p>
      <ul
        style={{
          fontSize: 11,
          color: "var(--rs-text-secondary)",
          marginTop: 6,
          paddingLeft: 14,
          lineHeight: 1.6,
        }}
      >
        <li>Touches realtime subscription &amp; reconnect logic.</li>
        <li>
          Impact:{" "}
          <span style={{ fontFamily: "var(--rs-mono)" }}>src/api/events.ts</span>,{" "}
          <span style={{ fontFamily: "var(--rs-mono)" }}>src/hooks/useGitEvents.ts</span>
        </li>
      </ul>
      <div
        style={{
          fontSize: 10,
          color: "var(--rs-text-muted)",
          marginTop: 8,
          fontStyle: "italic",
        }}
      >
        Generated by AI · verify before relying on risk scores.
      </div>
    </div>
  );
}

function Diff() {
  return (
    <div
      className="overflow-x-auto"
      style={{
        fontFamily: "var(--rs-mono)",
        fontSize: 12,
        background: "var(--rs-bg-canvas)",
      }}
    >
      {diffSample.split("\n").map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isDel = line.startsWith("-") && !line.startsWith("---");
        const isHunk = line.startsWith("@@");
        return (
          <div
            key={i}
            className="grid"
            style={{
              gridTemplateColumns: "36px 36px 16px 1fr",
              minHeight: 20,
              alignItems: "center",
              background: isAdd
                ? "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-git-added) 14%)"
                : isDel
                ? "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-git-deleted) 14%)"
                : isHunk
                ? "var(--rs-bg-elevated)"
                : "transparent",
              color: isHunk ? "var(--rs-text-muted)" : "var(--rs-text-primary)",
            }}
          >
            <span
              className="text-right pr-2"
              style={{ color: "var(--rs-text-muted)", fontSize: 11 }}
            >
              {!isHunk && !isAdd ? 10 + i : ""}
            </span>
            <span
              className="text-right pr-2"
              style={{ color: "var(--rs-text-muted)", fontSize: 11 }}
            >
              {!isHunk && !isDel ? 10 + i : ""}
            </span>
            <span
              className="text-center"
              style={{
                color: isAdd
                  ? "var(--rs-git-added)"
                  : isDel
                  ? "var(--rs-git-deleted)"
                  : "var(--rs-text-muted)",
              }}
            >
              {isAdd ? "+" : isDel ? "-" : isHunk ? "" : " "}
            </span>
            <span style={{ whiteSpace: "pre" }}>
              {isAdd || isDel ? line.slice(1) : line}
            </span>
          </div>
        );
      })}
    </div>
  );
}
