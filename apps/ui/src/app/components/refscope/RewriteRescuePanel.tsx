/**
 * RewriteRescuePanel — displays history_rewritten snapshots and provides
 * copy-to-clipboard restore commands.
 *
 * Read-only philosophy: this panel surfaces git commands as text only.
 * It never executes any git operation automatically.
 */

import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Trash2 } from "lucide-react";
import type { RewriteRescueEntry } from "../../rewriteStore";
import {
  MAX_SNAPSHOTS,
  clearRewriteSnapshots,
  deleteRewriteSnapshot,
  generateRescueBranchCommand,
  generateRestoreCommands,
} from "../../rewriteStore";
import { LensHeader } from "./LensHeader";
import {
  EmptyStateCard,
  type LensEmptyReason,
  type EmptyStateMessage,
} from "./EmptyStateCard";
import type { LensId } from "./LensSwitcher";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type RewriteRescuePanelProps = {
  repoId: string;
  entries: RewriteRescueEntry[];
  /** Called when the user clears all entries so App.tsx can update state. */
  onClear: (repoId: string) => void;
  /** Called when the user deletes a single entry so App.tsx can update state. */
  onDelete?: (repoId: string, previousHash: string, observedAt: string) => void;
  /**
   * SSE connection state from App.tsx. The disclaimer banner is shown only
   * while the connection is not healthy ("connecting" / "error"); a steady
   * "connected" stream renders no banner so the panel stays calm.
   */
  eventStatus?: "connecting" | "connected" | "error";
  /** Navigate to another Lens (used by EmptyStateCard related links). */
  onChangeLens?: (lens: LensId) => void;
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
// LensHeader helpContent
// ---------------------------------------------------------------------------

function RescueHelpContent(): ReactNode {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--rs-text)" }}>
        Rewrite Rescue とは
      </div>
      <div style={{ color: "var(--rs-text-secondary)", marginBottom: 8 }}>
        <strong>force-push / rebase</strong> でブランチの履歴が書き換えられたとき、
        <strong>書き換え直前のコミットハッシュ</strong>を SSE で受け取って localStorage に
        保存します。誤って消えそうになったコミットを救出するためのコマンドを表示します。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--rs-text)" }}>
        用語
      </div>
      <div style={{ color: "var(--rs-text-secondary)", marginBottom: 8, lineHeight: 1.7 }}>
        ・<strong>rewrite</strong>: <code>git push --force</code> や <code>git rebase</code> によって
        ブランチが指すコミットが置き換わる操作<br />
        ・<strong>previousHash</strong>: 書き換え前にブランチが指していたコミット<br />
        ・<strong>currentHash</strong>: 書き換え後に現在ブランチが指しているコミット<br />
        ・<strong>rescue branch</strong>: <code>previousHash</code> を起点に作る別ブランチで、
        現在の作業を壊さずに過去の状態を確認できる
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--rs-text)" }}>
        制約
      </div>
      <div style={{ color: "var(--rs-text-secondary)", marginBottom: 8, lineHeight: 1.7 }}>
        ・refscope は<strong>読み取り専用</strong>です。コマンドはクリップボードにコピーするだけで、
        git 操作は実行しません<br />
        ・スナップショットは<strong>refscope が接続中</strong>に発生した rewrite のみ記録されます
        (オフライン中に起きた rewrite は記録されません)<br />
        ・最大 <strong>{MAX_SNAPSHOTS}</strong> 件まで保持。新しい順に並び、上限超過時は古いものから自動で破棄されます
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--rs-text)" }}>
        操作
      </div>
      <div style={{ color: "var(--rs-text-secondary)" }}>
        ・カードクリックで展開 → 復元コマンド / rescue branch コマンドを表示・コピー<br />
        ・各カードの <strong>Trash</strong> アイコンで個別削除<br />
        ・<strong>Clear all</strong> で全削除 (確認ダイアログあり)
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state messages
// ---------------------------------------------------------------------------

const RESCUE_EMPTY_MESSAGES: Partial<Record<LensEmptyReason, EmptyStateMessage>> = {
  "no-rewrite-events": {
    title: "Rewrite イベントはまだ記録されていません",
    body:
      "force-push や rebase でブランチ履歴が書き換えられたタイミングを refscope が SSE で受信すると、書き換え直前のコミットハッシュがここに保存されます。Drift Lens でブランチの分岐状況、Outbox でローカルの未 push 変更を並行して確認できます。",
  },
};

// ---------------------------------------------------------------------------
// CopyButton — inline copy with transient feedback (idle / copied / error)
// ---------------------------------------------------------------------------

type CopyState = "idle" | "copied" | "error";

function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  function handleCopy() {
    navigator.clipboard.writeText(text).then(
      () => {
        setState("copied");
        setTimeout(() => setState("idle"), 2000);
      },
      () => {
        // Surface the failure so the user knows to copy the visible code
        // block manually instead of assuming success.
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      },
    );
  }

  const ariaLabel =
    state === "copied" ? "Copied!" : state === "error" ? "Copy failed" : label;
  const buttonText =
    state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy";
  const bg =
    state === "copied"
      ? "oklch(30% 0.12 150 / 0.25)"
      : state === "error"
        ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-git-deleted) 25%)"
        : "var(--rs-bg-elevated)";
  const color =
    state === "copied"
      ? "var(--rs-git-added)"
      : state === "error"
        ? "var(--rs-git-deleted)"
        : "var(--rs-text-secondary)";
  const borderColor = state === "error" ? "var(--rs-git-deleted)" : "var(--rs-border)";

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={className}
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "4px",
        border: `1px solid ${borderColor}`,
        background: bg,
        color,
        fontSize: "11px",
        cursor: "pointer",
        transition: "background 0.15s, color 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      <Copy size={11} aria-hidden="true" />
      {buttonText}
    </button>
  );
}

// ---------------------------------------------------------------------------
// RescueEntryCard — collapsible row for a single snapshot
// ---------------------------------------------------------------------------

function RescueEntryCard({
  entry,
  onDelete,
}: {
  entry: RewriteRescueEntry;
  onDelete?: () => void;
}) {
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
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rs-rescue-card"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "flex-start",
            gap: "6px",
            padding: "8px 10px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            color: "var(--rs-text-primary)",
            outline: "none",
          }}
          aria-expanded={expanded}
          aria-label={`${entry.branch}: rewrite ${shortHash(entry.previousHash)} → ${shortHash(entry.currentHash)} at ${formatTimestamp(entry.observedAt)}. Enter to ${expanded ? "collapse" : "expand"} commands`}
        >
          <span
            style={{ paddingTop: "2px", flexShrink: 0, color: "var(--rs-text-muted)" }}
            aria-hidden="true"
          >
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
            <span style={{ margin: "0 4px", color: "var(--rs-text-muted)" }} aria-hidden="true">
              →
            </span>
            {shortHash(entry.currentHash)}
          </span>
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete snapshot for ${entry.branch} (${shortHash(entry.previousHash)})`}
            title="Delete this snapshot"
            className="rs-rescue-card"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 10px",
              background: "transparent",
              border: "none",
              borderLeft: "1px solid var(--rs-border)",
              color: "var(--rs-text-muted)",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        )}
      </div>

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
            Review before running — refscope never executes git operations on your behalf.
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
  onDelete,
  eventStatus,
  onChangeLens,
}: RewriteRescuePanelProps) {
  function handleConfirmedClear() {
    clearRewriteSnapshots(repoId);
    onClear(repoId);
  }

  function handleDeleteOne(entry: RewriteRescueEntry) {
    deleteRewriteSnapshot(repoId, {
      previousHash: entry.previousHash,
      observedAt: entry.observedAt,
    });
    onDelete?.(repoId, entry.previousHash, entry.observedAt);
  }

  const showSseWarning = eventStatus !== undefined && eventStatus !== "connected";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* LensHeader row with Clear all action */}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 0,
          flexShrink: 0,
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <LensHeader
            title="Rewrite Rescue"
            oneLiner="force-push や rebase で消えそうな commit を救うコマンドを表示"
            helpContent={<RescueHelpContent />}
          />
        </div>
        {entries.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", padding: "8px 12px 6px" }}>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  aria-label="Clear all rescue snapshots"
                  title="Clear all"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    border: "1px solid var(--rs-border)",
                    background: "transparent",
                    color: "var(--rs-text-muted)",
                    fontSize: "11px",
                    cursor: "pointer",
                    height: 24,
                  }}
                >
                  <Trash2 size={11} aria-hidden="true" />
                  Clear all
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all rescue snapshots?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {entries.length} 件のスナップショットを削除します。
                    削除すると <code>previousHash</code> はこのリポジトリ内では参照できなくなり、
                    この操作は取り消せません (refscope 側に保存している分のみが対象です)。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                  <AlertDialogAction onClick={handleConfirmedClear}>
                    すべて削除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {/* SSE gap notice — only while not connected, to avoid alert fatigue */}
      {showSseWarning && (
        <div
          role="status"
          aria-live="polite"
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
          <AlertTriangle
            size={12}
            style={{ color: "oklch(75% 0.16 60)", marginTop: "1px", flexShrink: 0 }}
            aria-hidden="true"
          />
          <p style={{ margin: 0, fontSize: "11px", color: "var(--rs-text-muted)", lineHeight: 1.4 }}>
            {eventStatus === "connecting"
              ? "refscope はサーバーに接続中です。接続後の rewrite イベントから記録します。"
              : "refscope の接続が途切れています。切断中に起きた rewrite は記録されません。"}
          </p>
        </div>
      )}

      {/* Entry list or empty state */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
        {entries.length === 0 ? (
          <EmptyStateCard
            reason="no-rewrite-events"
            messages={RESCUE_EMPTY_MESSAGES}
            onChangeLens={onChangeLens}
            relatedLenses={
              onChangeLens
                ? [
                    { id: "drift", label: "Drift を開く" },
                    { id: "outbox", label: "Outbox を開く" },
                  ]
                : undefined
            }
          />
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
              {" "}(most recent first, up to {MAX_SNAPSHOTS} kept — older entries
              are evicted automatically)
            </p>
            {entries.map((entry) => (
              <RescueEntryCard
                key={`${entry.ref}:${entry.previousHash}:${entry.observedAt}`}
                entry={entry}
                onDelete={onDelete ? () => handleDeleteOne(entry) : undefined}
              />
            ))}
          </>
        )}
      </div>

      {/* focus-visible outline (DriftLens / OutboxLens / DigestLens parallel) */}
      <style>{`
        .rs-rescue-card:focus-visible {
          outline: 2px solid var(--rs-accent);
          outline-offset: -1px;
        }
      `}</style>
    </div>
  );
}

