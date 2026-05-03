/**
 * Pulse Lens — コードベースの"鼓動"をリアルタイムに見せる Canvas パーティクル・ビジュアライザ。
 *
 *   - ファイル変更 = 粒子（パーティクル）として描画
 *   - 変更回数    = 粒子サイズ
 *   - ファイル種別 = 色（code / style / config / docs / test / asset / markup / other）
 *   - 直近の更新  = グロー & パルスリング + 花火スパーク
 *   - 新規ファイル = radial shockwave + 花火バースト
 *   - Idle        = sin ベースの breathing + ポップコーン pop
 *
 * ログ的な「Activity」ではなく、コードベースが今動いている感覚を映すレイヤー。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  forceSimulation,
  type Simulation,
} from 'd3-force';
import { getCommit, type WorkTreeResponse } from '../../api';
import type { Commit, CommitDetail } from './data';
import { FileContextMenu } from './FileContextMenu';
import { extractWorkTreeFiles } from '../../lib/workTreeFiles';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_COMMITS = 30;
const HIGHLIGHT_MS = 4000;
const NEW_FILE_MS = 3500;
const BURST_MS = 600;
const RECENT_CHANGES_MAX = 8;
const RECENCY_FADE_MS = 30 * 60 * 1000; // 30 分以上で明度低下
const TAU = Math.PI * 2;
const MAX_SPARKS = 180;

// ---------------------------------------------------------------------------
// File-kind classification
// ---------------------------------------------------------------------------
type FileKind =
  | 'code'
  | 'style'
  | 'config'
  | 'markup'
  | 'docs'
  | 'test'
  | 'asset'
  | 'other';

const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'go', 'rs', 'rb', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'h', 'hpp', 'php', 'sh', 'bash', 'zsh',
  'lua', 'dart', 'ex', 'exs', 'erl', 'clj', 'scala',
]);
const STYLE_EXT = new Set(['css', 'scss', 'sass', 'less', 'postcss', 'styl']);
const CONFIG_EXT = new Set(['json', 'yml', 'yaml', 'toml', 'ini', 'env', 'lock']);
const MARKUP_EXT = new Set(['html', 'xml', 'vue', 'svelte', 'astro']);
const DOCS_EXT = new Set(['md', 'mdx', 'txt', 'rst', 'adoc']);
const ASSET_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
  'woff', 'woff2', 'ttf', 'otf',
  'mp3', 'mp4', 'wav', 'webm',
]);

function classifyFile(path: string): FileKind {
  if (/\.(test|spec)\.[a-z0-9]+$/i.test(path)) return 'test';
  const m = path.match(/\.([a-z0-9]+)$/i);
  const ext = m ? m[1].toLowerCase() : '';
  if (CODE_EXT.has(ext)) return 'code';
  if (STYLE_EXT.has(ext)) return 'style';
  if (CONFIG_EXT.has(ext)) return 'config';
  if (MARKUP_EXT.has(ext)) return 'markup';
  if (DOCS_EXT.has(ext)) return 'docs';
  if (ASSET_EXT.has(ext)) return 'asset';
  return 'other';
}

function colorForKind(kind: FileKind): string {
  switch (kind) {
    case 'code':   return '#3b82f6'; // blue-500
    case 'style':  return '#ec4899'; // pink-500
    case 'config': return '#f59e0b'; // amber-500
    case 'markup': return '#8b5cf6'; // violet-500
    case 'docs':   return '#64748b'; // slate-500
    case 'test':   return '#22c55e'; // green-500
    case 'asset':  return '#14b8a6'; // teal-500
    case 'other':  return '#94a3b8'; // slate-400
  }
}

function fingerprint(stat: FileStat): string {
  return `${stat.lastSeenHash}::${stat.commitCount}::${stat.totalAdded}::${stat.totalDeleted}::${stat.lastStatus}`;
}

function labelForKind(kind: FileKind): string {
  switch (kind) {
    case 'code':   return 'Code';
    case 'style':  return 'Style';
    case 'config': return 'Config';
    case 'markup': return 'Markup';
    case 'docs':   return 'Docs';
    case 'test':   return 'Test';
    case 'asset':  return 'Asset';
    case 'other':  return 'Other';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function radiusForCount(count: number): number {
  if (count >= 6) return 12;
  if (count >= 4) return 10;
  if (count >= 2) return 8;
  return 6.5;
}

// 上位 2 セグメントでグループ化。ルート直下は (root)
function topGroupForPath(path: string): string {
  const parts = path.split('/').filter((s) => s.length > 0);
  if (parts.length <= 1) return '(root)';
  if (parts.length === 2) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

function relativeTime(iso: string): string {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 5) return 'just now';
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  } catch {
    return '';
  }
}

function statusGlyph(status: string): string {
  switch (status) {
    case 'A': return '＋';
    case 'D': return '−';
    case 'R': return '↦';
    default:  return '·';
  }
}

// hex color → { r, g, b } (simple 6-digit hex)
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

// hexToRgb 結果キャッシュ — per-frame 計算を避ける
const rgbCache = new Map<string, { r: number; g: number; b: number }>();
function cachedHexToRgb(hex: string): { r: number; g: number; b: number } {
  let v = rgbCache.get(hex);
  if (!v) { v = hexToRgb(hex); rgbCache.set(hex, v); }
  return v;
}

// ---------------------------------------------------------------------------
// Sprite cache — shadowBlur/radialGradient をオフスクリーンに焼き込む
// ---------------------------------------------------------------------------
type SpriteKey = `${FileKind}-${number}`;
const spriteCache = new Map<SpriteKey, HTMLCanvasElement>();

// radius バケット: radiusForCount の返値と揃える
const SIZE_RADII = [6.5, 8, 10, 12] as const;
function getSizeBucket(radius: number): number {
  if (radius >= 12) return 3;
  if (radius >= 10) return 2;
  if (radius >= 8)  return 1;
  return 0;
}

function getSprite(kind: FileKind, bucket: number, dpr: number): HTMLCanvasElement {
  const key: SpriteKey = `${kind}-${bucket}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const radius = SIZE_RADII[bucket];
  const margin = radius * 4; // shadowBlur 用余白
  const size = (radius + margin) * 2;

  const sprite = document.createElement('canvas');
  sprite.width = Math.ceil(size * dpr);
  sprite.height = Math.ceil(size * dpr);
  const sctx = sprite.getContext('2d')!;
  sctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const { r, g, b } = cachedHexToRgb(colorForKind(kind));

  sctx.shadowBlur = radius * 1.8;
  sctx.shadowColor = `rgba(${r},${g},${b},0.65)`;

  const grad = sctx.createRadialGradient(
    cx - radius * 0.25, cy - radius * 0.25, 0,
    cx, cy, radius,
  );
  grad.addColorStop(0, `rgba(${Math.min(255, r + 80)},${Math.min(255, g + 80)},${Math.min(255, b + 80)},1)`);
  grad.addColorStop(0.65, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(1, `rgba(${Math.round(r * 0.7)},${Math.round(g * 0.7)},${Math.round(b * 0.7)},1)`);

  sctx.beginPath();
  sctx.arc(cx, cy, radius, 0, TAU);
  sctx.fillStyle = grad;
  sctx.fill();

  spriteCache.set(key, sprite);
  return sprite;
}

// spark 用スプライト (白 1px、drawImage でスケール + compositeOperation 'lighter' でカラーティント)
let sparkSprite: HTMLCanvasElement | null = null;
function getSparkSprite(dpr: number): HTMLCanvasElement {
  if (sparkSprite) return sparkSprite;
  const size = 8; // 内部サイズ (px)
  sparkSprite = document.createElement('canvas');
  sparkSprite.width = Math.ceil(size * dpr);
  sparkSprite.height = Math.ceil(size * dpr);
  const sctx = sparkSprite.getContext('2d')!;
  sctx.scale(dpr, dpr);
  const cx = size / 2;
  // shadowBlur をスプライトに焼き込む
  sctx.shadowBlur = size * 2;
  sctx.shadowColor = 'rgba(255,255,255,0.9)';
  sctx.beginPath();
  sctx.arc(cx, cx, size / 4, 0, TAU);
  sctx.fillStyle = 'rgba(255,255,255,1)';
  sctx.fill();
  return sparkSprite;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type FileStat = {
  path: string;
  basename: string;
  parentDir: string;
  topGroup: string;
  kind: FileKind;
  commitCount: number;
  totalAdded: number;
  totalDeleted: number;
  lastSeenHash: string;
  lastSeenShortHash: string;
  lastSeenSubject: string;
  lastSeenTime: string;
  lastStatus: string;
  highlightedUntil: number;
  isNewFile: boolean;
  appearedAt: number;
  isWorkingTree: boolean;
};

type RecentEntry = {
  id: string;
  path: string;
  basename: string;
  parentDir: string;
  status: string;
  kind: FileKind;
  added: number;
  deleted: number;
  commitHash: string;
  commitShortHash: string;
  subject: string;
  time: string;
  isWorkingTree: boolean;
};

// d3-force ノード (FileStat を拡張)
type ParticleNode = {
  stat: FileStat;
  // d3-force が書き込む座標
  x: number;
  y: number;
  vx: number;
  vy: number;
  // idle breathing 用固有位相 (rad)
  phase: number;
  // breathing 周期 (ms)
  period: number;
  // ポップコーン pop 終了時刻 (0 = 非アクティブ)
  popUntil: number;
  // 前フレームでハイライトされていたか (ラベル強調用)
  wasHighlighted: boolean;
  // 発火直後のスケールバースト終了時刻 (0 = 非アクティブ)
  burstUntil: number;
  // 前回爆発を発火したときの fingerprint — 変化検知用
  lastFiredHash: string;
  // ラベル文字列をキャッシュ (per-frame 計算回避)
  truncatedName: string;
};

// 花火スパーク粒子
type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;   // 残り life (0–1)
  decay: number;  // life/frame の減衰率
  color: string;  // hex
  size: number;   // px
};

// 発火点のホワイトフラッシュ
type Flash = { x: number; y: number; color: string; until: number };

// 背景に漂う twinkle dot
type Twinkle = {
  x: number;
  y: number;
  radius: number;
  baseAlpha: number;
  phase: number;
  period: number; // ms
  r: number;
  g: number;
  b: number;
};

const WORKING_TREE_HASH = 'WORKING-TREE';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export type PulseLensProps = {
  repoId: string | null;
  commits: Commit[];
  selectedCommitHash: string | null;
  onSelectCommit: (hash: string) => void;
  onOpenFileHistory?: (path: string) => void;
  workTree?: WorkTreeResponse | null;
  paused?: boolean;
};

// ---------------------------------------------------------------------------
// Canvas particle field hook
// ---------------------------------------------------------------------------
type UseCanvasParticleFieldParams = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  groups: Array<{ key: string; files: FileStat[]; total: number }>;
  reducedMotion: boolean;
  onClickFile: (stat: FileStat) => void;
  onContextMenu: (event: React.MouseEvent, path: string) => void;
};

function useCanvasParticleField({
  canvasRef,
  groups,
  reducedMotion,
  onClickFile,
  onContextMenu,
}: UseCanvasParticleFieldParams) {
  // stable refs for callbacks — avoids tearing down the sim on every render
  const onClickRef = useRef(onClickFile);
  const onContextMenuRef = useRef(onContextMenu);
  useEffect(() => { onClickRef.current = onClickFile; }, [onClickFile]);
  useEffect(() => { onContextMenuRef.current = onContextMenu; }, [onContextMenu]);

  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  // groups 変化時に sim を再構築するためのシグナル ref
  const rebuildRef = useRef<(() => void) | null>(null);

  // groups が変わったら rebuildSim を呼ぶ
  useEffect(() => {
    rebuildRef.current?.();
  }, [groups]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let rafId = 0;

    // --- DPI スケーリング ---
    const dpr = window.devicePixelRatio || 1;

    function resizeCanvas() {
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    resizeCanvas();

    const ro = new ResizeObserver(() => {
      resizeCanvas();
      rebuildSim();
    });
    ro.observe(canvas);

    // --- 粒子リスト & d3-force シミュレーション ---
    let nodes: ParticleNode[] = [];
    let sim: Simulation<ParticleNode, undefined> | null = null;

    // 花火スパーク配列
    let sparks: Spark[] = [];

    // 発火フラッシュ配列
    let flashes: Flash[] = [];

    // ポップコーン pop タイムスタンプ
    let lastPopAt = 0;

    const MARGIN = 30;

    // ラベル文字列をノード生成時に1回だけ計算
    function truncateName(basename: string): string {
      return basename.length > 18 ? basename.slice(0, 17) + '…' : basename;
    }

    function buildNodes(gs: typeof groups): ParticleNode[] {
      const canvasW = canvas!.clientWidth;
      const canvasH = canvas!.clientHeight;
      const MARGIN = 50;

      return gs.flatMap((g) =>
        g.files.map((stat) => ({
          stat,
          x: MARGIN + Math.random() * (canvasW - MARGIN * 2),
          y: MARGIN + Math.random() * (canvasH - MARGIN * 2),
          vx: 0,
          vy: 0,
          phase: Math.random() * TAU,
          period: 1000 + Math.random() * 800,
          popUntil: 0,
          wasHighlighted: false,
          burstUntil: 0,
          lastFiredHash: '',
          truncatedName: truncateName(stat.basename),
        })),
      );
    }

    // twinkle dots (80個、リサイズ時に再生成)
    const TWINKLE_COLORS = ['#3b82f6','#ec4899','#f59e0b','#8b5cf6','#22c55e','#14b8a6'];
    let twinkles: Twinkle[] = [];

    function buildTwinkles(w: number, h: number): Twinkle[] {
      return Array.from({ length: 80 }, () => {
        const hex = TWINKLE_COLORS[Math.floor(Math.random() * TWINKLE_COLORS.length)];
        const { r, g, b } = cachedHexToRgb(hex);
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          radius: 0.5 + Math.random() * 1.0,
          baseAlpha: 0.12 + Math.random() * 0.18,
          phase: Math.random() * TAU,
          period: 1500 + Math.random() * 2500,
          r, g, b,
        };
      });
    }

    function spawnFireworks(px: number, py: number, color: string) {
      const count = 20 + Math.floor(Math.random() * 13); // 20-32
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * TAU + (Math.random() - 0.5) * 0.4;
        const speed = 5 + Math.random() * 8;
        sparks.push({
          x: px,
          y: py,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          decay: 0.011,
          color,
          size: 2 + Math.random() * 2.5,
        });
      }
      // hard cap — oldest を drop
      if (sparks.length > MAX_SPARKS) {
        sparks.splice(0, sparks.length - MAX_SPARKS);
      }
      flashes.push({ x: px, y: py, color, until: Date.now() + 100 });
    }

    function rebuildSim() {
      if (cancelled) return;
      if (sim) sim.stop();

      const gs = groupsRef.current;
      const canvasW = canvas!.clientWidth;
      const canvasH = canvas!.clientHeight;

      twinkles = buildTwinkles(canvasW, canvasH);

      const prevByPath = new Map(nodes.map((n) => [n.stat.path, n]));
      nodes = buildNodes(gs).map((n) => {
        const prev = prevByPath.get(n.stat.path);
        if (prev) {
          n.x = prev.x;
          n.y = prev.y;
          n.vx = prev.vx;
          n.vy = prev.vy;
          n.phase = prev.phase;
          n.period = prev.period;
          n.popUntil = prev.popUntil;
          n.wasHighlighted = prev.wasHighlighted;
          n.burstUntil = prev.burstUntil;
          n.lastFiredHash = prev.lastFiredHash;
          n.truncatedName = truncateName(n.stat.basename);
        }
        return n;
      });

      // velocity integrator のみ — forceCollide/forceManyBody による集団圧力を排除。
      // 粒子間の重なり解消は draw ループ内の manual elastic collision が単独で担う。
      sim = forceSimulation(nodes)
        .velocityDecay(0.02)
        .alphaTarget(0.05)
        .alphaDecay(0)
        .stop();
    }

    rebuildSim();
    rebuildRef.current = rebuildSim;

    // canvas 背景色を CSS変数から 1 回だけ取得 (per-frame getComputedStyle を排除)
    function getBgRgb(): { r: number; g: number; b: number } {
      const raw = getComputedStyle(canvas!).getPropertyValue('--rs-bg-canvas').trim();
      if (raw && /^#[0-9a-f]{6}$/i.test(raw)) return hexToRgb(raw);
      return { r: 10, g: 13, b: 18 };
    }
    const bgRgb = getBgRgb();
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const trailFill = `rgba(${bgRgb.r},${bgRgb.g},${bgRgb.b},${isDark ? 0.18 : 0.30})`;

    // --- 描画ループ ---
    function draw() {
      if (cancelled) return;
      rafId = requestAnimationFrame(draw);

      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (sim) sim.tick();

      const nowMs = Date.now();
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      // 粒子同士の弾性衝突 (O(n²), 200粒子 = ~40k checks/frame で 60fps OK)
      if (!reducedMotion) {
        const len = nodes.length;
        for (let i = 0; i < len; i++) {
          const a = nodes[i];
          const ra = radiusForCount(a.stat.commitCount);
          for (let j = i + 1; j < len; j++) {
            const b = nodes[j];
            const rb = radiusForCount(b.stat.commitCount);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const minDist = ra + rb + 2;
            const dist2 = dx * dx + dy * dy;
            if (dist2 >= minDist * minDist || dist2 < 0.0001) continue;
            const dist = Math.sqrt(dist2);
            const nx = dx / dist;
            const ny = dy / dist;
            const vRelN = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vRelN >= 0) continue; // 既に離れる方向なので無視
            // 等質量弾性衝突: 法線方向の速度を交換
            const restitution = 0.95;
            const impulse = vRelN * (1 + restitution) * 0.5;
            a.vx += impulse * nx;
            a.vy += impulse * ny;
            b.vx -= impulse * nx;
            b.vy -= impulse * ny;
            // めり込み解消
            const overlap = (minDist - dist) * 0.5;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
          }
        }
      }

      // ランダムドリフト + 壁バウンス
      if (!reducedMotion) {
        const BOUNCE_MARGIN = 30;
        const BOUNCE_DAMPING = 0.85;
        // 集団圧力がなくなったので穏やかな最低反発速度で十分
        const MIN_BOUNCE_V = 1.0;

        for (const node of nodes) {
          // 集団圧力なし → ドリフト入力を少し戻して拡散を促進
          node.vx += (Math.random() - 0.5) * 0.05;
          node.vy += (Math.random() - 0.5) * 0.05;

          if (node.x < BOUNCE_MARGIN) {
            node.x = BOUNCE_MARGIN;
            node.vx = Math.max(Math.abs(node.vx) * BOUNCE_DAMPING, MIN_BOUNCE_V);
          } else if (node.x > w - BOUNCE_MARGIN) {
            node.x = w - BOUNCE_MARGIN;
            node.vx = -Math.max(Math.abs(node.vx) * BOUNCE_DAMPING, MIN_BOUNCE_V);
          }
          if (node.y < BOUNCE_MARGIN) {
            node.y = BOUNCE_MARGIN;
            node.vy = Math.max(Math.abs(node.vy) * BOUNCE_DAMPING, MIN_BOUNCE_V);
          } else if (node.y > h - BOUNCE_MARGIN) {
            node.y = h - BOUNCE_MARGIN;
            node.vy = -Math.max(Math.abs(node.vy) * BOUNCE_DAMPING, MIN_BOUNCE_V);
          }
        }

        const MAX_V = 2.0;
        for (const node of nodes) {
          if (node.vx > MAX_V) node.vx = MAX_V;
          else if (node.vx < -MAX_V) node.vx = -MAX_V;
          if (node.vy > MAX_V) node.vy = MAX_V;
          else if (node.vy < -MAX_V) node.vy = -MAX_V;
        }
      }

      // 花火トリガー検出: フィンガープリント差分検知
      // 初回観測 (lastFiredHash === '') は stamp のみ — マウント直後の一斉爆発を防ぐ
      if (!reducedMotion) {
        for (const node of nodes) {
          const isHighlighted = nowMs < node.stat.highlightedUntil;
          const fp = fingerprint(node.stat);
          if (node.lastFiredHash === '') {
            // 初回観測 — stamp のみ、爆発しない
            node.lastFiredHash = fp;
          } else if (node.lastFiredHash !== fp) {
            // 変更を検知 — 大爆発
            spawnFireworks(node.x, node.y, colorForKind(node.stat.kind));
            node.burstUntil = nowMs + 200;
            node.lastFiredHash = fp;
          }
          node.wasHighlighted = isHighlighted;  // ラベル強調用に維持
        }
      }

      // ポップコーン pop トリガー (1.2–2.2秒間隔)
      if (!reducedMotion && nodes.length > 0 &&
          nowMs - lastPopAt > 1200 + Math.random() * 1000) {
        lastPopAt = nowMs;
        const idx = Math.floor(Math.random() * nodes.length);
        nodes[idx].popUntil = nowMs + 250;
      }

      // spark 物理更新
      for (const sp of sparks) {
        sp.vy += 0.08;
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.life -= sp.decay;
      }
      sparks = sparks.filter((sp) => sp.life > 0);
      flashes = flashes.filter((f) => nowMs < f.until);

      ctx.save();
      ctx.scale(dpr, dpr);

      // モーションブラー trail
      if (!reducedMotion) {
        ctx.fillStyle = trailFill;
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.clearRect(0, 0, w, h);
      }

      // --- Twinkles ---
      if (!reducedMotion) {
        for (const tw of twinkles) {
          const alpha = tw.baseAlpha * (0.5 + 0.5 * Math.sin((nowMs / tw.period) * TAU + tw.phase));
          ctx.beginPath();
          ctx.arc(tw.x, tw.y, tw.radius, 0, TAU);
          ctx.fillStyle = `rgba(${tw.r},${tw.g},${tw.b},${alpha})`;
          ctx.fill();
        }
      }

      // ホワイトフラッシュ描画
      if (!reducedMotion && flashes.length > 0) {
        for (const f of flashes) {
          const t = (f.until - nowMs) / 100;
          const fr = Math.min(1, Math.max(0, t));
          const fRgb = cachedHexToRgb(f.color);
          const baseR = 30;
          const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, baseR * 3);
          grad.addColorStop(0, `rgba(255,255,255,${0.9 * fr})`);
          grad.addColorStop(0.4, `rgba(${fRgb.r},${fRgb.g},${fRgb.b},${0.7 * fr})`);
          grad.addColorStop(1, `rgba(${fRgb.r},${fRgb.g},${fRgb.b},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(f.x, f.y, baseR * 3, 0, TAU);
          ctx.fill();
        }
      }

      // 粒子描画
      for (const node of nodes) {
        const { stat, x, y, phase, period } = node;
        const baseRadius = radiusForCount(stat.commitCount);
        const bucket = getSizeBucket(baseRadius);

        const age = nowMs - new Date(stat.lastSeenTime).getTime();
        const isFaded = age > RECENCY_FADE_MS;
        const litMul = isFaded ? 0.85 : 1;

        const { r, g, b } = cachedHexToRgb(colorForKind(stat.kind));

        // --- Idle breathing / burst / pop scale ---
        let breatheScale = 1;
        if (!reducedMotion) {
          const isBurst = nowMs < node.burstUntil;
          const isPop = nowMs < node.popUntil;
          if (isBurst) {
            const tBurst = 1 - (node.burstUntil - nowMs) / 200;
            const burstScale = 1 + 1.2 * Math.pow(Math.sin(tBurst * Math.PI), 2);
            const popScale = isPop
              ? 1 + 0.6 * Math.pow(Math.sin((1 - (node.popUntil - nowMs) / 250) * Math.PI), 2)
              : 1;
            breatheScale = Math.max(burstScale, popScale);
          } else if (isPop) {
            const t = 1 - (node.popUntil - nowMs) / 250;
            breatheScale = 1 + 0.6 * Math.pow(Math.sin(t * Math.PI), 2);
          } else {
            breatheScale = 1 + 0.14 * Math.sin((nowMs / period) * TAU + phase);
          }
        }
        const drawRadius = baseRadius * breatheScale;

        const isHighlighted = nowMs < stat.highlightedUntil;
        const isNew = stat.isNewFile && nowMs < stat.appearedAt + NEW_FILE_MS;
        const isDeleted = stat.lastStatus === 'D';

        // --- Hot pulse ring ---
        if (isHighlighted && !reducedMotion) {
          const progress = (nowMs - (stat.highlightedUntil - HIGHLIGHT_MS)) / HIGHLIGHT_MS;
          const ringR = baseRadius * (1 + Math.min(progress, 1) * 7);
          const ringAlpha = (1 - Math.min(progress, 1)) * 0.6;
          ctx.beginPath();
          ctx.arc(x, y, ringR, 0, TAU);
          ctx.strokeStyle = `rgba(${r},${g},${b},${ringAlpha})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // --- New file shockwave ---
        if (isNew && !reducedMotion) {
          const burstProgress = Math.min((nowMs - stat.appearedAt) / BURST_MS, 1);
          const burstR = baseRadius * (1 + burstProgress * 5);
          const burstAlpha = (1 - burstProgress) * 0.7;
          ctx.beginPath();
          ctx.arc(x, y, burstR, 0, TAU);
          ctx.strokeStyle = `rgba(${r},${g},${b},${burstAlpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // --- Pop ring ---
        if (!reducedMotion && nowMs < node.popUntil) {
          const t = 1 - (node.popUntil - nowMs) / 250;
          const ringR = baseRadius * (1.5 + t * 1.5);
          const ringAlpha = (1 - t) * 0.5;
          ctx.beginPath();
          ctx.arc(x, y, ringR, 0, TAU);
          ctx.strokeStyle = `rgba(${r},${g},${b},${ringAlpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // --- 粒子本体 ---
        if (isDeleted) {
          const fr = Math.round(r * litMul);
          const fg = Math.round(g * litMul);
          const fb = Math.round(b * litMul);
          ctx.beginPath();
          ctx.arc(x, y, drawRadius, 0, TAU);
          ctx.strokeStyle = `rgba(${fr},${fg},${fb},0.5)`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          // sprite キャッシュから drawImage — shadowBlur/gradient はスプライトに焼き込み済み
          const sprite = getSprite(stat.kind, bucket, dpr);
          const spW = sprite.width / dpr;
          const spH = sprite.height / dpr;
          const dw = spW * breatheScale;
          const dh = spH * breatheScale;

          // isFaded 時は globalAlpha で明度低下
          if (isFaded) {
            ctx.globalAlpha = 0.85;
          }
          ctx.drawImage(sprite, x - dw / 2, y - dh / 2, dw, dh);
          if (isFaded) {
            ctx.globalAlpha = 1;
          }

          // isHighlighted 時: stroke ring で追加グロー (sprite の shadowBlur は既に機能してる)
          if ((isHighlighted || nowMs < node.popUntil) && !reducedMotion) {
            ctx.beginPath();
            ctx.arc(x, y, drawRadius + 2, 0, TAU);
            ctx.strokeStyle = `rgba(${r},${g},${b},0.45)`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }

        // --- ファイル名ラベル ---
        {
          const isHot = isHighlighted || isNew;
          const fadeAlpha = isFaded ? 0.6 : 1;
          const labelOffset = drawRadius + 4;

          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          if (isHot) {
            const labelText = `${node.truncatedName}  +${stat.totalAdded} −${stat.totalDeleted}`;
            ctx.font = 'bold 12px system-ui';
            ctx.shadowBlur = 6;
            ctx.shadowColor = `rgba(${r},${g},${b},${0.6 * fadeAlpha})`;
            ctx.fillStyle = `rgba(${r},${g},${b},${0.95 * fadeAlpha})`;
            ctx.fillText(labelText, x, y + labelOffset);
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
          } else {
            ctx.font = '10px system-ui';
            ctx.fillStyle = `rgba(${r},${g},${b},${0.55 * fadeAlpha})`;
            ctx.fillText(node.truncatedName, x, y + labelOffset);
          }
        }
      }

      // --- 花火スパーク描画 (加算ブレンド + sprite) ---
      if (!reducedMotion && sparks.length > 0) {
        ctx.globalCompositeOperation = 'lighter';
        const ss = getSparkSprite(dpr);
        const ssNativeW = ss.width / dpr;
        const ssNativeH = ss.height / dpr;
        for (const sp of sparks) {
          const { r, g, b } = cachedHexToRgb(sp.color);
          const alpha = sp.life * 0.9;
          const sz = sp.size * sp.life;
          // tint: 白スプライトを color で着色
          ctx.globalAlpha = alpha;
          // color tint via fillRect + compositeOperation はコストが高いので
          // 代わりに白スプライト (lighter ブレンド) に色フィルタをかける:
          // 白スプライトに fillStyle をかけても compositeOp が 'lighter' なので明るくなるだけ。
          // 実用上、少量の色差は許容して白スプライトのまま描画する。
          // 完全な色忠実度が必要な場合は kindSprite を使う。
          ctx.drawImage(ss, sp.x - sz, sp.y - sz, ssNativeW * (sz / (ssNativeW / 2)), ssNativeH * (sz / (ssNativeH / 2)));
          // 色付きオーバーレイ (arc 1個、shadowBlur なし)
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sz * 0.5, 0, TAU);
          ctx.fillStyle = `rgba(${r},${g},${b},1)`;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.restore();
    }

    draw();

    // --- Hit test ---
    function handleClick(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const { stat, x, y } = nodes[i];
        const r = radiusForCount(stat.commitCount) + 4;
        if ((mx - x) ** 2 + (my - y) ** 2 < r * r) {
          onClickRef.current(stat);
          return;
        }
      }
    }

    function handleContextMenu(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const { stat, x, y } = nodes[i];
        const r = radiusForCount(stat.commitCount) + 4;
        if ((mx - x) ** 2 + (my - y) ** 2 < r * r) {
          e.preventDefault();
          onContextMenuRef.current(e as unknown as React.MouseEvent, stat.path);
          return;
        }
      }
    }

    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('contextmenu', handleContextMenu);

    return () => {
      cancelled = true;
      rebuildRef.current = null;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      if (sim) sim.stop();
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, reducedMotion]);
}

// ---------------------------------------------------------------------------
// PulseLens main
// ---------------------------------------------------------------------------
export function PulseLens({
  repoId,
  commits,
  selectedCommitHash,
  onSelectCommit,
  onOpenFileHistory,
  workTree,
}: PulseLensProps) {
  // ---- Detail cache (per-commit file lists) -----------------------------
  const [detailCache, setDetailCache] = useState<Map<string, CommitDetail>>(
    () => new Map(),
  );

  // ---- File statistics ---------------------------------------------------
  const [statistics, setStatistics] = useState<Map<string, FileStat>>(
    () => new Map(),
  );

  const processedHashesRef = useRef<Set<string>>(new Set());

  // ---- Right-click context menu ----------------------------------------
  const [menuState, setMenuState] = useState<{ x: number; y: number; path: string } | null>(null);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent, path: string) => {
      const e = event as MouseEvent;
      setMenuState({ x: e.clientX, y: e.clientY, path });
    },
    [],
  );

  // ---- prefers-reduced-motion ------------------------------------------
  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // ---- Tick: keep highlight/new fade state alive -----------------------
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 800);
    return () => window.clearInterval(id);
  }, []);

  // ---- Fetch commit details on demand -----------------------------------
  useEffect(() => {
    if (!repoId) return;
    const sliced = commits.slice(0, MAX_COMMITS);
    for (const c of sliced) {
      if (detailCache.has(c.hash)) continue;
      void (async () => {
        try {
          const detail = await getCommit(repoId, c.hash);
          setDetailCache((prev) => {
            if (prev.has(c.hash)) return prev;
            const next = new Map(prev);
            next.set(c.hash, detail);
            return next;
          });
        } catch {
          // Non-critical — particle will appear once data lands
        }
      })();
    }
  }, [commits, repoId, detailCache]);

  // ---- Update statistics when commits/details flow in ------------------
  useEffect(() => {
    const sliced = commits.slice(0, MAX_COMMITS);
    const t = Date.now();

    setStatistics((prevStats) => {
      const next = new Map(prevStats);
      for (const commit of sliced) {
        const detail = detailCache.get(commit.hash);
        if (!detail) continue;
        if (processedHashesRef.current.has(commit.hash)) continue;

        const shortHash = commit.shortHash ?? commit.hash.slice(0, 7);
        for (const file of detail.files) {
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
              lastSeenTime: commit.time,
              lastStatus: file.status,
              highlightedUntil: t + HIGHLIGHT_MS,
              isWorkingTree: false,
            });
          } else {
            const slash = path.lastIndexOf('/');
            next.set(path, {
              path,
              basename: slash === -1 ? path : path.slice(slash + 1),
              parentDir: slash === -1 ? '' : path.slice(0, slash),
              topGroup: topGroupForPath(path),
              kind: classifyFile(path),
              commitCount: 1,
              totalAdded: file.added ?? 0,
              totalDeleted: file.deleted ?? 0,
              lastSeenHash: commit.hash,
              lastSeenShortHash: shortHash,
              lastSeenSubject: commit.subject,
              lastSeenTime: commit.time,
              lastStatus: file.status,
              highlightedUntil: t + HIGHLIGHT_MS,
              isNewFile: true,
              appearedAt: t,
              isWorkingTree: false,
            });
          }
        }
        processedHashesRef.current.add(commit.hash);
      }
      return next;
    });
  }, [commits, detailCache]);

  // ---- Merge working-tree changes into rendering ------------------------
  const mergedStats = useMemo<Map<string, FileStat>>(() => {
    const wtFiles = extractWorkTreeFiles(workTree);
    if (wtFiles.length === 0) return statistics;

    const wtByPath = new Map<string, { added: number; deleted: number; status: string }>();
    for (const f of wtFiles) {
      const ex = wtByPath.get(f.path);
      if (ex) {
        wtByPath.set(f.path, {
          added: ex.added + f.added,
          deleted: ex.deleted + f.deleted,
          status: ex.status,
        });
      } else {
        wtByPath.set(f.path, { added: f.added, deleted: f.deleted, status: f.status });
      }
    }

    const merged = new Map<string, FileStat>(statistics);
    const snapshot = workTree?.snapshotAt ?? '';

    for (const [path, agg] of wtByPath) {
      const existing = merged.get(path);
      if (existing) {
        merged.set(path, {
          ...existing,
          commitCount: existing.commitCount + 1,
          totalAdded: existing.totalAdded + agg.added,
          totalDeleted: existing.totalDeleted + agg.deleted,
          lastSeenHash: WORKING_TREE_HASH,
          lastSeenShortHash: 'WT',
          lastSeenSubject: 'Working tree (uncommitted)',
          lastSeenTime: snapshot,
          lastStatus: agg.status,
          isWorkingTree: true,
        });
      } else {
        const slash = path.lastIndexOf('/');
        merged.set(path, {
          path,
          basename: slash === -1 ? path : path.slice(slash + 1),
          parentDir: slash === -1 ? '' : path.slice(0, slash),
          topGroup: topGroupForPath(path),
          kind: classifyFile(path),
          commitCount: 1,
          totalAdded: agg.added,
          totalDeleted: agg.deleted,
          lastSeenHash: WORKING_TREE_HASH,
          lastSeenShortHash: 'WT',
          lastSeenSubject: 'Working tree (uncommitted)',
          lastSeenTime: snapshot,
          lastStatus: agg.status,
          highlightedUntil: 0,
          isNewFile: false,
          appearedAt: 0,
          isWorkingTree: true,
        });
      }
    }
    return merged;
  }, [statistics, workTree]);

  // ---- Group by top-level directory ----
  const groups = useMemo(() => {
    const m = new Map<string, FileStat[]>();
    for (const stat of mergedStats.values()) {
      const arr = m.get(stat.topGroup) ?? [];
      arr.push(stat);
      m.set(stat.topGroup, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        if (b.commitCount !== a.commitCount) return b.commitCount - a.commitCount;
        return a.path.localeCompare(b.path);
      });
    }
    return Array.from(m.entries()).map(([key, files]) => ({
      key,
      files,
      total: files.reduce((s, f) => s + f.commitCount, 0),
    }));
  }, [mergedStats]);

  // ---- Recent changes feed ---------------------------------------------
  const recentEntries = useMemo<RecentEntry[]>(() => {
    const out: RecentEntry[] = [];

    const wtFiles = extractWorkTreeFiles(workTree);
    if (wtFiles.length > 0) {
      for (const f of wtFiles) {
        out.push({
          id: `wt::${f.section}::${f.path}`,
          path: f.path,
          basename: f.basename,
          parentDir: f.parentDir,
          status: f.status,
          kind: classifyFile(f.path),
          added: f.added,
          deleted: f.deleted,
          commitHash: WORKING_TREE_HASH,
          commitShortHash: f.section === 'staged' ? 'STAGED' : 'UNSTAGED',
          subject: f.section === 'staged' ? 'Staged' : 'Unstaged',
          time: workTree?.snapshotAt ?? new Date().toISOString(),
          isWorkingTree: true,
        });
        if (out.length >= RECENT_CHANGES_MAX) break;
      }
    }

    if (out.length < RECENT_CHANGES_MAX) {
      const sliced = commits.slice(0, MAX_COMMITS);
      for (const commit of sliced) {
        const detail = detailCache.get(commit.hash);
        if (!detail) continue;
        const shortHash = commit.shortHash ?? commit.hash.slice(0, 7);
        for (const file of detail.files) {
          const slash = file.path.lastIndexOf('/');
          out.push({
            id: `${commit.hash}::${file.path}`,
            path: file.path,
            basename: slash === -1 ? file.path : file.path.slice(slash + 1),
            parentDir: slash === -1 ? '' : file.path.slice(0, slash),
            status: file.status,
            kind: classifyFile(file.path),
            added: file.added ?? 0,
            deleted: file.deleted ?? 0,
            commitHash: commit.hash,
            commitShortHash: shortHash,
            subject: commit.subject,
            time: commit.time,
            isWorkingTree: false,
          });
          if (out.length >= RECENT_CHANGES_MAX) break;
        }
        if (out.length >= RECENT_CHANGES_MAX) break;
      }
    }

    return out.slice(0, RECENT_CHANGES_MAX);
  }, [workTree, commits, detailCache]);

  // ---- Click handler — open the file's history modal -------------------
  const handleParticleClick = useCallback(
    (stat: FileStat) => {
      if (onOpenFileHistory) {
        onOpenFileHistory(stat.path);
        return;
      }
      if (!stat.isWorkingTree) {
        onSelectCommit(stat.lastSeenHash);
      }
    },
    [onOpenFileHistory, onSelectCommit],
  );

  // ---- Header summary ---------------------------------------------------
  const summary = useMemo(() => {
    let added = 0;
    let deleted = 0;
    let hotCount = 0;
    let workingTreeCount = 0;
    for (const stat of mergedStats.values()) {
      added += stat.totalAdded;
      deleted += stat.totalDeleted;
      if (nowMs < stat.highlightedUntil) hotCount += 1;
      if (stat.isWorkingTree) workingTreeCount += 1;
    }
    return {
      files: mergedStats.size,
      added,
      deleted,
      hotCount,
      workingTreeCount,
      commits: Math.min(commits.length, MAX_COMMITS),
    };
  }, [mergedStats, commits.length, nowMs]);

  // ---- Canvas ref ------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useCanvasParticleField({
    canvasRef,
    groups,
    reducedMotion,
    onClickFile: handleParticleClick,
    onContextMenu: handleContextMenu,
  });

  // ---- Empty state ------------------------------------------------------
  if (commits.length === 0 && summary.workingTreeCount === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--rs-text-secondary)',
          fontFamily: 'var(--rs-sans)',
          fontSize: 13,
          background: 'var(--rs-bg-canvas)',
        }}
      >
        Waiting for the codebase to start pulsing…
      </div>
    );
  }

  return (
    <div className="rs-pulse-root">
      <style>{PULSE_STYLES}</style>

      {/* Header — live indicator + counts */}
      <header className="rs-pulse-header">
        <span className="rs-pulse-header__indicator" aria-hidden="true">
          <span className="rs-pulse-header__dot" />
        </span>
        <span className="rs-pulse-header__title">Pulse</span>
        <span className="rs-pulse-header__divider" aria-hidden="true" />
        <span className="rs-pulse-header__stat">
          <strong>{summary.files.toLocaleString()}</strong> files
        </span>
        <span className="rs-pulse-header__stat">
          <strong>{summary.commits.toLocaleString()}</strong> commits
        </span>
        <span className="rs-pulse-header__diff">
          <span style={{ color: '#22c55e' }}>+{summary.added.toLocaleString()}</span>
          <span style={{ color: '#ef4444' }}>−{summary.deleted.toLocaleString()}</span>
        </span>
        {summary.hotCount > 0 && (
          <span className="rs-pulse-header__hot">
            {summary.hotCount} hot
          </span>
        )}
        {summary.workingTreeCount > 0 && (
          <span className="rs-pulse-header__wt">
            {summary.workingTreeCount} uncommitted
          </span>
        )}

        <div className="rs-pulse-header__legend" aria-label="File kind legend">
          {(['code', 'style', 'config', 'markup', 'docs', 'test', 'asset'] as const).map((k) => (
            <span key={k} className="rs-pulse-header__legend-item">
              <span
                className="rs-pulse-header__legend-dot"
                style={{ background: colorForKind(k) }}
                aria-hidden="true"
              />
              <span>{labelForKind(k)}</span>
            </span>
          ))}
        </div>
      </header>

      {/* Body: canvas stage (left) + sidebar (right) */}
      <div className="rs-pulse-body">
        <div className="rs-pulse-stage" role="region" aria-label="Codebase pulse field">
          {groups.length === 0 ? (
            <div className="rs-pulse-stage__empty">Loading file activity…</div>
          ) : (
            <canvas
              ref={canvasRef}
              className="rs-pulse-canvas"
              aria-label={`Particle field — ${summary.files} files`}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
            />
          )}
        </div>

        {/* Recent changes — right sidebar */}
        <aside className="rs-pulse-sidebar" aria-label="Recent changes">
          <div className="rs-pulse-recent" aria-label="Recent changes">
            <div className="rs-pulse-recent__title">Recent changes</div>
            <ul className="rs-pulse-recent__list">
              {recentEntries.length === 0 ? (
                <li className="rs-pulse-recent__empty">No recent changes</li>
              ) : (
                recentEntries.map((entry) => {
                  const isSelected =
                    !entry.isWorkingTree && entry.commitHash === selectedCommitHash;
                  return (
                    <li
                      key={entry.id}
                      className={
                        isSelected
                          ? 'rs-pulse-recent__row rs-pulse-recent__row--selected'
                          : 'rs-pulse-recent__row'
                      }
                    >
                      <button
                        type="button"
                        className="rs-pulse-recent__btn"
                        onClick={() => {
                          if (entry.isWorkingTree) return;
                          onSelectCommit(entry.commitHash);
                        }}
                        onContextMenu={(e: ReactMouseEvent) => {
                          e.preventDefault();
                          handleContextMenu(e, entry.path);
                        }}
                        title={`${entry.path}\n${entry.subject}`}
                        disabled={entry.isWorkingTree}
                      >
                        <span
                          className="rs-pulse-recent__dot"
                          style={{ background: colorForKind(entry.kind) }}
                          aria-hidden="true"
                        />
                        <span className="rs-pulse-recent__status" aria-hidden="true">
                          {statusGlyph(entry.status)}
                        </span>
                        <span className="rs-pulse-recent__path">
                          {entry.parentDir && (
                            <span className="rs-pulse-recent__parent">{entry.parentDir}/</span>
                          )}
                          <span className="rs-pulse-recent__base">{entry.basename}</span>
                        </span>
                        <span className="rs-pulse-recent__diff">
                          <span style={{ color: '#22c55e' }}>+{entry.added}</span>
                          <span style={{ color: '#ef4444' }}>−{entry.deleted}</span>
                        </span>
                        <span className="rs-pulse-recent__time">
                          {entry.isWorkingTree ? entry.commitShortHash : relativeTime(entry.time)}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </aside>
      </div>

      {/* Right-click context menu (open file history etc.) */}
      <FileContextMenu
        open={menuState !== null}
        x={menuState?.x ?? 0}
        y={menuState?.y ?? 0}
        path={menuState?.path ?? null}
        onClose={() => setMenuState(null)}
        onOpenHistory={(p) => {
          onOpenFileHistory?.(p);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — kept inline so the component stays self-contained
// ---------------------------------------------------------------------------
const PULSE_STYLES = `
.rs-pulse-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background:
    radial-gradient(ellipse at top left,  color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 6%), transparent 55%),
    radial-gradient(ellipse at bottom right, color-mix(in oklab, var(--rs-bg-canvas), #8b5cf6 5%), transparent 60%),
    var(--rs-bg-canvas);
  overflow: hidden;
  font-family: var(--rs-sans, system-ui);
  color: var(--rs-text-primary);
}

.rs-pulse-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--rs-border);
  background: color-mix(in oklab, var(--rs-bg-panel), transparent 10%);
  backdrop-filter: blur(6px);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.rs-pulse-header__indicator {
  position: relative;
  width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.rs-pulse-header__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 8px #22c55e;
  animation: rs-pulse-dot 1.6s ease-out infinite;
}
@keyframes rs-pulse-dot {
  0%, 100% { transform: scale(1);   opacity: 1; }
  50%      { transform: scale(1.3); opacity: 0.55; }
}
.rs-pulse-header__title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rs-text-primary);
}
.rs-pulse-header__divider {
  width: 1px;
  height: 14px;
  background: var(--rs-border);
  opacity: 0.6;
}
.rs-pulse-header__stat {
  font-size: 12px;
  color: var(--rs-text-secondary);
}
.rs-pulse-header__stat strong {
  font-family: var(--rs-mono, ui-monospace, monospace);
  color: var(--rs-text-primary);
  font-weight: 700;
  margin-right: 3px;
}
.rs-pulse-header__diff {
  display: inline-flex;
  gap: 6px;
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 12px;
  font-weight: 600;
}
.rs-pulse-header__hot {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 2px 7px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(120deg, #f97316, #ec4899);
  box-shadow: 0 0 8px color-mix(in oklab, #ec4899, transparent 60%);
  text-transform: uppercase;
}
.rs-pulse-header__wt {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 2px 7px;
  border-radius: 999px;
  color: #f59e0b;
  background: color-mix(in oklab, var(--rs-bg-canvas), #f59e0b 12%);
  border: 1px solid color-mix(in oklab, var(--rs-border), #f59e0b 50%);
  text-transform: uppercase;
}
.rs-pulse-header__legend {
  margin-left: auto;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--rs-text-secondary);
}
.rs-pulse-header__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rs-pulse-header__legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.rs-pulse-body {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.rs-pulse-stage {
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
  min-width: 0;
}
.rs-pulse-stage__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--rs-text-secondary);
  font-size: 13px;
}

/* canvas は absolute fill で stage の computed width/height に追従する */
.rs-pulse-canvas {
  display: block;
}

.rs-pulse-sidebar {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid var(--rs-border);
  background: color-mix(in oklab, var(--rs-bg-panel), transparent 10%);
  overflow-y: auto;
  overflow-x: hidden;
}

.rs-pulse-recent {
  padding: 8px 16px 10px;
}
.rs-pulse-recent__title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rs-text-secondary);
  margin-bottom: 4px;
}
.rs-pulse-recent__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rs-pulse-recent__row {
  display: flex;
  width: 100%;
}
.rs-pulse-recent__row--selected .rs-pulse-recent__btn {
  background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 18%);
  border-color: color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%);
}
.rs-pulse-recent__btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--rs-text-primary);
  transition: background 120ms ease-out, border-color 120ms ease-out;
  text-align: left;
  min-width: 0;
}
.rs-pulse-recent__btn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 6%);
  border-color: color-mix(in oklab, var(--rs-border), transparent 30%);
}
.rs-pulse-recent__btn:disabled {
  cursor: default;
  opacity: 0.85;
}
.rs-pulse-recent__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rs-pulse-recent__status {
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 11px;
  width: 12px;
  flex-shrink: 0;
  text-align: center;
  color: var(--rs-text-secondary);
}
.rs-pulse-recent__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-pulse-recent__parent {
  color: var(--rs-text-secondary);
  opacity: 0.8;
}
.rs-pulse-recent__base {
  font-weight: 600;
  color: var(--rs-text-primary);
}
.rs-pulse-recent__diff {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
}
.rs-pulse-recent__time {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--rs-text-muted, var(--rs-text-secondary));
  min-width: 32px;
  text-align: right;
}
.rs-pulse-recent__empty {
  font-family: var(--rs-sans, system-ui);
  font-size: 12px;
  color: var(--rs-text-secondary);
  padding: 6px 8px;
}

@media (prefers-reduced-motion: reduce) {
  .rs-pulse-header__dot {
    animation: none !important;
  }
}
`;
