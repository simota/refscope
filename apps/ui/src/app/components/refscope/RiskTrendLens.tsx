/**
 * Risk Trend Lens — riskScore の時系列 AreaChart。
 *
 * - 横軸: authorDate (時刻順)
 * - 縦軸: riskScore (0–∞)
 * - 閾値ライン: LOW=1 (warning), HIGH=50 (danger)
 * - Brush でズーム可能
 * - 点クリック → onSelectCommit(hash)
 * - 空 / 全 score=0 → プレースホルダ
 */
import { useMemo, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Brush,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts';
import type { Commit } from './data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskTrendLensProps = {
  commits: Commit[];
  onSelectCommit: (hash: string) => void;
};

type ChartPoint = {
  hash: string;
  subject: string;
  author: string;
  /** ms since epoch — used as numeric X axis value */
  ts: number;
  /** formatted label for X axis ticks */
  dateLabel: string;
  riskScore: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOW_THRESHOLD = 1;
const HIGH_THRESHOLD = 50;

/** Format ISO date string to compact "MM/DD HH:mm" or "MM/DD" label. */
function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

type RiskTooltipPayload = {
  payload?: ChartPoint;
};

function RiskTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const item = (payload[0] as RiskTooltipPayload).payload;
  if (!item) return null;

  const score = item.riskScore;
  const scoreColor =
    score >= HIGH_THRESHOLD
      ? 'var(--rs-git-deleted)'
      : score >= LOW_THRESHOLD
        ? 'var(--rs-warning)'
        : 'var(--rs-text-secondary)';

  return (
    <div
      style={{
        background: 'var(--rs-bg-elevated)',
        border: '1px solid var(--rs-border)',
        borderRadius: 'var(--rs-radius-sm)',
        padding: '8px 10px',
        fontSize: 11,
        fontFamily: 'var(--rs-sans)',
        maxWidth: 300,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          marginBottom: 4,
          fontFamily: 'var(--rs-mono)',
          fontSize: 10,
          color: 'var(--rs-text-secondary)',
        }}
      >
        {item.hash.slice(0, 7)}
      </div>
      <div
        style={{
          fontWeight: 500,
          marginBottom: 4,
          wordBreak: 'break-all',
          color: 'var(--rs-text)',
        }}
      >
        {item.subject}
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 2 }}>
        {item.author} · {item.dateLabel}
      </div>
      <div style={{ color: scoreColor, fontWeight: 600 }}>
        riskScore: {score}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gradient defs id — stable between renders
// ---------------------------------------------------------------------------

const GRADIENT_ID = 'riskTrendGradient';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RiskTrendLens({ commits, onSelectCommit }: RiskTrendLensProps) {
  // Build chart data: filter commits with authorDate, sort chronologically.
  const chartData = useMemo<ChartPoint[]>(() => {
    const points: ChartPoint[] = [];
    for (const commit of commits) {
      const dateStr = commit.authorDate ?? commit.time;
      if (!dateStr) continue;
      const ts = Date.parse(dateStr);
      if (!Number.isFinite(ts)) continue;
      points.push({
        hash: commit.hash,
        subject: commit.subject,
        author: commit.author,
        ts,
        dateLabel: formatDateLabel(dateStr),
        riskScore: commit.riskScore ?? 0,
      });
    }
    // Oldest → newest (left → right)
    return points.sort((a, b) => a.ts - b.ts);
  }, [commits]);

  const isEmpty =
    chartData.length === 0 || chartData.every((p) => p.riskScore === 0);

  const handleClick = useCallback(
    (data: unknown) => {
      // recharts AreaChart onClick passes ActivePayload
      const ev = data as { activePayload?: Array<{ payload: ChartPoint }> } | null;
      const point = ev?.activePayload?.[0]?.payload;
      if (point?.hash) onSelectCommit(point.hash);
    },
    [onSelectCommit],
  );

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  if (isEmpty) {
    return (
      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--rs-text-secondary)',
          fontFamily: 'var(--rs-sans)',
          fontSize: 13,
        }}
      >
        No risky commits to plot
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Chart view
  // ---------------------------------------------------------------------------

  const maxScore = Math.max(...chartData.map((p) => p.riskScore), HIGH_THRESHOLD + 10);
  // Brush shows last N points by default; clamp to full range for small data sets.
  const defaultBrushEnd = chartData.length - 1;
  const defaultBrushStart = Math.max(0, defaultBrushEnd - 99);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        padding: '12px 4px 0',
      }}
    >
      {/* Legend strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          paddingLeft: 16,
          paddingBottom: 8,
          fontSize: 10,
          fontFamily: 'var(--rs-sans)',
          color: 'var(--rs-text-secondary)',
          flexShrink: 0,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              display: 'inline-block',
              width: 24,
              height: 2,
              background: 'var(--rs-warning)',
              borderRadius: 1,
            }}
          />
          <span>LOW ({LOW_THRESHOLD})</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              display: 'inline-block',
              width: 24,
              height: 2,
              background: 'var(--rs-git-deleted)',
              borderRadius: 1,
            }}
          />
          <span>HIGH ({HIGH_THRESHOLD})</span>
        </span>
        <span style={{ marginLeft: 'auto', paddingRight: 24 }}>
          {chartData.length.toLocaleString()} commits · click point to select
        </span>
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 12, right: 24, bottom: 60, left: 24 }}
            onClick={handleClick}
            style={{ cursor: 'pointer' }}
          >
            <defs>
              <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--rs-git-deleted)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--rs-git-deleted)" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--rs-border)"
              opacity={0.4}
            />

            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 10, fill: 'var(--rs-text-secondary)', fontFamily: 'var(--rs-sans)' }}
              interval="preserveStartEnd"
              label={{
                value: 'authorDate',
                position: 'insideBottom',
                offset: -48,
                fontSize: 11,
                fill: 'var(--rs-text-secondary)',
                fontFamily: 'var(--rs-sans)',
              }}
            />

            <YAxis
              domain={[0, maxScore]}
              tick={{ fontSize: 10, fill: 'var(--rs-text-secondary)', fontFamily: 'var(--rs-sans)' }}
              label={{
                value: 'riskScore',
                angle: -90,
                position: 'insideLeft',
                offset: 8,
                fontSize: 11,
                fill: 'var(--rs-text-secondary)',
                fontFamily: 'var(--rs-sans)',
              }}
            />

            <Tooltip content={<RiskTooltip />} />

            {/* LOW threshold */}
            <ReferenceLine
              y={LOW_THRESHOLD}
              stroke="var(--rs-warning)"
              strokeDasharray="5 3"
              strokeOpacity={0.8}
              label={{
                value: `LOW (${LOW_THRESHOLD})`,
                position: 'right',
                fontSize: 9,
                fill: 'var(--rs-warning)',
                fontFamily: 'var(--rs-sans)',
              }}
              ifOverflow="extendDomain"
            />

            {/* HIGH threshold */}
            <ReferenceLine
              y={HIGH_THRESHOLD}
              stroke="var(--rs-git-deleted)"
              strokeDasharray="5 3"
              strokeOpacity={0.8}
              label={{
                value: `HIGH (${HIGH_THRESHOLD})`,
                position: 'right',
                fontSize: 9,
                fill: 'var(--rs-git-deleted)',
                fontFamily: 'var(--rs-sans)',
              }}
              ifOverflow="extendDomain"
            />

            <Area
              type="monotone"
              dataKey="riskScore"
              stroke="var(--rs-git-deleted)"
              strokeWidth={1.5}
              fill={`url(#${GRADIENT_ID})`}
              dot={{
                r: 3,
                fill: 'var(--rs-git-deleted)',
                stroke: 'var(--rs-bg-elevated)',
                strokeWidth: 1,
              }}
              activeDot={{
                r: 5,
                fill: 'var(--rs-git-deleted)',
                stroke: 'var(--rs-bg-elevated)',
                strokeWidth: 1.5,
              }}
              isAnimationActive={false}
            />

            <Brush
              dataKey="dateLabel"
              height={24}
              travellerWidth={8}
              startIndex={defaultBrushStart}
              endIndex={defaultBrushEnd}
              stroke="var(--rs-border)"
              fill="var(--rs-bg-elevated)"
              travellerStyle={{ fill: 'var(--rs-text-muted)', stroke: 'var(--rs-border)' }}
              tick={{ fontSize: 9, fill: 'var(--rs-text-muted)', fontFamily: 'var(--rs-sans)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
