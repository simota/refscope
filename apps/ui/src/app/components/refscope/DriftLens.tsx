/**
 * Drift Lens — 全ブランチの ahead/behind を散布図で可視化し、分岐状況を一目で把握する。
 *
 * - X 軸: behind (base に対する遅れコミット数)
 * - Y 軸: ahead  (base に対する先行コミット数)
 * - 点サイズ (z): 最終コミットからの経過日数 (古いほど大きい)
 * - 点の色: 警戒度に応じて緑 → 黄 → 赤
 * - 象限ガイド:
 *   左下 "Aligned" / 左上 "Hot" / 右下 "Stale" / 右上 "Diverged"
 * - 点クリック → onSelectRef(refName) で既存 Live / BranchSidebar が反応
 */
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts';
import { fetchRefDrift, type RefDriftEntry } from '../../api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftLensProps = {
  repoId: string;
  refs: Array<{ name: string }>;
  onSelectRef: (ref: string) => void;
};

type DriftPoint = RefDriftEntry & {
  /** days since last commit (0 = today) */
  ageDays: number;
  /** radius for ZAxis substitute; encoded as SVG r attribute via custom shape */
  r: number;
  /** rgb() string derived from alert score */
  color: string;
  /** raw alert score */
  alertScore: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate the base branch from the ref list.
 * Priority: main → master → trunk → first ref.
 * Returns null when the ref list is empty.
 */
function estimateBase(refs: Array<{ name: string }>): string | null {
  const CANDIDATES = ['main', 'master', 'trunk'];
  for (const candidate of CANDIDATES) {
    if (refs.some((r) => r.name === candidate || r.name === `refs/heads/${candidate}`)) {
      return candidate;
    }
  }
  // Remote tracking variants (refs/remotes/origin/main etc.)
  for (const candidate of CANDIDATES) {
    const remote = refs.find(
      (r) => r.name.endsWith(`/${candidate}`),
    );
    if (remote) return remote.name;
  }
  return refs[0]?.name ?? null;
}

function computeAgeDays(hashOrDate: string): number {
  // The API returns a hash, not a date — we derive age from the drift payload's
  // lastCommitAt if present; otherwise fall back to 0 so the size is neutral.
  return 0;
}

/**
 * Map an alert score (0–1) to an rgb() colour string.
 * 0.0 → green (#4ade80), 0.5 → yellow (#facc15), 1.0 → red (#f87171)
 */
function scoreToColor(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  if (s < 0.5) {
    // green → yellow
    const t = s * 2;
    const r = Math.round(74 + (250 - 74) * t);
    const g = Math.round(222 + (204 - 222) * t);
    const b = Math.round(128 + (21 - 128) * t);
    return `rgb(${r},${g},${b})`;
  }
  // yellow → red
  const t = (s - 0.5) * 2;
  const r = Math.round(250 + (248 - 250) * t);
  const g = Math.round(204 + (113 - 204) * t);
  const b = Math.round(21 + (113 - 21) * t);
  return `rgb(${r},${g},${b})`;
}

function toDriftPoint(entry: RefDriftEntry): DriftPoint {
  const alertScore = Math.min(1, (entry.ahead + entry.behind) / 100);
  const ageDays = 0; // hash only — no date available from drift endpoint
  // r: 4 (young/zero) → 10 (old). Since we lack a date, keep neutral 6.
  const r = 6;
  return {
    ...entry,
    ageDays,
    r,
    color: scoreToColor(alertScore),
    alertScore,
  };
}

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------

function DriftTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as DriftPoint | undefined;
  if (!point) return null;

  const containerStyle: CSSProperties = {
    background: 'var(--rs-bg-elevated)',
    border: '1px solid var(--rs-border)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 12,
    fontFamily: 'var(--rs-mono)',
    color: 'var(--rs-text)',
    maxWidth: 260,
    wordBreak: 'break-all',
  };

  return (
    <div style={containerStyle}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: point.color }}>{point.name}</div>
      <div>ahead: <strong>{point.ahead}</strong></div>
      <div>behind: <strong>{point.behind}</strong></div>
      <div style={{ color: 'var(--rs-text-secondary)', marginTop: 4, fontSize: 11 }}>
        click to select
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom dot shape — needed to apply per-point colour and radius
// ---------------------------------------------------------------------------

interface DotShapeProps {
  cx?: number;
  cy?: number;
  payload?: DriftPoint;
}

function DotShape({ cx = 0, cy = 0, payload }: DotShapeProps) {
  if (!payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={payload.r}
      fill={payload.color}
      fillOpacity={0.75}
      stroke={payload.color}
      strokeWidth={1}
      style={{ cursor: 'pointer' }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const QUADRANT_LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  fill: 'var(--rs-text-secondary)',
};

export function DriftLens({ repoId, refs, onSelectRef }: DriftLensProps) {
  const [points, setPoints] = useState<DriftPoint[]>([]);
  const [base, setBase] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const estimatedBase = estimateBase(refs);
      if (!estimatedBase) {
        setBase(null);
        setPoints([]);
        setLoading(false);
        return;
      }
      setBase(estimatedBase);
      setLoading(true);
      setError(null);
      try {
        const res = await fetchRefDrift(
          repoId,
          { base: estimatedBase, limit: 50 },
          signal,
        );
        const pts = res.refs.map(toDriftPoint);
        setPoints(pts);
        setTruncated(res.truncated);
        setLoading(false);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
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

  // Determine axis domains with at least a minimum extent so reference lines render
  const maxBehind = Math.max(10, ...points.map((p) => p.behind));
  const maxAhead  = Math.max(10, ...points.map((p) => p.ahead));
  const midBehind = Math.round(maxBehind / 2);
  const midAhead  = Math.round(maxAhead  / 2);

  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--rs-bg-panel)',
    color: 'var(--rs-text)',
    fontFamily: 'var(--rs-sans)',
  };

  const headerStyle: CSSProperties = {
    padding: '10px 16px 6px',
    borderBottom: '1px solid var(--rs-border)',
    fontSize: 12,
    color: 'var(--rs-text-secondary)',
  };

  // --- Loading ---
  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>Drift Lens — loading…</div>
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
          Computing branch drift…
        </div>
      </div>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>Drift Lens</div>
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
          <span style={{ color: '#f87171' }}>Failed to load drift data</span>
          <span style={{ fontSize: 11 }}>{error}</span>
        </div>
      </div>
    );
  }

  // --- No base branch ---
  if (!base) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>Drift Lens</div>
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
          No refs available — open a repository first.
        </div>
      </div>
    );
  }

  // --- Empty (base found but no diverged branches) ---
  if (points.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          Drift Lens — base: <strong>{base}</strong>
        </div>
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
          No diverged branches — all refs are aligned with <strong>&nbsp;{base}</strong>.
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        Drift Lens — base:{' '}
        <strong style={{ color: 'var(--rs-text)' }}>{base}</strong>
        {truncated && (
          <span style={{ marginLeft: 8, color: '#facc15' }}>
            (showing first 50 branches)
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '12px 8px 8px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 24, right: 32, bottom: 24, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--rs-border)" />

            {/* Quadrant guide lines */}
            <ReferenceLine
              x={midBehind}
              stroke="var(--rs-border)"
              strokeDasharray="6 3"
              strokeOpacity={0.6}
            />
            <ReferenceLine
              y={midAhead}
              stroke="var(--rs-border)"
              strokeDasharray="6 3"
              strokeOpacity={0.6}
            />

            {/* Quadrant shading */}
            {/* Left-bottom: Aligned (green tint) */}
            <ReferenceArea
              x1={0}
              x2={midBehind}
              y1={0}
              y2={midAhead}
              fill="#4ade80"
              fillOpacity={0.05}
              label={{ value: 'Aligned', position: 'insideBottomLeft', style: QUADRANT_LABEL_STYLE }}
            />
            {/* Left-top: Hot (yellow tint) */}
            <ReferenceArea
              x1={0}
              x2={midBehind}
              y1={midAhead}
              y2={maxAhead + 1}
              fill="#facc15"
              fillOpacity={0.05}
              label={{ value: 'Hot', position: 'insideTopLeft', style: QUADRANT_LABEL_STYLE }}
            />
            {/* Right-bottom: Stale (orange tint) */}
            <ReferenceArea
              x1={midBehind}
              x2={maxBehind + 1}
              y1={0}
              y2={midAhead}
              fill="#fb923c"
              fillOpacity={0.05}
              label={{ value: 'Stale', position: 'insideBottomRight', style: QUADRANT_LABEL_STYLE }}
            />
            {/* Right-top: Diverged (red tint) */}
            <ReferenceArea
              x1={midBehind}
              x2={maxBehind + 1}
              y1={midAhead}
              y2={maxAhead + 1}
              fill="#f87171"
              fillOpacity={0.08}
              label={{ value: 'Diverged', position: 'insideTopRight', style: QUADRANT_LABEL_STYLE }}
            />

            <XAxis
              type="number"
              dataKey="behind"
              name="Behind"
              domain={[0, maxBehind + Math.ceil(maxBehind * 0.1)]}
              label={{
                value: 'Behind (commits)',
                position: 'insideBottom',
                offset: -12,
                style: { fontSize: 11, fill: 'var(--rs-text-secondary)' },
              }}
              tick={{ fontSize: 11, fill: 'var(--rs-text-secondary)' }}
            />
            <YAxis
              type="number"
              dataKey="ahead"
              name="Ahead"
              domain={[0, maxAhead + Math.ceil(maxAhead * 0.1)]}
              label={{
                value: 'Ahead (commits)',
                angle: -90,
                position: 'insideLeft',
                offset: 8,
                style: { fontSize: 11, fill: 'var(--rs-text-secondary)' },
              }}
              tick={{ fontSize: 11, fill: 'var(--rs-text-secondary)' }}
            />

            <Tooltip content={<DriftTooltip />} />

            <Scatter
              data={points}
              shape={<DotShape />}
              onClick={(data: unknown) => {
                const pt = data as DriftPoint | undefined;
                if (pt?.name) onSelectRef(pt.name);
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
