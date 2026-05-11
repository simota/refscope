/**
 * Risk Trend Lens — riskScore の時系列 AreaChart。
 *
 * - 横軸: authorDate (時刻順)
 * - 縦軸: riskScore (0–∞)
 * - 閾値ライン: LOW=1 (warning), HIGH=50 (danger)
 * - Brush でズーム可能
 * - 点クリック → onSelectCommit(hash)
 * - 空 / 全 score=0 / authorDate 欠落 → 3 状態を区別したプレースホルダ
 *
 * Self-explanation header は LensHeader primitive を使用。
 * Empty state Card もこのファイル内に local 実装で残存（Phase 2 で共通化予定）。
 */
import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Brush,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import type { Commit, CoarseKind, SignatureStatus } from './data';
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
  DEFAULT_LOW,
  DEFAULT_HIGH,
  type ThresholdState,
} from './lensThreshold';
import {
  RiskFactorsCard,
  pickTopFiles,
  type TopFile,
} from './RiskFactorsCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskTrendLensProps = {
  commits: Commit[];
  onSelectCommit: (hash: string) => void;
  /** Lens 間遷移（Empty State のナビゲーションに使用）。未指定時はボタン非表示。 */
  onChangeLens?: (lens: LensId) => void;
  /**
   * チャート上のドラッグ範囲選択結果。`from <= to` の epoch ms。
   * 親が CommitTimeline などへフィルタを伝播する想定。
   * 未指定時はドラッグ範囲選択 UI が無効化される。
   */
  onSelectRange?: (fromTs: number, toTs: number) => void;
};

type ChartPoint = {
  hash: string;
  subject: string;
  author: string;
  /** ms since epoch — used as numeric X axis value */
  ts: number;
  /** X 軸用の短いラベル "MM/DD" */
  dateLabel: string;
  /** Tooltip 用の高精度ラベル "YYYY/MM/DD HH:mm" */
  dateTimeLabel: string;
  riskScore: number;
  /** Per-commit モードでの 7-commit 単純移動平均 (P1) */
  ma7?: number;
  // Risk factors — Commit 既存フィールドから派生
  added: number;
  deleted: number;
  fileCount: number;
  coarseKind?: CoarseKind;
  isMerge: boolean;
  signatureStatus?: SignatureStatus;
  topFiles: TopFile[];
};

/** Per-day 集約点 (P1) */
type DailyPoint = {
  dayKey: string;
  ts: number;
  /** X 軸用ラベル "MM/DD" */
  dateLabel: string;
  /** Tooltip 用ラベル "YYYY/MM/DD" */
  dateTimeLabel: string;
  /** 同日内の max(riskScore) */
  maxScore: number;
  /** 同日内の mean(riskScore) — 小数1位丸め */
  meanScore: number;
  /** 同日コミット数 */
  commitCount: number;
  /** max を担うコミットの hash / subject / author */
  topHash: string;
  topSubject: string;
  topAuthor: string;
  /** Per-day モードでの 7-day max の単純移動平均 (P1) */
  ma7?: number;
};

export type AggregationMode = 'per-commit' | 'per-day';

const TOP_FILE_COUNT = 3;

// ---------------------------------------------------------------------------
// Aggregation view state (P1) — Per-commit / Per-day + MA toggle
// ---------------------------------------------------------------------------

export type ViewState = {
  aggregation: AggregationMode;
  showMA: boolean;
};

const VIEW_STORAGE_KEY = 'refscope.riskTrend.view';
const DEFAULT_VIEW: ViewState = { aggregation: 'per-commit', showMA: true };

function loadViewState(): ViewState {
  if (typeof window === 'undefined') return DEFAULT_VIEW;
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    if (
      (parsed.aggregation === 'per-commit' || parsed.aggregation === 'per-day') &&
      typeof parsed.showMA === 'boolean'
    ) {
      return { aggregation: parsed.aggregation, showMA: parsed.showMA };
    }
  } catch {
    // ignore corrupt storage
  }
  return DEFAULT_VIEW;
}

function saveViewState(s: ViewState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota / disabled storage
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** X 軸 tick 用 — "MM/DD" の短いラベル */
function formatDateTick(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

/** Tooltip 用 — "YYYY/MM/DD HH:mm" の高精度ラベル */
function formatDateTimeTooltip(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}


/** 同日コミットを集約して DailyPoint[] を返す (P1) */
function aggregateDaily(points: ChartPoint[]): DailyPoint[] {
  if (points.length === 0) return [];
  const groups = new Map<string, ChartPoint[]>();
  for (const p of points) {
    const d = new Date(p.ts);
    const k = dayKey(d);
    const arr = groups.get(k);
    if (arr) {
      arr.push(p);
    } else {
      groups.set(k, [p]);
    }
  }
  const result: DailyPoint[] = [];
  for (const [k, arr] of groups) {
    let max = -Infinity;
    let sum = 0;
    let top = arr[0];
    for (const p of arr) {
      sum += p.riskScore;
      if (p.riskScore > max) {
        max = p.riskScore;
        top = p;
      }
    }
    const d = new Date(arr[0].ts);
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    result.push({
      dayKey: k,
      ts: midnight,
      dateLabel: `${mm}/${dd}`,
      dateTimeLabel: `${d.getFullYear()}/${mm}/${dd}`,
      maxScore: max,
      meanScore: Math.round((sum / arr.length) * 10) / 10,
      commitCount: arr.length,
      topHash: top.hash,
      topSubject: top.subject,
      topAuthor: top.author,
    });
  }
  return result.sort((a, b) => a.ts - b.ts);
}

/** 単純移動平均を計算して `ma7` フィールドに格納する */
function attachMovingAverage<T extends Record<string, unknown>>(
  points: T[],
  getScore: (p: T) => number,
  window: number,
): T[] {
  return points.map((p, i) => {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    let n = 0;
    for (let j = start; j <= i; j++) {
      sum += getScore(points[j]);
      n += 1;
    }
    return { ...p, ma7: n > 0 ? Math.round((sum / n) * 10) / 10 : undefined };
  });
}

// ---------------------------------------------------------------------------
// Custom Tooltip with Risk Factors
// ---------------------------------------------------------------------------

type RiskTooltipPayload = {
  payload?: ChartPoint;
};

type RiskTooltipProps = TooltipProps<number, string> & {
  lowThreshold: number;
  highThreshold: number;
};

function RiskTooltip({ active, payload, lowThreshold, highThreshold }: RiskTooltipProps) {
  if (!active || !payload?.length) return null;
  const item = (payload[0] as RiskTooltipPayload).payload;
  if (!item) return null;
  return (
    <RiskFactorsCard
      factor={item}
      lowThreshold={lowThreshold}
      highThreshold={highThreshold}
    />
  );
}

// ---------------------------------------------------------------------------
// Daily Tooltip (P1) — per-day モード用
// ---------------------------------------------------------------------------

type DailyTooltipProps = TooltipProps<number, string> & {
  lowThreshold: number;
  highThreshold: number;
};

function DailyTooltip({ active, payload, lowThreshold, highThreshold }: DailyTooltipProps) {
  if (!active || !payload?.length) return null;
  const item = (payload[0] as { payload?: DailyPoint }).payload;
  if (!item) return null;

  const score = item.maxScore;
  const scoreColor =
    score >= highThreshold
      ? 'var(--rs-git-deleted)'
      : score >= lowThreshold
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
        maxWidth: 320,
        pointerEvents: 'none',
        lineHeight: 1.45,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--rs-mono)',
          fontSize: 10,
          color: 'var(--rs-text-secondary)',
          marginBottom: 4,
        }}
      >
        {item.dateTimeLabel}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ color: scoreColor, fontWeight: 600 }}>max: {item.maxScore}</span>
        <span style={{ color: 'var(--rs-text-secondary)' }}>mean: {item.meanScore}</span>
        <span style={{ color: 'var(--rs-text-muted)' }}>
          {item.commitCount} {item.commitCount === 1 ? 'commit' : 'commits'}
        </span>
      </div>

      <div
        style={{
          borderTop: '1px solid var(--rs-border)',
          paddingTop: 6,
          color: 'var(--rs-text-secondary)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--rs-mono)',
            fontSize: 10,
            color: 'var(--rs-text-muted)',
            marginBottom: 2,
          }}
        >
          top: {item.topHash.slice(0, 7)}
        </div>
        <div
          style={{
            color: 'var(--rs-text)',
            wordBreak: 'break-all',
            marginBottom: 2,
          }}
        >
          {item.topSubject}
        </div>
        <div style={{ color: 'var(--rs-text-secondary)', fontSize: 10 }}>{item.topAuthor}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lens-specific header — LensHeader primitive を使用 (riskScore 用)
// ---------------------------------------------------------------------------

function RiskTrendLensHeader() {
  return (
    <LensHeader
      title="Risk Trend"
      oneLiner="riskScore の時系列推移 — どのコミットがリスクの転機だったかを辿る"
      helpAriaLabel="riskScore の意味を表示"
      helpContent={<RiskScoreLegend />}
    />
  );
}

// ---------------------------------------------------------------------------
// Lens-specific empty-state messages (3 区別)
// ---------------------------------------------------------------------------

const TREND_EMPTY_MESSAGES: Partial<Record<LensEmptyReason, EmptyStateMessage>> = {
  'no-commits': {
    title: '表示するコミットがありません',
    body: '現在の選択範囲に該当するコミットがありません。ブランチ・期間フィルタを変更してみてください。',
  },
  'no-risky': {
    title: 'リスクスコアの高いコミットがありません',
    body: '全コミットの riskScore が 0 です。LOW (1) 以上のコミットが見つからないため、トレンドは描画されません。',
  },
  'no-author-date': {
    title: 'authorDate が取得できませんでした',
    body: 'プロットには各コミットの authorDate が必要です。API の応答に authorDate が含まれているか確認してください。',
  },
};

const TREND_RELATED_LENSES = [
  { id: 'risk-heatmap' as const, label: 'Risk Heatmap を開く' },
  { id: 'hotspot' as const, label: 'Hotspot を開く' },
];

// ---------------------------------------------------------------------------
// Aggregation Selector (P1) — Per-commit / Per-day + MA toggle
// ---------------------------------------------------------------------------

function AggregationSelector({
  view,
  onChange,
}: {
  view: ViewState;
  onChange: (next: ViewState) => void;
}) {
  const modeLabel = view.aggregation === 'per-commit' ? 'Per-commit' : 'Per-day';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        aria-label={`集約モード: ${modeLabel}`}
        onClick={() =>
          onChange({
            ...view,
            aggregation: view.aggregation === 'per-commit' ? 'per-day' : 'per-commit',
          })
        }
        style={{
          height: 22,
          padding: '0 8px',
          fontSize: 10,
          fontFamily: 'var(--rs-sans)',
          border: '1px solid var(--rs-border)',
          borderRadius: 'var(--rs-radius-sm)',
          background: 'transparent',
          color: 'var(--rs-text-secondary)',
          cursor: 'pointer',
        }}
      >
        集約: {modeLabel} ⇄
      </button>
      <button
        type="button"
        aria-pressed={view.showMA}
        aria-label={view.showMA ? '7日移動平均を非表示' : '7日移動平均を表示'}
        onClick={() => onChange({ ...view, showMA: !view.showMA })}
        style={{
          height: 22,
          padding: '0 8px',
          fontSize: 10,
          fontFamily: 'var(--rs-sans)',
          border: '1px solid',
          borderColor: view.showMA
            ? 'color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)'
            : 'var(--rs-border)',
          borderRadius: 'var(--rs-radius-sm)',
          background: view.showMA
            ? 'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 12%)'
            : 'transparent',
          color: view.showMA ? 'var(--rs-accent)' : 'var(--rs-text-muted)',
          cursor: 'pointer',
        }}
      >
        MA-7 {view.showMA ? 'on' : 'off'}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Gradient defs id — stable between renders
// ---------------------------------------------------------------------------

const GRADIENT_ID = 'riskTrendGradient';

// ---------------------------------------------------------------------------
// Function dot — WCAG 2.5.8 target size 対応 (GAP-B)
//   riskScore >= lowThreshold の点に透明な r=12 overlay を重ねる。
//   視覚サイズ (r=3) は変えずクリック可能領域だけ拡大。
//   score=0 の点には overlay を付けない (P14 Downsampling と整合)。
// ---------------------------------------------------------------------------

type RiskDotProps = {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: ChartPoint;
  /** 動的閾値 — score >= lowThreshold の点だけ hit overlay を載せる */
  lowThreshold?: number;
};

function RiskDot({ cx, cy, index, payload, lowThreshold = DEFAULT_LOW }: RiskDotProps) {
  if (typeof cx !== 'number' || typeof cy !== 'number') return null;
  const score = payload?.riskScore ?? 0;
  return (
    <g>
      {/* Visible dot — 既存スタイルを維持 */}
      <circle
        cx={cx}
        cy={cy}
        r={3}
        fill="var(--rs-git-deleted)"
        stroke="var(--rs-bg-elevated)"
        strokeWidth={1}
      />
      {/* Invisible hit overlay — WCAG 2.5.8 (≥ 24px) を満たすため r=12 */}
      {score >= lowThreshold && (
        <circle
          key={`overlay-${index ?? ''}`}
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          stroke="none"
          style={{ pointerEvents: 'all', cursor: 'pointer' }}
        />
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RiskTrendLens({
  commits,
  onSelectCommit,
  onChangeLens,
  onSelectRange,
}: RiskTrendLensProps) {
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
        dateLabel: formatDateTick(dateStr),
        dateTimeLabel: formatDateTimeTooltip(dateStr),
        riskScore: commit.riskScore ?? 0,
        added: commit.added ?? 0,
        deleted: commit.deleted ?? 0,
        fileCount: commit.fileCount ?? commit.files?.length ?? 0,
        coarseKind: commit.coarseKind,
        isMerge: !!commit.isMerge,
        signatureStatus: commit.signatureStatus,
        topFiles: pickTopFiles(commit.files ?? [], TOP_FILE_COUNT),
      });
    }
    // Oldest → newest (left → right)
    return points.sort((a, b) => a.ts - b.ts);
  }, [commits]);

  // ---------------------------------------------------------------------------
  // Range selection state (P4)
  // ---------------------------------------------------------------------------

  const [dragStartIdx, setDragStartIdx] = useState<number | null>(null);
  const [dragEndIdx, setDragEndIdx] = useState<number | null>(null);
  const dragOccurredRef = useRef(false);
  const DRAG_INDEX_THRESHOLD = 2; // この差以下はクリックとみなす

  const handleClick = useCallback(
    (data: unknown) => {
      // Drag が確定した直後の click イベントは抑制
      if (dragOccurredRef.current) {
        dragOccurredRef.current = false;
        return;
      }
      // recharts AreaChart onClick passes ActivePayload — per-commit / per-day 両対応
      const ev = data as
        | { activePayload?: Array<{ payload: ChartPoint | DailyPoint }> }
        | null;
      const point = ev?.activePayload?.[0]?.payload;
      if (!point) return;
      if ('hash' in point && point.hash) {
        onSelectCommit(point.hash);
      } else if ('topHash' in point && point.topHash) {
        onSelectCommit(point.topHash);
      }
    },
    [onSelectCommit],
  );

  // ---------------------------------------------------------------------------
  // Threshold mode state (P9) — 共通 primitive 経由で永続化
  // ---------------------------------------------------------------------------

  const [threshold, setThreshold] = useThresholdState();

  // ---------------------------------------------------------------------------
  // Aggregation view state (P1) — localStorage 永続化
  // ---------------------------------------------------------------------------

  const [view, setView] = useState<ViewState>(loadViewState);
  useEffect(() => {
    saveViewState(view);
  }, [view]);

  // Per-commit / Per-day いずれかの系列を MA 付きで構築
  const perCommitSeries = useMemo(() => {
    if (view.aggregation !== 'per-commit') return [] as ChartPoint[];
    if (!view.showMA) return chartData;
    return attachMovingAverage(chartData, (p) => p.riskScore, 7);
  }, [chartData, view.aggregation, view.showMA]);

  const perDaySeries = useMemo(() => {
    if (view.aggregation !== 'per-day') return [] as DailyPoint[];
    const daily = aggregateDaily(chartData);
    if (!view.showMA) return daily;
    return attachMovingAverage(daily, (d) => d.maxScore, 7);
  }, [chartData, view.aggregation, view.showMA]);

  const seriesLength =
    view.aggregation === 'per-commit' ? perCommitSeries.length : perDaySeries.length;

  // Range selection handlers (P4)
  const handleMouseDown = useCallback(
    (data: unknown) => {
      if (!onSelectRange) return;
      const ev = data as { activeTooltipIndex?: number } | null;
      if (typeof ev?.activeTooltipIndex === 'number') {
        setDragStartIdx(ev.activeTooltipIndex);
        setDragEndIdx(ev.activeTooltipIndex);
      }
    },
    [onSelectRange],
  );

  const handleMouseMove = useCallback(
    (data: unknown) => {
      if (!onSelectRange || dragStartIdx === null) return;
      const ev = data as { activeTooltipIndex?: number } | null;
      if (typeof ev?.activeTooltipIndex === 'number') {
        setDragEndIdx(ev.activeTooltipIndex);
      }
    },
    [onSelectRange, dragStartIdx],
  );

  const handleMouseUp = useCallback(() => {
    if (!onSelectRange || dragStartIdx === null || dragEndIdx === null) {
      setDragStartIdx(null);
      setDragEndIdx(null);
      return;
    }
    const span = Math.abs(dragEndIdx - dragStartIdx);
    if (span >= DRAG_INDEX_THRESHOLD) {
      const lo = Math.min(dragStartIdx, dragEndIdx);
      const hi = Math.max(dragStartIdx, dragEndIdx);
      const seriesData =
        view.aggregation === 'per-commit' ? perCommitSeries : perDaySeries;
      const fromTs = seriesData[lo]?.ts;
      const toTs = seriesData[hi]?.ts;
      if (Number.isFinite(fromTs) && Number.isFinite(toTs)) {
        // Per-day モードでは day midnight が ts なので、上限は +1日して "丸ごと含める"
        const inclusiveTo =
          view.aggregation === 'per-day' ? toTs + 24 * 60 * 60 * 1000 - 1 : toTs;
        onSelectRange(fromTs, inclusiveTo);
        dragOccurredRef.current = true;
      }
    }
    setDragStartIdx(null);
    setDragEndIdx(null);
  }, [onSelectRange, dragStartIdx, dragEndIdx, view.aggregation, perCommitSeries, perDaySeries]);

  const handleMouseLeave = useCallback(() => {
    setDragStartIdx(null);
    setDragEndIdx(null);
  }, []);

  // ReferenceArea の dataKey 値 (dateLabel) を計算
  const dragRefArea = useMemo(() => {
    if (dragStartIdx === null || dragEndIdx === null) return null;
    if (Math.abs(dragEndIdx - dragStartIdx) < 1) return null;
    const seriesData =
      view.aggregation === 'per-commit' ? perCommitSeries : perDaySeries;
    const lo = Math.min(dragStartIdx, dragEndIdx);
    const hi = Math.max(dragStartIdx, dragEndIdx);
    const x1 = seriesData[lo]?.dateLabel;
    const x2 = seriesData[hi]?.dateLabel;
    if (!x1 || !x2) return null;
    return { x1, x2 };
  }, [dragStartIdx, dragEndIdx, view.aggregation, perCommitSeries, perDaySeries]);

  const { lowThreshold, highThreshold } = useMemo(
    () => computeThresholds(threshold, chartData.map((p) => p.riskScore)),
    [threshold, chartData],
  );

  // ---------------------------------------------------------------------------
  // Empty-state classification — 3 区別 (P10)
  // ---------------------------------------------------------------------------

  const emptyReason: LensEmptyReason | null = useMemo(() => {
    if (commits.length === 0) return 'no-commits';
    if (chartData.length === 0) return 'no-author-date';
    if (chartData.every((p) => p.riskScore === 0)) return 'no-risky';
    return null;
  }, [commits, chartData]);

  if (emptyReason) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <RiskTrendLensHeader />
        <EmptyStateCard
          reason={emptyReason}
          messages={TREND_EMPTY_MESSAGES}
          onChangeLens={onChangeLens}
          relatedLenses={TREND_RELATED_LENSES}
          footer={<RiskScoreLegendInline />}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Chart view
  // ---------------------------------------------------------------------------

  // Y軸スケール — モードに応じて系列の最大値から算出
  const maxScore =
    view.aggregation === 'per-commit'
      ? Math.max(...perCommitSeries.map((p) => p.riskScore), highThreshold + 10)
      : Math.max(...perDaySeries.map((d) => d.maxScore), highThreshold + 10);
  // Brush shows last N points by default; clamp to full range for small data sets.
  const defaultBrushEnd = Math.max(0, seriesLength - 1);
  const defaultBrushStart = Math.max(0, defaultBrushEnd - 99);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* P10: Lens self-explanation header */}
      <RiskTrendLensHeader />

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
          <span>LOW ({lowThreshold})</span>
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
          <span>HIGH ({highThreshold})</span>
        </span>
        <ThresholdSelector threshold={threshold} onChange={setThreshold} />
        <AggregationSelector view={view} onChange={setView} />
        <span style={{ marginLeft: 'auto', paddingRight: 24 }}>
          {view.aggregation === 'per-commit'
            ? `${perCommitSeries.length.toLocaleString()} commits`
            : `${perDaySeries.length.toLocaleString()} days · ${chartData.length.toLocaleString()} commits`}
          {' · click '}
          {view.aggregation === 'per-commit' ? 'point' : 'day'} to select
        </span>
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={view.aggregation === 'per-commit' ? perCommitSeries : perDaySeries}
            margin={{ top: 12, right: 24, bottom: 60, left: 24 }}
            onClick={handleClick}
            onMouseDown={onSelectRange ? handleMouseDown : undefined}
            onMouseMove={onSelectRange ? handleMouseMove : undefined}
            onMouseUp={onSelectRange ? handleMouseUp : undefined}
            onMouseLeave={onSelectRange ? handleMouseLeave : undefined}
            style={{
              cursor: onSelectRange && dragStartIdx !== null ? 'col-resize' : 'pointer',
              userSelect: 'none',
            }}
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

            <Tooltip
              content={
                view.aggregation === 'per-commit' ? (
                  <RiskTooltip lowThreshold={lowThreshold} highThreshold={highThreshold} />
                ) : (
                  <DailyTooltip lowThreshold={lowThreshold} highThreshold={highThreshold} />
                )
              }
            />

            {/* LOW threshold */}
            <ReferenceLine
              y={lowThreshold}
              stroke="var(--rs-warning)"
              strokeDasharray="5 3"
              strokeOpacity={0.8}
              label={{
                value: `LOW (${lowThreshold})`,
                position: 'right',
                fontSize: 9,
                fill: 'var(--rs-warning)',
                fontFamily: 'var(--rs-sans)',
              }}
              ifOverflow="extendDomain"
            />

            {/* HIGH threshold */}
            <ReferenceLine
              y={highThreshold}
              stroke="var(--rs-git-deleted)"
              strokeDasharray="5 3"
              strokeOpacity={0.8}
              label={{
                value: `HIGH (${highThreshold})`,
                position: 'right',
                fontSize: 9,
                fill: 'var(--rs-git-deleted)',
                fontFamily: 'var(--rs-sans)',
              }}
              ifOverflow="extendDomain"
            />

            {/* Drag-selection visual feedback (P4) */}
            {dragRefArea && (
              <ReferenceArea
                x1={dragRefArea.x1}
                x2={dragRefArea.x2}
                stroke="var(--rs-accent)"
                strokeOpacity={0.6}
                fill="var(--rs-accent)"
                fillOpacity={0.1}
              />
            )}

            {view.aggregation === 'per-commit' ? (
              <Area
                type="monotone"
                dataKey="riskScore"
                stroke="var(--rs-git-deleted)"
                strokeWidth={1.5}
                fill={`url(#${GRADIENT_ID})`}
                dot={<RiskDot lowThreshold={lowThreshold} />}
                activeDot={{
                  r: 5,
                  fill: 'var(--rs-git-deleted)',
                  stroke: 'var(--rs-bg-elevated)',
                  strokeWidth: 1.5,
                }}
                isAnimationActive={false}
              />
            ) : (
              <>
                {/* Per-day: mean を背景に薄く、max を前面に */}
                <Area
                  type="monotone"
                  dataKey="meanScore"
                  stroke="var(--rs-warning)"
                  strokeWidth={1}
                  fill="var(--rs-warning)"
                  fillOpacity={0.12}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="maxScore"
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
              </>
            )}

            {/* 7-period 単純移動平均 (P1) — 線のみ表示 */}
            {view.showMA && (
              <Area
                type="monotone"
                dataKey="ma7"
                stroke="var(--rs-accent)"
                strokeWidth={1.25}
                strokeDasharray="4 2"
                fill="none"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
              />
            )}

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
