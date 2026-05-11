// FileStreamLens — ファイル変更を 1 行 1 カードの逆時系列ストリームで表示
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getCommit, type WorkTreeResponse } from '../../api';
import type { Commit, CommitDetail } from './data';
import { FileContextMenu } from './FileContextMenu';
import { extractWorkTreeFiles } from '../../lib/workTreeFiles';
import { classifyFile, colorForKind, labelForKind } from '../../lib/fileKind';
import { LensHeader } from './LensHeader';
import {
  EmptyStateCard,
  type EmptyStateMessage,
  type LensEmptyReason,
} from './EmptyStateCard';
import type { LensId } from './LensSwitcher';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/**
 * 観測対象とする最新コミットの上限。
 * UI にも露出 (`?` Popover) して観測窓を自己説明する。
 */
export const MAX_COMMITS = 30;
const HIGHLIGHT_MS = 6000;
const NEW_BADGE_MS = 3000;
// 同コミットの行を 1 つの「波」として連鎖スライドインさせる遅延ステップ。
const ECHO_STEP_MS = 80;
const ECHO_MAX_INDEX = 5;
// 新着 + 数値カウントアップを担当するアニメ窓。HIGHLIGHT_MS とは独立で短く。
const COUNTER_MS = 600;
// 新着が走っている間だけ高頻度で再描画してカウンターを滑らかに。
const FAST_TICK_MS = 60;
// Volley flash の時間窓。"3 ファイル以上が同コミットで同着" のセマンティクスを残し、
// 視覚刺激は弱化 (header 着色 9%、dot scale 1.2) して Calm 憲章に揃える。
const VOLLEY_FLASH_MS = 720;
/**
 * 同一コミットでこの件数以上が同時に飛び込んだら "Volley" 扱い。
 * UI にも露出して閾値の透明性を確保する。
 */
export const VOLLEY_THRESHOLD = 3;
// Live-rate sparkline — 直近 SPARKLINE_WINDOW_MS を SPARKLINE_BUCKETS 本の縦棒で
// 表示。最右が "now" バケット。Pulse の LivePulse と意味的にペア。
const SPARKLINE_BUCKETS = 6;
const SPARKLINE_WINDOW_MS = 30_000;

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
  isWorkingTree?: boolean;
};

const WORKING_TREE_HASH = 'WORKING-TREE';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusColor(status: string): string {
  switch (status) {
    case 'A': return 'var(--rs-git-added)';
    case 'D': return 'var(--rs-git-deleted)';
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

/** SR / aria-label 用の日本語ラベル。視覚は ASCII 1 文字バッジを維持。 */
function statusLabelJa(status: string): string {
  switch (status) {
    case 'A': return '追加';
    case 'D': return '削除';
    case 'R': return '名前変更';
    case 'M': return '変更';
    default:  return status || '変更';
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

// Commit-hash 由来のリング色。同一コミットに属する行を新着リングで束ねる際に
// 「このコミットの色」が一目で分かるようにする (Commit Echo の縁取り)。
function commitRingColor(hash: string): string {
  if (hash === WORKING_TREE_HASH) return 'var(--rs-accent)';
  let h = 0;
  for (let i = 0; i < hash.length; i++) {
    h = (h * 31 + hash.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(h) % 360}, 70%, 60%)`;
}

// OS の reduced-motion 設定を React state として観測。Quiet モードと同様、
// カウントアップ・トラベラー・連鎖遅延を無効化する判断に使う。
function usePrefersReducedMotion(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setV(m.matches);
    const handler = () => setV(m.matches);
    m.addEventListener('change', handler);
    return () => m.removeEventListener('change', handler);
  }, []);
  return v;
}

// ---------------------------------------------------------------------------
// Self-explanation content (LensHeader / EmptyStateCard)
// ---------------------------------------------------------------------------
const STREAM_EMPTY_MESSAGES: Partial<Record<LensEmptyReason, EmptyStateMessage>> = {
  'no-commits': {
    title: 'まだ観測できるコミットがありません',
    body: 'この Lens は直近のコミットを 1 行 1 件で逆時系列に表示します。コミットが入ると自動でここに流れてきます。',
  },
};

function StreamHelpContent() {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--rs-text)' }}>
        Stream Lens の見方
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        直近{' '}
        <span style={{ fontFamily: 'var(--rs-mono)' }}>{MAX_COMMITS}</span>{' '}
        コミットの変更ファイルを 1 行 1 件で表示します。新着は薄く強調され、
        数秒で落ち着きます。
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        左バッジ (status)
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--rs-mono)' }}>A</span> 追加 ·{' '}
        <span style={{ fontFamily: 'var(--rs-mono)' }}>M</span> 変更 ·{' '}
        <span style={{ fontFamily: 'var(--rs-mono)' }}>D</span> 削除 ·{' '}
        <span style={{ fontFamily: 'var(--rs-mono)' }}>R</span> 名前変更
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        小さな丸 (kind)
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        ファイル種別を Pulse と共通の色語彙で示します
        (Code / Test / Doc / Config / Build / Asset / Other)。
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        ヘッダ
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        左の緑ドットは観測継続中の証。隣の縦棒列は直近{' '}
        <span style={{ fontFamily: 'var(--rs-mono)' }}>30s</span> の流量
        (Pulse と同じ語彙)。同コミットで{' '}
        <span style={{ fontFamily: 'var(--rs-mono)' }}>{VOLLEY_THRESHOLD}</span>{' '}
        ファイル以上が同着するとヘッダが一瞬色付きします (Volley)。
      </div>
      <div style={{ color: 'var(--rs-text-muted)', fontSize: 11 }}>
        observation only — refscope は書き込み操作を行いません。
      </div>
    </>
  );
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
  workTree?: WorkTreeResponse | null;
  /** 兄弟 Lens への遷移コールバック (EmptyStateCard.relatedLenses で利用) */
  onChangeLens?: (lens: LensId) => void;
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
  workTree,
  onChangeLens,
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

  // Working tree → virtual entries (always at the top)
  const workTreeEntries: StreamEntry[] = useMemo(() => {
    const files = extractWorkTreeFiles(workTree);
    if (files.length === 0) return [];
    const snapshotAt = workTree?.snapshotAt ?? new Date().toISOString();
    return files.map((f, i) => ({
      id: `wt::${f.section}::${f.path}::${i}`,
      commitHash: WORKING_TREE_HASH,
      commitShortHash: f.section === 'staged' ? 'STAGED' : 'UNSTAGED',
      subject:
        f.section === 'staged'
          ? 'Staged (uncommitted)'
          : 'Unstaged (uncommitted)',
      author: 'Working tree',
      authorDate: snapshotAt,
      path: f.path,
      basename: f.basename,
      parentDir: f.parentDir,
      status: f.status,
      added: f.added,
      deleted: f.deleted,
      isWorkingTree: true,
    }));
  }, [workTree]);

  // Combined feed: working tree entries pinned at top, then commit entries
  const allEntries = useMemo(
    () => [...workTreeEntries, ...entries],
    [workTreeEntries, entries],
  );

  // Track first-seen timestamp per entry id
  useEffect(() => {
    const now = Date.now();
    let changed = false;
    for (const entry of allEntries) {
      if (!appearedAtRef.current.has(entry.id)) {
        appearedAtRef.current.set(entry.id, now);
        changed = true;
      }
    }
    if (changed) setTick((t) => t + 1);
  }, [allEntries]);

  // Heartbeat: re-render every second to expire NEW badges & refresh times
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Fast tick: while any entry is inside its COUNTER_MS window, re-render at
  // FAST_TICK_MS to drive the +/- count-up and the time-belt traveler. The
  // interval self-stops once the burst expires so we don't keep ticking when
  // nothing is animating.
  useEffect(() => {
    let latest = 0;
    for (const a of appearedAtRef.current.values()) {
      if (a > latest) latest = a;
    }
    if (latest === 0 || Date.now() - latest > COUNTER_MS) return;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      let l = 0;
      for (const a of appearedAtRef.current.values()) {
        if (a > l) l = a;
      }
      if (Date.now() - l > COUNTER_MS) {
        window.clearInterval(id);
      }
    }, FAST_TICK_MS);
    return () => window.clearInterval(id);
  }, [allEntries]);

  // Per-commit echo index: ordering each commit's entries by their first-seen
  // time so we can stagger their slide-in (Commit Echo). Working-tree entries
  // each form their own group so the staging vs unstaged sections still echo
  // together but not against commit hashes.
  const echoIndexById = useMemo(() => {
    const grouped = new Map<string, Array<{ id: string; t: number }>>();
    for (const e of allEntries) {
      const key = e.isWorkingTree ? `wt::${e.commitShortHash}` : e.commitHash;
      const t = appearedAtRef.current.get(e.id) ?? 0;
      const arr = grouped.get(key);
      if (arr) arr.push({ id: e.id, t });
      else grouped.set(key, [{ id: e.id, t }]);
    }
    const result = new Map<string, number>();
    for (const arr of grouped.values()) {
      arr.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
      arr.forEach((it, idx) => {
        result.set(it.id, Math.min(idx, ECHO_MAX_INDEX));
      });
    }
    return result;
  }, [allEntries]);

  const reducedMotion = usePrefersReducedMotion();

  // Snapshot of all first-seen timestamps. Recomputed only when entries change;
  // fed into LiveRateSparkline so the bucket math stays cheap on heartbeats.
  const liveTimestamps = useMemo(
    () => Array.from(appearedAtRef.current.values()),
    [allEntries],
  );

  // Volley detection — when the latest burst delivered ≥ VOLLEY_THRESHOLD files
  // from a single commit, surface that as a header "Ding" (commit ring color +
  // pulsing background). Reset key (`volleyKey`) is a stable per-burst id so
  // React replays the keyframe only when a new volley actually lands.
  const volley = useMemo(() => {
    if (reducedMotion) return null;
    let latest = 0;
    for (const a of appearedAtRef.current.values()) {
      if (a > latest) latest = a;
    }
    if (latest === 0) return null;
    if (Date.now() - latest > VOLLEY_FLASH_MS) return null;
    const counts = new Map<string, number>();
    for (const e of allEntries) {
      if (e.isWorkingTree) continue;
      const t = appearedAtRef.current.get(e.id) ?? 0;
      // Treat anything within 250ms of the latest as the same burst.
      if (latest - t > 250) continue;
      counts.set(e.commitHash, (counts.get(e.commitHash) ?? 0) + 1);
    }
    let best: { hash: string; count: number } | null = null;
    for (const [hash, count] of counts) {
      if (count >= VOLLEY_THRESHOLD && (!best || count > best.count)) {
        best = { hash, count };
      }
    }
    if (!best) return null;
    return {
      key: `${best.hash}:${latest}`,
      ringColor: commitRingColor(best.hash),
      count: best.count,
    };
  }, [allEntries, reducedMotion]);

  // Aggregated header summary
  const summary = useMemo(() => {
    const commitHashes = new Set<string>();
    let added = 0;
    let deleted = 0;
    for (const e of allEntries) {
      if (e.commitHash !== WORKING_TREE_HASH) commitHashes.add(e.commitHash);
      added += e.added;
      deleted += e.deleted;
    }
    return {
      commits: commitHashes.size,
      changes: allEntries.length,
      added,
      deleted,
    };
  }, [allEntries]);

  if (allEntries.length === 0) {
    if (commits.length === 0) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            background: 'var(--rs-bg-canvas)',
          }}
        >
          <LensHeader
            title="Stream"
            oneLiner="ファイル変更を 1 行 1 件で逆時系列に観測する"
            helpContent={<StreamHelpContent />}
          />
          <EmptyStateCard
            reason="no-commits"
            messages={STREAM_EMPTY_MESSAGES}
            onChangeLens={onChangeLens}
            relatedLenses={[
              { id: 'pulse', label: 'Pulse を見る' },
              { id: 'live', label: 'Live を見る' },
            ]}
          />
        </div>
      );
    }
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
          animation: rs-stream-slidein 280ms ease-out both;
        }
        .rs-stream-pulse-dot {
          animation: rs-stream-pulse 1.6s ease-out infinite;
        }
        .rs-stream-stripe {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          width: 5px;
          overflow: hidden;
          pointer-events: none;
        }
        .rs-stream-row:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--rs-accent), 0 1px 2px rgba(0,0,0,0.15);
        }
        @keyframes rs-stream-header-flash {
          0%   { background-color: var(--rs-bg-panel); }
          18%  { background-color: color-mix(in oklab, var(--rs-bg-panel), var(--rs-volley-color, var(--rs-accent)) 9%); }
          100% { background-color: var(--rs-bg-panel); }
        }
        @keyframes rs-stream-dot-flash {
          0%   { transform: scale(1); }
          22%  { transform: scale(1.2); box-shadow: 0 0 0 4px color-mix(in oklab, var(--rs-volley-color, var(--rs-accent)), transparent 60%); }
          100% { transform: scale(1); }
        }
        .rs-stream-header--volley {
          animation: rs-stream-header-flash ${VOLLEY_FLASH_MS}ms ease-out 1;
        }
        .rs-stream-header--volley .rs-stream-pulse-dot {
          animation: rs-stream-dot-flash ${VOLLEY_FLASH_MS}ms ease-out 1, rs-stream-pulse 1.6s ease-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .rs-stream-row-new,
          .rs-stream-pulse-dot,
          .rs-stream-header--volley,
          .rs-stream-header--volley .rs-stream-pulse-dot {
            animation: none !important;
          }
        }
      `}</style>

      {/* Row 1: LensHeader (title + oneLiner + ? Popover) */}
      <LensHeader
        title="Stream"
        oneLiner="ファイル変更を 1 行 1 件で逆時系列に観測する"
        helpContent={<StreamHelpContent />}
      />

      {/* Row 2: Sticky summary stats bar */}
      <div
        key={volley?.key ?? 'idle'}
        className={volley ? 'rs-stream-header--volley' : undefined}
        role="status"
        aria-live="polite"
        aria-label={
          volley
            ? `同コミットで ${volley.count} ファイル同着`
            : `観測中: ${summary.changes} 件 / ${summary.commits} コミット`
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px 10px',
          borderBottom: '1px solid var(--rs-border)',
          background: 'var(--rs-bg-panel)',
          fontFamily: 'var(--rs-sans)',
          flexShrink: 0,
          ...(volley
            ? ({ ['--rs-volley-color' as string]: volley.ringColor } as CSSProperties)
            : {}),
        }}
      >
        <span
          className="rs-stream-pulse-dot"
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: 'var(--rs-git-added)',
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        <span
          title="観測中。SSE で新着を受信中"
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
        <span
          title="直近 30 秒の入着件数 (6 バケット)"
          style={{ display: 'inline-flex', alignItems: 'center' }}
        >
          <LiveRateSparkline timestamps={liveTimestamps} nowMs={nowMs} />
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
        <SummaryStat
          label="changes"
          value={summary.changes}
          title={`${summary.changes} 件のファイル変更を表示中`}
        />
        <SummaryStat
          label={`commits / ${MAX_COMMITS} max`}
          value={summary.commits}
          title={`直近 ${MAX_COMMITS} コミットを観測中`}
        />
        <span style={{ display: 'inline-flex', gap: 6, fontSize: 12, fontFamily: 'var(--rs-mono)' }}>
          <span
            style={{ color: 'var(--rs-git-added)', fontWeight: 600 }}
            title="追加行の合計"
          >
            +{summary.added.toLocaleString()}
          </span>
          <span
            style={{ color: 'var(--rs-git-deleted)', fontWeight: 600 }}
            title="削除行の合計"
          >
            −{summary.deleted.toLocaleString()}
          </span>
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
        {allEntries.map((entry) => {
          const appearedAt = appearedAtRef.current.get(entry.id) ?? 0;
          const elapsed = nowMs - appearedAt;
          const isHighlighted = elapsed < HIGHLIGHT_MS;
          const isNewBadge = elapsed < NEW_BADGE_MS;
          const highlightAlpha = isHighlighted
            ? Math.max(0, 1 - elapsed / HIGHLIGHT_MS)
            : 0;
          const isSelected =
            !entry.isWorkingTree && entry.commitHash === selectedCommitHash;
          const sColor = statusColor(entry.status);
          const ringColor = commitRingColor(entry.commitHash);
          const echoIdx = echoIndexById.get(entry.id) ?? 0;
          const echoDelayMs = reducedMotion ? 0 : echoIdx * ECHO_STEP_MS;
          const kind = classifyFile(entry.path);
          const kindColor = colorForKind(kind);
          const kindLabel = labelForKind(kind);

          return (
            <article
              key={entry.id}
              data-hoverable={entry.isWorkingTree ? '0' : '1'}
              className={
                'rs-stream-row' + (isHighlighted ? ' rs-stream-row-new' : '')
              }
              role="listitem"
              aria-label={`${statusLabelJa(entry.status)}: ${entry.path} — ${entry.subject} (${entry.commitShortHash})`}
              onClick={() => {
                if (entry.isWorkingTree) return;
                onSelectCommit(entry.commitHash);
              }}
              onKeyDown={(e) => {
                if (entry.isWorkingTree) return;
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
                padding: '10px 12px 10px 16px',
                borderRadius: 8,
                border: '1px solid var(--rs-border)',
                background: 'var(--rs-bg-elevated)',
                boxShadow: isSelected
                  ? '0 0 0 1px var(--rs-accent), 0 1px 2px rgba(0,0,0,0.15)'
                  : isHighlighted
                  ? `0 0 0 1px color-mix(in oklab, transparent, ${ringColor} ${Math.round(
                      highlightAlpha * 70,
                    )}%), 0 4px 12px -2px color-mix(in oklab, transparent, ${ringColor} ${Math.round(
                      highlightAlpha * 30,
                    )}%)`
                  : '0 1px 2px rgba(0,0,0,0.06)',
                cursor: entry.isWorkingTree ? 'default' : 'pointer',
                transition: 'box-shadow 320ms ease-out, border-color 320ms ease-out',
                overflow: 'hidden',
                animationDelay: echoDelayMs > 0 ? `${echoDelayMs}ms` : undefined,
              } as CSSProperties}
            >
              {/* Time Belt — vertical stripe encoding status (color) and
                  time flow (top→bottom fade). */}
              <div className="rs-stream-stripe" aria-hidden="true">
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: `linear-gradient(to bottom, ${sColor} 0%, color-mix(in oklab, ${sColor}, transparent 55%) 100%)`,
                    opacity: 0.9,
                  }}
                />
              </div>

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
                {/* Row 1: kind dot + path + NEW badge + diff stats */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    minWidth: 0,
                  }}
                >
                  {/* Kind signature — Pulse と共通の色語彙 (Code/Test/Doc 等)。
                      意味は row の aria-label に統合済なので装飾扱い。 */}
                  <span
                    aria-hidden="true"
                    title={kindLabel}
                    style={{
                      flexShrink: 0,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: kindColor,
                      boxShadow: `0 0 0 2px color-mix(in oklab, ${kindColor}, transparent 75%)`,
                    }}
                  />

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

                  <DiffStats
                    added={entry.added}
                    deleted={entry.deleted}
                    appearedAt={appearedAt}
                    nowMs={nowMs}
                    reducedMotion={reducedMotion}
                  />
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
                      background: entry.isWorkingTree
                        ? 'color-mix(in oklab, var(--rs-bg-canvas), #f59e0b 14%)'
                        : 'color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 8%)',
                      color: entry.isWorkingTree ? '#f59e0b' : 'var(--rs-accent)',
                      border: entry.isWorkingTree
                        ? '1px solid color-mix(in oklab, var(--rs-border), #f59e0b 40%)'
                        : '1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 30%)',
                      fontWeight: entry.isWorkingTree ? 700 : 400,
                      letterSpacing: entry.isWorkingTree ? 0.4 : 0,
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

      {/* Screen-reader live region — 視覚的非表示 ul に直近 5 件を流す。
          Pulse Lens と同じ規格で SR ユーザにも新着が伝わるようにする。 */}
      <ul
        role="status"
        aria-live="polite"
        aria-label="直近の変更"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {allEntries.slice(0, 5).map((entry) => (
          <li key={entry.id}>
            {statusLabelJa(entry.status)}: {entry.path} (
            {entry.isWorkingTree ? '作業ツリー' : entry.commitShortHash})
          </li>
        ))}
      </ul>

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
// DiffStats — +N [bar] -M, with optional 0→N count-up on first appearance.
// ---------------------------------------------------------------------------
function DiffStats({
  added,
  deleted,
  appearedAt,
  nowMs,
  reducedMotion,
}: {
  added: number;
  deleted: number;
  appearedAt?: number;
  nowMs?: number;
  reducedMotion?: boolean;
}) {
  const total = added + deleted;

  // Count-up phase: 0 → 1 over COUNTER_MS from first-seen timestamp. Outside
  // the window (or when reduced-motion is on) the bar reads its true value.
  const phase = (() => {
    if (reducedMotion) return 1;
    if (!appearedAt || !nowMs) return 1;
    const elapsed = nowMs - appearedAt;
    if (elapsed >= COUNTER_MS) return 1;
    if (elapsed <= 0) return 0;
    return elapsed / COUNTER_MS;
  })();
  const dispAdded = Math.round(added * phase);
  const dispDeleted = Math.round(deleted * phase);

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
      <span style={{ color: 'var(--rs-git-added)', minWidth: 32, textAlign: 'right', fontWeight: 600 }}>
        +{dispAdded}
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
            width: `${addedRatio * 100 * phase}%`,
            background: 'var(--rs-git-added)',
            transition: 'width 200ms ease-out',
          }}
        />
        <span
          style={{
            width: `${deletedRatio * 100 * phase}%`,
            background: 'var(--rs-git-deleted)',
            transition: 'width 200ms ease-out',
          }}
        />
      </span>
      <span style={{ color: 'var(--rs-git-deleted)', minWidth: 32, fontWeight: 600 }}>
        −{dispDeleted}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// LiveRateSparkline — 直近 30 秒の入着件数を 6 本の縦棒で見せるミニチャート。
// Pulse の LivePulse と語彙を共有する Stream 側の "脈拍" 表示。
// ---------------------------------------------------------------------------
function LiveRateSparkline({
  timestamps,
  nowMs,
}: {
  timestamps: number[];
  nowMs: number;
}) {
  const counts = useMemo(() => {
    const bucketMs = SPARKLINE_WINDOW_MS / SPARKLINE_BUCKETS;
    const arr = new Array(SPARKLINE_BUCKETS).fill(0) as number[];
    for (const t of timestamps) {
      const age = nowMs - t;
      if (age < 0 || age >= SPARKLINE_WINDOW_MS) continue;
      const idx = SPARKLINE_BUCKETS - 1 - Math.floor(age / bucketMs);
      if (idx >= 0 && idx < SPARKLINE_BUCKETS) arr[idx]++;
    }
    return arr;
  }, [timestamps, nowMs]);

  const maxCount = Math.max(1, ...counts);
  const total = counts.reduce((s, c) => s + c, 0);

  return (
    <span
      role="img"
      aria-label={`${total} change${total === 1 ? '' : 's'} in the last 30 seconds`}
      title={`${total} change${total === 1 ? '' : 's'} / 30s`}
      style={{
        display: 'inline-flex',
        alignItems: 'flex-end',
        gap: 2,
        height: 16,
      }}
    >
      {counts.map((c, i) => {
        const ratio = c / maxCount;
        const h = c === 0 ? 2 : Math.max(3, Math.round(ratio * 14));
        const isLatest = i === SPARKLINE_BUCKETS - 1;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              width: 3,
              height: h,
              borderRadius: 1,
              background:
                c === 0
                  ? 'var(--rs-border)'
                  : isLatest
                    ? 'var(--rs-accent)'
                    : 'color-mix(in oklab, var(--rs-text-secondary), transparent 30%)',
              opacity: c === 0 ? 0.55 : isLatest ? 1 : 0.85,
              transition: 'height 200ms ease-out, background 200ms ease-out',
            }}
          />
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SummaryStat
// ---------------------------------------------------------------------------
function SummaryStat({
  label,
  value,
  title,
}: {
  label: string;
  value: number;
  title?: string;
}) {
  return (
    <span
      title={title}
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
