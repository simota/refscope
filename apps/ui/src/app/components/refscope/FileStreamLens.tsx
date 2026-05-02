// FileStreamLens — ファイル変更を 1 行 1 カードの逆時系列ストリームで表示
import { useEffect, useMemo, useRef, useState } from 'react';
import { getCommit } from '../../api';
import type { Commit, CommitDetail } from './data';
import { FileContextMenu } from './FileContextMenu';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_COMMITS = 30;
const HIGHLIGHT_MS = 6000;
const NEW_BADGE_MS = 3000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type StreamEntry = {
  id: string;
  commitHash: string;
  commitShortHash: string;
  subject: string;
  author: string;
  authorDate: string;
  path: string;
  basename: string;
  parentDir: string;
  status: string;
  added: number;
  deleted: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusColor(status: string): string {
  switch (status) {
    case 'A': return '#22c55e';
    case 'D': return '#ef4444';
    case 'R': return '#f59e0b';
    default:  return '#64748b';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'A': return 'Added';
    case 'D': return 'Deleted';
    case 'R': return 'Renamed';
    case 'M': return 'Modified';
    default:  return status || 'Modified';
  }
}

function relativeTime(isoDate: string): string {
  try {
    const diff = Date.now() - new Date(isoDate).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 5) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return '';
  }
}

function authorInitials(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return trimmed.slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Stable hash → hue (0-359) → distinct avatar color per author
function authorColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(h) % 360}, 55%, 50%)`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export type FileStreamLensProps = {
  repoId: string | null;
  commits: Commit[];
  selectedCommitHash: string | null;
  onSelectCommit: (hash: string) => void;
  onOpenFileHistory?: (path: string) => void;
};

// ---------------------------------------------------------------------------
// FileStreamLens
// ---------------------------------------------------------------------------
export function FileStreamLens({
  repoId,
  commits,
  selectedCommitHash,
  onSelectCommit,
  onOpenFileHistory,
}: FileStreamLensProps) {
  const [detailCache, setDetailCache] = useState<Map<string, CommitDetail>>(
    () => new Map(),
  );

  // Map of entry id -> timestamp first seen (drives NEW + highlight fade)
  const appearedAtRef = useRef<Map<string, number>>(new Map());

  // Tick state forces re-render so highlight fade & relative time refresh.
  const [, setTick] = useState(0);

  // Right-click context menu state
  const [menuState, setMenuState] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);

  // Fetch commit details
  useEffect(() => {
    if (!repoId) return;
    const sliced = commits.slice(0, MAX_COMMITS);
    for (const c of sliced) {
      if (!detailCache.has(c.hash)) {
        void (async () => {
          try {
            const detail = await getCommit(repoId, c.hash);
            setDetailCache((prev) => {
              if (prev.has(c.hash)) return prev;
              const next = new Map(prev);
              next.set(c.hash, detail);
              return next;
            });
          } catch {
            // Non-critical
          }
        })();
      }
    }
  }, [commits, repoId, detailCache]);

  // Build flat per-file entries (1 entry = 1 file change in 1 commit)
  const entries: StreamEntry[] = useMemo(() => {
    const result: StreamEntry[] = [];
    const sliced = commits.slice(0, MAX_COMMITS);
    for (const commit of sliced) {
      const detail = detailCache.get(commit.hash);
      if (!detail) continue;
      const shortHash = commit.shortHash ?? commit.hash.slice(0, 7);
      for (const file of detail.files) {
        const idx = file.path.lastIndexOf('/');
        result.push({
          id: `${commit.hash}::${file.path}`,
          commitHash: commit.hash,
          commitShortHash: shortHash,
          subject: commit.subject,
          author: commit.author,
          authorDate: detail.authorDate ?? commit.time,
          path: file.path,
          basename: idx === -1 ? file.path : file.path.slice(idx + 1),
          parentDir: idx === -1 ? '' : file.path.slice(0, idx),
          status: file.status,
          added: file.added ?? 0,
          deleted: file.deleted ?? 0,
        });
      }
    }
    return result;
  }, [commits, detailCache]);

  // Track first-seen timestamp per entry id
  useEffect(() => {
    const now = Date.now();
    let changed = false;
    for (const entry of entries) {
      if (!appearedAtRef.current.has(entry.id)) {
        appearedAtRef.current.set(entry.id, now);
        changed = true;
      }
    }
    if (changed) setTick((t) => t + 1);
  }, [entries]);

  // Heartbeat: re-render every second to expire NEW badges & refresh times
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Aggregated header summary
  const summary = useMemo(() => {
    const commitHashes = new Set<string>();
    let added = 0;
    let deleted = 0;
    for (const e of entries) {
      commitHashes.add(e.commitHash);
      added += e.added;
      deleted += e.deleted;
    }
    return {
      commits: commitHashes.size,
      changes: entries.length,
      added,
      deleted,
    };
  }, [entries]);

  if (commits.length === 0) {
    return <EmptyState message="No commits yet — waiting for activity…" />;
  }
  if (entries.length === 0) {
    return <EmptyState message="Loading commit details…" />;
  }

  const nowMs = Date.now();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--rs-bg-canvas)',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes rs-stream-pulse {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--rs-accent), transparent 50%); }
          50%      { box-shadow: 0 0 0 6px color-mix(in oklab, var(--rs-accent), transparent 100%); }
        }
        @keyframes rs-stream-slidein {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .rs-stream-row-new {
          animation: rs-stream-slidein 280ms ease-out;
        }
        .rs-stream-pulse-dot {
          animation: rs-stream-pulse 1.6s ease-out infinite;
        }
      `}</style>

      {/* Sticky summary header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid var(--rs-border)',
          background: 'var(--rs-bg-panel)',
          fontFamily: 'var(--rs-sans)',
          flexShrink: 0,
        }}
      >
        <span
          className="rs-stream-pulse-dot"
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: '#22c55e',
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--rs-text-primary)',
            letterSpacing: 0.3,
            textTransform: 'uppercase',
          }}
        >
          Live Stream
        </span>
        <div
          style={{
            width: 1,
            height: 14,
            background: 'var(--rs-border)',
            opacity: 0.6,
          }}
          aria-hidden="true"
        />
        <SummaryStat label="changes" value={summary.changes} />
        <SummaryStat label="commits" value={summary.commits} />
        <span style={{ display: 'inline-flex', gap: 6, fontSize: 12, fontFamily: 'var(--rs-mono)' }}>
          <span style={{ color: '#22c55e', fontWeight: 600 }}>+{summary.added.toLocaleString()}</span>
          <span style={{ color: '#ef4444', fontWeight: 600 }}>−{summary.deleted.toLocaleString()}</span>
        </span>
      </div>

      {/* Per-file entry feed */}
      <div
        role="list"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 14px 32px',
        }}
      >
        {entries.map((entry) => {
          const appearedAt = appearedAtRef.current.get(entry.id) ?? 0;
          const elapsed = nowMs - appearedAt;
          const isHighlighted = elapsed < HIGHLIGHT_MS;
          const isNewBadge = elapsed < NEW_BADGE_MS;
          const highlightAlpha = isHighlighted
            ? Math.max(0, 1 - elapsed / HIGHLIGHT_MS)
            : 0;
          const isSelected = entry.commitHash === selectedCommitHash;
          const sColor = statusColor(entry.status);

          return (
            <article
              key={entry.id}
              className={isHighlighted ? 'rs-stream-row-new' : undefined}
              role="listitem"
              aria-label={`${statusLabel(entry.status)} ${entry.path}`}
              onClick={() => onSelectCommit(entry.commitHash)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectCommit(entry.commitHash);
                }
              }}
              onContextMenu={(e) => {
                if (!onOpenFileHistory) return;
                e.preventDefault();
                setMenuState({
                  x: e.clientX,
                  y: e.clientY,
                  path: entry.path,
                });
              }}
              tabIndex={0}
              style={{
                flexShrink: 0,
                position: 'relative',
                display: 'flex',
                alignItems: 'stretch',
                gap: 12,
                marginBottom: 8,
                padding: '10px 12px 10px 14px',
                borderRadius: 8,
                border: '1px solid var(--rs-border)',
                background: 'var(--rs-bg-elevated)',
                boxShadow: isSelected
                  ? '0 0 0 1px var(--rs-accent), 0 1px 2px rgba(0,0,0,0.15)'
                  : isHighlighted
                  ? `0 0 0 1px color-mix(in oklab, transparent, var(--rs-accent) ${Math.round(
                      highlightAlpha * 60,
                    )}%), 0 4px 10px -2px color-mix(in oklab, transparent, var(--rs-accent) ${Math.round(
                      highlightAlpha * 25,
                    )}%)`
                  : '0 1px 2px rgba(0,0,0,0.06)',
                cursor: 'pointer',
                transition: 'box-shadow 320ms ease-out, border-color 320ms ease-out',
                outline: 'none',
                overflow: 'hidden',
              }}
            >
              {/* Left status stripe */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: 3,
                  background: sColor,
                  opacity: 0.85,
                }}
              />

              {/* Status badge — large left chip */}
              <span
                title={statusLabel(entry.status)}
                style={{
                  flexShrink: 0,
                  width: 40,
                  height: 40,
                  borderRadius: 6,
                  background: sColor,
                  color: 'white',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--rs-sans)',
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  alignSelf: 'center',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                }}
              >
                {entry.status || 'M'}
              </span>

              {/* Center content (2 rows) */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                {/* Row 1: path + NEW badge + diff stats */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: 'var(--rs-mono)',
                      fontSize: 13,
                      color: 'var(--rs-text-primary)',
                    }}
                    title={entry.path}
                  >
                    {entry.parentDir && (
                      <span style={{ color: 'var(--rs-text-secondary)', opacity: 0.7 }}>
                        {entry.parentDir}/
                      </span>
                    )}
                    <span style={{ fontWeight: 600 }}>{entry.basename}</span>
                  </span>

                  {isNewBadge && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 0.6,
                        padding: '2px 7px',
                        borderRadius: 999,
                        background: 'var(--rs-accent)',
                        color: 'white',
                        fontFamily: 'var(--rs-sans)',
                        textTransform: 'uppercase',
                      }}
                    >
                      New
                    </span>
                  )}

                  <DiffStats added={entry.added} deleted={entry.deleted} />
                </div>

                {/* Row 2: avatar + author + time + subject + hash */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    minWidth: 0,
                    fontSize: 11,
                    fontFamily: 'var(--rs-sans)',
                    color: 'var(--rs-text-secondary)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: authorColor(entry.author),
                      color: 'white',
                      fontFamily: 'var(--rs-sans)',
                      fontSize: 8,
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      letterSpacing: 0.3,
                    }}
                  >
                    {authorInitials(entry.author)}
                  </span>
                  <span
                    style={{
                      fontWeight: 500,
                      color: 'var(--rs-text-primary)',
                      flexShrink: 0,
                    }}
                  >
                    {entry.author}
                  </span>
                  <span aria-hidden="true" style={{ opacity: 0.4 }}>·</span>
                  <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {relativeTime(entry.authorDate)}
                  </span>
                  <span aria-hidden="true" style={{ opacity: 0.4 }}>·</span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={entry.subject}
                  >
                    {entry.subject}
                  </span>
                  <code
                    style={{
                      flexShrink: 0,
                      fontFamily: 'var(--rs-mono)',
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background:
                        'color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 8%)',
                      color: 'var(--rs-accent)',
                      border:
                        '1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 30%)',
                    }}
                  >
                    {entry.commitShortHash}
                  </code>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Right-click context menu */}
      <FileContextMenu
        open={menuState !== null}
        x={menuState?.x ?? 0}
        y={menuState?.y ?? 0}
        path={menuState?.path ?? null}
        onClose={() => setMenuState(null)}
        onOpenHistory={(p) => {
          onOpenFileHistory?.(p);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiffStats — +N [bar] -M
// ---------------------------------------------------------------------------
function DiffStats({ added, deleted }: { added: number; deleted: number }) {
  const total = added + deleted;
  if (total === 0) {
    return (
      <span
        style={{
          flexShrink: 0,
          fontSize: 11,
          fontFamily: 'var(--rs-mono)',
          color: 'var(--rs-text-secondary)',
          opacity: 0.6,
        }}
      >
        no diff
      </span>
    );
  }
  const addedRatio = added / total;
  const deletedRatio = deleted / total;
  // Bar width scales (log) with magnitude, capped 80px
  const barWidth = Math.min(80, Math.max(10, Math.log2(total + 1) * 14));

  return (
    <span
      aria-label={`+${added} -${deleted}`}
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--rs-mono)',
        fontSize: 11,
      }}
    >
      <span style={{ color: '#22c55e', minWidth: 32, textAlign: 'right', fontWeight: 600 }}>
        +{added}
      </span>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          width: barWidth,
          height: 6,
          borderRadius: 3,
          overflow: 'hidden',
          background: 'var(--rs-bg-canvas)',
          border: '1px solid var(--rs-border)',
        }}
      >
        <span
          style={{
            width: `${addedRatio * 100}%`,
            background: '#22c55e',
            transition: 'width 200ms ease-out',
          }}
        />
        <span
          style={{
            width: `${deletedRatio * 100}%`,
            background: '#ef4444',
            transition: 'width 200ms ease-out',
          }}
        />
      </span>
      <span style={{ color: '#ef4444', minWidth: 32, fontWeight: 600 }}>
        −{deleted}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// SummaryStat
// ---------------------------------------------------------------------------
function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 4,
        fontFamily: 'var(--rs-sans)',
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--rs-text-primary)',
          fontFamily: 'var(--rs-mono)',
        }}
      >
        {value.toLocaleString()}
      </span>
      <span style={{ fontSize: 11, color: 'var(--rs-text-secondary)' }}>{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--rs-text-secondary)',
        fontFamily: 'var(--rs-sans)',
        fontSize: 13,
        background: 'var(--rs-bg-canvas)',
      }}
    >
      {message}
    </div>
  );
}
