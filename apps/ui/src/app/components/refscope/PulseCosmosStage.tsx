/**
 * PulseCosmosStage — Fleet Cosmos 風 3D メッセージウィンドウ宇宙。
 *
 * PulseLens から React.lazy でダイナミックロードされるため、
 * このファイルは R3F / drei / postprocessing の全インポートを保持する。
 * PulseLens 本体は detailCache / statistics / UI shell のみ担当。
 * 型定義と buildCosmos 純関数は cosmosUtils.ts に切り出している。
 *
 * ─ MessageWindow : Three.js Billboard カード（入場アニメ・ホバー・選択）
 * ─ SceneContents : シーン全体のマネジャー
 */

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  Suspense,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Billboard,
  Text,
  OrbitControls,
  Sparkles,
} from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { colorForKind } from '../../lib/fileKind';
import type { SpacePoint } from './cosmosUtils';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------
// SCALE: カード全体（geometry / fontSize / 内部 offset）を一括スケール。
// 1.0 = Builder 初版 (4.8×3.0)。視認性は SCALE 1 つで調整できる。
const SCALE = 0.3;
const CARD_W = 4.8 * SCALE;
const CARD_H = 3.0 * SCALE;
const HEADER_H = 0.64 * SCALE;
const MAX_CHARS = 180;

// ---------------------------------------------------------------------------
// COSMOS_THEME — refscope の RefScopeTokens (App.tsx) を three.js 用に hex 化。
//   CSS 変数 (--rs-*) は three.js のマテリアルでは読めないため、カラーは
//   ここで一箇所に集約し、デザイントークンを変更したら本テーブルも更新する。
//   オーバーレイ UI (HTML/CSS 側) は var(--rs-*) を直接参照する。
// ---------------------------------------------------------------------------
const COSMOS_THEME = {
  // 背景・サーフェス
  bgCanvas: '#10141c', //  --rs-bg-canvas oklch(16% .015 255)
  bgPanel: '#161c26', //   --rs-bg-panel  oklch(20%)
  bgElevated: '#1d2532', // --rs-bg-elevated oklch(24%)
  border: '#2c3548', //    --rs-border    oklch(34%)
  borderSoft: '#3a4763', // border をやや明るく（カード境界用）

  // 文字
  textPrimary: '#e6eaf2', //  --rs-text-primary
  textSecondary: '#a4adbc', // --rs-text-secondary
  textMuted: '#858ea1', //    --rs-text-muted

  // アクセント・状態色
  accent: '#5aa9e6', //       --rs-accent (青)
  gitAdded: '#5ec98f', //     --rs-git-added (緑)
  gitDeleted: '#e07f74', //   --rs-git-deleted (赤朱)
  gitModified: '#d6b366', //  --rs-git-modified
  warning: '#d6a050', //      --rs-warning

  // Cosmos 専用 — selected / fresh の強調色は accent と warning から派生
  freshHighlight: '#d6a050', // = warning。fresh ボーダー & NEW バッジ
  selectedHighlight: '#5aa9e6', // = accent。選択ボーダー
} as const;

// 内部レイアウト用のオフセット / フォントサイズも SCALE 適用済み定数で管理する。
// 個々の <Text> や position で算術リテラルを散らさないようにし、
// SCALE 1 行変更だけで全寸法が追従するようにする。
const PAD_X = 0.3 * SCALE;
const PAD_X_RIGHT = 0.18 * SCALE;
const ACCENT_W = 0.16 * SCALE;
const ACCENT_OFFSET = 0.08 * SCALE;
const ROW_GAP_TOP = 0.24 * SCALE;
const ROW_GAP_SUBJECT = 0.56 * SCALE;
const ROW_GAP_ADDED = 0.22 * SCALE;
const ROW_GAP_DELETED = 0.44 * SCALE;
const ROW_GAP_META_BOTTOM = 0.28 * SCALE;
const MAXW_REDUCE_BODY = 0.4 * SCALE;
const MAXW_REDUCE_SUBJECT = 0.6 * SCALE;

// FONT_SCALE: SCALE とは独立してフォントだけ補正する係数。
// カードを SCALE で小さくしたまま、可読性のためフォントだけ拡大したい場合に使う。
const FONT_SCALE = 1.6;
const FONT_BASENAME = 0.21 * SCALE * FONT_SCALE;
const FONT_SUBJECT = 0.155 * SCALE * FONT_SCALE;
const FONT_DIFF = 0.16 * SCALE * FONT_SCALE;
const FONT_META = 0.13 * SCALE * FONT_SCALE;
const FONT_HEADER = 0.17 * SCALE * FONT_SCALE;
const FONT_PARENT = 0.12 * SCALE * FONT_SCALE;

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function hslToHex(h: number, s: number, l: number): string {
  const hNorm = h / 360;
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + hNorm * 12) % 12;
    const color = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------------------------------------------------------------------------
// FreshEffects — 「更新があった」を可読化する演出
//   FreshHalo: fresh の間、hue 色のソフトな後光（Bloom と相乗で光る）
//   ※ 入場ショックウェーブ・パルスリングは「円が主張しすぎる」として撤去。
//     復活したい場合は git history (PulseRing / EntryShockwave) を参照。
// ---------------------------------------------------------------------------

function FreshHalo({ hue, opacity }: { hue: number; opacity: number }) {
  // refscope の暗背景に合わせ、彩度・明度を抑えてヌケ感のあるハローに。
  // 群識別の hue は維持しつつ saturation を 80→55、lightness を 60→52 へ。
  // サイズはカードの 1.4 倍まで。これ以上広げると Bloom と相乗で主張過多になる。
  const haloColor = hslToHex(hue, 55, 52);
  return (
    <mesh position={[0, 0, -0.005]} renderOrder={-1}>
      <planeGeometry args={[CARD_W * 1.05, CARD_H * 1.05]} />
      <meshBasicMaterial
        color={haloColor}
        transparent
        opacity={opacity * 0.16}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function relativeTimeFromTs(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ---------------------------------------------------------------------------
// MessageWindow — 1 カード = 1 SpacePoint
// ---------------------------------------------------------------------------
type MessageWindowProps = {
  point: SpacePoint;
  isSelected: boolean;
  reducedMotion: boolean;
  onPick: (point: SpacePoint) => void;
  onContextMenu: (event: ThreeEvent<MouseEvent>, key: string) => void;
};

function MessageWindow({
  point,
  isSelected,
  reducedMotion,
  onPick,
  onContextMenu,
}: MessageWindowProps) {
  const groupRef = useRef<THREE.Group>(null);
  const basePos = useRef<[number, number, number]>(point.position);
  const [hovered, setHovered] = useState(false);

  // 入場アニメ state: 0→1
  const entryStart = useRef(Date.now());
  const [entryScale, setEntryScale] = useState(0);
  const flashOpacityRef = useRef(1);

  // ターゲットスケール
  const targetScale = point.isFresh ? 1.5 : isSelected ? 1.1 : 1.0;
  const finalScale = hovered ? Math.max(targetScale, 1.55) : targetScale;

  // useFrame: 入場アニメ + 揺れ
  useFrame(({ clock }) => {
    if (!groupRef.current) return;

    const elapsed = Date.now() - entryStart.current;

    // 入場アニメ: 760ms で 0 → 2.0 → 0.85 → finalScale (2 段バウンス)
    // オーバーシュート → 縮み → 戻り の流れで「飛び込んできた」印象を作る。
    const ENTRY_MS = 760;
    if (elapsed < ENTRY_MS) {
      const t = elapsed / ENTRY_MS;
      let sc: number;
      if (t < 0.32) {
        // 立ち上がり: 0 → 2.0 (大きく膨らむ)
        sc = lerp(0, 2.0, t / 0.32);
      } else if (t < 0.6) {
        // 縮み: 2.0 → 0.85 (アンダーシュート)
        sc = lerp(2.0, 0.85, (t - 0.32) / 0.28);
      } else {
        // 着地: 0.85 → finalScale
        sc = lerp(0.85, finalScale, (t - 0.6) / 0.4);
      }
      setEntryScale(sc);
    } else {
      setEntryScale(finalScale);
    }

    // フラッシュ: 1100ms でフェードアウト
    if (elapsed < 1100) {
      flashOpacityRef.current = Math.max(0, 1 - elapsed / 1100);
    } else {
      flashOpacityRef.current = 0;
    }

    // Z 軸 swoop: 入場直後 820ms は手前 (+5) から定位置へ着地。
    // 視界の端にあるカードでも遠近の動きで気付けるよう reducedMotion でも有効。
    const SWOOP_MS = 820;
    let zPop = 0;
    if (elapsed < SWOOP_MS) {
      const t = elapsed / SWOOP_MS;
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      zPop = lerp(5, 0, eased);
    }

    // 通常の揺れ + Z swoop を合算して position に書き出す。
    if (!reducedMotion) {
      const t = clock.elapsedTime;
      const seedX = basePos.current[1] * 0.17;
      const seedY = basePos.current[0] * 0.13;
      const seedZ = basePos.current[2] * 0.11;
      groupRef.current.position.x =
        basePos.current[0] + Math.sin(t * 0.27 + seedX) * 0.45;
      groupRef.current.position.y =
        basePos.current[1] + Math.cos(t * 0.31 + seedY) * 0.5;
      groupRef.current.position.z =
        basePos.current[2] + zPop + Math.sin(t * 0.19 + seedZ) * 0.4;
    } else if (zPop > 0) {
      // reducedMotion 中も着地中だけは swoop を反映 (それ以外は静止)。
      groupRef.current.position.set(
        basePos.current[0],
        basePos.current[1],
        basePos.current[2] + zPop,
      );
    }
  });

  // カードの色設定 — refscope の暗テーマ向けにヘッダ彩度を抑える。
  const hue = point.hue;
  const sat = point.isFresh ? 60 : 38;
  const headerColorHex = hslToHex(hue, sat, 42);
  const borderColorHex = isSelected
    ? COSMOS_THEME.selectedHighlight
    : point.isFresh
      ? COSMOS_THEME.freshHighlight
      : COSMOS_THEME.borderSoft;

  const borderOpacity = isSelected
    ? point.opacity * 0.95
    : point.isFresh
      ? point.opacity * 0.9
      : point.opacity * 0.6;

  // アクセント帯 (kind 由来)
  const kindColor = colorForKind(point.meta.kind);

  // renderOrder
  const ro = hovered
    ? Number.MAX_SAFE_INTEGER
    : point.isFresh
      ? Math.floor(point.ts / 1000)
      : 0;

  // フラッシュ強度: reducedMotion でも控えめに 1 度だけ点ける (情報伝達優先)。
  const flashAlpha = reducedMotion
    ? flashOpacityRef.current * point.opacity * 0.35
    : flashOpacityRef.current * point.opacity * 1.0;

  return (
    <group ref={groupRef} position={point.position}>
      <Billboard follow>
        <group scale={entryScale}>
          {/* fresh halo（後光、Bloom と相乗で光る） */}
          {point.isFresh && (
            <FreshHalo hue={point.hue} opacity={point.opacity} />
          )}
          {/* 白地本体 */}
          <mesh
            renderOrder={ro}
            onClick={(e) => {
              e.stopPropagation();
              onPick(point);
            }}
            onContextMenu={(e) => {
              e.stopPropagation();
              onContextMenu(e, point.key);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHovered(true);
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              setHovered(false);
              document.body.style.cursor = 'default';
            }}
          >
            <planeGeometry args={[CARD_W, CARD_H]} />
            <meshBasicMaterial
              color={COSMOS_THEME.bgElevated}
              transparent
              opacity={point.opacity * 0.92}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>

          {/* ヘッダ strip (上端) */}
          <mesh
            position={[0, (CARD_H - HEADER_H) / 2, 0.001]}
            renderOrder={ro + 1}
          >
            <planeGeometry args={[CARD_W, HEADER_H]} />
            <meshBasicMaterial
              color={headerColorHex}
              transparent
              opacity={point.opacity * 0.88}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>

          {/* kind アクセント細帯 (左端) */}
          <mesh
            position={[-(CARD_W / 2) + ACCENT_OFFSET, 0, 0.002]}
            renderOrder={ro + 1}
          >
            <planeGeometry args={[ACCENT_W, CARD_H]} />
            <meshBasicMaterial
              color={kindColor}
              transparent
              opacity={point.opacity * 0.75}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>

          {/* 外枠 (lineSegments) */}
          <lineSegments renderOrder={ro + 2}>
            <edgesGeometry
              args={[new THREE.PlaneGeometry(CARD_W, CARD_H)]}
            />
            <lineBasicMaterial
              color={borderColorHex}
              transparent
              opacity={borderOpacity}
              depthWrite={false}
              toneMapped={false}
            />
          </lineSegments>

          {/* basename テキスト (本文エリア) — 暗テーマ向け text-primary、軽いアウトライン */}
          <Text
            position={[-(CARD_W / 2) + PAD_X, (CARD_H / 2) - HEADER_H - ROW_GAP_TOP, 0.003]}
            fontSize={FONT_BASENAME}
            color={COSMOS_THEME.textPrimary}
            fontWeight="bold"
            outlineWidth={0.002}
            outlineColor={COSMOS_THEME.bgCanvas}
            anchorX="left"
            anchorY="top"
            maxWidth={CARD_W - MAXW_REDUCE_BODY}
            renderOrder={ro + 3}
            toneMapped={false}
          >
            {point.basename}
          </Text>

          {/* subject テキスト — text-secondary */}
          <Text
            position={[-(CARD_W / 2) + PAD_X, (CARD_H / 2) - HEADER_H - ROW_GAP_SUBJECT, 0.003]}
            fontSize={FONT_SUBJECT}
            color={COSMOS_THEME.textSecondary}
            anchorX="left"
            anchorY="top"
            maxWidth={CARD_W - MAXW_REDUCE_SUBJECT}
            renderOrder={ro + 3}
            toneMapped={false}
            overflowWrap="break-word"
          >
            {truncate(point.subject, MAX_CHARS)}
          </Text>

          {/* +added (右上) — git-added トークン */}
          <Text
            position={[(CARD_W / 2) - PAD_X_RIGHT, (CARD_H / 2) - HEADER_H - ROW_GAP_ADDED, 0.003]}
            fontSize={FONT_DIFF}
            color={COSMOS_THEME.gitAdded}
            fontWeight="bold"
            anchorX="right"
            anchorY="top"
            renderOrder={ro + 3}
            toneMapped={false}
          >
            {`+${point.meta.added}`}
          </Text>

          {/* -deleted (右上) — git-deleted トークン */}
          <Text
            position={[(CARD_W / 2) - PAD_X_RIGHT, (CARD_H / 2) - HEADER_H - ROW_GAP_DELETED, 0.003]}
            fontSize={FONT_DIFF}
            color={COSMOS_THEME.gitDeleted}
            fontWeight="bold"
            anchorX="right"
            anchorY="top"
            renderOrder={ro + 3}
            toneMapped={false}
          >
            {`-${point.meta.deleted}`}
          </Text>

          {/* メタ情報 (左下: shortHash + relativeTime) — text-muted */}
          <Text
            position={[-(CARD_W / 2) + PAD_X, -(CARD_H / 2) + ROW_GAP_META_BOTTOM, 0.003]}
            fontSize={FONT_META}
            color={COSMOS_THEME.textMuted}
            anchorX="left"
            anchorY="bottom"
            renderOrder={ro + 3}
            toneMapped={false}
          >
            {`${point.meta.shortHash} · ${relativeTimeFromTs(point.ts)}`}
          </Text>

          {/* ヘッダ basename (白抜き) — bold + bg-canvas アウトラインで滲み防止 */}
          <Text
            position={[-(CARD_W / 2) + ROW_GAP_META_BOTTOM, (CARD_H / 2) - HEADER_H / 2, 0.003]}
            fontSize={FONT_HEADER}
            color={COSMOS_THEME.textPrimary}
            fontWeight="bold"
            outlineWidth={0.003}
            outlineColor="#00000080"
            anchorX="left"
            anchorY="middle"
            maxWidth={CARD_W * 0.7}
            renderOrder={ro + 3}
            toneMapped={false}
          >
            {point.basename}
          </Text>

          {/* parentDir (ヘッダ右) — fresh 時は NEW バッジに差し替え */}
          {point.isFresh ? (
            <Text
              position={[(CARD_W / 2) - PAD_X_RIGHT, (CARD_H / 2) - HEADER_H / 2, 0.003]}
              fontSize={FONT_PARENT * 1.05}
              color={COSMOS_THEME.freshHighlight}
              outlineWidth={0.004}
              outlineColor="#00000088"
              anchorX="right"
              anchorY="middle"
              renderOrder={ro + 3}
              toneMapped={false}
            >
              {'✦ NEW'}
            </Text>
          ) : (
            point.parentDir.length > 0 && (
              <Text
                position={[(CARD_W / 2) - PAD_X_RIGHT, (CARD_H / 2) - HEADER_H / 2, 0.003]}
                fontSize={FONT_PARENT}
                color="#ffffffaa"
                anchorX="right"
                anchorY="middle"
                maxWidth={CARD_W * 0.5}
                renderOrder={ro + 3}
                toneMapped={false}
              >
                {point.parentDir.length > 22
                  ? '…' + point.parentDir.slice(-20)
                  : point.parentDir}
              </Text>
            )
          )}

          {/* フラッシュ plane — mount 直後 ~1100ms かけて金色 (freshHighlight) で
              フェードアウト。視界の端でも「いま光った」と気付けるよう強めに点ける。 */}
          {flashAlpha > 0 && (
            <mesh position={[0, 0, 0.004]} renderOrder={ro + 4}>
              <planeGeometry args={[CARD_W, CARD_H]} />
              <meshBasicMaterial
                color={COSMOS_THEME.freshHighlight}
                transparent
                opacity={flashAlpha}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          )}
        </group>
      </Billboard>
    </group>
  );
}

// ---------------------------------------------------------------------------
// SceneContents — Canvas 内部のシーン管理
// ---------------------------------------------------------------------------
type SceneContentsProps = {
  points: SpacePoint[];
  selectedCommitHash: string | null;
  reducedMotion: boolean;
  onPick: (point: SpacePoint) => void;
  onContextMenuPoint: (nativeEvent: MouseEvent, key: string) => void;
};

function SceneContents({
  points,
  selectedCommitHash,
  reducedMotion,
  onPick,
  onContextMenuPoint,
}: SceneContentsProps) {
  const handleContextMenu = useCallback(
    (e: ThreeEvent<MouseEvent>, key: string) => {
      onContextMenuPoint(e.nativeEvent, key);
    },
    [onContextMenuPoint],
  );

  return (
    <>
      {points.map((p) => (
        <MessageWindow
          key={p.key}
          point={p}
          isSelected={
            !p.meta.isWorkingTree &&
            selectedCommitHash !== null &&
            selectedCommitHash.startsWith(p.meta.shortHash)
          }
          reducedMotion={reducedMotion}
          onPick={onPick}
          onContextMenu={handleContextMenu}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// CosmosStageInner — Canvas の中に入れるトップレベル
// ---------------------------------------------------------------------------
type CosmosStageInnerProps = SceneContentsProps;

function CosmosStageInner(props: CosmosStageInnerProps) {
  const { reducedMotion } = props;
  return (
    <>
      <ambientLight intensity={0.4} />
      {/* 寒色 = accent 寄り、暖色 = warning 寄り。refscope の青/橙アクセントと整合 */}
      <pointLight position={[0, 0, 18]} intensity={1.1} color={COSMOS_THEME.accent} />
      <pointLight
        position={[-15, 12, -8]}
        intensity={0.5}
        color={COSMOS_THEME.warning}
      />
      <Sparkles
        count={300}
        scale={[100, 70, 100]}
        size={3.2}
        speed={reducedMotion ? 0 : 0.22}
        opacity={0.55}
        color={COSMOS_THEME.accent}
      />
      <OrbitControls
        enablePan
        enableRotate
        enableZoom
        dampingFactor={0.08}
        enableDamping={!reducedMotion}
        makeDefault
      />
      <SceneContents {...props} />
      <EffectComposer>
        <Bloom
          intensity={0.5}
          luminanceThreshold={0.85}
          luminanceSmoothing={0.45}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
}

// ---------------------------------------------------------------------------
// StageBridge — Canvas 内部の camera/controls 参照を外部 ref へ橋渡し
// ---------------------------------------------------------------------------
type OrbitControlsLike = {
  reset?: () => void;
  update?: () => void;
  target: THREE.Vector3;
};

function StageBridge({
  controlsOutRef,
  cameraOutRef,
}: {
  controlsOutRef: React.MutableRefObject<OrbitControlsLike | null>;
  cameraOutRef: React.MutableRefObject<THREE.Camera | null>;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);

  useEffect(() => {
    cameraOutRef.current = camera;
  }, [camera, cameraOutRef]);

  useEffect(() => {
    if (controls) {
      controlsOutRef.current = controls as unknown as OrbitControlsLike;
    }
  }, [controls, controlsOutRef]);

  return null;
}

// ---------------------------------------------------------------------------
// StageControls — Canvas 外側に被せるオーバーレイ UI
// ---------------------------------------------------------------------------
type StageControlsProps = {
  freshOnly: boolean;
  onToggleFreshOnly: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

function StageButton({
  children,
  onClick,
  title,
  active,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  // refscope の他 Lens のボタン (BranchSidebar, TopBar など) と同じトーン:
  //   通常: bg-elevated 寄り + border、active: accent 寄りで color-mix。
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active ? true : undefined}
      style={{
        width: 28,
        height: 28,
        borderRadius: 'var(--rs-radius-sm)',
        border: active
          ? '1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 55%)'
          : '1px solid var(--rs-border)',
        background: active
          ? 'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 20%)'
          : 'color-mix(in oklab, var(--rs-bg-elevated), transparent 25%)',
        color: active ? 'var(--rs-accent)' : 'var(--rs-text-secondary)',
        cursor: 'pointer',
        fontSize: 13,
        fontFamily: 'var(--rs-sans)',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        transition:
          'background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out',
      }}
    >
      {children}
    </button>
  );
}

function StageControls({
  freshOnly,
  onToggleFreshOnly,
  fullscreen,
  onToggleFullscreen,
  onReset,
  onZoomIn,
  onZoomOut,
}: StageControlsProps) {
  return (
    <div
      role="toolbar"
      aria-label="Cosmos stage controls"
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 5,
        display: 'flex',
        gap: 4,
        background: 'color-mix(in oklab, var(--rs-bg-panel), transparent 18%)',
        border: '1px solid var(--rs-border)',
        borderRadius: 'var(--rs-radius-md)',
        padding: 4,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        pointerEvents: 'auto',
      }}
    >
      <StageButton onClick={onZoomIn} title="ズームイン">
        ＋
      </StageButton>
      <StageButton onClick={onZoomOut} title="ズームアウト">
        −
      </StageButton>
      <StageButton onClick={onReset} title="ビューをリセット">
        ⌂
      </StageButton>
      <StageButton
        onClick={onToggleFreshOnly}
        title={freshOnly ? '全件表示に戻す' : '直近 5 分の更新のみ表示'}
        active={freshOnly}
      >
        ✦
      </StageButton>
      <StageButton
        onClick={onToggleFullscreen}
        title={fullscreen ? 'フルスクリーン解除 (Esc)' : 'フルスクリーン'}
        active={fullscreen}
      >
        {fullscreen ? '✕' : '⛶'}
      </StageButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PulseCosmosStage — 外部公開コンポーネント (React.lazy でロードされる)
// ---------------------------------------------------------------------------
export type PulseCosmosStageProps = {
  points: SpacePoint[];
  selectedCommitHash: string | null;
  reducedMotion: boolean;
  onPick: (point: SpacePoint) => void;
  onContextMenuPoint: (nativeEvent: MouseEvent, key: string) => void;
};

export default function PulseCosmosStage({
  points,
  selectedCommitHash,
  reducedMotion,
  onPick,
  onContextMenuPoint,
}: PulseCosmosStageProps) {
  const [freshOnly, setFreshOnly] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const controlsRef = useRef<OrbitControlsLike | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);

  const filteredPoints = useMemo(
    () => (freshOnly ? points.filter((p) => p.isFresh) : points),
    [points, freshOnly],
  );

  const handleReset = useCallback(() => {
    controlsRef.current?.reset?.();
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    const dir = cam.position.clone().sub(ctrl.target);
    // 過剰なズームを抑える：target からの距離を 2〜80 にクランプ
    const newDistance = dir.length() * factor;
    if (newDistance < 2 || newDistance > 80) return;
    dir.multiplyScalar(factor);
    cam.position.copy(ctrl.target).add(dir);
    ctrl.update?.();
  }, []);

  const handleZoomIn = useCallback(() => zoomBy(0.82), [zoomBy]);
  const handleZoomOut = useCallback(() => zoomBy(1.22), [zoomBy]);
  const handleToggleFullscreen = useCallback(
    () => setFullscreen((v) => !v),
    [],
  );
  const handleToggleFreshOnly = useCallback(
    () => setFreshOnly((v) => !v),
    [],
  );

  // Esc でフルスクリーン解除
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // wrapper のスタイル（通常時は親に追随、フルスクリーン時は viewport を占有）
  // 背景は refscope の bg-canvas を基調にした radial gradient で、Pulse Lens の
  // ステージ背景 (`.rs-pulse-stage`) と同じ視覚言語に揃える。
  const wrapperStyle: React.CSSProperties = fullscreen
    ? {
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        // RefScopeTokens の --rs-z-modal: 50 と同値。CSS 変数は inline style の
        // zIndex (number) に直接渡せないため、数値リテラルで揃える。
        zIndex: 50,
        background:
          'radial-gradient(ellipse at 50% 40%, color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 8%) 0%, var(--rs-bg-canvas) 70%)',
      }
    : {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
      };

  return (
    <div style={wrapperStyle}>
      <Canvas
        camera={{ position: [0, 0, 22], fov: 60, near: 0.1, far: 200 }}
        dpr={[1, 1.8]}
        gl={{ alpha: true }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: 'transparent',
        }}
      >
        <Suspense fallback={null}>
          <StageBridge
            controlsOutRef={controlsRef}
            cameraOutRef={cameraRef}
          />
          <CosmosStageInner
            points={filteredPoints}
            selectedCommitHash={selectedCommitHash}
            reducedMotion={reducedMotion}
            onPick={onPick}
            onContextMenuPoint={onContextMenuPoint}
          />
        </Suspense>
      </Canvas>

      <StageControls
        freshOnly={freshOnly}
        onToggleFreshOnly={handleToggleFreshOnly}
        fullscreen={fullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        onReset={handleReset}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
      />

      {/* freshOnly でデータが空になったときの案内 */}
      {freshOnly && filteredPoints.length === 0 && (
        <div
          aria-live="polite"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '10px 16px',
            borderRadius: 'var(--rs-radius-md)',
            background:
              'color-mix(in oklab, var(--rs-bg-panel), transparent 18%)',
            border: '1px solid var(--rs-border)',
            color: 'var(--rs-text-secondary)',
            fontFamily: 'var(--rs-sans)',
            fontSize: 12,
            pointerEvents: 'none',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          直近 5 分の更新はありません
        </div>
      )}
    </div>
  );
}
