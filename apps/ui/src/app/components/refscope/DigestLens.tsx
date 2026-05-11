/**
 * Digest Lens — 直近 24h / 7d の活動を 2×2 グリッドダッシュボードで要約する。
 *
 * 4 ペイン:
 *   Top-Left  : Top Contributors (コミット数 / ±行数 Top5)
 *   Top-Right : Top Hotspot Delta (churn 増加 Top5)
 *   Bot-Left  : Risky Commits Top5 (riskScore 降順 / バッジ付き)
 *   Bot-Right : Ref Activity (updated 件数のみ。created/deleted は API 未対応で N/A)
 *
 * データソース:
 *   - Contributors: fetchCommitsSummary(groupBy: "author")
 *   - Hotspot Delta: fetchFileHotspot(since)
 *   - Risky Commits: listCommits(HEAD, limit=200) → UI 側で since フィルタ + riskScore 降順
 *   - Ref Activity : listRefs() → updatedAt フィルタ (削除情報なし → N/A)
 *
 * a11y: 絵文字に aria-hidden、各 row に focus ring。
 */
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  fetchCommitsSummary,
  fetchFileHotspot,
  listCommits,
  listRefs,
  type CommitsSummaryGroup,
  type HotspotFileEntry,
} from '../../api';
import type { Commit } from './data';
import { LensHeader } from './LensHeader';
import { ROT_SCORE_COLORS } from './BranchSidebar';
import {
  RISK_HIGH_THRESHOLD,
  riskBadgeStyle,
  riskBadgeLabel,
} from './riskBadge';
import type { LensId } from './LensSwitcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = '24h' | '7d';

type DigestData = {
  contributors: CommitsSummaryGroup[];
  hotspotFiles: HotspotFileEntry[];
  riskyCommits: Commit[];
  refActivity: { created: number | null; updated: number; deleted: number | null };
};

export type DigestLensProps = {
  repoId: string;
  onSelectCommit: (hash: string) => void;
  onOpenFileHistory: (path: string) => void;
  /** 他 Lens への遷移 (Author クリック / EmptyStateCard 用)
   *  旧 setActiveLens から onChangeLens にリネーム (CON-01) */
  onChangeLens: (lens: LensId) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodToSince(period: Period): string {
  const now = new Date();
  if (period === '24h') {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  }
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

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

function buildMarkdown(data: DigestData, period: Period): string {
  const lines: string[] = [`# Refscope Digest — last ${period}`, ''];

  lines.push('## Top Contributors');
  if (data.contributors.length === 0) {
    lines.push('_No activity_');
  } else {
    for (const c of data.contributors.slice(0, 5)) {
      lines.push(`- ${c.key}: ${c.commitCount} commit${c.commitCount !== 1 ? 's' : ''} (+${c.added}/-${c.deleted})`);
    }
  }
  lines.push('');

  lines.push('## Top Hotspot Delta');
  if (data.hotspotFiles.length === 0) {
    lines.push('_No hotspot data_');
  } else {
    for (const f of data.hotspotFiles.slice(0, 5)) {
      lines.push(`- ${f.path} (+${f.churn} churn)`);
    }
  }
  lines.push('');

  lines.push('## Risky Commits Top5');
  if (data.riskyCommits.length === 0) {
    lines.push('_No risky commits_');
  } else {
    for (const c of data.riskyCommits.slice(0, 5)) {
      const hash = c.shortHash ?? c.hash.slice(0, 7);
      lines.push(`- ${hash} ${c.subject} (score ${c.riskScore ?? 0})`);
    }
  }
  lines.push('');

  lines.push('## Ref Activity');
  lines.push(
    `- ${data.refActivity.updated} updated · created N/A · deleted N/A`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Help content for LensHeader
// ---------------------------------------------------------------------------

function DigestHelpContent(): ReactNode {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--rs-text)' }}>
        Digest Lens とは
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        直近 24h / 7d の活動を 2×2 グリッドで要約するダッシュボード。
        毎朝最初に開いて<strong>今日レビューすべきコミット・ファイル・ブランチ</strong>を一望する用途を想定しています。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        4 ペインの意味
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8, lineHeight: 1.7 }}>
        ・<strong>Top Contributors</strong>: 期間内のコミット数で著者を降順 (Top5)<br />
        ・<strong>Top Hotspot Delta</strong>: <code>churn</code> (added + deleted の合計) が大きいファイル Top5<br />
        ・<strong>Risky Commits Top5</strong>: <code>riskScore</code> が高いコミット Top5<br />
        ・<strong>Ref Activity</strong>: 期間内に更新された ref の件数
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        用語 glossary
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8, lineHeight: 1.7 }}>
        ・<code>{`{N}c`}</code> = N コミット<br />
        ・<code>+M / -K</code> = 追加 M 行 / 削除 K 行<br />
        ・<code>churn</code> = 期間内の追加 + 削除行数の合計<br />
        ・<code>riskScore</code> = Risky Diff Detector が算出するコミット単位のリスクスコア<br />
        {'　'}・<span style={{ color: ROT_SCORE_COLORS.warning }}>warning</span>: {1}-{RISK_HIGH_THRESHOLD - 1} ·{' '}
        <span style={{ color: ROT_SCORE_COLORS.critical }}>critical</span>: ≥{RISK_HIGH_THRESHOLD}
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        Ref Activity の API 制限
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        現バージョンでは<strong>新規作成・削除された ref の検出は未対応</strong>です
        (リアルタイム SSE イベント経由でのみ取得可能)。
        <code>updated</code> 件数のみ集計し、created / deleted は <code>N/A</code> と表示します。
        Phase 2 で SSE 連動の積算を予定しています。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        操作
      </div>
      <div style={{ color: 'var(--rs-text-secondary)' }}>
        ・<strong>24h / 7d</strong>: 集計期間切替<br />
        ・<strong>Copy as Markdown</strong>: 全 4 ペインを Markdown としてクリップボードへ<br />
        ・著者行クリック → Risk Heatmap (著者フィルタは Phase 2 で実装予定)<br />
        ・ファイル行クリック → File History に遷移<br />
        ・コミット行クリック → DetailPanel に表示
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const PANE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  background: 'var(--rs-bg-elevated)',
  border: '1px solid var(--rs-border)',
  borderRadius: 'var(--rs-radius-sm)',
  padding: '10px 12px',
  minHeight: 0,
  overflow: 'hidden',
};

const PANE_HEADER_STYLE: CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--rs-sans)',
  fontWeight: 600,
  color: 'var(--rs-text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--rs-border)',
  paddingBottom: 4,
  marginBottom: 2,
  flexShrink: 0,
};

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 0',
  fontSize: 12,
  fontFamily: 'var(--rs-sans)',
  color: 'var(--rs-text)',
  borderBottom: '1px solid color-mix(in oklab, var(--rs-border), transparent 50%)',
  cursor: 'pointer',
  minWidth: 0,
  outline: 'none',
};

const RANK_STYLE: CSSProperties = {
  fontSize: 10,
  fontFamily: 'var(--rs-mono)',
  color: 'var(--rs-text-secondary)',
  flexShrink: 0,
  width: 14,
  textAlign: 'right' as const,
};

const LABEL_STYLE: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const META_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--rs-text-secondary)',
  flexShrink: 0,
  fontFamily: 'var(--rs-mono)',
};

const PLACEHOLDER_STYLE: CSSProperties = {
  padding: '12px 0',
  fontSize: 12,
  color: 'var(--rs-text-secondary)',
  fontStyle: 'italic',
};

// ---------------------------------------------------------------------------
// Pane sub-components
// ---------------------------------------------------------------------------

function PaneHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={PANE_HEADER_STYLE}>
      <span aria-hidden="true">{icon}</span> {title}
    </div>
  );
}

function ContributorsPane({
  contributors,
  period,
  onAuthorClick,
}: {
  contributors: CommitsSummaryGroup[];
  period: Period;
  onAuthorClick: (author: string) => void;
}) {
  const empty = contributors.length === 0;
  return (
    <div style={PANE_STYLE}>
      <PaneHeader icon="👤" title="Top Contributors" />
      {empty ? (
        <div style={PLACEHOLDER_STYLE}>No activity in the last {period}</div>
      ) : (
        contributors.slice(0, 5).map((c, i) => (
          <div
            key={c.key}
            role="button"
            tabIndex={0}
            className="rs-digest-row"
            aria-label={`Contributor ${c.key}: ${c.commitCount} commits, +${c.added}, -${c.deleted}. Enter で Risk Heatmap に移動`}
            style={ROW_STYLE}
            onClick={() => { onAuthorClick(c.key); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAuthorClick(c.key); } }}
          >
            <span style={RANK_STYLE}>{i + 1}</span>
            <span style={LABEL_STYLE}>{c.key}</span>
            <span style={META_STYLE}>
              {c.commitCount}c&nbsp;
              <span style={{ color: 'var(--rs-git-added)' }}>+{c.added}</span>
              /
              <span style={{ color: 'var(--rs-git-deleted)' }}>-{c.deleted}</span>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function HotspotPane({
  files,
  period,
  onFileClick,
}: {
  files: HotspotFileEntry[];
  period: Period;
  onFileClick: (path: string) => void;
}) {
  const empty = files.length === 0;
  return (
    <div style={PANE_STYLE}>
      <PaneHeader icon="🔥" title="Top Hotspot Delta" />
      {empty ? (
        <div style={PLACEHOLDER_STYLE}>No hotspot data in the last {period}</div>
      ) : (
        files.slice(0, 5).map((f, i) => (
          <div
            key={f.path}
            role="button"
            tabIndex={0}
            className="rs-digest-row"
            aria-label={`File ${f.path}: churn ${f.churn}. Enter で File History を開く`}
            title="クリックで File History を開きます"
            style={ROW_STYLE}
            onClick={() => { onFileClick(f.path); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFileClick(f.path); } }}
          >
            <span style={RANK_STYLE}>{i + 1}</span>
            <span style={LABEL_STYLE}>{f.path}</span>
            <span style={META_STYLE}>
              churn&nbsp;<strong>{f.churn}</strong>
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function RiskyCommitsPane({
  commits,
  period,
  onCommitClick,
}: {
  commits: Commit[];
  period: Period;
  onCommitClick: (hash: string) => void;
}) {
  const empty = commits.length === 0;
  const highRiskCount = commits.filter(
    (c) => (c.riskScore ?? 0) >= RISK_HIGH_THRESHOLD,
  ).length;
  return (
    <div style={PANE_STYLE}>
      <PaneHeader icon="⚠️" title="Risky Commits Top5" />
      {highRiskCount > 0 && (
        <div
          role="status"
          style={{
            padding: '4px 6px',
            fontSize: 10,
            fontFamily: 'var(--rs-sans)',
            color: ROT_SCORE_COLORS.critical,
            background: `color-mix(in oklab, var(--rs-bg-elevated), ${ROT_SCORE_COLORS.critical} 12%)`,
            border: `1px solid ${ROT_SCORE_COLORS.critical}`,
            borderRadius: 'var(--rs-radius-sm)',
            marginBottom: 4,
          }}
        >
          ⚠ critical ({RISK_HIGH_THRESHOLD}+) のコミットが{' '}
          <strong>{highRiskCount}</strong> 件
        </div>
      )}
      {empty ? (
        <div style={PLACEHOLDER_STYLE}>No risky commits in the last {period}</div>
      ) : (
        commits.slice(0, 5).map((c) => {
          const score = c.riskScore ?? 0;
          const badgeStyle = riskBadgeStyle(score);
          const label = riskBadgeLabel(score);
          return (
            <div
              key={c.hash}
              role="button"
              tabIndex={0}
              className="rs-digest-row"
              aria-label={`Commit ${c.shortHash ?? c.hash.slice(0, 7)}: ${c.subject}, riskScore ${score}. Enter で DetailPanel に表示`}
              style={ROW_STYLE}
              onClick={() => { onCommitClick(c.hash); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCommitClick(c.hash); } }}
            >
              <span
                style={{
                  ...META_STYLE,
                  color: 'var(--rs-text-secondary)',
                  width: 52,
                  flexShrink: 0,
                }}
              >
                {c.shortHash ?? c.hash.slice(0, 7)}
              </span>
              <span style={LABEL_STYLE}>{c.subject}</span>
              {badgeStyle && label && (
                <span
                  style={badgeStyle}
                  title={`riskScore: ${score} (${label})`}
                >
                  {score}
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function RefActivityPane({
  activity,
  period,
}: {
  activity: { created: number | null; updated: number; deleted: number | null };
  period: Period;
}) {
  // updated only — created / deleted are API-limited (see helpContent)
  return (
    <div style={PANE_STYLE}>
      <PaneHeader icon="🌿" title="Ref Activity" />
      {activity.updated === 0 ? (
        <div style={PLACEHOLDER_STYLE}>No ref activity in the last {period}</div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '8px 0',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--rs-text-secondary)' }}>Updated refs</span>
            <strong style={{ color: 'var(--rs-text)' }}>{activity.updated}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--rs-text-secondary)' }}>New refs</span>
            <span
              style={{ color: 'var(--rs-text-muted)', fontFamily: 'var(--rs-mono)', fontSize: 11 }}
              title="API 制限により新規 ref の検出は未対応 (Phase 2 で SSE 連動予定)"
            >
              N/A
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--rs-text-secondary)' }}>Deleted refs</span>
            <span
              style={{ color: 'var(--rs-text-muted)', fontFamily: 'var(--rs-mono)', fontSize: 11 }}
              title="API 制限により削除 ref の検出は未対応 (Phase 2 で SSE 連動予定)"
            >
              N/A
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DigestLens({
  repoId,
  onSelectCommit,
  onOpenFileHistory,
  onChangeLens,
}: DigestLensProps) {
  const [period, setPeriod] = useState<Period>('24h');
  const [data, setData] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal, currentPeriod: Period) => {
      setLoading(true);
      setError(null);

      const since = periodToSince(currentPeriod);
      const until = new Date().toISOString();

      try {
        const [summary, hotspot, allCommits, allRefs] = await Promise.all([
          fetchCommitsSummary(
            repoId,
            { since, until, groupBy: 'author' },
            signal,
          ),
          fetchFileHotspot(repoId, { since, limit: 10 }, signal),
          listCommits(repoId, 'HEAD', '', '', '', 'subject', '', 200),
          listRefs(repoId),
        ]);

        if (signal.aborted) return;

        const contributors = (summary.groups as CommitsSummaryGroup[])
          .filter((g) => g.kind === 'author')
          .sort((a, b) => b.commitCount - a.commitCount);

        const hotspotFiles = hotspot.files;

        const sinceMs = Date.parse(since);
        const riskyCommits = allCommits
          .filter((c) => {
            const ts = Date.parse(c.authorDate);
            return Number.isFinite(ts) && ts >= sinceMs && (c.riskScore ?? 0) > 0;
          })
          .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
          .slice(0, 5);

        // Ref Activity: updated 件数のみ実数、created/deleted は API 未対応
        const activeRefs = allRefs.filter((r) => {
          if (!r.updatedAt) return false;
          const ts = Date.parse(r.updatedAt);
          return Number.isFinite(ts) && ts >= sinceMs;
        });
        const refActivity = {
          created: null,
          updated: activeRefs.length,
          deleted: null,
        };

        if (!signal.aborted) {
          setData({ contributors, hotspotFiles, riskyCommits, refActivity });
          setLoading(false);
        }
      } catch (err) {
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    },
    [repoId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal, period);
    return () => { controller.abort(); };
  }, [load, period]);

  const handleCopy = useCallback(() => {
    if (!data) return;
    const md = buildMarkdown(data, period);
    navigator.clipboard
      .writeText(md)
      .then(() => {
        setCopied(true);
        setCopyError(false);
        setTimeout(() => { setCopied(false); }, 2000);
      })
      .catch(() => {
        // Clipboard API rejected (insecure context / permission denied / etc.)
        setCopyError(true);
        setCopied(false);
        setTimeout(() => { setCopyError(false); }, 3000);
      });
  }, [data, period]);

  const handleAuthorClick = useCallback(
    (_author: string) => {
      // BUG-01 / VIII-1: Currently we hop to Risk Heatmap without applying
      // an author filter. The proper filter pipeline requires changes to
      // RiskHeatmapLens and App.tsx and is tracked as a follow-up SPIKE.
      // #TODO(agent): VIII-1 author filter — see Magi verdict 2026-05-11
      onChangeLens('risk-heatmap');
    },
    [onChangeLens],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--rs-bg-panel)',
    color: 'var(--rs-text)',
    fontFamily: 'var(--rs-sans)',
    overflow: 'hidden',
  };

  const toggleBtnStyle = (active: boolean): CSSProperties => ({
    padding: '2px 10px',
    fontSize: 11,
    fontFamily: 'var(--rs-sans)',
    fontWeight: active ? 600 : 400,
    background: active
      ? 'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 15%)'
      : 'transparent',
    border: active
      ? '1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)'
      : '1px solid var(--rs-border)',
    borderRadius: 'var(--rs-radius-sm)',
    color: active ? 'var(--rs-accent)' : 'var(--rs-text-secondary)',
    cursor: 'pointer',
    height: 24,
  });

  const actionBtnStyle: CSSProperties = {
    padding: '2px 10px',
    fontSize: 11,
    fontFamily: 'var(--rs-sans)',
    background: copyError ? 'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-git-deleted) 20%)' : 'transparent',
    border: `1px solid ${copyError ? 'var(--rs-git-deleted)' : 'var(--rs-border)'}`,
    borderRadius: 'var(--rs-radius-sm)',
    color: copyError ? 'var(--rs-git-deleted)' : 'var(--rs-text-secondary)',
    cursor: 'pointer',
    height: 24,
  };

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
        <LensHeader
          title="Digest"
          oneLiner={`直近 ${period} の活動を 2×2 グリッドで要約 (毎朝のスナップショット)`}
          helpContent={<DigestHelpContent />}
        />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 16px 6px',
        }}
      >
        <button
          type="button"
          style={toggleBtnStyle(period === '24h')}
          onClick={() => { setPeriod('24h'); }}
          aria-pressed={period === '24h'}
        >
          24h
        </button>
        <button
          type="button"
          style={toggleBtnStyle(period === '7d')}
          onClick={() => { setPeriod('7d'); }}
          aria-pressed={period === '7d'}
        >
          7d
        </button>
        <button
          type="button"
          style={actionBtnStyle}
          onClick={handleCopy}
          disabled={!data}
          aria-label="Digest を Markdown としてクリップボードにコピー"
        >
          {copyError ? '✕ Copy failed' : copied ? '✓ Copied!' : 'Copy as Markdown'}
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
          Building digest…
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
              Digest データの取得に失敗しました
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--rs-text-secondary)',
                lineHeight: 1.6,
                marginBottom: 12,
                wordBreak: 'break-word',
              }}
            >
              {error}
            </div>
            <div style={{ fontSize: 11, color: 'var(--rs-text-muted)' }}>
              Phase 1 では PR-B で Retry ボタン + 代替 Lens 誘導が追加される予定です。
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isEmpty =
    data.contributors.length === 0 &&
    data.hotspotFiles.length === 0 &&
    data.riskyCommits.length === 0 &&
    data.refActivity.updated === 0;

  return (
    <div style={containerStyle}>
      {renderHeader()}

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
          No activity in the last {period}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gridTemplateRows: 'repeat(2, minmax(180px, auto))',
            gap: 12,
            alignContent: 'start',
          }}
        >
          <ContributorsPane
            contributors={data.contributors}
            period={period}
            onAuthorClick={handleAuthorClick}
          />
          <HotspotPane
            files={data.hotspotFiles}
            period={period}
            onFileClick={onOpenFileHistory}
          />
          <RiskyCommitsPane
            commits={data.riskyCommits}
            period={period}
            onCommitClick={(hash) => {
              onSelectCommit(hash);
            }}
          />
          <RefActivityPane activity={data.refActivity} period={period} />
        </div>
      )}

      {/* focus-visible outline for keyboard a11y (DriftLens / OutboxLens parallel) */}
      <style>{`
        .rs-digest-row:focus-visible {
          outline: 2px solid var(--rs-accent);
          outline-offset: -1px;
        }
      `}</style>
    </div>
  );
}
