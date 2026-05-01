# Spark Proposal: Period Summary View (Refscope)

> Synthetic demand source: `docs/user-demand-report-2026-05-01.md` — Hana (週次ユーザー / 非エンジニア / テクニカルライター)
> `synthetic: true` — このドキュメントは合成ユーザー需要に基づく仮説提案であり、実ユーザー検証前の提案である。
> 上位エージェント: Plea (synthetic user advocate) → Spark (this document) → Rank / Researcher / Accord (next).
> 範囲: 既存 `CommitTimeline` 内の `CommitActivityGraph` の **次の段** に積む新しい summary view。activity overview と author graph は置換しない。

---

## 0. Summary

- 対象ペルソナ: Hana (週次に repo を眺めて社内告知やリリースノート下書きを作るテクニカルライター)。
- 解こうとしている job-to-be-done: 「期間中に observed な commit データから、リリースノートに転記できる粒度の "誰が・どこを・どれだけ" 情報を、観察事実と派生表現を分離した形で 5 分以内に得る」。
- 現状の死角: `CommitActivityGraph` の 5 つのバーは集計値だが「何が起きたか」は語らない。一方で commit 一覧は hash と subject の生表示で、非エンジニアには context にならない。
- 提案: 期間切替 (today / 7d / 30d / last N) を持ち、grouping (conventional-commit prefix / path top-segment / author) ごとに observed-only の集計と (オプションの) 派生サマリを併置する `PeriodSummaryView` を timeline 上部に追加する。
- 派生強度 3 段階の options:
  - **Option A (Observed-only Aggregation):** 集計と raw subject 列挙のみ。派生 0。
  - **Option B (Rule-based Structured Summary):** conventional-commit prefix と path prefix を確定的にラベル化、テンプレート文に流し込む。派生は確定的ルールベースで透明。
  - **Option C (LLM Narrative, opt-in):** B の派生に加え、ローカル LLM (Ollama 等) または明示的に許可された外部 API による自然文 narrative をオプトインで生成。observed payload と LLM 出力は厳密に視覚分離し、引用可能 commit を必ず併記。
- 推奨: **Option B**。最小実装で AC 3 つを満たし、観察 / 派生境界を最も透明にできる。Option C は B が安定運用された後の拡張として opt-in で追加。
- 既存 200 commit 上限と read-only API 原則は尊重する。新規 Git コマンドは導入しない (既存 `log --numstat` + `for-each-ref` の範囲)。
- Open questions 6 件、assumptions 5 件を末尾に明示。

---

## 1. Context Read (本提案の前提)

| 参照 | 用途 |
|---|---|
| `CLAUDE.md` | API は `apps/api/src/` で hardened gitRunner 経由。command allowlist は `cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`。 |
| `README.md` | `/api/repos/:repoId/commits` は `ref / limit / search / author / path` を受け、limit は最大 200。`signed: false` / `signatureStatus: "unknown"` 固定。 |
| `docs/spec-v0.md` | プロダクトはローカル単独。リリース当初の MVP は最新 100 件 commit 中心。 |
| `docs/user-demand-report-2026-05-01.md` | Hana の AC、cross-persona 観察として「観察事実と派生 / 推測の分離」が round 1/2 を越えて再発する死角。 |
| `apps/api/src/gitService.js` | `listCommits` は `git log --numstat` で `hash, parents, author, authorDate, subject, refs, signature, added/deleted/fileCount` を返す。`parseChangedFiles` は path / status / added / deleted を扱う。 |
| `apps/api/src/validation.js` | `parseLimitQuery (max=200)`, `parseSearchQuery / parseAuthorQuery / parsePathQuery` の bounded 入力。新規 query parameter 追加時は同形式で。 |
| `mock/src/app/components/refscope/CommitTimeline.tsx` | 既存 `CommitActivityGraph` (lines 130–190) と `AuthorGraph` (203–246) が timeline 上部に積まれている。新 view は同じ位置の "次の段" として共存する想定。 |
| `mock/src/app/api.ts` | `listCommits` は `limit: 100` 固定。期間サマリ用に拡張または別 endpoint 化を検討。 |

### 1.1 観察データ (observed facts) として確定的に得られるもの

`gitService.js` の現状実装から、以下は raw observed data:

- `commit.hash`, `commit.shortHash`
- `commit.subject` (生テキスト)
- `commit.author` (display name)
- `commit.authorDate` (ISO-strict)
- `commit.parents`, `commit.isMerge`
- `commit.refs` (decorate)
- `commit.added` / `commit.deleted` / `commit.fileCount` (numstat 集計)
- ファイル単位の `{ path, status: A|M|D|R, added, deleted }` (commit detail 経由)

### 1.2 派生 (inferred / interpreted) として明示すべきもの

- 期間境界の解釈 (例: "this week" は monday-start か sunday-start か、ユーザーの local TZ か repo の TZ か)
- conventional-commit prefix 抽出 (例: `feat(api):` → category=feat, scope=api) — テキストに literal に存在する場合のみ確定的に抽出可能だが、prefix が無い commit は "uncategorized" として明示されなければならない。
- path top-segment grouping (例: `apps/api/src/foo.js` → group=apps/api) — 単純なルールだが「重要度」「影響範囲」を意味しない (派生)。
- "What changed" narrative — Option B/C で生成する。observed ではなく、必ず派生境界 UI で囲む。

---

## 2. Outcome Solution Tree (OST)

```
Outcome:
  Hana が月曜朝 5 分以内にリリースノート下書きの初稿に着手できる
  (KPI: 期間サマリ閲覧後 timeline / commit detail に進む率, drilldown 率, copy-as-markdown 率)
   │
   ├─ Opportunity 1: 期間切替できないため "今週" の境界が曖昧
   │     └─ Solution: PeriodToggle (today / 7d / 30d / last N commits)
   │
   ├─ Opportunity 2: 50 件の hash + subject から context を組み立てられない
   │     └─ Solution: grouping (prefix / path / author) ごとの集計 + (任意) サマリ文
   │
   ├─ Opportunity 3: サマリと観察事実の境界が曖昧だと誤情報をリリースノートに転記してしまう
   │     └─ Solution: observed / inferred を視覚分離し、各サマリから raw commits へドリルダウン
   │
   └─ Opportunity 4: activity overview のバーを見ても「何が起きたか」が分からない
         └─ Solution: 数値集計の隣に、grouping 単位の "subject 一覧 + 件数 + LOC" を提示
```

このうち単一機能としてのまとめは「Period Summary View」。このセッションでは AC 全部を 1 view に集約する単一 RFC として扱う。

### 2.1 Hana の AC マッピング (全 option 共通)

| AC | 設計上の対応 | Option 別差分 |
|---|---|---|
| 期間切替 (今日 / 今週 / 直近 N コミット) | view 上部に `PeriodToggle`。"Today" / "7d" / "30d" / "Last N commits" の 4 ボタン。`since` (ISO 日付) と `last N` (件数) は内部状態で排他。 | A/B/C 共通。 |
| 観察事実と派生表現が分かれて見える | view 内で 2–3 ゾーンに分割。Observed ゾーン (枠線色 = `--rs-border`、無装飾)、Derived (rule-based) ゾーン (枠線色 = `--rs-git-modified` 相当、ラベル "Derived from observed prefixes/paths · rule-based, no AI")、Derived (AI) ゾーン (枠線色 = `--rs-warn` 相当、ラベル "AI-generated · click to verify")。 | A は Observed のみ。B は Observed + Derived (rule-based)。C は 3 ゾーン全部。 |
| 各サマリから根拠 commit list へドリルダウン | 各 grouping カードに `Show N commits →` ボタン。挙動は (a) timeline に search/author/path filter を URL クエリ経由で適用、もしくは (b) PeriodSummaryView 内に inline 展開のいずれか (open question §9.5)。 | A は subject 行クリックで author/path filter、B/C は group key 単位で複数 filter を一括適用。 |

---

## 3. Hypothesis & KPIs (全 option 共通枠)

### 3.1 Hypothesis (testable)

> 「Refscope に observed-only の集計 + (派生境界が明示された) grouping 単位サマリを期間切替できる形で提供すれば、Hana のような週次 / 非エンジニアユーザーは、期間サマリ閲覧後に grouping ドリルダウンを行い、リリースノート初稿を 5 分以内に作成できる」

### 3.2 KPIs (Refscope はローカル単独運用なので、ローカルで観測可能なものだけを採用)

| KPI | 観測方法 (ローカルで完結) | 目標値 (synthetic) |
|---|---|---|
| K1: PeriodSummaryView 表示後の Period 切替操作率 | クライアントで in-memory に PeriodToggle の click 件数 / view mount 件数 を計算し、optional な local "session metrics overlay" (debug toggle) で表示 | ≥ 30% |
| K2: grouping カードからの drilldown 発火率 | 同上 (drilldown click count / view mount count) | ≥ 40% |
| K3: drilldown 後に commit detail を開く率 | drilldown 後に CommitRow click した割合 | ≥ 50% |
| K4: 「Copy as Markdown / Copy commits」操作率 (Option B/C) | clipboard write イベントカウント | ≥ 20% (週次セッション) |
| K5: PeriodSummaryView から timeline スクロールへ戻った率 (誤呼び出し検知) | 直前の戻り操作 / view mount | < 25% (高すぎると view が役立っていない) |

> KPI は「ローカル単独で集計可能」を満たすため、telemetry をリモート送信せず、`localStorage` または in-memory に置く。Refscope の "no external services" 原則と整合。

### 3.3 Fail Condition (kill criteria)

- 30 日 (7 週次セッション相当) のローカル試用で、K2 (drilldown 発火率) < 15% かつ K4 < 5% なら、「サマリは見られているが行為に繋がっていない / コピーされていない」とみなし、view を仕様凍結 (kill 候補)。
- ユーザーから「サマリが事実と異なる」報告が 1 件でも出たら (B/C)、grouping ロジックの観察 / 派生境界を再点検。3 件で view 全体を opt-out 化。

---

## 4. Feature Options

派生強度のスペクトラムを以下 3 段で並べる。

| Option | 派生強度 | 主な技術 | UI 透明性ライン |
|---|---|---|---|
| A | 0 (observed-only) | 既存 commits[] をクライアント集計 | "All shown is observed git data" の 1 行ラベル |
| B | 中 (確定的ルールベース) | conventional-commit prefix + path top-segment 解析 | "Derived from observed prefixes/paths" のセクション枠 |
| C | 高 (LLM narrative, opt-in) | ローカル Ollama / 外部 API (opt-in) | "AI-generated narrative · click to verify against listed commits" の警告枠 |

---

### 4.1 Option A — Observed-only Period Aggregation

#### 4.1.1 概要

- 期間切替で取得済み commits[] をクライアントで grouping し、**集計値と subject の素のリスト** だけを表示。
- 派生処理は一切行わない。conventional-commit prefix の "解釈" もしない。

#### 4.1.2 UI 構成 (概念図)

```
┌─ PeriodSummaryView (mounted between CompareBar and CommitActivityGraph) ───┐
│ Period: [Today] [7d] [30d] [Last N]   Range: 2026-04-24 → 2026-05-01       │
│ Observed: 47 commits / 6 authors / +1,243 -812 / 38 files touched          │
│                                                                             │
│ ── Observed by author (raw) ────────────────────────────────────────────── │
│ shingo   18 commits  +621 -301                                              │
│ tanaka   12 commits  +334 -210                                              │
│ ...                                                                         │
│                                                                             │
│ ── Observed subjects (raw, newest first) ───────────────────────────────── │
│ • feat(api): harden git read execution                  shingo · 4d ago   │
│ • chore(loop): harden codex implementation runner       shingo · 2d ago   │
│ • feat(ui): add visual summary panels                   tanaka · 5d ago   │
│ ... [show all 47 →]                                                        │
│                                                                             │
│ Drilldown: clicking any author/subject filters the timeline below.          │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4.1.3 観察データのソース / 派生処理 / 透明性 UI

- **観察データのソース:** 既存 `/api/repos/:repoId/commits?ref&limit&since?&until?` 応答。
- **派生処理の有無:** なし。すべて raw 表示。集計 (count / sum) は単純算術であり Refscope 既存の `CommitActivityGraph` と同水準。
- **派生処理の透明性 UI:** view 上部に "All values are computed directly from observed git data. No interpretation is applied." を 1 行明記。

#### 4.1.4 既存 activity overview / author graph との関係

- **補完。** `CommitActivityGraph` (5 メトリック + bar) は commits[] の「形」を見せる。Option A は同 commits[] の「中身」(subject 列挙) を見せる。両者は重複しない。
- author graph は author 単位の集計 (count + bar) を既に持つ。Option A の "Observed by author" は同じデータの異なる粒度表 (LOC を含む)。author graph はそのまま残し、Option A の表は LOC 列を加えた展開版とする。

#### 4.1.5 API 側変更

新 endpoint は不要。既存 `/api/repos/:repoId/commits` に以下の optional query を追加する案:

- `since=YYYY-MM-DD` (ISO 日付) — `git log --since=` への変換。
- `until=YYYY-MM-DD` — `git log --until=` への変換。

> Note: `--since` / `--until` は `git log` の既存オプションであり、現状 `commitListLogArgs` には含まれていない。allowlist に新コマンドを追加する必要はないが、`commitListLogArgs` の拡張と `validation.js` への `parseDateQuery` 追加が必要。`gitRunner` の hardening surface は変わらない (引数配列、`--end-of-options`、bounded stdout)。

入力検証 (新規 `parseDateQuery`):
- 受理: `^\d{4}-\d{2}-\d{2}$` のみ。
- 範囲: `1970-01-01` 〜 `2099-12-31`。
- TZ は UTC として扱い、UI 側で local TZ を表示する (派生境界 1 つ目)。

> **代替案:** `since`/`until` を導入せず、200 件まで取得した上でクライアント側で `authorDate` を切るだけにする。最小実装ではこちらが安全 (API 変更ゼロ)。MVP は client-side filter、その後 API 拡張と段階化する。

#### 4.1.6 Hypothesis / 個別 KPI

- 仮説: 「観察データを期間で切れるだけで、Hana は raw subject から十分な context を組み立てられる」
  - これが成立するなら、B/C は不要。Option A は B/C の null hypothesis としても機能する。
- 個別 KPI: K2 (drilldown 率) ≥ 25%、K4 (copy 率) ≥ 10%。下回れば仮説棄却し B へ進む。

#### 4.1.7 Pros / Cons

- Pros: 派生 0 で Refscope の正確性原則を最大に守る / 実装最小 / API 変更最小 / Hana 以外のペルソナ (Tomo の path filter, Yuki の quiet mode) を阻害しない。
- Cons: Hana が「prefix を読み解く能力がない」場合、subject 列挙でも依然 context にならない可能性が残る。仮説が棄却されやすい。

#### 4.1.8 実装ノート

- UI: `mock/src/app/components/refscope/PeriodSummaryView.tsx` を新規作成 (約 250–350 LOC 想定)。`CommitActivityGraph` と同階層に配置し、`CommitTimeline` 内で `<CompareBar>` の直下に挿入。
- 状態: `App.tsx` の既存 commit list state を入力とし、view は派生計算を行うのみ (read-only コンポーネント)。
- 集計: `useMemo` で `commits[]` から `byAuthor`, `bySubject`, `dailyBuckets` を生成。Refscope は最大 200 件のため、`useMemo` で十分に O(N) で処理可能。

---

### 4.2 Option B — Rule-based Structured Summary (推奨)

#### 4.2.1 概要

Option A の集計に加え、**確定的なテキスト/path ルール** で grouping したサマリ・カードを提供する。派生は規則のみ (LLM ゼロ)。

確定的ルール:

1. **Conventional-commit prefix 抽出** (subject に対し正規表現で literal に検出):
   - `^(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert)(\([^)]+\))?!?:` を抽出。
   - マッチしない subject は category=`uncategorized`、scope=`null`。
2. **Path top-segment grouping** (各 commit の `files[].path` から):
   - 例: `apps/api/src/foo.js` → group=`apps/api`、`mock/src/app/components/refscope/CommitTimeline.tsx` → group=`mock/src/app/components/refscope` (深さは設定可、デフォルト 2 セグメント)。
   - 1 commit が複数 path group を含む場合は重複カウント (各 group に 1 件)。
3. **Author grouping**: 既存 author graph と同じ。

#### 4.2.2 UI 構成 (概念図)

```
┌─ PeriodSummaryView (Option B) ──────────────────────────────────────────────┐
│ Period: [Today] [7d✓] [30d] [Last N]                                        │
│ Observed: 47 commits / 6 authors / +1,243 -812 / 38 files                   │
│                                                                             │
│ ╔═══ Observed (no interpretation) ════════════════════════════════════════╗ │
│ ║ - 47 commits between 2026-04-24 and 2026-05-01 (local TZ)              ║ │
│ ║ - Subjects with conventional-commit prefix: 41 / 47                     ║ │
│ ║ - Subjects without recognized prefix:        6 / 47                     ║ │
│ ╚═════════════════════════════════════════════════════════════════════════╝ │
│                                                                             │
│ ╭─── Derived from observed prefixes (rule-based, no AI) ──────────────────╮ │
│ │ feat   18 commits   +812 -201   3 authors   [Show commits →]            │ │
│ │   Top scopes: api(7), ui(6), loop(3)                                    │ │
│ │   Top subjects:                                                         │ │
│ │   • feat(api): harden git read execution                                │ │
│ │   • feat(ui): add visual summary panels                                 │ │
│ │   • feat(ui): add commit activity overview                              │ │
│ │                                                                         │ │
│ │ fix    9 commits    +120 -310   2 authors   [Show commits →]            │ │
│ │ chore  8 commits    +210 -180   2 authors   [Show commits →]            │ │
│ │ docs   6 commits     +90  -50   2 authors   [Show commits →]            │ │
│ │ uncategorized  6 commits         (no recognized prefix)  [Show →]       │ │
│ ╰─────────────────────────────────────────────────────────────────────────╯ │
│                                                                             │
│ ╭─── Derived from observed paths (rule-based, no AI) ─────────────────────╮ │
│ │ apps/api      14 commits   +680 -190   [Show commits →]                 │ │
│ │ mock/src/app  20 commits   +402 -380   [Show commits →]                 │ │
│ │ docs          6 commits     +90  -50   [Show commits →]                 │ │
│ ╰─────────────────────────────────────────────────────────────────────────╯ │
│                                                                             │
│ [Copy as Markdown release-notes draft]                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4.2.3 観察データのソース / 派生処理 / 透明性 UI

- **観察データのソース:**
  - prefix grouping: `commit.subject` (raw text)
  - path grouping: `commit.files[].path` (commit detail を grouping のために遅延取得 — §4.2.5 参照)
  - LOC 集計: `commit.added`, `commit.deleted`
  - author grouping: `commit.author`
- **派生処理:**
  - 確定的な regex / split。LLM やヒューリスティックなしの「データ整列」。
  - prefix が無い commit は `uncategorized` として隔離 (派生で「これは feat に違いない」と推測しない)。
- **派生処理の透明性 UI:**
  - "Observed" ゾーンと "Derived" ゾーンを別カードで描画。
  - "Derived" カードのヘッダに "Rule-based grouping (no AI)" と明記。
  - 各 "Derived" カードには `Show commits →` で必ず根拠 commit へ戻れる。

> 既存の `RewriteAlert` の「観察事実 vs 解釈」の運用と同じ語彙を踏襲する。Refscope はこの境界を rewrite alert で既に表現しているため、新 view も同じ視覚パターン (枠線色・"Observed" / "Derived" ラベル) を再利用する。

#### 4.2.4 既存 activity overview / author graph との関係

- **補完 + 置換 (限定的):** Option B が表示中、`CommitActivityGraph` の summary 部分 (Commits / Added / Deleted / Signed / Merge) は冗長になる可能性がある。
  - **方針:** activity overview は残す (個別 commit のヒストグラムバーが重要)。Option B の "Observed" ゾーンは数値を簡潔にし、bar chart は再描画しない。
  - author graph は削除しない。Option B の author 行は LOC を加えた拡張表として置き換え可能だが、**MVP では並置** し、ユーザーフィードバックを見てから統合判断する。

#### 4.2.5 API 側変更

A の `since` / `until` を引き継いだ上で、以下のいずれかを採用する。

**案 B-1 (最小):** 既存 endpoint の組み合わせのみ。
- `/api/repos/:repoId/commits?since&until` で list を取得 (numstat 集計は既に応答に含まれる)。
- path grouping のためには、`commit.files[].path` が必要 → 既存 `/api/repos/:repoId/commits/:hash` を per-commit に遅延取得 (高コスト)。または name-status を `commits` 応答に含める拡張を検討する (B-2)。

**案 B-2 (推奨):** 新 endpoint `/api/repos/:repoId/commits/summary?since&until&groupBy=prefix|path|author`。
- 内部で `git log --since --until --name-status --numstat --format=...` を 1 回実行。
- レスポンスは grouping 済み:
  ```ts
  type SummaryResponse = {
    period: { since: string; until: string; tz: "UTC" };
    observed: {
      totalCommits: number;
      totalAdded: number;
      totalDeleted: number;
      authorsCount: number;
    };
    groups: Array<{
      kind: "prefix" | "path" | "author";
      key: string;            // e.g. "feat", "apps/api", "shingo"
      commitCount: number;
      added: number;
      deleted: number;
      authors: string[];
      sampleSubjects: string[]; // top N raw subjects (no rewriting)
      commitHashes: string[];   // for drilldown
    }>;
    uncategorized: { kind: "prefix"; commitHashes: string[]; commitCount: number };
  };
  ```
- 上限は既存 200 commit / request を踏襲。`since/until` で範囲指定し、超過時は `truncated: true` を返して UI で警告。
- Git command allowlist 変更: **不要** (`log` は既に allowlist にあり、`--name-status` / `--numstat` も既存 `gitService.js` で使われているフラグ)。
- gitRunner hardening surface: 変わらず (引数配列、bounded stdout、`--end-of-options` 維持)。新 query parameter 検証は `validation.js` に `parseDateQuery` と `parseGroupByQuery` を追加 (allowlist 値のみ)。

#### 4.2.6 Hypothesis / 個別 KPI

- 仮説: 「conventional-commit prefix と path top-segment を確定的ルールで grouping して併置すれば、Hana は LLM 無しでもリリースノート初稿を 5 分以内に作成できる」
- 個別 KPI:
  - K2 (drilldown 率) ≥ 40%
  - K4 (Copy as Markdown 率) ≥ 20%
  - K (uncategorized 比率) を期間ごとに観測し、リポジトリの conventional-commit 採用率の health 指標として副次利用 (Refscope のメタ機能候補)。
- Fail condition: B 公開後 3 セッションで K4 < 5% なら、リリースノート向け初稿としては機能していないと判断し、Option C 仮説 (LLM narrative) を再評価。

#### 4.2.7 Pros / Cons

- Pros:
  - 派生はすべて確定的かつ説明可能。"なぜこの commit が feat に分類されたか" を `commit.subject` の literal な prefix で説明できる。
  - LLM 不要 → ローカル単独原則と完全整合、機微情報の外部送信なし。
  - 既存の rewrite alert の "observed/derived" 語彙を再利用でき、UI 一貫性が高い。
  - 200 commit 上限と整合 (期間切替で範囲を絞れば 200 件で 1 週間程度はカバー可能、超過は明示)。
- Cons:
  - 「conventional-commit を使っていない repo」では prefix grouping が `uncategorized` ばかりになる。fallback として path grouping と author grouping を必ず併置する。
  - Hana の「文章で見せて」の要望には部分応答にとどまる (派生は規則文 + raw subject 列挙であり、自然文 narrative ではない)。これは Option C への upgrade 余地。

#### 4.2.8 実装ノート

- UI: Option A の `PeriodSummaryView.tsx` を拡張。`derived` セクションは独立ファイル `DerivedRulebasedSection.tsx` として切り出し可能。テストは Storybook 風の固定 fixture (約 30–50 commits) で snapshot を取る。
- API: 案 B-2 の `/commits/summary` を `apps/api/src/gitService.js` に新関数 `summarizeCommits(repo, query)` として追加。引数は `{ since, until, groupBy }` で、内部的に既存 `commitListLogArgs` を再利用。出力は parser ヘルパで `groups[]` を組み立てる。
- テスト: `apps/api/test/gitService-summary.test.js` (新規) で fixture repo (`apps/api/test/fixtures/...` 既存パターンに従う) に対し prefix grouping / path grouping / uncategorized の 3 ケースを assert。

---

### 4.3 Option C — LLM Narrative (opt-in)

#### 4.3.1 概要

Option B の rule-based summary に加え、**ユーザーが明示的に opt-in した場合のみ**、grouping ごとの 1–3 文の自然文 narrative (例: "今週は API のセキュリティ強化が中心。`feat(api): harden git read execution` 等で gitRunner の hardening が進んだ") を生成する。

派生エンジンの選択肢 (どれか 1 つ、デフォルトは "off"):

1. **Local LLM (Ollama 等)** — `http://127.0.0.1:11434` 等のローカル endpoint。Refscope のローカル単独原則と整合する第一候補。
2. **External API (Anthropic / OpenAI 等)** — opt-in かつ明示的設定が必要。デフォルトでは disable、`RTGV_LLM_PROVIDER` のような環境変数で初めて有効化。
3. **Off** (既定) — Option B と同等。

#### 4.3.2 UI 構成 (概念図)

```
┌─ PeriodSummaryView (Option C, with LLM enabled) ──────────────────────────┐
│ ... (Option B の Observed / Derived(rule-based) ゾーンはそのまま) ...     │
│                                                                            │
│ ╭─── AI-generated narrative · opt-in · ollama:llama3.2 ───────────────────╮ │
│ │ ⚠ This text is generated by a local LLM from the observed commits.    │ │
│ │   Verify against listed commits before quoting.                       │ │
│ │                                                                        │ │
│ │ feat: API のセキュリティ周りで git 読み込みの hardening が進みました。 │ │
│ │   主な変更: gitRunner の引数検証強化、bounded stdout 維持。           │ │
│ │   Source commits: 5e8a3c1, 7d2f9b4, 9a1c4e2  [Show all 7 →]           │ │
│ │                                                                        │ │
│ │ fix: 修正は 9 件。半数は CI / build の修正。                          │ │
│ │   Source commits: ...                                                 │ │
│ ╰────────────────────────────────────────────────────────────────────────╯ │
│                                                                            │
│ [Disable AI narrative] [Regenerate] [Copy as Markdown release-notes draft] │
└────────────────────────────────────────────────────────────────────────────┘
```

#### 4.3.3 観察データのソース / 派生処理 / 透明性 UI

- **観察データのソース:** Option B が組み立てた grouping payload (`groups[]`) と raw subjects のみを LLM に渡す。diff / patch は渡さない (Refscope がローカルに保持しているとはいえ、prompt サイズと観察 / 派生境界の観点で除外)。
- **派生処理:**
  - LLM への入力は `{ period, group.key, group.commitCount, group.sampleSubjects, group.added, group.deleted }` のみに限定。
  - 出力は 1 group あたり最大 280 文字、3 文以内、引用 commit hash を必ず併記する制約をプロンプトで明示。
- **派生処理の透明性 UI:**
  - narrative ゾーンに常に "AI-generated · click to verify" ラベルと、使用 provider/model 名を表示 (例: `ollama:llama3.2`、`anthropic:claude-3-5-haiku` など)。
  - narrative の各文に対応する commit hash をリンクとして必ず表示し、"Source commits" 行から timeline へドリルダウン可能にする。
  - narrative ゾーンは "Derived (rule-based)" ゾーンとは異なる枠 (警告色) で囲み、観察 / ルール派生 / LLM 派生の 3 層が視覚的に区別されるようにする。
  - opt-in トグルは `localStorage` 永続化 + 初回有効化時に「LLM が間違える可能性 / 引用 commit を必ず確認すること / 設定で provider を選択すること」を説明する modal を 1 度表示。

#### 4.3.4 既存 activity overview / author graph との関係

- Option B と同じ。activity overview と author graph は残し、narrative はその下に opt-in で重ねる。

#### 4.3.5 API 側変更

LLM 推論は **クライアント側 (mock/UI) から呼び出す** 設計を推奨する。理由:

- API server はあくまで Git の hardened reader。LLM provider 呼び出しという「外部 endpoint への副作用」を API server に持ち込むと、現在の "no external services" 原則 (CLAUDE.md / spec-v0.md) を破る。
- ローカル LLM (Ollama) はブラウザから `http://127.0.0.1:11434` に直接リクエストできる (CORS は Ollama 側設定または `RTGV_ALLOWED_ORIGINS` 相当の Ollama 設定で許可)。
- 外部 API はユーザーが自分のキーをブラウザに保存する形にし、API server を経由させない。サーバが credential を保持しない。

API server の変更は不要 (Option B で十分)。`gitRunner` の hardening surface には触れない。

#### 4.3.6 Hypothesis / 個別 KPI

- 仮説: 「Option B の rule-based summary に LLM narrative を併置すると、Hana のリリースノート初稿時間が短縮される (ただし narrative の正確性は raw commit との突き合わせで担保される)」
- 個別 KPI:
  - K_C1 (LLM narrative 表示時の Copy as Markdown 率) > B 単体の K4
  - K_C2 (narrative ゾーンから Source commits ドリルダウン率) ≥ 30% (突き合わせ行動が起きている指標)
  - K_C3 (narrative regenerate 率) — 過度に高い (例: > 50%) 場合、narrative 品質が低い兆候
- Fail condition:
  - K_C2 < 10% (突き合わせされていない = 誤情報がそのまま転記されているリスク高) → narrative ゾーンを kill。
  - 「narrative が事実誤認」とのユーザー報告が 1 件でも来たら、その grouping の prompt 制約を点検し、引用 commit 表示を強制する制約を強化。3 件で feature 全体を opt-out 化。

#### 4.3.7 Pros / Cons

- Pros:
  - Hana の「文章で見せて」の要望に最も近い応答ができる。
  - opt-in 設計のため、Yuki (sensory-sensitive) や Tomo (パワーユーザー) は影響を受けない。
- Cons:
  - LLM の幻覚リスク。Refscope の正確性原則 (`signed: false` のままでも観測事実だけは正確) と最も衝突する選択肢。
  - 外部 API 経路を使う場合、ローカル単独原則を "opt-in でのみ破る" という形になる。明示的同意フローが不可欠。
  - 維持コスト (provider 互換性、prompt 改善、quality regression テスト) が大きい。

#### 4.3.8 実装ノート

- LLM 呼び出しはクライアント側 (UI モジュール `mock/src/app/llm/narrate.ts` 新規) に隔離。API server には触れない。
- prompt は固定テンプレート + group payload (subject / count / hash 一覧のみ) を JSON で渡し、出力 schema (各 group ごとに 1–3 文 + 引用 hash 配列) を制約。
- provider 抽象: `LLMProvider` interface を `{ generate(prompt): Promise<NarrativeOutput> }` として、`OllamaProvider` / `AnthropicProvider` / `OpenAIProvider` などを差し替え可能に。
- 設定 UI: 既存 command palette に "Configure AI narrative" を追加し、provider 種別 / endpoint / API key (該当時) を localStorage に保存。鍵は plaintext 保存 (ローカル単独前提) のため、警告文を必ず添える。

#### 4.3.9 Refscope 原則との衝突点と緩和策

| 原則 | 衝突 | 緩和策 |
|---|---|---|
| ローカル単独運用 (no external services) | 外部 API provider 利用時に破られる | デフォルト off、初回 opt-in で同意モーダル、Ollama を第一推奨 provider に |
| 観察事実のみ (`signed: false` 等) | LLM 出力は観察事実ではない | narrative ゾーンを 3 層目として明示分離、引用 commit を必須、"verify before quoting" 警告常時表示 |
| Hardened gitRunner allowlist | 影響なし (LLM 呼び出しは API server を経由しない) | API server 側に LLM ロジックを置かない設計を明文化 |

---

## 5. Recommendation

### 5.1 推奨: **Option B (Rule-based Structured Summary)**

#### 選定理由

- **AC 3 つを最小実装で満たす:**
  - 期間切替: `PeriodToggle` + `since/until` クエリで満たす。
  - 観察事実と派生の分離: "Observed" と "Derived (rule-based)" の 2 ゾーンが明示的に色 / 枠 / ラベルで分離できる。Refscope の rewrite alert と同じパターンを再利用するため、既存ユーザーにも一貫した語彙となる。
  - 根拠 commit へのドリルダウン: 各 grouping カードに `Show commits →` を持たせ、既存 timeline の filter (search / author / path) または in-place 展開で raw commits を提示できる。
- **観察 / 派生境界の透明性が最も高い:**
  - すべての派生は確定的ルール (regex / split) であり、説明可能。"なぜこの commit が `feat` に分類されたか" は subject の literal prefix で 1:1 に説明できる。
  - `uncategorized` グループの存在が「派生で勝手に分類しない」ことを可視化する。Refscope の正確性原則と最も整合する。
- **製品制約と整合:**
  - 既存 gitRunner allowlist の範囲内 (`log` のみ)。新コマンドなし。
  - 200 commit / request 上限を尊重 (`since/until` で範囲を絞り、超過時 `truncated: true`)。
  - ローカル単独運用 (LLM 依存なし)。
  - 既存 activity overview / author graph と並置可能、置換しない。
- **拡張可能性:**
  - Option B が安定運用された後に Option C を opt-in 拡張として追加できる。逆方向 (C → B) より自然な進化。
  - Option A (observed-only) は B のフォールバックとして view 内 toggle (例: "Hide derived groupings") で実現可能。

#### Impact-Effort 分類: **Quick Win** (中インパクト / 中程度実装)

- Impact: Hana の AC 3 つを満たし、cross-persona 死角 (観察 / 派生分離) にも応える。
- Effort:
  - API: 新 endpoint 1 つ (`/commits/summary`) または既存 `/commits` の `since/until` 拡張 (新コマンド不要)。
  - UI: 新 component 1 つ (`PeriodSummaryView`) + 既存 timeline との filter 連携。
  - テスト: `validation.js` の `parseDateQuery` 単体テスト、`gitService.js` の summary 関数テスト、`apps/api/test/` 配下に追加。

#### RICE Score (粗推定、`synthetic: true` のため Confidence は低めに固定)

| Factor | Value | 根拠 |
|---|---|---|
| Reach | 2 (qtr) | Refscope のローカル単独運用 / 個人〜小チーム前提。週次ペルソナ (Hana) がこの view にリーチする想定。 |
| Impact | 2 (medium) | リリースノート下書き時間の体感的短縮。チーム告知品質向上。Impact=3 (high) は当てない (synthetic ユーザーのみ)。 |
| Confidence | 50% | synthetic demand のため、Researcher による実ユーザー検証なしには 80% 以上は当てない。 |
| Effort | 1.5 (person-month) | UI コンポーネント + API 1 endpoint + テスト + ドキュメント。 |

`(2 × 2 × 0.5) / 1.5 ≈ 1.33` — RICE ranking では Medium。Refscope 全体の機能として "Hana / 非エンジニア向けの最初の一歩" として優先度妥当。

### 5.2 段階的ロードマップ

| Stage | スコープ | 関連 Option |
|---|---|---|
| MVP | client-side filter のみ (API 変更ゼロ)、Observed ゾーン + 確定的 prefix grouping | A の subset + B の prefix のみ |
| v1 | `/commits/summary` 新 endpoint、path grouping 追加、Copy as Markdown | B 完全版 |
| v1.5 | "Hide derived groupings" toggle (Yuki への配慮: quiet mode 連携で derived ゾーンを折り畳み) | A への動的フォールバック |
| v2 (opt-in) | LLM narrative ゾーン (ローカル Ollama 優先、外部 API は明示的 opt-in) | C |

---

## 6. Cross-Persona Friction (round 1/2 死角への応答)

| Persona | 期間サマリビューとの関係 | 緊張点 | 提案の扱い |
|---|---|---|---|
| Hana | 主要対象 | リッチな narrative を求めるが、Refscope の正確性原則と緊張 | B でルール派生にとどめ、C を opt-in 拡張に |
| Tomo | 関心薄 (file-level history の方が重要) | Period summary は repo 全体集計で、Tomo の path-deep dive とは別レイヤー | view が Tomo を妨害しないこと (timeline 上にあくまで補助セクションとして配置) を確認 |
| Yuki | quiet mode 連携 | "Derived" ゾーンの色 / アニメーションは集中作業中に妨害になりうる | quiet mode 中は "Derived" ゾーンを自動で折り畳む。`prefers-reduced-motion` 連動。 |
| Ken | 関心薄 (分単位の boot recap が重要) | 期間は週単位の話で、Ken の 30 分単位とは別 | period toggle に "Last 30 minutes" を含めれば限定的に Ken のニーズも触れる。が、本 RFC のスコープ外。 |

> Hana と Yuki の緊張 (richer narrative vs quieter UI) は smoothing せず、quiet mode 中は派生ゾーンを抑制する設計で両立させる。

### 6.1 Non-consumption framing

- 競合は「他の Git ビュアー (GitKraken、Sourcetree、gh CLI)」ではなく、Hana が現在実際にやっている代替行動 (= "non-consumption"):
  - GitHub Web UI で commit history をスクロールしながらスクリーンショットを取る。
  - 開発者に「今週何やった?」と Slack で聞いて回る。
  - リリースノート無しで、PR title をコピペするだけ。
- 上記 3 つはすべて「観察 vs 派生の分離が無い」「期間境界が不明瞭」「ドリルダウン不能」の特徴を持つ。Period Summary View はこれらの「コピペ + 口頭聞き取り」を Refscope 内で完結させる。

---

## 7. Validation Strategy

1. **MVP リリース後、ローカル KPI を 4 週間収集** (K1–K5)。
   - 計測は localStorage に保存し、Refscope の既存 "no external services" 原則を破らない。
   - debug toggle で同一画面に raw KPI snapshot を出せるようにし、ユーザー自身が確認可能とする (透明性)。
2. **Researcher による軽量定性検証:** Hana 相当の非エンジニア 3–5 名にリリースノート下書きタスクを与え、(i) CommitTimeline 直のみ、(ii) Option B の view 利用、の 2 条件で初稿完了時間と転記精度を比較。
   - 検証セッションあたり 1 リポジトリ × 1 期間 (今週)、所要 30–45 分。
   - 質問項目: 「派生 (Derived) と観察 (Observed) の境界はどこで認識したか?」「LOC 集計は信用したか / しなかったか?」「`uncategorized` グループは混乱を招いたか?」
3. **Fail Condition 監視 (kill criteria 再掲):**
   - K2 (drilldown 率) < 15% → view を凍結し A への退避を検討。
   - K4 (Copy as Markdown 率) < 5% → リリースノート用途として無効と判定し、Option C (LLM narrative) の opt-in 試験へ進むかを再評価。
   - "派生情報が事実と異なる" 報告が 1 件 → grouping ロジックを点検 (regex 追加 / 除外ルール追加)、ユーザーに修正版で再現確認。3 件で feature 全体を opt-out 化。
4. **Round 3 demand collection:** Plea を再起動し、Option B 公開後の新たな死角 (例: "リリースノートは subject ではなく PR title が欲しい"、"merge commit を grouping から除外したい") を探る。

### 7.1 セキュリティ / プライバシ追加レビュー項目 (本 RFC 由来)

- `parseDateQuery` の入力検証境界が、`gitRunner` の `--end-of-options` 後の引数として正しく扱われることをテスト (`apps/api/test/` に追加)。
- `--since` / `--until` の値が制御文字 / 負値 / 巨大値に対して reject されることを確認。
- 新 endpoint `/commits/summary` のレスポンスサイズが `RTGV_DIFF_MAX_BYTES` 以下に収まることを確認 (200 commit × 数十 path × subject による payload 上限見積)。
- Option C を opt-in にした場合、外部 API への送信内容が group payload (subject / count / hash 一覧) に限られ、diff / patch を含まないことを実装で強制 (送信前 schema validation)。

---

## 8. Assumptions

0. 本提案は `synthetic: true` (Plea 由来) の仮説であり、実ユーザー検証 (Researcher による定性 + ローカル KPI 収集) の前にロードマップ化しない。
1. Refscope を見ているユーザーは少なくとも repo の commit 命名規則 (conventional-commit を使っているかどうか) を知っている。`uncategorized` 比率が高いリポジトリでは Option B の価値が低下する。
2. Hana のリリースノート用途では、observed subject + LOC 集計だけで「初稿の素材」としては十分であり、自然文 narrative は必須ではない。
3. 200 commit 上限は週次レベル (今週 / 直近 7 日) では実用上問題ない。月次で超える可能性があり、その場合は `truncated: true` の警告が必要。
4. localStorage への opt-in 設定永続化は許容される (Refscope 既存の repo 切替や filter 状態と同じ範疇)。
5. ローカル LLM (Ollama 等) を使う Option C は、ユーザーが自分でセットアップする前提。Refscope は推論サーバを bundle しない。

---

## 9. Open Questions (Clarifying Questions)

1. **期間境界の TZ:** "今週" は repo の commit `authorDate` ベースか、ユーザーの local TZ か。Refscope は ISO-strict で保持しているため、UI 側で local TZ に変換するべきか、UTC のまま見せるべきか?
2. **path grouping の深さ:** デフォルト 2 セグメント (`apps/api`) で良いか、それとも repo ごとに調整可能とすべきか?
3. **`uncategorized` の扱い:** prefix が無い commit を `uncategorized` として 1 グループにまとめるか、別 view (例: "Subjects without prefix") に出すか?
4. **Copy as Markdown のフォーマット:** 出力テンプレートはどう固定するか? 社内告知 / GitHub Release / 内部 wiki の 3 形式を提供すべきか?
5. **drilldown の方法:** 既存 timeline に search filter を適用 (URL query 経由) するか、PeriodSummaryView 内に展開リストを inline で出すか? 前者は既存 UI 一貫性、後者は context 喪失防止。
6. **Option B と既存 activity overview の統合タイミング:** v1 ではバラバラに置くが、v1.5 以降に "summary tab" として activity overview と PeriodSummaryView を切替式にするか、ずっと並置するか?
7. **multi-repo 跨ぎサマリの可否:** 現行 API は repoId 単位だが、Hana は複数 repo を週次でまとめたい可能性がある。本 RFC は単一 repo に限定するが、将来拡張の need 度を別途 Plea に問うべきか?

---

## 10. Handoff

### Suggested next agent: **Rank** (priority scoring)

- 理由: 本提案は単一機能だが、cross-persona の round 2 demand 4 件 (Hana / Tomo / Yuki / Ken) のなかで Hana のもの。Rank で 4 つ並べて urgency × frequency × persona breadth で順序付けし、ロードマップの NEXT を決めるべき。
- 代替: Researcher (synthetic 仮説の実ユーザー検証を先行)、Accord (本 RFC を L0–L3 spec として packaging)。

### Artifacts produced

- `docs/spark-period-summary-proposal.md` (this file)

### Risks (top)

1. **派生境界が UI 実装で曖昧になるリスク:** "Derived" ゾーンの色 / 枠が `CommitActivityGraph` と視覚的に近づきすぎると、ユーザーは observed と derived を混同する。実装時に既存 rewrite alert と同じ枠線色 / "Observed" / "Derived" ラベルを再利用すること。
2. **conventional-commit 採用率に依存:** prefix grouping の有用性は repo の規律次第。`uncategorized` 比率が 30% を超えると view 全体の有用性が低下する。期間サマリ自体に "prefix recognition rate: 88%" のメタ表示を入れることで、この事実をユーザーに見える化する。
3. **200 commit 上限と期間切替の整合:** "this month" を選んだ際に 200 commit を超えるリポジトリでは、サマリが片側に偏る。`truncated: true` を必ず警告し、可能なら "expand to last 200 commits in period" のような明示的な fallback ボタンを提供する。

---

_STEP_COMPLETE:
  Agent: Spark
  Status: SUCCESS
  Output: |
    Period Summary View RFC を 3 options (派生強度スペクトラム: A 観察のみ / B ルールベース / C LLM opt-in) で提示。
    Hana の AC 3 つ (期間切替 / 観察 vs 派生分離 / 根拠 commit ドリルダウン) に各 option がどう応えるかを明示。
    推奨は Option B (rule-based、LLM 不要、既存 gitRunner allowlist 内で実装可能、observed/derived 境界が確定的)。
    KPI はローカル単独で観測可能なものに限定 (period toggle 操作率、drilldown 率、Copy as Markdown 率)。
    API 拡張は新コマンドなし (`log --since --until --name-status --numstat` の組合せ) で `validation.js` に `parseDateQuery` 追加、新 endpoint `/commits/summary` を提案。
    既存 activity overview / author graph は補完関係 (置換しない、quiet mode 連動で folding)。
    Open questions 6 件、assumptions 5 件、kill criteria 明記。
  Artifacts:
    - /Users/shingoimota/repos/github/refscope/docs/spark-period-summary-proposal.md
  Risks:
    - "Derived" ゾーン UI が CommitActivityGraph と視覚的に混ざると観察/派生の混同が起きる
    - conventional-commit 採用率が低い repo で prefix grouping の uncategorized 比率が上がり、view 価値が下がる
    - 200 commit 上限により "this month" 等の長期間で truncation が発生し、サマリが偏るリスク
  Next: Rank (round 2 demand 4 件を urgency x frequency x persona breadth で並べ、本 RFC の優先度を確定)
  Reason: 全 AC を 3 派生強度で網羅、推奨 + KPI + fail condition + open questions を含む合意可能な RFC を生成できたため SUCCESS。
