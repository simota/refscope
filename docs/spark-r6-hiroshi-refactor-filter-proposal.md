# Spark Proposal: Refactor-Only Commit Filter (D-2)

> Synthetic demand source: `docs/user-demand-report-2026-05-07-r6.md` — 広志 (Senior Backend, 10y Go, mid-refactor on a 5k-line monolith)
> `synthetic: true` — このドキュメントは Plea が生成した合成ユーザー需要に基づく仮説提案であり、実ユーザー検証前の提案である。判定アルゴリズムの精度に関する主張はすべて確率的なものであり、「確実に refactor である」とは言わない。
> 上位エージェント: Plea (synthetic user advocate) → Spark (this document) → Researcher / Builder (next).
> ロードマップ位置: **v2 候補 (Quick Win 寄り)** — commit timeline 既存コンポーネントへのバッジ追加として、Option A は最小追加で AC を部分的に満たせる。

---

## §0 Summary

- **対象ペルソナ:** 広志（Senior Backend, 10 年 Go, レガシーモノリス分割中）
- **解こうとしている job-to-be-done:** 「47 コミットのリファクタブランチをレビュアーに出す前に、move/rename だけのコミットとロジック変更を含むコミットを視覚的に分けて確認したい」
- **現状の死角:** CommitTimeline はすべてのコミットを均一に表示する。`--diff-filter` / `--numstat` の情報はすでに API 経由で取得可能だが、UI 側でコミットの "refactor 度" を判定・表示する機能が存在しない。

### Options A / B / C

| Option | 概要 | 派生強度 | 推奨 |
|--------|------|----------|------|
| **A** | `--diff-filter=R,M` で rename/move ファイルのみのコミットにバッジ表示 | 0 — Git literal output のみ | 初回リリース向け |
| **B** | numstat 対称性ヒューリスティクス追加 (added ≈ deleted) + threshold 公開 | 中 — threshold は Refscope の派生 | 推奨 |
| **C** | B + AST 等価性 (tree-sitter 依存追加) — D-5 との統合判断が必要 | 高 | v2 以降、D-5 と合算判断 |

**推奨: Option B** — `--diff-filter` と `--numstat` は `log` allowlist 内で完結し、既存 `commitNumstatShowArgs` / `commitNameStatusShowArgs` を再利用できる。threshold を hover で公開することで「判定基準の透明化」要件を満たす。

**Hand-off:** Researcher で false positive/negative 許容率を実測検証 (Go / Python リポジトリの実リファクタ PR を 10-20 件サンプリング) → Confidence を上げてから Builder に渡す。

---

## §1 Context Read — 観察 vs 派生境界

### 参照ファイル

| 参照 | 用途 |
|------|------|
| `CLAUDE.md` | gitRunner allowlist: `cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show` — 追加不要 |
| `apps/api/src/gitService.js` | `commitNameStatusShowArgs` が `--diff-filter` / `--name-status` を使用済み; `commitNumstatShowArgs` が `--numstat` を使用済み。フィルタ判定に必要なデータはすでに `getCommit` レスポンスの `files` に含まれる |
| `apps/api/src/gitRunner.js` | ALLOWED_GIT_COMMANDS に `log`, `diff` 含む。`--diff-filter` は `diff` / `log` の安全なオプション |
| `apps/ui/src/app/App.tsx` | 単一 state owner。バッジ表示とフィルタ状態は App.tsx に追加し、子コンポーネント (CommitTimeline) に props として配布する |
| `docs/user-demand-report-2026-05-07-r6.md` §Request 2 | AC: バッジ表示・バッジフィルタ・hover 透明化 |

### 1.1 観察データ (Git literal output として確定的に得られるもの)

`git show --name-status` / `git log --name-status` が返す status code:

- `M\t<path>` — 内容変更あり (modified)
- `A\t<path>` — 追加 (added)
- `D\t<path>` — 削除 (deleted)
- `R<NN>\t<old>\t<new>` — rename, Git の similarity NN%
- `C<NN>\t<src>\t<new>` — copy

`git show --numstat` が返す数値:

- `<added>\t<deleted>\t<path>` — 追加・削除行数 (binary は "-")

これらは **Refscope の解釈なし**、Git が計算した観察値である。

### 1.2 派生 (Refscope が解釈・ラベル付けするもの)

- **「rename/move のみ」バッジの判定:** すべてのファイルが `R<NN>` または `D + A` (rename 等価) であるコミットを "rename-only" と分類する。これは Refscope の分類ロジックであり、Git が "rename-only" とは言っていない。
- **「ロジック変更なし (structural-only)」バッジの判定 (Option B):** numstat の added ≈ deleted (対称性 threshold 内) かつ diff-filter に M が含まれていても、そのコードが意味的に等価かどうかは **判定できない**。Refscope は「行数の対称性」という構造ヒューリスティクスで分類するが、false positive (実は振る舞い変更あり) が必ず発生しうる。
- **Threshold 値:** Option B の対称性 threshold (例: added/deleted 比 ≤ 1.05) は Refscope が選ぶ派生値。

---

## §2 Opportunity Solution Tree (OST)

```
Outcome:
  広志が 47 コミットのリファクタブランチを PR に出す前に、
  「move/rename のみ」コミットと「ロジック変更含む」コミットを
  分けて確認でき、自信を持ってレビュアーに説明できる
  (KPI: refactor-filter 利用率, バッジ精度の false positive 率,
   PR 説明コスト変化 [定性])
   │
   ├─ Opportunity 1: すべてのコミットが均一に見えてレビュアーが疑問を持つ
   │     └─ Solution A: --diff-filter=R/M でバッジを付けて視覚的に分ける
   │
   ├─ Opportunity 2: rename-only でも「本当にロジック変わってない？」が残る
   │     └─ Solution B: numstat 対称性で "structural-only" の度合いを示す
   │                    + hover で判定根拠 (threshold, 実数値) を開示
   │
   ├─ Opportunity 3: 「判定基準が分からない」でレビュアーへの説明が増える
   │     └─ Solution: hover tooltip に Git literal output (diff-filter result,
   │                  added/deleted 比) を表示し「Refscope の判定ではなく
   │                  Git の数字」として開示する
   │
   └─ Opportunity 4: false positive により「安全と言ったが変わっていた」事故
         └─ Solution: バッジを "assertion" ではなく "signal" として表示
                      (例: ✓ rename-only ではなく ~ likely-rename-only)
                      Confidence indicator を表示する
```

---

## §3 Hypothesis

### 3.1 メイン仮説 (testable)

> 「Refscope の CommitTimeline に refactor-type バッジ (rename-only / structural-only / logic-change) を追加し、hover で Git literal output (diff-filter result, added/deleted 比, threshold) を開示すれば、広志のようなリファクタ中の Senior Backend が PR 提出前セルフレビューで "このコミットにロジック変更が混入しているかどうか" を確認する時間が、コマンドライン確認に比べて短縮される。」

### 3.2 KPIs

| KPI | 観測方法 | 目標値 (synthetic) |
|-----|----------|--------------------|
| K1: refactor-filter バッジでの絞り込み操作回数 / セッション | UI in-memory counter (ローカル) | ≥ 1 回 / リファクタ作業セッション |
| K2: false positive 率 (rename-only バッジが付いたが実は M ファイル含む) | Researcher が実 PR を手動検証 | Option A: ≤ 5% (Git 判定のみなので低い) |
| K3: false negative 率 (logic-change コミットに rename-only バッジが付く) | 同上 | Option A: 0% (rename-only = R のみ) |
| K4: Option B の対称性ヒューリスティクス false positive 率 | 同上 | ≤ 20-30% (ヒューリスティクスの限界として正直に設定) |
| K5: hover tooltip アクセス率 | in-memory counter | ≥ 30% (透明化が使われているかの代理指標) |

**K4 について正直な前提:** numstat の対称性は「行が同数移動した」ことしか測れない。変数名変更 (1 行 → 1 行) は対称だが振る舞いを変えることもある。false positive 20-30% は楽観値であり、Go の大規模リファクタでは実測が必要。

### 3.3 Fail Condition (Kill Criteria)

- K2 > 10% (Git rename-only でも false positive が多い場合) → バッジを "rename-detected" の観察表示のみに縮退し、"structural-only" / "logic-change" の二項分類をやめる。
- K4 > 40% (Option B のヒューリスティクスがランダム判定と変わらない) → Option B を非表示にし、Option A のみ残す。
- K5 < 10% (hover tooltip が誰も見ない) → tooltip を常時展開の小テキストに変更し、透明化の UI 設計を見直す。

---

## §4 Options

### Option A — --diff-filter=R/M バッジのみ (派生 0)

**概要:** `getCommit` レスポンスの `files` に含まれる name-status を UI 側で集計し、すべてのファイルが R (rename) または C (copy) だけのコミットに `rename-only` バッジを付与する。`M` (modified) ファイルが 1 件でもあれば `logic-change` バッジ。

**派生強度:** 0 — Git の name-status literal output をそのまま分類に使う。Refscope は「ファイルのステータスを集計した」だけで、コードの意味を解釈していない。

**UI:** CommitTimeline の各行に小さなバッジ chip を追加。`rename-only` は緑 (低リスク信号)、`logic-change` は青 (通常)、`mixed` はアンバー。

**Hover tooltip 内容:**
```
Git reported: 3 renamed (similarity: R91, R88, R95), 0 modified
Classification: rename-only (Git name-status, no Refscope inference)
```

**実装コスト:** UI のみ変更。`getCommit` の既存レスポンス (`files` フィールド) で判定可能。API 変更不要。

**限界:** rename の中に 1 行 `if` 変更が混在しても、ファイル単位の `M` がなければ `rename-only` になってしまう (false positive の残存)。

---

### Option B — numstat 対称性ヒューリスティクス追加 (派生 中) ★推奨★

**概要:** Option A に加え、`modified` ファイルが存在する場合でも、commit 全体の added/deleted 比が threshold 内 (例: 0.9 ≤ ratio ≤ 1.1) かつ合計変更行数が小さい場合に `structural-only` シグナルを付与する。

**判定ロジック (概念):**
```
given: files[] from getCommit response
renameFiles = files where status starts with R or C
modifiedFiles = files where status = M
addedLines = sum(file.added for all files)
deletedLines = sum(file.deleted for all files)

if modifiedFiles.length == 0:
  → tag: "rename-only" (Option A と同一)
elif modifiedFiles.length > 0 and addedLines > 0 and deletedLines > 0:
  ratio = addedLines / deletedLines
  if |ratio - 1.0| <= SYMMETRY_THRESHOLD:  // default: 0.10
    → tag: "structural-only" (signal, not assertion)
  else:
    → tag: "logic-change"
else:
  → tag: "logic-change"
```

**SYMMETRY_THRESHOLD のデフォルト:** 0.10 (added と deleted が 10% 以内の差)。純粋な行移動は added = deleted = 0 (rename) または perfect symmetry。ロジック追加/削除は非対称になる傾向を利用するが、**リファクタでも非対称になりうる** (コメント削除、行 wrap など)。

**hover tooltip 内容:**
```
Git numstat: +42 / -40 lines across 3 files (ratio: 1.05)
Symmetry threshold: ±10% (configurable)
Signal: structural-only — added ≈ deleted, but behavior change is possible.
This is a heuristic, not a semantic guarantee.
```

**false positive / negative の正直な評価:**
- false positive (ロジック変更なのに structural-only と出る): 変数名リネーム 1 行の場合は対称だが意味が変わる。**推定 20-30%** — Researcher による実測が必要。
- false negative (rename-only なのに logic-change と出る): コメント削除で削除が多くなり非対称になる場合。**推定 10-15%**。
- これらの率は Go のモノリス分割 PR を対象にした実測がなく、synthetic 推定値であることを明示する。

**実装コスト:** API 変更不要 (既存 `files` に added/deleted が含まれる)。UI 側でバッジ計算ロジックを追加。threshold を props / localStorage で設定可能にする UI が追加コスト。

---

### Option C — B + AST 等価性 (派生 高, tree-sitter 依存) — D-5 との統合判断

**概要:** Option B に tree-sitter ベースの構造等価性チェックを加える。変更されたファイルの diff に対し、関数・ブロックレベルで AST 変換前後を比較し「構造的に等価」かどうかを判定する。

**D-5 (semantic diff) との関係:** D-5 は AST レベルで「呼び出しグラフ・制御フロー・型シグネチャ」の差分を可視化する要求 (Eleanor, D-5)。Option C の AST 等価性判定は D-5 の実装下位集合であり、**本提案では Option C を単独で進めることは推奨しない**。

理由:
1. tree-sitter の追加は `apps/api/` の「依存最小」哲学に反する重大な変更
2. 対応言語ごとにグラマーを用意する必要があり、汎用 Git ビュアーとしての普遍性が下がる
3. D-5 が先に提案・検証されれば、AST インフラをシェアできる

**本提案での扱い:** Option C は参照のために記述するが、**採択判断は D-5 の Go/No-Go と連動させる**。D-5 が Researcher 検証を経て v2 以降に採択された場合、Option B のバッジ精度向上として Option C を追加する。

---

## §5 実装スケッチ (Option B)

### 5.1 API 変更 — 不要

既存の `getCommit` レスポンスの `files` フィールドには `status` (name-status) と `added` / `deleted` が含まれる (gitService.js の `parseChangedFiles` が numstat + name-status を統合している)。追加の API エンドポイント不要。

### 5.2 UI 変更 (apps/ui/src/app/)

**バッジ計算関数 (新規、app/utils/refactorBadge.ts 相当):**
```typescript
// 観察値: files[] から refactor signal を計算する pure function
// 返り値は "rename-only" | "structural-only" | "logic-change"
// と、hover 用の evidence オブジェクト
function classifyCommit(files, symmetryThreshold = 0.10): {
  tag: RefactorTag;
  evidence: RefactorEvidence;  // tooltip に出す Git literal
}
```

**CommitTimeline への統合:**
- `App.tsx` に `refactorFilter: 'all' | 'rename-only' | 'structural-only' | 'logic-change'` state を追加
- `CommitTimeline` に `refactorFilter` prop を渡し、フィルタ後のコミット一覧を表示
- 各コミット行に `<RefactorBadge tag={...} evidence={...} />` チップを追加
- バッジ chip クリックで `refactorFilter` を切り替え

**RefactorBadge コンポーネント:**
- Radix `Tooltip` を使い hover で evidence を表示 (既存 ui/ primitives を再利用)
- バッジテキスト: `rename-only` / `~structural` (波線で "likely" を示す) / `logic`
- evidence に `threshold`, `addedLines`, `deletedLines`, `ratio`, `Git literal` を表示
- "~" prefix は「これは heuristic signal であり assertion ではない」の視覚的表現

### 5.3 フィルタ UI

CommitTimeline 上部のフィルタバーに `[All] [Rename-only] [Structural] [Logic]` のセグメントボタンを追加。既存の `search / author / path` フィルタと AND で組み合わせる。

---

## §6 Open Questions

1. **Go のモノリス分割 PR での実測精度:** numstat 対称性ヒューリスティクスが Go のリファクタ実 PR でどの程度の false positive/negative を出すか。Researcher がサンプル 10-20 件で計測することを推奨。
2. **Threshold のデフォルト値:** 0.10 は経験的な選択であり、言語・プロジェクト規模によって最適値が変わる可能性がある。per-repo 設定か global 設定か。
3. **バッジの視覚言語:** 「~structural」の波線や confidence indicator の表現が直感的かどうか、ユーザーテストが必要。
4. **merge commit の扱い:** merge commit は複数の変更を束ねるため、対称性ヒューリスティクスが意味をなさない。merge commit は常に `logic-change` または別カテゴリにすべきか。
5. **empty commit / binary-only commit の扱い:** added / deleted が 0 または binary (-1) の場合のバッジ分類ルール。
6. **App.tsx state owner との整合:** `refactorFilter` の persistence (URL param / localStorage) 方針を App.tsx 設計方針と揃えるか。
7. **D-5 との統合タイミング:** D-5 が採択された場合、Option B のバッジを Option C に移行する際の後方互換。

---

## §7 Assumptions

1. `getCommit` レスポンスの `files` フィールドには numstat の `added` / `deleted` と name-status の `status` が統合されており、UI 側でバッジ計算に必要な情報が揃っている (gitService.js `parseChangedFiles` の現状実装に依拠)。
2. CommitTimeline がコミットごとに `files` データを持っているか、あるいは hover 時に `getCommit` を追加フェッチするかで実装コストが変わる。現状 `listCommits` は numstat を集計するが file-level status は返さない — hover 時に lazy fetch が必要な可能性がある。
3. `synthetic: true` — 広志の demand は Plea 起源の合成仮説であり、実際のシニアバックエンド開発者が同じ優先度でこの機能を求めているかは未検証。
4. Go の大規模リファクタ (5,000 行 → 12 ファイル分割) で numstat 対称性が有効に機能するという前提は、Go の関数移動パターンに依存し、他言語 (Python, TypeScript) では異なりうる。
5. `--diff-filter=R` の similarity は Git のデフォルト設定 (50%) を使う。より厳密な threshold が必要なユーザーは Option C に進む。

---

## §8 Hand-off

**Next: Researcher**

1. **false positive/negative 実測:** Go / Python OSS リポジトリの「リファクタ PR」10-20 件で Option A / B それぞれの fp/fn 率を手動計測する。
2. **Threshold 最適化:** 対称性 threshold 0.05 / 0.10 / 0.20 の 3 点で精度 / recall トレードオフを報告する。
3. **ユーザー voice 補強:** 実際にリファクタ PR を出す Senior Backend 開発者 2-3 名に「PR 提出前の確認フロー」をインタビューし、synthetic 仮説を実証する。

K4 (false positive 率) が 40% 未満 → Builder に渡し Option B を実装。40% 以上 → Option A のみで初回リリースし、D-5 成熟を待って Option C を検討する。

---

## RICE Score

| 軸 | 値 | 根拠 |
|----|----|----|
| Reach | 200 / quarter | リファクタ中 Senior Backend 層への推定リーチ (synthetic) |
| Impact | 2 | PR 説明コスト削減 (Impact 3 は ≥10% KPI 改善確認が必要) |
| Confidence | 40% | synthetic demand + false positive 未実測。Researcher 検証後 60-70% 更新見込み |
| Effort | 3 person-days | UI バッジ + tooltip + フィルタ state。API 変更不要。設計・テスト込み |
| **RICE** | **(200 × 2 × 0.40) / 3 ≈ 53** | Medium (50-100 レンジ) |

**Impact-Effort:** Quick Win (低 Effort、中 Impact)

*Proposal: 2026-05-07 by Spark. Next: Researcher (false positive/negative 実測検証)*
