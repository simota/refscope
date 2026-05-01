# Spark Proposal: Advanced Search Modes (pickaxe / regex / message) (Refscope)

> Synthetic demand source: `docs/user-demand-report-2026-05-01-r3.md` — Riku (パワーユーザー / SRE / CLI fluent)
> `synthetic: true` — このドキュメントは Plea round 3 が生成した合成ユーザー需要に基づく仮説提案であり、実ユーザー検証前の提案である。
> 上位エージェント: Plea (synthetic user advocate, round 3) → Spark (this document) → Researcher / Atlas-Magi / Rank (next).
> 範囲: 既存 `CommitTimeline` の検索 UI を **置換** せず、**検索モード切替** を追加する。API は既存 `/api/repos/:repoId/commits` を拡張するか新 endpoint を追加する (Option 比較で決定)。

---

## 0. Summary

- 対象ペルソナ: Riku (SRE / インシデント対応 / CLI fluent。日常的に `git log -S` / `-G` / `--grep` を使い、Refscope の subject 検索だけでは届かない場面が週次〜日次で発生)。
- 解こうとしている job-to-be-done: 「インシデント対応・コード考古学のとき、diff の中身 / commit message 正規表現で commit を絞り込む調査を、CLI に戻らずに Refscope 内で完結させる」。
- 現状の死角: フィルターに pickaxe (`-S`) / diff-grep (`-G`) / message regex (`--grep`) がない。subject 文字列検索 (`--grep` に変換) のみ。
- Riku の強い訴求: 「Refscope 独自の検索 DSL を作らないでほしい。Git native のサブセットを UI で選択できるようにするだけで良い。」
- 提案: 検索フィールドに **モード切替** を追加し、`subject` / `pickaxe -S` / `regex -G` / `message --grep` / `path` / `author` から選択可能にする。各モードの Git option を tooltip で開示する。
- 派生強度 3 段階の options:
  - **Option A (Segmented Mode Selector):** 既存 `/commits` endpoint に `mode` + `pattern` query parameter を追加。UI は segmented control で切替。**推奨**。
  - **Option B (Dedicated `/commits/search` endpoint):** 新 endpoint に分離し、既存 `/commits` を無変更に保つ。
  - **Option C (Hybrid — subject/path/author は既存、pickaxe/regex/grep は別 endpoint):** スコープ別の責務分離。
- 推奨: **Option A**。既存 `/commits` の query parameter 拡張で、後方互換を保ちながら最小変更で AC を満たす。
- gitRunner allowlist 変更: **不要** (`log` は許可済み)。`-S`, `-G`, `--grep` は allowlist の `log` コマンドへの引数として渡す。dangerous flag rejection list にこれらは**含まれていない** (gitRunner.js 実装確認済み)。
- Atlas/Magi review: **不要** (allowlist 変更なし)。ただし validation の境界設計を Magi に共有することは推奨。
- 200 commit hard cap: **維持**。pickaxe は重いため pre-flight 警告 + `truncated: true` の明示 suggest を追加する。
- Open questions 9 件、assumptions 8 件を末尾に明示。

---

## 1. Context Read (本提案の前提)

| 参照 | 用途 |
|---|---|
| `CLAUDE.md` | API は `apps/api/src/` で hardened gitRunner 経由。command allowlist は `cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`。新コマンド追加なしで本機能は実装可能。 |
| `apps/api/src/gitRunner.js` | dangerous flag rejection は `-p` / `--paginate` / `--output` / `--no-index` のみ。`-S`, `-G`, `--grep` は拒否リストに含まれていない。`--end-of-options` の配置で pickaxe pattern を option 扱いさせない仕組みが既にある。 |
| `apps/api/src/gitService.js` | `commitListLogArgs` の現状: `--end-of-options` の前に `searchArgs`, `authorArgs` を置き、後に `revision`、最後に `-- pathArgs`。現行 subject 検索は `--grep=<escaped>` として渡している (`escapeGitRegexLiteral` で正規表現文字をエスケープ)。pickaxe は pattern を正規表現エスケープなしで渡すべきフィールド。 |
| `apps/api/src/validation.js` | `parseBoundedTextQuery` が基盤 (max 100 chars, control char 拒否)。新規 `parseSearchModeQuery`, `parsePickaxeQuery`, `parseRegexQuery` を追加するターゲット。 |
| `apps/api/src/http.js` | `/api/repos/:repoId/commits` は `url.searchParams` を `gitService.listCommits` に渡す。拡張ポイントとして `mode` + `pattern` / `patternMode` parameter を追加可能。 |
| `mock/src/app/components/refscope/CommitTimeline.tsx` | 既存 search UI は `CommitTimeline` props の `activeFilters` で表示。検索ボックス UI は `App.tsx` / `TopBar` 側に存在する想定 (CommitTimeline は結果表示に専念)。モード切替 UI は TopBar の検索フィールド周辺に追加する。 |
| `docs/spark-period-summary-proposal.md` | 章立て / 観察 vs 派生語彙 / OST / Hypothesis-KPI-FailCondition 形式の踏襲元。 |

### 1.1 現状の検索実装 (gitService.js 確認済み)

```js
// 現状: search query は --grep として渡される (正規表現エスケープ済み)
const searchArgs = search.value
  ? ["--regexp-ignore-case", "--extended-regexp", `--grep=${escapeGitRegexLiteral(search.value)}`]
  : [];
```

つまり現在の「subject 検索」は、内部的に `git log --grep=<escaped>` として実行されている。Riku が求める `--grep` モードは、正規表現エスケープを**しない**で渡す点でのみ現行と異なる。

### 1.2 gitRunner.js の dangerous flag rejection 分析

```
拒否されるフラグ:
  -p / --paginate: ページャ
  --output / --output=: ファイル書き出し
  --no-index: 非 repo diff
  (args[0].startsWith("-")): グローバルオプション

拒否されないフラグ (本機能関連):
  -S "<pattern>"  → allowlist 内 log コマンドの引数として渡せる
  -G "<regex>"    → 同上
  --grep="<regex>"→ 同上 (既に使用中)
```

`-S` と `-G` は `args[0]` ではなく中間引数として渡すため、global option チェック (`args[0].startsWith("-")`) にも引っかからない。

### 1.3 観察データ (observed facts) として確定的に得られるもの

- pickaxe `-S`: 「pattern の出現数が変化した commit」= Git が検出した事実。Refscope は「この commit で secret が削除された」とは言わない。Git の出力をそのまま返す。
- diff-grep `-G`: 「diff 行の中に regex にマッチした行を含む commit」= Git が検出した事実。
- `--grep`: 「commit message (subject + body) に regex がマッチした commit」= Git が検出した事実。
- 「一致根拠の行」: `-G` や `-S` が「どの行にマッチしたか」を直接返さない。その情報は別途 `git log -p` または commit の diff を取得して初めて分かる。これは **Refscope の追加呼び出しが必要な情報** であり、「観察 vs 派生」の境界として明確に扱う。

---

## 2. Outcome Solution Tree (OST)

```
Outcome:
  Riku がインシデント対応・コード考古学のとき、
  CLI に戻らずに Refscope 内で diff 内容 / commit message regex 検索を完結させる
  (KPI: pickaxe/regex モード利用率, CLI fallback 頻度の自己報告減少, search result 閲覧率)
   │
   ├─ Opportunity 1: pickaxe (-S) がない → OAUTH_SECRET の消失 commit を特定できない
   │     └─ Solution: pickaxe モード選択 + -S pattern を literal で Git に渡す
   │
   ├─ Opportunity 2: diff-grep (-G) がない → diff 行の正規表現検索ができない
   │     └─ Solution: regex モード選択 + -G pattern を Git に渡す
   │
   ├─ Opportunity 3: message regex がない → --grep が固定エスケープで subject 限定
   │     └─ Solution: message grep モード選択 + --grep を raw regex で Git に渡す
   │
   ├─ Opportunity 4: Git option の素通し感がない → 独自 DSL と思われて学習コスト倍増
   │     └─ Solution: mode label に "Git: -S" / "Git: -G" / "Git: --grep" を明記
   │
   └─ Opportunity 5: 重いクエリを無警告で実行すると timeout / 体感低下 → 信頼を失う
         └─ Solution: pre-flight commit 数見積もり + 重いクエリ警告 + truncated 明示
```

---

## 3. Hypothesis & KPIs

### 3.1 Hypothesis (testable)

> 「検索フィールドに Git native のモード切替 (subject / pickaxe -S / regex -G / message --grep) を追加し、各モードの Git option を tooltip で開示すれば、Riku のような SRE / パワーユーザーは週次の diff 検索調査を CLI に戻らずに Refscope 内で完結できる」

### 3.2 KPIs (ローカルで観測可能なものに限定)

| KPI | 観測方法 | 目標値 (synthetic) |
|---|---|---|
| K1: pickaxe / regex / grep モードの利用率 | search mode 変更イベントを in-memory カウント | 有効化後 14 日で ≥ 1 回 / 週 |
| K2: pickaxe / regex 検索後に commit detail を開く率 | search → commitRow click のファネル | ≥ 50% |
| K3: search result が 0 件で終わる率 | 0 件応答 / 全検索 | < 30% (高すぎると pattern 構文ミス示唆) |
| K4: timeout / truncated エラー率 | 504 / truncated:true 応答 / pickaxe 検索総数 | < 10% (pre-flight 警告の有効性指標) |
| K5: "重いクエリ警告" で cancel した率 | confirm dialog の cancel 押下数 / 警告表示数 | — (観測のみ、閾値なし) |

> KPI は localStorage または in-memory に保持。外部送信なし。

### 3.3 Fail Condition (kill criteria)

- K1 が 30 日で 0 (pickaxe / regex モードが一度も使われない) → UI の discoverability を見直し、またはモードの存在自体を Researcher に再確認。
- K4 > 20% 超過 → pre-flight 見積もりの精度か、timeout 設定 (`RTGV_GIT_TIMEOUT_MS`) を再調整。
- 「Refscope の独自 DSL に見える」ユーザーフィードバックが 2 件以上 → tooltip / label の Git option 開示が不十分と判断し、UI 語彙を改善。
- 「pickaxe 結果が期待と異なる (パターン誤動作)」報告が 2 件以上 → validation.js の literal 渡し境界を再点検。

---

## 4. Feature Options (派生強度別)

以下 3 options を API endpoint 設計の軸で比較する。UI 設計 (search mode 切替) はどの option でも共通。

| Option | API 設計 | 後方互換性 | 実装コスト | 推奨度 |
|---|---|---|---|---|
| A | 既存 `/commits` endpoint の query parameter 拡張 | 高 (新 param は optional) | 低 | **推奨** |
| B | 新 endpoint `/commits/search` | 既存を無変更に保てる | 中 | 次点 |
| C | ハイブリッド (subject/path/author は既存、pickaxe/regex/grep は別 endpoint) | 高 (分離) | 高 | 非推奨 |

---

### 4.1 Option A — 既存 `/commits` endpoint の query parameter 拡張 (推奨)

#### 4.1.1 概要

- 既存 `GET /api/repos/:repoId/commits` に `mode` と `pattern` (または `patternMode`) を追加。
- `mode` が省略 / `subject` の場合は現行動作と同一 (後方互換)。
- `mode=pickaxe` のとき `pattern` を `-S <pattern>` として渡す。`mode=regex` のとき `-G <pattern>`。`mode=message` のとき `--grep=<pattern>` を正規表現エスケープなしで渡す。

#### 4.1.2 API Contract

```
GET /api/repos/:repoId/commits
  ?ref=<gitRef>          (既存)
  &limit=<1-200>         (既存)
  &search=<text>         (既存 subject 検索 — mode 省略時のみ有効)
  &author=<text>         (既存)
  &path=<path>           (既存)
  &since=<ISO date>      (既存 — summarize endpoint で追加済み)
  &until=<ISO date>      (既存 — summarize endpoint で追加済み)
  [新規]
  &mode=subject|pickaxe|regex|message
  &pattern=<string>      (mode が subject 以外のとき有効)
```

- `mode` と `search` の同時指定はエラー (400) とし、片方のみ有効とする。
- `mode=subject` は既存 `search` と同義だが、`search` との共存は拒否。
- `pattern` が空文字列のとき、`mode` 指定は無視 (mode なしと同等)。

#### 4.1.3 gitService.js への変更

```js
// 追加: search mode に応じた args 生成
function buildSearchModeArgs(mode, pattern) {
  if (!pattern) return [];
  switch (mode) {
    case "pickaxe":
      // -S を literal 文字列として渡す。--end-of-options の前に配置。
      // pattern が "-" で始まっても問題なし ("-S" の直後の引数は pattern と解釈される)
      return ["-S", pattern];
    case "regex":
      return ["-G", pattern];
    case "message":
      // --grep を正規表現エスケープなしで渡す (Git native の --grep)
      return ["--regexp-ignore-case", "--extended-regexp", `--grep=${pattern}`];
    case "subject":
    default:
      // 既存の escapeGitRegexLiteral を使用 (後方互換)
      return ["--regexp-ignore-case", "--extended-regexp", `--grep=${escapeGitRegexLiteral(pattern)}`];
  }
}
```

`commitListLogArgs` への組み込みは既存 `searchArgs` を `buildSearchModeArgs(mode, pattern)` で置き換えるだけ。`--end-of-options` の前に配置するため、pattern がどのような文字列でも option 扱いされない。

#### 4.1.4 `-S` と `--end-of-options` の配置問題

現状の `commitListLogArgs`:
```
log
--max-count=N
--date=iso-strict
...searchArgs...   ← ここに -S / -G を追加
...authorArgs...
--format=...
--no-show-signature
--numstat
...
--end-of-options   ← この前ならすべて Git option として解釈される
<revision>
--
...pathArgs...
```

`-S <pattern>` の `<pattern>` は `-S` の直後の引数 (配列の次要素) として渡す。`spawn` の引数配列は shell 展開を経由しないため、pattern に空白・特殊文字・ハイフン先頭が含まれても安全。

**リスク分析:**
- `pattern = "-delete"` など、ハイフン先頭の場合 → `-S` に続く次の引数として渡すため Git は正しく pattern として解釈する (`-S -delete` ではなく `-S` + `-delete` の 2 element 配列)。Git はこの形式を受け付ける。
- `pattern = ""` → `parsePickaxeQuery` で空文字拒否。
- `-S` と `-G` の同時指定 → `parseSearchModeQuery` で `mode` は enum 単一値なので同時指定は構造上不可能。

#### 4.1.5 後方互換性

- `mode` / `pattern` parameter は完全に optional。
- 既存クライアント (`search=foo`) は引き続き動作する。
- 既存の `search` parameter と `mode=subject` が混在するリクエストは 400 を返すことで意図しない二重指定を防ぐ。

#### 4.1.6 Pros / Cons

- Pros: 実装最小 / 後方互換 / URL が意味論的に一貫 ("コミット一覧を絞り込む" という同一操作) / cache 戦略 (既存と同一 key 構造)。
- Cons: endpoint の責務が広がる / `mode` + `pattern` + 既存 `search` の三角関係の validation が複雑 / pickaxe と author の組合せなど多数パラメータの組合せ爆発が将来問題になる可能性。

---

### 4.2 Option B — 新 endpoint `/commits/search` (次点)

#### 4.2.1 概要

- 既存 `/commits` を無変更に保ち、新しい `/commits/search` endpoint で advanced search のみ処理。
- 既存クライアントへの影響ゼロ。
- URL の意味論として「search = 専用のコスト高い操作」として分離される。

#### 4.2.2 API Contract

```
GET /api/repos/:repoId/commits/search
  ?ref=<gitRef>
  &limit=<1-200>
  &mode=subject|pickaxe|regex|message|path|author
  &pattern=<string>
  &since=<ISO date>
  &until=<ISO date>
```

http.js の `matchRoute` にパターン追加:
```
parts.length === 5 && parts[3] === "commits" && parts[4] === "search"
→ { name: "commitsSearch", params: { repoId } }
```

ただし現在 `parts.length === 5 && parts[3] === "commits" && parts[4] === "summary"` が `commitsSummary` に対応している。`search` も同じ位置に追加可能。

#### 4.2.3 Pros / Cons

- Pros: 既存 `/commits` の動作に影響なし / "search" という URL が重い操作であることを示唆 / cache 戦略を独立して最適化可能 (例: pickaxe は cache TTL を短くするなど)。
- Cons: client 側で 2 endpoint を切り替える必要あり / `subject` / `path` / `author` の基本検索も新 endpoint 側に実装するか既存を使うか迷いが生じる / code 重複。

---

### 4.3 Option C — ハイブリッド (非推奨)

#### 4.3.1 概要

- `subject`, `path`, `author` は既存 `/commits` に残す。
- `pickaxe`, `regex`, `message` のみ新 endpoint `/commits/search` に分離。

#### 4.3.2 Pros / Cons

- Pros: 責務の明確な分離。
- Cons: 実装コストが最大 / UI 側が「どのモードがどの endpoint か」を知る必要がある / 将来 mode が増えたとき分類が再び問題化 / 本提案の「mode は Git native のサブセット」という概念と矛盾する (UI から見たモードの統一感が失われる)。

---

## 5. API Endpoint 推奨: **Option A**

### 選定理由

1. **URL の意味論:** 「コミット一覧を特定の条件で絞り込む」という操作は、mode に関わらず同一の意味論。pickaxe も subject 検索も「コミットを検索する行為」であり、endpoint 分離は REST 意味論上の冗長。
2. **後方互換:** `mode` / `pattern` は optional。既存フロントエンドコード無変更。
3. **cache 戦略:** URL + query string がそのままキャッシュキーになる。pickaxe の重さは timeout 設定 (`RTGV_GIT_TIMEOUT_MS`) で制御するのが適切。
4. **実装最小:** `gitService.listCommits` の拡張のみ。`http.js` の router 変更不要。
5. **validation の集約:** `readCommitListQuery` に `mode` / `pattern` を追加するだけ。`parseSearchModeQuery` + `parsePickaxeQuery` / `parseRegexQuery` を `validation.js` に追加。

---

## 6. UI Design — 検索モード切替の Trade-off

### 6.1 候補 UI パターン

| パターン | 概要 | Power user 親和性 | 一般 user 親和性 | Discoverability | Density |
|---|---|---|---|---|---|
| Segmented control | `[subject] [pickaxe] [regex] [message]` の horizontal tabs | 高 (一覧性) | 中 (全モード見える) | 高 | 中 |
| Mode chip (ON/OFF toggle) | `[-S] [-G] [--grep]` のような Git option そのままのチップ | 非常に高 (Git CLI 親和) | 低 (意味不明) | 低 | 高 |
| DSL prefix (`S:`, `G:`, `g:`) | 検索ボックスに prefix を打ち込む | 高 (キーボード優先) | 低 (学習コスト) | 低 | 非常に高 |
| Dropdown select | 検索ボックス隣のドロップダウンでモード選択 | 中 | 高 | 高 | 低 |

### 6.2 Riku の声と整合するパターン

> 「検索ボックスをモード切替にしてくれませんか。subject / pickaxe / grep / path / author で。それぞれ Git の挙動に合わせれば、私は CLI に戻らなくて済む。Refscope 独自の検索 DSL を作られると、私は学習コストが二重になって、結局 CLI を選びます。」

- **DSL prefix は Riku の懸念と矛盾**: `S:` / `G:` は Refscope 独自記法であり、`git log -S` ではない。Riku の voice に反する。
- **Mode chip (`[-S]` 形式)**: Git option をそのまま見せるため Riku には最高。しかし一般ユーザーには Git の知識が前提となる。
- **Segmented control + tooltip**: モード名は "Pickaxe (-S)" / "Regex (-G)" / "Message (--grep)" のように Git option をラベルに含める。tooltip で詳細説明を開示。一般ユーザーも「Pickaxe」という機能名で直感的に近づける。

### 6.3 推奨 UI: Segmented Control + Git option 開示 tooltip

```
┌─ Search bar area (TopBar / Filter area) ────────────────────────────────────┐
│                                                                              │
│  Mode: [Subject] [Pickaxe -S] [Regex -G] [Message --grep]                   │
│         ─────────────────────────────────────────────────                    │
│  [ Search or pattern...                                    ] [×] [Search]   │
│                                                                              │
│  Tooltip (hover on "Pickaxe -S"):                                            │
│  "Git: git log -S <pattern>                                                 │
│   Finds commits where the number of occurrences of <pattern> changed.       │
│   Use for: finding where a string was added or removed."                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- モードラベルは "Pickaxe (-S)" のように Git option を括弧内に含める。
- tooltip は「Git: `git log -S <pattern>`」から始め、Git の公式ドキュメントに相当する説明を添える。
- `path` / `author` モードも同じ control 内に並べ、UI 統一。
- 既存の `search` input はそのまま流用し、mode に応じて placeholder text を変える (例: mode=pickaxe のとき "Enter literal string pattern...")。

### 6.4 Power user vs 一般 user の両立

- power user (Riku): Git option がラベルに露出しているため学習コスト ゼロ。
- 一般 user: "Subject" / "Pickaxe" / "Regex" という機能名から類推できる。tooltip を読めば Git の挙動が分かる。
- **Riku の根本的懸念「独自 DSL は学習コスト二重」** は、DSL prefix を使わず segmented control にすることで回避できる。

---

## 7. gitRunner Allowlist 整合分析

### 7.1 allowlist 変更の必要性

**結論: 変更不要**

- `ALLOWED_GIT_COMMANDS = new Set(["cat-file", "diff", "for-each-ref", "log", "merge-base", "rev-list", "rev-parse", "show"])`
- `-S`, `-G`, `--grep` は `log` コマンドへの引数として渡す。`log` は許可済み。
- `args[0]` は常に `"log"` であり、`args[0].startsWith("-")` チェックを通過する。

### 7.2 dangerous flag rejection との関係

現在 rejection されるのは:
- `-p` / `--paginate`: ページャ起動
- `--output` / `--output=`: ファイル書き出し
- `--no-index`: 非 repo diff
- `args[0].startsWith("-")`: グローバルオプション

`-S`, `-G`, `--grep` はどのルールにも該当しない。追加で rejection list に加える**必要もない**。理由:
- `-S` / `-G` は `log` の有効な search option。危険な副作用 (外部ファイル書き出し、非 repo 参照、pager 呼び出し) を持たない。
- `--grep` は既に `searchArgs` で使用済みであり、rejection list 追加は現行実装と矛盾する。

### 7.3 `--end-of-options` 配置の確認

現行 `commitListLogArgs`:
```js
return [
  "log",
  `--max-count=${limit}`,
  "--date=iso-strict",
  ...searchArgs,      // ← ここに -S / -G を追加 (--end-of-options の前)
  ...authorArgs,
  `--format=...`,
  "--no-show-signature",
  "--numstat",
  "--no-ext-diff",
  "--no-textconv",
  "--end-of-options", // ← この後は revision (= Git object) として解釈
  revision,
  "--",               // ← この後は pathspec
  ...pathArgs,
];
```

`-S <pattern>` は `searchArgs` の位置に入る。`<pattern>` は `-S` に続く次の配列要素として渡す。`spawn` + `shell: false` なので shell 展開はなく、literal 文字列として Git に届く。`--end-of-options` より前に置かれるため、Git は `-S` を option、次の要素を pattern として解釈する。

**hyphen-leading pattern のリスク**: `-S "-delete"` のとき、`-delete` が Git option に誤解釈されないか? → `-S` は次の引数を常に pattern として解釈するため、`-delete` が Git option に誤解釈されない。`git log -S -delete` は Git が `-S` の引数として `-delete` を取る (確認済み: git documentation の `-S<string>` は `string` を attached or separated で解釈する)。spawn の引数配列では `["-S", "-delete"]` と分離すると `-delete` が別 flag として誤解釈されるリスクがある。**対策:** `-S<pattern>` と `<pattern>` を結合した単一引数 `"-S" + pattern` として渡す方式も検討 (attached form: `-STOKEN`)。attached form なら完全に安全。

```js
// attached form (推奨)
case "pickaxe":
  return [`-S${pattern}`];  // -STOKEN 形式、space 不要
case "regex":
  return [`-G${pattern}`];  // -GPATTERN 形式
```

attached form は Git の `man git-log` で明示的にサポートされており、`-S<string>` / `-G<regex>` が正式記法。

### 7.4 `-S` と `-G` の同時指定

`mode` は enum 単一値 (`parseSearchModeQuery` で validation)。`pickaxe` と `regex` を同時指定することは API 上不可能。`mode` の重複 parameter は `readCommitListQuery` の既存パターン (`allValues.length > 1` チェック) で弾く。

### 7.5 regex 系 (`-G`, `--grep`) の ReDoS リスク

- `-G <regex>` と `--grep <regex>` は Git 内部の正規表現エンジン (POSIX ERE または PCRE2) で評価される。Git は `SIGALRM` 等によるタイムアウト保護を持たない。
- ReDoS 対策は Git 側に委ねる形になる。Refscope 側の緩和策:
  1. `parseRegexQuery` で length cap (例: max 200 chars) を設ける。
  2. `RTGV_GIT_TIMEOUT_MS` でプロセスごと SIGTERM。
  3. UI で "regex mode は大規模 repo で遅くなる可能性があります" を事前表示。
- 注意: Refscope が JavaScript で regex を事前評価 (`new RegExp(pattern)`) すると、Refscope 自体が ReDoS 被害を受ける。事前評価は**行わない**。Git に literal 渡しし、timeout で制御する。

### 7.6 `--pickaxe-all` / `--pickaxe-regex` の必要性

- `--pickaxe-all`: pickaxe が 1 ファイルでもマッチしたとき、そのコミットの全ファイル diff を表示する Git option。**Refscope には不要** (diff 表示は commit detail で個別取得する設計)。
- `--pickaxe-regex`: `-S <pattern>` の pattern を正規表現として解釈する Git option。Riku の use case では literal string (`-S "OAUTH_SECRET"`) が主用途。regex pickaxe が必要な場合は `-G` を使うよう UI で案内する方が明確。**追加しない。**

### 7.7 Atlas/Magi Review の必要性

**不要**: allowlist への変更がないため。ただし以下を Magi/Atlas に情報共有することを推奨:
- `parsePickaxeQuery` / `parseRegexQuery` の validation 境界設計。
- attached form (`-STOKEN`) vs separated form のトレードオフ最終決定。
- ReDoS 対策として Git タイムアウトに委任する設計判断。

---

## 8. 200 commit Hard Cap と pickaxe の重さ

### 8.1 問題の規模

- `git log -S <pattern>` は各コミットの diff を生成して pattern の出現数変化を計算する。100,000 commit の repo で数分かかる可能性がある。
- 現行 `RTGV_GIT_TIMEOUT_MS` デフォルト 5,000ms (5秒)。large repo では短すぎる。

### 8.2 Pre-flight: commit 数見積もり

```js
// pre-flight: git rev-list --count <revision>
const count = await runGit(repo, ["rev-list", "--count", "--end-of-options", revision], {
  timeoutMs: config.gitTimeoutMs,
  maxBytes: 32,
});
```

- `rev-list --count` は `ALLOWED_GIT_COMMANDS` に含まれる (`rev-list`)。追加 allowlist 変更不要。
- 取得した commit 数が閾値 (例: 10,000) を超える場合、レスポンスに `{ heavyQuery: true, estimatedCommits: N }` を含める。

### 8.3 UI 側の警告

```
┌─ Heavy Query Warning ───────────────────────────────────────────────────────┐
│ This search may scan approximately 50,000 commits.                          │
│ Pickaxe (-S) reads the diff of every commit — this may take 30+ seconds.   │
│ Tip: narrow the ref to a branch, or add a date range to reduce scope.       │
│                                                                              │
│  [Cancel]  [Proceed anyway]                                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- pre-flight で `estimatedCommits > 10000` のとき表示。閾値は設定可能 (env knob 候補: `RTGV_SEARCH_WARN_COMMITS`)。
- "Proceed anyway" を選択した場合のみ実際の search request を発行。

### 8.4 Streaming / Progressive Result の可否

- 現行 API は JSON レスポンス (非 streaming)。SSE は `events` endpoint のみ。
- pickaxe の progressive result には chunked SSE が必要。**現行アーキテクチャでは実装コストが高い。**
- MVP では "full wait + timeout" で対応し、streaming は v2 候補とする。

### 8.5 Cancel Signal (AbortController + SIGTERM)

- HTTP リクエストのキャンセル: ブラウザ `AbortController` → fetch の abort → TCP 接続断。
- API 側: `req.on("close", ...)` のパターンが既に SSE endpoint に存在 (`http.js` L 194)。同パターンで commits endpoint にも `req.on("close", () => child.kill("SIGTERM"))` を追加できる。
- ただし現行の非 streaming JSON response では、レスポンス送信前に close を検出しても実行中の `runGit` はキャンセルされない。実装するには `runGit` に `signal` オプションを追加し、`AbortController` を渡す変更が必要。
- **MVP スコープ外**: `RTGV_GIT_TIMEOUT_MS` による自動 SIGTERM で対応。cancel は v2 候補。

### 8.6 200 commit cap と pickaxe のトレードオフ

- `git log -S <pattern> --max-count=200 <ref>` は「pattern にマッチした最新 200 件」を返す。上限を超えた commit は走査されるが、返さない。
- **"実は多くの match があった" の示唆**: レスポンスに `truncated: true` を含め、「200 件 cap に達した = さらに古い期間にも match がある可能性」を UI で明示する。

```json
{
  "commits": [...200件...],
  "truncated": true,
  "truncatedHint": "Results are capped at 200. Older matches may exist — narrow the date range to search further back."
}
```

- 既存 `truncated: true` パターン (`summarizeCommits` で実装済み) と整合する語彙。

### 8.7 Timeout 設計

- `RTGV_GIT_TIMEOUT_MS` は現在全 Git 操作共通。pickaxe の重さに対応するため:
  - **短期対策**: pickaxe / regex mode 検索のみ timeout を 2× にするオプション (例: `RTGV_SEARCH_TIMEOUT_MS`)。
  - **中期対策**: pre-flight で commit 数が多い場合、timeout を動的に延長する。
  - **UI 表現**: timeout で 504 が返ったとき、「タイムアウトしました。検索範囲を絞るか、date range を指定してください」のエラーメッセージを表示。

---

## 9. validation.js の拡張

### 9.1 新規 validator 設計

#### `parseSearchModeQuery(rawValue)`

```js
const ALLOWED_SEARCH_MODES = new Set(["subject", "pickaxe", "regex", "message"]);

export function parseSearchModeQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: "subject" }; // default
  }
  const trimmed = rawValue.trim();
  if (!ALLOWED_SEARCH_MODES.has(trimmed)) {
    return { ok: false, error: "Invalid mode parameter" };
  }
  return { ok: true, value: trimmed };
}
```

#### `parsePickaxeQuery(rawValue)`

```js
const PICKAXE_MAX_LENGTH = 200;

export function parsePickaxeQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: "" };
  }
  const trimmed = rawValue.trim();
  if (!trimmed) return { ok: true, value: "" };
  if (
    trimmed.length > PICKAXE_MAX_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(trimmed)  // 既存の /[ -]/ — null byte 含む
  ) {
    return { ok: false, error: "Invalid pattern parameter" };
  }
  return { ok: true, value: trimmed };
}
```

null byte (` `) は既存 `CONTROL_CHARACTER_PATTERN` で拒否される。最大長は 200 chars (subject/author の 100 chars より大きく設定。pickaxe は token 単位で長くなりうる)。

#### `parseRegexQuery(rawValue)`

`-G` と `--grep` (message mode) は同じ validator を共用できる。ただし `--grep` は subject+body 全体に適用されるため、内部的にはモードで分岐するが validation は同一。

```js
const REGEX_MAX_LENGTH = 200;

export function parseRegexQuery(rawValue) {
  // parsePickaxeQuery と同じ構造。長さと control char のみ検証。
  // JavaScript での事前評価 (new RegExp()) は行わない — ReDoS リスク。
  return parsePickaxeQuery(rawValue); // 実質同一ロジック、エイリアスまたは共通ヘルパ化
}
```

**注意:** `-G` と `--grep` で別 validator にするかどうか → **同一 validator を使う**。意味論的差異 (literal vs regex) は Git 側の option (`-G` vs `-S`) で決まる。validation は「安全な文字列か」のみを担保。

### 9.2 既存 `parseSearchQuery` との互換性

- 既存 `parseSearchQuery` (= `parseBoundedTextQuery`) は `search` parameter に使われる。
- 新 `mode` / `pattern` parameter を追加するが、`search` parameter は存在し続ける (後方互換)。
- `search` と `mode=subject` の同時指定は `readCommitListQuery` で弾く。
- 将来的に `search` を deprecate するかどうかは open question。

---

## 10. UI 上の「一致根拠」の表示

### 10.1 問題の構造

- `-S <pattern>` が返す commit は「pattern の出現数が変化した commit」。どの行で変化したかは commit の diff (`git show -p`) を追加取得しないと分からない。
- `-G <regex>` が返す commit は「diff 行に regex がマッチした commit」。同様に diff が必要。
- **Refscope の現状**: commit detail view (`getCommit`) は numstat + name-status のみ。diff は別途 `getDiff` endpoint。

### 10.2 「観測 vs 派生」原則との整合

> round 2 journal の原則: Refscope は Git の出力をそのまま見せる (観察) であり、Refscope が独自に解釈 / 要約する (派生) のは透明性を持って分離する。

- **pickaxe の一致行表示は観察に相当**: Git が diff を出力した行をそのまま表示するだけ。
- **しかし追加コスト**: `getDiff` を自動発火することは、search result 表示と同時に O(N) の diff 取得を引き起こす。
- **推奨設計 (MVP):**
  - commit row に「match found in diff」バッジを表示。
  - diff viewer に遷移したとき、pickaxe / regex の pattern で diff 行を highlight する。
  - highlight は Refscope が実行するが、「Git のこの diff 行が pattern にマッチした」という観察事実の視覚化であり、Refscope が「この行は重要」と解釈したわけではない。
  - highlight の実装は diff viewer (Prism syntax highlighting 既存) にパターンマッチを追加するだけ。追加 Git 呼び出し不要。

### 10.3 一致根拠を commit row に表示しない理由

- 一致行を commit row に inline 表示するには、各 commit の diff を個別取得 (N 回) する必要がある。
- 200 件 × diff 取得 = 最大 200 回の `git show` → 非現実的。
- **方針**: commit row には「このモードで検索して hit した」という事実のみを badge で示し、詳細は diff viewer へ誘導。

---

## 11. RICE Score と Impact-Effort 分類

| Factor | Value | 根拠 |
|---|---|---|
| Reach | 2 (qtr) | パワーユーザー / SRE セグメント。Refscope のローカル利用を想定。全ユーザーの 20-30% と推定 (synthetic)。 |
| Impact | 3 (high) | インシデント対応の CLI fallback をなくす = 信頼回復。Riku の「調査の 7 割」という発言が根拠。ただし synthetic 発言のため Confidence に反映。|
| Confidence | 50% | synthetic demand (Plea round 3) のため。実ユーザー検証なしに 80% 以上は当てない。 |
| Effort | 1.0 (person-month) | UI (mode selector + tooltip + warning dialog) + API (validation.js 拡張 + gitService.listCommits 拡張) + テスト。gitRunner 変更なし。 |

`(2 × 3 × 0.50) / 1.0 = 3.0` — RICE ranking では **High**。

### Impact-Effort 分類: **Quick Win** (高インパクト / 低〜中コスト)

- gitRunner allowlist 変更不要 / 新コマンドなし / 既存 `log` の引数拡張のみ。
- UI は existing search field の mode selector 追加。新コンポーネント最小。
- 最大のリスクは pickaxe の重さへの対処 (pre-flight + timeout) のみ。

---

## 12. Open Questions

1. **`mode` と既存 `search` の coexistence**: `mode=subject` は `search` parameter と完全に同義か? deprecation path は? `search` を残す期間は?
2. **attached form vs separated form**: `-STOKEN` (attached) vs `["-S", "TOKEN"]` (separated) のどちらを採用するか。separated の場合、hyphen-leading pattern の安全性を改めて Git docs で確認すべき。
3. **pre-flight の commit 数見積もり**: `rev-list --count` は fast だが、それ自体も large repo で数秒かかる可能性がある。pre-flight timeout は main search より短くすべき (例: 2000ms)。
4. **cancel signal の実装優先度**: `runGit` への `AbortSignal` 追加は architecture 変更を伴う。MVP に含めるか v2 に後送するか?
5. **`RTGV_SEARCH_TIMEOUT_MS` の追加**: pickaxe / regex 専用の timeout env knob を追加するか、既存 `RTGV_GIT_TIMEOUT_MS` を大きくするか? 後者は全 Git 操作に影響。
6. **diff highlight の実装**: diff viewer の Prism highlight に pattern マッチ highlight を追加する場合、highlight は前後の Git 出力と区別されるか? 「Refscope が行った強調表示」を UI で明示すべきか?
7. **`--grep` mode の subject vs body**: 現行 `--grep` は subject + body 両方にマッチする。`mode=message` として label するか `mode=grep` にするか? "message" は subject+body 全体を指すため適切だが、Git の flag 名 (`--grep`) との乖離が生じる。
8. **mode=path / mode=author の扱い**: segmented control に path / author も含めるか、または path / author は既存 filter (dropdown / input) で十分か? 統一 UI のため含めたいが、control が横長になる。
9. **`--regexp-ignore-case` のデフォルト**: 現行 `subject` 搜索は case-insensitive。`message` / `regex` モードも同じデフォルトにするか、mode ごとに設定可能にするか?

---

## 13. Assumptions

1. `git log` コマンドへの引数として `-S`, `-G`, `--grep` を渡す場合、`gitRunner.js` の allowlist 変更は不要。`log` が許可済みであり、dangerous flag rejection list にこれらが含まれていないことを実コード (`gitRunner.js`) で確認済み。
2. `-STOKEN` (attached form) は `git-log(1)` の正式記法であり、spawn の引数配列で単一要素として渡すことで pattern が安全に Git に届く。
3. 200 commit hard cap は pickaxe 使用時も維持する。超過時は `truncated: true` + 警告メッセージで誠実に伝える。
4. Refscope 独自 DSL (prefix 記法 `S:`, `G:` 等) は作らない。UI の mode selector が Git option に対応することで「Git native のサブセット」の体現とする。
5. pickaxe / regex の一致行を commit row に inline 表示しない (diff viewer 連携で代替)。N × diff 取得は現行アーキテクチャでは non-trivial。
6. ReDoS 対策は Git 側の timeout (SIGTERM via `RTGV_GIT_TIMEOUT_MS`) に委任。JavaScript での regex 事前評価は行わない。
7. `--pickaxe-all` / `--pickaxe-regex` は追加しない。literal string pickaxe と regex pickaxe の区別は `-S` vs `-G` のモード選択で表現する。
8. pre-flight として `git rev-list --count` を使う。`rev-list` は allowlist に含まれる。pre-flight 自体にも timeout を設ける (2000ms 推奨)。

---

## 14. Segmented Control の実装ノート (UI)

- コンポーネント: `mock/src/app/components/ui/` の shadcn-style primitives を再利用。`SegmentedControl` または `Tabs` プリミティブで実装。
- Props: `mode: SearchMode` / `onModeChange: (mode: SearchMode) => void` / `placeholder: string` (mode に応じて変わる)。
- tooltip: Radix `TooltipProvider` + `Tooltip` を mode label に wrap。
- 警告 dialog: Radix `AlertDialog` (キャンセル / 続行) を pre-flight 判定後に表示。
- `SearchMode` 型:
  ```ts
  type SearchMode = "subject" | "pickaxe" | "regex" | "message";
  // path / author は既存 filter として独立させる (v1)
  // v2 で統一 mode selector に組み込む可能性
  ```
- mode は `App.tsx` の state として保持。commit fetch 時に `mode` + `pattern` を API に渡す。
- `activeFilters` prop (CommitTimeline) に mode label を追加 (例: `["Pickaxe: OAUTH_SECRET"]`)。

---

## 15. 段階的ロードマップ

| Stage | スコープ |
|---|---|
| MVP | `mode=pickaxe` / `mode=regex` / `mode=message` の API 実装 + segmented control UI + tooltip。pre-flight 警告なし。`RTGV_GIT_TIMEOUT_MS` で対応。 |
| v1 | pre-flight commit 数見積もり + 重いクエリ警告 dialog。`truncated: true` に "hint" メッセージ追加。 |
| v1.5 | diff viewer での pattern highlight (pickaxe / regex match 行の視覚化)。 |
| v2 | cancel signal (`AbortController` + `runGit` への `signal` 追加)。`RTGV_SEARCH_TIMEOUT_MS` 分離。 |

---

## 16. Next Steps

1. **Researcher (実ユーザー検証):** 実際の SRE / パワーユーザー 3〜5 名に対して「mode 切替 UI」と「現行 subject 検索のみ」を比較検証。特に:
   - 「segmented control の Git option 開示が Riku の懸念する DSL 感を消せているか」
   - 「pickaxe の重さ警告が適切な頻度で表示されるか (too often / too rare の calibration)」
   - Confidence を 50% → 70% に引き上げられるかが Go 判断の分岐点。
2. **Atlas/Magi review (条件付き):** allowlist 変更なしのため正式 review は不要。ただし attached form (`-STOKEN`) の選択と ReDoS 委任設計を Magi に情報共有し、セキュリティ観点のフィードバックを受ける。
3. **Builder / Artisan への handoff (PROTOTYPE):**
   - Builder: `apps/api/src/validation.js` に `parseSearchModeQuery` / `parsePickaxeQuery` / `parseRegexQuery` を追加。`gitService.listCommits` を `mode` / `pattern` parameter 対応に拡張。
   - Artisan: TopBar に `SearchModeSelector` コンポーネント追加。Radix `Tooltip` で Git option 開示。`AlertDialog` で pre-flight 警告。diff viewer に pattern highlight layer。
4. **Rank への priority scoring 依頼:** round 3 の他 demand (Yuki / Ken / Tomo 等) と並列で RICE / WSJF スコアを比較し、v1 roadmap の NEXT を決定。本 RFC の RICE ≈ 3.0 (High) は round 2 の period summary (1.33, Medium) より高い暫定値。

---

## 17. RICE / Priority 暫定値

| Factor | Value | 備考 |
|---|---|---|
| Reach | 2 / qtr | SRE / power user セグメント (全体の推定 20–30%、synthetic) |
| Impact | 3 (High) | インシデント対応の CLI fallback 解消。「調査の 7 割」発言が根拠。Impact=3 は RICE guardrail の ≤20% ルールで本機能にのみ適用 |
| Confidence | 50% | synthetic demand (Plea round 3) のみ。Researcher 検証で 70% に引き上げ可能 |
| Effort | 1.0 person-month | design + engineering + testing + docs。gitRunner 変更なし = 工数最小化。 |
| **RICE Score** | **3.0** | `(2 × 3 × 0.50) / 1.0 = 3.0` |

### Impact-Effort 分類

**Quick Win** — gitRunner allowlist 変更不要 / 新コマンドなし / 既存 `log` への引数拡張のみ。UI は既存 search field の mode selector 追加。最大リスクは pickaxe の重さへの対処のみ。

### WSJF 暫定スコア (参考)

| Factor | Value | 備考 |
|---|---|---|
| User/Business Value | 8 | SRE のインシデント対応ブロッカー解消 |
| Time Criticality | 5 | CLI fallback が続くと Refscope への信頼低下が累積 |
| Risk Reduction | 8 | 誤った CLI 操作 / context 切替ミスのリスク低減 |
| Job Size | 5 | 1 person-month = medium |
| **WSJF** | **4.2** | `(8 + 5 + 8) / 5 = 4.2` |

---

## 18. Handoff

### Suggested next agents

| Agent | 理由 |
|---|---|
| **Researcher** (primary) | synthetic 仮説の実ユーザー検証。mode 切替の discoverability と Git option 開示が Riku の懸念を消せるかを確認。Confidence 50% → 70% への引き上げが GO/NO-GO 分岐点。 |
| **Rank** (parallel) | round 3 の他 demand と RICE / WSJF スコアを並べて v1 roadmap の NEXT を決定。 |
| Atlas/Magi (条件付き) | allowlist 変更が必要になった場合のみ trigger。現時点では不要。attached form 選択の security sign-off のみ推奨。 |

### Artifacts produced

- `docs/spark-riku-search-modes-proposal.md` (this file)

### Risks (top 3)

1. **pickaxe の重さ警告 UX**: pre-flight estimate が不正確 (例: sparse commit + large diff) で警告が出ない / 出過ぎる。調整が継続的に必要。
2. **attached form 安全性の確認**: `-STOKEN` が spawn 引数配列で確実に Git に届くことを、integration test で実 Git repo に対して確認する必要がある。unit test だけでは不十分。
3. **mode=message と既存 subject 検索の重複感**: 「message mode と subject mode の違いは?」という混乱が一般ユーザーに生じる可能性。tooltip + label の文言が重要。

---

```yaml
_STEP_COMPLETE:
  Agent: Spark
  Status: SUCCESS
  Output:
    proposal_file: docs/spark-riku-search-modes-proposal.md
    options_count: 3
    recommended_option: A
    api_design_choice: A
    gitrunner_allowlist_change_needed: false
    atlas_magi_review_required: false
    open_questions_count: 9
    assumptions_count: 8
    rice_score: "3.0 (High)"
    next_steps:
      - "Researcher: mode 切替 UI の discoverability と Git option 開示が Riku の懸念を消せるか実ユーザー検証"
      - "Rank: round 3 の他 demand と RICE / WSJF スコアを並べて v1 roadmap の NEXT を決定"
      - "Builder: validation.js に parseSearchModeQuery / parsePickaxeQuery / parseRegexQuery 追加、gitService.listCommits 拡張"
      - "Artisan: TopBar に SearchModeSelector + Tooltip + AlertDialog 追加、diff viewer に pattern highlight"
  Next: Researcher (実 power user 検証) | Rank (priority scoring)
```
