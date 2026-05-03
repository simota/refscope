/**
 * FleetSurface — Fleet observation surface.
 *
 * Renders one row per repo in a listbox. Each row has 8 cells (proposal §6.1):
 *   [dot] [id] [HEAD short SHA] [24h commits] [1h ref move] [wt dirty] [last event] [exclude ×]
 *
 * Glyph hierarchy (Echo S-D1 re-design, proposal §6.4).
 * Shape base separation principle (3 shapes, CVD+Quiet grayscale identification):
 *   ● circle  — live ping / boolean true (default)
 *   ◆ rotated-square — CVD-safe live ping / boolean true
 *   ✶ 6-pointed star (U+2736) — worktree dirty, Wong amber in default; shape in CVD/Quiet
 *   ! square base — timeout
 *   × cross — config error
 *
 * Empty cell rule (proposal §6.2): null/0 → em-dash (U+2014) "—", never "0".
 * Boolean cells: true → ●/◆ (CVD), false/null → —.
 *
 * aria-live: ONE region at listbox level (proposal §6.5, Vision §6.5).
 *   default: polite + 60s coalesce window
 *   Quiet:   off   + 180s coalesce window
 *
 * No new --rs-* CSS variables (Vision §6.4 reuse principle).
 * No new npm packages (Refscope house pattern).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { X, RotateCcw, Trash2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import type { FleetSnapshot } from "../../api";
import type { LastOpenedEntry } from "../../hooks/useLastOpenedRepos";

// ---------------------------------------------------------------------------
// origin — "env" means from RTGV_REPOS env var, "ui" means added via UI button
// ---------------------------------------------------------------------------
export type RepoOrigin = "env" | "ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExcludedSet = Set<string>;

/** Read/write excluded repo-id list from localStorage (repo id only, never path). */
const EXCLUDED_STORAGE_KEY = "refscope.fleet.excluded.v1";

function readExcluded(): ExcludedSet {
  try {
    const raw = window.localStorage.getItem(EXCLUDED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const ids: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && item.length > 0 && item.length <= 64) {
        ids.push(item);
      }
    }
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function writeExcluded(excluded: ExcludedSet): void {
  try {
    window.localStorage.setItem(EXCLUDED_STORAGE_KEY, JSON.stringify([...excluded]));
  } catch {
    // Quota exceeded / disabled storage — in-session state still works.
  }
}

// ---------------------------------------------------------------------------
// Glyph helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the "live/active" glyph based on CVD mode.
 * Circle (●) is the default; rotated-square (◆) for CVD-safe.
 */
function activeDot(isCvdSafe: boolean): string {
  return isCvdSafe ? "◆" : "●";
}

/** Boolean cell: true → ● (or ◆ CVD), false/null → — */
function boolCell(value: boolean | null, isCvdSafe: boolean): string {
  if (value === true) return activeDot(isCvdSafe);
  return "—"; // em-dash
}

/** Worktree dirty glyph. ✶ (U+2736) in default, ◆ in CVD (shape distinguishable). */
function wtDirtyGlyph(dirty: boolean | null, isCvdSafe: boolean): string {
  if (dirty !== true) return "—";
  return isCvdSafe ? "◆" : "✶"; // ✶
}

/** Status glyph for the dot cell based on repo status. */
function statusGlyph(
  status: FleetSnapshot["repos"][number]["status"],
  isCvdSafe: boolean,
): string {
  switch (status) {
    case "ok":
      return activeDot(isCvdSafe);
    case "timeout":
      return "!";
    case "git_error":
      return "×"; // ×
    case "missing":
      return "×";
    case "unauthorized":
      return "×";
    default:
      return "—";
  }
}

/** Colour for the status glyph (uses existing --rs-* tokens only). */
function statusColor(status: FleetSnapshot["repos"][number]["status"]): string {
  switch (status) {
    case "ok":
      return "var(--rs-git-added)";
    case "timeout":
      return "var(--rs-warning)";
    case "git_error":
    case "missing":
    case "unauthorized":
      return "var(--rs-text-muted)";
    default:
      return "var(--rs-text-muted)";
  }
}

// ---------------------------------------------------------------------------
// Relative-time formatter (mirrors api.ts formatRelativeTime)
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "—";
  const timestamp = Date.parse(isoString);
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

type RepoRow = FleetSnapshot["repos"][number];

function FleetRow({
  repo,
  isExcluded,
  isCvdSafe,
  isQuiet,
  origin,
  onExclude,
  onRestore,
  onSelectRepo,
  onRequestRemove,
}: {
  repo: RepoRow;
  isExcluded: boolean;
  isCvdSafe: boolean;
  isQuiet: boolean;
  /** "env" = from RTGV_REPOS, "ui" = added via UI. Remove button shown for "ui" only. */
  origin: RepoOrigin;
  onExclude: (id: string) => void;
  onRestore: (id: string) => void;
  onSelectRepo: (id: string) => void;
  /** Invoked when the user clicks the Remove button (ui-origin rows only). */
  onRequestRemove: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  // Commits 24h: null → —, number → literal count (but 0 stays 0 per schema)
  // Per spec §6.2: "0 ではなく —" — this means null → —, but 0 is a valid count.
  // Re-reading: "empty なら —" and "0" is forbidden as a display for unknown/null.
  // We show "—" only when the value is null (meaning status != ok).
  const commits24hDisplay =
    repo.commits24h === null ? "—" : String(repo.commits24h);

  const rowStyle: React.CSSProperties = {
    height: 28,
    display: "flex",
    alignItems: "center",
    gap: 0,
    cursor: isExcluded ? "default" : "pointer",
    opacity: isExcluded ? 0.35 : 1,
    fontStyle: isExcluded ? "italic" : "normal",
    fontFamily: "var(--rs-mono)",
    fontSize: 12,
    color: "var(--rs-text-primary)",
    borderBottom: "1px solid var(--rs-border)",
    transition: isQuiet ? "none" : "background 80ms",
    background: hovered && !isExcluded ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 8%)" : "transparent",
    paddingLeft: 8,
    paddingRight: 4,
    userSelect: "none",
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isExcluded) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectRepo(repo.repoId);
    }
  };

  return (
    <div
      role="option"
      aria-selected={false}
      tabIndex={0}
      style={rowStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !isExcluded && onSelectRepo(repo.repoId)}
      onKeyDown={handleKeyDown}
      aria-label={`${repo.repoId}${isExcluded ? ", excluded" : ""}`}
    >
      {/* Cell 1: dot — status glyph */}
      <span
        style={{
          width: 16,
          textAlign: "center",
          color: statusColor(repo.status),
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {statusGlyph(repo.status, isCvdSafe)}
      </span>

      {/* Cell 2: repo id — truncated, plus origin badge */}
      <span
        style={{
          flex: "1 1 0",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 6,
          paddingRight: 6,
          minWidth: 0,
        }}
        title={repo.repoId}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--rs-text-primary)",
          }}
        >
          {repo.repoId}
        </span>
        {/* origin badge: env → muted, ui → accent — no tooltip per spec (noise 0) */}
        <span
          aria-label={origin === "ui" ? "added via UI" : "from env var"}
          style={{
            flexShrink: 0,
            fontSize: 10,
            padding: "0 4px",
            borderRadius: 3,
            color: origin === "ui" ? "var(--rs-accent)" : "var(--rs-text-muted)",
            background:
              origin === "ui"
                ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 18%)"
                : "var(--rs-bg-elevated)",
            border: `1px solid ${origin === "ui" ? "color-mix(in oklab, var(--rs-border), var(--rs-accent) 40%)" : "var(--rs-border)"}`,
            fontFamily: "var(--rs-mono)",
          }}
        >
          {origin}
        </span>
      </span>

      {/* Cell 3: HEAD short SHA */}
      <span
        style={{
          width: 60,
          flexShrink: 0,
          color: "var(--rs-text-secondary)",
          whiteSpace: "nowrap",
        }}
      >
        {repo.headShortSha ?? "—"}
      </span>

      {/* Cell 4: 24h commits — null → — */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            style={{
              width: 40,
              flexShrink: 0,
              textAlign: "right",
              color: "var(--rs-text-muted)",
              cursor: repo.commits24h === null ? "help" : "default",
            }}
            tabIndex={repo.commits24h === null ? 0 : undefined}
          >
            {commits24hDisplay}
          </span>
        </TooltipTrigger>
        {repo.commits24h === null && (
          <TooltipContent>No Git event observed (24h)</TooltipContent>
        )}
      </Tooltip>

      {/* Cell 5: 1h ref move */}
      <span
        style={{
          width: 20,
          flexShrink: 0,
          textAlign: "center",
          color: repo.refMove1h ? "var(--rs-git-added)" : "var(--rs-text-muted)",
        }}
        aria-label={repo.refMove1h ? "ref changed in last 1h" : "no ref change in 1h"}
      >
        {boolCell(repo.refMove1h, isCvdSafe)}
      </span>

      {/* Cell 6: worktree dirty */}
      <span
        style={{
          width: 20,
          flexShrink: 0,
          textAlign: "center",
          color: repo.worktreeDirty ? "var(--rs-warning)" : "var(--rs-text-muted)",
        }}
        aria-label={repo.worktreeDirty ? "worktree has uncommitted changes" : "worktree clean"}
      >
        {wtDirtyGlyph(repo.worktreeDirty, isCvdSafe)}
      </span>

      {/* Cell 7: last event time */}
      <span
        style={{
          width: 64,
          flexShrink: 0,
          textAlign: "right",
          color: "var(--rs-text-muted)",
          paddingRight: 8,
        }}
      >
        {formatRelativeTime(repo.lastEventAt)}
      </span>

      {/* Remove button — ui-origin rows only, hover/focus visible, DOM absent for env-origin */}
      {origin === "ui" && !isExcluded && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRequestRemove(repo.repoId); }}
          style={{
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--rs-text-muted)",
            flexShrink: 0,
            opacity: hovered ? 0.8 : 0,
            transition: isQuiet ? "none" : "opacity 80ms",
          }}
          tabIndex={hovered ? 0 : -1}
          aria-label={`Remove ${repo.repoId} from fleet`}
        >
          <Trash2 size={11} />
        </button>
      )}

      {/* Cell 8: exclude × / restore ↻ on hover/focus */}
      {isExcluded ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRestore(repo.repoId); }}
          style={{
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--rs-text-muted)",
            flexShrink: 0,
            opacity: hovered ? 1 : 0.6,
          }}
          aria-label={`Restore ${repo.repoId}`}
        >
          <RotateCcw size={11} />
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onExclude(repo.repoId); }}
          style={{
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--rs-text-muted)",
            flexShrink: 0,
            opacity: hovered ? 1 : 0,
            transition: isQuiet ? "none" : "opacity 80ms",
          }}
          tabIndex={hovered ? 0 : -1}
          aria-label={`Exclude ${repo.repoId}`}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FleetSurface({
  snapshot,
  error,
  isCvdSafe,
  isQuiet,
  onSelectRepo,
  lastOpenedRepos = [],
  repoOrigins = {},
  onRemoveRepo,
}: {
  snapshot: FleetSnapshot | null;
  error: string | null;
  isCvdSafe: boolean;
  isQuiet: boolean;
  onSelectRepo: (id: string) => void;
  /** Recently opened repos (newest first). Additive display only — does not affect default row order. */
  lastOpenedRepos?: LastOpenedEntry[];
  /**
   * Map of repoId → origin. Missing entries default to "env".
   * Step 7 will wire this from the real allowlist response.
   */
  repoOrigins?: Record<string, RepoOrigin>;
  /**
   * Step 7: replaced with real API call.
   * Step 6: parent passes mock `async () => ({ ok: true })`.
   */
  onRemoveRepo?: (repoId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [excluded, setExcluded] = useState<ExcludedSet>(() => readExcluded());

  // aria-live announcement — 1 region, coalesced (60s default / 180s Quiet).
  const [announcement, setAnnouncement] = useState("");
  const pendingChangesRef = useRef<string[]>([]);
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSnapshotRef = useRef<FleetSnapshot | null>(null);

  // Track changes and coalesce aria-live announcements.
  useEffect(() => {
    if (!snapshot) return;
    const prev = prevSnapshotRef.current;
    if (prev) {
      const changed: string[] = [];
      for (const repo of snapshot.repos) {
        const prevRepo = prev.repos.find((r) => r.repoId === repo.repoId);
        if (
          prevRepo &&
          (prevRepo.headShortSha !== repo.headShortSha ||
            prevRepo.commits24h !== repo.commits24h ||
            prevRepo.refMove1h !== repo.refMove1h ||
            prevRepo.worktreeDirty !== repo.worktreeDirty ||
            prevRepo.lastEventAt !== repo.lastEventAt)
        ) {
          changed.push(repo.repoId);
        }
      }
      if (changed.length > 0) {
        pendingChangesRef.current = [...new Set([...pendingChangesRef.current, ...changed])];
      }
    }
    prevSnapshotRef.current = snapshot;
  }, [snapshot]);

  // Fire coalesced announcement on the interval (60s default / 180s Quiet).
  useEffect(() => {
    const intervalMs = isQuiet ? 180_000 : 60_000;

    const timer = setInterval(() => {
      const changes = pendingChangesRef.current;
      if (changes.length === 0) return;
      const names = changes.slice(0, 4).join(", ");
      const suffix = changes.length > 4 ? ` and ${changes.length - 4} more` : "";
      setAnnouncement(
        `Fleet update: ${changes.length} ${changes.length === 1 ? "repo" : "repos"} changed (${names}${suffix})`,
      );
      pendingChangesRef.current = [];
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isQuiet]);

  const handleExclude = useCallback((id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeExcluded(next);
      return next;
    });
  }, []);

  const handleRestore = useCallback((id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.delete(id);
      writeExcluded(next);
      return next;
    });
  }, []);

  const handleRestoreAll = useCallback(() => {
    const empty = new Set<string>();
    writeExcluded(empty);
    setExcluded(empty);
  }, []);

  // Remove confirm dialog state (ui-origin rows only, 1-step confirm per charter v2 §1 P4).
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const handleRequestRemove = useCallback((id: string) => {
    setRemoveTargetId(id);
    setRemoveError(null);
  }, []);

  const handleConfirmRemove = useCallback(async () => {
    if (!removeTargetId || !onRemoveRepo) {
      setRemoveTargetId(null);
      return;
    }
    const result = await onRemoveRepo(removeTargetId);
    if (result.ok) {
      setRemoveTargetId(null);
      setRemoveError(null);
    } else {
      setRemoveError(result.error);
    }
  }, [removeTargetId, onRemoveRepo]);

  const repos = snapshot?.repos ?? [];
  const activeRepos = repos.filter((r) => !excluded.has(r.repoId));
  const excludedRepos = repos.filter((r) => excluded.has(r.repoId));
  const cost = snapshot?.estimatedCost;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--rs-bg-canvas)",
        color: "var(--rs-text-primary)",
      }}
    >
      {/* Error banner */}
      {error && (
        <div
          role="alert"
          style={{
            padding: "6px 12px",
            fontSize: 12,
            color: "var(--rs-text-muted)",
            borderBottom: "1px solid var(--rs-border)",
          }}
        >
          Fleet snapshot failed: {error}
        </div>
      )}

      {/* Loading state */}
      {!snapshot && !error && (
        <div
          style={{
            padding: "12px",
            fontSize: 12,
            color: "var(--rs-text-muted)",
          }}
        >
          Loading fleet data…
        </div>
      )}

      {/* Listbox — ONE aria-live region here (§6.5 per-row aria-live zero). */}
      {snapshot && (
        <div
          role="listbox"
          aria-label="Fleet repos"
          aria-live={isQuiet ? "off" : "polite"}
          aria-atomic="false"
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {/* Screen-reader announcement target (visually hidden) */}
          <span
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              overflow: "hidden",
              clip: "rect(0,0,0,0)",
              whiteSpace: "nowrap",
            }}
            aria-live={isQuiet ? "off" : "polite"}
            aria-atomic="true"
          >
            {announcement}
          </span>

          {/* Active repos */}
          {activeRepos.map((repo) => (
            <FleetRow
              key={repo.repoId}
              repo={repo}
              isExcluded={false}
              isCvdSafe={isCvdSafe}
              isQuiet={isQuiet}
              origin={repoOrigins[repo.repoId] ?? "env"}
              onExclude={handleExclude}
              onRestore={handleRestore}
              onSelectRepo={onSelectRepo}
              onRequestRemove={handleRequestRemove}
            />
          ))}

          {/* Empty state */}
          {repos.length === 0 && (
            <div
              style={{
                padding: 16,
                fontSize: 12,
                color: "var(--rs-text-muted)",
                textAlign: "center",
              }}
            >
              No repos in fleet snapshot.
            </div>
          )}

          {/* Recently opened section (Magi D5 O3).
              Additive display only — does not change default fleet row order.
              Rendered only when at least one entry exists. */}
          {lastOpenedRepos.length > 0 && (
            <>
              <div
                role="separator"
                style={{
                  height: 1,
                  background: "var(--rs-border)",
                  margin: "4px 0",
                }}
              />
              <div
                style={{
                  padding: "2px 8px",
                  fontSize: 11,
                  color: "var(--rs-text-muted)",
                }}
              >
                Recently opened ({lastOpenedRepos.length})
              </div>
              {lastOpenedRepos.map((entry) => (
                <div
                  key={entry.repoId}
                  role="option"
                  aria-selected={false}
                  tabIndex={0}
                  style={{
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    gap: 0,
                    cursor: "pointer",
                    fontFamily: "var(--rs-mono)",
                    fontSize: 11,
                    color: "var(--rs-text-muted)",
                    paddingLeft: 22,
                    paddingRight: 8,
                    userSelect: "none",
                    borderBottom: "1px solid transparent",
                    transition: isQuiet ? "none" : "background 80ms",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background =
                      "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 8%)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  }}
                  onClick={() => onSelectRepo(entry.repoId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectRepo(entry.repoId);
                    }
                  }}
                  aria-label={`${entry.repoId}, opened ${formatRelativeTime(entry.openedAt)}`}
                >
                  <span
                    style={{
                      flex: "1 1 0",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={entry.repoId}
                  >
                    {entry.repoId}
                  </span>
                  <span style={{ flexShrink: 0 }}>
                    {formatRelativeTime(entry.openedAt)}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* Excluded section */}
          {excludedRepos.length > 0 && (
            <>
              <div
                role="separator"
                style={{
                  height: 1,
                  background: "var(--rs-border)",
                  margin: "4px 0",
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "2px 8px",
                  fontSize: 11,
                  color: "var(--rs-text-muted)",
                }}
              >
                <span>{excludedRepos.length} excluded this session</span>
                <button
                  type="button"
                  onClick={handleRestoreAll}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--rs-text-muted)",
                    fontSize: 11,
                    textDecoration: "underline",
                    padding: "0 2px",
                  }}
                >
                  Restore all
                </button>
              </div>
              {excludedRepos.map((repo) => (
                <FleetRow
                  key={repo.repoId}
                  repo={repo}
                  isExcluded={true}
                  isCvdSafe={isCvdSafe}
                  isQuiet={isQuiet}
                  origin={repoOrigins[repo.repoId] ?? "env"}
                  onExclude={handleExclude}
                  onRestore={handleRestore}
                  onSelectRepo={onSelectRepo}
                  onRequestRemove={handleRequestRemove}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Footer: literal cost numbers only (charter §5, proposal §6.8). No adjectives. */}
      {cost && (
        <div
          style={{
            padding: "4px 8px",
            fontSize: 11,
            color: "var(--rs-text-muted)",
            borderTop: "1px solid var(--rs-border)",
            fontFamily: "var(--rs-mono)",
          }}
        >
          {cost.subscribedRepoCount} repos &middot; git ~{cost.gitCallsPerMin}/min &middot; poll 30s
        </div>
      )}

      {/* Remove confirm dialog — 1-step confirm (charter v2 §1 P4 calm). ui-origin only. */}
      <AlertDialog
        open={removeTargetId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTargetId(null);
            setRemoveError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this repository?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTargetId} will be removed from your fleet. This does not delete the Git repository on disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError && (
            <div
              role="alert"
              style={{
                fontSize: 12,
                color: "var(--rs-warning)",
                padding: "6px 10px",
                background: "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-warning) 10%)",
                border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 40%)",
                borderRadius: "var(--rs-radius-sm)",
              }}
            >
              {removeError}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmRemove();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
