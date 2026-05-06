/**
 * Risk Heatmap Lens — author × date のリスクスコアヒートマップ。
 *
 * モード A (デフォルト): 30d × author
 *   - Y軸: 著者 (最大 TOP_N=20)
 *   - X軸: 直近 30 日の日付
 * モード B: 7d × hour-of-day
 *   - Y軸: 直近 7 日の日付
 *   - X軸: 0-23 時
 *
 * カラースケール:
 *   score=0    → 透明 (セルは枠のみ)
 *   1-49       → --rs-warning  (opacity 0.15 ~ 0.45)
 *   50+        → --rs-git-deleted (opacity 0.5 ~ 1.0)
 *
 * セル tooltip: title 属性で実装 (Radix 非依存)
 * セルクリック → onSelectCommit(hash)
 */
import { useMemo, useState, useCallback } from 'react';
import type { Commit } from './data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskHeatmapLensProps = {
  commits: Commit[];
  onSelectCommit: (hash: string) => void;
};

type HeatmapMode = '30d-author' | '7d-hour';

type CellData = {
  /** 平均 riskScore (コミット件数 >= 1 のとき) */
  avgScore: number;
  maxScore: number;
  count: number;
  /** max riskScore のコミット hash */
  topHash: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOP_N = 20; // 著者数上限
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** yyyy-mm-dd 形式のキーを返す */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** ISO日時文字列 → Date (invalid なら null) */
function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** score → [color string, opacity] */
function scoreToStyle(score: number): { background: string; opacity: number } {
  if (score <= 0) {
    return { background: 'transparent', opacity: 0 };
  }
  if (score < 50) {
    // warning: opacity 0.15 (score=1) → 0.45 (score=49)
    const t = Math.min((score - 1) / 48, 1);
    return { background: 'var(--rs-warning)', opacity: 0.15 + t * 0.3 };
  }
  // danger: opacity 0.5 (score=50) → 1.0 (score=100+)
  const t = Math.min((score - 50) / 50, 1);
  return { background: 'var(--rs-git-deleted)', opacity: 0.5 + t * 0.5 };
}

/** MM/DD 形式 */
function formatMD(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${m}/${dd}`;
}

// ---------------------------------------------------------------------------
// 30d × author モードのデータ計算
// ---------------------------------------------------------------------------

type AuthorDayKey = `${string}::${string}`; // `${author}::${dayKey}`

function buildAuthorDayMap(
  commits: Commit[],
  days: string[],
  topAuthors: string[],
): Map<AuthorDayKey, CellData> {
  const daySet = new Set(days);
  const authorSet = new Set(topAuthors);

  const acc = new Map<AuthorDayKey, { sum: number; max: number; count: number; topHash: string }>();

  for (const c of commits) {
    const d = parseDate(c.authorDate ?? c.time);
    if (!d) continue;
    const dk = dayKey(d);
    if (!daySet.has(dk)) continue;
    if (!authorSet.has(c.author)) continue;

    const score = c.riskScore ?? 0;
    const k = `${c.author}::${dk}` as AuthorDayKey;
    const prev = acc.get(k);
    if (!prev) {
      acc.set(k, { sum: score, max: score, count: 1, topHash: c.hash });
    } else {
      prev.sum += score;
      prev.count += 1;
      if (score > prev.max) {
        prev.max = score;
        prev.topHash = c.hash;
      }
    }
  }

  const result = new Map<AuthorDayKey, CellData>();
  for (const [k, v] of acc) {
    result.set(k, {
      avgScore: v.sum / v.count,
      maxScore: v.max,
      count: v.count,
      topHash: v.topHash,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 7d × hour-of-day モードのデータ計算
// ---------------------------------------------------------------------------

type DayHourKey = `${string}::${number}`; // `${dayKey}::${hour}`

function buildDayHourMap(
  commits: Commit[],
  days: string[],
): Map<DayHourKey, CellData> {
  const daySet = new Set(days);
  const acc = new Map<DayHourKey, { sum: number; max: number; count: number; topHash: string }>();

  for (const c of commits) {
    const d = parseDate(c.authorDate ?? c.time);
    if (!d) continue;
    const dk = dayKey(d);
    if (!daySet.has(dk)) continue;

    const hour = d.getHours();
    const score = c.riskScore ?? 0;
    const k = `${dk}::${hour}` as DayHourKey;
    const prev = acc.get(k);
    if (!prev) {
      acc.set(k, { sum: score, max: score, count: 1, topHash: c.hash });
    } else {
      prev.sum += score;
      prev.count += 1;
      if (score > prev.max) {
        prev.max = score;
        prev.topHash = c.hash;
      }
    }
  }

  const result = new Map<DayHourKey, CellData>();
  for (const [k, v] of acc) {
    result.set(k, {
      avgScore: v.sum / v.count,
      maxScore: v.max,
      count: v.count,
      topHash: v.topHash,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type HeatCellProps = {
  cell: CellData | undefined;
  onClick: (() => void) | undefined;
};

function HeatCell({ cell, onClick }: HeatCellProps) {
  const score = cell?.avgScore ?? 0;
  const style = scoreToStyle(score);

  const title = cell
    ? `コミット: ${cell.count} / 平均 score: ${cell.avgScore.toFixed(1)} / 最大 score: ${cell.maxScore}`
    : undefined;

  return (
    <div
      title={title}
      onClick={onClick}
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        borderRadius: 2,
        cursor: cell ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background layer with color */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: style.background,
          opacity: style.opacity,
          borderRadius: 2,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode toggle button
// ---------------------------------------------------------------------------

type ModeToggleProps = {
  mode: HeatmapMode;
  onToggle: (m: HeatmapMode) => void;
};

function ModeToggle({ mode, onToggle }: ModeToggleProps) {
  const btnBase: React.CSSProperties = {
    height: 22,
    padding: '0 8px',
    fontSize: 11,
    fontFamily: 'var(--rs-sans)',
    borderRadius: 'var(--rs-radius-sm)',
    border: '1px solid var(--rs-border)',
    cursor: 'pointer',
    transition: 'background 80ms ease-out, color 80ms ease-out',
  };
  const active: React.CSSProperties = {
    background: 'var(--rs-accent)',
    color: 'var(--rs-bg-panel)',
    fontWeight: 600,
    border: '1px solid var(--rs-accent)',
  };
  const inactive: React.CSSProperties = {
    background: 'transparent',
    color: 'var(--rs-text-secondary)',
  };

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button
        type="button"
        style={{ ...btnBase, ...(mode === '30d-author' ? active : inactive) }}
        onClick={() => onToggle('30d-author')}
      >
        30d × author
      </button>
      <button
        type="button"
        style={{ ...btnBase, ...(mode === '7d-hour' ? active : inactive) }}
        onClick={() => onToggle('7d-hour')}
      >
        7d × hour
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function HeatmapLegend() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 10,
        fontFamily: 'var(--rs-sans)',
        color: 'var(--rs-text-secondary)',
      }}
    >
      <span>risk:</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            border: '1px solid var(--rs-border)',
            borderRadius: 2,
          }}
        />
        none
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            background: 'var(--rs-warning)',
            opacity: 0.4,
            borderRadius: 2,
          }}
        />
        1–49
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            background: 'var(--rs-git-deleted)',
            opacity: 0.85,
            borderRadius: 2,
          }}
        />
        50+
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RiskHeatmapLens({ commits, onSelectCommit }: RiskHeatmapLensProps) {
  const [mode, setMode] = useState<HeatmapMode>('30d-author');

  const handleModeToggle = useCallback((m: HeatmapMode) => {
    setMode(m);
  }, []);

  // --- 30d × author ---
  const thirtyDays = useMemo<string[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result: string[] = [];
    for (let i = 29; i >= 0; i--) {
      result.push(dayKey(new Date(today.getTime() - i * DAY_MS)));
    }
    return result;
  }, []);

  /** 著者ランキング (コミット数順, top 20) */
  const topAuthors = useMemo<string[]>(() => {
    const counts = new Map<string, number>();
    for (const c of commits) {
      counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, TOP_N).map(([author]) => author);
  }, [commits]);

  const remainingAuthors = useMemo(() => {
    const totalAuthors = new Set(commits.map((c) => c.author)).size;
    return Math.max(0, totalAuthors - topAuthors.length);
  }, [commits, topAuthors]);

  const authorDayMap = useMemo(
    () => buildAuthorDayMap(commits, thirtyDays, topAuthors),
    [commits, thirtyDays, topAuthors],
  );

  // --- 7d × hour ---
  const sevenDays = useMemo<string[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result: string[] = [];
    for (let i = 6; i >= 0; i--) {
      result.push(dayKey(new Date(today.getTime() - i * DAY_MS)));
    }
    return result;
  }, []);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  const dayHourMap = useMemo(
    () => buildDayHourMap(commits, sevenDays),
    [commits, sevenDays],
  );

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  if (commits.length === 0) {
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
        No commits to plot
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const LABEL_W = 180; // 著者ラベル列の幅 (px)
  const CELL_H = 36;   // セル高さ (px)
  const HEADER_H = 44; // ヘッダ行の高さ (px)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        fontFamily: 'var(--rs-sans)',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          flexShrink: 0,
          gap: 8,
        }}
      >
        <ModeToggle mode={mode} onToggle={handleModeToggle} />
        <HeatmapLegend />
      </div>

      {/* Grid area */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 12px 12px',
        }}
      >
        {mode === '30d-author' ? (
          <AuthorDayGrid
            days={thirtyDays}
            authors={topAuthors}
            remainingAuthors={remainingAuthors}
            cellMap={authorDayMap}
            onSelectCommit={onSelectCommit}
            labelW={LABEL_W}
            cellH={CELL_H}
            headerH={HEADER_H}
          />
        ) : (
          <DayHourGrid
            days={sevenDays}
            hours={hours}
            cellMap={dayHourMap}
            onSelectCommit={onSelectCommit}
            labelW={LABEL_W}
            cellH={CELL_H}
            headerH={HEADER_H}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AuthorDayGrid
// ---------------------------------------------------------------------------

type AuthorDayGridProps = {
  days: string[];
  authors: string[];
  remainingAuthors: number;
  cellMap: Map<string, CellData>;
  onSelectCommit: (hash: string) => void;
  labelW: number;
  cellH: number;
  headerH: number;
};

function AuthorDayGrid({
  days,
  authors,
  remainingAuthors,
  cellMap,
  onSelectCommit,
  labelW,
  cellH,
  headerH,
}: AuthorDayGridProps) {
  const CELL_W = 32;

  const totalW = labelW + days.length * CELL_W;

  // 週単位の目印インデックス (0, 7, 14, 21, 28)
  const weekStarts = useMemo(
    () => days.reduce<number[]>((acc, d, i) => {
      const date = new Date(d + 'T00:00:00');
      if (date.getDay() === 0 || i === 0) acc.push(i);
      return acc;
    }, []),
    [days],
  );

  return (
    <div style={{ minWidth: totalW }}>
      {/* Header: 日付ラベル */}
      <div
        style={{
          display: 'flex',
          height: headerH,
          alignItems: 'flex-end',
          paddingBottom: 4,
          gap: 0,
        }}
      >
        <div style={{ width: labelW, flexShrink: 0 }} />
        {days.map((d, i) => {
          const showLabel = weekStarts.includes(i);
          const date = new Date(d + 'T00:00:00');
          return (
            <div
              key={d}
              style={{
                width: CELL_W,
                flexShrink: 0,
                fontSize: 11,
                color: 'var(--rs-text-secondary)',
                textAlign: 'center',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                transform: 'rotate(-45deg)',
                transformOrigin: 'center bottom',
              }}
            >
              {showLabel ? formatMD(date) : ''}
            </div>
          );
        })}
      </div>

      {/* Rows: 著者 × 日付 */}
      {authors.map((author) => (
        <div
          key={author}
          style={{
            display: 'flex',
            height: cellH,
            alignItems: 'center',
            gap: 0,
            marginBottom: 2,
          }}
        >
          {/* Author label */}
          <div
            style={{
              width: labelW,
              flexShrink: 0,
              fontSize: 13,
              color: 'var(--rs-text)',
              paddingRight: 8,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'right',
            }}
            title={author}
          >
            {author}
          </div>

          {/* Cells */}
          {days.map((d) => {
            const key = `${author}::${d}` as const;
            const cell = cellMap.get(key);
            return (
              <div
                key={d}
                style={{
                  width: CELL_W - 2,
                  height: cellH - 4,
                  flexShrink: 0,
                  marginRight: 2,
                  border: '1px solid var(--rs-border)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <HeatCell
                  cell={cell}
                  onClick={
                    cell
                      ? () => onSelectCommit(cell.topHash)
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      ))}

      {/* "and N more" footer */}
      {remainingAuthors > 0 && (
        <div
          style={{
            paddingLeft: labelW,
            fontSize: 12,
            color: 'var(--rs-text-secondary)',
            marginTop: 4,
          }}
        >
          and {remainingAuthors} more author{remainingAuthors !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DayHourGrid
// ---------------------------------------------------------------------------

type DayHourGridProps = {
  days: string[];
  hours: number[];
  cellMap: Map<string, CellData>;
  onSelectCommit: (hash: string) => void;
  labelW: number;
  cellH: number;
  headerH: number;
};

function DayHourGrid({
  days,
  hours,
  cellMap,
  onSelectCommit,
  labelW,
  cellH,
  headerH,
}: DayHourGridProps) {
  const CELL_W = 40;
  const totalW = labelW + hours.length * CELL_W;

  return (
    <div style={{ minWidth: totalW }}>
      {/* Header: 時間ラベル */}
      <div
        style={{
          display: 'flex',
          height: headerH,
          alignItems: 'flex-end',
          paddingBottom: 4,
        }}
      >
        <div style={{ width: labelW, flexShrink: 0 }} />
        {hours.map((h) => (
          <div
            key={h}
            style={{
              width: CELL_W,
              flexShrink: 0,
              fontSize: 9,
              color: 'var(--rs-text-secondary)',
              textAlign: 'center',
            }}
          >
            {h % 6 === 0 ? `${h}h` : ''}
          </div>
        ))}
      </div>

      {/* Rows: 日付 × 時間 */}
      {days.map((d) => {
        const date = new Date(d + 'T00:00:00');
        return (
          <div
            key={d}
            style={{
              display: 'flex',
              height: cellH,
              alignItems: 'center',
              gap: 0,
              marginBottom: 2,
            }}
          >
            {/* Day label */}
            <div
              style={{
                width: labelW,
                flexShrink: 0,
                fontSize: 11,
                color: 'var(--rs-text)',
                paddingRight: 8,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'right',
              }}
            >
              {formatMD(date)}
            </div>

            {/* Cells */}
            {hours.map((h) => {
              const key = `${d}::${h}` as const;
              const cell = cellMap.get(key);
              return (
                <div
                  key={h}
                  style={{
                    width: CELL_W - 2,
                    height: cellH - 4,
                    flexShrink: 0,
                    marginRight: 2,
                    border: '1px solid var(--rs-border)',
                    borderRadius: 2,
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <HeatCell
                    cell={cell}
                    onClick={
                      cell
                        ? () => onSelectCommit(cell.topHash)
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
