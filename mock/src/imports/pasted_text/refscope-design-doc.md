# リアルタイム Git Log ビュアー

# UIデザイン設計書 & デザインシステム案

プロダクト名は仮に **RefScope** とします。
コンセプトは、**Git履歴を“読む”だけでなく、履歴の変化を安全に追跡する開発者向けリアルタイムワークベンチ**です。

2026年4月時点の方針として、デザインシステムは **トークンファースト** で設計します。Design Tokens Community Group は 2025年10月に Design Tokens Specification 2025.10 の最初の安定版を発表しており、色・タイポグラフィ・スペーシングなどをツール横断で共有する標準的な流れが強まっています。([W3C][1])
また、Figma Variables はデザイントークンや light/dark などのモード管理に使えるため、デザインと実装の橋渡しにも向いています。([Figma ヘルプセンター][2])

---

## 1. デザイン方針

## デザインキーワード

**Dark-first / Dense / Realtime / Command-first / Token-driven / AI-ready**

Gitログビュアーは、一般的なSaaS画面よりもIDEや監視ダッシュボードに近いです。
そのため、派手さよりも以下を優先します。

* 長時間見ても疲れない
* 情報密度が高い
* コミットの流れが一目で分かる
* force push / rebase / reset などの危険な履歴変更が見逃されない
* キーボードで高速操作できる
* diffやhashなどの等幅情報が読みやすい
* 将来的にAI要約・異常検知・レビュー補助を載せられる

---

# 2. 最新トレンドの取り込み方

## 2.1 Token-first Design System

色、余白、角丸、影、タイポグラフィ、モーションをすべてトークン化します。
デザインファイル、CSS、Reactコンポーネント、Storybook、AI生成UIのすべてが同じトークンを参照する構成にします。

Design Tokens仕様の安定化により、今後は独自JSONではなく、標準に近い `$type` / `$value` 形式で管理するのが望ましいです。([W3C][1])

---

## 2.2 AI-ready Design System

2025年以降の設計システムでは、デザインシステムが単なるUI部品集ではなく、AIがプロダクトUIを理解するための共有言語として扱われ始めています。Figmaも、AI時代にデザインシステムがデザインとコードの翻訳レイヤーになると説明しています。([Figma][3])
Atlassianも、AI駆動のプロトタイピングにおいて、トークン・コンポーネント・パターンの単一ソースが反復的なUI生成を減らすと説明しています。([アトラシアン][4])

RefScopeでは、AI機能を最初から主役にしすぎず、以下のように補助的に配置します。

```text
AI Commit Summary
AI Risk Signal
AI Explain Diff
AI Search Intent
```

例:

```text
このコミットは認証処理のエラー分岐を変更しています。
影響範囲: src/auth/session.ts, src/api/login.ts
リスク: medium
```

---

## 2.3 Accessibility-first

WCAG 2.2 は、フォーカスが隠れないこと、ドラッグ操作の代替手段、ターゲットサイズ、認証のアクセシビリティなどを追加しています。([W3C][5])
RefScopeでは特に以下を必須にします。

```text
- キーボードだけで全操作可能
- Command Palette対応
- フォーカスリングを常時明確に表示
- 差分の赤/緑だけに依存しない
- live updateはスクリーンリーダー向けに aria-live で通知
- 最小クリック領域 32px、推奨 40px
- compact modeでも 24px 未満の操作ターゲットを作らない
```

---

## 2.4 Headless + Composable UI

React実装では、Radix Primitives や shadcn/ui 的な構成を推奨します。
Radix Primitives はキーボード操作やフォーカスマネジメントをWAI-ARIA Authoring Practicesに沿って支援し、shadcn/ui はカスタマイズ可能なコンポーネント基盤として使えるため、独自デザインシステムと相性が良いです。([Radix UI][6])

方針:

```text
Behavior: Radix Primitives
Style: RefScope tokens
Composition: shadcn/ui style
Documentation: Storybook
Design source: Figma Variables
```

---

## 2.5 Adaptive Color / OKLCH

カラーは `oklch()` をベースに設計します。OKLCHはCSSで扱えるOklab系の色表現で、明度・彩度・色相を分けて扱えます。([MDNウェブドキュメント][7])
また、`color-mix()` を使うとCSS上で色を混ぜられるため、hoverやselected、muted背景などをトークンから生成しやすくなります。([MDNウェブドキュメント][8])

---

# 3. 情報設計

## 3.1 画面構造

RefScopeの基本画面は、**3ペイン + コマンドパレット + リアルタイムイベントレイヤー**です。

```text
┌──────────────────────────────────────────────────────────────┐
│ Top Bar                                                       │
│ Repo ▼  Branch ▼  Search...                LIVE ●  Cmd+K     │
├───────────────┬──────────────────────────────┬───────────────┤
│ Left Sidebar  │ Main Timeline                │ Detail Panel   │
│               │                              │               │
│ Repositories  │ Commit Graph + Commit List   │ Commit Info    │
│ Branches      │                              │ Files          │
│ Tags          │ New commits banner           │ Diff           │
│ Remotes       │                              │ AI Summary     │
├───────────────┴──────────────────────────────┴───────────────┤
│ Status Bar: fetch state / current HEAD / event count / errors │
└──────────────────────────────────────────────────────────────┘
```

---

## 3.2 レイアウト比率

```text
Desktop Large
Left Sidebar: 260px
Timeline:     flexible, min 520px
Detail Panel: 420px - 640px

Desktop Medium
Left Sidebar: 220px
Timeline:     flexible
Detail Panel: overlay drawer or collapsible

Tablet
Sidebar:      collapsible
Timeline:     full width
Detail:       bottom sheet

Mobile
Repo/Branch:  top selector
Timeline:     single column
Detail:       full screen route
```

---

# 4. 主要画面

## 4.1 Dashboard / Repository Overview

目的は、複数リポジトリの状態を俯瞰することです。

```text
┌──────────────────────────────────────────────┐
│ RefScope                                     │
│ Search repositories...                       │
├──────────────────────────────────────────────┤
│ Recently Active                              │
│ ┌───────────────┐ ┌───────────────┐          │
│ │ frontend-app  │ │ api-server    │          │
│ │ main +3       │ │ develop +8    │          │
│ │ last 2m ago   │ │ last 12m ago  │          │
│ └───────────────┘ └───────────────┘          │
├──────────────────────────────────────────────┤
│ Rewritten History Alerts                     │
│ ⚠ api-server/main was force-updated          │
└──────────────────────────────────────────────┘
```

### 採用するUIパターン

* bento風カード
* status-first dashboard
* attention priority
* compact activity feed
* repository health badge

---

## 4.2 Repository Workbench

メイン画面です。

```text
┌──────────────────────────────────────────────────────────────┐
│ frontend-app  main ▼  /src/auth  author:shingo        LIVE ● │
├───────────────┬──────────────────────────────┬───────────────┤
│ Branches      │ 3 new commits                │ Commit         │
│ ● main        │ [Show updates]               │ a1b2c3d         │
│   develop     │                              │               │
│   feature/ui  │  ● a1b2c3d Add log viewer    │ Message        │
│               │  │ shingo · 2m ago           │ Add log viewer │
│ Tags          │  ● 9e8f7a6 Refactor parser   │               │
│ v2.1.0        │  │ tanaka · 14m ago          │ Files          │
│ v2.0.0        │  ├─● 7d6c5b4 UI branch       │ M App.tsx      │
│               │  │                           │ A events.ts    │
│ Alerts        │  ● 4c3b2a1 Merge feature     │               │
│ ⚠ rewritten   │                              │ Diff           │
└───────────────┴──────────────────────────────┴───────────────┘
```

---

## 4.3 Commit Detail

コミット選択時に右ペインへ表示します。

```text
Commit
a1b2c3d4e5f6...

Message
Add realtime git log viewer

Author
shingo · 2026-04-30 12:30

Parents
9e8f7a6

Refs
main, origin/main

Changed files
M src/App.tsx       +12 -3
A src/api/events.ts +84
M package.json      +1 -1

Actions
[Copy hash] [Copy git show] [Open diff]
```

---

## 4.4 Diff Viewer

diffは開発者が最も長く見る領域なので、視認性を最優先します。

```text
src/api/events.ts
────────────────────────────────────────
@@ -10,6 +10,11 @@ export function subscribe() {

  const source = new EventSource(url)

+ source.addEventListener("commit_added", onCommitAdded)
+ source.addEventListener("ref_updated", onRefUpdated)
+ source.addEventListener("history_rewritten", onHistoryRewritten)
+
  return () => source.close()
}
```

### Diff表示ルール

| 要素          | 仕様                  |
| ----------- | ------------------- |
| 追加行         | green系背景 + `+`記号    |
| 削除行         | red系背景 + `-`記号      |
| 変更行         | amber系マーカー          |
| コンテキスト行     | muted text          |
| ファイルヘッダー    | sticky              |
| 行番号         | mono / low contrast |
| 長い行         | wrap切替可能            |
| binary file | 専用empty state       |
| huge diff   | 折りたたみ + load more   |

赤/緑だけでは色覚差に弱いため、必ず記号・ラベル・背景差を併用します。

---

# 5. インタラクション設計

## 5.1 Realtime Update

新規コミットが入っても、現在読んでいる位置を壊さないことを最優先にします。

### 先頭を見ている場合

```text
新規commitを自然に挿入
軽いhighlight
graph laneを更新
```

### 過去ログを読んでいる場合

```text
3 new commits on main
[Show updates]
```

クリック後に先頭へ反映します。

### 履歴書き換えの場合

```text
⚠ main history was rewritten

old: 9e8f7a6
new: 2b3c4d5

This may be caused by rebase, reset, or force push.

[Reload timeline] [Compare old/new] [Dismiss]
```

このアラートはtoastではなく、タイムライン上部の固定バナーにします。
理由は、履歴書き換えは一時通知ではなく、ログの信頼性に関わる状態だからです。

---

## 5.2 Command Palette

ショートカット:

```text
macOS: Cmd + K
Windows/Linux: Ctrl + K
```

表示例:

```text
┌────────────────────────────────────────────┐
│ > checkout main                            │
├────────────────────────────────────────────┤
│ Branch: main                               │
│ Branch: develop                            │
│ Search commits by "checkout main"          │
│ Copy current commit hash                   │
│ Toggle compact mode                        │
│ Toggle live mode                           │
└────────────────────────────────────────────┘
```

Command Paletteは `Dialog + Combobox/Listbox` として扱います。WAI-ARIA APGのComboboxパターンでは、Down/Up、Enter、Escapeなどのキーボード動作が定義されています。([W3C][9])
キーボードショートカットは支援技術やブラウザショートカットと衝突しないよう、表示・変更・無効化を可能にします。WAI-ARIA APGもショートカットの割り当てと開示についてガイダンスを示しています。([W3C][10])

---

## 5.3 Density Modes

開発者ツールでは情報密度の好みが分かれるため、3段階用意します。

| Mode        | 用途           | Row height |
| ----------- | ------------ | ---------: |
| Comfortable | 初期設定、読みやすさ重視 |       72px |
| Compact     | 日常利用         |       56px |
| Dense       | 大量ログ監視       |       40px |

ただしDenseでも、クリック可能要素は最小ターゲットサイズを下回らないようにします。

---

## 5.4 View Transition

画面遷移や詳細ペインの切替には、短いトランジションを入れます。
View Transition API は、SPAやMPAのビュー間アニメーションを簡単に作る仕組みとして説明されており、ユーザーが文脈を保ちやすくする用途に向いています。([MDNウェブドキュメント][11])

RefScopeでは以下に限定して使います。

```text
- commit detail panel open/close
- branch switch
- search result transition
- command palette open
```

diff本文のような大量テキスト領域には過剰なアニメーションを入れません。

---

# 6. ビジュアルデザイン

## 6.1 トーン

```text
Base:         graphite / near black
Accent:       cyan-blue
Git Added:    green
Git Deleted:  red
Warning:      amber
Merge:        violet
Tag:          teal
Selected:     accent glow
```

全体は **dark-first**。
ただし、light themeとhigh contrast themeも初期からサポートします。

---

## 6.2 カラーパレット

### Dark Theme

| Token                  |                  Value | 用途                  |
| ---------------------- | ---------------------: | ------------------- |
| `color.bg.canvas`      | `oklch(16% 0.015 255)` | アプリ背景               |
| `color.bg.panel`       | `oklch(20% 0.018 255)` | サイドバー・詳細            |
| `color.bg.elevated`    |  `oklch(24% 0.02 255)` | popover/dialog      |
| `color.border.default` | `oklch(34% 0.025 255)` | 通常境界                |
| `color.text.primary`   | `oklch(92% 0.015 255)` | 本文                  |
| `color.text.secondary` |  `oklch(72% 0.02 255)` | 補助情報                |
| `color.text.muted`     |  `oklch(55% 0.02 255)` | muted               |
| `color.accent.default` |  `oklch(72% 0.14 235)` | 選択・リンク              |
| `color.git.added`      |  `oklch(72% 0.14 150)` | 追加                  |
| `color.git.deleted`    |   `oklch(70% 0.16 25)` | 削除                  |
| `color.git.modified`   |   `oklch(78% 0.15 80)` | 変更                  |
| `color.git.merge`      |  `oklch(74% 0.15 285)` | merge               |
| `color.warning`        |   `oklch(78% 0.16 75)` | rebase/force push警告 |

### Light Theme

| Token                  |                  Value |
| ---------------------- | ---------------------: |
| `color.bg.canvas`      | `oklch(98% 0.008 255)` |
| `color.bg.panel`       |  `oklch(96% 0.01 255)` |
| `color.bg.elevated`    |      `oklch(100% 0 0)` |
| `color.border.default` | `oklch(84% 0.018 255)` |
| `color.text.primary`   |  `oklch(20% 0.02 255)` |
| `color.text.secondary` | `oklch(42% 0.025 255)` |
| `color.text.muted`     |  `oklch(58% 0.02 255)` |

---

## 6.3 タイポグラフィ

| 用途                    | Font                          | Size | Weight |
| --------------------- | ----------------------------- | ---: | -----: |
| App Title             | Inter / system-ui             | 15px |    600 |
| Body                  | Inter / system-ui             | 13px |    400 |
| Metadata              | Inter / system-ui             | 12px |    400 |
| Commit hash           | JetBrains Mono / ui-monospace | 12px |    500 |
| Diff body             | JetBrains Mono / ui-monospace | 12px |    400 |
| Section title         | Inter / system-ui             | 12px |    600 |
| Command palette input | Inter / system-ui             | 15px |    400 |

日本語表示を想定する場合:

```css
font-family:
  Inter,
  "Noto Sans JP",
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  sans-serif;
```

コード領域:

```css
font-family:
  "JetBrains Mono",
  "SFMono-Regular",
  "Cascadia Code",
  "Roboto Mono",
  ui-monospace,
  monospace;
```

---

## 6.4 スペーシング

4pxベースのスケールを採用します。

| Token      | Value |
| ---------- | ----: |
| `space.0`  |     0 |
| `space.1`  |   4px |
| `space.2`  |   8px |
| `space.3`  |  12px |
| `space.4`  |  16px |
| `space.5`  |  20px |
| `space.6`  |  24px |
| `space.8`  |  32px |
| `space.10` |  40px |
| `space.12` |  48px |

---

## 6.5 Radius

| Token         |  Value | 用途             |
| ------------- | -----: | -------------- |
| `radius.xs`   |    4px | badge          |
| `radius.sm`   |    6px | input          |
| `radius.md`   |    8px | button/card    |
| `radius.lg`   |   12px | dialog         |
| `radius.xl`   |   16px | dashboard card |
| `radius.full` | 9999px | pill/status    |

---

## 6.6 Shadow / Elevation

ダークUIでは強い影よりも、境界線と背景階層で深度を出します。

| Token                 | 用途                      |
| --------------------- | ----------------------- |
| `shadow.focus`        | focus ring              |
| `shadow.popover`      | command palette / menu  |
| `shadow.panel`        | detail drawer           |
| `shadow.glow.accent`  | selected commit         |
| `shadow.glow.warning` | history rewritten alert |

---

## 6.7 Motion

| Motion               | Duration | Easing                   |
| -------------------- | -------: | ------------------------ |
| Hover                |     80ms | ease-out                 |
| Press                |     60ms | ease-out                 |
| Panel open           |    160ms | cubic-bezier(.2,.8,.2,1) |
| Command palette      |    120ms | ease-out                 |
| New commit highlight |   1200ms | fade                     |
| Warning pulse        |   1800ms | subtle                   |

重要な原則:

```text
- diff本文は動かさない
- live updateは控えめにhighlight
- 履歴書き換えはmotionより明示的な警告文を優先
- prefers-reduced-motion を尊重
```

---

# 7. デザイントークン設計

## 7.1 トークン階層

```text
Primitive Tokens
  ↓
Semantic Tokens
  ↓
Component Tokens
```

### Primitive Tokens

生の色や数値。

```text
primitive.neutral.950
primitive.blue.500
primitive.green.500
primitive.space.4
primitive.radius.md
```

### Semantic Tokens

意味を持つトークン。

```text
color.bg.canvas
color.text.primary
color.git.added
color.status.warning
```

### Component Tokens

コンポーネント専用。

```text
component.commitCard.bg.default
component.commitCard.bg.selected
component.diffLine.bg.added
component.sidebar.width.default
```

---

## 7.2 Token JSON例

```json
{
  "color": {
    "bg": {
      "canvas": {
        "$type": "color",
        "$value": "oklch(16% 0.015 255)"
      },
      "panel": {
        "$type": "color",
        "$value": "oklch(20% 0.018 255)"
      },
      "elevated": {
        "$type": "color",
        "$value": "oklch(24% 0.02 255)"
      }
    },
    "text": {
      "primary": {
        "$type": "color",
        "$value": "oklch(92% 0.015 255)"
      },
      "secondary": {
        "$type": "color",
        "$value": "oklch(72% 0.02 255)"
      },
      "muted": {
        "$type": "color",
        "$value": "oklch(55% 0.02 255)"
      }
    },
    "git": {
      "added": {
        "$type": "color",
        "$value": "oklch(72% 0.14 150)"
      },
      "deleted": {
        "$type": "color",
        "$value": "oklch(70% 0.16 25)"
      },
      "modified": {
        "$type": "color",
        "$value": "oklch(78% 0.15 80)"
      },
      "merge": {
        "$type": "color",
        "$value": "oklch(74% 0.15 285)"
      }
    }
  },
  "space": {
    "1": { "$type": "dimension", "$value": "4px" },
    "2": { "$type": "dimension", "$value": "8px" },
    "3": { "$type": "dimension", "$value": "12px" },
    "4": { "$type": "dimension", "$value": "16px" }
  },
  "radius": {
    "sm": { "$type": "dimension", "$value": "6px" },
    "md": { "$type": "dimension", "$value": "8px" },
    "lg": { "$type": "dimension", "$value": "12px" }
  }
}
```

---

## 7.3 CSS Variables出力例

```css
:root {
  --rs-color-bg-canvas: oklch(16% 0.015 255);
  --rs-color-bg-panel: oklch(20% 0.018 255);
  --rs-color-bg-elevated: oklch(24% 0.02 255);

  --rs-color-text-primary: oklch(92% 0.015 255);
  --rs-color-text-secondary: oklch(72% 0.02 255);
  --rs-color-text-muted: oklch(55% 0.02 255);

  --rs-color-accent: oklch(72% 0.14 235);

  --rs-color-git-added: oklch(72% 0.14 150);
  --rs-color-git-deleted: oklch(70% 0.16 25);
  --rs-color-git-modified: oklch(78% 0.15 80);
  --rs-color-git-merge: oklch(74% 0.15 285);

  --rs-space-1: 4px;
  --rs-space-2: 8px;
  --rs-space-3: 12px;
  --rs-space-4: 16px;

  --rs-radius-sm: 6px;
  --rs-radius-md: 8px;
  --rs-radius-lg: 12px;
}
```

---

# 8. コンポーネント設計

## 8.1 Foundation Components

| Component    | 用途                      |
| ------------ | ----------------------- |
| `Button`     | 基本ボタン                   |
| `IconButton` | hash copy, panel toggle |
| `Input`      | search/filter           |
| `Select`     | repo/branch選択           |
| `Badge`      | branch/tag/status       |
| `Tooltip`    | hash, shortcuts         |
| `Popover`    | filter menu             |
| `Dialog`     | command palette         |
| `Tabs`       | detail切替                |
| `Toast`      | 軽微な通知                   |
| `Banner`     | 重要通知                    |
| `Skeleton`   | 読み込み                    |
| `Spinner`    | fetch中                  |
| `Separator`  | panel分割                 |

---

## 8.2 Product Components

| Component             | 役割                      |
| --------------------- | ----------------------- |
| `AppShell`            | 全体レイアウト                 |
| `TopBar`              | repo/branch/search/live |
| `RepositorySwitcher`  | repo切替                  |
| `BranchSidebar`       | branch/tag/remotes      |
| `CommitTimeline`      | commit一覧                |
| `CommitCard`          | 1 commit表示              |
| `CommitGraphRail`     | graph lane              |
| `LiveUpdateBanner`    | 新規commit通知              |
| `HistoryRewriteAlert` | force push/rebase警告     |
| `CommitDetailPanel`   | commit詳細                |
| `FileChangeList`      | 変更ファイル一覧                |
| `DiffViewer`          | diff表示                  |
| `CommandPalette`      | 操作検索                    |
| `FilterBuilder`       | 高度検索                    |
| `StatusBar`           | fetch状態/HEAD表示          |
| `AISummaryPanel`      | AI要約                    |

---

# 9. 主要コンポーネント詳細

## 9.1 CommitCard

### Anatomy

```text
┌────────────────────────────────────────────┐
│ graph │ hash     subject              tag  │
│       │ author · time · branch             │
│       │ +12 -3 · 4 files                   │
└────────────────────────────────────────────┘
```

### States

| State     | 表現                        |
| --------- | ------------------------- |
| default   | 通常背景                      |
| hover     | 背景を少し明るく                  |
| selected  | accent border + left glow |
| new       | subtle pulse highlight    |
| merge     | merge icon + violet badge |
| signed    | shield icon               |
| stale     | opacity down              |
| rewritten | warning outline           |
| loading   | skeleton                  |

### Interaction

```text
Click: detail open
Shift+Click: range select
Right click: context menu
C: copy hash
Enter: open detail
Space: preview
```

---

## 9.2 CommitGraphRail

Git graphは視覚的に楽しい要素ですが、MVPでは読みやすさを優先します。

### 仕様

```text
- 最大表示lane数: 8
- laneが多い場合は折りたたみ
- mainlineを最左に固定
- selected branchを強調
- merge commitは合流線を太めに表示
- force rewrite後の切断はwarning dashed line
```

---

## 9.3 LiveUpdateBanner

```text
3 new commits on main
[Show updates] [Pause live]
```

### ルール

| 条件          | 表示                         |
| ----------- | -------------------------- |
| 新規commit 1件 | `1 new commit`             |
| 複数commit    | `N new commits`            |
| 別branch     | `N new commits on develop` |
| fetch中      | `Checking updates...`      |
| 接続断         | `Realtime connection lost` |

---

## 9.4 HistoryRewriteAlert

```text
⚠ main history was rewritten

old HEAD: 9e8f7a6
new HEAD: a1b2c3d

Possible causes:
rebase, reset, force push

[Reload timeline] [Compare old/new] [View reflog]
```

### Design

```text
background: warning subtle
border: warning
icon: alert triangle
position: timeline top sticky
dismiss: possible, but status remains in sidebar
```

---

## 9.5 DiffViewer

### Anatomy

```text
FileHeader
  path
  status
  additions/deletions
  actions

HunkHeader
  @@ -10,6 +10,11 @@

DiffLine
  line number old
  line number new
  marker
  content
```

### States

| State         | 表現                      |
| ------------- | ----------------------- |
| added         | green subtle bg + `+`   |
| deleted       | red subtle bg + `-`     |
| context       | transparent             |
| hunk          | sticky muted bg         |
| selected line | accent outline          |
| search match  | yellow highlight        |
| copied        | temporary success badge |

---

## 9.6 CommandPalette

### 検索対象

```text
- repositories
- branches
- tags
- commits
- files
- commands
- filters
- saved views
```

### コマンド例

```text
Switch branch: main
Search author: shingo
Show only merge commits
Copy selected hash
Toggle compact mode
Toggle live mode
Open current commit in terminal
Explain selected diff
```

---

# 10. 画面状態設計

## 10.1 Empty State

```text
No commits found

Try changing filters or selecting another branch.

[Clear filters]
```

---

## 10.2 Loading State

```text
Skeleton rows
Graph rail placeholder
Detail panel skeleton
```

初期読み込みではspinnerだけにしない。
コミットリストの形を先に見せます。

---

## 10.3 Error State

```text
Could not read repository

Reason:
fatal: not a git repository

[Retry] [Open settings]
```

エラーはGitコマンドの生ログをそのまま出しすぎず、詳細は折りたたみにします。

---

## 10.4 Offline / Disconnected

```text
Realtime disconnected
Showing cached history

[Reconnect]
```

ステータスバーにも表示します。

---

# 11. アクセシビリティ仕様

## 11.1 Keyboard Map

| Key            | Action             |
| -------------- | ------------------ |
| `Cmd/Ctrl + K` | Command Palette    |
| `J`            | next commit        |
| `K`            | previous commit    |
| `Enter`        | open commit detail |
| `Esc`          | close panel/dialog |
| `C`            | copy selected hash |
| `/`            | focus search       |
| `F`            | open filter        |
| `B`            | focus branch list  |
| `D`            | focus diff         |
| `L`            | toggle live mode   |

---

## 11.2 ARIA

```text
CommitTimeline:
  role="list"

CommitCard:
  role="listitem"
  aria-current="true" when selected

LiveUpdateBanner:
  aria-live="polite"

HistoryRewriteAlert:
  role="alert"

CommandPalette:
  role="dialog"
  input role="combobox"
  results role="listbox"
```

---

## 11.3 Color Contrast

設計ルール:

```text
- 本文テキストは AA 以上
- 補助テキストも可能な限り AA
- graph lane colorは色だけに依存しない
- diff added/deletedは記号と背景を併用
- focus ringは背景との差を明確にする
```

---

# 12. レスポンシブ設計

## Desktop

```text
3ペイン固定
timeline中央
detail右
```

## Narrow Desktop

```text
sidebar collapsible
detail panel resizable
```

## Tablet

```text
sidebar drawer
detail bottom sheet
```

## Mobile

```text
single column
commit detailは別画面
diffは横スクロール + wrap toggle
```

---

# 13. Figma構成

```text
RefScope Design System
├─ 00 Foundations
│  ├─ Color
│  ├─ Typography
│  ├─ Spacing
│  ├─ Radius
│  ├─ Shadow
│  └─ Motion
│
├─ 01 Components
│  ├─ Button
│  ├─ Input
│  ├─ Select
│  ├─ Badge
│  ├─ Dialog
│  ├─ Tabs
│  └─ Tooltip
│
├─ 02 Product Components
│  ├─ CommitCard
│  ├─ CommitTimeline
│  ├─ CommitGraphRail
│  ├─ DiffViewer
│  ├─ BranchSidebar
│  └─ CommandPalette
│
├─ 03 Patterns
│  ├─ Realtime Update
│  ├─ History Rewrite
│  ├─ Search & Filter
│  ├─ Empty State
│  └─ Error State
│
└─ 04 Screens
   ├─ Dashboard
   ├─ Repository Workbench
   ├─ Commit Detail
   ├─ Diff Focus Mode
   └─ Mobile
```

---

# 14. Storybook構成

```text
Foundation
  Button
  Input
  Badge
  Dialog
  Tooltip

Git
  CommitCard
  CommitTimeline
  CommitGraphRail
  DiffViewer
  FileChangeList

Patterns
  LiveUpdateBanner
  HistoryRewriteAlert
  CommandPalette
  FilterBuilder

Screens
  RepositoryWorkbench
  Dashboard
  DiffFocusMode
```

各Storyには以下を持たせます。

```text
- default
- hover
- selected
- loading
- empty
- error
- dark
- light
- high contrast
- compact
- dense
```

---

# 15. 実装向けCSS設計

## 15.1 Class Naming

```text
rs-app-shell
rs-topbar
rs-sidebar
rs-timeline
rs-commit-card
rs-commit-card__hash
rs-commit-card__subject
rs-diff-viewer
rs-diff-line
rs-diff-line--added
rs-diff-line--deleted
```

## 15.2 Component CSS例

```css
.rs-commit-card {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: var(--rs-space-3);
  min-height: 56px;
  padding: var(--rs-space-2) var(--rs-space-3);
  border-radius: var(--rs-radius-md);
  background: transparent;
  color: var(--rs-color-text-primary);
}

.rs-commit-card:hover {
  background: color-mix(
    in oklab,
    var(--rs-color-bg-panel),
    var(--rs-color-accent) 8%
  );
}

.rs-commit-card[data-selected="true"] {
  background: color-mix(
    in oklab,
    var(--rs-color-bg-panel),
    var(--rs-color-accent) 14%
  );
  box-shadow: inset 2px 0 0 var(--rs-color-accent);
}

.rs-commit-card:focus-visible {
  outline: 2px solid var(--rs-color-accent);
  outline-offset: 2px;
}
```

---

# 16. AI機能のUI設計

AIは「常時チャット」ではなく、**文脈に応じた補助パネル**として扱います。

## AI Summary Panel

```text
AI Summary
────────────────────────
This commit adds SSE-based realtime updates.

Impact
- src/api/events.ts
- src/hooks/useGitEvents.ts

Risk
Medium

Why
Touches realtime subscription and reconnect logic.
```

## AI表示ルール

```text
- AI生成であることを明示
- 確定情報と推測を分ける
- riskは断定しない
- diff本文へのリンクを出す
- 長文より箇条書き
- 自動表示ではなくユーザー操作で展開
```

---

# 17. デザイン原則

## Principle 1: Preserve Context

リアルタイム更新でユーザーの読んでいる位置を壊さない。

## Principle 2: Make Git State Explicit

branch、HEAD、remote、tag、rewrite状態を曖昧にしない。

## Principle 3: Prefer Dense but Calm

情報密度は高く、装飾は静かに。

## Principle 4: Keyboard First

クリックよりもキーボード操作を優先設計する。

## Principle 5: Never Rely on Color Alone

diff、status、warningは必ず形・記号・ラベルを併用する。

## Principle 6: Design for Rewrites

Git履歴は変わる。UIもそれを前提にする。

---

# 18. MVPデザイン範囲

## MVPに含める

```text
- dark theme
- repository workbench
- branch sidebar
- commit timeline
- simple graph rail
- commit detail
- file change list
- diff viewer
- live update banner
- history rewrite alert
- command palette
- compact mode
```

## v1.1以降

```text
- light theme
- high contrast theme
- AI summary
- saved filters
- dashboard
- advanced graph
- blame view
- PR/Issue連携
- team presence
```

---

# 19. 最終デザインイメージ

```text
RefScope
Git history, live and readable.

┌──────────────────────────────────────────────────────────────┐
│ frontend-app  main ▼   Search commits, files, authors...  ● │
├───────────────┬──────────────────────────────┬───────────────┤
│ BRANCHES      │ 2 new commits                │ COMMIT        │
│ ● main        │ [Show updates]               │ a1b2c3d        │
│   develop     │                              │               │
│   feature/ui  │  ● a1b2c3d Add realtime UI   │ Add realtime  │
│               │  │ shingo · 2m ago           │ Git log viewer│
│ TAGS          │  ● 9e8f7a6 Refactor parser   │               │
│ v2.1.0        │  │ tanaka · 14m ago          │ FILES         │
│               │  ├─● 7d6c5b4 Add graph rail  │ M App.tsx     │
│ ALERTS        │  │                           │ A events.ts   │
│ ⚠ rewritten   │  ● 4c3b2a1 Merge feature     │               │
│               │                              │ DIFF          │
│               │                              │ + useEvents() │
└───────────────┴──────────────────────────────┴───────────────┘
```

---

# 20. まとめ

RefScopeのUIは、以下の方向で設計します。

```text
Visual:
  dark-first developer cockpit

Layout:
  3-pane workbench

Interaction:
  realtime but non-disruptive

Design System:
  token-first, Figma Variables compatible, CSS variables output

Components:
  headless + composable + accessible

Trends:
  AI-ready design system
  command-first UX
  density modes
  OKLCH color
  adaptive themes
  WCAG 2.2 conscious accessibility

Core UX:
  commit timeline
  branch graph
  diff viewer
  history rewrite alert
```

この設計では、単なる「きれいなgit log」ではなく、**リアルタイムに変化するGit履歴を、開発者が安全に読み解くためのUI**として成立させます。

[1]: https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/ "Design Tokens specification reaches first stable version | Design Tokens Community Group"
[2]: https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma "Guide to variables in Figma – Figma Learn - Help Center"
[3]: https://www.figma.com/blog/schema-2025-design-systems-recap/ "Schema 2025: Design Systems For A New Era | Figma Blog"
[4]: https://www.atlassian.com/blog/design/turning-handoffs-into-handshakes-integrating-design-systems-for-ai-prototyping-at-scale "Turning Handoffs into Handshakes: Integrating Design Systems for AI Prototyping at Scale - Work Life by Atlassian"
[5]: https://www.w3.org/TR/WCAG22/ "Web Content Accessibility Guidelines (WCAG) 2.2"
[6]: https://www.radix-ui.com/primitives/docs/overview/accessibility "Accessibility – Radix Primitives"
[7]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/oklch "oklch() CSS function - CSS | MDN"
[8]: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color-mix "color-mix() CSS function - CSS | MDN"
[9]: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/ " Combobox Pattern | APG | WAI | W3C"
[10]: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/ " Developing a Keyboard Interface | APG | WAI | W3C"
[11]: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API "View Transition API - Web APIs | MDN"
