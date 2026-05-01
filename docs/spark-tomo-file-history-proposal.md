# Spark Proposal: File-Level History View (Refscope)

> Synthetic demand source: `docs/user-demand-report-2026-05-01.md` — Tomo (パワーユーザー / OSS メンテナー / 数万 commit の monorepo)
> `synthetic: true` — このドキュメントは Plea が生成した合成ユーザー需要に基づく仮説提案であり、実ユーザー検証前の提案である。
> 上位エージェント: Plea (synthetic user advocate) → Spark (this document) → Researcher / Accord / Sherpa (next).
> ロードマップ位置: **v2 候補 (MVP 範囲外)**。`docs/rank-round2-priority.md` §10.1 (Tomo = 4 位 / MoSCoW Could) と §10.2 (range out 推奨だが Won't ではなく Could) と整合。本 RFC は「v2 として packaging 可能か」を判断するための事前設計。
> 範囲: 既存 `CommitTimeline` を **変えない**。新たに `FileHistoryView` という分離 view を追加し、cursor pagination と Git の rename 検出 (literal output) を表示する。

---

## 0. Summary

- 対象ペルソナ: Tomo (数万 commit の monorepo を長期保守する OSS メンテナー / パワーユーザー)。
- 解こうとしている job-to-be-done: 「`src/lib/parser.ts` のような 1 ファイルの 2 年分の歴史を、200 commit/request の壁とリネーム断絶に阻まれずに、timeline 全体を変えずに辿る」。
- 現状の死角:
  - `/api/repos/:repoId/commits` は `path` filter で絞り込めるが、`limit` は最大 200 で hard limit。長期メンテナンスでは数日分にもならない。
  - リネームを跨ぐ history は `git log` の standard output では切れる。Refscope は commit detail / diff レベルでは `--find-renames` を使うが、history list 側では使っていない。
  - file-level の作業領域は repo 全体 timeline と別であるべきだが、UI 上にそういった view が存在しない。
- 提案: `FileHistoryView` という timeline と分離した view を追加し、(a) 専用 file-history endpoint、(b) cursor pagination、(c) Git literal な rename 検出証拠の表示、を組み合わせる。
- 派生強度 3 段階の options:
  - **Option A (Minimal Cursor Extension):** 既存 `/commits` endpoint に cursor pagination を追加するのみ。rename は表示しない。**派生 0**。
  - **Option B (Dedicated `/files/history` endpoint with `--follow`, recommended):** 新 endpoint で `git log --follow --name-status` を使い、Git が報告する rename を **literal output として** UI に出す。**派生強度 中** (Refscope は「これは rename」と独自判断しない)。
  - **Option C (B + tunable `--find-renames=NN%` + year-jump UI):** B に加え、similarity threshold をユーザーが調整可能にし、year-bucket index で過去にジャンプ。**派生強度 高** (threshold は派生)。
- 推奨: **Option B**。最小実装で AC 3 つを満たし、観察 (Git literal output) と派生 (UI 表示) の境界を最も透明にできる。
- 200 commit/request **hard limit は変えない**。1 page = 200 commit、cursor を opaque base64 (`(authorDate, hash)` ペア) で過去方向 pagination する。
- gitRunner allowlist (`cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`) **変更不要** (`log` のみで実装可能)。
- Open questions 8 件、assumptions 7 件を末尾に明示。
- Hand-off recommendation: **Researcher** (大規模 repo maintainer の実ユーザー検証で reach / confidence 引き上げ → v2 GO/NO-GO 判断)。

---

## 1. Context Read (本提案の前提)

| 参照 | 用途 |
|---|---|
| `CLAUDE.md` | API は `apps/api/src/` で hardened gitRunner 経由。command allowlist は `cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`。新コマンド追加は禁止。 |
| `README.md` | `/api/repos/:repoId/commits` は `ref / limit / search / author / path` を受け、limit は最大 200 で **hard limit**。`signed: false` / `signatureStatus: "unknown"` 固定。 |
| `docs/spec-v0.md` | プロダクトはローカル単独。MVP は最新 100 件 commit 中心。 |
| `docs/user-demand-report-2026-05-01.md` (Tomo セクション) | AC 3 つ: cursor pagination / rename 検出根拠 / timeline と分離 view。 |
| `docs/rank-round2-priority.md` §9 / §10 | 整合性 flag: 「cursor pagination は API protocol の新規追加」「`--follow` / `--find-renames` は `log` allowlist 内」。Tomo は MoSCoW Could、v2 候補。 |
| `docs/spark-period-summary-proposal.md` | 章立て / 観察 vs 派生の語彙 / OST / Hypothesis-KPI-FailCondition 形式の踏襲元。 |
| `apps/api/src/gitService.js` | `listCommits` は `commitListLogArgs(limit, search, author, revision, pathArgs)` で `git log --max-count=N --numstat ... -- pathspec`。pathspec は `formatLiteralPathspec` で `:(literal,top)<path>`。`getCommit` / `getDiff` 側は既に `--find-renames` を使うが list 側は使わない。 |
| `apps/api/src/gitRunner.js` | `--end-of-options` 必須、引数配列 spawn、bounded stdout、`GIT_*` 環境スクラブ、200 commit limit は `validation.js` 側。 |
| `apps/api/src/validation.js` | `parsePathQuery` は既に file/dir 両対応 (`:(literal,top)`)。`parseLimitQuery(value, fallback, max=200)` の **hard cap = 200** を本提案でも踏襲。新規 `parseCursorQuery`, `parseSimilarityQuery` を追加する想定。 |
| `mock/src/app/App.tsx` | 単一 state owner。`commits / selected / search / author / path / compareBase / compareTarget / quietMode` を集中管理し、子に props 配布。`FileHistoryView` も同パターンで増設する。 |

### 1.1 観察データ (observed facts) として確定的に得られるもの

`gitService.js` の現状実装と本 RFC の `--follow` 利用から、以下は raw observed data:

- `commit.hash`, `commit.shortHash`, `commit.parents`
- `commit.subject`, `commit.author`, `commit.authorDate`
- `commit.added` / `commit.deleted` / `commit.fileCount` (numstat 集計)
- `git log --follow --name-status` が返す literal な status code:
  - `M\t<path>` (modified — 同名 path)
  - `A\t<path>` (added)
  - `D\t<path>` (deleted)
  - `R<NN>\t<oldPath>\t<newPath>` (rename, similarity NN%)
  - `C<NN>\t<srcPath>\t<newPath>` (copy, similarity NN%)
- 上記 `R<NN>` の **NN は Git が計算した similarity 数値 (0–100)** であり、Refscope の派生ではない。
- `git log --follow` が一連の history として連結した結果 (どこが rename 境界かは name-status 行で literal に分かる)。

### 1.2 派生 (inferred / interpreted) として明示すべきもの

- **「rename と判定した」根拠の解釈**: Git の `R<NN>` が出ているのは Git による rename 検出結果である。Refscope の UI は「This commit is a rename」と独自判断しない。代わりに「Git reported: rename, similarity NN%, old → new」と **literal に転記**。
- **page boundary の意味付け**: cursor の境界は `(authorDate, hash)` で機械的に定まる。「ここから先が古い history」というユーザー向け表現は派生 (UI labelling)。
- **"年単位 jump" の概念マッピング**: Option C の year bucket は `authorDate.getFullYear()` を Refscope が集計した派生。Git の literal output ではない。
- **similarity threshold の解釈**: `--find-renames=NN%` の閾値選択はユーザー設定で、Refscope 自体が「妥当な閾値」を決めない。デフォルト値だけは Refscope の派生。
- **「過去/未来方向」**: `git log` のデフォルトは reverse-chronological (新→古)。Refscope の cursor は「過去方向への next page」と「未来方向への prev page」を opaque cursor で双方向に扱うが、その方向の labelling は派生。

---

## 2. Outcome Solution Tree (OST)

```
Outcome:
  Tomo が `src/lib/parser.ts` のような単一 file の 2 年分 history を
  timeline 全体を変えずに、200 commit/page を超えて掘り続けられる
  (KPI: file-history view への drilldown 率, page-through 深度, rename traversal 率,
   timeline 状態保持率, 嘘 context 報告 0 件)
   │
   ├─ Opportunity 1: 200 commit/request 上限で過去への旅が止まる
   │     └─ Solution: opaque cursor pagination (1 page = 200 commit、過去/未来双方向)
   │
   ├─ Opportunity 2: rename を跨ぐと history が切れて誤判断する
   │     └─ Solution: `git log --follow` を使い、Git の literal name-status を
   │                  そのまま rename evidence として UI に提示する
   │
   ├─ Opportunity 3: file-level の作業と timeline 全体作業が同 view で混ざる
   │     └─ Solution: FileHistoryView を timeline と分離した overlay/route として実装、
   │                  既存 timeline state (selected ref / commit / filters) を保持
   │
   └─ Opportunity 4: rename 検出は false positive がありうる (例: 完全書き換え)
         └─ Solution: similarity NN% を必ず表示、threshold を Option C で開示
```

このうち単一 RFC としては「File-Level History View」。AC 3 つを 1 view に集約する。

### 2.1 Tomo の AC マッピング (全 option 共通)

| AC | 設計上の対応 | Option 別差分 |
|---|---|---|
| path filter 適用時に cursor ベースで過去方向へページングできる | view 上部に `[Older 200 →]` ボタン、cursor は opaque base64 で server から返す。1 page = 最大 200 commit (hard limit 維持)。 | A は既存 `/commits` 拡張、B は新 endpoint `/files/history`、C は B + year-bucket jump。 |
| リネーム検出と検出根拠が表示される | name-status 行が `R<NN>\told\tnew` になる commit に対し、`Renamed from old → new (Git similarity NN%)` を観察ラベルとして表示。 | A は表示なし。B/C は表示あり。C は閾値変更 UI あり。 |
| file-level history が timeline と分離された view で操作できる | `FileHistoryView` を overlay drawer (推奨) / route / panel のいずれかで実装。timeline 側の state (selected ref / commit / filters / compareBase/Target) は保持。 | A/B/C 共通。詳細比較は §6。 |

---

## 3. Hypothesis & KPIs (全 option 共通枠)

### 3.1 Hypothesis (testable)

> 「Refscope に file-level 専用の history view を追加し、(a) opaque cursor で 200 commit/page を超えて過去にページングでき、(b) Git の `--follow` literal output を rename evidence として表示し、(c) timeline 全体の状態を保ったまま開閉できれば、Tomo のような数万 commit monorepo の長期メンテナーは、`src/lib/parser.ts` の 2 年分の history を timeline 全体の文脈を失わずに調査できる」

### 3.2 KPIs (Refscope はローカル単独運用なので、ローカルで観測可能なものだけ)

| KPI | 観測方法 (ローカルで完結) | 目標値 (synthetic) |
|---|---|---|
| K1: FileHistoryView を開いた回数 / commit detail を開いた回数 | クライアント in-memory counter、optional な session metrics overlay | ≥ 20% (1 セッション中 5 回 detail を開いたら 1 回は file-history を開く) |
| K2: cursor で next page を踏んだ深度 (中央値) | 同上、`pageDepth = max page index reached per session` | 中央値 ≥ 2 page (= 200 commit を超える page-through が普通になる) |
| K3: rename evidence が表示された commit を含む history を traverse した率 | rename evidence カードを含む page を `pageDepth` 以下に展開した割合 | ≥ 30% (rename を跨ぐ調査が実用化されている指標) |
| K4: FileHistoryView open/close 後に timeline 側 selected ref / selected commit / filters が保持された率 | open 前後の state スナップショット差分 | ≥ 99% (state 喪失 = 致命的バグ、ほぼ常に保持されるべき) |
| K5: 「rename と表示されたが実際は異なる」報告件数 | ユーザーフィードバック (定性、件数のみ) | 0 件 (1 件出たら派生表現を調査、3 件で view 全体を opt-out 化) |

> KPI は「ローカル単独で集計可能」を満たすため、telemetry をリモート送信せず、`localStorage` または in-memory に置く。Refscope の "no external services" 原則と整合。

### 3.3 Fail Condition (kill criteria)

- 30 日 (調査タスク 5–10 セッション相当) のローカル試用で、K2 (中央値 page 深度) < 1.2 page なら、「200 commit/page で実は十分」とみなし、Option A への scope-cut を検討。
- K1 < 5% (file-history は誰も使っていない) なら、view 自体を default-hidden にし、command palette からのみ開く形に縮退。
- K3 < 10% なら、rename traversal が実需を満たしておらず、Option B 推奨理由が弱まる → Option A に縮退。
- K5 ≥ 1 件で grouping ロジックを点検、3 件で view 全体を opt-out 化 (Refscope の正確性原則 = 観察 / 派生分離が崩れたとみなす)。

---

## 4. Feature Options

派生強度のスペクトラムを以下 3 段で並べる。

| Option | 派生強度 | 主な技術 | UI 透明性ライン |
|---|---|---|---|
| A | 0 (cursor only) | 既存 `/commits` を cursor 拡張、rename 表示なし | "All values are observed git log output" の 1 行ラベル |
| B | 中 (rename evidence as Git literal) | 新 endpoint `/files/history` で `git log --follow --name-status` | "Git reported rename — similarity NN% (Git literal output, no Refscope inference)" |
| C | 高 (tunable threshold + year-jump) | B + `--find-renames=NN%` + `authorDate` bucket index | "Threshold NN% is your choice — lower = more renames detected, higher = stricter" |

---

### 4.1 Option A — Minimal Cursor Extension

#### 4.1.1 概要

- 既存 `/api/repos/:repoId/commits` に `cursor` query parameter を追加。`path` filter と組み合わせると file-level の page-through ができる。
- rename 検出は **行わない**。`--follow` も使わない。
- UI は新 view を作らず、既存 timeline に「Older 200 →」ボタンのみ追加。

#### 4.1.2 UI 構成 (概念図)

```
┌─ CommitTimeline (existing) ─────────────────────────────────────────────────┐
│ [filter: path = src/lib/parser.ts] (既存 path filter) [✕]                  │
│ • feat(parser): handle nested options    a3886c · 2026-04-15                │
│ • fix(parser): off-by-one on EOF        7d2f9b · 2026-04-12                 │
│ ... 200 commits ...                                                         │
│ • chore: rename module folder           548682f · 2024-08-04                │
│ ─────────────────── End of page 1 (200 commits) ───────────────────────── │
│ [Older 200 →]   ← 新規追加 cursor button                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4.1.3 観察データのソース / 派生処理 / 透明性 UI

- **観察データのソース:** 既存 `git log --max-count=200 ... -- <path>` の出力。
- **派生処理の有無:** ほぼなし。cursor の opacity (base64 化) のみ Refscope の派生。
- **透明性 UI:** "Showing observed git log output, paged 200 at a time. Renames are not crossed in this view." を 1 行明記。

#### 4.1.4 既存 timeline との関係

- **同 view 内の拡張**。AC #3 (timeline と分離 view) は **満たさない**。
- これが Option A の最大の欠点。Tomo の demand は「timeline 全体の見た目を変えずに、このファイルだけの page-through」であり、同 view 内に拡張すると timeline 全体の state を file-deep dive 中に汚染するリスクがある。

#### 4.1.5 API 側変更

- 既存 `GET /api/repos/:repoId/commits` に `cursor` を追加 (詳細は §5)。
- `validation.js` に `parseCursorQuery` を追加 (詳細は §5.3)。
- gitRunner allowlist 変更: **不要**。
- 新コマンド: なし。
- 新 endpoint: なし。

#### 4.1.6 Hypothesis / 個別 KPI

- 仮説: 「rename 検出は不要で、cursor だけあれば長期メンテナンス調査が成立する」。
- 個別 KPI: K2 (page 深度中央値) ≥ 2 page、K3 (rename traversal 率) は計測対象外 (rename を表示しないため定義不能)。
- Fail condition: K2 < 1.5 page なら、cursor は使われていない = MVP 200 件で実用十分という null hypothesis を支持する。

#### 4.1.7 Pros / Cons

- Pros:
  - 実装最小 (新 endpoint なし、新 UI component 最小)。
  - rank §9 の「cursor pagination は protocol 追加 = 注意」flag に対し、**追加 surface を最小化** できる (新 endpoint 不要、既存 endpoint の拡張のみ)。
- Cons:
  - **AC #3 を満たさない** (timeline と分離 view が無い)。これは strict 要件として宣言されているため Option A は不採用候補。
  - **AC #2 を満たさない** (rename 検出と根拠表示なし)。Tomo の「リネームを越えてもらいたい」voice と直接衝突。
  - 結果として Option A は本 RFC の "null hypothesis" 位置付け: 「cursor だけで足りるか」を測る対照群としては有用だが、Tomo の demand fulfillment としては不十分。

#### 4.1.8 実装ノート

- API: `gitService.js` の `listCommits` に cursor 引数を追加。`git log` には `--max-count=200` の他、cursor 由来の `--until=<authorDate>` または revision `<hash>~1` を渡す設計が考えられる (詳細は §5.5 で trade-off)。
- UI: `CommitTimeline.tsx` の末尾に "Older 200 →" ボタンを追加。

---

### 4.2 Option B — Dedicated `/files/history` endpoint with `--follow` (推奨)

#### 4.2.1 概要

- 新 endpoint `GET /api/repos/:repoId/files/history?path=&cursor=&limit=` を追加。
- 内部は `git log --follow --name-status --numstat --format=... -- <path>` で 1 file の history を rename 越しに辿る。
- cursor pagination は Option A と同形 (`(authorDate, hash)` opaque base64)。1 page = 最大 200 commit。
- rename evidence は **Git の literal `R<NN>\told\tnew` をそのまま** payload に格納し、UI で「Git reported rename — similarity NN%」と表示。Refscope の独自判断は入れない。
- timeline と分離した `FileHistoryView` を `App.tsx` 配下に追加 (UI 詳細は §6)。

#### 4.2.2 UI 構成 (概念図)

```
┌─ FileHistoryView (overlay drawer, opens over CommitTimeline) ───────────────┐
│ File: src/lib/parser.ts            [✕ Close — return to timeline]           │
│ ── Observed (from `git log --follow --name-status` against path) ────────── │
│ Path filter: src/lib/parser.ts (this view tracks renames automatically)     │
│ Showing 200 of N+ commits. Use [Older 200 →] / [← Newer 200] to page.       │
│                                                                             │
│ • feat(parser): handle nested options    a3886c · 2026-04-15  +42 -7        │
│ • fix(parser): off-by-one on EOF        7d2f9b · 2026-04-12  +5 -2          │
│ ...                                                                         │
│ ╭─ Rename evidence (Git literal output) ──────────────────────────────────╮ │
│ │ Git reported: R95  src/utils/parser.ts → src/lib/parser.ts              │ │
│ │ commit: 9a1c4e2 · 2024-08-04                                            │ │
│ │ similarity: 95% (Git's --find-renames default)                          │ │
│ │ Note: This is Git's calculation, not Refscope inference.                │ │
│ ╰──────────────────────────────────────────────────────────────────────────╯ │
│ • feat(utils): factor parser into utils  548682f · 2024-08-01               │
│ ...                                                                         │
│ [Older 200 →]                                                               │
│                                                                             │
│ — End of file history (or [Show all renames so far]) —                      │
└─────────────────────────────────────────────────────────────────────────────┘

  Behind the drawer: CommitTimeline keeps selected ref / commit / filters.
```

#### 4.2.3 観察データのソース / 派生処理 / 透明性 UI

- **観察データのソース:**
  - `git log --follow --name-status --numstat --format=...` の literal output。
  - 1 record あたり: `hash`, `parents`, `authorDate`, `subject`, `author`, `name-status` line(s), `numstat` line(s)。
  - rename commit では name-status が `R<NN>\t<oldPath>\t<newPath>` になる。NN は Git が計算した similarity 数値。

- **派生処理:**
  - cursor の opacity (base64 encoding)。
  - "End of history" 表示 (server が「もう古いコミットなし」と判断するのは `--follow` の終端 = Git literal だが、UI 表現は派生)。
  - 「Renamed from X to Y」という表現は Git の literal `R<NN>` を人間可読にしただけだが、文章化は派生。

- **透明性 UI:**
  - rename evidence カードのヘッダに **必ず** `Git reported rename — similarity NN% (literal output of git log --follow --name-status)` を表示。
  - "Note: This is Git's calculation, not Refscope inference." を文末に固定表示。
  - similarity 数値はそのまま表示 (例: 95% であり、Refscope は丸めない)。
  - `R` 以外の status code (`M / A / D / C<NN>`) もすべて Git literal 通り表示。`C` (copy detection) が出る場合は `--find-copies` 由来なので Option B の default では出ないが、Option C で同等の透明性を要求する。

> 既存 `RewriteAlert` (`docs/spark-period-summary-proposal.md` §4.2.3 と同じ語彙) の「観察事実 vs 解釈」運用を踏襲する。"Git reported X" は観察、"Refscope decided this is a rename" は **書かない**。

#### 4.2.4 既存 timeline との関係

- **完全に分離 view (drawer overlay)**。timeline 自体は変えない。
- timeline と FileHistoryView の data flow:

```
App.tsx (state owner)
 ├─ timeline state: { selectedRepo, selectedRef, commits, selected, search, author, path, compareBase, compareTarget, ... }
 ├─ fileHistory state (NEW): { open: boolean, filePath: string, cursor: string|null, items: Commit[], hasMore: boolean }
 │     └─ open() は timeline state を一切変更しない
 │     └─ close() は timeline state をそのまま元に戻す (= 何もせず drawer を閉じる)
 └─ children:
     - CommitTimeline (props: timeline state)
     - FileHistoryView (props: fileHistory state, callbacks for cursor/path)
```

- AC #3 strict: open / close の前後で timeline 側の `selected` / `selectedRef` / filters / `compareBase` / `compareTarget` / scroll 位置が **保持される** ことを E2E 系テストで保証 (K4)。

#### 4.2.5 API 側変更

- **新 endpoint**: `GET /api/repos/:repoId/files/history?path=&cursor=&limit=&ref=`
- **既存 endpoint への変更**: なし (既存 `/commits` は触らない)。
- **gitRunner allowlist**: 変更不要 (`log` のみ使用)。
- **新コマンド**: なし。
- **新 query 検証**: `validation.js` に `parseCursorQuery` を追加 (詳細 §5.3)。`parsePathQuery` は既存をそのまま使用 (file pathspec として動作)。
- **応答 schema** (詳細 §5.2):

```ts
type FileHistoryResponse = {
  path: string;                // echoed input
  ref: string;                 // resolved commit hash (rev-parse 済み)
  items: Array<{
    hash: string;
    shortHash: string;
    parents: string[];
    subject: string;
    author: string;
    authorDate: string;        // ISO-strict
    added: number;             // numstat for this file
    deleted: number;
    nameStatus: {
      code: "M" | "A" | "D" | "R" | "C";
      // Git literal — for renames the line is "R<NN>\t<old>\t<new>"
      raw: string;             // verbatim "R95" / "M" / etc.
      similarity: number | null; // 0-100 if R/C, else null. Source: Git literal NN.
      oldPath: string | null;  // present only for R/C
      newPath: string;         // always echoed (= path under view at this commit)
    };
  }>;
  pageInfo: {
    hasMore: boolean;          // true if more older commits exist
    nextCursor: string | null; // opaque base64 (next older page)
    prevCursor: string | null; // opaque base64 (previous newer page) — see §5.4
  };
  observedSource: "git log --follow --name-status --numstat";
  truncated: boolean;          // true if --max-count=200 hit and pageInfo.hasMore is also true
};
```

- **Git command (concept)**:

```text
git log
  --follow
  --max-count=200
  --date=iso-strict
  --format=<RECORD_SEP>%H%x00%P%x00%an%x00%aI%x00%s
  --no-show-signature
  --name-status
  --numstat
  --no-ext-diff
  --no-textconv
  --end-of-options
  <resolved-commit-hash>
  --
  :(literal,top)<path>
```

  - cursor 適用時は revision 引数を `<resolved-commit-hash>` から `<cursor-hash>~1` 等に置き換える (§5.5 で複数案を比較)。
  - `--follow` は `git log` で **path が 1 つに限られている時のみ動作**する制約があるため、本 endpoint は path scalar を強制 (multi-path follow は不可)。
  - `--find-renames` を明示しない場合、Git default similarity (デフォルト 50%) で rename を検出する。Option B では default に固定。
  - allowlist: `log` は既に許可済み。フラグはすべて allowlist に抵触しない (`--end-of-options`、bounded stdout、`shell: false`、引数配列はそのまま維持)。

- **200 commit/page hard limit との整合**: `parseLimitQuery(value, fallback=100, max=200)` を踏襲。`--max-count=200` を超えない。`pageInfo.hasMore=true` で「次の 200 件は cursor で取れる」ことを表現。

#### 4.2.6 Hypothesis / 個別 KPI

- 仮説: 「Git の `--follow` literal output を transparent に提示すれば、Tomo は誤判断なく rename を越えて history を辿れる」。
- 個別 KPI:
  - K2 (page 深度) ≥ 2 page
  - K3 (rename traversal 率) ≥ 30%
  - K5 (誤情報報告) = 0 件
- Fail condition: K3 < 10% で「rename を越える調査は実需が薄い」とみなし Option A に scope-cut。K5 ≥ 3 で view 全体を opt-out 化。

#### 4.2.7 Pros / Cons

- Pros:
  - **AC 3 つを最小実装で満たす**。
  - 派生は cursor opacity と「rename」labelling のみで、すべて Git literal output に裏付けられる。
  - gitRunner allowlist 変更なし、`log` の既存利用範囲内。
  - Refscope の "Observed vs Derived" 語彙 (rewrite alert / period summary) と統一できる。
  - similarity 閾値はデフォルトで Git に任せ、Refscope はチューニングしない (= 派生強度が低い)。
- Cons:
  - `--follow` は **path が 1 つに限られる** Git の制約があり、multi-file follow ができない。設計上 single-file 専用と明示する必要がある。
  - false rename (例: 完全書き換えで偶然 50% 類似) のリスク。これは Git の検出特性であり、similarity NN% を必ず表示することで「ユーザーが判断する」設計に倒す。
  - cursor pagination は API protocol 新規追加 (rank §9 整合性 flag)。Option A と比べ surface が大きい。

#### 4.2.8 実装ノート

- API: `apps/api/src/gitService.js` に `listFileHistory(repo, query)` を新設。`commitListLogArgs` を再利用しつつ `--follow` と `--name-status` (numstat と同時) を加えた variant を作る。response parser は既存 `parseCommitRecords` を拡張し、各 record の name-status 行を抽出して `nameStatus` フィールドに格納する。
- API: `apps/api/src/http.js` に新 route `GET /api/repos/:repoId/files/history` を追加。
- API: `apps/api/src/validation.js` に `parseCursorQuery` を追加 (§5.3)。
- UI: `mock/src/app/api.ts` に `listFileHistory(repoId, params)` を追加。
- UI: `mock/src/app/components/refscope/FileHistoryView.tsx` を新規 (drawer overlay、約 300–500 LOC 想定)。
- State: `App.tsx` の root state owner に `fileHistory` slice を追加。timeline state とは独立させる。
- テスト: `apps/api/test/gitService-files-history.test.js` (新規) で fixture repo に対し (a) cursor pagination、(b) rename を含む history、(c) `truncated` flag、を assert。

---

### 4.3 Option C — B + Tunable `--find-renames=NN%` + Year-Jump UI

#### 4.3.1 概要

Option B に加え、以下を追加する:

1. **similarity threshold UI**: ユーザーが `--find-renames=NN%` の閾値を 30/50/70/90 から選べる。default は Git default (おおよそ 50%)。
2. **year-bucket index**: `authorDate.getFullYear()` で history を年ごとに集計し、`[2024 ▾] [2023 ▾] [2022 ▾]` のような jump table を view 上部に出す。クリックすると当該年の 1 月 1 日以前で最初に登場する commit に cursor をシークする。
3. **`--find-copies` の opt-in**: rename と区別された `C<NN>` (copy detection) を表示する toggle。default は off。

#### 4.3.2 UI 構成 (概念図)

```
┌─ FileHistoryView (Option C) ────────────────────────────────────────────────┐
│ File: src/lib/parser.ts        [✕ Close]                                    │
│ Year jump:  [2026 (47)] [2025 (203)] [2024 (412)] [2023 (380)] ...          │
│ Rename detection threshold:  [30%] [50%✓ default] [70%] [90%]               │
│ Copy detection:  [ ] include `C` (copy) status                              │
│                                                                             │
│ ── Observed (from `git log --follow --find-renames=50% ...`) ────────────── │
│ ... (B と同じ history list) ...                                             │
│                                                                             │
│ ╭─ Rename evidence (Git literal, threshold = 50%) ─────────────────────────╮ │
│ │ Git reported: R52  src/utils/parser.ts → src/lib/parser.ts              │ │
│ │ Note: lower threshold may surface more renames; raise to require        │ │
│ │       stricter similarity. This is your choice, not Refscope's.         │ │
│ ╰──────────────────────────────────────────────────────────────────────────╯ │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4.3.3 観察データのソース / 派生処理 / 透明性 UI

- **観察データのソース:** B と同じ + `--find-renames=NN%` (および opt-in `--find-copies=NN%`) を加えた `git log --follow` の literal output。
- **派生処理:**
  - threshold value はユーザー入力だが、選択肢のセット (30/50/70/90) は Refscope が決めた派生。
  - year bucket は `authorDate.getFullYear()` で client-side 集計した派生。
  - rename evidence の「閾値を下げると検出が増える」説明文は Refscope が書く派生 (説明であり判定ではない)。
- **透明性 UI:**
  - threshold 変更時、UI に「Reloading with --find-renames=NN%」のメタ表示。再読込後の rename evidence カードに必ず threshold 値を併記。
  - year bucket には「(N commits observed in this year)」を必ず併記。
  - copy detection を on にすると `C<NN>` カードが追加表示され、「Copy is heuristic — Git looks across all files for a similar source」と注記。

#### 4.3.4 既存 timeline / activity overview / FileHistoryView 内部との関係

- timeline は触らない (B と同じ)。
- year bucket と threshold UI は FileHistoryView 内部のみで完結。drawer 状態は variability が増えるため、URL query 経由で永続化したいか (open question §9.6)。

#### 4.3.5 API 側変更

- 新 endpoint は B と同じ (`/files/history`)。
- 新 query: `similarity` (任意、`30|50|70|90`)、`includeCopies` (任意、`true|false`)。
- gitRunner allowlist 変更: **不要** (`--find-renames=NN%` / `--find-copies=NN%` は `log` のオプション)。
- `validation.js` に `parseSimilarityQuery` を追加 (`^(30|50|70|90)$` の strict allowlist)。
- year bucket は **client-side のみ** で計算 (server で持つ必要なし、200 件 page-by-page で集計)。

#### 4.3.6 Hypothesis / 個別 KPI

- 仮説: 「ユーザーが threshold を調整できれば、false rename と miss-detected rename のトレードオフを調整しながら正確な history を構築できる」。
- 個別 KPI:
  - K_C1 (threshold 変更回数 / FileHistoryView open): **過度に高い (例: > 50%)** 場合、デフォルト閾値が悪い兆候。
  - K_C2 (year-jump 利用率): ≥ 20% を期待。
- Fail condition: K_C1 < 5% (誰も threshold を変えない = UI noise) なら Option B 相当に縮退。

#### 4.3.7 Pros / Cons

- Pros:
  - 「年単位で深く掘りたい」voice (year-jump) に直接応える。
  - rename 検出の境界をユーザーに開示することで、false rename のリスクを「Refscope の責任」ではなく「Git の特性 + ユーザーの選択」として明示できる。
- Cons:
  - 派生強度が高い (threshold 選択肢、year bucket、explanation 文)。
  - UI 複雑度が増す。Tomo 以外のペルソナ (Hana / Yuki) にとっては noise。
  - threshold variability で「異なる setting で異なる history が見える」状態が生まれる → 共有 / 引用時に誤解の元 (URL 永続化が要件化する)。

#### 4.3.8 実装ノート

- B の上に increment。年バケットと threshold UI は `FileHistoryView.tsx` 内部の React state + small derived components として収まる。
- threshold 変更で API 再リクエストが必要なため、debounce + abort controller で stale response 抑制。

#### 4.3.9 Refscope 原則との衝突点と緩和策

| 原則 | 衝突 | 緩和策 |
|---|---|---|
| 観察事実のみを正確に提示 | threshold variability で同 file の history が異なって見える | (a) similarity NN% を必ず表示、(b) URL に threshold を含めて再現性確保、(c) Git literal output である旨を毎回明記 |
| 200 commit/request 上限 | year-jump で「2022 年に飛ぶ」と途中の page を読まずに jump、ただし server side では cursor base64 で 1 page = 200 commit のまま | year-jump は client が cursor を作り直して取り直すだけ。1 リクエスト = 200 件は不変 |
| Hardened gitRunner allowlist | 影響なし (`log` のフラグ追加のみ) | 既存の `--end-of-options` / 引数配列 / bounded stdout を全踏襲 |

---

## 5. Cursor Pagination の API 設計 (wire-level)

> 本セクションは AC #1 (cursor pagination) の **核心**。protocol 透明性を高くするための設計詳細。
> rank §9: 「cursor pagination は新規 protocol 追加」を真剣に受け止める。

### 5.1 Cursor の wire-level 表現比較

| 案 | 中身 | Pros | Cons | 推奨? |
|---|---|---|---|---|
| (i) 純粋 hash | `<commit hash>` を base64 化 | シンプル、debug しやすい | hash 単独だと、`git log` の `topo-order` / `chrono-order` 切替で順序が変わると fragility がある。同じ hash から再開しても order によって "next" が違う | × |
| (ii) `(authorDate, hash)` ペア (推奨) | `authorDate` (ISO-strict) と `hash` を tuple にして JSON 化、base64 で opaque 化 | (a) Git default の reverse-chronological を `--until=<authorDate>` または revision `<hash>~1` で再現可能、(b) 同じ authorDate を持つ複数 commit でも `hash` で tie-break、(c) order モード変更時の影響を受けにくい | base64 1 KB 弱、ユーザーが見ても可読でない (= opacity が高い) | ○ |
| (iii) numeric offset | `offset=200` のような数値 | クライアント実装容易 | Git は順序揺らぎがあり、commits が rebase/rewrite された場合 offset が滑る (rank §9 の「stable ordering」を満たせない) | × |
| (iv) `(authorDate, hash)` を平文 query | `since=...&before_hash=...` | debug 容易、URL 共有可能 | 入力検証 surface が増える、誤用しやすい (例: hash だけ書き換えて「巻き戻った」と誤認) | △ (debug mode のみ) |

**推奨: (ii) opaque base64 of `(authorDate, hash)` JSON tuple**。

```ts
// Encoded payload (before base64):
type CursorPayload = {
  v: 1;                  // schema version (deprecation 戦略のため)
  d: string;             // authorDate, ISO-strict
  h: string;             // 40-char commit hash
  // future: extension fields go here without breaking v=1 readers
};
```

- `v: 1` を入れることで **schema deprecation 戦略** (将来 `v: 2` を追加して旧 cursor を 410 Gone にできる) を担保。rank §9 の protocol 設計透明性に応える。
- base64 は URL-safe variant (RFC 4648 §5)。`=` padding は ASCII 内で OK。
- 長さ上限: payload < 200 bytes (`v` + ISO-strict 25 chars + hash 40 chars + JSON overhead ~30 bytes)。base64 化後でも 300 bytes 程度。
- decode 時の検証: `v === 1` && `isValidObjectId(h)` && `parseDateQuery(d)` が pass。失敗時は `400 Invalid cursor`。

### 5.2 Stable Ordering の保証

- `git log --follow` のデフォルト order は `--date-order` 寄りの reverse-chronological。本 endpoint では明示的に **`--date-order`** を指定する (将来の Git default 変更耐性)。
- 同じ `authorDate` を持つ複数 commit に対しては Git が `topo-order` で tie-break するが、Refscope は cursor に hash を含めるため、`--until=<authorDate>` で取って `hash` で再 anchor することで **deterministic な next page** を返す。
- Merge commit の親順 (`first-parent` vs all parents) は `--follow` と組み合わせる場合 Git が file の存在を辿る側を選ぶ。本 endpoint では merge commit でも file が触られていれば 1 件として返す (Git literal 通り)。
- **History rewrite (rebase / amend) 中の挙動**: cursor の `h` が消えた場合、500 や 410 で fail-fast し、ユーザーに再検索を促す (`{ "error": "Cursor commit not found — history may have been rewritten" }`)。これは AC #1 の hidden 要件。

### 5.3 `parseCursorQuery` の入力検証

- 受理: `^[A-Za-z0-9_-]{1,512}$` (URL-safe base64 + length cap)。
- decode 後の payload を JSON.parse、形 (`v: 1`, `d` ISO-strict, `h` 40-char hex) を validate。
- 失敗時は `{ status: 400, body: { error: "Invalid cursor parameter" } }`。
- gitRunner には決して raw cursor を渡さない (decode 済みの `d` と `h` だけを使う)。

### 5.4 過去 / 未来方向のページング

- **過去方向 (older)**: `pageInfo.nextCursor` を URL に付けて再リクエスト。server は `--until=<d>` または revision `<h>~1` を `git log` に渡す (§5.5 で比較)。
- **未来方向 (newer)**: `pageInfo.prevCursor` を URL に付けて再リクエスト。server は `--since=<d>` および「revision を base ref hash まで」で取り直す。これは UI の「← Newer 200」用。
- 「最新ページ」は `cursor=null` で取れる (= `--max-count=200` のみ)。
- ループ防止: 同じ cursor で 2 回連続呼び出しても server response が deterministic (idempotent) であることを保証。

### 5.5 cursor をどう Git に渡すか (revision args 比較)

| 案 | 実装 | Pros | Cons |
|---|---|---|---|
| (a) `--until=<authorDate>` のみ | cursor の `d` だけを使う | シンプル | 同 authorDate 複数 commit で重複 / 抜け発生 |
| (b) revision `<h>~1` を渡す (推奨) | cursor の `h` を `~1` で 1 つ前にずらして revision として渡す | hash で deterministic、tie-break 問題なし | hash が消えた (rebase) 時に fail-fast |
| (c) (a) + (b) 併用 | `--until=<d>` で粗く絞り、`<h>~1` を revision に | 防御的だが冗長 | 複雑化、利点薄い |

**推奨: (b)**。rebase 後は fail-fast で正しく検出でき、deterministic ordering を満たす。

```text
# concept (NOT implementation code):
git log
  --follow
  --max-count=200
  --date-order
  --date=iso-strict
  --format=...
  --no-show-signature
  --name-status
  --numstat
  --no-ext-diff
  --no-textconv
  --end-of-options
  <cursor.h>~1     # = 1 つ前の commit から開始
  --
  :(literal,top)<path>
```

### 5.6 削除された ref の扱い

- `ref` query parameter (default `HEAD`) は既存 `resolveCommitishRevision` で resolve。ref 消失時は既存通り `404 Ref not found or not a commit`。
- cursor 単独では ref に依存しないが、UI は `path` と同 ref のセットで保持する (drawer open 時の ref を pin)。drawer open 中に背後の timeline で ref が変わっても FileHistoryView は影響を受けない (state 独立)。

### 5.7 200 commit/page hard limit との整合 (truncation の透明化)

- `limit` は `parseLimitQuery(value, fallback=100, max=200)` を踏襲。200 を超える要求は **clamp**。
- response の `truncated` flag:
  - `pageInfo.hasMore === true` で「次の 200 件は cursor で取れる」。
  - `truncated` は 200 件 ぴったり取れた + `--follow` の終端には達していない、という状態を明示。
  - long history (例: 2 年で 5,000 commits) では truncation は **page-by-page で発生**。UI は「Showing 200 of N+ commits」とのみ記載 (N の総量は事前に知ることができないので "+" と表現)。
- 1 page 上限を上げる選択肢は **明示的に却下**。Refscope の hardening 原則と整合 (CLAUDE.md / spec-v0.md)。

### 5.8 protocol 透明性 (deprecation 戦略)

- response の `observedSource` フィールド (例: `"git log --follow --name-status --numstat"`) で「何を観察したか」を server が宣言。クライアントがこの文字列を信頼して UI ラベルを書く。
- cursor schema を将来変更する場合: `v: 2` を導入し、旧 `v: 1` cursor は 90 日 grace period 後に `410 Gone` にする (実運用時のみ意味を持つ。ローカル単独前提では再生成で十分)。
- `protocolVersion` を将来 response に追加してもよい (今回は v1 で確定、過剰設計を避ける)。

---

## 6. Timeline と分離した FileHistoryView の UI / state model

> AC #3 (strict): timeline 全体の見た目を変えない、state を保持する。

### 6.1 3 案の比較

| 案 | 概要 | timeline 状態保持 | 開閉コスト | 推奨? |
|---|---|---|---|---|
| (i) **Drawer overlay** | 既存 layout の右側に slide-in する drawer。`Cmd+K` palette や commit detail のリンクから開く。閉じると timeline がそのまま見える。 | ◎ (timeline state 全保持、scroll も保持) | ○ (open/close を mock で容易に実装) | ○ |
| (ii) Route push (`/files/history?path=...`) | 別 path に navigate。React Router を導入 (現状 SPA で履歴 route 無し)。 | △ (browser history で戻れるが、戻った時に scroll 位置 / 一時 UI state を再構成する必要) | △ (router 導入の overhead) | △ |
| (iii) Modal | 中央 modal で表示。 | ◎ (state は保持されるが、背後 timeline は dim される) | ○ | △ (Tomo は「timeline と分離」だが、modal は通常 short-lived。長時間の deep dive にそぐわない) |

**推奨: (i) Drawer overlay**。

### 6.2 state owner の責任範囲

`App.tsx` を root state owner として維持し、以下を分離する:

```ts
// Existing timeline slice (UNCHANGED)
type TimelineState = {
  selectedRepo: string;
  selectedRef: string;
  commits: Commit[];
  selected: string;            // selected commit hash
  search: string;
  author: string;
  path: string;                // existing path filter (different from FileHistoryView)
  compareBase: string;
  compareTarget: string;
  // ... existing ...
};

// New file-history slice (NEW)
type FileHistoryState = {
  open: boolean;
  filePath: string;            // independent from TimelineState.path
  ref: string;                 // ref pinned at the time of opening
  cursor: string | null;       // current cursor (null = first page)
  items: FileHistoryItem[];
  pageInfo: { hasMore: boolean; nextCursor: string | null; prevCursor: string | null };
  loading: boolean;
  error: string;
  // Option C only:
  similarity: 30 | 50 | 70 | 90 | "default";
  includeCopies: boolean;
};
```

- **責任分離**: `FileHistoryState` を `TimelineState` と **絶対に共有しない**。`filePath` は別。`ref` は drawer open 時の snapshot で固定し、背後 timeline で ref が変わっても drawer は影響を受けない。
- **open trigger**: 既存 `DetailPanel` 内のファイル行 (`commit.files[].path`) に「View this file's history →」リンクを追加する。または `Cmd+K` palette に "Open file history" コマンドを追加。
- **close trigger**: drawer の ✕ ボタン、ESC キー、background click のいずれか。close で `FileHistoryState.open = false` のみ変更し、`items / cursor` は **保持する** (再 open で同じ状態に戻る)。完全リセットは `Reset` ボタンで明示的に行う。
- **timeline との同期 (オプション)**: drawer 内 commit row クリックで「timeline でも該当 commit を選択」する optional toggle を提供 (default off)。on にすると `TimelineState.selected = clickedHash` を更新 = timeline 状態を変えるため、AC #3 strict 解釈では off 推奨。Open question §9.4。

### 6.3 a11y / Quiet mode 連携

- `FileHistoryView` を開く際の slide-in animation は `prefers-reduced-motion` (Yuki demand のための既存 quiet mode hook) を尊重。
- drawer 内の color / contrast は既存 timeline と同じ token を使用。「Rename evidence」カードは既存 `RewriteAlert` と同じ枠線色 (`--rs-warn` 相当) を再利用し、視覚一貫性を確保。
- focus trap: drawer open 中は focus を drawer 内に閉じ込める。ESC で close + 元の trigger element に focus 戻す。

### 6.4 既存 activity overview / commit timeline との関係

- timeline 上の activity overview (`CommitActivityGraph`) / author graph は **触らない**。
- compare bar / compare result も触らない。
- drawer overlay は z-index で上に重ねるため、background の commit timeline はそのまま見えてもよい (透過率は要 UX 検討、open question §9.7)。

---

## 7. `--follow` と `--find-renames` のトレードオフ表

> AC #2 (rename 検出 + 検出根拠) の核心。観察 (Git literal output) と派生 (Refscope の UI) を分離して書く。

| 項目 | `git log --follow -- <path>` | `git log --find-renames=NN% --diff-filter=...` (path 指定なし) |
|---|---|---|
| **意図** | "single file history" を rename を越えて辿る | diff 全体 (commit 全体) で rename を検出する |
| **path 指定** | **必須 (1 つ)**。multi-path 不可 | 任意 / なしで OK |
| **Git literal output (name-status)** | 各 commit の name-status 行に `M`, `A`, `D`, または `R<NN>\told\tnew` が出る (path-only) | 全変更 file が出る (`R<NN>\told\tnew` を含む) |
| **観察できる証拠** | (a) commit hash, (b) `R<NN>` 行の old/new path、(c) similarity NN% | (a) commit hash, (b) 各 file の R/C status, (c) similarity NN% |
| **Refscope での UI 表示 (派生 = literal の人間可読化)** | 「Renamed from old → new (Git similarity NN%)」 | 同上だが、複数 file の rename カードを並べる |
| **コスト** | 単一 path の history を辿るため Git は path に絞り込みつつ全 commit を走る。`--max-count=200` で抑制可能 | commit 全体の diff を計算するため per-commit 重い |
| **false rename リスク** | similarity threshold (default ~50%) を満たす偶然書き換えで誤検出しうる | 同上 |
| **本 RFC での位置付け** | **Option B / C の history endpoint で採用**。1 file 単位の AC に直結 | **本 RFC の history view では採用しない**。Refscope 既存 commit detail (`getCommit`) は既に `--find-renames` を使っており、そちらは触らない |
| **Refscope 観察境界** | `nameStatus.code` / `nameStatus.similarity` / `nameStatus.oldPath` / `nameStatus.newPath` を **そのまま payload にする** | 同様だが per-file 配列を返す既存 `commit detail` 経由 |
| **Refscope 派生境界** | "Renamed from X to Y" の文章化、similarity 警告文 | 同上 |
| **threshold 開示** | Option B: Git default で固定 (派生最小)。Option C: 30/50/70/90 から選択可、選択値を payload と UI に明示 | 同上 |

### 7.1 補足: `--follow` の制約

- `--follow` は Git の document (`man git-log`) で **path が 1 つに限られている時のみ動作する**と明示されている。multi-path follow は不可。
- そのため `/files/history` endpoint の `path` query parameter は scalar (`parsePathQuery` の現行制約と整合: 単一 path 文字列)。
- `--follow` が出す rename は内部的に `--find-renames` を使うため、Option C で threshold を可変にすると `--follow --find-renames=NN%` の組み合わせになる (Git の標準サポート範囲)。

### 7.2 Refscope が観察する fields → UI 表示への mapping

| 観察 (Git literal) | Refscope payload field | UI 表示 |
|---|---|---|
| `M\t<path>` | `nameStatus.code = "M"`, `nameStatus.raw = "M"`, `similarity = null`, `oldPath = null`, `newPath = <path>` | (装飾なし) |
| `A\t<path>` | `code = "A"`, `raw = "A"`, others null | "Added in this commit" |
| `D\t<path>` | `code = "D"`, `raw = "D"`, others null | "Deleted — file removal" |
| `R95\told\tnew` | `code = "R"`, `raw = "R95"`, `similarity = 95`, `oldPath = "old"`, `newPath = "new"` | rename evidence カード ("Git reported rename — similarity 95%") |
| `C70\tsrc\tnew` (Option C only) | `code = "C"`, `raw = "C70"`, `similarity = 70`, `oldPath = src`, `newPath = new` | copy evidence カード ("Git reported copy — similarity 70%") |

すべての列が Git literal output から自動的に決まり、Refscope は **解釈を加えない**。UI label の wording のみ派生 (例: "Renamed from X to Y" は人間可読化)。

---

## 8. Recommendation

### 8.1 推奨: **Option B (Dedicated `/files/history` endpoint with `--follow`)**

#### 選定理由

- **AC 3 つを最小実装で満たす:**
  - cursor pagination: opaque base64 `(authorDate, hash)` で 200 commit/page を維持しつつ過去 / 未来にページング。
  - rename 検出 + 根拠表示: Git の `--follow --name-status` literal output を `nameStatus` payload にそのまま格納し、UI で similarity NN% と old/new path を必ず併記。
  - timeline と分離 view: `FileHistoryView` を drawer overlay として実装、`App.tsx` の state を timeline と独立させ、open/close で timeline 状態が壊れない。
- **観察 / 派生境界が最も透明:**
  - Refscope は「rename と判断した」と独自に言わない。Git の `R<NN>` を literal に転記する。
  - cursor の派生は opacity (base64) のみ。schema version `v: 1` で deprecation 戦略を担保。
  - similarity threshold は Git default に固定 (Option C で初めて可変化)。
- **製品制約と整合:**
  - gitRunner allowlist 変更なし (`log` のみ使用)。
  - 200 commit/request hard limit を **変更しない** (cursor で過去方向にページング)。
  - ローカル単独運用 (新規外部依存なし)。
  - 既存 `/commits` endpoint は **触らない** (timeline 全体を変えないため)。
- **拡張可能性:**
  - Option B が安定運用された後に Option C (threshold + year-jump) を追加できる。逆方向 (C → B) より自然な進化。
  - Option A は本 RFC の null hypothesis として保留 (cursor だけで足りるかを測る対照群)。

#### Impact-Effort 分類: **Big Bet** (中インパクト / 高 Effort)

- Impact: Tomo の AC 3 つを満たすが、persona breadth は狭い (rank §10.1: 4 位、MoSCoW Could)。
- Effort:
  - API: 新 endpoint 1 つ + cursor parsing + name-status 拡張 parser。
  - UI: 新 component (FileHistoryView drawer) + state slice 追加 + drawer open/close UX。
  - テスト: cursor pagination の E2E、`--follow` 越し rename の fixture テスト、state isolation テスト (drawer open/close 後の timeline state 不変)。

#### RICE Score (粗推定、`synthetic: true` のため Confidence は低めに固定)

| Factor | Value | 根拠 |
|---|---|---|
| Reach | 0.8 (qtr) | rank-round2-priority §10.1 の Tomo Reach 1.0 を踏襲 (狭い persona)。本 RFC では sensitivity を考慮し 0.8 (Effort 圧縮見込み)。 |
| Impact | 2 (medium) | 該当 persona には決定的価値だが breadth が狭い。Impact = 3 は当てない (synthetic + breadth 狭)。 |
| Confidence | 40% | rank §6 と一致。実 monorepo maintainer の usage 検証なしには 60% 以上は当てない。 |
| Effort | 2.5 (person-month) | rank §3 の "L (2.5–3.5)" を踏襲。Option B のみなら 2.5 寄り、Option C 含めると 3.5。 |

`(0.8 × 2 × 0.4) / 2.5 ≈ 0.26` — RICE ranking では **Low**。rank §3 の D-Tomo RICE 0.27 と整合。MoSCoW は **Could / v2 候補**。

### 8.2 段階的ロードマップ

| Stage | スコープ | 関連 Option |
|---|---|---|
| MVP (v0 = no-op) | 範囲外宣言。spec-v0.md に「現 MVP は 200 commit/page で完結。file-level deep dive は v2」と明記し、Plea round 3 で再評価。 | (Option 採用なし) |
| v2 alpha | Option A (cursor on `/commits`) を experiment として追加。FileHistoryView UI なし、既存 timeline 内に "Older 200 →" のみ。null hypothesis 検証目的。 | A |
| v2 (推奨スコープ) | Option B (`/files/history` + drawer + rename evidence + cursor)。本 RFC の中核。 | B |
| v2.1 (拡張) | Option C (threshold + year-jump + copy detection)。B 安定運用後 ≥ 1 quarter で評価。 | C |

> rank §10.1 の「Tomo は MVP 範囲外として明示」推奨と整合。本 RFC は v2 GO/NO-GO 判断のための事前設計として packaging。

### 8.3 protocol stability commitment

- `/files/history` endpoint は **新規追加** であり、既存 `/commits` endpoint は **不変**。
- cursor schema は `v: 1` で固定。将来変更時は `v: 2` を併存させ、旧 `v: 1` cursor を 90 日間は受理 (実運用前提なら)。
- `nameStatus.raw` は Git literal をそのまま保持 (例: `"R95"`, `"M"`)。Refscope のバージョンアップで raw を改変しない。
- response の `observedSource` フィールドで「何を Git に問い合わせたか」を宣言、UI が信頼して labelling を書く。

---

## 9. Open Questions (Clarifying Questions)

1. **drawer open trigger をどこに置くか:** 既存 `DetailPanel` のファイル行 (commit.files[].path) に「View this file's history」リンクを追加するか、Cmd+K palette の "Open file history (path: ...)" コマンドだけにするか?
2. **drawer open 時の path の起点:** drawer open 時に file path を渡す必要があるが、起点を「直前に開いた commit detail のファイル行」にするか、「timeline の path filter の値」にするか?
3. **削除済み path (status=D の commit) を drawer で開けるか:** ユーザーが過去に削除されたファイルの history を辿りたい場合、`--follow` は path が現存しなくても history を遡れるので可能だが、UI 上の trigger を提供すべきか?
4. **drawer 内 commit row クリックで timeline の selected commit を変えるか:** AC #3 strict 解釈では off (= 変えない) が安全だが、調査ワークフローによっては「同期」を望む声がありうる。default off + opt-in toggle で運用するか?
5. **multi-file follow:** `--follow` は Git の制約で path 1 つだが、ユーザーが「parser.ts と lexer.ts を一緒に見たい」と言った場合、複数 drawer を並べるか、別 view (= 本 RFC のスコープ外) を作るか?
6. **threshold variability の URL 永続化 (Option C):** Option C で `similarity=70` を選んだ状態を URL に含めて再現可能にすべきか? Refscope 全体は SPA で URL state を取り入れていないため、本 RFC で先行導入するか別 RFC か?
7. **drawer 背景の opacity / 隔離度:** drawer open 中、背景の timeline をどの程度視認可能にすべきか? 完全 opaque (≒ modal) / 半透明 / 透過 (= sidebar の感覚) の 3 案、どれが Tomo の "timeline と分離" 意図に最も合うか?
8. **history rewrite (rebase) 中の cursor 振る舞い:** cursor の `h` が消えた場合、明示的 error を返すと提案したが、自動で「直近の有効な cursor まで巻き戻る」graceful 動作を提供すべきか? Refscope の正確性原則からは fail-fast 推奨だが、UX 観点で user input が要る。

---

## 10. Assumptions

0. 本提案は `synthetic: true` (Plea 由来) の仮説であり、実ユーザー検証 (Researcher による大規模 repo maintainer ヒアリング 3–5 名 + ローカル KPI 収集) の前にロードマップ化しない。
1. Refscope を使う長期メンテナーは、Git の `--follow` の「path 1 つ制約」と「similarity による rename 検出」が **Git 側の挙動** であることを最低限理解している (UI で literal NN% を見せることで補強)。
2. 200 commit/page は long history では十分でないが、cursor でページングする限り「ユーザーがどれくらい過去まで掘ったか」をローカル KPI で観測でき、必要なら page size 引き上げを別 RFC で議論できる (本 RFC では引き上げない)。
3. drawer overlay (UI 推奨案) は既存 Radix UI primitives で実装可能。新規 Drawer コンポーネントが既存 shadcn-style 体系で再利用可能と仮定する。
4. file-level history view は repo 全体ではなく単一 path 単位。multi-file 同時 follow は本 RFC のスコープ外。
5. cursor schema を `v: 1` で固定するが、将来 v: 2 に上げる場合の deprecation period 設計は実運用 (= multi-user / cloud 化) を前提にしないため、ローカル単独 Refscope では 90 日間 grace に意味がない。schema version 概念だけ先に入れておくのは将来拡張への備えとする。
6. `--follow` の Git 内部実装は将来も互換性を保つ (Refscope は Git 2.x 前提、Git 3.x 以降で `--follow` semantics が変わったら別 RFC で対応)。
7. localStorage 永続化はしない (drawer の transient state のみ in-memory)。Option C で threshold 変更を URL に反映するかは open question §9.6。

---

## 11. Cross-Persona Friction (round 1 / 2 死角への応答)

| Persona | FileHistoryView との関係 | 緊張点 | 提案の扱い |
|---|---|---|---|
| Tomo | **主要対象** | drawer の操作が多すぎると逆に邪魔。cursor の opaque さを debug 困難に感じる可能性 | UI に「Older 200 →」の単純化、cursor は protocol-internal にとどめる、debug mode で平文 cursor を expose する optional flag を設ける |
| Hana | 関心薄 (期間サマリの方が重要) | drawer overlay が timeline scan workflow を妨害する可能性 | drawer は明示的 trigger でのみ open、default は閉じている。Hana の workflow 干渉なし |
| Yuki | quiet mode 連携必須 | drawer の slide-in animation や rename evidence カードの色 / 動きで集中阻害 | `prefers-reduced-motion` 連動、quiet mode 中は animation 無効化、rename カードは既存 `RewriteAlert` と同じ低彩度色 token を再利用 |
| Ken | 関心薄 (boot recap が重要) | inicident 対応中は file deep dive ではなく ref 全体の動きを見る | drawer は incident workflow と無関係。Ken への干渉なし |

> Tomo demand は cross-persona breadth が狭い (rank §10.1)。本 RFC は他 persona に副作用を出さないことを設計優先順位に置く。

### 11.1 Non-consumption framing

- 競合は「他の Git ビュアー (gitk、tig、GitKraken)」ではなく、Tomo が現在実際にやっている代替行動 (= "non-consumption"):
  - ターミナルで `git log --follow -p -- src/lib/parser.ts | less` をスクロール。
  - GitHub の "Blame" を使うが rename を越えると context 喪失。
  - `git log --follow --oneline -- src/lib/parser.ts` を年単位でスクロールし、目視で rename を探す。
- 上記 3 つはすべて「rename evidence の視認性が低い」「page 概念がない」「timeline 全体の context と分離されていない」特徴を持つ。FileHistoryView はこれらの「ターミナル + grep + 目視」を Refscope 内で完結させる。

---

## 12. Validation Strategy

1. **Researcher による定性検証 (本 RFC の最優先 next step):**
   - 大規模 monorepo maintainer 3–5 名 (実 OSS メンテナー、kernel 系 / database 系 / SaaS monorepo 系) に対し以下のタスクで定性検証:
     - "あなたの monorepo の任意の長寿命ファイルを 1 つ選び、Refscope で 2 年前まで history を辿ってください。rename を跨いだ場合、その事実をどう確認しましたか?"
     - 観測項目: (a) drawer を開く動線の発見容易度、(b) rename evidence の理解容易度、(c) cursor で page を進める意思決定速度、(d) timeline 状態が壊れていないかの体感。
   - 検証セッションあたり 1 リポジトリ × 1 file × 30 分で十分。Confidence を 40% → 60%+ に引き上げる材料。

2. **MVP (Option B) リリース後、ローカル KPI を 4 週間収集** (K1–K5):
   - localStorage に保存し、Refscope の "no external services" 原則を破らない。
   - debug toggle で raw KPI snapshot を表示可能。

3. **Fail Condition 監視 (kill criteria 再掲):**
   - K2 (page 深度中央値) < 1.2 page → cursor 不要、Option A 縮退検討。
   - K3 (rename traversal 率) < 10% → rename 検出は実需薄、Option A 縮退検討。
   - K5 (誤情報報告) ≥ 1 件で grouping ロジック再点検、3 件で view 全体を opt-out 化。

4. **Round 3 demand collection:** Plea を再起動し、Option B 公開後の新たな死角 (例: "rename evidence カードが多すぎる commit で見にくい"、"copy detection も欲しい"、"merge commit を follow から除外したい") を探る。

### 12.1 セキュリティ / プライバシ追加レビュー項目 (本 RFC 由来)

- `parseCursorQuery` の入力検証境界が、`gitRunner` の `--end-of-options` 後の引数として正しく扱われることをテスト (`apps/api/test/` に追加)。
- `parseSimilarityQuery` (Option C) が strict allowlist (`30|50|70|90`) のみを受理し、任意整数を許さないことを確認。
- `--follow` を伴う `git log` の stdout が `RTGV_DIFF_MAX_BYTES` 以下に収まることを確認 (200 commit × 数十 file × name-status による payload 上限見積)。
- cursor の opaque base64 が **1 KB を超えない** (URL 長制限の安全領域) ことを response 生成時に enforce。
- 削除済み path に対する `--follow` で server がエラーを出した場合、`{ "error": "..." }` を sanitize して返す (`gitService.js` 既存パターンを踏襲、stderr 流出ゼロ)。

---

## 13. Handoff

### Suggested next agent: **Researcher** (大規模 repo maintainer 検証)

- **理由:** 本提案は `synthetic: true` で Confidence 40%、rank §10.1 で MoSCoW Could / 4 位 / v2 範囲外。実 OSS メンテナーへのヒアリング無しに実装着手 (Sherpa への decomposition) は逆順。Researcher で 3–5 名の monorepo maintainer に Tomo demand と本 RFC の Option B を提示し、(a) AC fulfillment、(b) drawer UX 違和感、(c) rename evidence 透明性、を検証することで Confidence を 60% に引き上げる。
- **代替: Accord (L0–L3 spec packaging):** Researcher 検証を待たずに spec を packaging してチーム内意思決定資料にする。team が「v2 を確定する政治判断」を急ぐ場合に有効。
- **代替: Sherpa (decomposition):** Option B が GO 判断された後、最小 atomic step (例: `parseCursorQuery` 追加 → `/files/history` route 骨格 → `--follow` 越し parser → drawer 骨格 → rename evidence 表示) に分解する。

### Artifacts produced

- `docs/spark-tomo-file-history-proposal.md` (this file)

### Risks (top 3)

1. **派生 (UI labelling) と観察 (Git literal output) の境界が実装で曖昧化するリスク:** 「Renamed from X to Y」の文章化は派生だが、ユーザーが「Refscope が判断した」と誤認しうる。**緩和:** rename evidence カードに **常時** "Git reported rename — similarity NN%" と "Note: This is Git's calculation, not Refscope inference." を露出 (§4.2.3, §7.2)。
2. **cursor protocol の deprecation 戦略が将来綻ぶリスク:** `v: 1` で固定したが、将来 `--name-status` の Git output 仕様が変わると cursor schema も変わる。**緩和:** schema version を最初から含める、`observedSource` フィールドで Git command を宣言する、`v: 1` cursor は 90 日 grace で仮定。
3. **drawer open/close の state isolation 失敗による timeline 状態破壊:** AC #3 strict 違反は致命的。`App.tsx` の state owner は既存設計で堅いが、`FileHistoryState` を timeline state と shallow merge してしまう実装ミスのリスク。**緩和:** `FileHistoryState` を完全別 slice として保持、open/close E2E テストで `selectedRef / selected / search / author / path / compareBase / compareTarget` の不変を必ず検証。

---

_STEP_COMPLETE:
  Agent: Spark
  Status: SUCCESS
  Output: |
    File-Level History View RFC を 3 options (派生強度スペクトラム: A cursor のみ / B `--follow` + rename evidence / C threshold + year-jump) で提示。
    Tomo の AC 3 つ (cursor pagination / rename 検出 + 根拠 / timeline と分離 view) に各 option がどう応えるかを明示。
    推奨は Option B (新 endpoint `/files/history` + opaque cursor + Git literal name-status を rename evidence として転記)。
    cursor は base64(JSON{v:1, d:authorDate, h:hash}) opaque、revision 引数は `<h>~1` で deterministic、--date-order 明示で stable ordering。
    rename 戦略は Git literal の `R<NN>\told\tnew` をそのまま payload に格納し UI で similarity NN% と "Git reported, not Refscope inference" を必ず併記、Refscope は判定しない。
    drawer overlay 推奨で App.tsx 既存 state owner を拡張、FileHistoryState を timeline state と完全分離 (AC #3 strict)。
    KPI はローカル単独で観測可能なものに限定 (drawer open 率、page 深度、rename traversal 率、state 保持率、誤情報報告)。
    gitRunner allowlist 変更なし (`log` のフラグ追加のみ)、200 commit/request hard limit は維持 (cursor で過去方向 page-through)。
    rank §10.1 の Tomo MoSCoW Could / v2 候補 / MVP 範囲外と整合する v2 候補 RFC として Summary に明記。
    Open questions 8 件、assumptions 7 件、kill criteria 明記。
  Artifacts:
    - /Users/shingoimota/repos/github/refscope/docs/spark-tomo-file-history-proposal.md
  Risks:
    - 派生 (UI labelling) と観察 (Git literal) の境界が実装で曖昧化し "Refscope が判断した" と誤認されるリスク
    - cursor protocol (`v: 1` schema) の deprecation 戦略が将来 Git output 変更で綻ぶリスク
    - drawer state isolation 失敗で timeline 状態 (selected ref / commit / filters / compareBase/Target) が破壊される AC #3 違反リスク
  Next: Researcher (大規模 repo maintainer 3-5 名のヒアリングで Confidence 40% → 60%+ に引き上げ、v2 GO/NO-GO 判断材料を作る)
  Reason: 全 AC を 3 派生強度で網羅、cursor 設計を wire-level type で詳述、--follow / --find-renames を観察 vs 派生で分離、200 commit hard limit と gitRunner allowlist を厳守、rank §10.1 整合、推奨 + KPI + fail condition + open questions を含む合意可能な RFC を生成できたため SUCCESS。
