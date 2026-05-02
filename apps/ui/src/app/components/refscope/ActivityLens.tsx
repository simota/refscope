/**
 * Activity Lens (Bubble Force-Directed) — React Flow + d3-force ベースのファイル中心ビジュアライザ。
 * 1 path = 1 円形バブルノード。コミットは「編集イベント」として統計に集約される。
 * force-directed simulation (60 tick 一括) でバブルを配置する。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import { getCommit } from '../../api';
import type { Commit, CommitDetail } from './data';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_COMMITS = 20;
const HIGHLIGHT_MS = 3000;
const NEW_FILE_MS = 3000;
const MAX_CO_CHANGE_EDGES = 200;
const CO_CHANGE_MIN_COUNT = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type FileStat = {
  path: string;
  basename: string;
  parentDir: string;
  commitCount: number;
  totalAdded: number;
  totalDeleted: number;
  lastSeenHash: string;
  lastSeenShortHash: string;
  lastSeenSubject: string;
  lastSeenAuthor: string;
  lastSeenTime: string;
  lastStatus: string;
  firstSeenIndex: number;
  highlightedUntil: number;
  isNewFile: boolean;
  appearedAt: number;
};

type BubbleNodeData = {
  stat: FileStat;
  nowMs: number;
  radius: number;
};

// d3-force simulation types
type SimNode = SimulationNodeDatum & {
  id: string;
  radius: number;
};
type SimLink = SimulationLinkDatum<SimNode>;

// ---------------------------------------------------------------------------
// Helper: bubble radius based on commitCount (4 levels)
// ---------------------------------------------------------------------------
function radiusForCount(count: number): number {
  if (count >= 6) return 86;
  if (count >= 4) return 72;
  if (count >= 2) return 60;
  return 50;
}

// ---------------------------------------------------------------------------
// Helper: status dot color
// ---------------------------------------------------------------------------
function statusDotColor(status: string): string {
  switch (status) {
    case 'A': return '#22c55e'; // green-500
    case 'D': return '#ef4444'; // red-500
    case 'R': return '#f59e0b'; // amber-500
    default:  return '#64748b'; // slate-500 (M and others)
  }
}

// ---------------------------------------------------------------------------
// Helper: truncate string to maxChars
// ---------------------------------------------------------------------------
function truncate(name: string, maxChars: number): string {
  return name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
}

// ---------------------------------------------------------------------------
// Helper: relative time string
// ---------------------------------------------------------------------------
function relativeTime(isoTime: string): string {
  try {
    const diff = Date.now() - new Date(isoTime).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'たった今';
    if (mins < 60) return `${mins}分前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}時間前`;
    return `${Math.floor(hours / 24)}日前`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Helper: hot background based on commitCount (oklab gradient)
// ---------------------------------------------------------------------------
function hotBackground(count: number): string {
  if (count <= 1) return 'var(--rs-bg-elevated, #f8fafc)';
  if (count <= 3) return 'color-mix(in oklab, var(--rs-bg-elevated, #f8fafc), var(--rs-accent, #6366f1) 8%)';
  if (count <= 5) return 'color-mix(in oklab, var(--rs-bg-elevated, #f8fafc), var(--rs-accent, #6366f1) 16%)';
  return 'color-mix(in oklab, var(--rs-bg-elevated, #f8fafc), var(--rs-accent, #6366f1) 24%)';
}

// ---------------------------------------------------------------------------
// Custom node: BubbleNode (円 + 外部ラベル 2 部構成)
// ---------------------------------------------------------------------------
function BubbleNodeComponent({ data }: { data: BubbleNodeData }) {
  const { stat, nowMs, radius } = data;
  const diameter = radius * 2;

  const isDeleted = stat.lastStatus === 'D';
  const isNew = stat.isNewFile && nowMs < stat.appearedAt + NEW_FILE_MS;
  const isHighlighted = nowMs < stat.highlightedUntil;

  let borderStyle: string;
  let boxShadow: string;
  if (isNew && !isDeleted) {
    borderStyle = '2px solid #22c55e';
    boxShadow = '0 0 0 3px rgba(34, 197, 94, 0.25)';
  } else if (isHighlighted && !isDeleted) {
    borderStyle = '2px solid #3b82f6';
    boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.25)';
  } else if (isDeleted) {
    borderStyle = '1px solid #ef4444';
    boxShadow = 'none';
  } else {
    borderStyle = '1px solid var(--rs-border, #cbd5e1)';
    boxShadow = 'none';
  }

  const bg = hotBackground(stat.commitCount);
  const dotColor = statusDotColor(stat.lastStatus);

  // ×N font size: 3 levels by radius
  const countFontSize = radius >= 72 ? 16 : radius >= 60 ? 14 : 12;

  return (
    <div
      style={{
        width: diameter,
        height: diameter,
        position: 'relative',
        overflow: 'visible',
        fontFamily: 'var(--rs-sans, system-ui)',
        userSelect: 'none',
      }}
      role="button"
      tabIndex={0}
      title={`${stat.path}\n${stat.lastSeenSubject}`}
    >
      {/* Handles — 円中心に invisible 固定 */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          opacity: 0,
          pointerEvents: 'none',
          width: 1,
          height: 1,
          minWidth: 1,
          minHeight: 1,
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'transparent',
          border: 'none',
        }}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          opacity: 0,
          pointerEvents: 'none',
          width: 1,
          height: 1,
          minWidth: 1,
          minHeight: 1,
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'transparent',
          border: 'none',
        }}
        isConnectable={false}
      />

      {/* 円本体 — status dot + ×N のみ */}
      <div
        className="bubble-circle"
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          border: borderStyle,
          background: bg,
          boxShadow,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          padding: 10,
          opacity: isDeleted ? 0.6 : 1,
          transition: 'border 200ms ease, box-shadow 200ms ease',
          boxSizing: 'border-box',
        }}
      >
        {/* status dot — 中央上 */}
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
          }}
        />

        {/* ×N — 中央下 (commitCount > 1 のみ) */}
        {stat.commitCount > 1 && (
          <span
            style={{
              fontSize: countFontSize,
              fontWeight: 700,
              fontFamily: 'var(--rs-mono, monospace)',
              color: '#6366f1',
              lineHeight: 1,
            }}
          >
            ×{stat.commitCount}
          </span>
        )}
      </div>

      {/* 外部ラベル — 円の直下 */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 200,
          textAlign: 'center',
          pointerEvents: 'none',
          fontFamily: 'var(--rs-sans, system-ui)',
          background: 'var(--rs-bg-canvas, #ffffff)',
          borderRadius: 4,
          padding: '3px 4px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04)',
        }}
      >
        {/* basename — 1 行目 */}
        <div
          title={stat.path}
          style={{
            fontSize: radius >= 72 ? 13 : 12,
            fontWeight: 600,
            color: isDeleted ? '#ef4444' : 'var(--rs-text-primary, #1e293b)',
            textDecoration: isDeleted ? 'line-through' : 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 200,
            lineHeight: 1.3,
            display: 'inline-block',
          }}
        >
          {stat.basename}
        </div>

        {/* parentDir — 2 行目 (空でない時のみ) */}
        {stat.parentDir && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--rs-text-muted, #94a3b8)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 200,
              marginTop: 1,
              lineHeight: 1.2,
            }}
          >
            {stat.parentDir.length > 28 ? '…' + stat.parentDir.slice(-27) : stat.parentDir}
          </div>
        )}

        {/* lg only: +a -d + relativeTime — 3 行目 */}
        {radius >= 72 && (stat.totalAdded > 0 || stat.totalDeleted > 0 || stat.lastSeenTime) && (
          <div
            style={{
              fontSize: 10,
              marginTop: 2,
              display: 'flex',
              gap: 6,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {stat.totalAdded > 0 && (
              <span style={{ color: '#22c55e', fontFamily: 'var(--rs-mono)' }}>
                +{stat.totalAdded}
              </span>
            )}
            {stat.totalDeleted > 0 && (
              <span style={{ color: '#ef4444', fontFamily: 'var(--rs-mono)' }}>
                -{stat.totalDeleted}
              </span>
            )}
            {stat.lastSeenTime && (
              <span style={{ color: 'var(--rs-text-muted)' }}>
                {relativeTime(stat.lastSeenTime)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// nodeTypes — defined outside component to prevent recreation
// ---------------------------------------------------------------------------
const nodeTypes: NodeTypes = {
  bubble: BubbleNodeComponent as unknown as NodeTypes[string],
};

// ---------------------------------------------------------------------------
// ActivityLens props
// ---------------------------------------------------------------------------
export type ActivityLensProps = {
  repoId: string | null;
  commits: Commit[];
  selectedCommitHash: string | null;
  onSelectCommit: (hash: string) => void;
  paused?: boolean;
};

// ---------------------------------------------------------------------------
// Helper: build co-change edges from detailCache (node-centric top-3)
// ---------------------------------------------------------------------------
function buildCoChangeEdges(
  detailCache: Map<string, CommitDetail>,
  statistics: Map<string, FileStat>,
): Edge[] {
  const coCount = new Map<string, number>();

  for (const detail of detailCache.values()) {
    const paths = detail.files.map((f) => f.path);
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const a = paths[i] < paths[j] ? paths[i] : paths[j];
        const b = paths[i] < paths[j] ? paths[j] : paths[i];
        const key = `${a}\x00${b}`;
        coCount.set(key, (coCount.get(key) ?? 0) + 1);
      }
    }
  }

  const adoptedKeys = new Set<string>();

  for (const path of statistics.keys()) {
    const related: Array<{ key: string; count: number }> = [];
    for (const [key, count] of coCount.entries()) {
      if (count < CO_CHANGE_MIN_COUNT) continue;
      const [a, b] = key.split('\x00');
      if (a === path || b === path) {
        related.push({ key, count });
      }
    }
    related.sort((x, y) => y.count - x.count);
    for (let i = 0; i < Math.min(3, related.length); i++) {
      adoptedKeys.add(related[i].key);
    }
  }

  const sortedAdopted = Array.from(adoptedKeys)
    .map((key) => ({ key, count: coCount.get(key) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CO_CHANGE_EDGES);

  const edges: Edge[] = [];

  for (const { key, count } of sortedAdopted) {
    const [pathA, pathB] = key.split('\x00');
    const statA = statistics.get(pathA);
    const statB = statistics.get(pathB);
    if (!statA || !statB) continue;

    const ai = Math.min(statA.firstSeenIndex, statB.firstSeenIndex);
    const bi = Math.max(statA.firstSeenIndex, statB.firstSeenIndex);

    let strokeColor: string;
    let strokeWidth: number;
    let opacity: number;
    if (count >= 5) {
      strokeColor = '#a855f7'; // purple-500
      strokeWidth = 3;
      opacity = 0.85;
    } else if (count >= 2) {
      strokeColor = '#6366f1'; // indigo-500
      strokeWidth = 2;
      opacity = 0.7;
    } else {
      strokeColor = '#94a3b8'; // slate-400
      strokeWidth = 1.2;
      opacity = 0.6;
    }

    edges.push({
      id: `cochange-${ai}-${bi}`,
      source: `file-${pathA}`,
      target: `file-${pathB}`,
      type: 'straight',
      style: {
        stroke: strokeColor,
        strokeWidth,
        opacity,
      },
    });
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Helper: run force simulation synchronously (60 tick burst) and return positions
// ---------------------------------------------------------------------------
function runSimulation(
  statsArray: FileStat[],
  edges: Edge[],
  prevPositions: Map<string, { x: number; y: number }>,
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const w = Math.max(width, 400);
  const h = Math.max(height, 400);

  const simNodes: SimNode[] = statsArray.map((stat) => {
    const id = `file-${stat.path}`;
    const prev = prevPositions.get(id);
    const radius = radiusForCount(stat.commitCount);
    return {
      id,
      radius,
      x: prev?.x ?? w / 2 + (Math.random() - 0.5) * 100,
      y: prev?.y ?? h / 2 + (Math.random() - 0.5) * 100,
    };
  });

  const nodeById = new Map(simNodes.map((n) => [n.id, n]));

  const simLinks: SimLink[] = edges
    .map((e) => {
      const source = nodeById.get(e.source as string);
      const target = nodeById.get(e.target as string);
      if (!source || !target) return null;
      return { source, target } as SimLink;
    })
    .filter((l): l is SimLink => l !== null);

  const sim: Simulation<SimNode, SimLink> = forceSimulation<SimNode>(simNodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((l) => {
          const src = l.source as SimNode;
          const tgt = l.target as SimNode;
          return 60 + (src.radius ?? 28) + (tgt.radius ?? 28);
        })
        .strength(0.4),
    )
    .force('charge', forceManyBody<SimNode>().strength(-180))
    .force('center', forceCenter(w / 2, h / 2))
    .force('collide', forceCollide<SimNode>().radius((d) => d.radius + 50).iterations(2))
    .alpha(0.6)
    .alphaDecay(0.05)
    .stop();

  for (let i = 0; i < 60; i++) {
    sim.tick();
  }

  const result = new Map<string, { x: number; y: number }>();
  for (const node of simNodes) {
    result.set(node.id, { x: node.x ?? w / 2, y: node.y ?? h / 2 });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main ActivityLens component
// ---------------------------------------------------------------------------
export function ActivityLens({
  repoId,
  commits,
}: ActivityLensProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Container size for force center
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);

  // Cache of fetched CommitDetail keyed by hash
  const [detailCache, setDetailCache] = useState<Map<string, CommitDetail>>(
    () => new Map(),
  );

  // File statistics — path -> FileStat
  const [statistics, setStatistics] = useState<Map<string, FileStat>>(
    () => new Map(),
  );

  // firstSeenIndex は一度決まったら不変
  const firstSeenIndexRef = useRef<Map<string, number>>(new Map());

  // hashes already incorporated into statistics
  const processedHashesRef = useRef<Set<string>>(new Set());

  // Previous node positions (seed for next simulation)
  const prevPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // simulation ref (for drag stop)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);

  // new commits banner
  const prevFirstHashRef = useRef<string | null>(null);
  const [newSinceLastFit, setNewSinceLastFit] = useState(0);
  const reactFlowRef = useRef<{ fitView: () => void } | null>(null);

  // ResizeObserver: update container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch detail for a single commit (idempotent)
  const fetchDetail = useCallback(
    async (hash: string) => {
      if (!repoId) return;
      if (detailCache.has(hash)) return;
      try {
        const detail = await getCommit(repoId, hash);
        setDetailCache((prev) => {
          if (prev.has(hash)) return prev;
          const next = new Map(prev);
          next.set(hash, detail);
          return next;
        });
      } catch {
        // Non-critical: node will show without file detail
      }
    },
    [repoId, detailCache],
  );

  // Fetch details for all commits in view
  useEffect(() => {
    const sliced = commits.slice(0, MAX_COMMITS);
    for (const c of sliced) {
      if (!detailCache.has(c.hash)) {
        void fetchDetail(c.hash);
      }
    }
  }, [commits, detailCache, fetchDetail]);

  // New commits banner detection
  useEffect(() => {
    const firstHash = commits[0]?.hash ?? null;
    if (firstHash && firstHash !== prevFirstHashRef.current) {
      if (prevFirstHashRef.current !== null) {
        setNewSinceLastFit((prev) => prev + 1);
      }
      prevFirstHashRef.current = firstHash;
    }
  }, [commits]);

  // Rebuild statistics whenever commits or detailCache changes
  useEffect(() => {
    const sliced = commits.slice(0, MAX_COMMITS);
    const nowMs = Date.now();

    setStatistics((prevStats) => {
      const next = new Map(prevStats);

      for (const commit of sliced) {
        const detail = detailCache.get(commit.hash);
        if (!detail) continue;
        if (processedHashesRef.current.has(commit.hash)) continue;

        const files = detail.files;
        const shortHash = commit.shortHash ?? commit.hash.slice(0, 7);

        for (const file of files) {
          const path = file.path;
          const existing = next.get(path);
          if (existing) {
            next.set(path, {
              ...existing,
              commitCount: existing.commitCount + 1,
              totalAdded: existing.totalAdded + (file.added ?? 0),
              totalDeleted: existing.totalDeleted + (file.deleted ?? 0),
              lastSeenHash: commit.hash,
              lastSeenShortHash: shortHash,
              lastSeenSubject: commit.subject,
              lastSeenAuthor: commit.author,
              lastSeenTime: commit.time,
              lastStatus: file.status,
              highlightedUntil: nowMs + HIGHLIGHT_MS,
            });
          } else {
            let idx = firstSeenIndexRef.current.get(path);
            if (idx === undefined) {
              idx = firstSeenIndexRef.current.size;
              firstSeenIndexRef.current.set(path, idx);
            }
            next.set(path, {
              path,
              basename: path.split('/').pop() ?? path,
              parentDir: path.includes('/')
                ? path.split('/').slice(0, -1).join('/')
                : '',
              commitCount: 1,
              totalAdded: file.added ?? 0,
              totalDeleted: file.deleted ?? 0,
              lastSeenHash: commit.hash,
              lastSeenShortHash: shortHash,
              lastSeenSubject: commit.subject,
              lastSeenAuthor: commit.author,
              lastSeenTime: commit.time,
              lastStatus: file.status,
              firstSeenIndex: idx,
              highlightedUntil: nowMs + HIGHLIGHT_MS,
              isNewFile: true,
              appearedAt: nowMs,
            });
          }
        }

        processedHashesRef.current.add(commit.hash);
      }

      return next;
    });
  }, [commits, detailCache]);

  // Run simulation and rebuild nodes whenever statistics or container size changes
  useEffect(() => {
    if (statistics.size === 0) return;
    if (containerWidth === 0 || containerHeight === 0) return;

    const nowMs = Date.now();
    const statsArray = Array.from(statistics.values());

    // Build edges first (needed for simulation links)
    const builtEdges = buildCoChangeEdges(detailCache, statistics);

    // Run simulation
    const positions = runSimulation(
      statsArray,
      builtEdges,
      prevPositionsRef.current,
      containerWidth,
      containerHeight,
    );

    // Save positions for next run
    prevPositionsRef.current = positions;

    // Build React Flow nodes with simulated positions
    const newNodes: Node[] = statsArray.map((stat) => {
      const id = `file-${stat.path}`;
      const radius = radiusForCount(stat.commitCount);
      const pos = positions.get(id) ?? { x: containerWidth / 2, y: containerHeight / 2 };
      return {
        id,
        type: 'bubble',
        position: { x: pos.x - radius, y: pos.y - radius },
        style: { width: radius * 2, height: radius * 2 },
        data: { stat, nowMs, radius } satisfies BubbleNodeData,
      };
    });

    setNodes(newNodes);
    setEdges(builtEdges);
  }, [statistics, detailCache, containerWidth, containerHeight, setNodes, setEdges]);

  // Re-render nodes every second to update highlight timers
  useEffect(() => {
    const interval = setInterval(() => {
      setNodes((prev) =>
        prev.map((n) => ({
          ...n,
          data: { ...(n.data as BubbleNodeData), nowMs: Date.now() },
        })),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [setNodes]);

  // Empty state
  if (commits.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-3"
        style={{
          color: 'var(--rs-text-muted)',
          fontFamily: 'var(--rs-sans)',
          fontSize: 13,
        }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ opacity: 0.4 }}
        >
          <circle cx="12" cy="12" r="3" />
          <circle cx="4" cy="6" r="2" />
          <circle cx="20" cy="6" r="2" />
          <circle cx="4" cy="18" r="2" />
          <circle cx="20" cy="18" r="2" />
          <line x1="6" y1="6" x2="10" y2="11" />
          <line x1="18" y1="6" x2="14" y2="11" />
          <line x1="6" y1="18" x2="10" y2="13" />
          <line x1="18" y1="18" x2="14" y2="13" />
        </svg>
        <p>リポジトリを選択するとファイルノードが表示されます</p>
      </div>
    );
  }

  const fileCount = statistics.size;
  const commitCount = Math.min(commits.length, MAX_COMMITS);
  const latestCommit = commits[0];
  const latestShortHash = latestCommit?.shortHash ?? latestCommit?.hash.slice(0, 7) ?? '';
  const latestSubject = latestCommit?.subject ?? '';
  const truncatedSubject =
    latestSubject.length > 30 ? latestSubject.slice(0, 30) + '…' : latestSubject;

  const coChangeCount = edges.length;

  return (
    <div ref={containerRef} className="rs-activity-lens relative h-full w-full">
      {/* Header: リアルタイム更新インジケータ */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 12,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '5px 10px',
          borderRadius: 4,
          background: 'color-mix(in oklab, var(--rs-bg-elevated, #f8fafc), transparent 20%)',
          border: '1px solid var(--rs-border, #e2e8f0)',
          backdropFilter: 'blur(4px)',
          fontFamily: 'var(--rs-sans, system-ui)',
          fontSize: 11,
          color: 'var(--rs-text-secondary, #64748b)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#22c55e',
              flexShrink: 0,
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }}
            aria-hidden="true"
          />
          <span>リアルタイム更新中</span>
        </div>
        <div style={{ color: 'var(--rs-text-muted, #94a3b8)', paddingLeft: 13 }}>
          {fileCount} ファイル / {commitCount} コミット
        </div>
        {latestCommit && (
          <div
            style={{
              paddingLeft: 13,
              color: 'var(--rs-text-muted, #94a3b8)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 220,
            }}
          >
            {latestShortHash} {truncatedSubject}
          </div>
        )}
        {coChangeCount > 0 && (
          <div style={{ paddingLeft: 13, color: 'var(--rs-text-muted, #94a3b8)' }}>
            co-change: {coChangeCount} 件表示中
          </div>
        )}
      </div>

      {/* Legend: 左下に絶対配置 */}
      <div
        style={{
          position: 'absolute',
          bottom: 48,
          left: 12,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '6px 10px',
          borderRadius: 4,
          background: 'color-mix(in oklab, var(--rs-bg-elevated, #f8fafc), transparent 20%)',
          border: '1px solid var(--rs-border, #e2e8f0)',
          backdropFilter: 'blur(4px)',
          fontFamily: 'var(--rs-sans, system-ui)',
          fontSize: 10,
          color: 'var(--rs-text-secondary, #64748b)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {([
          { color: '#22c55e', label: '新規 (このセッション初登場)' },
          { color: '#3b82f6', label: '更新 (直近コミットで変更)' },
          { color: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', label: 'ホット (色濃度)' },
          { color: '#ef4444', label: '削除' },
        ] as const).map(({ color, label }) => (
          <div
            key={label}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: color,
                flexShrink: 0,
                border: '1px solid rgba(0,0,0,0.1)',
              }}
            />
            <span>{label}</span>
          </div>
        ))}
        {/* ステータス dot 凡例 (横並び 1 行) */}
        <div
          style={{
            marginTop: 2,
            paddingTop: 4,
            borderTop: '1px solid var(--rs-border, #e2e8f0)',
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {([
            { color: '#64748b', label: 'M' },
            { color: '#22c55e', label: 'A' },
            { color: '#ef4444', label: 'D' },
            { color: '#f59e0b', label: 'R' },
          ] as const).map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 9, color: 'var(--rs-text-muted, #94a3b8)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>
        {/* サイズ説明 */}
        <div
          style={{
            marginTop: 2,
            paddingTop: 4,
            borderTop: '1px solid var(--rs-border, #e2e8f0)',
            color: 'var(--rs-text-muted, #94a3b8)',
            fontSize: 9,
          }}
        >
          円のサイズ = 変更回数 / 下のラベル = ファイル名
        </div>
      </div>

      {/* New commits banner */}
      {newSinceLastFit > 0 && (
        <button
          type="button"
          onClick={() => {
            setNewSinceLastFit(0);
            if (reactFlowRef.current) {
              reactFlowRef.current.fitView();
            }
          }}
          style={{
            position: 'absolute',
            bottom: 48,
            right: 12,
            zIndex: 10,
            padding: '5px 10px',
            borderRadius: 4,
            border: '1px solid #3b82f6',
            background: 'rgba(59, 130, 246, 0.1)',
            color: '#3b82f6',
            fontFamily: 'var(--rs-sans, system-ui)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
          aria-label={`${newSinceLastFit} 件の新着コミット。クリックでフィット`}
        >
          ↑ {newSinceLastFit} 件の新着コミット
        </button>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        onInit={(instance) => {
          reactFlowRef.current = {
            fitView: () => instance.fitView({ padding: 0.2, duration: 400 }),
          };
        }}
        onNodeDragStart={() => {
          if (simRef.current) simRef.current.alpha(0);
        }}
        onNodeDragStop={() => {
          if (simRef.current) simRef.current.stop();
        }}
        proOptions={{ hideAttribution: false }}
        style={{ background: 'var(--rs-bg-canvas, #ffffff)' }}
        aria-label="ファイルグラフ"
      >
        <Background
          color="var(--rs-border, #e2e8f0)"
          gap={24}
          size={1}
          style={{ opacity: 0.5 }}
        />
        <Controls
          style={{ bottom: 8, right: 8 }}
          aria-label="グラフコントロール"
        />
      </ReactFlow>

      {/* Pulse animation + edge CSS overrides */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .rs-activity-lens .react-flow__edge-path {
          stroke-opacity: 1;
        }
        .rs-activity-lens .react-flow__edge .react-flow__edge-path {
          fill: none;
        }
        .rs-activity-lens .react-flow__node {
          transition: z-index 0s;
        }
        .rs-activity-lens .react-flow__node:hover {
          z-index: 1000 !important;
        }
      `}</style>
    </div>
  );
}
