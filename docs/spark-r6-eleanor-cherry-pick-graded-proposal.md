# Spark Proposal: Graded Cherry-pick Equivalence (D-6)

> Synthetic demand source: `docs/user-demand-report-2026-05-07-r6.md` — Eleanor (Reviewer/Architect, OSS maintainer 8 years)
> `synthetic: true` — このドキュメントは Plea が生成した合成ユーザー需要に基づく仮説提案であり、実ユーザー検証前の提案である。
> 上位エージェント: Plea (synthetic user advocate) → Spark (this document) → Researcher / Builder (next).
> ロードマップ位置: **既存 8e90179 の拡張**。cherry-pick equivalence パネルの binary 判定を 3 段階判定に昇格させる。

---

## §0 Summary

- **対象ペルソナ:** Eleanor (Reviewer/Architect)
- **解くべき job-to-be-done:** 「conflict 解決で静かにロジックが歪んだコミットを、"equivalent" の一言で見逃したくない。差分がある場合は何が違うのか 1 画面で確認したい」
- **現状の死角:** コミット 8e90179 で追加した CherryStatus パネルは `git cherry` の `-`/`+` マーカーを binary 分類 (equivalent / missing) するだけ。`-` の中に「patch-id は一致するが内容に差がある」ケース ── conflict 解決時に手動編集でロジックが歪んだ commit ── が区別されない。
- **提案:** 既存 CherryStatus パネルを **置換せず** に拡張し、"equivalent" をさらに `identical` / `near-identical` / `divergent` の 3 段階に細分化する。差分行 highlight と、意味的に重い差分の警告フラグ (Option B/C) を追加する。
- **推奨:** **Option B** (3 段判定 + 差分行 highlight)。near-identical の閾値は派生として明示し UI で調整可能にする。
- **Open questions:** 6 件。**Assumptions:** 6 件。
- **ハンドオフ先:** Researcher (実レビュアーが graded 判定を実際に使うか検証)

---

## §1 Context Read — 既存 8e90179 の実装と拡張ポイント

### 1.1 既存実装の要点

| 層 | ファイル | 現状の動作 |
|---|---|---|
| API | `apps/api/src/gitService.js` L1115–L1165 | `git cherry -v <target> <base>` を実行。各行の `+`/`-` マーカーで equivalent / missing に振り分けるだけ。patch-id 計算は git 自身が行い、結果は binary。 |
| UI | `apps/ui/src/app/components/refscope/CommitTimeline.tsx` — `CherryStatus` / `CherryList` 関数 | equivalent と missing を別 group で色分け表示 (accent = `--rs-git-added` / `--rs-git-deleted`)。各エントリは `hash`, `shortHash`, `subject` のみ。 |
| API 型 | `apps/ui/src/app/api.ts` L294–L303 | `CompareCherryResult.equivalent: CherryEntry[]` / `missing: CherryEntry[]`。`CherryEntry = { hash, shortHash, subject }`。 |

### 1.2 binary 判定の限界

`git cherry` は **patch-id** (diff の content hash、コンテキスト行を除く変更行のハッシュ) を用いて一致を判断する。conflict 解決やコメント追加など "diff のコンテキスト行だけが変化した" ケースはほぼ同一と判定する一方で、1 行でもロジックが変わった commit は `+` (missing) に分類され "一致なし" と表示される。

問題は **`-` (equivalent) と判定された commit のうち** 、実際には git が patch-id の完全一致を確認しているため純粋な duplicate のはずだが、実運用では:

1. cherry-pick 後に別 commit でパッチを修正した場合
2. cherry-pick でなく手動適用した場合 (patch-id がずれる)
3. git cherry は「patch-id 一致 ≈ 適用済み」と推論するが、**厳密に同一 diff か否か** は確認しない

→ ユーザー Eleanor が懸念しているのは主に (3): patch-id が一致していても実際の diff content が一字一句同じかを視覚で確認する手段がない。

### 1.3 拡張ポイント

```
既存 equivalent リスト (binary)
  └─ [拡張] 各エントリにグレード付与
       ├─ identical   : git diff base_hash..target_equivalent_hash の出力が空
       ├─ near-identical : 行差分が threshold 以内 (例: ±5 行 or ±10%)
       └─ divergent   : threshold を超える差分 (patch-id は一致でも content は乖離)
```

API 側: `getCompareCherry` 内で `equivalent` リストの各ペアに対して追加の `git diff` を実行し、行差分量 (`added + deleted`) を計算して grade を付与する。

---

## §2 OST (Outcome Solution Tree)

```
Outcome:
  Eleanor が「equivalent と判定された cherry-pick に隠れた静かなロジック歪み」を
  compare view を離れずに 2 分以内に特定できる
  (KPI: graded 表示後の false-"equivalent" レポート件数、identical 確認時間中央値)
  │
  ├─ Opportunity 1: binary な equivalent/missing 分類では conflict 解決の歪みを見逃す
  │     └─ Solution: equivalent を identical/near-identical/divergent の 3 段階に細分化
  │
  ├─ Opportunity 2: 差分があることは分かっても「どこが違うか」が判断できない
  │     └─ Solution: near-identical の場合は差分行を inline で highlight
  │
  ├─ Opportunity 3: 差分行の多寡だけでは「制御フローが変わったか」が判断できない
  │     └─ Solution (Option C): 意味的に重い差分パターンの警告フラグ (if/return 反転等)
  │
  └─ Opportunity 4: threshold の選択が恣意的で信頼性が下がる
        └─ Solution: threshold を UI で公開し、デフォルト値を派生として明示
```

---

## §3 Hypothesis

> **H1:** graded 判定を導入することで、Eleanor が「equivalent と信じてスキップしたが実は差分があった」コミットを見逃す頻度を **50% 以上削減** できる。
>
> 検証方法: Researcher が 実レビュアー 5 名に「equivalent リストに divergent コミットを 1 件混入させたリポジトリ」を使ってブラインドレビューしてもらい、発見率を binary UI と graded UI で比較する。
>
> **Fail Condition:** graded UI での発見率が binary UI との差で 15% 未満 → kill。
>
> **注意事項 (正直な hypothesis):**
> - conflict 解決でロジック歪みが入るケースを確実に検出することは構造的に困難。patch-id は diff content hash であり、行差分量は「どれくらい変わったか」を量的に示すが「制御フローが変わったか」は示さない。H1 は "見逃し頻度削減" の仮説であり "完全検出" の仮説ではない。
> - near-identical の threshold (例: ±5 行) は派生値であり、repository の行数規模によって適切な値は異なる。threshold 自体がレビュアーの false alarm 率に影響する。

---

## §4 Options

### Option A: numeric similarity score 表示のみ (派生 小)

- `getCompareCherry` で各 equivalent エントリに `git diff --shortstat base..cherry_target` を追加実行し、`added + deleted` の行数を返す。
- UI では既存 CherryList の各行に「+2 -1 lines」の数値バッジを表示するだけ。
- binary 判定は維持。"identical" / "near-identical" の区分はない。
- **実装コスト:** API レスポンス拡張 + CherryEntry に `diffLines?: { added: number; deleted: number }` を追加。UI は badge を 1 要素追加するのみ。
- **限界:** 数値を見てもレビュアーが閾値の判断を毎回する必要がある。差分内容は見えない。

### Option B: 3 段判定 + 差分行 highlight (派生 中) ← 推奨

- `identical`: `added === 0 && deleted === 0` → 既存表示を維持 (green badge "identical")
- `near-identical`: `added + deleted <= threshold` (デフォルト 10 行) → yellow badge。差分 hunk を inline で折りたたみ表示。
- `divergent`: `added + deleted > threshold` → orange badge。差分 hunk を展開表示し、警告アイコン付き。
- threshold は UI 上のスライダー or 入力フィールドで `[1, 50]` の範囲で調整可能。デフォルト値 10 は派生であり、その旨を tooltip で明示。
- **API 変更:** `CherryEntry` に `grade: "identical" | "near-identical" | "divergent"` と `diffHunks?: string` を追加。`diffHunks` は `git diff -U3` の生テキスト (maxBytes 制限内)。
- **実装コスト:** API 側で equivalent N 件 × 1 git diff = N 回の追加 git 呼び出し。並列化可能だが大きな compare (500 件超) では遅延に注意 → 本 endpoint はすでに lazy fetch なので許容範囲と判断。
- **threshold の派生明示:** デフォルト 10 行は "2 関数の変更程度" という経験則。ユーザーが調整可能にすることで Refscope が独自に "正解" を主張しない設計を維持。

### Option C: B + 意味的に重い差分フラグ (派生 大)

- Option B に加え、diffHunks のテキストパターン解析で以下のフラグを追加:
  - `controlFlowChanged`: `if (.*) {` / `return ` / `throw ` の追加・削除を正規表現で検出
  - `signatureChanged`: 関数シグネチャ行 (`def `, `func `, `function `, `=>`) の変更検出
- フラグはあくまでヒューリスティクス (テキストパターン) であり、AST 解析ではない。D-5 (semantic diff, Request 5) で提案される AST ベース判定が実装された際に本フラグをそちらに移管または高精度化できる。
- **D-5 連携可能性:** Option C のフラグは D-5 (Eleanor の semantic diff 需要) との自然な接続点。D-5 が tree-sitter ベースの AST diff を実装した場合、Option C の正規表現フラグを AST 差分結果に置き換えることで精度が向上する。
- **実装コスト:** Option B の 2-3 倍。正規表現パターンのメンテナンスコストと false positive 管理が継続的に発生する。
- **正直な注意:** 正規表現ベースの制御フロー検出は false positive が高い (コメント行の "if" も検出する)。"意味的に重い" と表示することでレビュアーが過剰に警戒する逆効果も懸念される。

---

## §5 実装スケッチ

### 5.1 API レスポンス拡張 (`apps/api/src/gitService.js`)

既存 `getCompareCherry` の equivalent 集計後に追加処理:

```javascript
// (conceptual sketch — no code should be written from this alone)
// For each equivalent entry, run:
//   git diff -U3 --no-color equivalentHash cherryTargetHash
// where cherryTargetHash is the counterpart commit on target.
// Result: { added, deleted, hunks } → grade assignment.
```

ポイント:
- `git diff` は allowlist 既存コマンド。追加依存なし。
- `cherryTargetHash` の取得: `git cherry -v` 出力は base の commit ごとに `-/<+>` マーカーがつくが、target 側の対応 commit hash は直接出力されない。そのため、`git log --cherry-pick --left-right base...target` (あるいは `rev-list --cherry-pick`) で対応ペアを構築する必要がある。これは本提案の最大の実装不確実性。→ Open questions §6 参照。
- `diffMaxBytes` 制限を維持。hunk テキストが truncate された場合は `truncated: true` フラグを付与。

### 5.2 UI 拡張 (`apps/ui/src/app/components/refscope/CommitTimeline.tsx`)

既存 `CherryList` コンポーネントに grade badge と diff hunk 折りたたみを追加。既存の `equivalent`/`missing` の 2 グループ構造は維持し、equivalent グループ内を sub-group (identical / near-identical / divergent) に分割して表示。

threshold スライダーは `CompareBar` 内の UI state として管理 (App.tsx への state lift 不要)。base/target 変更時の reset ロジックは既存 `useEffect` に threshold reset を追加するだけ。

### 5.3 型変更 (`apps/ui/src/app/api.ts`)

```typescript
// Extends existing CherryEntry — existing fields unchanged
export type CherryEntry = {
  hash: string;
  shortHash: string;
  subject: string;
  // Added by Option B:
  grade?: "identical" | "near-identical" | "divergent";
  diffLines?: { added: number; deleted: number };
  diffHunks?: string;  // raw -U3 diff, may be truncated
  truncated?: boolean;
};
```

`CompareCherryResult` の `equivalent` / `missing` フィールドの型シグネチャは変わらず (`CherryEntry[]`)。optional フィールドの追加のみのため後方互換。

---

## §6 Open Questions

1. **target 側の対応 commit hash の取得方法:** `git cherry` は base commit が equivalent かどうかを示すが、target 側の「どの commit と等価か」を直接は出力しない。`git log --cherry-pick` か `git rev-list --cherry-pick --left-right` で対応ペアを構築できるか検証が必要。できない場合は Option A (行数バッジのみ) に縮退する。

2. **equivalent N 件 × git diff の遅延許容範囲:** 既に lazy fetch な endpoint だが、equivalent が 200 件の場合 N=200 の git diff が走る。並列実行 (`Promise.all`) で何秒以内に収まるか。10 秒超なら件数 cap or 件数しきい値が必要。

3. **near-identical の threshold デフォルト値:** 10 行が妥当かは repository の平均コミットサイズに依存する。別途データが必要。

4. **divergent (patch-id 一致だが diff あり) は現実に発生するか:** git の patch-id 仕様上、コメントや空白の変更が patch-id に影響しないため、実質的に "divergent" は patch-id 仕様の範囲内の minor 差異になる。real-world でどの程度の頻度か Researcher が確認する価値あり。

5. **missing (patch-id 不一致) にも行数差分を表示するか:** 現提案は equivalent 側のみ graded。missing は「そもそも適用されていない」なので行数差分の意味が薄いが、"どれくらいの変更か事前に見積もりたい" というニーズは別途ある。

6. **D-5 (semantic diff) との優先順位:** Option C の正規表現フラグは D-5 の副産物として再利用できる可能性が高い。D-5 の開発ロードマップが明確になる前に Option C を実装するとデッドウェイトになるリスク。

---

## §7 Assumptions

1. `git diff <hash1> <hash2>` は gitRunner allowlist の `diff` コマンドで実行可能であり、新コマンド追加は不要。
2. cherry-pick equivalence の lazy fetch 設計 (ユーザークリックで初回 fetch) は既存設計を踏襲し、graded 化後も維持する。
3. threshold はレポジトリ間で共通のデフォルト値を持ち、ユーザーセッション内のみ保持する (永続化しない)。
4. App.tsx の単一 state owner 制約は維持する。threshold は `CompareBar` 内 local state で完結する。
5. `git cherry` の `-` マーカー = patch-id 一致 = "equivalent" という git の保証は本提案でも前提とする。Refscope が独自に patch-id を再計算しない。
6. `synthetic: true` ── 本提案の urgency と adoption rate の推定はすべて Eleanor の合成 persona 需要に基づく。Researcher による実ユーザー検証前は confidence を 30% 以下として扱う。

---

## §8 RICE Score と Impact-Effort

| 要素 | 値 | 根拠 |
|---|---|---|
| Reach | 8 人/月 (推定) | Reviewer/Architect 相当のペルソナのみ。cherry-pick 多用チームに限定。 |
| Impact | 2 (Medium) | "見逃し頻度 50% 削減" 仮説が成立した場合の影響。未検証のため 3 は付けない。 |
| Confidence | 30% | synthetic demand、実ユーザー未検証。 |
| Effort | 3 人日 (Option B) / 6 人日 (Option C) | API: 1.5 日、UI: 1 日、テスト: 0.5 日。±30% バッファ含む。 |
| **RICE Score (Option B)** | **(8 × 2 × 0.30) / 3 ≈ 1.6** | Low (< 50)。Researcher で confidence 引き上げが前提。 |

**Impact-Effort 分類:** Fill-In (低 Effort・低 Impact)。confidence が上がれば Quick Win に移行できる可能性あり。

---

## §9 受入基準 (Option B)

- [ ] `CompareCherryResult.equivalent` の各エントリに `grade` (`identical` / `near-identical` / `divergent`) が付与される
- [ ] `near-identical` の閾値はデフォルト 10 行、UI スライダーで `[1, 50]` 行の範囲で変更可能
- [ ] `near-identical` / `divergent` のエントリには diff hunk が折りたたみで表示される
- [ ] threshold の意味と派生である旨が tooltip で明示される
- [ ] base/target 変更時に grade および hunk が既存の reset ロジックと同タイミングでクリアされる
- [ ] `diffMaxBytes` を超えた場合は `truncated: true` を表示し、silent truncation しない
- [ ] 既存 `missing` リストの表示・動作は変わらない

---

## §10 Hand-off

**推奨次エージェント: Researcher**

検証設計の要点:
- real reviewer 5 名に「identical / near-identical / divergent が混在する equivalent リスト」でブラインドレビューを依頼
- binary UI と graded UI を A/B 比較し、divergent の発見率・レビュー時間を計測
- threshold の適切な値をヒアリング (10 行 vs 他の値)

Researcher でのデータが揃い次第、confidence を更新して Builder への実装ハンドオフを判断する。

---

_補足_: 本提案は `docs/spark-tomo-file-history-proposal.md` の章立て・観察 vs 派生の語彙・OST 形式を踏襲している。
