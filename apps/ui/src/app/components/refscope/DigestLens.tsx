/**
 * Digest Lens — 直近 24h / 7d の活動を 2×2 グリッドダッシュボードで要約する。
 *
 * 4 ペイン:
 *   Top-Left  : Top Contributors (コミット数 / ±行数 Top5)
 *   Top-Right : Top Hotspot Delta (churn 増加 Top5)
 *   Bot-Left  : Risky Commits Top5 (riskScore 降順)
 *   Bot-Right : Ref Activity (新規 / 更新 / 削除 カウント近似)
 *
 * データソース:
 *   - Contributors: fetchCommitsSummary(groupBy: "author")
 *   - Hotspot Delta: fetchFileHotspot(since)
 *   - Risky Commits: listCommits(HEAD, limit=200) → UI 側で since フィルタ + riskScore 降順
 *   - Ref Activity : listRefs() → updatedAt フィルタ (削除情報なし → 0 固定)
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  fetchCommitsSummary,
  fetchFileHotspot,
  listCommits,
  listRefs,
  type CommitsSummaryGroup,
  type HotspotFileEntry,
} from '../../api';
import type { Commit } from './data';
import type { LensId } from './LensSwitcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = '24h' | '7d';

type DigestData = {
  contributors: CommitsSummaryGroup[];
  hotspotFiles: HotspotFileEntry[];
  riskyCommits: Commit[];
  refActivity: { created: number; updated: number; deleted: number };
};

export type DigestLensProps = {
  repoId: string;
  onSelectCommit: (hash: string) => void;
  onOpenFileHistory: (path: string) => void;
  setActiveLens: (lens: LensId) => void;
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
    `- ${data.refActivity.created} created, ${data.refActivity.updated} updated, ${data.refActivity.deleted} deleted`,
  );

  return lines.join('\n');
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
      {icon} {title}
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
            style={ROW_STYLE}
            onClick={() => { onAuthorClick(c.key); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onAuthorClick(c.key); }}
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
            style={ROW_STYLE}
            onClick={() => { onFileClick(f.path); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onFileClick(f.path); }}
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
  return (
    <div style={PANE_STYLE}>
      <PaneHeader icon="⚠️" title="Risky Commits Top5" />
      {empty ? (
        <div style={PLACEHOLDER_STYLE}>No risky commits in the last {period}</div>
      ) : (
        commits.slice(0, 5).map((c) => (
          <div
            key={c.hash}
            role="button"
            tabIndex={0}
            style={ROW_STYLE}
            onClick={() => { onCommitClick(c.hash); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCommitClick(c.hash); }}
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
          </div>
        ))
      )}
    </div>
  );
}

function RefActivityPane({
  activity,
  period,
}: {
  activity: { created: number; updated: number; deleted: number };
  period: Period;
}) {
  const total = activity.created + activity.updated + activity.deleted;
  return (
    <div style={PANE_STYLE}>
      <PaneHeader icon="🌿" title="Ref Activity" />
      {total === 0 ? (
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
            <span style={{ color: 'var(--rs-text-secondary)' }}>New refs</span>
            <strong style={{ color: 'var(--rs-git-added)' }}>{activity.created}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--rs-text-secondary)' }}>Updated refs</span>
            <strong style={{ color: 'var(--rs-text)' }}>{activity.updated}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--rs-text-secondary)' }}>Deleted refs</span>
            <strong style={{ color: 'var(--rs-git-deleted)' }}>{activity.deleted}</strong>
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
  setActiveLens,
}: DigestLensProps) {
  const [period, setPeriod] = useState<Period>('24h');
  const [data, setData] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

        // Top Contributors: author groups sorted by commitCount desc
        const contributors = (summary.groups as CommitsSummaryGroup[])
          .filter((g) => g.kind === 'author')
          .sort((a, b) => b.commitCount - a.commitCount);

        // Hotspot files: already sorted by churn in the API response
        const hotspotFiles = hotspot.files;

        // Risky commits: filter by date on UI side, sort by riskScore desc
        const sinceMs = Date.parse(since);
        const riskyCommits = allCommits
          .filter((c) => {
            const ts = Date.parse(c.authorDate);
            return Number.isFinite(ts) && ts >= sinceMs && (c.riskScore ?? 0) > 0;
          })
          .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
          .slice(0, 5);

        // Ref Activity: filter by updatedAt since the period start
        // Deletion info is not available from the API → deleted = 0
        // Heuristic: refs updated within the window are "updated";
        // there is no "createdAt" separate from "updatedAt" in the API,
        // so we use updatedAt as a proxy for both created and updated.
        // We approximate: refs whose updatedAt >= since are "updated or created".
        const activeRefs = allRefs.filter((r) => {
          if (!r.updatedAt) return false;
          const ts = Date.parse(r.updatedAt);
          return Number.isFinite(ts) && ts >= sinceMs;
        });
        const refActivity = {
          created: 0,
          updated: activeRefs.length,
          deleted: 0,
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
    void navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    });
  }, [data, period]);

  const handleAuthorClick = useCallback(
    (_author: string) => {
      // Navigate to Risk Heatmap lens
      setActiveLens('risk-heatmap');
    },
    [setActiveLens],
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

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    borderBottom: '1px solid var(--rs-border)',
    fontSize: 12,
    color: 'var(--rs-text-secondary)',
    flexShrink: 0,
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
    background: 'transparent',
    border: '1px solid var(--rs-border)',
    borderRadius: 'var(--rs-radius-sm)',
    color: 'var(--rs-text-secondary)',
    cursor: 'pointer',
    height: 24,
    marginLeft: 'auto',
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>Digest Lens — loading…</div>
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
          Building digest…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>Digest Lens</div>
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
          <span style={{ color: '#f87171' }}>Failed to load digest data</span>
          <span style={{ fontSize: 11 }}>{error}</span>
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
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontWeight: 600, color: 'var(--rs-text)' }}>Digest Lens</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            style={toggleBtnStyle(period === '24h')}
            onClick={() => { setPeriod('24h'); }}
          >
            24h
          </button>
          <button
            type="button"
            style={toggleBtnStyle(period === '7d')}
            onClick={() => { setPeriod('7d'); }}
          >
            7d
          </button>
        </div>
        <button
          type="button"
          style={actionBtnStyle}
          onClick={handleCopy}
        >
          {copied ? '✓ Copied!' : 'Copy as Markdown'}
        </button>
      </div>

      {/* Content */}
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
    </div>
  );
}
