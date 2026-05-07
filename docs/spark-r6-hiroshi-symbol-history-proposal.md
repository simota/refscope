# Spark Proposal: Symbol-Level History View (Refscope)

> Synthetic demand source: `docs/user-demand-report-2026-05-07-r6.md` — 広志 (Senior Backend, 10y Go, mid-refactor on a 5k-line monolith), Request 1
> `synthetic: true` — このドキュメントは Plea が生成した合成ユーザー需要に基づく仮説提案であり、実ユーザー検証前の提案である。
> 上位エージェント: Plea (synthetic user advocate) → Spark (this document) → Researcher / Builder / Accord (next).
> ロードマップ位置: **v2 候補 (MVP 範囲外)**。gitRunner allowlist 変更不要、read-only 哲学維持、App.tsx 単一 state owner パターン踏襲。

---

## 0. Summary

- **対象ペルソナ:** 広志 (Senior Backend, 10y Go, 5,000 行サービスファイルを 12 ファイルに分割中)。
- **解こうとしている JTBD:** 「移動・リネームのコミット境界を透過して、ある関数/シンボルがリポジトリ創生から今日まで "どう旅してきたか" を 1 画面で見る」——進捗は「バグ起源を特定して手を入れられる確証を得ること」であり、コミット閲覧はその手段にすぎない。
- **現状の死角:**
  - Refscope の `/commits` は `path` filter を持つが、**シンボル名でのフィルタ** はできない。
  - `git log --follow` はファイルレベルの rename 追跡だが、**行範囲 (`-L :function:file`) でシンボル単位の抽出** はしていない。
  - UI は「コミット単位の diff」を見せる設計であり、「シンボルがどのコミットをまたいでどう変わったか」の時系列をまとめて見せる view がない。
  - IDE の "Go to definition" は現在の定義しか見せない。Refscope も現状は同等の死角がある。
- **提案:** `SymbolHistoryView` という新 view を追加し、(a) `git log -L :name:file --follow --find-renames` を使った専用 API endpoint、(b) 各コミットでそのシンボルの本文スナップショット表示、(c) ファイル分割時の後継シンボル列挙、を組み合わせる。
- **派生強度 3 段階の options:**
  - **Option A (Line-Range Cursor — `git log -L`のみ):** 単一ファイルにシンボルが留まる前提で `git log -L :name:file` を実行。rename 追跡なし。派生 0。
  - **Option B (Symbol Travel View with `--follow` + `--find-renames`, 推奨):** `git log -L :name:file --follow --find-renames` でファイル移動を透過。Git の literal な name-status を rename evidence として表示。派生強度 中。
  - **Option C (B + 複数後継シンボルの同時追跡):** ファイル分割時に複数後継ファイルを並列クエリし、union タイムラインを構築。派生強度 高 (Refscope が後継を推論する)。
- **推奨:** **Option B**。広志の AC 1〜2 を満たし、allowlist 変更なし、派生の境界が明確。AC 3 (ファイル分割後の後継複数表示) は `open question` として Researcher に渡す。
- **gitRunner allowlist 変更不要** (`log` サブコマンドのみで実装可能)。
- **200 commit hard limit は変えない。**
- Open questions 7 件、assumptions 7 件を末尾に明示。
- **Hand-off recommendation:** Researcher 第一 (real-user 検証で `git log -L` の知名度 / 受容度確認)、Architecture Review は軽量レビューを推奨 (新 endpoint 追加のみ、allowlist 変更なし)。

---

## 1. Context Read

| 参照 | 用途 |
|---|---|
| `CLAUDE.md` | API は plain ESM, gitRunner allowlist: `cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`。TS 不可。App.tsx 単一 state owner。 |
| `docs/user-demand-report-2026-05-07-r6.md` (Request 1) | 広志の user voice と AC 3 件。"シンボルが旅した" 比喩を保持。 |
| `docs/spark-tomo-file-history-proposal.md` | 章立て / 観察 vs 派生分離 / OST / Hypothesis-KPI-FailCondition 形式の踏襲元。 |
| `docs/spec-v0.md` (冒頭 200 行) | ローカル単独動作、MVP は最新 100 件 commit 中心、SSE/REST 構成。 |
| `apps/api/src/gitService.js` | `listCommits` は `git log --max-count=N --numstat` で plain commit list。`--follow`/`-L` は未使用。`FILE_HISTORY_DEFAULT_LIMIT=20`, `FILE_HISTORY_MAX_LIMIT=50` の既存定数が存在。 |
| `apps/api/src/gitRunner.js` | `ALLOWED_GIT_COMMANDS` に `log` 含む。`-c`, `--git-dir`, `--work-tree`, dangerous flags は拒否。`--end-of-options` 必須。`git log -L :name:file` は `log` コマンドであり allowlist 内。 |

### 1.1 観察データ (observed facts) として確定的に得られるもの

`git log -L :name:file --follow --find-renames --no-show-signature --patch` の raw output から取得できる literal な観察値:

- `commit.hash`, `commit.parents`, `commit.author`, `commit.authorDate`, `commit.subject`
- diff hunk: `@@ -<from>,<len> +<to>,<len> @@` ヘッダーと前後 context 行
- `git log --follow --name-status` が返す status code:
  - `R<NN>\t<oldPath>\t<newPath>` — rename, similarity NN% (Git 計算値、Refscope 非推論)
  - `M\t<path>` — modified
- 追跡パスが `R<NN>` で切り替わったことは Git literal output から直接読める

### 1.2 派生 (inferred / interpreted) として明示すべきもの

- **シンボル「存在の有無」の可視化:** `git log -L :name:file` が出力を返す = シンボルがそのファイルに存在した、と解釈する。これは Git の定義によるものだが、シンボル境界はヒューリスティック (関数の `{...}` 解析)。
- **「旅した」タイムライン上の連続性:** rename 前後のコミットを Refscope が 1 タイムラインに結合して表示するのは UI 側の派生。Git は別クエリの結果として返す。
- **「後継ファイル」の特定 (Option C のみ):** ファイル分割後に複数の後継に同名関数が存在する場合、それを「後継」と判断するのは Refscope の派生 (Git literal output ではない)。Option B の scope 外とする。
- **「このコミットがシンボルに影響した最初」の推論:** `git log -L` が返す最古コミットを「導入コミット」と呼ぶのは UI labelling であり派生。

---

## 2. Outcome Solution Tree (OST)

```
Outcome: 広志がシンボル名を入力するだけで rename/move を透過した変遷タイムラインを 1 画面で辿れる
  │
  ├─ Opportunity 1: シンボル名で commit をフィルタできない
  │     └─ Solution: `git log -L :name:file` 専用 endpoint `/symbol-history`
  ├─ Opportunity 2: rename/move でログが断絶する
  │     └─ Solution: `--follow --find-renames` + Git literal rename evidence 表示
  ├─ Opportunity 3: 各コミットでシンボル本文が見られない
  │     └─ Solution: `-L` の patch hunk を "before/after スナップショット" として表示
  └─ Opportunity 4: ファイル分割後に複数後継にシンボルが散らばる (Option C)
        └─ Solution: 並列クエリ + union タイムライン (Option B ではヒントのみ)
```

### 2.1 広志の AC マッピング

| AC (user-demand-report-2026-05-07-r6.md §Request 1 より) | 設計上の対応 | Option 別差分 |
|---|---|---|
| シンボル名を入力すると rename/move を貫通したコミット時系列が出る | `git log -L :name:file --follow` で時系列取得。rename は Git literal に表示。 | A は rename 非追跡。B/C は追跡あり。 |
| 各コミットでシンボルの前後本文を並べて見られる | `-L` の patch diff hunk をそのまま "before/after" として表示。 | A/B/C 共通。 |
| ファイル分割時に複数の後継を全部表示する | Option B は "後継が複数ある可能性" ヒントのみ。Option C で並列後継追跡。 | A: 非対応。B: ヒントのみ。C: フル対応。 |

---

## 3. Hypothesis

### 3.1 因果仮説

> 「Refscope に `SymbolHistoryView` を追加し、(a) シンボル名とファイルパスを入力すれば `git log -L` を裏で実行し、(b) rename/move を `--follow --find-renames` で透過した上で Git literal な rename evidence を表示し、(c) 各コミットにシンボルの diff hunk を表示すれば、広志のようなリファクタ中のシニアバックエンドエンジニアは、ファイル移動を跨いだ関数の変遷を 20 分ではなく 2 分で辿れるようになる」

### 3.2 検証方法

- **定量:** `SymbolHistoryView` の起動セッション数 / `git log -L` を手動実行した形跡 (terminal history や別ツール起動) との比率をローカルで観察。
- **定性:** Researcher によるリファクタ作業中の観察インタビュー (5 名以上)。「20 分溶かした」という frustration が 1-2 分で解消されるかを think-aloud で測定。

### 3.3 KPI

| KPI | 観測方法 (ローカル完結) | 目標値 (synthetic) |
|---|---|---|
| K1: SymbolHistoryView を起動したセッション率 | クライアント in-memory counter | ≥ 15% (10 session に 1.5 回以上) |
| K2: rename evidence が表示された history を最後まで辿った率 | rename evidence カードを含むページで "End of history" まで到達した割合 | ≥ 40% |
| K3: シンボルスナップショット (diff hunk) を開いた回数 / SymbolHistoryView 起動数 | 同上 | ≥ 60% (3 回に 2 回はスナップショットを見る) |
| K4: SymbolHistoryView 開閉後に CommitTimeline の selected ref/commit/filters が保持された率 | open 前後の state スナップショット差分 | ≥ 99% |
| K5: "シンボルが見つからない" エラー率 | エラー表示件数 / 起動数 | ≤ 10% (シンボル名 typo が主因なら UI 補助で低減) |

> KPI はローカル localStorage または in-memory。telemetry 外部送信なし。

### 3.4 Fail Condition (kill criteria)

- K1 < 5% (30 日 / 5-10 セッション試用後): 「コマンド直打ちで十分、UI は不要」とみなし SymbolHistoryView を command palette 限定に縮退。
- K2 < 15%: rename 追跡が実際には使われていない → Option A (rename なし) に scope-cut。
- K3 < 30%: スナップショット表示が価値を産まない → diff hunk を default-hidden に変更。
- K5 > 25%: シンボル検出精度が低すぎてユーザーが諦める → `git log -L :<regex>:file` への fallback か fuzzy match を追加前に Researcher に戻す。

---

## 4. Options A / B / C

| Option | 派生強度 | 主な Git 操作 | AC カバレッジ | 透明性ライン |
|---|---|---|---|---|
| A | 0 (line-range のみ) | `git log -L :name:file` (単一ファイル固定) | AC1 部分, AC2 のみ | "Showing raw git log -L output. Renames are not crossed in this view." |
| B | 中 (rename literal) | `git log -L :name:file --follow --find-renames --patch` | AC1 フル, AC2, AC3 ヒント | "Git reported rename — similarity NN% (Git literal output, no Refscope inference)" |
| C | 高 (多後継追跡) | B + 並列複数ファイルクエリ + union タイムライン | AC1 フル, AC2, AC3 フル | B に加え "Multiple successors inferred by Refscope (heuristic, not Git literal)" |

### 推奨: Option B

- 広志の最高優先 voice「シンボルがどう旅したか」を rename 越しに満たせる最小実装。
- `git log -L` は allowlist 内の `log` コマンドで実装可能、新コマンド追加不要。
- AC3 (ファイル分割後の複数後継) は Option C に据え置き、実ユーザー需要の確認後に投資判断する。
- 派生の境界が明確 (Git literal → UI literal 転記) であり、Refscope の "observed vs inferred" 原則と整合。

---

## 5. 推奨実装スケッチ (Option B)

### 5.1 API Endpoint 追加

```
GET /api/repos/:repoId/symbol-history
  ?file=<path>          (必須, parsePathQuery で validated)
  ?symbol=<name>        (必須, 新 parseSymbolQuery: 英数字/underscore/dot/dash, 1-128 char)
  ?limit=<n>            (任意, parseLimitQuery max=50, default=20: FILE_HISTORY_* 定数流用)
  ?similarity=<nn>      (任意, 整数 1-100, default=50: `--find-renames=<nn>%` に渡す)
```

**gitService.js 内の実装 (概念):**

```javascript
// git log -L :symbol:file --follow --find-renames=NN%
//   --no-show-signature --patch --no-ext-diff --no-textconv
//   --format=<NUL-separated fields> --max-count=<limit+1>
//   --end-of-options -- <file>
const args = [
  "log",
  `-L:${symbol}:${file}`,           // シンボル行範囲指定 (Git 機能)
  "--follow",
  `--find-renames=${similarity}%`,
  "--no-show-signature",
  "--patch",
  "--no-ext-diff",
  "--no-textconv",
  `--format=${COMMIT_RECORD_SEPARATOR}%H%x00%P%x00%an%x00%aI%x00%s`,
  `--max-count=${limit + 1}`,
  "--end-of-options",
  "--",
  file,
];
```

**レスポンス形状 (抜粋):**

```json
{
  "symbol": "parseRefScope",
  "file": "internal/parser/scope.go",
  "truncated": false,
  "commits": [
    { "hash": "a3886c", "authorDate": "...", "subject": "...",
      "fileAtCommit": "internal/parser/scope.go",
      "renameEvidence": null, "hunk": "@@ -12,7 +12,9 @@\n ..." },
    { "hash": "548682f", "authorDate": "...", "subject": "refactor: split service.go",
      "fileAtCommit": "service.go",
      "renameEvidence": { "oldPath": "service.go",
        "newPath": "internal/parser/scope.go", "similarity": 95,
        "note": "Git reported rename — Git literal output, no Refscope inference" },
      "hunk": "@@ -87,6 +87,8 @@\n ..." }
  ]
}
```

### 5.2 validation.js 追加

```javascript
// 新規: parseSymbolQuery(value)
// 英数字, underscore, dot, dash のみ許可, 1-128 字
// injection 対策: '-L' prefix や shell metachar を拒否
export function parseSymbolQuery(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[\w.\-]{1,128}$/.test(trimmed)) return null;
  if (trimmed.startsWith("-")) return null; // dangerous flag prefix
  return trimmed;
}
```

### 5.3 UI コンポーネント

- `SymbolHistoryView` — overlay drawer (CommitTimeline の上に重なる)。`App.tsx` から `symbolHistoryOpen: boolean`, `symbolHistorySymbol: string | null`, `symbolHistoryFile: string | null` を props で受け取り、open/close callback を emit。
- `SymbolSearchBar` — シンボル名とファイルパス入力 UI。`App.tsx` で管理される state を更新。
- `SymbolCommitCard` — 各コミットの summary + diff hunk (折りたたみ可能) + rename evidence badge。
- **既存 `DetailPanel` は変えない。** SymbolHistoryView は detached drawer として実装し、詳細パネルの slot を汚染しない。

### 5.4 App.tsx 側 state 拡張

`App.tsx` に `symbolHistoryOpen: boolean`, `symbolHistorySymbol: string | null`, `symbolHistoryFile: string | null` の 3 フィールドを追加する。既存 `selectedRef / selectedCommit / filters` は変更しない。`SymbolHistoryView` は open/close callback のみ emit し、自身では state を持たない。

### 5.5 `git log -L` の主な制約

- **シンボル未検出 (exit 128):** typo または言語非対応時は `symbol_not_found` エラーとして正常レスポンス化する。
- **`-L` + `--follow` 組み合わせ:** Git ≥ 2.30 で安定。startup 時に `git --version` チェックを追加推奨。
- **タイムアウトリスク:** `-L` は全行スキャンのため大規模 repo で遅延しうる。`timeoutMs` を `gitTimeoutMs × 2` に設定可能にする。

---

## 6. Open Questions

1. **`git log -L :name:file` の言語サポート範囲:** Go の `func parseRefScope()` は正常に認識されるか？ Go は Git の built-in funcname regex で対応しているか確認が必要。
2. **シンボル名 typo 時の UX:** `symbol_not_found` エラーをどう UI で伝えるか。類似シンボル候補 (fuzzy) を出すか出さないか (派生レベルの懸念)。
3. **ファイルパスの入力補助:** ユーザーは正確なファイルパスを知っているか？ CommitTimeline の diff から "この関数の symbol-history を開く" ボタンを追加するかどうか。
4. **`limit=50` hard cap は十分か:** 広志の frustration は「20 分溶かした」= 数百 commit 遡る可能性がある。50 件で足りるか、cursor pagination を別途設計するか。
5. **diff hunk の表示形式:** `git log -L` のパッチ出力は前後 context 含む。広志が「本文を並べて見たい」に対して unified diff 形式が直感的か、side-by-side が必要か。
6. **ファイル分割後の後継追跡 (AC3) の実装時期:** Option C に据え置きとするが、広志の AC3 は「全部表示する」という強い要件。Researcher で urgency を確認すべきか。
7. **コマンドパレット連携:** `Cmd+K` で「シンボル履歴を開く」を追加するか。既存 dynamic palette との整合を確認。

---

## 7. Assumptions

1. **Git ≥ 2.30 が前提:** `git log -L --follow` の安定動作に必要。Refscope のターゲット環境は Node 22+ であり、同水準の Git バージョンが揃っていると仮定する。
2. **シンボル名は Go/Python/JavaScript など Git が built-in funcname regex で認識する言語に限定:** Go は `func <name>` パターンで認識される。言語非対応の場合 symbol_not_found になる。
3. **`FILE_HISTORY_MAX_LIMIT=50` は既存定数を流用:** symbol-history も同じ cap を適用。cursor pagination は v2.1 以降に先送りする。
4. **rename evidence は Git の `-L` + `--follow` のみに依存し、Refscope 独自の rename 検出は実装しない:** 透明性原則と整合。
5. **UI のアクセスポイントは CommitTimeline の diff view から "この関数を追う" ボタンを追加する前提:** SymbolSearchBar の standalone 入力も持つが、メイン導線はコンテキスト起動とする。
6. **200 commit hard limit は `listCommits` にのみ適用:** symbol-history は別 endpoint で `FILE_HISTORY_MAX_LIMIT=50` を採用。既存 limit 設計との整合は `validation.js` で分離して管理する。
7. **App.tsx の state 拡張は 3 フィールド追加のみ:** 既存 `selectedRef`, `selectedCommit`, `filters` state を変更しない。SymbolHistoryView は overlay として独立し state を汚染しない。

---

## 8. Hand-off Recommendation

### Researcher 第一 (推奨)

- **理由:** このドキュメントは `synthetic: true`。広志の frustration と AC は Plea 起源の仮説であり、実際に Go リファクタを行うシニアエンジニアにインタビューしてから Go/No-Go を判断すべき。
- **特に検証すべき点:**
  - `git log -L` の知名度: 「知ってるけど使いにくい」か「全く知らない」かで UI の価値が変わる。
  - AC3 (後継複数表示) の urgency: Option B 推奨に基づく先送りが妥当かどうかの確認。
  - `limit=50` の充足性: 広志が「20 分溶かした」調査が 50 件以内で完結するか、実タスクで観察する。
  - シンボル名入力の導線: ファイルパスを毎回入力させるのが苦痛かどうか。

### Architecture Review (軽量)

- **必要性:** 低〜中。新 endpoint 追加のみで allowlist 変更なし。ただし `git log -L` の出力パースは既存 `parseCommitRecords` と異なるフォーマットになるため、gitService.js の新 parser 関数のレビューは推奨。
- **特に確認すべき点:** `-L` オプションと `--follow` の組み合わせによる git プロセスの stdout サイズが `maxBytes` 上限内に収まるかのベンチマーク (大規模 repo の long function に対して)。

### RICE Score (参考値)

Reach=4, Impact=2, Confidence=30% (synthetic / unvalidated), Effort=3 person-weeks (API endpoint + parser + UI + tests + docs)。**RICE ≈ 0.8 (Low)**。Impact-Effort 分類: **Big Bet**。Researcher handoff 後に Confidence 更新 → 再スコアリング推奨。

_STEP_COMPLETE:
  Agent: Spark
  Status: SUCCESS
  Output:
    deliverable: docs/spark-r6-hiroshi-symbol-history-proposal.md
    recommended_option: B
    hypothesis_summary: "SymbolHistoryView で `git log -L :name:file --follow` を UI 化すれば、リファクタ中の Senior Backend が rename/move を跨いだ関数の変遷を 20 分ではなく 2 分で辿れるようになる"
  Next: DONE
