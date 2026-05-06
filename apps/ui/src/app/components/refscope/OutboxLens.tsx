/**
 * Outbox Lens — "まだ世界に出していない自分の差分" を 3 列カンバンで表示する。
 *
 * 列 1: Uncommitted — work-tree の未ステージ + ステージ済み変更
 * 列 2: Stashed      — git stash の一覧
 * 列 3: Ahead        — upstream より先行しているコミット
 *
 * 各列は top-50 でハードキャップ。3 列すべて空のときはプレースホルダを表示。
 * カードクリック:
 *   - Uncommitted → 既存 work-tree diff (onSelectCommit をクリア & lens='live' には戻さない)
 *   - Stash       → (現在は詳細表示なし、今後の拡張ポイント)
 *   - Ahead       → onSelectCommit(hash)
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  fetchWorkTree,
  fetchRefDrift,
  listCommits,
  listStashes,
  type WorkTreeResponse,
  type StashEntry,
} from '../../api';
import type { Commit } from './data';
import { RiskBadge } from './RiskBadge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summarised work-tree card (uncommitted column). */
type UncommittedCard = {
  kind: 'uncommitted';
  label: string;
  fileCount: number;
  added: number;
  deleted: number;
  /** ISO 8601 snapshot timestamp from the API */
  snapshotAt: string;
};

const CARD_CAP = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Try to find the main/master/trunk branch name from the drift refs. */
function estimateBase(refs: Array<{ name: string }>): string | null {
  const CANDIDATES = ['main', 'master', 'trunk'];
  for (const c of CANDIDATES) {
    if (refs.some((r) => r.name === c || r.name === `refs/heads/${c}`)) return c;
  }
  for (const c of CANDIDATES) {
    const remote = refs.find((r) => r.name.endsWith(`/${c}`));
    if (remote) return remote.name;
  }
  return refs[0]?.name ?? null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const COLUMN_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
};

const COLUMN_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 0 4px',
  fontSize: 11,
  fontFamily: 'var(--rs-sans)',
  fontWeight: 600,
  color: 'var(--rs-text-secondary)',
  borderBottom: '1px solid var(--rs-border)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

const CARD_STYLE: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 'var(--rs-radius-sm)',
  border: '1px solid var(--rs-border)',
  background: 'var(--rs-bg-elevated)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'var(--rs-sans)',
  color: 'var(--rs-text)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  transition: 'border-color 80ms ease-out, background 80ms ease-out',
};

const CARD_TITLE_STYLE: CSSProperties = {
  fontWeight: 500,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const CARD_META_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: 'var(--rs-text-secondary)',
  flexWrap: 'wrap' as const,
};

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 5px',
  height: 16,
  borderRadius: 9999,
  fontSize: 10,
  fontFamily: 'var(--rs-mono)',
  fontWeight: 600,
  background: 'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-text-secondary) 15%)',
  color: 'var(--rs-text-secondary)',
  border: '1px solid var(--rs-border)',
};

function ColumnHeader({
  icon,
  title,
  count,
  totalLoc,
}: {
  icon: string;
  title: string;
  count: number;
  totalLoc: number;
}) {
  return (
    <div style={COLUMN_HEADER_STYLE}>
      <span>{icon}</span>
      <span>{title}</span>
      <span style={{ ...BADGE_STYLE, marginLeft: 'auto' }}>
        {count} &nbsp;·&nbsp; ~{totalLoc} LOC
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uncommitted column
// ---------------------------------------------------------------------------

function UncommittedColumn({
  cards,
  onSelect,
}: {
  cards: UncommittedCard[];
  onSelect: () => void;
}) {
  const totalLoc = cards.reduce((s, c) => s + c.added + c.deleted, 0);
  return (
    <div style={COLUMN_STYLE}>
      <ColumnHeader icon="✏️" title="Uncommitted" count={cards.length} totalLoc={totalLoc} />
      {cards.length === 0 ? (
        <div style={{ padding: '16px 0', color: 'var(--rs-text-secondary)', fontSize: 12 }}>
          Working tree is clean.
        </div>
      ) : (
        cards.map((card, i) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            style={CARD_STYLE}
            onClick={onSelect}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
          >
            <div style={CARD_TITLE_STYLE}>{card.label}</div>
            <div style={CARD_META_STYLE}>
              <span>{card.fileCount} file{card.fileCount !== 1 ? 's' : ''}</span>
              <span style={{ color: 'var(--rs-git-added)' }}>+{card.added}</span>
              <span style={{ color: 'var(--rs-git-deleted)' }}>-{card.deleted}</span>
              <span style={{ marginLeft: 'auto' }}>{formatRelative(card.snapshotAt)}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stash column
// ---------------------------------------------------------------------------

function StashColumn({ stashes }: { stashes: StashEntry[] }) {
  const totalLoc = 0; // stash doesn't carry numstat in the list endpoint
  return (
    <div style={COLUMN_STYLE}>
      <ColumnHeader icon="📦" title="Stashed" count={stashes.length} totalLoc={totalLoc} />
      {stashes.length === 0 ? (
        <div style={{ padding: '16px 0', color: 'var(--rs-text-secondary)', fontSize: 12 }}>
          No stashes.
        </div>
      ) : (
        stashes.slice(0, CARD_CAP).map((s) => (
          <div key={s.hash} style={{ ...CARD_STYLE, cursor: 'default' }}>
            <div style={CARD_TITLE_STYLE}>{s.subject || s.name}</div>
            <div style={CARD_META_STYLE}>
              <span style={{ fontFamily: 'var(--rs-mono)' }}>{s.shortHash}</span>
              {s.committedAt && (
                <span style={{ marginLeft: 'auto' }}>{formatRelative(s.committedAt)}</span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ahead column
// ---------------------------------------------------------------------------

function AheadColumn({
  commits,
  aheadCount,
  onSelect,
}: {
  commits: Commit[];
  aheadCount: number;
  onSelect: (hash: string) => void;
}) {
  const totalLoc = commits.reduce((s, c) => s + (c.added ?? 0) + (c.deleted ?? 0), 0);
  return (
    <div style={COLUMN_STYLE}>
      <ColumnHeader icon="🚀" title="Ahead" count={aheadCount} totalLoc={totalLoc} />
      {commits.length === 0 ? (
        <div style={{ padding: '16px 0', color: 'var(--rs-text-secondary)', fontSize: 12 }}>
          Branch is up-to-date with upstream.
        </div>
      ) : (
        commits.slice(0, CARD_CAP).map((c) => (
          <div
            key={c.hash}
            role="button"
            tabIndex={0}
            style={CARD_STYLE}
            onClick={() => { onSelect(c.hash); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(c.hash); }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ ...CARD_TITLE_STYLE, flex: 1 }}>{c.subject}</span>
              {c.riskScore != null && c.riskScore > 0 && (
                <RiskBadge score={c.riskScore} />
              )}
            </div>
            <div style={CARD_META_STYLE}>
              <span style={{ fontFamily: 'var(--rs-mono)' }}>{c.shortHash ?? c.hash.slice(0, 7)}</span>
              {c.fileCount != null && (
                <span>{c.fileCount} file{c.fileCount !== 1 ? 's' : ''}</span>
              )}
              {(c.added != null || c.deleted != null) && (
                <>
                  <span style={{ color: 'var(--rs-git-added)' }}>+{c.added ?? 0}</span>
                  <span style={{ color: 'var(--rs-git-deleted)' }}>-{c.deleted ?? 0}</span>
                </>
              )}
              <span style={{ marginLeft: 'auto' }}>{c.time}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type OutboxLensProps = {
  repoId: string;
  refs: Array<{ name: string }>;
  onSelectCommit: (hash: string) => void;
  /** Navigate to the live lens (work-tree view) */
  onOpenWorktree: () => void;
};

type OutboxData = {
  uncommitted: UncommittedCard[];
  stashes: StashEntry[];
  aheadCommits: Commit[];
  aheadCount: number;
};

export function OutboxLens({ repoId, refs, onSelectCommit, onOpenWorktree }: OutboxLensProps) {
  const [data, setData] = useState<OutboxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        // Step 1: fetch worktree + stashes + drift in parallel
        const base = estimateBase(refs);
        const [worktree, stashes, drift] = await Promise.all([
          fetchWorkTree(repoId, signal),
          listStashes(repoId),
          base
            ? fetchRefDrift(repoId, { base, limit: 5 }, signal)
            : Promise.resolve(null),
        ]);

        if (signal.aborted) return;

        // Step 2: build uncommitted cards (max CARD_CAP combined)
        const uncommitted = buildUncommittedCards(worktree);

        // Step 3: find ahead count for current HEAD branch
        let aheadCount = 0;
        if (drift) {
          // Find the entry for HEAD or the current branch (first local branch ahead)
          const headEntry = drift.refs.find(
            (r) => r.type === 'branch' && r.ahead > 0,
          );
          aheadCount = headEntry?.ahead ?? 0;
        }

        // Step 4: fetch ahead commits if any
        let aheadCommits: Commit[] = [];
        if (aheadCount > 0) {
          const limit = Math.min(aheadCount + 5, CARD_CAP);
          const fetched = await listCommits(repoId, 'HEAD', '', '', '', 'subject', '', limit);
          if (!signal.aborted) {
            aheadCommits = fetched.slice(0, aheadCount);
          }
        }

        if (!signal.aborted) {
          setData({ uncommitted, stashes: stashes.slice(0, CARD_CAP), aheadCommits, aheadCount });
          setLoading(false);
        }
      } catch (err) {
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    },
    [repoId, refs],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); };
  }, [load]);

  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--rs-bg-panel)',
    color: 'var(--rs-text)',
    fontFamily: 'var(--rs-sans)',
    overflow: 'hidden',
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px 6px',
    borderBottom: '1px solid var(--rs-border)',
    fontSize: 12,
    color: 'var(--rs-text-secondary)',
    flexShrink: 0,
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>Outbox Lens — loading…</div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--rs-text-secondary)',
            fontSize: 13,
          }}
        >
          Scanning outbox…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>Outbox Lens</div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--rs-text-secondary)',
            fontSize: 13,
          }}
        >
          <span style={{ color: '#f87171' }}>Failed to load outbox data</span>
          <span style={{ fontSize: 11 }}>{error}</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isEmpty =
    data.uncommitted.length === 0 &&
    data.stashes.length === 0 &&
    data.aheadCount === 0;

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span>Outbox Lens</span>
        <button
          type="button"
          onClick={() => { void load(new AbortController().signal); }}
          style={{
            padding: '2px 8px',
            fontSize: 11,
            fontFamily: 'var(--rs-sans)',
            background: 'transparent',
            border: '1px solid var(--rs-border)',
            borderRadius: 'var(--rs-radius-sm)',
            color: 'var(--rs-text-secondary)',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {isEmpty ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--rs-text-secondary)',
            fontSize: 13,
          }}
        >
          Nothing to push or commit — outbox is clean.
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <UncommittedColumn
            cards={data.uncommitted}
            onSelect={onOpenWorktree}
          />
          <StashColumn stashes={data.stashes} />
          <AheadColumn
            commits={data.aheadCommits}
            aheadCount={data.aheadCount}
            onSelect={onSelectCommit}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build uncommitted cards from WorkTreeResponse
// ---------------------------------------------------------------------------

function buildUncommittedCards(worktree: WorkTreeResponse): UncommittedCard[] {
  const cards: UncommittedCard[] = [];

  const stagedFiles = worktree.staged.summary.fileCount;
  if (stagedFiles > 0) {
    cards.push({
      kind: 'uncommitted',
      label: 'Staged changes',
      fileCount: stagedFiles,
      added: worktree.staged.summary.added,
      deleted: worktree.staged.summary.deleted,
      snapshotAt: worktree.snapshotAt,
    });
  }

  const unstagedFiles = worktree.unstaged.summary.fileCount;
  if (unstagedFiles > 0) {
    cards.push({
      kind: 'uncommitted',
      label: 'Unstaged changes',
      fileCount: unstagedFiles,
      added: worktree.unstaged.summary.added,
      deleted: worktree.unstaged.summary.deleted,
      snapshotAt: worktree.snapshotAt,
    });
  }

  if (worktree.untracked && worktree.untracked.summary.fileCount > 0) {
    cards.push({
      kind: 'uncommitted',
      label: 'Untracked files',
      fileCount: worktree.untracked.summary.fileCount,
      added: worktree.untracked.summary.added,
      deleted: 0,
      snapshotAt: worktree.snapshotAt,
    });
  }

  return cards.slice(0, CARD_CAP);
}
