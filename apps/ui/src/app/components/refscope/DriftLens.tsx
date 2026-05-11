/**
 * Drift Lens — 全ブランチの ahead/behind を散布図で可視化し、分岐状況を一目で把握する。
 *
 * - X 軸: behind (base に対する遅れコミット数)
 * - Y 軸: ahead  (base に対する先行コミット数)
 * - 点サイズ (z): 最終コミットからの経過日数 (古いほど大きい) — PR-B で接続予定。現状 r=6 固定。
 * - 点の色: 警戒度に応じて緑 → 黄 → 赤
 * - 象限ガイド:
 *   左下 "Aligned" / 左上 "Hot" / 右下 "Stale" / 右上 "Diverged"
 * - 点クリック → onSelectRef(refName) で既存 Live / BranchSidebar が反応
 *
 * a11y: SVG 全体に role="img" + aria-label、視覚非表示の <ul> で SR 用テキスト経路を提供。
 * 各点に tabIndex + onKeyDown を設定し、キーボードで点間移動 (Tab) + 選択 (Enter/Space) 可能。
 */
import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
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
import { LensHeader } from './LensHeader';
import {
  EmptyStateCard,
  type LensEmptyReason,
  type EmptyStateMessage,
} from './EmptyStateCard';
import type { LensId } from './LensSwitcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftLensProps = {
  repoId: string;
  refs: Array<{ name: string }>;
  onSelectRef: (ref: string) => void;
  /** 他 Lens への遷移 (EmptyStateCard の relatedLenses 用 / PR-B で点クリック遷移にも使用予定) */
  onChangeLens?: (lens: LensId) => void;
};

type DriftPoint = RefDriftEntry & {
  /** days since last commit (0 = today) — PR-B で `daysSinceLast` を BranchGroupHealth から取得予定 */
  ageDays: number;
  /** radius for ZAxis substitute; encoded as SVG r attribute via custom shape */
  r: number;
  /** rgb() string derived from alert score */
  color: string;
  /** raw alert score */
  alertScore: number;
};

/** Drift 固有の空状態理由。EmptyStateCard へキャストして渡す。 */
type DriftEmptyReason = 'drift-no-base' | 'drift-no-diverged';

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

/**
 * Map an alert score (0–1) to an rgb() colour string.
 * 0.0 → green (#4ade80), 0.5 → yellow (#facc15), 1.0 → red (#f87171)
 *
 * NOTE: PR-B で BranchSidebar の computeRotScore / ROT_SCORE_COLORS に置換予定。
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
  const ageDays = 0; // PR-B で BranchGroupHealth から daysSinceLast を取得
  // r: PR-B で age に応じて 4..12 にマップ。現状はニュートラル 6。
  const r = 6;
  return {
    ...entry,
    ageDays,
    r,
    color: scoreToColor(alertScore),
    alertScore,
  };
}

function shortRefName(name: string): string {
  // refs/heads/foo → foo, refs/remotes/origin/bar → origin/bar, refs/tags/v1 → v1
  if (name.startsWith('refs/heads/')) return name.slice('refs/heads/'.length);
  if (name.startsWith('refs/remotes/')) return name.slice('refs/remotes/'.length);
  if (name.startsWith('refs/tags/')) return name.slice('refs/tags/'.length);
  return name;
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
        全ブランチを <strong>base ブランチに対する ahead / behind</strong> で散布図にプロット。
        散らばり方からブランチ整理の優先順位を把握できます。
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
        点の色 (alertScore)
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        <code>min(1, (ahead + behind) / 100)</code> を緑 → 黄 → 赤に補間。
        合計コミット数が多いほど赤くなります。
        <em style={{ color: 'var(--rs-text-muted)' }}>
          {' '}(PR-B で BranchSidebar と同じ rotScore に統合予定)
        </em>
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
        ・点 <strong>クリック</strong> または <strong>Enter / Space</strong>: そのブランチを選択
        (BranchSidebar が連動)<br />
        ・<strong>Tab</strong>: 点間のフォーカス移動<br />
        ・最大 <strong>50</strong> 件を表示。51 件目以降は警告バナーで明示します
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state messages (Drift 固有 reason を持つ messages map)
// ---------------------------------------------------------------------------

const DRIFT_EMPTY_MESSAGES: Partial<Record<LensEmptyReason, EmptyStateMessage>> = {
  ['drift-no-base' as LensEmptyReason]: {
    title: 'ベースブランチが見つかりません',
    body:
      'ref リストに main / master / trunk が含まれていないため、比較基点を決められません。リポジトリを開き直すか、Live Lens でブランチを確認してください。',
  },
  ['drift-no-diverged' as LensEmptyReason]: {
    title: '分岐したブランチはありません',
    body:
      'すべての ref がベースブランチと揃っています。新規ブランチが作られたり、コミットが追加されると散布図に表示されます。',
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
    maxWidth: 260,
    wordBreak: 'break-all',
  };

  return (
    <div style={containerStyle}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: point.color }}>
        {shortRefName(point.name)}
      </div>
      <div style={{ color: 'var(--rs-text-muted)', fontSize: 10, marginBottom: 4 }}>
        {point.name}
      </div>
      <div>ahead: <strong>{point.ahead}</strong></div>
      <div>behind: <strong>{point.behind}</strong></div>
      <div style={{ color: 'var(--rs-text-secondary)', marginTop: 4, fontSize: 11 }}>
        Click / Enter to select in BranchSidebar
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom dot shape — needed to apply per-point colour, radius, and a11y
// ---------------------------------------------------------------------------

interface DotShapeProps {
  cx?: number;
  cy?: number;
  payload?: DriftPoint;
  onActivate?: (name: string) => void;
}

function DotShape({ cx = 0, cy = 0, payload, onActivate }: DotShapeProps) {
  if (!payload) return null;
  const refName = payload.name;
  const label = shortRefName(refName);
  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={`${label}: ahead ${payload.ahead}, behind ${payload.behind}. Enter / Space to select.`}
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
      {/* Focus ring (SVG 上で outline が効かないため独自に描画) */}
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
    </g>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// Quadrant label readability fixes: WCAG コントラスト確保のため 12px + rs-text
const QUADRANT_LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fill: 'var(--rs-text)',
  fontWeight: 500,
};

export function DriftLens({ repoId, refs, onSelectRef, onChangeLens }: DriftLensProps) {
  const [points, setPoints] = useState<DriftPoint[]>([]);
  const [base, setBase] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [limit] = useState(50);
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
        const res = await fetchRefDrift(
          repoId,
          { base: estimatedBase, limit },
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
    [repoId, refs, limit],
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

  const renderHeader = (baseLabel: string | null) => (
    <LensHeader
      title="Drift"
      oneLiner={
        baseLabel
          ? `base: ${shortRefName(baseLabel)} に対する ahead / behind を散布図で可視化`
          : 'ベースブランチに対する全ブランチの分岐状況を散布図で可視化'
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

  // --- Empty (base found but no diverged branches) ---
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

      {truncated && (
        <div
          role="status"
          style={{
            margin: '0 16px 8px',
            padding: '6px 10px',
            background: 'color-mix(in oklab, var(--rs-bg-elevated), #b45309 18%)',
            border: '1px solid #b45309',
            borderRadius: 'var(--rs-radius-sm)',
            fontFamily: 'var(--rs-sans)',
            fontSize: 11,
            color: '#b45309',
            flexShrink: 0,
          }}
        >
          ⚠ 表示は最初の <strong>{limit}</strong> 件で打ち切られています。
          全件確認には他の Lens (Hotspot / Live) を併用してください。
        </div>
      )}

      {/* SR-only graph description (CoChange と同パターン) */}
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
          Drift 散布図。base: {base}。{points.length} 件のブランチ。
        </p>
        <ul>
          {points.map((p) => (
            <li key={p.name}>
              {shortRefName(p.name)}: ahead {p.ahead}, behind {p.behind}
            </li>
          ))}
        </ul>
      </span>

      <div
        style={{ flex: 1, minHeight: 0, padding: '12px 8px 8px' }}
        role="img"
        aria-label={`Drift scatter chart: ${points.length} branches plotted by ahead and behind commits against base ${base}.`}
        aria-describedby={srDescId}
      >
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
              shape={<DotShape onActivate={onSelectRef} />}
              onClick={(data: unknown) => {
                const pt = data as DriftPoint | undefined;
                if (pt?.name) onSelectRef(pt.name);
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Focus-visible style for SVG group focus ring */}
      <style>{`
        .rs-drift-dot:focus-visible .rs-drift-focus-ring {
          stroke-opacity: 0.85;
        }
      `}</style>
    </div>
  );
}
