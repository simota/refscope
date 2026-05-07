# Spark Proposal: Rewrite Rescue — 履歴 rewrite 前 tip の保存と復元コマンド提示

> Synthetic demand source: `docs/user-demand-report-2026-05-07-r6.md` — Carlos (DevOps, weekly rebase/cherry-pick fire-fighter)
> `synthetic: true` — 本ドキュメントは Plea が生成した合成ユーザー需要に基づく仮説提案であり、実ユーザー検証前の提案である。
> 上位エージェント: Plea (synthetic user advocate) → Spark (this document) → Researcher / Atlas / Builder (next).
> ロードマップ位置: **v2 候補**。read-only 哲学との整合が取れており、既存 SSE インフラの自然な拡張として位置付けられる。

---

## §0 Summary

- **対象ペルソナ:** Carlos (DevOps, weekly rebase/cherry-pick fire-fighter)
- **解こうとしている job-to-be-done:** force-push / rebase 事故が起きた後に「rewrite 前の状態に戻れる手順」を即座に把握すること。reflog を手で掘る作業を省き、Carlos が後輩へ正確な復元コマンドを伝えられる状態を作る。
- **推奨 Option:** B (localStorage 永続化)。API 拡張ゼロ、gitRunner allowlist 拡張ゼロ、かつブラウザを閉じても直近 N 件を保持できる。
- **read-only 哲学との境界:** 復元は「コマンド提示のみ」。git 操作の自動実行は一切しない。
- **核心:** SSE `history_rewritten` イベントには既に `previousHash` が含まれている。UI でこれを受け取った瞬間に localStorage へスナップショットを保存するだけで、新たな API エンドポイントも gitRunner allowlist 拡張も不要。
- **gitRunner allowlist 拡張不要:** reflog コマンドは allowlist 外だが、SSE イベント時点の `previousHash` を UI 側で記憶する設計なら allowlist に触れない。
- **RICE Score:** Reach=15, Impact=2, Confidence=50%, Effort=1.5 → **RICE ≈ 10** (Medium)
- **Impact-Effort 分類:** Quick Win (実装コスト小、高ペイン緩和)

---

## §1 Context Read — 既存 SSE `history_rewritten` イベントの実装

### 1.1 現行実装の確認

`apps/api/src/gitService.js` の `collectRefEvents()` は、ポーリングのたびに ref の変化を `compareRefSnapshots()` で差分検出する。ブランチ / リモートで「現在の commit が以前の commit の子孫ではない」ことを `isAncestor()` で判定した場合に以下の payload を発行する。

```js
// gitService.js L411-L422 (現行)
events.push({
  type: "history_rewritten",
  repoId: repo.id,
  ref: change.ref,              // { name, hash, ... }
  previousHash: change.previousHash,  // ← rewrite 前 tip が既に入っている
  currentHash: change.ref.hash,
  observedAt: new Date().toISOString(),
  detectionSource: "polling",
  explanation: "The current commit is not a descendant of the previously observed commit.",
});
```

**重要:** `previousHash` は既存フィールドとして発行されており、UI がこれを記録すれば「rewrite 前 tip」を保存できる。**API 側の変更は不要**（Option A/B）。API 側に `before_tip` という別名フィールドを追加するとしても、それは `previousHash` の alias にすぎない（Option C でのみ検討）。

### 1.2 SSE フロー（既存）

```
Git refs ──(RTGV_REF_POLL_MS ごと)──► collectRefEvents()
                                          │
                                     isAncestor() = false
                                          │
                              SSE event: history_rewritten
                                 { previousHash, currentHash, ... }
                                          │
                                    UI の SSE handler
                                 (apps/ui/src/app/api.ts)
```

UI の SSE ハンドラ (`api.ts`) はこのイベントを受信しているが、現状は表示のみで永続化はしていない。

### 1.3 allowlist 制約と reflog 問題

CLAUDE.md によると gitRunner の allowlist は:
`cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`

`git reflog` はこの allowlist に含まれない。本提案の核心設計は:
- **allowlist を拡張せず**、SSE イベントが届いた瞬間に `previousHash` を UI 側で記憶する
- reflog を API 側で読む必要がない（UI がリアルタイムでスナップショットを取るため）

---

## §2 Outcome Solution Tree (OST)

```
Outcome:
  Carlos が force-push/rebase 事故後に「rewrite 前状態への復元手順」を
  5 分以内に後輩へ伝えられる（現状: 15-30 分の reflog 解析）
  KPI: history_rewritten 検知後の "rescue command" パネル閲覧率
  (基準: 検知イベント総数のうち 30% 以上がパネルを開く)
  │
  ├─ Opportunity 1: rewrite 前 tip は消えていない (reflog に残る) が、
  │     見つけ方を知らないジュニアには取り出せない
  │     └─ Solution: SSE 受信時に previousHash をローカル保存し、
  │                  "この時点に戻る方法" を git コマンドとして生成・提示
  │
  ├─ Opportunity 2: reflog 操作の心理障壁 (難解な構文、事故への恐怖)
  │     └─ Solution: コマンドを生成し、コピーするだけにする (実行はしない)
  │
  └─ Opportunity 3: 複数ブランチで連続 rewrite が起きた場合の追跡困難
        └─ Solution: ブランチ別 + 時系列の "rewrite 履歴一覧" パネル
```

---

## §3 Hypothesis

**仮説:**
> `history_rewritten` 発火時に rewrite 前 tip を自動保存し、復元 git コマンドを提示することで、Carlos クラスの DevOps が後輩の force-push 事故を解決するまでの時間が現状比 50% 以上短縮される。

- **ターゲット指標:** "救出までの所要時間" (自己報告 or ユーザーインタビューで測定)
- **ベースライン:** 現状 15-30 分 (reflog を手動で調べる)
- **目標:** 5 分以内
- **検証方法:** Researcher エージェントによる DevOps ロールのユーザーインタビュー (3-5 名)
- **Fail Condition:** 30 日後の追跡インタビューで「このパネルは使っていない / 結局 CLI で reflog を見た」が 70% 以上 → kill

---

## §4 Options

### Option A: メモリ内のみ N 件保持（永続性なし）

**設計:**
- UI の SSE ハンドラ (`apps/ui/src/app/api.ts`) で `history_rewritten` を受信するたびに、`useRef` または state に `{ ref, previousHash, currentHash, observedAt }` を追加する
- 最大 N=20 件、古い順に削除 (FIFO)
- API 変更ゼロ、gitRunner allowlist 変更ゼロ

**長所:**
- 実装コスト最小 (UI のみ、1-2 日)
- 副作用なし、依存追加なし

**短所:**
- サーバ/ブラウザ再起動で消失
- SSE 切断中に発生した rewrite は検知できない (polling gap)
- Carlos が翌日「昨日の force-push、戻れる？」と聞かれたときに答えられない

**推奨:** PoC / 検証フェーズのみ。プロダクションには不十分。

---

### Option B: localStorage 永続化（推奨）

**設計:**
- `history_rewritten` 受信時に `window.localStorage` に JSON 追記
- キー: `refscope:rewrite_snapshots:<repoId>`
- 値: `{ ref: string, branch: string, previousHash: string, currentHash: string, observedAt: string }[]`
- 最大 50 件 / repoId、古い順に削除
- サーバ再起動後もブラウザが同じ端末なら保持

**長所:**
- API 変更ゼロ、allowlist 変更ゼロ
- ブラウザを閉じて開き直しても保持
- 実装コスト小 (UI のみ、2-3 日)

**短所:**
- ブラウザバインド (別端末・別ブラウザには引き継がれない)
- SSE が切断されていた間の rewrite は保存できない (= SSE を開いていた期間のみ保護)
- 50 件を超えると古い rewrite が消える

**SSE gap リスクへの対処:** これは仕様として明示する (UI にバナー「SSE が切断されていた間の rewrite は記録されていない可能性があります」)。reflog の完全代替ではなくアシスト。

**推奨:** v2 MVP として採用。

---

### Option C: API 側 JSON/SQLite 永続化

**設計:**
- API (`apps/api/src/`) 側に `rewriteStore.js` を追加
- `gitService.collectRefEvents()` が `history_rewritten` を生成した時点で Node.js 側の JSON ファイル (またはインメモリ Map + 定期 flush) に保存
- 新エンドポイント `GET /api/repos/:repoId/rewrite-snapshots` を追加
- クライアントが複数でも同じデータを参照可能

**長所:**
- SSE 切断期間中の rewrite も保存される
- 複数ブラウザ・複数クライアントで共有
- reflog が消えた後でも (GC が走った後でも) 参照可能

**短所:**
- API への依存追加 (SQLite を選ぶと `better-sqlite3` 等、新依存)
- JSON ファイルを選んでも書き込み競合・耐障害性の懸念
- `Architecture Review` flag 必要 (依存最小哲学との摩擦)
- 実装コスト中 (API + UI、5-8 日)

**判断:** Option C の価値は「複数クライアント共有」と「SSE gap 補完」。どちらもプロダクション初期ではまず不要なため、今フェーズでは推奨しない。Atlas による永続化スコープ判断後に検討。

---

## §5 実装スケッチ（Option B ベース）

### 5.1 API 側 SSE payload（変更なし）

現行の `history_rewritten` payload に既に `previousHash` が含まれているため、API 側の変更は不要。

将来的に `before_tip` という alias フィールドを追加する場合:
```js
// gitService.js — collectRefEvents() の拡張（Option C 採用時のみ）
events.push({
  type: "history_rewritten",
  // ...既存フィールド...
  before_tip: change.previousHash,  // previousHash の alias (可読性向上)
});
```

### 5.2 UI 側 SSE ハンドラの拡張（Option B）

```typescript
// apps/ui/src/app/api.ts — SSE ハンドラ内
// 既存の history_rewritten ハンドリングに追加
case "history_rewritten": {
  const entry = {
    ref: event.ref.name,
    branch: event.ref.name.replace("refs/heads/", ""),
    previousHash: event.previousHash,
    currentHash: event.currentHash,
    observedAt: event.observedAt,
  };
  saveRewriteSnapshot(event.repoId, entry);
  break;
}

// localStorage ヘルパー (apps/ui/src/app/rewriteStore.ts として切り出し)
const MAX_SNAPSHOTS = 50;
const storageKey = (repoId: string) => `refscope:rewrite_snapshots:${repoId}`;

function saveRewriteSnapshot(repoId: string, entry: RewriteSnapshot) {
  const existing = loadRewriteSnapshots(repoId);
  const updated = [entry, ...existing].slice(0, MAX_SNAPSHOTS);
  localStorage.setItem(storageKey(repoId), JSON.stringify(updated));
}

function loadRewriteSnapshots(repoId: string): RewriteSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(repoId)) ?? "[]");
  } catch {
    return [];
  }
}
```

### 5.3 復元コマンド生成テンプレート

以下のコマンドを UI がテキストとして生成し、コピーボタンで提供する。

```
# ブランチを rewrite 前の状態に戻す (ローカルのみ)
git checkout <branch>
git reset --hard <previousHash>

# 確認
git log --oneline -5

# (オプション) remote に強制 push で戻す場合 — 影響範囲を必ず確認してから
# git push --force-with-lease origin <branch>
```

- `<branch>` = スナップショットの `branch` フィールド
- `<previousHash>` = スナップショットの `previousHash` フィールド
- `--force-with-lease` を提案するが、remote への自動実行は一切しない
- remote への強制 push は「オプション」としてコメントアウトで提示し、ユーザーが意図的に選択することを明示

### 5.4 UI コンポーネント

**エントリポイント:** `DetailPanel` の下部または `BranchSidebar` のブランチコンテキストメニューに「Rewrite 履歴」アイコンを追加。

**パネル構造 (新規: `RewriteRescuePanel`):**

```
┌─────────────────────────────────────────┐
│ Rewrite 履歴 (直近 50 件)               │
│ ── SSE gap 警告 (切断期間中は記録なし) ─ │
│                                         │
│ [2026-05-07 14:23] refs/heads/feature-x │
│  Before: abc1234  After: def5678        │
│  [復元コマンドをコピー] [詳細を展開 ▼]  │
│                                         │
│ [2026-05-06 09:11] refs/heads/main      │
│  Before: 9ab4321  After: 2cd8765        │
│  [復元コマンドをコピー]                 │
└─────────────────────────────────────────┘
```

**復元コマンドの表示:**
- コピーボタンクリックで clipboard に copy
- `<code>` ブロックで mono font 表示
- `--force-with-lease` 行はグレーアウト + 「影響範囲を確認してから使用」の警告テキスト付き

---

## §6 Open Questions

1. **保存期間:** localStorage の 50 件上限は十分か？ 週 5 回 force-push が起きる環境では 10 日分しかない。N を設定可能にすべきか？
2. **ブランチ削除時の扱い:** ブランチが削除された後でも rewrite スナップショットは表示するか？ 「削除済みブランチ」として明示すれば有用だが、UI が煩雑になる。
3. **複数クライアント間の同期:** Carlos が 2 台の PC で作業している場合、localStorage は同期されない。チームへの共有はどうするか？（Option C の適用判断に影響）
4. **SSE gap の補完:** refscope が起動していなかった期間の rewrite を遡及的に検知する手段がない。これをユーザーに明確に伝える文言をどう設計するか？
5. **previousHash の有効性:** force-push で rewrite 前の commit が GC される可能性は低いが、ゼロではない。コマンド提示後に `git cat-file -t <previousHash>` で existence 確認すべきか？
6. **undo vs rescue の命名:** "rewrite rescue" は適切か？ "rebase undo helper" の方が Carlos には直感的かもしれない。

---

## §7 Assumptions

1. Carlos は週 2 回以上 `history_rewritten` イベントが発生する環境にいる。(synthetic — Researcher 検証要)
2. refscope の SSE が「事故発生前から接続されている」ことが多い。接続が切れていた場合は記録なし。(技術的制約として許容)
3. localStorage は 5MB 程度の制限があるが、テキスト JSON 50 件では上限に達しない。(1 件 ≈ 300 bytes → 50 件 = 15KB、問題なし)
4. 復元コマンドの提示で「実行に踏み切れる確信」が得られる。コマンドを「読む」だけで安心感が出る、という心理的効果を仮定している。(synthetic — Researcher 検証要)
5. `previousHash` は rewrite 発生直後のポーリングで確実に捕捉される。ポーリング間隔 (`RTGV_REF_POLL_MS` デフォルト) より短い間隔で 2 回以上 force-push が起きた場合、中間 tip は失われる。(既知の限界、仕様として明示)
6. read-only 哲学の境界: 「コマンドをクリップボードにコピーする」は read-only 範囲内として扱う。実行はしない。

---

## §8 Hand-off

### Researcher へ
- **検証事項:** Carlos クラスの DevOps に対して「refscope が force-push 事故の前から SSE 接続されているか？」「rewrite を自分で検知しているか、それとも後から気づくか？」をインタビューで確認する。
- **仮説の核心:** 「リアルタイムスナップショット」で十分か、「事後的に reflog を遡る」ニーズが強いか。後者なら Option C を検討する根拠になる。

### Atlas へ
- **判断事項:** 永続化スコープの決定。localStorage (Option B) で長期的に十分か、API 側永続化 (Option C) への拡張が必要かを、チーム共有・SSE gap 補完の優先度をもとに判断する。
- **Architecture Review flag:** Option C は依存最小哲学 (plain ESM, no framework) との摩擦あり。新依存の採用基準を Atlas が判断する。

### Builder へ (Researcher/Atlas の判断後)
- **実装ターゲット:** Option B (localStorage 永続化)
- **対象ファイル:**
  - `apps/ui/src/app/api.ts` — SSE ハンドラへのスナップショット保存処理追加
  - `apps/ui/src/app/rewriteStore.ts` — 新規作成 (localStorage CRUD)
  - `apps/ui/src/app/components/refscope/RewriteRescuePanel.tsx` — 新規作成 (一覧 + コマンド生成)
  - `apps/ui/src/app/App.tsx` — state に `rewriteSnapshots` を追加、`RewriteRescuePanel` に props 配布

---

## Appendix: RICE Score 計算

| 要素 | 値 | 根拠 |
|---|---|---|
| Reach | 15 users/quarter | DevOps ロールかつ rebase/force-push 運用があるチームに限定。synthetic 推定。 |
| Impact | 2 | 高ペイン軽減だが対象ユーザーが少ない。Impact=3 は全体の ≤20% ルールにより抑制。 |
| Confidence | 50% | synthetic 需要。実ユーザー検証未実施のため Confidence デフォルト値 50%。 |
| Effort | 1.5 person-weeks | 設計 0.5 + 実装 1 (UI のみ) + テスト 0.5 + ドキュメント 0.5 = 実質 1.5。 |
| **RICE** | **10** | (15 × 2 × 0.5) / 1.5 = 10 (Medium) |

Impact-Effort 分類: **Quick Win**
- Impact: 中 (対象ユーザーのペインは高いが母数は小)
- Effort: 小 (UI のみ、API 変更なし)

---

_STEP_COMPLETE:
  Agent: Spark
  Status: SUCCESS
  Output:
    deliverable: docs/spark-r6-carlos-rewrite-rescue-proposal.md
    artifact_type: Feature Proposal
    parameters:
      feature_name: Rewrite Rescue — 履歴 rewrite 前 tip の保存と復元コマンド提示
      target_persona: Carlos (DevOps, weekly rebase/cherry-pick fire-fighter)
      rice_score: 10 (Medium)
      impact_effort: Quick Win
      recommended_option: B (localStorage 永続化)
      validation_strategy: Researcher によるDevOps ロールインタビュー (3-5 名)
  Validations:
    - "synthetic: true 明示済み"
    - "read-only 哲学を破らない (コマンド提示のみ、自動実行禁止)"
    - "reflog allowlist 追加を回避 (SSE previousHash を UI 側で記憶)"
    - "永続化 3 オプションのトレードオフを正直に議論"
    - "RICE Score 計算済み、Confidence=50% (未検証)"
    - "Fail Condition 定義済み"
  Next: Researcher (DevOps の実 use case 検証で Confidence 引き上げ) → Atlas (永続化スコープ判断)
