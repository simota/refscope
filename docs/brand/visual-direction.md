# Refscope ビジュアルディレクション

> 視覚言語の **方向性・原則** を定義します。具体的なトークン値（hex / px / ms）は `tokens.json` および `tailwind-theme.css` を参照してください。このドキュメントは「なぜそのトークンに辿り着いたか」の根拠の一次定義です。

## 核となる視覚命題

Refscope は「**観測装置**」である。望遠鏡でも顕微鏡でもなく、**Git ref という移ろう対象を歪めずに記録する計器**。視覚言語は **計器のもつ静謐さと正確さ** を借り、UI の存在感そのものを後退させる。色や動きが「観測の妨げ」になった瞬間、設計は失敗している。

## 1. ビジュアル原則

1. **Calm by default, alarming only when warranted**
   通常状態は限りなく静か。force-push や history rewrite といった「観測事実」だけが視覚的優先度を獲得する。アクセントは年に 5 回しか出番がない警報灯であり、装飾ではない。

2. **Type does the work, color is secondary**
   情報構造はタイポグラフィ階層と余白で表現する。色は意味の「補強」であり「主役」ではない。**モノクロ印刷しても情報が壊れないことを設計のリトマス試験紙とする。**

3. **Observation and interpretation are visually separated**
   「事実 (commit hash, ref name, timestamp)」と「解釈 (rewritten, force-pushed の判定)」を別レイヤーで提示する。事実は中性色のモノスペース、解釈は意味色つきの badge + テキスト。両者を同じ強度で混ぜない。

4. **Three-layer guarantee for meaning**
   **色 + 形 (icon/shape) + テキストラベル** の三層で意味を保証する。色覚多様性、グレースケール印刷、スクリーンリーダー、低コントラスト環境のいずれでも情報が劣化しない。

5. **Density is a feature, not a bug**
   コミットリストは「少なく見せる」のではなく「多く見せても疲れない」を目指す。dense layout を選び、tap target ではなく cursor density を最適化する (本ツールは pointer 入力前提のローカル開発者ツール)。

6. **Motion is for state change only**
   アニメーションは「観測対象の状態が変わったこと」を伝える時だけ使う。スクロール演出、装飾的トランジション、引きつけのための motion は禁止。

## 2. カラー戦略

- **基調**: **Cool neutral 寄りのモノクロマティック** (warm gray ではなく slightly cool gray、OKLCH hue ~250)。
  - (a) ブランドカラーで観測対象を着色しない = 計器の中立性
  - (b) cool gray は code エディタ文化との親和性が高い
  - (c) warm tone は「温かみ」を呼び込みすぎ Calm UI の冷静さを損なう
- **Accent**: 単色アクセント (cyan〜teal 帯を 1 本だけ、OKLCH hue ~200)。「装置のレンズ越しに対象を見る」メタファーの唯一の色彩記号。**selection / focus / live-update pulse にのみ使用。**
- **Light / Dark**: **両方 first-class**。OS 追従 + 手動トグル。両モードでコントラスト・意味色マッピング・アクセント彩度を独立に検証。
- **意味色 — 色 + 形 + テキストの三層保証**:

| 意味 | 色 | 形 | テキスト |
|---|---|---|---|
| new (新規 ref/commit) | neutral-fg + accent dot | 小さな dot prefix | "new" / 相対時刻 |
| rewritten (history 書換) | warning amber | 二重線 underline + ⚠ icon | "rewritten" badge |
| force-pushed | warning amber (heavier) | 縦バー左罫 + arrow icon | "force-pushed" badge |
| merge | neutral | 二股 graph node | "merge" |
| signed | success-muted (実装外なので灰) | shield outline icon | "signature unknown" 明示 |
| error | red (限定使用) | ✕ icon | error text 必須 |

- **アラート色の節制**: warning/error は 1 画面につき同時 3 箇所まで。それを超える場合は集約 banner にまとめる (rewrite alert がノイズ化する worst case を防ぐ)。

## 3. タイポグラフィ戦略

### UI 書体 — Humanist sans-serif で mechanically restrained なもの

- **第一候補**: **Inter** (SIL OFL, 商用可) — UI 用設計、密度耐性、tabular figures あり。
- **第二候補**: **IBM Plex Sans** (SIL OFL) — 工業計器のニュアンスでブランドメタファーに近い。
- **第三候補**: **Geist** (SIL OFL) — モダンで視覚負荷が軽い。
- **採用**: **Inter (default) + IBM Plex Sans (検討中)**。

geometric sans (Futura 系) は「丸く幾何学的」すぎて計器の質感に合わず、純 grotesque (Helvetica) は冷たすぎて密集情報の可読性を落とす。中間の humanist を選ぶ。

### Mono 書体 — humanist monospace、ligatures off

- **第一候補**: **JetBrains Mono** (SIL OFL) — 数字・hex の判別性 (0/O, 1/l/I) が高い。
- **第二候補**: **IBM Plex Mono** (SIL OFL) — sans と superfamily で組める。
- **Ligatures 方針**: **デフォルト OFF**。`!=` を `≠` にすると "観測した文字列" と "表示された文字列" が乖離し、観測装置の原則に反する。ユーザー設定で opt-in 可。

### サイズスケール

Tailwind v4 default を **下方向に拡張、上方向に抑制**。

- 必要域: `xs (12px)` / `sm (13px)` / `base (14px)` / `md (15px)` / `lg (17px)`。
- `xl` 以上はほぼ不使用 (大きな文字は装置 UI に不要)。
- dense list 用に `mono-xs (12px)` を別途定義し tabular figures を強制。

### ウェイト

regular (400) と medium (500) を主軸。bold (700) は ref name や section header の限定使用。**light は禁止** (情報密度に負ける)。

## 4. レイアウト原則

- **Density**: **Dense** (Linear / Console 系)。row height は `28-32px` 帯。comfortable mode はオプション。
- **Grid**: 3-pane non-uniform grid (Sidebar 固定幅 / Timeline flex / Detail collapsible)。CSS Grid + container queries で各 pane が独立に dense/comfort 切替。
- **Spacing rhythm**: **4px base unit を厳守**。8/12/16/24/32 を主要ステップとし、5/7/11 のような irregular value を禁止。
- **Border vs background separation**: パネル区切りは **subtle border (1px, low contrast)** を主とする。背景色の塗り分けで階層を作らない (面積色は dark mode で目を疲れさせる)。
- **First-viewport contract**: 起動直後に「現在の HEAD・観測中の ref 数・最新の rewrite 通知 (あれば)」が必ず可視。

## 5. モーション原則

- **使う場面**:
  - SSE で新 commit/ref 到着時の **120-180ms fade-in + 1px slide**
  - rewrite 検知時の **300ms 一回限りの highlight pulse** (繰り返さない)
  - panel resize の **easing 付き width transition**
- **使わない場面**:
  - hover の color shift 以外の hover animation
  - page transition
  - loading skeleton の shimmer (静的な placeholder で代替)
  - scroll-linked effect
- **Reduced-motion**: `prefers-reduced-motion: reduce` で **全アニメーション完全停止**。状態変化は色とテキスト変化のみで通知。fade すら止める。
- **Realtime update 流入**: **「下から積み上げる」ではなく「該当行を 1 回 highlight して定位置に置く」**。視線が突然動かないこと。pause 中は queue 数を badge で示し、再開時に一括反映。

## 6. アイコン / シンボリズム

- **Icon style**: **Line, 1.5px stroke, 16/20px grid, rounded join**。Lucide ベース推奨 (shadcn と整合)。solid icon は status badge 内のみ使用。
- **Weight**: 単一 weight。可変 weight icon は禁止 (情報ノイズ)。

### ロゴ / シンボリズム — "scope" メタファーの視覚化

| 案 | 説明 | 性格 |
|---|---|---|
| **A. `[ ]` を覗く括弧** | 角括弧 `[ ]` の内側に hairline cross-hair。"ref を括る視野" | 最も literal、開発者文化と整合 |
| **B. 同心円のレチクル (照準環)** ★第一推奨 | 細い同心円 + 1 本の水平刻線。観測装置・計器・精密性の三位一体 | 最も "観測" 寄り、ブランドとして覚えやすい |
| **C. `r` を斜めに刻んだ刻印型** | タイプフェイス由来のロゴマーク | typographic、humanist の温度 |

**判断基準**: 1px ストロークでも 16px favicon で潰れないこと、白黒で意味が立つこと。

## 7. アクセシビリティ targets

- **WCAG 2.2 AA を法的最低線、テキストは AAA を狙う** (text-heavy ツール)。
- **コントラスト比** (実測値は `tokens-rationale.md`):
  - body text ≥ 7:1 (AAA)
  - UI components & 補助テキスト ≥ 4.5:1
  - decorative border ≥ 3:1
  - warning/error 色も AA 達成
- **Focus indicator**: **2px outline + 2px offset、accent 色 + outer dark/light ring の二重描画**。透明背景や glassmorphism 上でも視認できるよう必ず ring を伴う。tab 順序は左→右、上→下、SSE 更新で focus を奪わない。
- **色だけで意味を伝えない**: 全 badge にテキスト必須。diff の +/− は色 + 行頭マーカー。
- **Live region の制御**: SSE 更新は `aria-live="polite"`、pause 中は live region も停止。reduced-motion はアニメだけでなく live update の頻度も間引く。
- **Keyboard-first**: command palette (Cmd-K) を含め全操作がキーボード完結。

## 8. 成功指標

- 任意の commit 行を **0.5s 以内に視覚的に解析**できる (heuristic test)。
- rewrite 通知を含む画面で **alarm fatigue が起きない** (連続 1h 観測で誤クリック率 < 2%)。
- 色覚シミュレータ (Protanopia / Deuteranopia / Tritanopia / Achromatopsia) すべてで意味が保たれる。
- reduced-motion ON/OFF で機能性差分ゼロ。
- dark/light で同一情報密度を維持。

---

**Source agent**: Vision
**Status**: 確定 (v0)
**Downstream**: `tokens.json` / `tailwind-theme.css` / `tokens-rationale.md` (Muse による具体トークン化)
