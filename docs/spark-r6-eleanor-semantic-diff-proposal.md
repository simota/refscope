# Spark Proposal: Structural Diff View for Behavior-Preservation Claims (Refscope)

> Synthetic demand source: `docs/user-demand-report-2026-05-07-r6.md` — Eleanor (Reviewer/Architect, 8y OSS maintainer)
> `synthetic: true` — このドキュメントは Plea が生成した合成ユーザー需要に基づく仮説提案であり、実ユーザー検証前の提案である。
> 上位エージェント: Plea (synthetic user advocate) → Spark (this document) → Researcher / Architecture Review (next).
> ロードマップ位置: **v2 以降の候補 (Architecture Review 後に判断)**。Option A は既存 log/diff 範囲内で着手可能。Option B/C は外部依存追加を伴うため Architecture Review 必須。

---

## §0 Summary

- **対象ペルソナ:** Eleanor（Reviewer/Architect, OSS メンテナ歴 8 年。"pure refactor" タグ付き PR を週 5-6 本レビュー、そのうち 2 割が実際には振る舞いを変えている）
- **解こうとしている JTBD:** 「"rename だけ" と称する PR が本当に制御フローや型シグネチャを変えていないことを、git の文字列 diff よりも認知負荷を下げた方法で確認する」
- **現状の死角:** 既存 diff ビューは文字列レベルの差分のみ。フォーマット変更・空白変更・コメント変更が混在していると、意味のある変更を見落とす（false negative）か過剰に疑う（false positive）かの両方が起きる。
- **提案:** `StructuralDiffBadge` — コミット diff ビューに構造的等価性のバッジと分類パネルを追加する。
- **Options:**
  - **A (言語非依存ヒューリスティクス, 推奨):** 行対称性・空白/コメント正規化・トークン保存率で「おそらくリファクタ」「変更含む」をラベリング。外部依存なし、既存 log/diff allowlist 内で完結。
  - **B (tree-sitter AST diff):** 主要言語 4-6 種を tree-sitter で構文解析し AST 差分を取得。外部依存追加、**Architecture Review 要。**
  - **C (B + 制御フロー/呼び出しグラフ):** B を基盤に CFG/call-graph の変化まで抽出。Scope creep flag。
- **推奨:** **Option A** を先行着手。構造的近似でレビュアーの認知負荷を下げる第一段階とし、A で検証後に B/C を判断する。
- **gitRunner allowlist 変更:** Option A では不要。B/C は API 外処理が必要（Architecture Review 範囲）。
- **「意味的等価」は主張しない。** 本提案全体を通じて「構造的等価 (structurally equivalent)」または「構造的近似」に表現を限定する。

---

## §1 Context Read

### 1.1 参照ファイル

| 参照 | 用途 |
|---|---|
| `CLAUDE.md` | gitRunner は `cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show` のみ許可。`shell: false`, `--no-pager`, GIT_* スクラブ。新コマンド追加禁止。外部プロセス直接呼び出し禁止。 |
| `apps/api/src/gitService.js` | `getDiff` / `getCommit` は既に `--find-renames`, `--no-show-signature`, `--no-ext-diff`, `--no-textconv` を使用。`numstat` で行単位の追加/削除数を取得済み。`scoreDiff` 関数はファイル単位の added/deleted を受け取り整数スコアを返す純粋関数（既存実装）。 |
| `docs/spec-v0.md` | ローカル単独動作、依存最小、read-only 哲学。 |
| `docs/user-demand-report-2026-05-07-r6.md` Request 5 | Eleanor の AC 3 つ: フォーマット/空白/コメント変更を separate に表示、AST 差分でハイライト（言語別）、「意味等価 / シグネチャ変更 / 制御フロー変更」分類。 |
| `apps/ui/src/app/App.tsx` (推定) | 単一 state owner。DetailPanel への props 配布パターンを踏襲。 |

### 1.2 観察データ (observed facts) として確定的に得られるもの

`gitService.js` の現在実装から literal に得られる観察データ:

- `file.added` / `file.deleted` (numstat — ファイル単位の行追加/削除数)
- diff patch text（`git show` / `git diff` output、`--unified=N` で context 調整可）
- ファイルの拡張子（パス文字列から literal に抽出）
- rename status: `R<NN>\told\tnew`（Git が literal に報告する similarity %）
- `--word-diff=porcelain` または `--word-diff=plain` で得られる単語単位の差分（git 機能、追加 spawn 引数のみ）

### 1.3 派生 (inferred / interpreted) として明示すべきもの

以下は観察ではなく Refscope が計算・推定する派生値：

- **行対称性スコア:** `|added - deleted| / max(added, deleted)` の比率。"対称" が = "構造的等価" ではない — あくまで近似指標。
- **空白/コメント除去後の差分:** Refscope がパッチを正規化した結果。「Git が報告した差分」から Refscope が計算した二次情報。
- **トークン保存率:** 変更前後の識別子集合の重複度。Refscope の計算。
- **構造的等価ラベル:** 上記 3 指標の合成による分類。確率的な推定であり、正確性を保証しない。UI では「おそらく構造的リファクタ (heuristic)」と派生ラベルを明記。
- **AST 差分 (Option B/C):** tree-sitter が計算したノード差分。「意味等価性」ではなく「構文ノードレベルでの等価性」に限定。

### 1.4 観察 vs 派生の分離原則

本提案では `spark-tomo-file-history-proposal.md` と同じ透明性原則を踏襲する：
- 観察: Git が直接出力した値を Refscope は転記する。
- 派生: Refscope が計算・集計した値には必ずラベル `(heuristic)` / `(Git literal)` を UI に明示し、ユーザーが「どちらを見ているか」を区別できるようにする。

---

## §2 Outcome Solution Tree (OST)

```
Outcome:
  Eleanor が "pure refactor" タグ付き PR を approve するときに
  「この変更は制御フローを変えていないか」を確信するまでの時間を短縮する
  (KPI: diff ビューで "structural" バッジを確認した後の approve 判断時間、
   false negative 報告件数、ツール信頼スコア)
   │
   ├─ Opportunity 1: フォーマット/空白/コメント変更が本質的な差分を埋もれさせる
   │     └─ Solution: whitespace-only / comment-only diff を別カテゴリに分離表示
   │
   ├─ Opportunity 2: 行追加=削除対称なコミットと非対称なコミットが混在してわかりにくい
   │     └─ Solution: ファイル単位に "対称 / 非対称" バッジを付与 (Option A ヒューリスティクス)
   │
   ├─ Opportunity 3: どの変更が "構造的に重い" かを一覧で把握できない
   │     └─ Solution: コミット diff 一覧のファイルリストに structural change indicator を表示
   │
   └─ Opportunity 4: 言語構文レベルで "同じか違うか" を確認したい
         └─ Solution: tree-sitter AST diff (Option B — Architecture Review 後)
```

---

## §3 Hypothesis

### 3.1 メインの仮説

> 「コミット diff ビューに (a) whitespace/comment-only diff の分離表示と (b) 行対称性・トークン保存率に基づく構造的リファクタバッジを追加すれば、Eleanor のような経験豊富なレビュアーが "これは振る舞いを変えていない" を確認するまでのスキャン時間を、純粋な文字列 diff と比べて有意に短縮できる」

### 3.2 カバレッジ見積もり

| カテゴリ | 言語非依存ヒューリスティクスでカバーできる割合（推定） | AST が必要な残り（推定）|
|---|---|---|
| 空白/インデント変更のみ | ~95% 検出可 | ~5% (タブ/スペース混在、ファイル末尾のみ異なるケース) |
| コメント追加/削除のみ | ~85% 検出可 (`#`, `//`, `/* */` パターン正規化) | ~15% (言語特有コメント構文、doc-comment の誤判定リスク) |
| 変数/関数リネームのみ | ~60% 検出可 (トークン保存率が高く行対称) | ~40% (型注釈変更を伴うリネーム、スコープ変化を伴うもの) |
| ロジック変更含む | ~80% で「非対称」として正しく検出 | ~20% は対称に見えて if 条件が反転するなどの subtle な変更 |
| 制御フロー/呼び出し順変更 | ~30% 程度（構造的な手がかりが少ない） | ~70% (AST/CFG が必要) |

**Hypothesis サマリ:** 言語非依存ヒューリスティクス (Option A) は「明らかなリファクタ」と「明らかなロジック変更」の 70-80% を適切に分類できると推定するが、if 条件反転・引数順変更・型シグネチャ変更といった subtle な変更は AST なしでは検出困難。Option A は認知負荷削減の第一段階として有効だが、false negative を 0 にはできない。その限界を UI で明示することが受入条件。

### 3.3 KPI

| KPI | 観測方法（ローカル完結） | 目標値（synthetic） |
|---|---|---|
| K1: structural バッジを確認した後に approve したコミットで、後から「振る舞いが変わっていた」と報告された件数 | ユーザーフィードバック（定性） | 0 件（1 件で UI の信頼ラベルを強化、3 件で heuristic を default-off に縮退） |
| K2: whitespace-only diff の分離表示が有効化されている率 | ローカル設定フラグ | ≥ 70%（デフォルト有効なので、明示的に off にしないことを確認） |
| K3: structural バッジ付きファイルを含む diff の平均スキャン時間 | ローカル optional timer（精度低い、傾向のみ） | Option A 導入後に短縮傾向が確認できること |

### 3.4 Fail Condition

- 実ユーザー検証 (Researcher 経由) で「ヒューリスティクスの false negative が多すぎて信用できない」という感想が 3 名 / 5 名を超えた場合 → Option A の heuristic バッジを default-off にし、あくまで補助情報として opt-in 扱いに縮退。
- Option B (tree-sitter) の Architecture Review で「バンドルサイズが +N MB を超える」または「WASM 実行がローカル npx 起動で受け入れられない起動時間増加を引き起こす」と判断された場合 → Option B は採用しない。Option A のみでリリース。

---

## §4 Options

### Option A — 言語非依存ヒューリスティクス（推奨・外部依存なし）

#### 概要

diff パッチ文字列を Refscope のフロントエンド（または API の純粋関数）で正規化し、3 つのヒューリスティクスシグナルを計算する：

1. **行対称性:** `|added - deleted| / max(added, deleted)` が 0.1 以下なら "対称"
2. **whitespace/comment 除去後差分:** 行から行頭空白 + 一般コメントパターンを除去した後の diff が空なら "whitespace/comment-only"
3. **トークン保存率:** diff hunk 内の識別子トークン（`[A-Za-z_]\w*` パターン）の Jaccard 類似度が 0.85 以上なら "高保存率 = リネーム候補"

これら 3 シグナルを組み合わせてファイル単位に `structural-refactor` / `logic-change` / `whitespace-comment-only` / `indeterminate` の 4 カテゴリに分類する。

#### 哲学との整合性

- 外部依存追加: **なし**
- gitRunner allowlist 変更: **不要**（`--word-diff=porcelain` は既存 `diff` コマンドの追加引数として allowlist 内）
- ローカル npx 起動への影響: **なし**
- バンドルサイズ増: **最小**（正規表現処理のみ）

#### 透明性 UI

- 各ファイルバッジに `(heuristic — not guaranteed)` ツールチップを必須表示
- 「このラベルは行対称性・トークン保存率に基づく近似です。制御フロー変更の検出には AST が必要です」を折りたたみ可能な説明パネルで開示

#### Pros / Cons

- Pros: 依存最小哲学を完全維持。全言語に適用可。即着手可能。
- Cons: false negative が残る（特に if 条件反転・引数順変更）。"構造的等価" の保証はできない。レビュアーが信頼しすぎるリスク。

#### D-2 (refactor-only filter) との統合可能性

`docs/user-demand-report-2026-05-07-r6.md` Request 2（広志の「rename/move のみ vs ロジック変更含む」バッジ）はこの Option A の分類ロジックと **同一の計算基盤** を共有できる。コミット単位の集計として「全ファイルが structural-refactor または whitespace-only ならコミットバッジ = refactor-only」と集約することで D-2 フィルタを同時に実現できる。統合を推奨する。

---

### Option B — tree-sitter AST diff（Architecture Review 要）

#### 概要

Node.js から [tree-sitter](https://github.com/tree-sitter/tree-sitter) WASM バインディングを呼び出し、diff の before/after テキストを対象言語の CST（Concrete Syntax Tree）に解析して、ノードレベルの差分を取得する。

対応言語（最小スコープ案）: JavaScript / TypeScript, Python, Go, Rust, Ruby（4-6 言語）

取得できる情報:
- 関数シグネチャ変更（パラメータ名・型・順序）
- if/else/switch 条件式の変更
- return 文の変更
- 呼び出し式の差分（関数名・引数）

#### 哲学との緊張

| 観点 | 課題 |
|---|---|
| 外部依存 | tree-sitter WASM バインディング (`web-tree-sitter` または `node-tree-sitter`) + 各言語グラマーパッケージを追加。バンドルサイズは +2-8 MB 程度と推定。|
| ローカル npx 起動 | WASM ファイルを cli バンドルに含める必要あり。起動時のロード時間が増加。lazy load で軽減可能だが実測必要。|
| 保守コスト | 対応言語ごとにグラマーパッケージを維持。言語バージョンアップで CST が変わる。|
| 誤判定リスク | 構文エラーのあるファイル（WIP コミット）でパーサーが落ちた場合の fallback 設計が必要。|

#### Architecture Review フラグ

Option B を採用する前に以下を Architecture Review で判断する：
- `apps/cli/` のバンドル戦略と WASM の整合性
- tree-sitter WASM の起動コスト（cold start、npx 初回実行時）
- グラマーパッケージのライセンス（MIT の確認）
- 対応外言語の graceful fallback（Option A に自動フォールバック）
- API vs UI どちらで解析を行うか（API = Node.js で tree-sitter、UI = WASM）

#### 「意味等価」表現についての注記

Option B が提供するのは「CST ノードレベルでの等価性」に過ぎない。`a + b` と `b + a` は加算交換則で意味等価だが CST 上は異なる。本提案では "AST-structurally equivalent" を「構文ノードの差分がない」という意味に限定し、「意味的に等価」とは主張しない。

---

### Option C — B + 制御フロー / 呼び出しグラフ抽出（Scope creep flag）

#### 概要

Option B の CST 差分をさらに解析し、制御フローグラフ (CFG) および呼び出しグラフ (call graph) の変化を抽出する。`if` 条件の反転、ループの早期 `return`、呼び出し順の変更を視覚的にフラグする。

#### Scope creep 警告

CFG/call-graph 抽出は実質的な静的解析ツール（semgrep, ast-grep 等相当）の実装を意味する。refscope の「依存最小・ローカル動作・read-only」哲学に対する最大の逸脱。

- D-2 (refactor-only filter) との統合: Option C レベルであれば「ロジック変更を含む」の false negative をほぼゼロにできるが、実装コストと保守コストが大幅に増加する。
- **推奨しない。** Architecture Review で Option B を採用した後、実ユーザーデータで「CFG まで必要」という証拠が得られた場合のみ再検討する。

---

## §5 実装スケッチ（Option A）

### 5.1 API 側（純粋関数追加）

`apps/api/src/gitService.js` の `getDiff` 応答にファイル単位の分類フィールドを追加する。

```javascript
// apps/api/src/diffClassifier.js (新規 — 外部依存なし)

/**
 * ヒューリスティクスによる diff ファイル分類。
 * 観察データ: added, deleted, patch (git diff output)
 * 派生: structuralCategory (heuristic — not guaranteed)
 *
 * @param {{ added: number, deleted: number, patch: string }} fileDiff
 * @returns {{ category: 'whitespace-comment-only'|'structural-refactor'|'logic-change'|'indeterminate', signals: object }}
 */
export function classifyFileDiff({ added, deleted, patch }) {
  // Signal 1: whitespace/comment-only
  const normalizedLines = normalizePatch(patch);
  if (!normalizedLines.some(l => l.startsWith('+') || l.startsWith('-'))) {
    return { category: 'whitespace-comment-only', signals: { normalized: true } };
  }

  // Signal 2: 行対称性
  const max = Math.max(added, deleted, 1);
  const symmetry = 1 - Math.abs(added - deleted) / max;

  // Signal 3: トークン保存率
  const tokenSimilarity = computeTokenSimilarity(patch);

  if (symmetry >= 0.9 && tokenSimilarity >= 0.85) {
    return { category: 'structural-refactor', signals: { symmetry, tokenSimilarity } };
  }
  if (symmetry < 0.5 || tokenSimilarity < 0.5) {
    return { category: 'logic-change', signals: { symmetry, tokenSimilarity } };
  }
  return { category: 'indeterminate', signals: { symmetry, tokenSimilarity } };
}
```

`getDiff` のレスポンスに `structuralCategory` フィールドを追加（既存フィールドの破壊変更なし）。

### 5.2 UI 側（DetailPanel 拡張）

`apps/ui/src/app/components/refscope/DetailPanel.tsx` の diff ファイルリストに `StructuralBadge` コンポーネントを追加する。

```
┌─ DetailPanel (diff view) ────────────────────────────────────────────────┐
│ commit: abc1234  "chore: rename handler module"                           │
│                                                                           │
│ ┌── Files changed ──────────────────────────────────────────────────┐   │
│ │ handler.ts     +42 -42   [structural-refactor (heuristic)] ←新規  │   │
│ │ index.ts       +3  -3    [whitespace-comment-only]          ←新規  │   │
│ │ auth.ts        +10 -2    [logic-change]                     ←新規  │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│ ⓘ These labels are heuristic estimates based on line symmetry and token  │
│   preservation. They cannot guarantee behavioral equivalence.            │
│   [Learn more ▾]                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

- `logic-change` バッジは amber/orange 配色で視覚的に目立たせる
- `structural-refactor` バッジは muted gray（"問題なし" を主張しない中立色）
- 全バッジに `(heuristic)` サフィックスを必須表示

### 5.3 App.tsx への影響

- `getDiff` のレスポンスに新フィールドが追加されるのみ（既存 state 構造の変更なし）
- `DetailPanel` に `showStructuralBadge: boolean` プロップを追加し、App.tsx で `useState(true)` でデフォルト有効

---

## §6 Open Questions

1. `--word-diff=porcelain` は既存の gitRunner diff 呼び出しに追加可能か？ 既存 `--no-textconv` / `--no-ext-diff` との組み合わせでの出力安定性を確認する必要がある。

2. `classifyFileDiff` をどこで実行するか: API 側（Node.js、全リクエストで計算）か UI 側（ブラウザ、レンダリング時）か。diff サイズが大きい場合のパフォーマンス影響を評価する必要がある。

3. バイナリファイル（`added === -1` / `deleted === -1`）の扱い: `gitService.js` の `scoreDiff` と同様に `indeterminate` として即時返すで良いか？

4. `indeterminate` カテゴリのバッジ色/アイコンはどうすべきか: "不明" が多すぎると UI がノイジーになる。表示有無の閾値を設けるか？

5. Option B で tree-sitter を採用する場合、API 側（Node.js native binding）と UI 側（WASM）のどちらが refscope のアーキテクチャに適合するか。`apps/cli/` のバンドル戦略との整合性確認が必要。

6. `D-2 (refactor-only filter)` との統合タイミング: Option A の分類ロジックを先に実装し、それをコミット集計に転用する形で D-2 を実装するか、同時実装するか。

---

## §7 Assumptions

1. **`synthetic: true`** — 本提案は Plea が生成した合成ユーザー需要に基づく。「週 5-6 本の pure refactor PR のうち 2 割が振る舞いを変えている」という数値は Eleanor が主観的に述べた推測であり、実測値ではない。Researcher による real-user 検証前は仮説として扱う。

2. gitRunner の `diff` コマンドに `--word-diff=porcelain` を追加引数として渡すことは既存 allowlist 内で可能（`diff` は allowlist 済み）と想定する。`--no-index`, pager フラグなどの禁止フラグには含まれない。

3. diff patch テキストは現在の `getDiff` レスポンスに含まれると仮定する（未確認）。含まれない場合は `apps/api/src/gitService.js` の `getCommit` / `getDiff` 側の修正が必要。

4. 「構造的等価」の判定は確率的な近似であり、100% の精度を主張しない。UI での明示的な "heuristic" ラベルが受入条件。

5. Option A の計算量は問題にならないと仮定する（大型 diff でも正規表現処理は O(lines) オーダー）。実際のパフォーマンスは計測が必要。

6. refscope は現在 GPG/署名検証を意図的に行わない設計（`signed: false`, `--no-show-signature`）。本提案もこの設計を変更しない。

7. Option B/C は Architecture Review の結果次第で採用/不採用が決まる。本 RFC は Option A の先行着手を提案するものであり、B/C の採用を前提としない。

---

## §8 Hand-off

### 即時アクション（Option A — 依存追加なし）

**Builder / Scribe へ:** Option A の `classifyFileDiff` 純粋関数と `StructuralBadge` UI コンポーネントの実装スケッチ。`apps/api/src/` に `diffClassifier.js` を追加し、`apps/api/test/` に `node:test` ベースのユニットテストを追加する。

### 要 Researcher 検証

**Researcher へ:** 以下の仮説を real-user インタビューで検証する：
- 「ヒューリスティクスベースの構造的リファクタバッジは、Eleanor のような経験豊富なレビュアーの認知負荷を実際に下げるか？」
- 「false negative（logic-change を structural-refactor と誤分類）の頻度はレビュアーが許容できる範囲か？」
- 「`indeterminate` カテゴリが多すぎるとバッジへの信頼を損ねるか？」

### Architecture Review フラグ（Option B/C）

**Architecture Review 必須事項（Option B 採用前）:**
- tree-sitter WASM バインディングのバンドルサイズと cold start コストが `apps/cli/` npx 起動時に許容可能か
- 言語グラマーパッケージのライセンス確認（MIT/Apache のみ）
- 対応外言語（COBOL, Ruby, Kotlin 等）の graceful fallback 設計
- API 側 vs UI 側での解析責務の分離方針
- 「構造的等価」から「意味等価」への誤認リスクを UI がどう防ぐか

**Option C は Architecture Review 後に Option B の実績データが揃った段階でのみ再検討する。現時点では採用しない。**

### RICE スコア（Option A）

| 要素 | 値 | 根拠 |
|---|---|---|
| Reach | 3/quarter (Eleanor ペルソナ相当のレビュアー層) | synthetic 推定。OSS メンテナ・レビュー担当者の小規模セグメント |
| Impact | 2 (認知負荷削減・approve 確信度向上) | 高い主観的インパクト。false negative リスクで上限を抑える |
| Confidence | 30% | synthetic 需要、real-user 未検証 |
| Effort | 3 person-weeks (分類器 + UI + テスト + docs) | Option A のみ。Design+Test+保守込み |
| **RICE Score** | **(3 × 2 × 0.3) / 3 = 0.6** | Low — Researcher 検証後に再スコアリングを推奨 |

Impact-Effort 分類: **Big Bet**（潜在インパクト高・不確実性高・Effort 中）

---

> **推奨 Option: A（言語非依存ヒューリスティクス）**
> **Hypothesis 要約:** 行対称性・whitespace 正規化・トークン保存率の 3 シグナルで "明らかなリファクタ" と "明らかなロジック変更" の 70-80% を分類でき、レビュアーの認知負荷を下げる第一段階となるが、subtle な制御フロー変更（if 条件反転など）の検出には AST (Option B) が必要。
