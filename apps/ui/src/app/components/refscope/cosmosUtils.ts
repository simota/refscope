/**
 * cosmosUtils — Cosmos ビューの「点」を作る純関数と型定義。
 *
 * PulseLens (UI shell) と PulseCosmosStage (R3F の 3D シーン) が共有する。
 * このファイルだけは three.js に依存しない純粋な計算なので、
 *   1. テストや再利用がしやすい
 *   2. PulseCosmosStage を React.lazy 分割しても両側が同じ型を見る
 * という二つの利点がある。three.js を import すると lazy 分割が崩れるので
 * このモジュールでは絶対に three.js を触らないこと。
 */
import type { FileKind } from '../../lib/fileKind';

// ---------------------------------------------------------------------------
// 配置・鮮度のパラメータ
//   3D 空間にカードを並べる際の「壁」と「寿命」を一箇所にまとめる。
//   触ると見た目が大きく変わるので、変更時は実機確認推奨。
// ---------------------------------------------------------------------------

// Z 軸の手前 (新) と奥 (古) の位置。カメラは (0,0,22) にあるので
// 18 が手前ギリギリ、-44 で十分奥に消える。
const Z_FRONT = 18;
const Z_BACK = -44;

// 「今」と見なす時間窓。これを超えると Z は最奥に張り付き、不透明度も最低。
// 6 時間: 直近 1 営業日の前半くらいを画面に保つ目安。
const NOW_HORIZON_MS = 6 * 60 * 60 * 1000;

// 最古でも完全に消さず、これだけ透けて残す。
// 「履歴の霧」として奥行きを感じさせるためのフロア。
const MIN_OPACITY = 0.15;

// 新しいカードを中央に寄せる強さ。0=完全中央、1=端まで散る。
// 0.35 で「新しいものほど視線を集める」軽い向心力を作る。
const CENTER_BIAS = 0.35;

// 「fresh = 直近の変更」とみなす時間。金枠 + ✦ NEW + halo の発火条件。
const FRESH_MS = 5 * 60 * 1000;

// X/Y の散らばり幅 (世界座標)。FIELD_X > FIELD_Y で横長のフィールドに。
const FIELD_X = 38;
const FIELD_Y = 22;

// ---------------------------------------------------------------------------
// SpacePoint — 3D 空間に置かれる 1 枚のカードを表す。
//
//   key         : ユニーク識別子。普通はファイルパス。
//                 同じ key は何度描画しても同じ X/Y に来る (決定論的配置)。
//   groupKey    : 同じ群として扱う単位 (現状: ディレクトリ。カード色には
//                 未使用だが将来のグルーピング用に残している)。
//   ts          : このカードが表す変更の時刻 (epoch ms)。
//                 Z 軸と不透明度の両方を駆動する。
//   basename    : カード上に大きく出すファイル名 (例: "PulseLens.tsx")。
//   parentDir   : ヘッダ右に出す親ディレクトリ (例: "apps/ui/src/...")。
//   subject     : 本文に出すコミット件名 (working tree は固定文言)。
//   meta        : カードに小さく出す副情報 + ディテール用。
//   hue         : ヘッダ strip と halo の色相 (0..360)。
//                 buildCosmos が churnToHue で決定する。
//   position    : world 座標 [x, y, z]。
//   opacity     : 0..1。古いほど 0 に近づき "霧" として残る。
//   isFresh     : 5 分以内に更新されたか。金枠 + ✦ NEW + halo の発火条件。
// ---------------------------------------------------------------------------
export type SpacePoint = {
  key: string;
  groupKey: string;
  ts: number;
  basename: string;
  parentDir: string;
  subject: string;
  meta: {
    shortHash: string;
    added: number;
    deleted: number;
    status: string;
    kind: FileKind;
    isWorkingTree: boolean;
  };
  hue: number;
  position: [number, number, number];
  opacity: number;
  isFresh: boolean;
};

/**
 * buildCosmos に渡す形。derived な hue / position / opacity / isFresh は
 * buildCosmos が後から付与するので、呼び出し側はソースデータ部分だけ作れば良い。
 */
export type SpacePointInput = Omit<SpacePoint, 'position' | 'opacity' | 'isFresh' | 'hue'>;

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/**
 * key を 0..1 の擬似乱数に潰す (FNV-1a)。
 * 同じ入力には常に同じ値が返るので、再レンダリングで位置がブレない。
 */
function hashPseudoRandom(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return (h >>> 0) / 0xffffffff;
}

/** Y 軸用にハッシュを変えるだけのバリエーション。 */
function hashPseudoRandom2(key: string): number {
  return hashPseudoRandom(key + '__y');
}

/** t を [0,1] にクランプした上での線形補間。 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * 変更量 (added + deleted) を hue (色相 0..360) に変換する。
 *
 * 変更が小さいほど青く落ち着き、大きくなるほど暖色〜赤に振り切る。
 * 線形だと大きな commit に偏って小さな変更が見分けられないので log10 を噛ます。
 *
 *   churn=0      → hue 210 (空青)  軽微
 *   churn=10     → hue 140 (緑)    小
 *   churn=100    → hue 70  (黄)    中
 *   churn=500    → hue 20  (橙)    大
 *   churn>=1000  → hue 0   (赤)    巨大
 */
export function churnToHue(added: number, deleted: number): number {
  const churn = Math.max(0, added) + Math.max(0, deleted);
  // log10(churn+1) は churn=0 で 0、churn=999 で約 3。3 で割って 0..1 に。
  const t = Math.min(Math.log10(churn + 1) / 3, 1);
  // 0..1 を hue 210 → 0 に線形マップ (青 → 赤)。
  return 210 - t * 210;
}

// ---------------------------------------------------------------------------
// buildCosmos — Cosmos ビューに並べる SpacePoint[] を作る純関数。
//
//   inputs  : 並べたいデータ。並び順は結果に影響しない (位置はハッシュ由来)。
//   now     : 「現在時刻」とみなす epoch ms。SSE で新着が来たびに進める。
//
// 戻り値の各 SpacePoint は決定論的:
//   - 同じ key は常に同じ X/Y に来る (リレンダ時の位置ブレ防止)。
//   - hue は変更量だけで決まる。
//   - Z / opacity / isFresh は now との差分 (age) だけで決まる。
// ---------------------------------------------------------------------------
export function buildCosmos(
  inputs: SpacePointInput[],
  now: number,
): SpacePoint[] {
  return inputs.map((p) => {
    const age = Math.max(0, now - p.ts);

    // 色: 変更量で青→赤。kind (種別) は左の細帯側に任せる。
    const hue = churnToHue(p.meta.added, p.meta.deleted);

    // X/Y: key 由来の固定座標。new ほど中央寄り、古いほど外周へ。
    //   rx, ry は -1..1 の決定論的な「方向」。
    //   spread は age が新しい (0) ほど CENTER_BIAS、古い (1) ほど 1.0。
    const rx = hashPseudoRandom(p.key) * 2 - 1;
    const ry = hashPseudoRandom2(p.key) * 2 - 1;
    const ageFrac = Math.min(age / NOW_HORIZON_MS, 1);
    const spread = lerp(CENTER_BIAS, 1.0, ageFrac);
    const x = rx * FIELD_X * spread;
    const y = ry * FIELD_Y * spread;

    // Z: 新しいほど手前 (カメラに近い)、古いほど奥に下げる。
    const z = lerp(Z_FRONT, Z_BACK, ageFrac);

    // 透明度: 古いカードを霧化。0 にはせず MIN_OPACITY で残す。
    const opacity = lerp(1.0, MIN_OPACITY, ageFrac);

    // 「ついさっき」フラグ。金枠 / ✦ NEW / halo / scale 1.5x をまとめて起こす。
    const isFresh = age <= FRESH_MS;

    return {
      ...p,
      hue,
      position: [x, y, z] as [number, number, number],
      opacity,
      isFresh,
    };
  });
}
