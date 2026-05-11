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
 * カラースケール (動的閾値対応 — Phase 1):
 *   score < low   → 透明 (セルは枠のみ)
 *   low ≤ s < high → --rs-warning  (opacity 0.15 ~ 0.45)
 *   s ≥ high       → --rs-git-deleted (opacity 0.5 ~ 1.0)
 *
 * Tooltip: Radix HoverCard + RiskFactorsCard で Risk 系 Lens 統一表示。
 * セルクリック → onSelectCommit(cell.topHash)
 */
import { useMemo, useState, useCallback } from 'react';
import type { Commit } from './data';
import type { LensId } from './LensSwitcher';
import { dayKey } from './dateKey';
import { LensHeader, RiskScoreLegend } from './LensHeader';
import {
  EmptyStateCard,
  RiskScoreLegendInline,
  type LensEmptyReason,
  type EmptyStateMessage,
} from './EmptyStateCard';
import {
  ThresholdSelector,
  useThresholdState,
  computeThresholds,
} from './lensThreshold';
import {
  RiskFactorsCard,
  buildRiskFactor,
  type RiskFactor,
} from './RiskFactorsCard';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskHeatmapLensProps = {
  commits: Commit[];
  onSelectCommit: (hash: string) => void;
  /** Empty state の関連 Lens ボタン + HoverCard "Trend で見る" 用 */
  onChangeLens?: (lens: LensId) => void;
  /**
   * セルの時間範囲を Trend Lens 等の dateRangeFilter に伝播するためのコールバック。
   * 30d-author モードでは該当日の 24h 範囲、
   * 7d-hour モードでは該当 1 時間範囲が渡される。
   */
  onSelectRange?: (fromTs: number, toTs: number) => void;
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

/** ローカル TZ 表示用ラベル — "Asia/Tokyo (UTC+9)" 形式 */
const LOCAL_TZ_LABEL: string = (() => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local';
    const offsetMin = -new Date().getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const oh = Math.floor(abs / 60);
    const om = abs % 60;
    const offsetStr = om === 0 ? `UTC${sign}${oh}` : `UTC${sign}${oh}:${String(om).padStart(2, '0')}`;
    return `${tz} (${offsetStr})`;
  } catch {
    return 'local';
  }
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO日時文字列 → Date (invalid なら null) */
function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** 動的閾値対応の score → [color string, opacity] */
function scoreToStyle(
  score: number,
  low: number,
  high: number,
): { background: string; opacity: number } {
  if (score <= 0 || score < low) {
    return { background: 'transparent', opacity: 0 };
  }
  if (score < high) {
    // warning gradient
    const range = Math.max(1, high - low);
    const t = Math.min((score - low) / range, 1);
    return { background: 'var(--rs-warning)', opacity: 0.15 + t * 0.3 };
  }
  // danger gradient
  const denom = Math.max(high, 1);
  const t = Math.min((score - high) / denom, 1);
  return { background: 'var(--rs-git-deleted)', opacity: 0.5 + t * 0.5 };
}

/** MM/DD 形式 */
function formatMD(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${m}/${dd}`;
}

/** YYYY/MM/DD HH:mm 形式 (HoverCard 用)。invalid input は空文字。 */
function formatDateTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
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
  lowThreshold: number;
  highThreshold: number;
  /** HoverCard 用 — cell.topHash から作った RiskFactor (なければ HoverCard を出さない) */
  factor?: RiskFactor;
  /** セル位置の集約情報（HoverCard ヘッダに表示） */
  cellLabel?: string;
  /** "Trend で見る" ボタンのコールバック (provided 時のみボタン表示) */
  onJumpToTrend?: () => void;
};

function HeatCell({
  cell,
  onClick,
  lowThreshold,
  highThreshold,
  factor,
  cellLabel,
  onJumpToTrend,
}: HeatCellProps) {
  const score = cell?.avgScore ?? 0;
  const style = scoreToStyle(score, lowThreshold, highThreshold);

  const cellInner = (
    <div
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

  if (!cell || !factor) {
    return cellInner;
  }

  return (
    <HoverCard openDelay={150} closeDelay={60}>
      <HoverCardTrigger asChild>{cellInner}</HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="w-auto p-0 border-0 bg-transparent shadow-none">
        <div
          style={{
            background: 'var(--rs-bg-elevated)',
            border: '1px solid var(--rs-border)',
            borderRadius: 'var(--rs-radius-sm)',
            padding: '8px 10px 4px',
            fontSize: 11,
            fontFamily: 'var(--rs-sans)',
            maxWidth: 320,
          }}
        >
          {cellLabel && (
            <div
              style={{
                fontFamily: 'var(--rs-mono)',
                fontSize: 10,
                color: 'var(--rs-text-secondary)',
                marginBottom: 4,
              }}
            >
              {cellLabel} · {cell.count} {cell.count === 1 ? 'commit' : 'commits'} ·
              max <span style={{ color: 'var(--rs-text)' }}>{cell.maxScore}</span> ·
              avg <span style={{ color: 'var(--rs-text)' }}>{cell.avgScore.toFixed(1)}</span>
            </div>
          )}
        </div>
        <RiskFactorsCard
          factor={factor}
          lowThreshold={lowThreshold}
          highThreshold={highThreshold}
          pointerEvents="auto"
        />
        {onJumpToTrend && (
          <div
            style={{
              marginTop: 4,
              padding: '6px 10px',
              background: 'var(--rs-bg-elevated)',
              border: '1px solid var(--rs-border)',
              borderTop: 'none',
              borderRadius: '0 0 var(--rs-radius-sm) var(--rs-radius-sm)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              type="button"
              onClick={onJumpToTrend}
              style={{
                height: 22,
                padding: '0 10px',
                fontSize: 10,
                fontFamily: 'var(--rs-sans)',
                border: '1px solid var(--rs-border)',
                borderRadius: 'var(--rs-radius-sm)',
                background: 'transparent',
                color: 'var(--rs-accent)',
                cursor: 'pointer',
              }}
            >
              Risk Trend で見る →
            </button>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * dayKey "YYYY-MM-DD" を該当日のローカル midnight epoch ms に変換。
 * 7d-hour モードでは hour offset を追加するため別途加算。
 */
function dayKeyToMidnightMs(dk: string): number | null {
  const m = dk.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(y, mo - 1, d).getTime();
}

const HOUR_MS = 60 * 60 * 1000;

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
      <ModeHelpPopover />
    </div>
  );
}

/**
 * Mode 切替の意味を伝える ? Popover (GAP-B)。
 * 「同一データの 2 ビュー」を明示し、各モードの用途を 1-2 行で説明する。
 */
function ModeHelpPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="モードの説明を表示"
          style={{
            width: 20,
            height: 20,
            marginLeft: 2,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--rs-radius-sm)',
            border: '1px solid var(--rs-border)',
            background: 'transparent',
            color: 'var(--rs-text-muted)',
            fontFamily: 'var(--rs-sans)',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs">
        <div
          style={{
            fontFamily: 'var(--rs-sans)',
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--rs-text-secondary)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--rs-text)', fontSize: 12 }}>
            モードについて
          </div>
          <div style={{ marginBottom: 6 }}>
            両モードは <b style={{ color: 'var(--rs-text)' }}>同じコミットデータの別ビュー</b> です。
            切替で集計範囲・軸が変わるだけで、ベースになるコミット集合は共通。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div>
              <span style={{ fontFamily: 'var(--rs-mono)', color: 'var(--rs-text)' }}>
                30d × author
              </span>
              : 直近 30 日、誰がいつリスク変更を入れたかを俯瞰
            </div>
            <div>
              <span style={{ fontFamily: 'var(--rs-mono)', color: 'var(--rs-text)' }}>
                7d × hour
              </span>
              : 直近 7 日、時間帯別パターン（リリース直前など）を確認
            </div>
          </div>
          <div
            style={{
              marginTop: 8,
              paddingTop: 6,
              borderTop: '1px solid var(--rs-border)',
              fontSize: 10,
              color: 'var(--rs-text-muted)',
            }}
          >
            <span style={{ fontFamily: 'var(--rs-mono)' }}>7d × hour</span> はローカルタイムゾーン
            基準で時刻を解釈します。
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function HeatmapLegend({ low, high }: { low: number; high: number }) {
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
      <span>avg risk:</span>
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
        &lt; {low}
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
        {low}–{high - 1}
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
        ≥ {high}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RiskHeatmapLens({
  commits,
  onSelectCommit,
  onChangeLens,
  onSelectRange,
}: RiskHeatmapLensProps) {
  const [mode, setMode] = useState<HeatmapMode>('30d-author');

  const handleModeToggle = useCallback((m: HeatmapMode) => {
    setMode(m);
  }, []);

  // 共通 ThresholdSelector の state を Trend と共有 (refscope.risk.threshold)
  const [threshold, setThreshold] = useThresholdState();
  const { lowThreshold, highThreshold } = useMemo(
    () => computeThresholds(threshold, commits.map((c) => c.riskScore ?? 0)),
    [threshold, commits],
  );

  // hash → Commit のルックアップマップ (HoverCard 内 Risk Factors 構築用)
  const commitByHash = useMemo(() => {
    const map = new Map<string, Commit>();
    for (const c of commits) map.set(c.hash, c);
    return map;
  }, [commits]);

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
  // Empty state — reason を区別 (Phase 1)
  // ---------------------------------------------------------------------------

  const emptyReason: LensEmptyReason | null = useMemo(() => {
    if (commits.length === 0) return 'no-commits';
    const hasValidDate = commits.some((c) => {
      const d = parseDate(c.authorDate);
      return d !== null;
    });
    if (!hasValidDate) return 'no-author-date';
    return null;
  }, [commits]);

  if (emptyReason) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          fontFamily: 'var(--rs-sans)',
        }}
      >
        <HeatmapLensHeader />
        <EmptyStateCard
          reason={emptyReason}
          messages={HEATMAP_EMPTY_MESSAGES}
          onChangeLens={onChangeLens}
          relatedLenses={HEATMAP_RELATED_LENSES}
          footer={<RiskScoreLegendInline />}
        />
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
      {/* Lens self-explanation header (Phase 1) */}
      <HeatmapLensHeader />

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ModeToggle mode={mode} onToggle={handleModeToggle} />
          <ThresholdSelector threshold={threshold} onChange={setThreshold} />
        </div>
        <HeatmapLegend low={lowThreshold} high={highThreshold} />
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
            commitByHash={commitByHash}
            onSelectCommit={onSelectCommit}
            onSelectRange={onSelectRange}
            onChangeLens={onChangeLens}
            labelW={LABEL_W}
            cellH={CELL_H}
            headerH={HEADER_H}
            lowThreshold={lowThreshold}
            highThreshold={highThreshold}
          />
        ) : (
          <DayHourGrid
            days={sevenDays}
            hours={hours}
            cellMap={dayHourMap}
            commitByHash={commitByHash}
            onSelectCommit={onSelectCommit}
            onSelectRange={onSelectRange}
            onChangeLens={onChangeLens}
            labelW={LABEL_W}
            cellH={CELL_H}
            headerH={HEADER_H}
            lowThreshold={lowThreshold}
            highThreshold={highThreshold}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lens-specific header + empty messages
// ---------------------------------------------------------------------------

function HeatmapLensHeader() {
  return (
    <LensHeader
      title="Risk Heatmap"
      oneLiner="いつ誰がリスクの高い変更を入れたかを俯瞰する — 同一データの 2 ビュー"
      helpAriaLabel="Risk Heatmap の意味を表示"
      helpContent={
        <>
          <RiskScoreLegend />
          <div
            style={{
              marginTop: 10,
              paddingTop: 8,
              borderTop: '1px solid var(--rs-border)',
              color: 'var(--rs-text-secondary)',
              fontSize: 11,
            }}
          >
            セル色は同セル内コミットの <b>平均</b> riskScore を反映。クリックすると
            該当セルで最も高 risk のコミット (cell.topHash) を選択。
          </div>
        </>
      }
    />
  );
}

const HEATMAP_EMPTY_MESSAGES: Partial<Record<LensEmptyReason, EmptyStateMessage>> = {
  'no-commits': {
    title: '表示するコミットがありません',
    body: '現在の選択範囲に該当するコミットがありません。ブランチ・期間フィルタを変更してみてください。',
  },
  'no-author-date': {
    title: 'authorDate が取得できませんでした',
    body: 'Heatmap は各コミットの authorDate が必要です。API の応答に authorDate が含まれているか確認してください。',
  },
};

const HEATMAP_RELATED_LENSES = [
  { id: 'risk-trend' as const, label: 'Risk Trend を開く' },
  { id: 'hotspot' as const, label: 'Hotspot を開く' },
];

// ---------------------------------------------------------------------------
// AuthorDayGrid
// ---------------------------------------------------------------------------

type AuthorDayGridProps = {
  days: string[];
  authors: string[];
  remainingAuthors: number;
  cellMap: Map<string, CellData>;
  commitByHash: Map<string, Commit>;
  onSelectCommit: (hash: string) => void;
  onSelectRange?: (fromTs: number, toTs: number) => void;
  onChangeLens?: (lens: LensId) => void;
  labelW: number;
  cellH: number;
  headerH: number;
  lowThreshold: number;
  highThreshold: number;
};

function AuthorDayGrid({
  days,
  authors,
  remainingAuthors,
  cellMap,
  commitByHash,
  onSelectCommit,
  onSelectRange,
  onChangeLens,
  labelW,
  cellH,
  headerH,
  lowThreshold,
  highThreshold,
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
            const topCommit = cell ? commitByHash.get(cell.topHash) : undefined;
            const factor = topCommit
              ? buildRiskFactor(topCommit, formatDateTime(topCommit.authorDate))
              : undefined;
            const dayStart = dayKeyToMidnightMs(d);
            const jumpToTrend =
              cell && dayStart !== null && onSelectRange && onChangeLens
                ? () => {
                    onSelectRange(dayStart, dayStart + DAY_MS - 1);
                    onChangeLens('risk-trend');
                  }
                : undefined;
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
                  lowThreshold={lowThreshold}
                  highThreshold={highThreshold}
                  factor={factor}
                  cellLabel={`${author} · ${d}`}
                  onJumpToTrend={jumpToTrend}
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
  commitByHash: Map<string, Commit>;
  onSelectCommit: (hash: string) => void;
  onSelectRange?: (fromTs: number, toTs: number) => void;
  onChangeLens?: (lens: LensId) => void;
  labelW: number;
  cellH: number;
  headerH: number;
  lowThreshold: number;
  highThreshold: number;
};

function DayHourGrid({
  days,
  hours,
  cellMap,
  commitByHash,
  onSelectCommit,
  onSelectRange,
  onChangeLens,
  labelW,
  cellH,
  headerH,
  lowThreshold,
  highThreshold,
}: DayHourGridProps) {
  const CELL_W = 40;
  const totalW = labelW + hours.length * CELL_W;

  return (
    <div style={{ minWidth: totalW }}>
      {/* Header: 時間ラベル + TZ 表示 (GAP-A) */}
      <div
        style={{
          display: 'flex',
          height: headerH,
          alignItems: 'flex-end',
          paddingBottom: 4,
          position: 'relative',
        }}
      >
        <div
          style={{
            width: labelW,
            flexShrink: 0,
            fontSize: 9,
            color: 'var(--rs-text-muted)',
            textAlign: 'right',
            paddingRight: 8,
            paddingBottom: 2,
          }}
          title={`タイムゾーン: ${LOCAL_TZ_LABEL}`}
        >
          tz: {LOCAL_TZ_LABEL}
        </div>
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
            {h % 3 === 0 ? `${h}h` : ''}
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
              const topCommit = cell ? commitByHash.get(cell.topHash) : undefined;
              const factor = topCommit
                ? buildRiskFactor(topCommit, formatDateTime(topCommit.authorDate))
                : undefined;
              const dayStart = dayKeyToMidnightMs(d);
              const hourStart = dayStart !== null ? dayStart + h * HOUR_MS : null;
              const jumpToTrend =
                cell && hourStart !== null && onSelectRange && onChangeLens
                  ? () => {
                      onSelectRange(hourStart, hourStart + HOUR_MS - 1);
                      onChangeLens('risk-trend');
                    }
                  : undefined;
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
                    lowThreshold={lowThreshold}
                    highThreshold={highThreshold}
                    factor={factor}
                    cellLabel={`${d} · ${String(h).padStart(2, '0')}:00`}
                    onJumpToTrend={jumpToTrend}
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
