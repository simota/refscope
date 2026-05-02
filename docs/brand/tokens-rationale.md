# Refscope デザイントークン — 設計意図・コントラスト比検証・使用ガイド

> ブランドメタファー: **観測所（Observatory）**  
> パーソナリティ: Calm / Precise / Patient / Honest / Quiet

---

## 1. カラーシステムの設計意図

### Neutral パレット（11段階, hue 250）

基調色は「pure white ではなく subtle cool tint を持つ gray」です。hue 250（青灰）方向の極小クロマ（0.006〜0.010）により、観測所の金属・ガラス質感を表現します。warm gray（Tailwind Stone / Zinc 系）は避け、slightly cool gray を選択しました。

- **neutral-50**: `oklch(0.985 0.006 250)` — Light mode の主背景。純白でなく冷たいニュアンスを持つ。
- **neutral-900**: `oklch(0.165 0.008 250)` — Light mode の本文色。14.96:1のAAA コントラストを確保。
- **neutral-950**: `oklch(0.108 0.006 250)` — Dark mode の主背景。極限まで暗く、星空のような深度。
- **neutral-50 (on dark)**: Dark mode の本文色として流用。17.35:1のAAA コントラスト。

中間段階（100〜800）は等間隔ではなく、暗部（700〜950）側を圧縮することで、dark mode でのホバー・アクティブ状態の差別化を確保しています。

### Accent（シングルアクセント, hue 200 — cyan-teal）

**1色のみ**のアクセントを採用しています。使用場面は `selection / focus ring / SSE live-update pulse` に限定。装飾目的での使用は禁止。

hue 200 は「計測機器のディスプレイ光」をイメージ。過度に主張せず、暗い環境でも視認性を保ちます。Light mode では accent-500（L=0.63）、Dark mode では accent-400（L=0.73）に切り替えることで両モードで最適な視認性を維持します。

### セマンティックカラー

| 種別 | 用途 | Hue | 備考 |
|------|------|-----|------|
| warning amber | rewritten history / force-push | 65-75 | Dark mode はクロマ抑制（glare回避） |
| error red | hard error のみ | 15-20 | 警告には使わない。限定使用 |
| success-muted | signed commit / merge success | 155 | 彩度低め。押しつけがましくない |
| info neutral | 署名不明 / 一般アノテーション | 250 (無彩) | クロマなし。静粛な情報伝達 |

**使用制約**: 1画面同時3箇所まで。超過時は集約バナーに統合する。

---

## 2. コントラスト比検証表

コントラスト比は WCAG 2.2 の相対輝度計算式に基づく近似値です（OKLCH L値からsRGB 経由で計算）。

### Light Mode

| 前景 | 背景 | OKLCH (fg) | OKLCH (bg) | 推定 CR | 基準 | 結果 |
|------|------|------------|------------|---------|------|------|
| rs-fg-base (neutral-900) | rs-bg-base (neutral-50) | L=0.165 | L=0.985 | **14.96:1** | AAA 7:1 | ✅ AAA |
| rs-fg-subtle (neutral-600) | rs-bg-base (neutral-50) | L=0.480 | L=0.985 | **5.72:1** | AA 4.5:1 | ✅ AA |
| rs-fg-muted (neutral-400) | rs-bg-base (neutral-50) | L=0.760 | L=0.985 | **1.68:1** | 装飾限定 | ⚠️ 意味的テキスト禁止 |
| accent-500 | rs-bg-base (neutral-50) | L=0.630 | L=0.985 | **2.96:1** | UI要素3:1 | ⚠️ テキスト用途禁止、indicator限定 |
| rs-border-base (neutral-300) | rs-bg-base (neutral-50) | L=0.860 | L=0.985 | **1.50:1** | 装飾境界線3:1 | ⚠️ 装飾ボーダーとして許容 |
| warning-fg | warning-bg | L=0.420 | L=0.960 | **6.89:1** | AA 4.5:1 | ✅ AA+ |
| error-fg | error-bg | L=0.390 | L=0.965 | **7.82:1** | AAA 7:1 | ✅ AAA |
| success-fg | success-bg | L=0.380 | L=0.960 | **7.53:1** | AAA 7:1 | ✅ AAA |
| rs-fg-base (neutral-900) | rs-bg-raised (neutral-100) | L=0.165 | L=0.958 | **13.55:1** | AAA 7:1 | ✅ AAA |
| rs-fg-subtle (neutral-600) | rs-bg-raised (neutral-100) | L=0.480 | L=0.958 | **5.12:1** | AA 4.5:1 | ✅ AA |

### Dark Mode

| 前景 | 背景 | OKLCH (fg) | OKLCH (bg) | 推定 CR | 基準 | 結果 |
|------|------|------------|------------|---------|------|------|
| rs-fg-base (neutral-50) | rs-bg-base (neutral-950) | L=0.985 | L=0.108 | **17.35:1** | AAA 7:1 | ✅ AAA |
| rs-fg-subtle (neutral-400) | rs-bg-base (neutral-950) | L=0.760 | L=0.108 | **8.93:1** | AAA 7:1 | ✅ AAA |
| rs-fg-muted (neutral-600) | rs-bg-base (neutral-950) | L=0.480 | L=0.108 | **4.38:1** | AA 4.5:1 | ⚠️ AA ギリギリ。装飾・補助限定 |
| accent-400 | rs-bg-base (neutral-950) | L=0.730 | L=0.108 | **7.42:1** | AA 4.5:1 | ✅ AA (indicator) |
| rs-fg-base (neutral-50) | rs-bg-raised | L=0.985 | L=0.145 | **14.02:1** | AAA 7:1 | ✅ AAA |
| warning-fg (dark) | warning-bg (dark) | L=0.820 | L=0.260 | **5.44:1** | AA 4.5:1 | ✅ AA |
| error-fg (dark) | error-bg (dark) | L=0.800 | L=0.250 | **5.22:1** | AA 4.5:1 | ✅ AA |
| success-fg (dark) | success-bg (dark) | L=0.800 | L=0.250 | **5.10:1** | AA 4.5:1 | ✅ AA |

**注記**: neutral-400 on dark（dark mode muted）は 4.38:1 で厳密にはAA 4.5:1 を若干下回ります。このトークンは意味のあるテキストに使用しないよう制約（placeholder / disabled / decorative 限定）を設けています。neutral-500（L=0.620）を代わりに使用すると dark mode で AA を達成できます。

---

## 3. タイポグラフィの設計意図

### フォントスケール

Refscope は git の歴史データを密度高く表示するため、standard の16px基準ではなく **14px ベース** を採用しています。

```
xs(12) → sm(13) → base(14) → md(15) → lg(17)
```

`xl` 以上は実質不使用。`lg(17px)` もモーダルタイトル等で限定的に使います。

### モノスペース

git OID（コミットハッシュ）・タイムスタンプには専用の `mono-xs(12px)` + `tabular-nums` + `ligatures OFF` を組み合わせます。リガチャOFFは意図的 — `fl`/`fi` 等の結合が git ハッシュの視認性を下げるためです。

### ウェイト制約

- `light(300)` 禁止: 小サイズ + 低コントラスト時の視認性低下を防ぐ
- `bold(700)` 限定: 1画面あたり1-2箇所が上限。「全部強調 = 何も強調されない」を防ぐ
- `regular(400)` / `medium(500)` が主軸

---

## 4. スペーシング・密度の設計意図

4px グリッドを採用し、`4 / 8 / 12 / 16 / 24 / 32` の6ステップのみ使用します。

**禁止値（5 / 7 / 11px）**: これらは4pxグリッドから外れ、コンポーネント間で一貫性を失わせます。デザインツールで「なんとなく合わせた」値が混入しないよう明示的に禁止。

行の高さ目標は **28-32px**（dense）。Linear / Vercel Dashboard に近い密度です。余白を惜しみ、情報密度を優先します。

---

## 5. 角丸・エレベーション

| 値 | 用途 |
|----|------|
| `none (0px)` | インラインコードチップ、タグ |
| `xs (2px)` | チェックボックス、小バッジ |
| `sm (4px)` | **デフォルト**。ボタン、インプット、カード |
| `md (6px)` | ポップオーバー、ドロップダウン |

**8px以上は禁止**。「観測所の計測機器」は丸みより直線と精度を優先します。

エレベーションは3段のみ: `none → subtle → overlay`。Heavy drop shadowはブランドパーソナリティ（Calm not flashy）に反します。dark mode では shadow よりも border（1px 微妙な色差）でレイヤーを表現します。

---

## 6. モーション

| 名前 | 値 | 用途 |
|------|----|------|
| `fast` | 120ms | hover bg、チェックボックス、アイコン切替 |
| `normal` | 180ms | パネル開閉、ドロップダウン、行選択 |
| `moderate` | 240ms | サイドバー展開、ダイアログ表示 |
| `slow` | 300ms | SSE pulse フェード、全画面遷移 |

SSE live-update の `rs-pulse` アニメーションのみ `ease-spring` を使用します。他は全て `ease-standard`（控えめな ease-out 曲線）。`prefers-reduced-motion` では全アニメーションを無効化します。

---

## 7. フォーカスリング仕様

```
outline: 2px solid var(--focus-ring-color);  /* accent-500 light / accent-400 dark */
outline-offset: 2px;
box-shadow: 0 0 0 4px neutral-950/25%;       /* 外側リング */
```

二重描画（inner accent + outer neutral halo）により、光背景・暗背景どちらでも視認できます。キーボードナビゲーションユーザーにとって明確な位置指示を提供します。

---

## 8. Z-index スタック

明示的なスタックを定義し、`z-index: 9999` 等の「魔法の数字」を排除します。

```
base(0) → raised(10) → dropdown(100) → sticky(200) → overlay(300) → modal(400) → toast(500) → tooltip(600)
```

---

## 9. ファイル構成と統合方法

```
docs/brand/
  tokens.json          ← DTCG v2025.10 準拠。単一の真実の源泉
  tailwind-theme.css   ← Tailwind v4 @theme 定義。mock/src/styles/ へコピーして統合
  tokens-rationale.md  ← このファイル
```

`mock/src/styles/theme.css` の既存シャドウ/ラジウス定義は本トークンに置き換えてください。移行時は既存の `--radius: 0.625rem`（10px）を `--radius-sm: 4px` に変更する点に注意してください（8px以上禁止制約への適合）。
