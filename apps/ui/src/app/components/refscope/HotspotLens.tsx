/**
 * Hotspot Lens — LOC × churn の 2 軸でリファクタリング ROI の高いファイルを可視化する。
 *
 * - 散布図 (ScatterChart): X = lines (log scale), Y = churn (linear),
 *   点サイズ = lastChangedAt の新しさ (新: r=8, 旧: r=3 の線形補間)
 * - ランキング表 (Table): rank / path / lines / churn / lastChangedAt / 操作
 * - 点・行クリック → onOpenFileHistory(path) で既存のファイル履歴オーバーレイを開く
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts';
import { fetchFileHotspot, type HotspotFileEntry, type HotspotResponse } from '../../api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { ScrollArea } from '../ui/scroll-area';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HotspotLensProps = {
  repoId: string;
  selectedRef: string;
  onOpenFileHistory: (path: string) => void;
};

type ScatterPoint = HotspotFileEntry & {
  /** radius 3–8 interpolated from lastChangedAt recency */
  r: number;
  /** raw hot score = log10(lines+1) * log10(churn+1) */
  hotScore: number;
  /** rgb() string derived from normalized hot score (cool → hot) */
  color: string;
};

type Stats = {
  fileCount: number;
  maxLines: number;
  maxLinesPath: string;
  avgChurn: number;
  medianLines: number;
  medianChurn: number;
  top10Ratio: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Interpolate dot radius from lastChangedAt.
 * Most-recent file → r=8, oldest file → r=3.
 */
function computeRadius(
  lastChangedAt: string,
  minTs: number,
  maxTs: number,
): number {
  const ts = Date.parse(lastChangedAt);
  if (!Number.isFinite(ts) || minTs === maxTs) return 5;
  const t = (ts - minTs) / (maxTs - minTs); // 0 (oldest) → 1 (newest)
  return 3 + t * 5; // 3..8
}

/** Hot score combines size and churn on log scale to dampen outliers. */
function computeHotScore(lines: number, churn: number): number {
  return Math.log10(lines + 1) * Math.log10(churn + 1);
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Map normalized hot score t∈[0,1] to a 3-stop color: blue → amber → red.
 * Picked for perceptual contrast on dark backgrounds while remaining
 * distinguishable for common color-vision deficiencies.
 */
function computeHotColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const stops: Array<[number, number, number]> = [
    [59, 130, 246],   // #3b82f6 blue
    [245, 158, 11],   // #f59e0b amber
    [239, 68, 68],    // #ef4444 red
  ];
  const seg = c * 2;
  const i = Math.min(1, Math.floor(seg));
  const f = seg - i;
  const a = stops[i];
  const b = stops[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)}, ${Math.round(a[1] + (b[1] - a[1]) * f)}, ${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ---------------------------------------------------------------------------
// Custom Tooltip for ScatterChart
// ---------------------------------------------------------------------------

type CustomTooltipProps = TooltipProps<number, string> & {
  onClickPath?: (path: string) => void;
};

function HotspotTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ScatterPoint | undefined;
  if (!d) return null;
  return (
    <div
      style={{
        background: 'var(--rs-bg-elevated)',
        border: '1px solid var(--rs-border)',
        borderRadius: 'var(--rs-radius-sm)',
        padding: '8px 10px',
        fontSize: 11,
        fontFamily: 'var(--rs-mono)',
        maxWidth: 320,
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, wordBreak: 'break-all', fontFamily: 'var(--rs-sans)' }}>
        {d.path}
      </div>
      <div>lines: {d.lines.toLocaleString()}</div>
      <div>churn: {d.churn}</div>
      <div>last changed: {formatRelative(d.lastChangedAt)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Truncation badge
// ---------------------------------------------------------------------------

const TRUNCATION_REASON_LABEL: Record<NonNullable<HotspotResponse['truncationReason']>, string> = {
  limit:     'limit',
  commitCap: 'commit cap',
  maxBytes:  'max bytes',
  timeout:   'timeout',
};

function TruncatedBadge({ response }: { response: HotspotResponse }) {
  if (!response.truncated) return null;
  const reason = response.truncationReason
    ? TRUNCATION_REASON_LABEL[response.truncationReason]
    : 'unknown';
  return (
    <div
      role="status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 'var(--rs-radius-sm)',
        background: 'color-mix(in oklab, var(--rs-bg-elevated), #b45309 20%)',
        border: '1px solid #b45309',
        color: '#b45309',
        fontSize: 11,
        fontFamily: 'var(--rs-sans)',
      }}
    >
      ⚠ 結果は上限で打ち切られています（理由: {reason}）
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scatter tab content
// ---------------------------------------------------------------------------

const QUADRANT_LABEL_STYLE: CSSProperties = {
  position: 'absolute',
  fontSize: 9,
  fontFamily: 'var(--rs-sans)',
  color: 'var(--rs-text-muted)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  pointerEvents: 'none',
  opacity: 0.7,
};

function ScatterPanel({
  points,
  xMedian,
  yMedian,
  onClickPath,
}: {
  points: ScatterPoint[];
  xMedian: number;
  yMedian: number;
  onClickPath: (path: string) => void;
}) {
  // Recharts Scatter does not expose a per-point custom shape size via `r` prop directly
  // when using data-level fields, so we render a custom shape.
  const handleClick = useCallback(
    (data: unknown) => {
      const d = data as ScatterPoint;
      if (d?.path) onClickPath(d.path);
    },
    [onClickPath],
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 12, right: 24, bottom: 32, left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--rs-border)" opacity={0.4} />
        <XAxis
          type="number"
          dataKey="lines"
          name="lines"
          scale="log"
          domain={[1, 'auto']}
          allowDataOverflow
          tickFormatter={(v: number) => {
            const val = Math.round(v);
            if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(0)}M`;
            if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
            return String(val);
          }}
          label={{ value: 'lines', position: 'insideBottom', offset: -12, fontSize: 11, fill: 'var(--rs-text-secondary)' }}
          tick={{ fontSize: 10, fill: 'var(--rs-text-secondary)' }}
        />
        <YAxis
          type="number"
          dataKey="churn"
          name="churn"
          label={{ value: 'churn', angle: -90, position: 'insideLeft', offset: 8, fontSize: 11, fill: 'var(--rs-text-secondary)' }}
          tick={{ fontSize: 10, fill: 'var(--rs-text-secondary)' }}
        />
        <Tooltip
          content={<HotspotTooltip />}
          cursor={{ strokeDasharray: '3 3' }}
        />
        {xMedian > 0 && (
          <ReferenceLine
            x={xMedian}
            stroke="var(--rs-text-muted)"
            strokeDasharray="4 4"
            strokeOpacity={0.4}
            ifOverflow="extendDomain"
          />
        )}
        {yMedian > 0 && (
          <ReferenceLine
            y={yMedian}
            stroke="var(--rs-text-muted)"
            strokeDasharray="4 4"
            strokeOpacity={0.4}
            ifOverflow="extendDomain"
          />
        )}
        <Scatter
          data={points}
          onClick={handleClick}
          style={{ cursor: 'pointer' }}
          // Custom shape to vary dot size by recency and color by hot score
          shape={(props: unknown) => {
            const p = props as { cx?: number; cy?: number; payload?: ScatterPoint };
            const cx = p.cx ?? 0;
            const cy = p.cy ?? 0;
            const r = p.payload?.r ?? 5;
            const color = p.payload?.color ?? 'var(--rs-accent)';
            return (
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={color}
                fillOpacity={0.7}
                stroke={color}
                strokeOpacity={0.95}
                strokeWidth={1}
              />
            );
          }}
        />
      </ScatterChart>
    </ResponsiveContainer>
      <div style={{ ...QUADRANT_LABEL_STYLE, top: 16, right: 32 }}>Hotspot</div>
      <div style={{ ...QUADRANT_LABEL_STYLE, top: 16, left: 40 }}>Volatile · small</div>
      <div style={{ ...QUADRANT_LABEL_STYLE, bottom: 40, right: 32 }}>Stable · big</div>
      <div style={{ ...QUADRANT_LABEL_STYLE, bottom: 40, left: 40 }}>Quiet</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scatter legend — color = hot score, dot size = recency
// ---------------------------------------------------------------------------

function ScatterLegend() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        fontSize: 10,
        fontFamily: 'var(--rs-sans)',
        color: 'var(--rs-text)',
      }}
      aria-label="散布図の凡例"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--rs-text-secondary)' }}>cool</span>
        <div
          style={{
            width: 56,
            height: 6,
            borderRadius: 3,
            background: 'linear-gradient(to right, rgb(59,130,246), rgb(245,158,11), rgb(239,68,68))',
            boxShadow: '0 0 0 1px var(--rs-border)',
          }}
        />
        <span style={{ fontWeight: 600 }}>hot</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="44" height="14" viewBox="0 0 44 14" aria-hidden>
          <circle cx="6" cy="7" r="3" fill="var(--rs-text-muted)" opacity="0.6" />
          <circle cx="22" cy="7" r="5" fill="var(--rs-text-muted)" opacity="0.7" />
          <circle cx="38" cy="7" r="6" fill="var(--rs-text)" opacity="0.85" />
        </svg>
        <span>recent →</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary strip — compact stats row above tabs
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        flex: 1,
        padding: '4px 10px',
        borderLeft: '2px solid var(--rs-border)',
      }}
      title={hint}
    >
      <span
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--rs-text-secondary)',
          fontFamily: 'var(--rs-sans)',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          fontFamily: 'var(--rs-mono)',
          color: 'var(--rs-text)',
          lineHeight: 1.2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
      {hint && (
        <span
          style={{
            fontSize: 10,
            color: 'var(--rs-text-secondary)',
            fontFamily: 'var(--rs-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

function SummaryStrip({ stats }: { stats: Stats }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 0,
        padding: '6px 12px',
        borderBottom: '1px solid var(--rs-border)',
        background: 'var(--rs-bg-panel)',
        flexShrink: 0,
      }}
    >
      <StatCard label="ファイル" value={stats.fileCount.toLocaleString()} />
      <StatCard
        label="最大 LOC"
        value={stats.maxLines.toLocaleString()}
        hint={stats.maxLinesPath}
      />
      <StatCard label="平均 churn" value={stats.avgChurn.toFixed(1)} />
      <StatCard
        label="Top10 LOC 比率"
        value={`${(stats.top10Ratio * 100).toFixed(0)}%`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranking tab content
// ---------------------------------------------------------------------------

/**
 * Render a TableCell with a horizontal proportional bar in its background.
 * Uses color-mix so the bar tints accent against the panel surface.
 */
function barCellStyle(pct: number): CSSProperties {
  const clamped = Math.max(0, Math.min(100, pct));
  return {
    background: `linear-gradient(to right, color-mix(in oklab, var(--rs-accent), transparent 80%) ${clamped}%, transparent ${clamped}%)`,
  };
}

const RANKING_HEAD_STYLE: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--rs-text)',
  background: 'var(--rs-bg-elevated)',
  height: 30,
  borderBottom: '1px solid var(--rs-border)',
  fontFamily: 'var(--rs-sans)',
};

const RANKING_HEAD_NUM_STYLE: CSSProperties = {
  ...RANKING_HEAD_STYLE,
  textAlign: 'right',
};

type SortKey = 'path' | 'lines' | 'churn' | 'lastChangedAt';
type SortDir = 'asc' | 'desc';

/** Default sort direction when switching to a new column. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  path: 'asc',
  lines: 'desc',
  churn: 'desc',
  lastChangedAt: 'desc',
};

function compareFiles(a: HotspotFileEntry, b: HotspotFileEntry, key: SortKey): number {
  switch (key) {
    case 'path':          return a.path.localeCompare(b.path);
    case 'lines':         return a.lines - b.lines;
    case 'churn':         return a.churn - b.churn;
    case 'lastChangedAt': return Date.parse(a.lastChangedAt) - Date.parse(b.lastChangedAt);
  }
}

function SortableHead({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = 'left',
  width,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
  width?: number;
}) {
  const baseStyle = align === 'right' ? RANKING_HEAD_NUM_STYLE : RANKING_HEAD_STYLE;
  const arrow = active ? (dir === 'asc' ? '↑' : '↓') : '';
  return (
    <TableHead
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{
        ...baseStyle,
        ...(width != null ? { width } : {}),
        cursor: 'pointer',
        userSelect: 'none',
        color: active ? 'var(--rs-accent)' : baseStyle.color,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: align === 'right' ? 'flex-end' : 'flex-start', width: '100%' }}>
        <span>{label}</span>
        <span style={{ width: 10, color: active ? 'var(--rs-accent)' : 'var(--rs-text-muted)' }}>
          {arrow || (active ? '' : '↕')}
        </span>
      </span>
    </TableHead>
  );
}

function RankingPanel({
  files,
  onClickPath,
}: {
  files: HotspotFileEntry[];
  onClickPath: (path: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('lines');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState('');

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDir(DEFAULT_DIR[key]);
      return key;
    });
  }, []);

  const trimmedFilter = filter.trim().toLowerCase();
  const filtered = trimmedFilter
    ? files.filter((f) => f.path.toLowerCase().includes(trimmedFilter))
    : files;

  const sorted = [...filtered].sort((a, b) => {
    const cmp = compareFiles(a, b, sortKey);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const maxLines = Math.max(1, ...files.map((f) => f.lines));
  const maxChurn = Math.max(1, ...files.map((f) => f.churn));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid var(--rs-border)',
          background: 'var(--rs-bg-panel)',
          flexShrink: 0,
        }}
      >
        <input
          type="search"
          placeholder="パスでフィルタ…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="パスでフィルタ"
          style={{
            flex: 1,
            height: 26,
            padding: '0 8px',
            fontSize: 11,
            fontFamily: 'var(--rs-mono)',
            border: '1px solid var(--rs-border)',
            borderRadius: 'var(--rs-radius-sm)',
            background: 'var(--rs-bg-elevated)',
            color: 'var(--rs-text)',
            outline: 'none',
          }}
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 'var(--rs-radius-sm)',
              border: '1px solid var(--rs-border)',
              background: 'transparent',
              color: 'var(--rs-text-secondary)',
              cursor: 'pointer',
              fontFamily: 'var(--rs-sans)',
            }}
          >
            クリア
          </button>
        )}
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--rs-mono)',
            color: 'var(--rs-text-secondary)',
            whiteSpace: 'nowrap',
          }}
        >
          {sorted.length.toLocaleString()} / {files.length.toLocaleString()}
        </span>
      </div>
      <ScrollArea className="flex-1 w-full" style={{ minHeight: 0 }}>
      {sorted.length === 0 && (
        <div
          style={{
            padding: '24px 12px',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--rs-text-secondary)',
            fontFamily: 'var(--rs-sans)',
          }}
        >
          {trimmedFilter
            ? `"${filter}" にマッチするファイルがありません`
            : '表示するファイルがありません'}
        </div>
      )}
      <Table style={{ display: sorted.length === 0 ? 'none' : undefined }}>
        <TableHeader>
          <TableRow>
            <TableHead style={{ ...RANKING_HEAD_STYLE, width: 48 }}>#</TableHead>
            <SortableHead label="path" sortKey="path" active={sortKey === 'path'} dir={sortDir} onSort={handleSort} />
            <SortableHead label="lines" sortKey="lines" active={sortKey === 'lines'} dir={sortDir} onSort={handleSort} align="right" width={80} />
            <SortableHead label="churn" sortKey="churn" active={sortKey === 'churn'} dir={sortDir} onSort={handleSort} align="right" width={72} />
            <SortableHead label="last changed" sortKey="lastChangedAt" active={sortKey === 'lastChangedAt'} dir={sortDir} onSort={handleSort} width={120} />
            <TableHead style={{ ...RANKING_HEAD_STYLE, width: 72 }}>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((file, idx) => (
            <TableRow
              key={file.path}
              onClick={() => onClickPath(file.path)}
              style={{ cursor: 'pointer' }}
            >
              <TableCell style={{ color: 'var(--rs-text-secondary)', fontSize: 11 }}>
                {idx + 1}
              </TableCell>
              <TableCell
                style={{
                  fontFamily: 'var(--rs-mono)',
                  fontSize: 11,
                  maxWidth: 360,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={file.path}
              >
                {file.path}
              </TableCell>
              <TableCell
                style={{
                  textAlign: 'right',
                  fontFamily: 'var(--rs-mono)',
                  fontSize: 11,
                  ...barCellStyle((file.lines / maxLines) * 100),
                }}
              >
                {file.lines.toLocaleString()}
              </TableCell>
              <TableCell
                style={{
                  textAlign: 'right',
                  fontFamily: 'var(--rs-mono)',
                  fontSize: 11,
                  ...barCellStyle((file.churn / maxChurn) * 100),
                }}
              >
                {file.churn}
              </TableCell>
              <TableCell style={{ fontSize: 11, color: 'var(--rs-text-secondary)' }}>
                {formatRelative(file.lastChangedAt)}
              </TableCell>
              <TableCell>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onClickPath(file.path); }}
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 'var(--rs-radius-sm)',
                    border: '1px solid var(--rs-border)',
                    background: 'transparent',
                    color: 'var(--rs-text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  履歴
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HotspotLens({ repoId, selectedRef, onOpenFileHistory }: HotspotLensProps) {
  const [data, setData] = useState<HotspotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'scatter' | 'ranking'>('scatter');

  // Refresh key: incrementing forces a re-fetch even if deps haven't changed.
  const [refreshKey, setRefreshKey] = useState(0);

  // Store the last resolved repoId to detect empty/missing repo scenarios.
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    if (!repoId) return;
    // Abort any in-flight request.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError('');

    fetchFileHotspot(repoId, { ref: selectedRef }, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setData(next);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof Error ? err.message : 'ホットスポットの取得に失敗しました');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [repoId, selectedRef]);

  // Re-fetch when repoId, selectedRef, or refreshKey changes.
  useEffect(() => {
    doFetch();
    return () => {
      abortRef.current?.abort();
    };
  }, [doFetch, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build scatter points + summary stats from response data.
  const { scatterPoints, stats } = useMemo(() => {
    const empty = { scatterPoints: [] as ScatterPoint[], stats: null as Stats | null };
    if (!data?.files.length) return empty;
    const filtered = data.files.filter((f) => f.lines > 0);
    if (!filtered.length) return empty;

    const timestamps = filtered
      .map((f) => Date.parse(f.lastChangedAt))
      .filter((t) => Number.isFinite(t));
    const minTs = timestamps.length ? Math.min(...timestamps) : 0;
    const maxTs = timestamps.length ? Math.max(...timestamps) : 0;

    const scores = filtered.map((f) => computeHotScore(f.lines, f.churn));
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const scoreRange = maxScore - minScore || 1;

    const points: ScatterPoint[] = filtered.map((f) => {
      const hotScore = computeHotScore(f.lines, f.churn);
      const t = (hotScore - minScore) / scoreRange;
      return {
        ...f,
        r: computeRadius(f.lastChangedAt, minTs, maxTs),
        hotScore,
        color: computeHotColor(t),
      };
    });

    const linesArr = filtered.map((f) => f.lines);
    const churnArr = filtered.map((f) => f.churn);
    const totalLines = linesArr.reduce((s, x) => s + x, 0);
    const sortedByLines = [...filtered].sort((a, b) => b.lines - a.lines);
    const top10Sum = sortedByLines.slice(0, 10).reduce((s, f) => s + f.lines, 0);
    const maxLines = sortedByLines[0]?.lines ?? 0;
    const maxLinesPath = sortedByLines[0]?.path ?? '';

    const computed: Stats = {
      fileCount: filtered.length,
      maxLines,
      maxLinesPath,
      avgChurn: churnArr.reduce((s, x) => s + x, 0) / churnArr.length,
      medianLines: median(linesArr),
      medianChurn: median(churnArr),
      top10Ratio: totalLines > 0 ? top10Sum / totalLines : 0,
    };

    return { scatterPoints: points, stats: computed };
  }, [data]);

  // ---------------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------------

  const toolbar = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid var(--rs-border)',
        background: 'var(--rs-bg-panel)',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--rs-text-secondary)', fontFamily: 'var(--rs-sans)', flex: 1 }}>
        {data && (
          <>
            <span>{data.files.length.toLocaleString()} ファイル</span>
            {' · '}
            <span>{data.scope.commitsAnalyzed} コミット分析済み</span>
            {' · '}
            <span style={{ fontFamily: 'var(--rs-mono)', fontSize: 10 }}>{data.refLabel}</span>
          </>
        )}
      </span>
      {data && <TruncatedBadge response={data} />}
      <button
        type="button"
        disabled={loading}
        onClick={() => setRefreshKey((k) => k + 1)}
        style={{
          fontSize: 11,
          padding: '3px 10px',
          borderRadius: 'var(--rs-radius-sm)',
          border: '1px solid var(--rs-border)',
          background: 'transparent',
          color: loading ? 'var(--rs-text-muted)' : 'var(--rs-text-secondary)',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--rs-sans)',
        }}
      >
        {loading ? '読込中…' : '更新'}
      </button>
    </div>
  );

  // ---------------------------------------------------------------------------
  // States: loading / error / empty
  // ---------------------------------------------------------------------------

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {toolbar}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--rs-text-secondary)', fontFamily: 'var(--rs-sans)' }}>
            ホットスポットを分析中…
          </div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {toolbar}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div style={{ fontSize: 13, color: '#ef4444', fontFamily: 'var(--rs-sans)' }}>
            ホットスポットの取得に失敗しました
          </div>
          <div style={{ fontSize: 11, color: 'var(--rs-text-secondary)', fontFamily: 'var(--rs-mono)', maxWidth: 400, textAlign: 'center' }}>
            {error}
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            style={{
              fontSize: 12,
              padding: '4px 14px',
              borderRadius: 'var(--rs-radius-sm)',
              border: '1px solid var(--rs-border)',
              background: 'transparent',
              color: 'var(--rs-text)',
              cursor: 'pointer',
            }}
          >
            再試行
          </button>
        </div>
      </div>
    );
  }

  if (data && data.files.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {toolbar}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ fontSize: 13, color: 'var(--rs-text-secondary)', fontFamily: 'var(--rs-sans)' }}>
            このリポジトリには分析対象のファイルがありません
          </div>
          <div style={{ fontSize: 11, color: 'var(--rs-text-muted)', fontFamily: 'var(--rs-mono)' }}>
            {data.refLabel}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main view: scatter + ranking tabs
  // ---------------------------------------------------------------------------

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {toolbar}
      {stats && <SummaryStrip stats={stats} />}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'scatter' | 'ranking')}
        className="!gap-0 flex flex-col flex-1 overflow-hidden"
        style={{ minHeight: 0 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            borderBottom: '1px solid var(--rs-border)',
            background: 'var(--rs-bg-panel)',
            flexShrink: 0,
            paddingRight: 12,
          }}
        >
          <TabsList
            className="!bg-transparent !rounded-none !p-0 !h-auto !w-fit !inline-flex !justify-start"
            style={{ gap: 4, paddingLeft: 12 }}
          >
            <TabsTrigger
              value="scatter"
              className="!rounded-none !border-0 !bg-transparent !shadow-none data-[state=active]:!bg-transparent data-[state=active]:!shadow-none data-[state=active]:!border-0"
              style={{
                fontSize: 12,
                fontFamily: 'var(--rs-sans)',
                fontWeight: tab === 'scatter' ? 700 : 500,
                height: 34,
                padding: '0 14px',
                color: tab === 'scatter' ? 'var(--rs-accent)' : 'var(--rs-text)',
                borderBottom: tab === 'scatter' ? '2px solid var(--rs-accent)' : '2px solid transparent',
                marginBottom: -1,
                transition: 'color 80ms ease-out, border-color 80ms ease-out',
              }}
            >
              散布図
            </TabsTrigger>
            <TabsTrigger
              value="ranking"
              className="!rounded-none !border-0 !bg-transparent !shadow-none data-[state=active]:!bg-transparent data-[state=active]:!shadow-none data-[state=active]:!border-0"
              style={{
                fontSize: 12,
                fontFamily: 'var(--rs-sans)',
                fontWeight: tab === 'ranking' ? 700 : 500,
                height: 34,
                padding: '0 14px',
                color: tab === 'ranking' ? 'var(--rs-accent)' : 'var(--rs-text)',
                borderBottom: tab === 'ranking' ? '2px solid var(--rs-accent)' : '2px solid transparent',
                marginBottom: -1,
                transition: 'color 80ms ease-out, border-color 80ms ease-out',
              }}
            >
              ランキング
            </TabsTrigger>
          </TabsList>
          <div style={{ flex: 1 }} />
          {tab === 'scatter' && <ScatterLegend />}
        </div>

        <TabsContent value="scatter" className="flex-1 overflow-hidden" style={{ minHeight: 0, margin: 0, padding: '8px 4px 0' }}>
          <ScatterPanel
            points={scatterPoints}
            xMedian={stats?.medianLines ?? 0}
            yMedian={stats?.medianChurn ?? 0}
            onClickPath={onOpenFileHistory}
          />
        </TabsContent>

        <TabsContent value="ranking" className="flex-1 overflow-hidden" style={{ minHeight: 0, margin: 0 }}>
          <RankingPanel
            files={data?.files ?? []}
            onClickPath={onOpenFileHistory}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
