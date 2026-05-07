/**
 * RewriteRescuePanel — displays history_rewritten snapshots and provides
 * copy-to-clipboard restore commands.
 *
 * Read-only philosophy: this panel surfaces git commands as text only.
 * It never executes any git operation automatically.
 */

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, RotateCcw, Trash2 } from "lucide-react";
import type { RewriteRescueEntry } from "../../rewriteStore";
import {
  clearRewriteSnapshots,
  generateRescueBranchCommand,
  generateRestoreCommands,
} from "../../rewriteStore";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type RewriteRescuePanelProps = {
  repoId: string;
  entries: RewriteRescueEntry[];
  /** Called when the user clears all entries so App.tsx can update state. */
  onClear: (repoId: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

// ---------------------------------------------------------------------------
// CopyButton — inline copy with transient feedback
// ---------------------------------------------------------------------------

function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // Clipboard write failed (non-secure context / permission denied);
        // degrade silently — the code block is still visible for manual copy.
      },
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={className}
      aria-label={copied ? "Copied!" : label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "4px",
        border: "1px solid var(--rs-border)",
        background: copied ? "oklch(30% 0.12 150 / 0.25)" : "var(--rs-bg-elevated)",
        color: copied ? "var(--rs-git-added)" : "var(--rs-text-secondary)",
        fontSize: "11px",
        cursor: "pointer",
        transition: "background 0.15s, color 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      <Copy size={11} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// RescueEntryCard — collapsible row for a single snapshot
// ---------------------------------------------------------------------------

function RescueEntryCard({ entry }: { entry: RewriteRescueEntry }) {
  const [expanded, setExpanded] = useState(false);
  const restoreCommands = generateRestoreCommands(entry);
  const rescueBranch = generateRescueBranchCommand(entry);

  return (
    <div
      style={{
        borderRadius: "6px",
        border: "1px solid var(--rs-border)",
        background: "var(--rs-bg-elevated)",
        marginBottom: "6px",
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          gap: "6px",
          padding: "8px 10px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--rs-text-primary)",
        }}
        aria-expanded={expanded}
      >
        <span style={{ paddingTop: "2px", flexShrink: 0, color: "var(--rs-text-muted)" }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--rs-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.branch}
          </span>
          <span
            style={{
              display: "block",
              fontSize: "11px",
              color: "var(--rs-text-muted)",
              marginTop: "2px",
            }}
          >
            {formatTimestamp(entry.observedAt)}
          </span>
        </span>
        <span
          style={{
            fontSize: "11px",
            color: "var(--rs-text-secondary)",
            fontFamily: "var(--rs-mono, monospace)",
            flexShrink: 0,
            paddingTop: "1px",
          }}
        >
          {shortHash(entry.previousHash)}
          <span style={{ margin: "0 4px", color: "var(--rs-text-muted)" }}>→</span>
          {shortHash(entry.currentHash)}
        </span>
      </button>

      {/* Expandable detail */}
      {expanded && (
        <div
          style={{
            padding: "0 10px 10px",
            borderTop: "1px solid var(--rs-border)",
          }}
        >
          {/* SSE-only disclaimer */}
          <p
            style={{
              fontSize: "11px",
              color: "var(--rs-text-muted)",
              margin: "8px 0 6px",
              lineHeight: 1.4,
            }}
          >
            <span style={{ color: "oklch(75% 0.16 60)" }}>Note:</span>{" "}
            These commands are for reference only — review them carefully before running.
            Refscope never executes git operations on your behalf.
          </p>

          {/* Restore commands block */}
          <div style={{ marginTop: "8px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "4px",
              }}
            >
              <span style={{ fontSize: "11px", color: "var(--rs-text-secondary)", fontWeight: 600 }}>
                Restore commands
              </span>
              <CopyButton text={restoreCommands} label="Copy restore commands" />
            </div>
            <pre
              style={{
                margin: 0,
                padding: "8px 10px",
                borderRadius: "4px",
                background: "oklch(14% 0.01 255)",
                border: "1px solid var(--rs-border)",
                fontSize: "11px",
                fontFamily: "var(--rs-mono, monospace)",
                color: "var(--rs-text-primary)",
                overflowX: "auto",
                whiteSpace: "pre",
                lineHeight: 1.6,
              }}
            >
              {restoreCommands}
            </pre>
          </div>

          {/* Rescue branch command */}
          <div style={{ marginTop: "8px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "4px",
              }}
            >
              <span style={{ fontSize: "11px", color: "var(--rs-text-secondary)", fontWeight: 600 }}>
                Inspect without touching the branch
              </span>
              <CopyButton text={rescueBranch} label="Copy rescue branch command" />
            </div>
            <pre
              style={{
                margin: 0,
                padding: "8px 10px",
                borderRadius: "4px",
                background: "oklch(14% 0.01 255)",
                border: "1px solid var(--rs-border)",
                fontSize: "11px",
                fontFamily: "var(--rs-mono, monospace)",
                color: "var(--rs-text-primary)",
                overflowX: "auto",
                whiteSpace: "pre",
                lineHeight: 1.6,
              }}
            >
              {rescueBranch}
            </pre>
          </div>

          {/* Hash detail */}
          <div
            style={{
              marginTop: "8px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "6px",
            }}
          >
            <div>
              <div style={{ fontSize: "10px", color: "var(--rs-text-muted)", marginBottom: "2px" }}>
                Before (rescue target)
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <code
                  style={{
                    fontSize: "11px",
                    fontFamily: "var(--rs-mono, monospace)",
                    color: "var(--rs-git-added)",
                  }}
                >
                  {entry.previousHash}
                </code>
                <CopyButton text={entry.previousHash} label="Copy previous hash" />
              </div>
            </div>
            <div>
              <div style={{ fontSize: "10px", color: "var(--rs-text-muted)", marginBottom: "2px" }}>
                After (current)
              </div>
              <code
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--rs-mono, monospace)",
                  color: "var(--rs-text-secondary)",
                }}
              >
                {entry.currentHash}
              </code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RewriteRescuePanel — main export
// ---------------------------------------------------------------------------

export function RewriteRescuePanel({
  repoId,
  entries,
  onClear,
}: RewriteRescuePanelProps) {
  function handleClearAll() {
    clearRewriteSnapshots(repoId);
    onClear(repoId);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "10px 12px 8px",
          borderBottom: "1px solid var(--rs-border)",
          flexShrink: 0,
        }}
      >
        <RotateCcw size={14} style={{ color: "oklch(75% 0.16 60)" }} />
        <span
          style={{
            fontSize: "12px",
            fontWeight: 700,
            color: "var(--rs-text-primary)",
            flex: 1,
          }}
        >
          Rewrite Rescue
        </span>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            aria-label="Clear all rescue snapshots"
            title="Clear all"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 6px",
              borderRadius: "4px",
              border: "1px solid var(--rs-border)",
              background: "transparent",
              color: "var(--rs-text-muted)",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            <Trash2 size={11} />
            Clear all
          </button>
        )}
      </div>

      {/* SSE gap notice */}
      <div
        style={{
          padding: "6px 12px",
          borderBottom: "1px solid var(--rs-border)",
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-start",
          gap: "6px",
          background: "oklch(22% 0.02 60 / 0.3)",
        }}
      >
        <AlertTriangle size={12} style={{ color: "oklch(75% 0.16 60)", marginTop: "1px", flexShrink: 0 }} />
        <p style={{ margin: 0, fontSize: "11px", color: "var(--rs-text-muted)", lineHeight: 1.4 }}>
          Snapshots are captured in real time via SSE. Rewrites that occurred
          while refscope was not connected are not recorded here.
        </p>
      </div>

      {/* Entry list or empty state */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
        {entries.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "32px 16px",
              color: "var(--rs-text-muted)",
            }}
          >
            <RotateCcw
              size={24}
              style={{ margin: "0 auto 8px", opacity: 0.4, display: "block" }}
            />
            <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.5 }}>
              No rewrite events detected yet.
              <br />
              When a force-push or rebase rewrites a branch,
              <br />
              the pre-rewrite commit will appear here.
            </p>
          </div>
        ) : (
          <>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: "11px",
                color: "var(--rs-text-muted)",
              }}
            >
              {entries.length} event{entries.length !== 1 ? "s" : ""} recorded
              (most recent first, up to 20)
            </p>
            {entries.map((entry) => (
              <RescueEntryCard
                key={`${entry.ref}:${entry.previousHash}:${entry.observedAt}`}
                entry={entry}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
