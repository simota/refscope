/**
 * RefFlightRecorderLens — read-only timeline of observed ref movements.
 *
 * Feature flag surface. The server stores only bounded in-memory ref movement
 * facts captured while Refscope is running.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Copy, RefreshCw } from "lucide-react";
import {
  fetchRefFlightEvents,
  type RefFlightEvent,
  type RefFlightEventsResponse,
} from "../../api";
import { LensHeader } from "./LensHeader";
import { EmptyStateCard } from "./EmptyStateCard";
import type { LensId } from "./LensSwitcher";

export type RefFlightRecorderLensProps = {
  repoId: string;
  refreshKey: number;
  onChangeLens?: (lens: LensId) => void;
};

type LoadState =
  | { status: "idle" | "loading"; data: RefFlightEventsResponse | null; error: null }
  | { status: "error"; data: RefFlightEventsResponse | null; error: string }
  | { status: "ready"; data: RefFlightEventsResponse; error: null };

function helpContent(): ReactNode {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--rs-text)" }}>
        Git Ref Flight Recorder とは
      </div>
      <div style={{ color: "var(--rs-text-secondary)", lineHeight: 1.6, marginBottom: 8 }}>
        Refscope が接続中に観測した ref の移動だけを時系列で表示します。
        force-push / rebase / reset のように履歴が書き換わった可能性があるイベントは
        dangerous として分けます。
      </div>
      <div style={{ color: "var(--rs-text-secondary)", lineHeight: 1.6 }}>
        読み取り専用です。復旧・調査コマンドはテキストとして表示するだけで、
        git 操作は実行しません。起動前の rewrite や GC 済みの commit は観測できません。
      </div>
    </>
  );
}

function shortHash(hash: string | null): string {
  return hash ? hash.slice(0, 7) : "none";
}

function shortRefName(refName: string): string {
  return refName
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "")
    .replace(/^refs\/tags\//, "");
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventLabel(type: RefFlightEvent["type"]): string {
  switch (type) {
    case "history_rewritten":
      return "History rewritten";
    case "ref_fast_forward":
      return "Fast-forward";
    case "ref_created":
      return "Created";
    case "ref_deleted":
      return "Deleted";
    case "ref_updated":
      return "Updated";
    default:
      return type;
  }
}

function buildCommands(event: RefFlightEvent): string[] {
  const commands: string[] = [];
  if (event.previousHash) {
    const rescueName = `rescue/${shortRefName(event.ref.name).replace(/[^A-Za-z0-9._/-]+/g, "-")}-${shortHash(event.previousHash)}`;
    commands.push(`git branch ${rescueName} ${event.previousHash}`);
    commands.push(`git show --stat --oneline ${event.previousHash}`);
  }
  if (event.previousHash && event.currentHash) {
    commands.push(`git log --oneline --decorate ${event.previousHash}..${event.currentHash}`);
  }
  if (!commands.length && event.currentHash) {
    commands.push(`git show --stat --oneline ${event.currentHash}`);
  }
  return commands;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy command"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
      style={{
        width: 24,
        height: 24,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        border: "1px solid var(--rs-border)",
        background: copied
          ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-git-added) 18%)"
          : "var(--rs-bg-elevated)",
        color: copied ? "var(--rs-git-added)" : "var(--rs-text-secondary)",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <Copy size={13} aria-hidden="true" />
    </button>
  );
}

function EventRow({ event }: { event: RefFlightEvent }) {
  const commands = buildCommands(event);
  return (
    <article
      style={{
        border: `1px solid ${
          event.dangerous
            ? "color-mix(in oklab, var(--rs-border), var(--rs-git-deleted) 45%)"
            : "var(--rs-border)"
        }`,
        borderRadius: 6,
        background: event.dangerous
          ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-git-deleted) 7%)"
          : "var(--rs-bg-elevated)",
        padding: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          aria-hidden="true"
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            border: "1px solid var(--rs-border)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: event.dangerous ? "var(--rs-git-deleted)" : "var(--rs-accent)",
            flexShrink: 0,
          }}
        >
          {event.dangerous ? <AlertTriangle size={14} /> : "↦"}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ color: "var(--rs-text)", fontSize: 13 }}>{eventLabel(event.type)}</strong>
            <code style={{ color: "var(--rs-accent)", fontSize: 12 }}>
              {shortRefName(event.ref.name)}
            </code>
            <span style={{ color: "var(--rs-text-muted)", fontSize: 11 }}>
              {formatTime(event.observedAt)}
            </span>
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: "var(--rs-mono)",
              fontSize: 12,
              color: "var(--rs-text-secondary)",
              wordBreak: "break-word",
            }}
          >
            {shortHash(event.previousHash)} <span aria-hidden="true">→</span>{" "}
            {shortHash(event.currentHash)}
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--rs-text-secondary)", fontSize: 12 }}>
            {event.explanation}
          </p>
          {commands.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {commands.map((command) => (
                <div
                  key={command}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <code
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 11,
                      color: "var(--rs-text-secondary)",
                      border: "1px solid var(--rs-border)",
                      borderRadius: 4,
                      padding: "4px 6px",
                      background: "var(--rs-bg-panel)",
                    }}
                    title={command}
                  >
                    {command}
                  </code>
                  <CopyButton text={command} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function RefFlightRecorderLens({
  repoId,
  refreshKey,
  onChangeLens,
}: RefFlightRecorderLensProps) {
  const [manualRefresh, setManualRefresh] = useState(0);
  const [state, setState] = useState<LoadState>({
    status: "idle",
    data: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ status: "loading", data: current.data, error: null }));
    fetchRefFlightEvents(repoId, { limit: 100 }, controller.signal).then(
      (data) => setState({ status: "ready", data, error: null }),
      (err) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          data: null,
          error: err instanceof Error ? err.message : "Failed to load ref flight events",
        });
      },
    );
    return () => controller.abort();
  }, [repoId, refreshKey, manualRefresh]);

  const events = state.data?.events ?? [];
  const dangerousCount = useMemo(
    () => events.filter((event) => event.dangerous).length,
    [events],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <LensHeader
        title="Git Ref Flight Recorder"
        oneLiner="refs の移動を証拠付きで再生する read-only timeline"
        helpAriaLabel="Flight Recorder の説明を表示"
        helpContent={helpContent()}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 16px 10px",
          borderBottom: "1px solid var(--rs-border)",
          color: "var(--rs-text-secondary)",
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        <span>{events.length} observed events</span>
        <span aria-hidden="true">·</span>
        <span>{dangerousCount} dangerous</span>
        <span aria-hidden="true">·</span>
        <span>memory-only</span>
        <button
          type="button"
          onClick={() => setManualRefresh((value) => value + 1)}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "1px solid var(--rs-border)",
            borderRadius: 4,
            padding: "4px 8px",
            background: "var(--rs-bg-elevated)",
            color: "var(--rs-text-secondary)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          <RefreshCw size={13} aria-hidden="true" />
          Refresh
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
        {state.status === "error" ? (
          <EmptyStateCard
            reason="no-rewrite-events"
            messages={{
              "no-rewrite-events": {
                title: "Ref event log を読み込めません",
                body: state.error,
              },
            }}
            onChangeLens={onChangeLens}
            relatedLenses={[{ id: "rescue", label: "Open Rescue" }]}
          />
        ) : events.length === 0 ? (
          <EmptyStateCard
            reason="no-rewrite-events"
            messages={{
              "no-rewrite-events": {
                title: "Ref movement はまだ記録されていません",
                body: "Refscope が接続中に branch / tag / remote-tracking ref の移動を観測すると、ここに時系列で表示されます。起動前に起きた rewrite は記録されません。",
              },
            }}
            onChangeLens={onChangeLens}
            relatedLenses={[{ id: "drift", label: "Open Drift" }]}
          />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
