/**
 * Co-change Graph Lens — 選択ファイルと共変化 (co-change) するファイルを
 * SVG + d3-force で可視化する。
 *
 * - 中心ノード = selectedFilePath props、未指定なら Hotspot Top-1 ファイルにフォールバック
 * - 周辺ノード = fetchRelatedFiles (top-K=20 ハードキャップ)
 * - エッジ太さ = coChangeCount (正規化)、ラベル = 件数
 * - ノードクリック → 中心入れ替え (再 fetch)
 * - ノードダブルクリック / Space キー → onOpenFileHistory で詳細パネルへ
 * - Enter キー → シングルクリック相当 (中心入れ替え)
 * - d3-force: manyBody + link + center の minimal セットアップ
 *
 * a11y: 各ノードに tabIndex + onKeyDown を設定。SVG 全体に role="img" と
 * aria-describedby、視覚非表示の <ul> で SR 用テキスト経路を提供する。
 */

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import * as d3Force from 'd3-force';
import {
  fetchRelatedFiles,
  fetchFileHotspot,
  type RelatedFileEntry,
} from '../../api';
import { LensHeader } from './LensHeader';
import { EmptyStateCard, type LensEmptyReason, type EmptyStateMessage } from './EmptyStateCard';
import type { LensId } from './LensSwitcher';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoChangeLensProps = {
  repoId: string;
  selectedRef: string;
  /** 選択中ファイルパス (App.tsx から受け取る; null なら Hotspot Top-1 でフォールバック) */
  selectedFilePath: string | null;
  onOpenFileHistory: (path: string) => void;
  /** 他 Lens への遷移 (EmptyStateCard の relatedLenses 用) */
  onChangeLens?: (lens: LensId) => void;
};

type GraphNode = d3Force.SimulationNodeDatum & {
  id: string;
  path: string;
  isCenter: boolean;
  /** 周辺ノード: coChangeCount (中心は 0) */
  coChangeCount: number;
  /** normalized 0–1 (中心は 1) — ノードサイズ計算に使用 */
  strength: number;
  x: number;
  y: number;
};

type GraphLink = d3Force.SimulationLinkDatum<GraphNode> & {
  source: GraphNode;
  target: GraphNode;
  coChangeCount: number;
  /** normalized 0–1 */
  strength: number;
};

/**
 * Co-change 固有の空状態理由。共通の LensEmptyReason は使わず、独自 union を扱う。
 * EmptyStateCard は messages prop で任意 reason をサポートするため互換。
 */
type CoChangeEmptyReason = 'no-center-file' | 'no-related' | 'no-hotspot';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOP_K = 20;
// All visual sizes below are baseline values for a 600x400 canvas.
// At runtime they are multiplied by a `scale` factor derived from the actual
// container dimensions so the graph fills any panel without going tiny.
const CENTER_RADIUS = 22;
const MIN_NODE_RADIUS = 10;
const MAX_NODE_RADIUS = 20;
const MIN_LINK_WIDTH = 1.5;
const MAX_LINK_WIDTH = 7;
const LINK_DIST_NEAR = 110;
const LINK_DIST_FAR = 260;
const CHARGE_STRENGTH = -260;
const NODE_LABEL_FONT = 12;
const CENTER_LABEL_FONT = 11;
const LINK_LABEL_FONT = 11;
const SVG_PADDING = 48;
const SCALE_BASELINE = 600;
const SCALE_MIN = 1;
const SCALE_MAX = 2.4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(t: number, lo: number, hi: number): number {
  return lo + t * (hi - lo);
}

function shortPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

function computeScale(width: number, height: number): number {
  if (!width || !height) return SCALE_MIN;
  const minDim = Math.min(width, height);
  return clamp(minDim / SCALE_BASELINE, SCALE_MIN, SCALE_MAX);
}

// ---------------------------------------------------------------------------
// Help Popover content
// ---------------------------------------------------------------------------

function CoChangeHelpContent() {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--rs-text)' }}>
        Co-change グラフとは
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        中心ファイルと <strong>同じコミットで一緒に変更されたファイル</strong>を
        top-{TOP_K} 件、関連の強さ順に表示します。
        エッジ上の数字は <strong>共に変更されたコミット件数</strong> です。
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        操作
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        ・ノード <strong>クリック</strong> または <strong>Enter</strong>: 中心を入れ替え<br />
        ・ノード <strong>ダブルクリック</strong> または <strong>Space</strong>: ファイル履歴を開く<br />
        ・<strong>Tab</strong>: ノード間フォーカス移動
      </div>
      <div style={{ color: 'var(--rs-text-muted)', fontSize: 11 }}>
        ※ co-change は相関であり因果ではありません。
        ビルド設定ファイルなど構造由来の共変化が含まれることがあります。
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoChangeLens({
  repoId,
  selectedRef,
  selectedFilePath,
  onOpenFileHistory,
  onChangeLens,
}: CoChangeLensProps) {
  const [centerPath, setCenterPath] = useState<string | null>(selectedFilePath);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [svgSize, setSvgSize] = useState({ w: 600, h: 400 });
  const [emptyReason, setEmptyReason] = useState<CoChangeEmptyReason | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastClickTime = useRef<number>(0);
  const lastClickPath = useRef<string>('');
  const focusedNodeRef = useRef<string | null>(null);

  const srDescId = useId();

  // props の selectedFilePath が外から変わったら centerPath を同期する
  useEffect(() => {
    if (selectedFilePath !== null) {
      setCenterPath(selectedFilePath);
    }
  }, [selectedFilePath]);

  // ResizeObserver でコンテナサイズを追跡
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSvgSize({ w: width, h: height });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ---------------------------------------------------------------------------
  // fetch + layout
  // ---------------------------------------------------------------------------

  const doFetch = useCallback(
    (center: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError('');
      setEmptyReason(null);
      // T-A7: 旧グラフを即消去せず、新データ到着時に置換する (Loading 中はそのまま残す)

      fetchRelatedFiles(
        repoId,
        { path: center, ref: selectedRef, limit: TOP_K },
        controller.signal,
      )
        .then((res) => {
          if (controller.signal.aborted) return;
          if (res.related.length === 0) {
            setNodes([]);
            setLinks([]);
            setEmptyReason('no-related');
            return;
          }
          buildGraph(center, res.related, svgSize.w, svgSize.h, setNodes, setLinks);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : 'co-change データの取得に失敗しました');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    },
    // svgSize は fetch 後のレイアウト計算のみに使う。変化してもデータ再取得は不要。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repoId, selectedRef],
  );

  // centerPath が null → Hotspot Top-1 をフォールバック取得
  useEffect(() => {
    if (!repoId) return;
    if (centerPath) {
      doFetch(centerPath);
      return () => {
        abortRef.current?.abort();
      };
    }

    // フォールバック: Hotspot Top-1
    const fallbackController = new AbortController();
    abortRef.current = fallbackController;

    setLoading(true);
    setError('');
    setEmptyReason(null);

    fetchFileHotspot(repoId, { ref: selectedRef, limit: 1 }, fallbackController.signal)
      .then((hotspot) => {
        if (fallbackController.signal.aborted) return;
        const top1 = hotspot.files[0];
        if (!top1) {
          setNodes([]);
          setLinks([]);
          setEmptyReason('no-hotspot');
          setLoading(false);
          return;
        }
        setCenterPath(top1.path);
        // centerPath の state 更新は非同期なので直接 fetch
        doFetch(top1.path);
      })
      .catch((err: unknown) => {
        if (fallbackController.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'ホットスポットの取得に失敗しました');
        setLoading(false);
      });

    return () => {
      abortRef.current?.abort();
    };
  }, [centerPath, repoId, selectedRef, doFetch]);

  // ---------------------------------------------------------------------------
  // Node interaction
  // ---------------------------------------------------------------------------

  const handleNodeActivate = useCallback(
    (path: string) => {
      // シングルクリック相当: 周辺ノードを中心に入れ替え (中心ノードはスキップ)
      const centerNode = nodes.find((n) => n.isCenter);
      if (path !== centerNode?.path) {
        focusedNodeRef.current = path;
        setCenterPath(path);
      }
    },
    [nodes],
  );

  const handleNodeClick = useCallback(
    (path: string) => {
      const now = Date.now();
      const isDoubleClick =
        now - lastClickTime.current < 400 && lastClickPath.current === path;

      lastClickTime.current = now;
      lastClickPath.current = path;

      if (isDoubleClick) {
        onOpenFileHistory(path);
        return;
      }

      handleNodeActivate(path);
    },
    [handleNodeActivate, onOpenFileHistory],
  );

  const handleNodeKeyDown = useCallback(
    (e: KeyboardEvent<SVGGElement>, path: string) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleNodeActivate(path);
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        onOpenFileHistory(path);
      }
    },
    [handleNodeActivate, onOpenFileHistory],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isEmpty = !loading && !error && nodes.length === 0;
  const isHotspotFallback = !selectedFilePath && centerPath !== null;

  const emptyMessages: Partial<Record<CoChangeEmptyReason, EmptyStateMessage>> = {
    'no-center-file': {
      title: 'ファイルが未選択です',
      body:
        'Co-change グラフは中心となるファイルが必要です。Hotspot Lens から探索するか、ファイル履歴を開くと自動で中心に設定されます。',
    },
    'no-related': {
      title: '共変化するファイルが見つかりません',
      body:
        `中心ファイル「${centerPath ?? ''}」と同じコミットで一緒に変更されたファイルが top-${TOP_K} 件以内に見つかりませんでした。別の中心ファイルで試すか、Hotspot Lens で活発に変更されているファイルを確認してください。`,
    },
    'no-hotspot': {
      title: 'ホットスポットデータがありません',
      body:
        'このリポジトリには Hotspot Top-1 のフォールバック候補が見つかりませんでした。コミット履歴がまだ存在しないか、API がアクセスできません。',
    },
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        background: 'var(--rs-bg-panel)',
      }}
    >
      <LensHeader
        title="Co-change Graph"
        oneLiner={
          centerPath
            ? `中心: ${shortPath(centerPath)} と共変化する top-${TOP_K} ファイル`
            : `選択ファイルと共変化するファイルを top-${TOP_K} 件まで表示`
        }
        helpContent={<CoChangeHelpContent />}
      />

      {/* T-B5 の領域 (フォールバックバナー) は PR-B で追加 */}

      {/* Loading */}
      {loading && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 56,
            right: 16,
            padding: '4px 10px',
            background: 'color-mix(in oklab, var(--rs-bg-elevated), transparent 20%)',
            border: '1px solid var(--rs-border)',
            borderRadius: 'var(--rs-radius-sm)',
            color: 'var(--rs-text-secondary)',
            fontFamily: 'var(--rs-sans)',
            fontSize: 11,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          読み込み中…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <EmptyStateCard
          reason={'no-related' as LensEmptyReason}
          messages={{
            ['no-related' as LensEmptyReason]: {
              title: 'データの取得に失敗しました',
              body: error,
            },
          }}
          onChangeLens={onChangeLens}
          relatedLenses={
            onChangeLens
              ? [
                  { id: 'hotspot', label: 'Hotspot を開く' },
                  { id: 'stream', label: 'Live を開く' },
                ]
              : undefined
          }
        />
      )}

      {/* Empty state */}
      {isEmpty && emptyReason && (
        <EmptyStateCard
          reason={emptyReason as unknown as LensEmptyReason}
          messages={emptyMessages as Partial<Record<LensEmptyReason, EmptyStateMessage>>}
          onChangeLens={onChangeLens}
          relatedLenses={
            onChangeLens
              ? emptyReason === 'no-hotspot'
                ? [{ id: 'stream', label: 'Live を開く' }]
                : [
                    { id: 'hotspot', label: 'Hotspot を開く' },
                    { id: 'stream', label: 'Live を開く' },
                  ]
              : undefined
          }
        />
      )}

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
        {centerPath && nodes.length > 0 ? (
          <>
            <p>
              Co-change グラフ。中心ファイル: {centerPath}。関連ファイル {nodes.length - 1} 件。
              {isHotspotFallback ? ' (Hotspot Top-1 から自動選択)' : ''}
            </p>
            <ul>
              {nodes
                .filter((n) => !n.isCenter)
                .map((n) => (
                  <li key={n.id}>
                    {n.path}: {n.coChangeCount} 件の共変化
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <p>Co-change グラフ: データなし</p>
        )}
      </span>

      {/* Graph SVG */}
      {!error && nodes.length > 0 && (() => {
        const scale = computeScale(svgSize.w, svgSize.h);
        const minLinkW = MIN_LINK_WIDTH * scale;
        const maxLinkW = MAX_LINK_WIDTH * scale;
        const centerR = CENTER_RADIUS * scale;
        const minNodeR = MIN_NODE_RADIUS * scale;
        const maxNodeR = MAX_NODE_RADIUS * scale;
        const nodeFont = NODE_LABEL_FONT * scale;
        const centerFont = CENTER_LABEL_FONT * scale;
        const linkFont = LINK_LABEL_FONT * scale;
        return (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${svgSize.w} ${svgSize.h}`}
          style={{
            flex: 1,
            display: 'block',
            cursor: 'default',
            opacity: loading ? 0.4 : 1,
            transition: 'opacity 150ms ease-out',
          }}
          role="img"
          aria-label={
            centerPath
              ? `Co-change グラフ。中心 ${shortPath(centerPath)}、関連 ${nodes.length - 1} 件。`
              : 'Co-change グラフ'
          }
          aria-describedby={srDescId}
        >
          {/* Links */}
          <g>
            {links.map((link, i) => {
              const strokeW = clamp(
                lerp(link.strength, minLinkW, maxLinkW),
                minLinkW,
                maxLinkW,
              );
              const midX = (link.source.x + link.target.x) / 2;
              const midY = (link.source.y + link.target.y) / 2;
              return (
                <g key={i}>
                  <line
                    x1={link.source.x}
                    y1={link.source.y}
                    x2={link.target.x}
                    y2={link.target.y}
                    stroke="var(--rs-border)"
                    strokeWidth={strokeW}
                    strokeOpacity={0.7}
                  />
                  {/* count label */}
                  <text
                    x={midX}
                    y={midY - 4}
                    textAnchor="middle"
                    fontSize={linkFont}
                    fontFamily="var(--rs-mono)"
                    fill="var(--rs-text-muted)"
                    pointerEvents="none"
                  >
                    {link.coChangeCount}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {nodes.map((node) => {
              const r = node.isCenter
                ? centerR
                : clamp(
                    lerp(node.strength, minNodeR, maxNodeR),
                    minNodeR,
                    maxNodeR,
                  );
              const fill = node.isCenter
                ? 'var(--rs-accent)'
                : 'var(--rs-bg-elevated)';
              const stroke = node.isCenter
                ? 'var(--rs-accent)'
                : 'var(--rs-border)';
              const textColor = node.isCenter
                ? 'var(--rs-bg-panel)'
                : 'var(--rs-text)';
              const label = shortPath(node.path);

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => handleNodeClick(node.path)}
                  onKeyDown={(e) => handleNodeKeyDown(e, node.path)}
                  tabIndex={0}
                  className="rs-cochange-node"
                  style={{
                    cursor: node.isCenter ? 'default' : 'pointer',
                    outline: 'none',
                  }}
                  role="button"
                  aria-label={
                    node.isCenter
                      ? `中心ノード: ${node.path}。Space キーでファイル履歴を開く`
                      : `${node.path}。${node.coChangeCount} 件の共変化。Enter で中心を入れ替え、Space で履歴を開く`
                  }
                >
                  {/* Focus ring (SVG では outline が効かないため独自に描画) */}
                  <circle
                    r={r + 4}
                    fill="none"
                    stroke="var(--rs-accent)"
                    strokeWidth={2}
                    strokeOpacity={0}
                    className="rs-cochange-focus-ring"
                  />
                  <circle
                    r={r}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={node.isCenter ? 0 : 1.5}
                    className="rs-cochange-circle"
                    style={{ transition: 'r 150ms ease-out, stroke-width 120ms ease-out' }}
                  />
                  {/* ノード内テキスト (中心のみ) */}
                  {node.isCenter && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={centerFont}
                      fontFamily="var(--rs-mono)"
                      fill={textColor}
                      pointerEvents="none"
                      style={{ userSelect: 'none' }}
                    >
                      {label.length > 14 ? `${label.slice(0, 12)}…` : label}
                    </text>
                  )}
                  {/* ラベル (ノード下) */}
                  <text
                    y={r + nodeFont + 2}
                    textAnchor="middle"
                    fontSize={nodeFont}
                    fontFamily="var(--rs-mono)"
                    fill={node.isCenter ? 'var(--rs-accent)' : 'var(--rs-text-secondary)'}
                    pointerEvents="none"
                    style={{ userSelect: 'none' }}
                  >
                    {label.length > 22 ? `${label.slice(0, 20)}…` : label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        );
      })()}

      {/* Node hover/focus visual feedback */}
      <style>{`
        .rs-cochange-node:not([aria-label^="中心ノード"]):hover .rs-cochange-circle {
          stroke-width: 3 !important;
          stroke: var(--rs-accent) !important;
        }
        .rs-cochange-node:focus-visible .rs-cochange-focus-ring {
          stroke-opacity: 0.85;
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph builder with d3-force
// ---------------------------------------------------------------------------

function buildGraph(
  centerPath: string,
  related: RelatedFileEntry[],
  width: number,
  height: number,
  setNodes: (nodes: GraphNode[]) => void,
  setLinks: (links: GraphLink[]) => void,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const scale = computeScale(width, height);
  const linkDistNear = LINK_DIST_NEAR * scale;
  const linkDistFar = LINK_DIST_FAR * scale;
  const charge = CHARGE_STRENGTH * scale;
  const centerR = CENTER_RADIUS * scale;
  const maxNodeR = MAX_NODE_RADIUS * scale;

  if (related.length === 0) {
    const centerNode: GraphNode = {
      id: centerPath,
      path: centerPath,
      isCenter: true,
      coChangeCount: 0,
      strength: 1,
      x: cx,
      y: cy,
    };
    setNodes([centerNode]);
    setLinks([]);
    return;
  }

  // top-K は既に API 側で制限済みだが、念のため UI 側でも制限
  const capped = related.slice(0, TOP_K);
  const maxCount = Math.max(...capped.map((r) => r.coChangeCount), 1);

  const centerNode: GraphNode = {
    id: centerPath,
    path: centerPath,
    isCenter: true,
    coChangeCount: 0,
    strength: 1,
    x: cx,
    y: cy,
    fx: cx, // 中心を固定
    fy: cy,
  };

  const peripheralNodes: GraphNode[] = capped.map((r) => ({
    id: r.path,
    path: r.path,
    isCenter: false,
    coChangeCount: r.coChangeCount,
    strength: r.coChangeCount / maxCount,
    x: cx + (Math.random() - 0.5) * 100,
    y: cy + (Math.random() - 0.5) * 100,
  }));

  const allNodes: GraphNode[] = [centerNode, ...peripheralNodes];

  const graphLinks: GraphLink[] = peripheralNodes.map((n) => ({
    source: centerNode,
    target: n,
    coChangeCount: n.coChangeCount,
    strength: n.strength,
  }));

  const simulation = d3Force
    .forceSimulation<GraphNode>(allNodes)
    .force(
      'link',
      d3Force
        .forceLink<GraphNode, GraphLink>(graphLinks)
        .id((d) => d.id)
        .distance((d) => {
          // 強度が高い (よく一緒に変化する) ほど中心に近い
          return lerp(1 - (d as GraphLink).strength, linkDistNear, linkDistFar);
        })
        .strength(0.8),
    )
    .force('charge', d3Force.forceManyBody<GraphNode>().strength(charge))
    .force('center', d3Force.forceCenter<GraphNode>(cx, cy).strength(0.18))
    .force(
      'collision',
      d3Force.forceCollide<GraphNode>().radius((d) =>
        (d as GraphNode).isCenter ? centerR + 12 : maxNodeR + 10,
      ),
    )
    .stop();

  // 静的計算 (アニメーションなし) — 初期描画を高速化
  const maxAlpha = simulation.alpha();
  for (let i = 0; i < 200 && simulation.alpha() > simulation.alphaMin(); i++) {
    simulation.tick();
  }
  void maxAlpha;

  // boundary clamp
  const pad = SVG_PADDING;
  for (const node of allNodes) {
    node.x = clamp(node.x ?? cx, pad, width - pad);
    node.y = clamp(node.y ?? cy, pad, height - pad);
  }

  // 中心ノードを確実にセンターに
  centerNode.x = cx;
  centerNode.y = cy;

  setNodes([...allNodes]);
  setLinks([...graphLinks]);
}
