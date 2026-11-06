import { useEffect, useState } from "react";
import { Bell, BellOff, ClipboardCopy, GitCompare, History, Pin, X } from "lucide-react";
import type { BriefingEvidence, RefBriefing } from "../../hooks/useRefBriefing";
import { formatElapsed, rescueCommand, type RefChange } from "../../lib/refBriefing";

/** Below this gap a "nothing moved" line is noise (e.g. a quick reload). */
const QUIET_REPORT_MIN_MS = 15 * 60 * 1000;
const COLLAPSED_ROWS = 6;

type Props = {
  briefing: RefBriefing;
  onDismiss: () => void;
  /** Open the compare bar with base = previous tip, target = current tip. */
  onReview: (base: string, target: string) => void;
  onShowRef: (refName: string) => void;
  watchNotifications: {
    enabled: boolean;
    permission: "default" | "granted" | "denied" | "unsupported";
    onToggle: () => void;
  };
};

function short(hash: string | null) {
  return hash ? hash.slice(0, 7) : "—";
}

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Text label first (never colour alone), tone second. */
function changeLabel(change: RefChange, evidence: BriefingEvidence | undefined): { text: string; tone: string } {
  if (change.kind === "created") return { text: "NEW", tone: "var(--rs-git-added)" };
  if (change.kind === "deleted") return { text: "DELETED", tone: "var(--rs-git-deleted)" };
  switch (evidence?.shape) {
    case "rewritten":
      return { text: "REWRITTEN", tone: "var(--rs-warning)" };
    case "rewound":
      return { text: "REWOUND", tone: "var(--rs-warning)" };
    case "fast-forward":
      return { text: "FAST-FORWARD", tone: "var(--rs-accent)" };
    default:
      return { text: "MOVED", tone: "var(--rs-git-modified)" };
  }
}

function evidenceText(change: RefChange, evidence: BriefingEvidence | undefined): string {
  const parts: string[] = [];
  if (change.kind === "moved") {
    if (evidence?.compareFailed) parts.push("previous tip no longer readable");
    else if (evidence?.ahead !== undefined) {
      if (evidence.ahead) parts.push(`+${evidence.ahead} new`);
      if (evidence.behind) parts.push(`${evidence.behind} dropped`);
    }
  }
  const reflog = evidence?.reflog;
  if (reflog && reflog.length > 0) {
    const last = reflog[0];
    const when = last.movedAt ? formatTime(last.movedAt) : "";
    parts.push(
      `reflog: ${reflog.length} move${reflog.length === 1 ? "" : "s"}, last ${last.action}${when ? ` at ${when}` : ""}`,
    );
  }
  return parts.join(" · ");
}

export function SinceLastVisitBanner({ briefing, onDismiss, onReview, onShowRef, watchNotifications }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(""), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const { changes, evidence, since } = briefing;
  const gapMs = now - Date.parse(since);
  if (changes.length === 0 && !(gapMs >= QUIET_REPORT_MIN_MS)) return null;

  const elapsed = formatElapsed(since, now);
  const visible = expanded ? changes : changes.slice(0, COLLAPSED_ROWS);
  const hidden = changes.length - visible.length;
  const watchedMoved = changes.filter((change) => change.watched).length;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied("");
    }
  };

  const notifyTitle =
    watchNotifications.permission === "unsupported"
      ? "This browser does not support desktop notifications"
      : watchNotifications.permission === "denied"
        ? "Notifications are blocked for this site in the browser settings"
        : watchNotifications.enabled
          ? "Stop desktop notifications for pinned refs"
          : "Notify me when a pinned ref moves while this tab is in the background";

  return (
    <section
      role="region"
      aria-label="Ref changes since your last visit"
      style={{
        padding: "8px 16px",
        background: "color-mix(in oklab, var(--rs-bg-panel), var(--rs-accent) 8%)",
        borderBottom: "1px solid var(--rs-border)",
        fontFamily: "var(--rs-sans)",
        fontSize: 11,
        color: "var(--rs-text-secondary)",
        flexShrink: 0,
        maxHeight: "40vh",
        overflowY: "auto",
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <History size={12} aria-hidden style={{ color: "var(--rs-accent)" }} />
        <span style={{ color: "var(--rs-text-primary)", fontWeight: 600 }}>
          Since your last visit · {elapsed}
        </span>
        <span>
          {changes.length === 0
            ? "No ref moved."
            : `${changes.length} ref${changes.length === 1 ? "" : "s"} changed${
                watchedMoved ? ` (${watchedMoved} pinned)` : ""
              }.`}
        </span>
        <span style={{ color: "var(--rs-text-muted)" }}>
          Reconstructed at startup from Git by comparing with the ref snapshot this browser saved at{" "}
          {formatTime(since)} — not live observation.
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className="rs-compact-button"
          aria-pressed={watchNotifications.enabled}
          disabled={watchNotifications.permission === "unsupported" || watchNotifications.permission === "denied"}
          title={notifyTitle}
          onClick={watchNotifications.onToggle}
        >
          {watchNotifications.enabled ? (
            <Bell size={11} aria-hidden style={{ marginRight: 4 }} />
          ) : (
            <BellOff size={11} aria-hidden style={{ marginRight: 4 }} />
          )}
          {watchNotifications.enabled ? "Notifying" : "Notify on pinned moves"}
        </button>
        <button type="button" className="rs-compact-button" aria-label="Dismiss since-last-visit summary" onClick={onDismiss}>
          <X size={11} aria-hidden />
        </button>
      </div>
      {changes.length > 0 ? (
        <ul className="mt-1.5" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {visible.map((change) => {
            const ev = evidence[change.name];
            const label = changeLabel(change, ev);
            const detail = evidenceText(change, ev);
            const rescue =
              change.kind === "deleted" || ev?.shape === "rewritten" || ev?.shape === "rewound"
                ? rescueCommand(change)
                : null;
            return (
              <li
                key={change.name}
                className="flex flex-wrap items-center gap-2"
                style={{ padding: "3px 0", borderTop: "1px solid color-mix(in oklab, var(--rs-border), transparent 50%)" }}
              >
                <span
                  style={{
                    minWidth: 92,
                    fontFamily: "var(--rs-mono)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.4px",
                    color: label.tone,
                  }}
                >
                  {label.text}
                </span>
                {change.watched ? <Pin size={10} aria-label="pinned" style={{ color: "var(--rs-accent)" }} /> : null}
                <span
                  title={change.name}
                  style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-primary)", fontWeight: 600 }}
                >
                  {change.shortName}
                </span>
                <span style={{ fontFamily: "var(--rs-mono)" }}>
                  {short(change.from)} → {short(change.to)}
                </span>
                {detail ? <span style={{ color: "var(--rs-text-muted)" }}>{detail}</span> : null}
                <span className="flex-1" />
                {change.kind === "moved" && !ev?.compareFailed ? (
                  <button
                    type="button"
                    className="rs-compact-button"
                    title={`Compare ${short(change.from)} (last visit) with ${short(change.to)} (now)`}
                    onClick={() => onReview(change.from!, change.to!)}
                  >
                    <GitCompare size={11} aria-hidden style={{ marginRight: 4 }} />
                    Review
                  </button>
                ) : null}
                {change.kind !== "deleted" ? (
                  <button type="button" className="rs-compact-button" onClick={() => onShowRef(change.name)}>
                    Show
                  </button>
                ) : null}
                {rescue ? (
                  <button
                    type="button"
                    className="rs-compact-button"
                    title={rescue}
                    onClick={() => copy(rescue, change.name)}
                  >
                    <ClipboardCopy size={11} aria-hidden style={{ marginRight: 4 }} />
                    {copied === change.name ? "Copied" : "Copy rescue"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {hidden > 0 || expanded ? (
        <button type="button" className="rs-compact-button mt-1" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      ) : null}
    </section>
  );
}
