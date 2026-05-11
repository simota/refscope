/**
 * Outbox Lens — "まだ世界に出していない自分の差分" を 3 列カンバンで表示する。
 *
 * 列 1: Uncommitted — work-tree の未ステージ + ステージ済み変更
 * 列 2: Stashed      — git stash の一覧 (現状クリック不可: Phase 2 で詳細表示予定)
 * 列 3: Ahead        — HEAD ブランチが upstream より先行しているコミット
 *
 * 各列は CARD_CAP (50) でハードキャップ。3 列すべて空のときは EmptyStateCard。
 * カードクリック:
 *   - Uncommitted → onOpenWorktree (Live Lens の work-tree diff へ)
 *   - Stash       → クリック不可 (refs/stash@{N} は API validation で拒否される設計)
 *   - Ahead       → onSelectCommit(hash)
 *
 * a11y: 絵文字に aria-hidden、カードに focus ring、Stash カードに aria-disabled。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  fetchWorkTree,
  fetchBranchGroupHealth,
  listCommits,
  listStashes,
  type WorkTreeResponse,
  type StashEntry,
} from '../../api';
import type { Commit } from './data';
import { LensHeader } from './LensHeader';
import {
  EmptyStateCard,
  type LensEmptyReason,
  type EmptyStateMessage,
} from './EmptyStateCard';
import { ROT_SCORE_COLORS } from './BranchSidebar';
import { estimateBase } from './refUtil';
import type { LensId } from './LensSwitcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summarised work-tree card (uncommitted column). */
type UncommittedKind = 'staged' | 'unstaged' | 'untracked';

type UncommittedCard = {
  kind: 'uncommitted';
  subKind: UncommittedKind;
  label: string;
  fileCount: number;
  added: number;
  deleted: number;
  /** ISO 8601 snapshot timestamp from the API */
  snapshotAt: string;
};

/** Map an uncommitted card kind to a left-edge stripe color (Spark 14-B). */
function uncommittedStripeColor(kind: UncommittedKind): string {
  switch (kind) {
    case 'staged':
      return 'var(--rs-accent)';
    case 'unstaged':
      return 'var(--rs-warning)';
    case 'untracked':
      return 'var(--rs-text-muted)';
  }
}

const CARD_CAP = 50;

/** Outbox 固有の空状態理由。EmptyStateCard へキャストして渡す。 */
type OutboxEmptyReason = 'outbox-clean' | 'outbox-error';

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

// ---------------------------------------------------------------------------
// riskScore thresholds (Spark 14-A / 14-D)
// ---------------------------------------------------------------------------

/** riskScore ≥ HIGH → critical 色 */
const RISK_HIGH_THRESHOLD = 50;
/** riskScore ≥ LOW → warning 色 */
const RISK_LOW_THRESHOLD = 1;

/** stash daysSinceLast ≥ WARN → warning 色、≥ CRIT → danger 色 */
const STASH_WARN_DAYS = 30;
const STASH_CRIT_DAYS = 90;

function riskBadgeStyle(score: number): CSSProperties | null {
  if (score < RISK_LOW_THRESHOLD) return null;
  const color =
    score >= RISK_HIGH_THRESHOLD
      ? ROT_SCORE_COLORS.critical
      : ROT_SCORE_COLORS.warning;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 5px',
    height: 14,
    borderRadius: 4,
    fontSize: 9,
    fontFamily: 'var(--rs-mono)',
    fontWeight: 600,
    background: `color-mix(in oklab, var(--rs-bg-elevated), ${color} 25%)`,
    color,
    border: `1px solid ${color}`,
  };
}

function stashAgeColor(committedAt: string | null | undefined): string {
  if (!committedAt) return 'var(--rs-text-secondary)';
  const days = Math.floor((Date.now() - Date.parse(committedAt)) / 86_400_000);
  if (!Number.isFinite(days)) return 'var(--rs-text-secondary)';
  if (days >= STASH_CRIT_DAYS) return ROT_SCORE_COLORS.critical;
  if (days >= STASH_WARN_DAYS) return ROT_SCORE_COLORS.warning;
  return 'var(--rs-text-secondary)';
}

// ---------------------------------------------------------------------------
// Help content for LensHeader
// ---------------------------------------------------------------------------

function OutboxHelpContent(): ReactNode {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--rs-text)' }}>
        Outbox Lens とは
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        「まだ世界に出していない自分の差分」を 3 種類に分けて一覧します。
        commit / stash pop / push という<strong>異なる出口</strong>を持つ作業を、
        同じカンバンで見渡せます。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        3 列の意味
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8, lineHeight: 1.7 }}>
        ・<strong>Uncommitted</strong>: 未ステージ・ステージ済み・未追跡の変更
        (出口: <code>git commit</code>)<br />
        ・<strong>Stashed</strong>: <code>git stash</code> で一時退避中のスナップショット
        (出口: <code>git stash pop / apply</code>)<br />
        ・<strong>Ahead</strong>: <strong>HEAD ブランチ</strong>が upstream より先行している
        コミット (出口: <code>git push</code>)
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        バッジ・色の読み方
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8, lineHeight: 1.7 }}>
        ・件数バッジ (例: <code>3</code>) はその列のカード数を表します<br />
        ・<code>±N lines</code> は added + deleted の合計行数 (Stash は API で取得不可のため非表示)<br />
        ・Uncommitted の左端カラー: <span style={{ color: 'var(--rs-accent)' }}>accent=staged</span> ·
        {' '}<span style={{ color: 'var(--rs-warning)' }}>warning=unstaged</span> ·
        {' '}<span style={{ color: 'var(--rs-text-muted)' }}>muted=untracked</span><br />
        ・Ahead カードの右上 riskScore バッジ:
        {' '}<span style={{ color: ROT_SCORE_COLORS.warning }}>warning (1–{RISK_HIGH_THRESHOLD - 1})</span> ·
        {' '}<span style={{ color: ROT_SCORE_COLORS.critical }}>critical (≥{RISK_HIGH_THRESHOLD})</span><br />
        ・Stash の経過時間色:
        {' '}<span style={{ color: ROT_SCORE_COLORS.warning }}>{STASH_WARN_DAYS}d 経過で warning</span> ·
        {' '}<span style={{ color: ROT_SCORE_COLORS.critical }}>{STASH_CRIT_DAYS}d 経過で critical</span><br />
        ・各列は <strong>{CARD_CAP}</strong> 件で打ち切り。超過時は警告バナーを表示します
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        操作
      </div>
      <div style={{ color: 'var(--rs-text-secondary)' }}>
        ・<strong>Uncommitted</strong> カード → Live Lens の work-tree diff に遷移<br />
        ・<strong>Stash</strong> カード → 現在クリック不可 (詳細表示は Phase 2 で対応予定)<br />
        ・<strong>Ahead</strong> カード → そのコミットを選択 (DetailPanel に表示)
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state messages
// ---------------------------------------------------------------------------

const OUTBOX_EMPTY_MESSAGES: Partial<Record<LensEmptyReason, EmptyStateMessage>> = {
  ['outbox-clean' as LensEmptyReason]: {
    title: 'Outbox はクリーンです',
    body:
      '未コミット変更・stash・未 push のコミットいずれもありません。次の作業を始めるか、Drift Lens でブランチ全体の状況を確認してください。',
  },
};

// ---------------------------------------------------------------------------
// Styles
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
  outline: 'none',
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
  showLoc = true,
}: {
  icon: string;
  title: string;
  count: number;
  totalLoc: number;
  showLoc?: boolean;
}) {
  return (
    <div style={COLUMN_HEADER_STYLE}>
      <span aria-hidden="true">{icon}</span>
      <span>{title}</span>
      <span style={{ ...BADGE_STYLE, marginLeft: 'auto' }}>
        {showLoc ? `${count} · ±${totalLoc} lines` : `${count}`}
      </span>
    </div>
  );
}

function TruncationFooter({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <div
      role="status"
      style={{
        padding: '6px 8px',
        fontSize: 10,
        fontFamily: 'var(--rs-sans)',
        color: '#b45309',
        background: 'color-mix(in oklab, var(--rs-bg-elevated), #b45309 12%)',
        border: '1px solid #b45309',
        borderRadius: 'var(--rs-radius-sm)',
        textAlign: 'center',
      }}
    >
      ⚠ +{total - shown} more (truncated to {shown})
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
            className="rs-outbox-card"
            aria-label={
              `${card.label}: ${card.fileCount} file${card.fileCount !== 1 ? 's' : ''}, ` +
              `+${card.added}, -${card.deleted}. Enter で work-tree diff を開く`
            }
            style={{
              ...CARD_STYLE,
              borderLeft: `3px solid ${uncommittedStripeColor(card.subKind)}`,
            }}
            onClick={onSelect}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
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
  const shown = stashes.slice(0, CARD_CAP);
  return (
    <div style={COLUMN_STYLE}>
      <ColumnHeader
        icon="📦"
        title="Stashed"
        count={stashes.length}
        totalLoc={0}
        showLoc={false}
      />
      {stashes.length === 0 ? (
        <div style={{ padding: '16px 0', color: 'var(--rs-text-secondary)', fontSize: 12 }}>
          No stashes.
        </div>
      ) : (
        <>
          {shown.map((s) => {
            const ageColor = stashAgeColor(s.committedAt);
            return (
              <div
                key={s.hash}
                role="button"
                aria-disabled="true"
                aria-label={
                  `${s.subject || s.name} (${s.shortHash}). 詳細表示は Phase 2 で対応予定`
                }
                title="Stash 詳細表示は Phase 2 で対応予定"
                style={{
                  ...CARD_STYLE,
                  cursor: 'not-allowed',
                  opacity: 0.85,
                }}
              >
                <div style={CARD_TITLE_STYLE}>{s.subject || s.name}</div>
                <div style={CARD_META_STYLE}>
                  <span style={{ fontFamily: 'var(--rs-mono)' }}>{s.shortHash}</span>
                  {s.committedAt && (
                    <span style={{ marginLeft: 'auto', color: ageColor }}>
                      {formatRelative(s.committedAt)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          <TruncationFooter shown={shown.length} total={stashes.length} />
        </>
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
  const shown = commits.slice(0, CARD_CAP);
  const highRiskCount = commits.filter(
    (c) => (c.riskScore ?? 0) >= RISK_HIGH_THRESHOLD,
  ).length;
  return (
    <div style={COLUMN_STYLE}>
      <ColumnHeader icon="🚀" title="Ahead" count={aheadCount} totalLoc={totalLoc} />
      {commits.length === 0 ? (
        <div style={{ padding: '16px 0', color: 'var(--rs-text-secondary)', fontSize: 12 }}>
          Branch is up-to-date with upstream.
        </div>
      ) : (
        <>
          {highRiskCount > 0 && (
            <div
              role="status"
              style={{
                padding: '6px 8px',
                fontSize: 10,
                fontFamily: 'var(--rs-sans)',
                color: ROT_SCORE_COLORS.critical,
                background: `color-mix(in oklab, var(--rs-bg-elevated), ${ROT_SCORE_COLORS.critical} 12%)`,
                border: `1px solid ${ROT_SCORE_COLORS.critical}`,
                borderRadius: 'var(--rs-radius-sm)',
              }}
            >
              ⚠ 高リスクコミットが <strong>{highRiskCount}</strong> 件含まれます
              (riskScore ≥ {RISK_HIGH_THRESHOLD})
            </div>
          )}
          {shown.map((c) => {
            const score = c.riskScore ?? 0;
            const badgeStyle = riskBadgeStyle(score);
            return (
              <div
                key={c.hash}
                role="button"
                tabIndex={0}
                className="rs-outbox-card"
                aria-label={
                  `Commit ${c.shortHash ?? c.hash.slice(0, 7)}: ${c.subject}. ` +
                  `+${c.added ?? 0}, -${c.deleted ?? 0}` +
                  (badgeStyle ? `, riskScore ${score}` : '') +
                  `. Enter で DetailPanel に表示`
                }
                style={CARD_STYLE}
                onClick={() => { onSelect(c.hash); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.hash); } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ ...CARD_TITLE_STYLE, flex: 1 }}>{c.subject}</span>
                  {badgeStyle && (
                    <span
                      style={badgeStyle}
                      title={`riskScore: ${score} (${score >= RISK_HIGH_THRESHOLD ? 'critical' : 'warning'})`}
                    >
                      {score}
                    </span>
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
            );
          })}
          <TruncationFooter shown={shown.length} total={aheadCount} />
        </>
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
  /** 他 Lens への遷移 (EmptyStateCard / Error カード用) */
  onChangeLens?: (lens: LensId) => void;
};

type OutboxData = {
  uncommitted: UncommittedCard[];
  stashes: StashEntry[];
  aheadCommits: Commit[];
  aheadCount: number;
  /** Head ブランチ名 (検出できない / detached 時は null) */
  headName: string | null;
};

export function OutboxLens({
  repoId,
  refs,
  onSelectCommit,
  onOpenWorktree,
  onChangeLens,
}: OutboxLensProps) {
  const [data, setData] = useState<OutboxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);

      try {
        const base = estimateBase(refs);
        // PR-A: fetchRefDrift → fetchBranchGroupHealth に切替。`head` を使って
        // 「最初に ahead を持つ任意のブランチ」ではなく HEAD ブランチの ahead を
        // 正確に取得する。detached HEAD は head=null → aheadCount=0。
        const [worktree, stashes, groupHealth] = await Promise.all([
          fetchWorkTree(repoId, signal),
          listStashes(repoId),
          base
            ? fetchBranchGroupHealth(repoId, { base }, signal)
            : Promise.resolve(null),
        ]);

        if (signal.aborted) return;

        const uncommitted = buildUncommittedCards(worktree);

        let aheadCount = 0;
        let headName: string | null = null;
        if (groupHealth && groupHealth.head) {
          headName = groupHealth.head.name;
          const headEntry = groupHealth.branches.find(
            (b) => b.hash === groupHealth.head!.hash || b.name === groupHealth.head!.name,
          );
          aheadCount = headEntry?.ahead ?? 0;
        }

        let aheadCommits: Commit[] = [];
        if (aheadCount > 0) {
          const limit = Math.min(aheadCount + 5, CARD_CAP);
          const fetched = await listCommits(repoId, 'HEAD', '', '', '', 'subject', '', limit);
          if (!signal.aborted) {
            aheadCommits = fetched.slice(0, aheadCount);
          }
        }

        if (!signal.aborted) {
          setData({
            uncommitted,
            stashes: stashes.slice(0, CARD_CAP),
            aheadCommits,
            aheadCount,
            headName,
          });
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

  const handleRefresh = useCallback(() => {
    const controller = new AbortController();
    void load(controller.signal);
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

  // LensHeader 一行説明 (HEAD 名 + 3 列合計 lines があれば文脈を強化)
  const oneLiner = useMemo(() => {
    const headPart = data?.headName ? `HEAD: ${data.headName} · ` : '';
    const totalLines = data
      ? data.uncommitted.reduce((s, c) => s + c.added + c.deleted, 0) +
        data.aheadCommits.reduce(
          (s, c) => s + (c.added ?? 0) + (c.deleted ?? 0),
          0,
        )
      : 0;
    const totalPart = data && totalLines > 0 ? `合計 ±${totalLines} lines · ` : '';
    return `${headPart}${totalPart}まだ世界に出していない変更を 3 列で一望する`;
  }, [data]);

  const renderHeader = () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        flexShrink: 0,
        borderBottom: '1px solid var(--rs-border)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <LensHeader title="Outbox" oneLiner={oneLiner} helpContent={<OutboxHelpContent />} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 6px' }}>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          aria-busy={loading}
          aria-label="Outbox を再読み込み"
          style={{
            padding: '2px 10px',
            fontSize: 11,
            fontFamily: 'var(--rs-sans)',
            background: 'transparent',
            border: '1px solid var(--rs-border)',
            borderRadius: 'var(--rs-radius-sm)',
            color: 'var(--rs-text-secondary)',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>
    </div>
  );

  if (loading && !data) {
    return (
      <div style={containerStyle}>
        {renderHeader()}
        <div
          role="status"
          aria-live="polite"
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
        {renderHeader()}
        <div
          style={{
            display: 'flex',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              maxWidth: 440,
              padding: '20px 24px',
              background: 'var(--rs-bg-elevated)',
              border: '1px solid var(--rs-border)',
              borderRadius: 'var(--rs-radius-md)',
              fontFamily: 'var(--rs-sans)',
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--rs-git-deleted)',
                marginBottom: 8,
              }}
            >
              Outbox データの取得に失敗しました
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--rs-text-secondary)',
                lineHeight: 1.6,
                marginBottom: 16,
                wordBreak: 'break-word',
              }}
            >
              {error}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleRefresh}
                style={{
                  height: 28,
                  padding: '0 12px',
                  fontSize: 11,
                  fontFamily: 'var(--rs-sans)',
                  borderRadius: 'var(--rs-radius-sm)',
                  border: '1px solid var(--rs-accent)',
                  background: 'var(--rs-accent)',
                  color: 'var(--rs-bg-panel)',
                  cursor: 'pointer',
                }}
              >
                再試行
              </button>
              {onChangeLens && (
                <>
                  <button
                    type="button"
                    onClick={() => onChangeLens('live')}
                    style={{
                      height: 28,
                      padding: '0 12px',
                      fontSize: 11,
                      fontFamily: 'var(--rs-sans)',
                      borderRadius: 'var(--rs-radius-sm)',
                      border: '1px solid var(--rs-border)',
                      background: 'transparent',
                      color: 'var(--rs-text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    Live を開く
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeLens('drift')}
                    style={{
                      height: 28,
                      padding: '0 12px',
                      fontSize: 11,
                      fontFamily: 'var(--rs-sans)',
                      borderRadius: 'var(--rs-radius-sm)',
                      border: '1px solid var(--rs-border)',
                      background: 'transparent',
                      color: 'var(--rs-text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    Drift を開く
                  </button>
                </>
              )}
            </div>
          </div>
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
      {renderHeader()}

      {isEmpty ? (
        <EmptyStateCard
          reason={'outbox-clean' as LensEmptyReason}
          messages={OUTBOX_EMPTY_MESSAGES}
          onChangeLens={onChangeLens}
          relatedLenses={
            onChangeLens
              ? [
                  { id: 'drift', label: 'Drift を開く' },
                  { id: 'live', label: 'Live を開く' },
                ]
              : undefined
          }
        />
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

      {/* Focus ring style for keyboard a11y (DriftLens parallel) */}
      <style>{`
        .rs-outbox-card:focus-visible {
          outline: 2px solid var(--rs-accent);
          outline-offset: 2px;
        }
      `}</style>
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
      subKind: 'staged',
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
      subKind: 'unstaged',
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
      subKind: 'untracked',
      label: 'Untracked files',
      fileCount: worktree.untracked.summary.fileCount,
      added: worktree.untracked.summary.added,
      deleted: 0,
      snapshotAt: worktree.snapshotAt,
    });
  }

  return cards.slice(0, CARD_CAP);
}
