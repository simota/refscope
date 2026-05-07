# Spark Proposal: Refactor Branch Health Dashboard (Refscope)

> Synthetic demand source: `docs/user-demand-report-2026-05-07-r6.md` — Maya (Tech Lead, 5-person team, 6 parallel refactor branches)
> `synthetic: true` — Plea 起源の合成ユーザー需要に基づく仮説提案。実ユーザー検証前。
> 上位エージェント: Plea → Spark (this document) → Researcher / Builder / Artisan (next)

---

## §0 Summary

- **対象ペルソナ:** Maya — Tech Lead、5名チーム、6本の並行リファクタブランチを束ねる
- **JTBD (progress sought):** 「月曜朝10分で、詰まっているブランチを判断してチームへ動き指示を出せる自信を持つ」
- **Problem:** 既存の active/stale/merged/diverged フィルタは "bin に入れる" バイナリビューであり、"6本を横並びで比較して意思決定する" ビューがない。Maya は手動で diverge量・経過日数を週次ドキュメントに集計している。
- **推奨 Option:** A（BranchSidebar にグループタブ追加）。画面遷移なし、allowlist 変更なし、App.tsx 単一 state owner 制約を守る。
- **RICE:** Reach=3, Impact=2, Confidence=40%, Effort=2.6 → Score ≈ **92 (Medium-High)**
- **Impact-Effort:** Quick Win (Option A) / Big Bet (Option B/C)

---

## §1 Context Read

### 1.1 コミット 8279d27 で実装済み (`BranchSidebar.tsx`)

| 機能 | 詳細 |
|------|------|
| `computeBranchHealth(ref, drift, now)` | 90日閾値→merged→diverged→active の優先判定 |
| `BranchHealthFilter` チップ行 | 3ブランチ以上で表示、ゼロ件バケット disabled |
| `HealthBadge` + `DriftHalo` | 各ブランチ行にバッジとahead/behind バー表示 |

### 1.2 D-3 の Gap（実装済みとの差分）

| Maya の需要 | 現状 | Gap |
|------------|------|-----|
| リファクタブランチを束で見る | 全ブランチ混在リスト | グルーピング機能なし |
| diverge量の数値横並び比較 | DriftHalo はバー（数値は tooltip のみ） | 数値カード形式なし |
| 最終 push からの経過日数表示 | `updatedAt` は内部保持、表示なし | 経過表示なし |
| 腐敗予兆スコアでソート | なし | スコア定義・ソートなし |
| conflict 予測 | なし | allowlist 外コマンド要（§4 Option C）|

### 1.3 API で観察値として取得可能なもの（allowlist 内）

- `for-each-ref` → `committerdate:iso-strict` → 最終 push 日時
- `rev-list --count <base>..<branch>` / `<branch>..<base>` → ahead / behind 数
- `merge-base <base> <branch>` → merge base ハッシュ

---

## §2 OST

```
Outcome: Maya が月曜朝10分で「どのブランチに介入すべきか」を判断できる
  │
  ├─ Opportunity 1: ブランチが混在して比較できない
  │     └─ Solution: 命名規則 or glob でグループ抽出 → カード形式横並び
  │
  ├─ Opportunity 2: health の 4 バケットはバイナリで程度が分からない
  │     └─ Solution: 腐敗予兆スコア(派生)を定義しソート可能にする
  │
  └─ Opportunity 3: conflict リスクを手動確認している
        └─ Solution (Option C のみ): git merge-tree ドライラン ─ allowlist 拡張要
```

---

## §3 Hypothesis

> **H-1:** Maya のような Tech Lead が refactor group view を使うと、
> ブランチ介入判断の所要時間が週30分から5分以下に短縮される。
>
> **Fail Condition:** 機能公開30日後に group view 週次利用率 < 10%、
> またはインタビュー3/5件で「手動ドキュメントの代替にならなかった」 → kill。

---

## §4 Options

### Option A: BranchSidebar に "refactor group" タブ追加（推奨、派生 小）

画面遷移なし。`App.tsx` に `refactorGroupPattern: string | null` を1件追加するだけ。

**UI スケッチ:**
```
┌─ BRANCHES ─────────────────────────────────────────────┐
│ ┌─ REFACTOR GROUP: "refactor/" ────────── [設定] ──┐   │
│ │ [!] refactor/user-service  ████ 47d stale  82pt  │   │
│ │ [!] refactor/logging       ██░░ 90d stale  77pt  │   │
│ │ [~] refactor/auth-module   ██░░ 12d active 41pt  │   │
│ │ [✓] refactor/db-layer      ░░░░  3d active  8pt  │   │
│ └──────────────────────────────────────────────────┘   │
│ All  Active  Stale  Merged  Diverged  [既存フィルタ]     │
└────────────────────────────────────────────────────────┘
```

**実装スコープ:**
- `BranchSidebar.tsx` に `RefactorGroupPanel` コンポーネント追加
- API 変更なし（既存 `/api/repos/:repoId/refs/drift` を再利用）
- TopBar か Cmd+K から group prefix を設定（localStorage 保存）

---

### Option B: 専用 dashboard 画面追加（派生 中）

TopBar に "Dashboard" ボタン → 全画面オーバーレイ。  
カード2列グリッドに拡大、"Copy weekly report" ボタン（Markdown クリップボード）。  
新規 endpoint: `/api/repos/:repoId/refs/group-health?pattern=refactor/*`  
— `for-each-ref` + `rev-list` + `merge-base` をバッチ返却。allowlist 変更不要。

---

### Option C: B + conflict 予測（派生 大）⚠ Architecture Review Required

`git merge-tree --write-tree <base> <branch>` (Git 2.38+) でドライラン。  
**allowlist に `merge-tree` の追加が必要。**

リスク: merge-tree は一時オブジェクトを `.git/objects` に書く —
refscope の "read-only philosophy" の境界判断が必要。  
**判断は Magi or Atlas へ委任。**

| Option | 派生強度 | 画面遷移 | allowlist 変更 | 推定工数 |
|--------|---------|---------|--------------|---------|
| A | 小 | なし | 不要 | 1.5-2wk |
| B | 中 | あり | 不要 | 3-4wk |
| C | 大 | あり | 要（Architecture Review）| 5-7wk |

---

## §5 実装スケッチ

### グルーピング規則

- **デフォルト:** longest-common-prefix 集計 → "refactor", "feat" 等キーワード候補を提示
- **手動設定:** glob 形式 `refactor/*`, 複数グループ `refactor/*,maya/*`
- 設定値は localStorage (repoId キー) に保存

### 腐敗予兆スコア定義

**観察値 (observed — Git raw data):**

| 変数 | 取得方法 |
|------|----------|
| `A` ahead | `rev-list --count <base>..<branch>` |
| `B` behind | `rev-list --count <branch>..<base>` |
| `D` days_since_push | `(now - committerdate)` / 1day |

**派生値 (derived — Refscope が計算):**

```
rotScore(A, B, D) =
  clamp(D / 7,  0, 10)   // 7日ごと+1 (staleness)
  + clamp(B / 5, 0, 10)  // 5コミット遅れごと+1 (behind drift)
  + clamp(A / 10, 0, 5)  // 10コミット先ごと+1 (ahead drift)
  → 整数、最大 25 点
```

**ラベルしきい値 (派生):**

| スコア | ラベル | 色トークン |
|--------|--------|-----------|
| 0–7 | healthy | `--rs-git-added` |
| 8–15 | warning | `--rs-warning` |
| 16–25 | critical | `--rs-git-deleted` |

**透明性:** カード hover 時に各変数の実測値と内訳を tooltip 表示。
「確実に腐敗」ではなく "rot risk score" として提示。

---

## §6 Open Questions

1. **グルーピング: 自動推測 vs 明示設定のデフォルト**  
   自動推測は初回摩擦が少ないが誤分類リスクあり。複数チーム横断の Maya には明示設定が安全か。

2. **スコア係数のチューニング**  
   D/7, B/5, A/10 は仮置き。ユーザー調整可能にするか、固定のまま検証するか。

3. **"腐敗予兆" vs "attention score"**  
   「腐敗」という語感は Maya の会議で共有しやすいが、ネガティブ過ぎる可能性。
   "needs attention" 系ラベルの方が中立的か。

4. **グループ設定の同期スコープ**  
   localStorage はブラウザ個人設定。チーム全員で共有するには API 側永続化が必要。

5. **cherry-pick 等価性の集計サマリ**  
   既存 cherry-pick パネル (8e90179) は2点間比較。6本横並びに件数サマリを出す場合の API コスト見積もりが必要。

---

## §7 Assumptions

1. `synthetic: true` — "30分→5分" 短縮は未検証の仮説。Researcher 検証が先決。
2. `committerdate` は最後のコミット日時。push タイムスタンプとのズレは考慮しない。
3. スコア係数はデフォルト値として仮置き。実ユーザーへの最適性は未検証。
4. 50本超リポジトリでは `REF_DRIFT_MAX_LIMIT=100` の既存上限内に収まる想定。
5. Option C の `merge-tree` は Git 2.38+ 必須。バージョン未満環境では "N/A" で graceful degradation。
6. App.tsx 単一 state owner 制約は Option A/B とも維持。子コンポーネントは独自フェッチをしない。

---

## §8 Hand-off

### RICE Score (Option A)

`(3 × 2 × 0.4) / 2.6 ≈ 0.92 → RICE ≈ 92`

| 要素 | 値 | 根拠 |
|------|---|------|
| Reach | 3 | Tech Lead 層、全ユーザーの推定10-20% |
| Impact | 2 | 週次会議削減は高インパクト。単一ペルソナ特化。|
| Confidence | 40% | Synthetic demand。実インタビュー前。|
| Effort | 2.6wk | UI 1.5 + API 0 + 設計・テスト 0.8 (×1.3 buffer)|

### 推奨 Option: A

conflict 予測なしでも Maya の核心ニーズ（横並び比較・スコアソート）を満たす。
Option B/C は A 検証後にインクリメンタルに積み上げ可能。

### Validation Path

1. **Researcher** → Tech Lead 3-5名に5-second test（カードモックを見せて判断内容を言ってもらう）
2. **Forge** → Option A の静的プロトタイプ
3. **Builder** → Option A 実装、**Artisan** → カード UI 磨き込み
4. **Magi / Atlas** → Option C の `merge-tree` allowlist 可否を判断

---

_STEP_COMPLETE:
  Agent: Spark
  Status: SUCCESS
  Output:
    deliverable: docs/spark-r6-maya-branch-dashboard-proposal.md
    artifact_type: Feature Proposal
    parameters:
      feature_name: Refactor Branch Health Dashboard — Group View
      target_persona: Maya (Tech Lead, 6 parallel refactor branches)
      rice_score: "92 (Option A)"
      impact_effort: Quick Win (Option A) / Big Bet (Option B/C)
      validation_strategy: 5-second test + Forge prototype before Builder handoff
  Validations:
    - "persona Maya と JTBD 定義済み"
    - "RICE score 計算済み (assumptions 明示)"
    - "8279d27 との差分を §1 で明示"
    - "腐敗予兆スコアを observed / 派生 で分離 (§5)"
    - "conflict 予測の allowlist 拡張要否を §4 Option C で flag"
    - "synthetic: true を §0/§7 で明示"
  Next: Researcher
  Reason: Confidence 40% のまま Builder 移行は不安全。Tech Lead インタビューで reach/confidence を引き上げてから実装判断。
