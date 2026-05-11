/**
 * Drift Lens — 全 local branches の ahead/behind を散布図で可視化し、
 * 分岐状況を一目で把握する。
 *
 * - X 軸: behind (base に対する遅れコミット数)
 * - Y 軸: ahead  (base に対する先行コミット数)
 * - 点サイズ: 最終コミットからの経過日数 (古いほど大きい / `daysSinceLast`)
 * - 点の色: rotScore のラベルに対応 (BranchSidebar と統一)
 *   - healthy (≤7)  → var(--rs-git-added)
 *   - warning (8–15) → var(--rs-warning)
 *   - critical (>15) → var(--rs-git-deleted)
 * - 象限ガイド:
 *   左下 "Aligned" / 左上 "Hot" / 右下 "Stale" / 右上 "Diverged"
 * - 点クリック または Enter / Space → onSelectRef(refName) + onChangeLens('risk-trend')
 *
 * a11y: SVG 全体に role="img" + aria-label、視覚非表示の <ul> で SR 用テキスト経路を提供。
 * 各点に tabIndex + onKeyDown を設定し、キーボードで点間移動 (Tab) + 選択 (Enter/Space) 可能。
 *
 * 仕様変更 (PR-B): API を fetchRefDrift → fetchBranchGroupHealth に切替。
 * Drift Lens は local branches のみを対象とする (remote/tag は別 Lens で確認)。
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
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
import { fetchBranchGroupHealth, type BranchGroupEntry } from '../../api';
import { LensHeader } from './LensHeader';
import {
  EmptyStateCard,
  type LensEmptyReason,
  type EmptyStateMessage,
} from './EmptyStateCard';
import {
  ROT_SCORE_COLORS,
  rotScoreLabel,
  type RotScoreLabel,
} from './BranchSidebar';
import type { LensId } from './LensSwitcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftLensProps = {
  repoId: string;
  refs: Array<{ name: string }>;
  /** App.tsx 側の現在の selectedRef。一致点を強調表示する */
  selectedRef?: string;
  onSelectRef: (ref: string) => void;
  /** 他 Lens への遷移。EmptyStateCard / Error カード / 点クリック後の遷移に使用 */
  onChangeLens?: (lens: LensId) => void;
};

type DriftPoint = {
  /** フル ref 名 (refs/heads/...) */
  name: string;
  shortName: string;
  hash: string;
  ahead: number;
  behind: number;
  mergeBase: string | null;
  /** 最終コミット ISO (取得できない場合は null) */
  updatedAt: string | null;
  daysSinceLast: number;
  /** rotScore 0..25 (API 側で計算済み) */
  rotScore: number;
  /** rotScore からの分類 */
  rotLabel: RotScoreLabel;
  /** 色 (ROT_SCORE_COLORS[rotLabel]) */
  color: string;
  /** 点半径 (daysSinceLast に応じて 4..12) */
  r: number;
};

/** Drift 固有の空状態理由。EmptyStateCard へキャストして渡す。 */
type DriftEmptyReason = 'drift-no-base' | 'drift-no-diverged';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RADIUS_MIN = 4;
const RADIUS_MAX = 12;
/** daysSinceLast がこの値以上で最大半径 */
const RADIUS_SATURATION_DAYS = 180;

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

function shortRefName(name: string): string {
  if (name.startsWith('refs/heads/')) return name.slice('refs/heads/'.length);
  if (name.startsWith('refs/remotes/')) return name.slice('refs/remotes/'.length);
  if (name.startsWith('refs/tags/')) return name.slice('refs/tags/'.length);
  return name;
}

/** daysSinceLast を r=[RADIUS_MIN, RADIUS_MAX] にマップ */
function daysToRadius(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return RADIUS_MIN;
  const t = Math.min(1, days / RADIUS_SATURATION_DAYS);
  return Math.round(RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * t);
}

/** ISO 文字列を相対表記 (HotspotLens / CoChangeLens と挙動を揃える) */
function formatRelative(iso: string | null): string {
  if (!iso) return '不明';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function toDriftPoint(entry: BranchGroupEntry): DriftPoint {
  const rotLabel = rotScoreLabel(entry.rotScore);
  return {
    name: entry.name,
    shortName: entry.shortName,
    hash: entry.hash,
    ahead: entry.ahead,
    behind: entry.behind,
    mergeBase: entry.mergeBase,
    updatedAt: entry.updatedAt,
    daysSinceLast: entry.daysSinceLast,
    rotScore: entry.rotScore,
    rotLabel,
    color: ROT_SCORE_COLORS[rotLabel],
    r: daysToRadius(entry.daysSinceLast),
  };
}

// ---------------------------------------------------------------------------
// Help content for LensHeader
// ---------------------------------------------------------------------------

function DriftHelpContent(): ReactNode {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--rs-text)' }}>
        Drift Lens とは
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        全 <strong>local branches</strong> を base ブランチに対する ahead / behind で
        散布図にプロット。散らばり方からブランチ整理の優先順位を把握できます。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        4 象限の意味
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8, lineHeight: 1.7 }}>
        ・<strong>Aligned</strong> (左下): base にほぼ揃っている健全な状態<br />
        ・<strong>Hot</strong> (左上): base に追従しつつ独自コミットが多い活発開発中<br />
        ・<strong>Stale</strong> (右下): base から遅れたまま放置 (削除候補)<br />
        ・<strong>Diverged</strong> (右上): 双方向に乖離、rebase / merge が必要
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        点のサイズ
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        最終コミットからの経過日数 (<code>daysSinceLast</code>) に応じて
        {' '}{RADIUS_MIN} 〜 {RADIUS_MAX} px。古いブランチほど大きく表示されます。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        点の色 (rotScore)
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8, lineHeight: 1.7 }}>
        <code>clamp(D/7,0,10) + clamp(B/5,0,10) + clamp(A/10,0,5)</code> で算出される 0–25 のスコア。
        BranchSidebar の色と統一しています。<br />
        ・<span style={{ color: 'var(--rs-git-added)' }}>healthy (0–7)</span> ·
        {' '}<span style={{ color: 'var(--rs-warning)' }}>warning (8–15)</span> ·
        {' '}<span style={{ color: 'var(--rs-git-deleted)' }}>critical (16+)</span>
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        base ブランチの推定
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        <code>main → master → trunk → 先頭の ref</code> の順で候補を検索します。
        手動切替 UI は Phase 2 で追加予定です。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        操作
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 4 }}>
        ・点 <strong>クリック</strong> または <strong>Enter / Space</strong>:
        {' '}そのブランチを選択し <strong>Risk Trend Lens</strong> に切替<br />
        ・<strong>Tab</strong>: 点間のフォーカス移動
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state messages
// ---------------------------------------------------------------------------

const DRIFT_EMPTY_MESSAGES: Partial<Record<LensEmptyReason, EmptyStateMessage>> = {
  ['drift-no-base' as LensEmptyReason]: {
    title: 'ベースブランチが見つかりません',
    body:
      'ref リストに main / master / trunk が含まれていないため、比較基点を決められません。リポジトリを開き直すか、Live Lens でブランチを確認してください。',
  },
  ['drift-no-diverged' as LensEmptyReason]: {
    title: 'local branches が見つかりません',
    body:
      'このリポジトリには表示可能な local branches がありません。新規ブランチを切るか、Live Lens で remote ブランチを確認してください。',
  },
};

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
    maxWidth: 280,
    wordBreak: 'break-all',
  };

  return (
    <div style={containerStyle}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: point.color }}>
        {point.shortName}
      </div>
      <div style={{ color: 'var(--rs-text-muted)', fontSize: 10, marginBottom: 4 }}>
        {point.name}
      </div>
      <div>ahead: <strong>{point.ahead}</strong> · behind: <strong>{point.behind}</strong></div>
      <div style={{ marginTop: 4 }}>
        rotScore: <strong style={{ color: point.color }}>{point.rotScore}/25</strong>
        {' '}({point.rotLabel})
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginTop: 2 }}>
        Last commit: {formatRelative(point.updatedAt)}
      </div>
      {point.mergeBase && (
        <div style={{ color: 'var(--rs-text-muted)', marginTop: 2, fontSize: 10 }}>
          merge-base: {point.mergeBase.slice(0, 7)}
        </div>
      )}
      <div style={{ color: 'var(--rs-text-secondary)', marginTop: 6, fontSize: 11 }}>
        Click / Enter → Risk Trend Lens で詳細を見る
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom dot shape
// ---------------------------------------------------------------------------

interface DotShapeProps {
  cx?: number;
  cy?: number;
  payload?: DriftPoint;
  onActivate?: (name: string) => void;
  selectedRef?: string;
}

function DotShape({ cx = 0, cy = 0, payload, onActivate, selectedRef }: DotShapeProps) {
  if (!payload) return null;
  const refName = payload.name;
  const label = payload.shortName;
  const isSelected = selectedRef === refName || selectedRef === payload.shortName;

  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={
        `${label}: ahead ${payload.ahead}, behind ${payload.behind}, ` +
        `rotScore ${payload.rotScore} of 25 (${payload.rotLabel}). ` +
        `Enter / Space で Risk Trend Lens に切替。`
      }
      onKeyDown={(e: KeyboardEvent<SVGGElement>) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          onActivate?.(refName);
        }
      }}
      className="rs-drift-dot"
      style={{ outline: 'none' }}
    >
      <title>{refName}</title>
      {/* Focus ring */}
      <circle
        cx={cx}
        cy={cy}
        r={payload.r + 4}
        fill="none"
        stroke="var(--rs-accent)"
        strokeWidth={2}
        strokeOpacity={0}
        className="rs-drift-focus-ring"
      />
      {/* Selection ring (App.tsx の selectedRef と一致時に常時表示) */}
      {isSelected && (
        <circle
          cx={cx}
          cy={cy}
          r={payload.r + 5}
          fill="none"
          stroke="var(--rs-accent)"
          strokeWidth={2.5}
          strokeOpacity={0.85}
        />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={payload.r}
        fill={payload.color}
        fillOpacity={0.75}
        stroke={payload.color}
        strokeWidth={isSelected ? 2 : 1}
        style={{ cursor: 'pointer' }}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const QUADRANT_LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fill: 'var(--rs-text)',
  fontWeight: 500,
};

export function DriftLens({
  repoId,
  refs,
  selectedRef,
  onSelectRef,
  onChangeLens,
}: DriftLensProps) {
  const [points, setPoints] = useState<DriftPoint[]>([]);
  const [base, setBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const srDescId = useId();

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
        const res = await fetchBranchGroupHealth(
          repoId,
          { base: estimatedBase },
          signal,
        );
        const pts = res.branches.map(toDriftPoint);
        setPoints(pts);
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

  const handleRetry = useCallback(() => {
    const controller = new AbortController();
    void load(controller.signal);
  }, [load]);

  const handleActivate = useCallback(
    (name: string) => {
      onSelectRef(name);
      onChangeLens?.('risk-trend');
    },
    [onSelectRef, onChangeLens],
  );

  // Axis domains
  const { maxBehind, maxAhead, midBehind, midAhead } = useMemo(() => {
    const mb = Math.max(10, ...points.map((p) => p.behind));
    const ma = Math.max(10, ...points.map((p) => p.ahead));
    return {
      maxBehind: mb,
      maxAhead: ma,
      midBehind: Math.round(mb / 2),
      midAhead: Math.round(ma / 2),
    };
  }, [points]);

  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--rs-bg-panel)',
    color: 'var(--rs-text)',
    fontFamily: 'var(--rs-sans)',
  };

  const renderHeader = (baseLabel: string | null) => (
    <LensHeader
      title="Drift"
      oneLiner={
        baseLabel
          ? `base: ${shortRefName(baseLabel)} に対する local branches の ahead / behind を可視化`
          : 'ベースブランチに対する local branches の分岐状況を可視化'
      }
      helpContent={<DriftHelpContent />}
    />
  );

  // --- Loading ---
  if (loading) {
    return (
      <div style={containerStyle}>
        {renderHeader(base)}
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
          Computing branch drift…
        </div>
      </div>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <div style={containerStyle}>
        {renderHeader(base)}
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
              drift データの取得に失敗しました
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
                onClick={handleRetry}
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
                    onClick={() => onChangeLens('hotspot')}
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
                    Hotspot を開く
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- No base branch ---
  if (!base) {
    return (
      <div style={containerStyle}>
        {renderHeader(null)}
        <EmptyStateCard
          reason={'drift-no-base' as LensEmptyReason}
          messages={DRIFT_EMPTY_MESSAGES}
          onChangeLens={onChangeLens}
          relatedLenses={
            onChangeLens
              ? [{ id: 'live', label: 'Live を開く' }]
              : undefined
          }
        />
      </div>
    );
  }

  // --- Empty (base found but no local branches) ---
  if (points.length === 0) {
    return (
      <div style={containerStyle}>
        {renderHeader(base)}
        <EmptyStateCard
          reason={'drift-no-diverged' as LensEmptyReason}
          messages={DRIFT_EMPTY_MESSAGES}
          onChangeLens={onChangeLens}
          relatedLenses={
            onChangeLens
              ? [
                  { id: 'live', label: 'Live を開く' },
                  { id: 'hotspot', label: 'Hotspot を開く' },
                ]
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {renderHeader(base)}

      {/* SR-only graph description */}
      <span
        id={srDescId}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        <p>
          Drift 散布図。base: {base}。{points.length} 件の local branches。
        </p>
        <ul>
          {points.map((p) => (
            <li key={p.name}>
              {p.shortName}: ahead {p.ahead}, behind {p.behind},
              rotScore {p.rotScore} ({p.rotLabel}),
              last commit {formatRelative(p.updatedAt)}
            </li>
          ))}
        </ul>
      </span>

      <div
        style={{ flex: 1, minHeight: 0, padding: '12px 8px 8px' }}
        role="img"
        aria-label={
          `Drift scatter chart: ${points.length} local branches plotted by ahead and behind ` +
          `commits against base ${base}.`
        }
        aria-describedby={srDescId}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 24, right: 32, bottom: 24, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--rs-border)" />

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

            <ReferenceArea
              x1={0}
              x2={midBehind}
              y1={0}
              y2={midAhead}
              fill="#4ade80"
              fillOpacity={0.05}
              label={{ value: 'Aligned', position: 'insideBottomLeft', style: QUADRANT_LABEL_STYLE }}
            />
            <ReferenceArea
              x1={0}
              x2={midBehind}
              y1={midAhead}
              y2={maxAhead + 1}
              fill="#facc15"
              fillOpacity={0.05}
              label={{ value: 'Hot', position: 'insideTopLeft', style: QUADRANT_LABEL_STYLE }}
            />
            <ReferenceArea
              x1={midBehind}
              x2={maxBehind + 1}
              y1={0}
              y2={midAhead}
              fill="#fb923c"
              fillOpacity={0.05}
              label={{ value: 'Stale', position: 'insideBottomRight', style: QUADRANT_LABEL_STYLE }}
            />
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
              shape={<DotShape onActivate={handleActivate} selectedRef={selectedRef} />}
              onClick={(data: unknown) => {
                const pt = data as DriftPoint | undefined;
                if (pt?.name) handleActivate(pt.name);
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <style>{`
        .rs-drift-dot:focus-visible .rs-drift-focus-ring {
          stroke-opacity: 0.85;
        }
      `}</style>
    </div>
  );
}
