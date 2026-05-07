# Spark Proposal: 「なぜここにある？」ワンクリック歴史パネル (Refscope)

> Synthetic demand source: `docs/user-demand-report-2026-05-07-r6.md` — 彰 (Junior Dev, 8 ヶ月, リファクタしたいけど怖い)
> `synthetic: true` — このドキュメントは Plea が生成した合成ユーザー需要に基づく仮説提案。実ユーザー検証前の提案であり、Researcher へのハンドオフを推奨する。
> 上位エージェント: Plea (synthetic user advocate) → Spark (this document) → Researcher / Accord / Artisan (next).
> ロードマップ位置: **v2 候補**。ジュニア向けリスク低減体感は既存 FileHistoryView の延長線上に実装可能。依存最小哲学の範囲内で完結する。
> 範囲: `DetailPanel` に新タブ「Why」を追加 **または** 新 API endpoint `/api/repos/:id/range-history` の追加。既存 `CommitTimeline` と `FileHistoryView` は変えない。

---

## 0. Summary

- **対象ペルソナ**: 彰 — 入社 8 ヶ月のジュニア開発者。「気になったらリファクタしていいよ」と言われたが、影響範囲が掴めず手が止まる。"自分が壊した" への恐怖が成長機会を塞いでいる。
- **解こうとしている job-to-be-done**: 「このコードの塊が *なぜここにある* のかを、1 アクションで理解し、手を入れてよいか判断できる確信を得る」。
- **現状の死角**:
  - `git blame` は一行ずつ異なる作者が出て、"塊としての文脈" が掴めない。
  - 既存の commit detail / diff ビューはコミット単位で、"この選択範囲を最初に書いたコミット" を教えない。
  - Chesterton's Fence — 「柵を壊す前にその理由を確認せよ」— を実践するための UI がない。
- **提案**: `DetailPanel` に「Why」タブを追加し、(a) 範囲選択 → 導入コミット (pickaxe / log -L)、(b) 最終変更コミット (log 上位)、(c) それぞれのコミットメッセージ **full subject + body (literal)** の 3 段表示を実現する。
- **意図抽出の原則**: Refscope は LLM を呼ばない。コミットメッセージを *そのまま* 表示する。「なぜ」の判断は人間が行う。
- **推奨 Option**: **Option B** — `git log -L` による行範囲全体の時系列取得。最小実装で AC 3 段表示を満たし、pickaxe (Option A) より誤検知リスクが低く、blame 集約 (Option C) より実装コストが小さい。
- gitRunner allowlist (`log` が含まれる) — **変更不要**。`log -L` は `log` サブコマンドの引数であり allowlist に通過する。
- Open questions 6 件、assumptions 7 件を末尾に明示。
- Hand-off 推奨: **Researcher** (ジュニア開発者向け価値検証で reach / confidence 引き上げ) → **Artisan** (UI: DetailPanel タブ追加の実装仕様)。

---

## 1. Context Read と観察 / 派生の境界

### 1.1 参照ファイル

| 参照 | 用途 |
|---|---|
| `CLAUDE.md` | API は plain ESM JavaScript、gitRunner.js の allowlist (`log` 含む) 変更不可。LLM 依存禁止。 |
| `apps/api/src/gitRunner.js` | `ALLOWED_GIT_COMMANDS` に `log` が含まれる。`-S<pattern>` (pickaxe attached form) も引数として通過する (hyphen-leading 制限は global option のみ)。`log -L` の引数も同様に通過する。 |
| `apps/api/src/gitService.js` | `getFileHistory` が既存 (`log --follow --patch`)。pickaxe 用 `buildSearchModeArgs` に `-S<pattern>` が実装済み (`case "pickaxe"`). |
| `apps/ui/src/app/components/refscope/DetailPanel.tsx` | `onOpenFileHistory` コールバック経由で FileHistoryView へ遷移する hook が既存。タブ追加の足場がある。 |
| `apps/ui/src/app/components/refscope/FileHistoryView.tsx` | ファイルレベル歴史 view が既存。「Why パネル」の UI パターンを踏襲できる。 |
| `docs/spark-tomo-file-history-proposal.md` | 章立て・観察 vs 派生の語彙・OST / Hypothesis 形式の踏襲元。 |
| `docs/user-demand-report-2026-05-07-r6.md` (Request 4) | AC 3 つ: 範囲→関連コミット分類 / コミットメッセージの「なぜ」表示 / 関連 PR リンク。 |

### 1.2 観察データ (observed facts) として確定的に得られるもの

`git log -L<start>,<end>:<file>` が返す literal output:

- `commit.hash`, `commit.shortHash`, `commit.parents`
- `commit.subject` (1 行目), `commit.body` (2 行目以降 — 空白行区切り)
- `commit.author`, `commit.authorEmail`, `commit.authorDate`
- 各コミットの patch (当該行範囲の差分のみ)

`git log -S<string>` (pickaxe) が返す literal output:

- `string` が追加または削除されたコミットのハッシュ・メタ情報
- Refscope は「これが導入コミットだ」と主張しない。「この文字列が差分に現れた最古のコミット」と literal に転記する。

### 1.3 派生 (inferred / interpreted) として明示すべきもの

- **「導入コミット」の呼称**: Git は "introducing commit" という概念を持たない。`git log -L` の時系列中 *最後* (最古) のコミット、または pickaxe で *最初に追加* されたコミットを、Refscope は「`git log` が報告した最古の関連コミット」と表示する。"導入" ラベルは UI 上の補助表現であり、確定的な意味付けではない。
- **「意図」の表示**: commit subject + body を *そのまま* 表示する。「これが意図だ」と Refscope は判断しない。LLM によるハイライト・要約・動詞抽出は行わない。
- **PR リンク**: `git` には PR 情報が存在しない。コミットメッセージ本文に含まれる `#NNN` や `https://github.com/...` の URL パターンは UI 側で regex match して clickable にするが、「関連 PR」と断言しない。GitHub 固有情報であることを UI 上に明示する。

---

## 2. Outcome Solution Tree (OST)

```
Outcome:
  彰がコードの塊を選択したとき、「なぜここにある？」の答えを
  1 アクションで得られ、リファクタに踏み出す確信を持てる
  (KPI: Why タブ利用率, 「最古の関連コミット」表示到達率,
   "手を入れる勇気" 代理指標 = リファクタ意図コミットの自己報告数,
   嘘 context 報告 0 件)
   │
   ├─ Opportunity 1: blame は一行単位で文脈が断片化し、"塊の誕生" が分からない
   │     └─ Solution: 行範囲をまとめて git log -L に渡し、
   │                  時系列全体 (最古→最新) を 1 リクエストで返す
   │
   ├─ Opportunity 2: 「どのコミットが重要か」の仕分けがない
   │     └─ Solution: 最古 (= 導入候補) と最新 (= 最終変更) を UI 上で
   │                  ラベル分けして表示する (Git literal 順序を使うだけ)
   │
   ├─ Opportunity 3: コミットメッセージに書かれた理由が読めていない
   │     └─ Solution: subject + body を full text で表示する
   │                  (LLM 抽出なし — コード内の既存 field を使う)
   │
   └─ Opportunity 4: PR へのリンクがあれば文脈が補完される
         └─ Solution: body 内の URL / #NNN を regex で clickable にする
                      (Option フラグ — GitHub 固有情報と明示)
```

---

## 3. Hypothesis & KPI

### 3.1 Hypothesis (testable)

> 「Refscope の DetailPanel に Why タブを追加し、(a) 選択行範囲の `git log -L` 結果を時系列で表示し、(b) 最古コミットを『最古の関連コミット』としてラベルし、(c) commit subject + body を full text で提示すれば、彰のようなジュニア開発者はリファクタ対象コードの "来歴" を確認でき、手を入れる意思決定速度が上がる」

### 3.2 KPI (ローカル単独運用で観測可能なもの)

| KPI | 観測方法 | 目標値 (synthetic) |
|---|---|---|
| K1: Why タブを開いた回数 / DetailPanel を開いた回数 | クライアント in-memory counter | ≥ 15% (10 回に 1.5 回は Why タブを開く) |
| K2: 最古コミット表示まで到達した割合 | Why タブ内でのスクロール深度 | ≥ 60% |
| K3: (User Study) 「リファクタに踏み出す確信が持てた」自己申告 | Researcher インタビュー / 5-second test | ≥ 70% "yes" in N=5 junior devs |

### 3.3 Fail Condition

> **Why タブ開率 < 5% (30 日稼働後、ユーザー観測ログ)**、または **User Study で「コミットメッセージだけでは意図が分からない」が ≥ 60%** → 本提案の "LLM なし literal 表示" アプローチを再評価。pickaxe ヒューリスティクスの精度問題か、コミットメッセージ品質問題かを Researcher が分離して調査。

---

## 4. Options A / B / C

### Option A: Pickaxe (-S string) で導入コミットを特定

**概要**: 選択行の任意の文字列を `-S<string>` に渡し、その文字列が初めて追加されたコミットを "導入コミット" として返す。

**長所**:
- 実装が単純 (buildSearchModeArgs の pickaxe mode が既存)
- 行範囲を指定しなくてよいため UI の選択 UI が不要になる場合がある

**短所**:
- 検索文字列の選択がユーザーに委ねられる (何を渡すかが不明確)
- 短い文字列は false positive が多い (汎用的な `if (` など)
- 「塊の文脈」ではなく「特定文字列の出現履歴」になる
- 範囲全体の時系列が取れない

**実装コスト**: Small (既存 API 再利用)
**派生強度**: 中 (文字列選択の解釈がユーザー依存)

---

### Option B: log -L (行範囲) で時系列取得 [推奨]

**概要**: `git log -L<startLine>,<endLine>:<filePath>` を新 endpoint `/api/repos/:id/range-history` で呼び出し、その行範囲に触れた全コミットの時系列 (最新→最古) を返す。最古を "最古の関連コミット (導入候補)"、最新を "最終変更" として UI がラベルする。

**長所**:
- 行範囲をまとめて追跡するため "塊の来歴" として最も自然
- Git が計算した事実 (どのコミットがその行に触れたか) を literal に転記
- 既存 getFileHistory の構造を踏襲できる (パーサーの大部分が再利用可能)
- LLM 不要・外部依存なし

**短所**:
- UI に「行範囲の選択 → API リクエスト」フローが必要 (選択 UI が新規)
- ファイルパスが必要 (DetailPanel は commit detail から file path を取得済みで解決可能)
- 大きな範囲 (数百行) はレスポンスが重くなる可能性 → maxBytes cap で対応

**実装コスト**: Medium (新 endpoint + UI 選択フロー)
**派生強度**: 低 (Git literal output の転記のみ)

---

### Option C: B + blame 集約で「最終変更」と「導入時」を分離

**概要**: Option B の `log -L` に加え、`git blame -L<start>,<end>` を呼んで行ごとの最終変更コミットを集約。blame の集約結果と `log -L` の最古エントリを照合して "最終変更" / "導入候補" を確定する。

**長所**:
- 行ごとに異なる作者が混在するケースでも「どの作者がこの塊の主要な書き手か」を集約できる
- blame の literal output (行番号・ハッシュ・タイムスタンプ) を補足情報として表示できる

**短所**:
- `blame` は gitRunner allowlist に **含まれない** → allowlist 追加が必要 (CLAUDE.md 違反リスク)
- 実装コストが高く、MVP としては過剰
- blame と `log -L` の結果の統合解釈が派生 (Refscope が判断することが増える)

**実装コスト**: Large (allowlist 変更 + 複数 Git コマンドの統合)
**派生強度**: 高

**判断**: blame を allowlist に加える変更は `gitRunner.js` のセキュリティ境界に触れるため、別 RFC として分離すべき。本提案のスコープ外。

---

## 5. 実装スケッチ

### 5.1 API: `/api/repos/:id/range-history` (新 endpoint)

```
GET /api/repos/:repoId/range-history
  ?ref=<ref>&path=<filePath>&startLine=<n>&endLine=<m>&limit=<1-20,default 10>
```

Git コマンド: `git log -L<startLine>,<endLine>:<filePath> --max-count=<limit+1> --no-show-signature --end-of-options <revision>`

- `log` は allowlist 済み。`-L` は引数であり allowlist チェックをパスする (コマンド名のみ対象)。
- `startLine` / `endLine` は `parseLineRangeQuery()` で正整数バリデーション (validation.js に追加)。
- `filePath` は `parsePathQuery` 通過後に `-L` 形式に組み込む (`:(literal,top)` 不要)。
- レスポンス: `{ path, ref, startLine, endLine, entries: [{hash, shortHash, author, authorDate, subject, body, urlsInBody}], truncated, limit }`
- `urlsInBody`: body から URL / `#NNN` を regex extract して配列化。"関連 PR" と断言しない — literal transfer。

### 5.2 UI: DetailPanel に「Why」タブを追加

DetailPanel は `onOpenFileHistory` コールバック経由の drilldown パターンが既存。タブ追加の足場がある。

タブ構成: `[ Diff ] [ Files ] [ Refs ] [ Why ]` — 新タブ追加。

Why タブ内 3 段構成:
1. **行範囲入力フォーム** — path (現 commit の変更ファイルから選択) + startLine / endLine (数値入力)
2. **最古の関連コミット** — `git log -L` 結果の末尾エントリ。subject + body full text + `urlsInBody` clickable。ラベルは "git log が報告した最古のエントリ" と literal に表現。
3. **最終変更コミット** — `git log -L` 結果の先頭エントリ。同様に表示。
4. 全 N 件の折りたたみ表示。

実装上の判断:
- **DetailPanel タブ追加 vs 新パネル → タブ追加を推奨**。コミット選択コンテキストを保ったまま Why へ切り替えるのが自然。新パネルは遷移ステップが増えすぎる。
- `App.tsx` に `whyPanelQuery: { path, startLine, endLine } | null` を追加。DetailPanel は prop で受け取る。
- MVP の行範囲選択 UI は数値入力。diff ハイライト選択は Open questions (Q1) に残す。

---

## 6. Open Questions

| # | 質問 | 影響範囲 |
|---|---|---|
| Q1 | **行範囲選択 UI はどこに置くか?** — diff 行クリック / ドラッグ選択 vs 数値入力フォームのどちらが彰にとって直感的か? Diff ハイライト選択は DiffViewer の大幅改修が必要。 | UI 実装コスト |
| Q2 | **PR リンクのスコープ判断** — コミット body 内 URL の clickable 化は GitHub 固有。 Refscope の "ローカル単独・外部サービス非依存" 哲学と矛盾するか? URL を提示するだけ (外部接続なし) なら許容範囲内か? | 哲学 / スコープ |
| Q3 | **コミットメッセージ品質問題** — 彰のチームが `fix typo` のような無意味なコミットを大量に持っていた場合、このパネルの価値がゼロになる。コミットメッセージ品質はチームの習慣に依存しており、Refscope でコントロールできない。これをどこで明示的に文書化するか? | 価値仮説 |
| Q4 | **log -L の性能限界** — 巨大ファイル (数千行) の中間範囲を `log -L` で辿ると Git の処理が重い。`maxBytes` cap と `timeoutMs` の適切な値は? 既存の `FILE_HISTORY_MAX_LIMIT = 50` とは別に `RANGE_HISTORY_MAX_LIMIT = 10` 程度に抑えるべきか? | 性能 |
| Q5 | **DetailPanel のタブ増加問題** — 現在 Diff / Files / Refs / FileHistory 系の表示が混在している。Why タブを加えると画面が狭くなる。タブ overflow / dropdown は必要か? | UI |
| Q6 | **`blame` を将来的に allowlist に加えるかどうか** — Option C の高精度分離には blame が必要。この判断を別 RFC として分離することを推奨するが、その RFC の発行タイミングは? | アーキテクチャ境界 |

---

## 7. Assumptions

| # | 仮定 | 検証方法 |
|---|---|---|
| A1 | 彰はコミットを開いた状態で「この関数なぜ？」と思う (= DetailPanel のコンテキストで発動する) | Researcher インタビュー |
| A2 | コミットメッセージ body に十分な "なぜ" 情報が書かれているチームが存在する | 実際のリポジトリサンプリング |
| A3 | `git log -L` の応答速度は彰が感じる "ワンクリック体験" と両立する (< 2 秒) | ローカルベンチマーク |
| A4 | DetailPanel へのタブ追加が他のユーザー (広志, Maya, Eleanor) の既存 UX を阻害しない | UI レビュー |
| A5 | `log -L<start>,<end>:<file>` の形式は gitRunner.js の validateGitArgs を通過する (attached form でないため `-L10,25:path/to/file` は先頭が `-` だが、これは `log` コマンドへの引数配列の要素であり allowlist check はコマンド名のみ) | 実装で確認必要 → Q が残る |
| A6 | `synthetic: true` — 本提案は Plea 起源の合成需要。実ユーザーが "Why パネル" を求めているかは未検証 | Researcher |
| A7 | PR リンクの clickable 化は外部 API 呼び出しなしで URL を提示するだけのため "ローカル単独" 哲学と矛盾しない | チーム合意 |

---

## 8. RICE Score & Impact-Effort

| 要素 | 値 | 根拠 |
|---|---|---|
| **Reach** | 15/四半期 (synthetic) | ジュニア〜ミドル層。全ユーザーの 30% 程度と仮定。 |
| **Impact** | 2 | "確信" インパクトは大きいが KPI 測定困難のため保守値。≤20% 分布ルール適用。 |
| **Confidence** | 35% | Plea 起源 synthetic 仮説のみ。実インタビュー未実施でデフォルト 50% より低く設定。 |
| **Effort** | 3 person-weeks | 新 endpoint + validation + DetailPanel タブ + 行選択 UI + テスト + バッファ。 |
| **RICE Score** | (15 × 2 × 0.35) / 3 = **3.5** | Low — synthetic 段階では当然。Researcher 検証で Confidence が上がれば再評価。 |

**Impact-Effort**: **Fill-In** — ただし Confidence が低いため Researcher 検証を先行させること。

### 受入基準

- [ ] `GET /api/repos/:id/range-history?path=&startLine=&endLine=` が行範囲に触れたコミット一覧を返す
- [ ] レスポンスに `subject` + `body` が含まれる (LLM 加工なし、literal)
- [ ] UI の「Why」タブが「最古の関連コミット」と「最終変更コミット」を 3 段構成で表示する
- [ ] body 内 URL / `#NNN` が clickable — "コミットメッセージ本文に含まれていた外部リンク" と明示
- [ ] `gitRunner.js` の allowlist 変更ゼロ (blame を加えない)
- [ ] App.tsx 単一 state owner 原則を維持する (新 state: `whyPanelQuery`)

### Validation Strategy

1. **Researcher** — ジュニア開発者 3〜5 名インタビュー: "このパネルで手を入れる確信が変わるか?"
2. **5-second test** — Why タブ UI モックを 5 秒見せてラベル解釈を確認
3. **Fake Door (任意)** — "Why (coming soon)" タブを先行追加しクリック率 2 週間測定 → K1 reach 実測値
4. **コミットメッセージ品質調査** — リポジトリ 5 件 × ランダム 50 コミットの body 充実率測定 (A2 検証)

---

## 9. Hand-off

| 送り先 | 目的 |
|---|---|
| **Researcher** | ジュニア開発者向け価値検証: インタビューと 5-second test で Confidence 引き上げ。特に "コミットメッセージ品質問題 (Q3)" と "行選択 UI の発見可能性 (Q1)" の実証を依頼。 |
| **Echo (UI Usability)** | DetailPanel Why タブの usability 評価: 3 段表示の情報密度・ラベル解釈・行範囲入力の発見可能性をユーザーテストで検証。 |
| **Artisan (実装時)** | 本 RFC が GO 判定を得た後、DetailPanel タブ追加と行範囲選択 UI の実装仕様を Artisan に渡す。 |
| **Accord (任意)** | blame allowlist 追加 (Option C) を検討するタイミングで、read-only 哲学との整合を含む L0-L3 spec package として再パッケージ。 |

---

*このドキュメントは `synthetic: true`。Plea が生成した合成ユーザー需要に基づく仮説提案であり、実ユーザー検証前に実装に踏み切ることを推奨しない。Researcher によるジュニア開発者インタビューで Confidence ≥ 50% を確認してから GO/NO-GO を判断すること。*
