/**
 * Co-change Graph Lens — 選択ファイルと共変化 (co-change) するファイルを
 * SVG + d3-force で可視化する。
 *
 * - 中心ノード = selectedFilePath props、未指定なら Hotspot Top-1 ファイルにフォールバック
 * - 周辺ノード = fetchRelatedFiles (top-K=20 ハードキャップ)
 * - エッジ太さ = coChangeCount (正規化)、ラベル = 件数
 * - ノードクリック → 中心入れ替え (再 fetch)
 * - ノードダブルクリック → onOpenFileHistory で詳細パネルへ
 * - d3-force: manyBody + link + center の minimal セットアップ
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as d3Force from 'd3-force';
import {
  fetchRelatedFiles,
  fetchFileHotspot,
  type RelatedFileEntry,
} from '../../api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoChangeLensProps = {
  repoId: string;
  selectedRef: string;
  /** 選択中ファイルパス (App.tsx から受け取る; null なら Hotspot Top-1 でフォールバック) */
  selectedFilePath: string | null;
  onOpenFileHistory: (path: string) => void;
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOP_K = 20;
const CENTER_RADIUS = 18;
const MIN_NODE_RADIUS = 6;
const MAX_NODE_RADIUS = 14;
const MIN_LINK_WIDTH = 1;
const MAX_LINK_WIDTH = 6;
const SVG_PADDING = 40;

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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoChangeLens({
  repoId,
  selectedRef,
  selectedFilePath,
  onOpenFileHistory,
}: CoChangeLensProps) {
  const [centerPath, setCenterPath] = useState<string | null>(selectedFilePath);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [svgSize, setSvgSize] = useState({ w: 600, h: 400 });

  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastClickTime = useRef<number>(0);
  const lastClickPath = useRef<string>('');

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
      setNodes([]);
      setLinks([]);

      fetchRelatedFiles(
        repoId,
        { path: center, ref: selectedRef, limit: TOP_K },
        controller.signal,
      )
        .then((res) => {
          if (controller.signal.aborted) return;
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

    fetchFileHotspot(repoId, { ref: selectedRef, limit: 1 }, fallbackController.signal)
      .then((hotspot) => {
        if (fallbackController.signal.aborted) return;
        const top1 = hotspot.files[0];
        if (!top1) {
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

      // シングルクリック: 周辺ノードを中心に入れ替え (中心ノードはスキップ)
      const centerNode = nodes.find((n) => n.isCenter);
      if (path !== centerNode?.path) {
        setCenterPath(path);
      }
    },
    [nodes, onOpenFileHistory],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isEmpty = !loading && !error && nodes.length === 0;

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
      {/* Header strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid var(--rs-border)',
          fontSize: 11,
          fontFamily: 'var(--rs-sans)',
          color: 'var(--rs-text-secondary)',
          flexShrink: 0,
          minHeight: 32,
        }}
      >
        {centerPath ? (
          <span
            title={centerPath}
            style={{
              fontFamily: 'var(--rs-mono)',
              color: 'var(--rs-accent)',
              fontSize: 11,
              maxWidth: 360,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {centerPath}
          </span>
        ) : (
          <span>Co-change Graph</span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          click = 中心入替 · dblclick = 詳細表示 · top-{TOP_K}
        </span>
      </div>

      {/* Loading */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--rs-text-secondary)',
            fontFamily: 'var(--rs-sans)',
            fontSize: 13,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          読み込み中…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div
          style={{
            display: 'flex',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--rs-git-deleted)',
            fontFamily: 'var(--rs-sans)',
            fontSize: 13,
            padding: 24,
            textAlign: 'center',
          }}
        >
          {error}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div
          style={{
            display: 'flex',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--rs-text-secondary)',
            fontFamily: 'var(--rs-sans)',
            fontSize: 13,
          }}
        >
          {centerPath
            ? 'No co-change data'
            : 'ファイルを選択するか、ホットスポットデータが存在しません'}
        </div>
      )}

      {/* Graph SVG */}
      {!error && nodes.length > 0 && (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${svgSize.w} ${svgSize.h}`}
          style={{ flex: 1, display: 'block', cursor: 'default' }}
          aria-label="Co-change graph"
        >
          {/* Links */}
          <g>
            {links.map((link, i) => {
              const strokeW = clamp(
                lerp(link.strength, MIN_LINK_WIDTH, MAX_LINK_WIDTH),
                MIN_LINK_WIDTH,
                MAX_LINK_WIDTH,
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
                    fontSize={9}
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
                ? CENTER_RADIUS
                : clamp(
                    lerp(node.strength, MIN_NODE_RADIUS, MAX_NODE_RADIUS),
                    MIN_NODE_RADIUS,
                    MAX_NODE_RADIUS,
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
                  style={{ cursor: 'pointer' }}
                  role="button"
                  aria-label={node.path}
                >
                  <circle
                    r={r}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={node.isCenter ? 0 : 1.5}
                    style={{ transition: 'r 150ms ease-out' }}
                  />
                  {/* ノード内テキスト (中心のみ) */}
                  {node.isCenter && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={8}
                      fontFamily="var(--rs-mono)"
                      fill={textColor}
                      pointerEvents="none"
                      style={{ userSelect: 'none' }}
                    >
                      {label.length > 12 ? `${label.slice(0, 10)}…` : label}
                    </text>
                  )}
                  {/* ラベル (ノード下) */}
                  <text
                    y={r + 10}
                    textAnchor="middle"
                    fontSize={9}
                    fontFamily="var(--rs-mono)"
                    fill={node.isCenter ? 'var(--rs-accent)' : 'var(--rs-text-secondary)'}
                    pointerEvents="none"
                    style={{ userSelect: 'none' }}
                  >
                    {label.length > 18 ? `${label.slice(0, 16)}…` : label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
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
          return lerp(1 - (d as GraphLink).strength, 80, 200);
        })
        .strength(0.8),
    )
    .force('charge', d3Force.forceManyBody<GraphNode>().strength(-120))
    .force('center', d3Force.forceCenter<GraphNode>(cx, cy).strength(0.3))
    .force(
      'collision',
      d3Force.forceCollide<GraphNode>().radius((d) =>
        (d as GraphNode).isCenter ? CENTER_RADIUS + 10 : MAX_NODE_RADIUS + 8,
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
