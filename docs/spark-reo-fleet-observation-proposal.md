# Spark Proposal: Fleet Observation Surface (Refscope)

> **Version:** v1.0 → v1.1 → v1.2 → v1.3 → **v1.4 (User authority override of Magi D4 verdict + UI repo add (persistent) 実装完了, 2026-05-03)**
> **v1.4 update overview:** Real user feedback "CLI から複数リポジトリを設定するより WEB UI でリポジトリを追加できるほうがよい" + user 明示選択 "A) Persistent (file-based)" により、Magi D4 verdict (3-0 unanimous で O1 reject) を user authority で override し、charter v2 supersede pathway (Magi D2 §6 規定) を経由して UI repo add (persistent) を実装完了。Charter v1 → v2 supersede (`docs/fleet-charter-v2.md`)、ADR-Fleet-002 (`docs/adr/ADR-Fleet-002.md`) 記録。実装: reposStore (atomic write + 0o600) + config merge (env+UI add list) + POST/DELETE/CSRF endpoints + tests (44 新規、合計 252/252 PASS) + UI AddRepoDialog + origin badge (env/ui) + Remove + api.ts wiring。Charter v2 §3 team-feature vocab 完全保持確認済 (`make verify` fleet-gate PASS)。§10.14 superseded mark 追加 + §15 Recommendation に v1.4 delivery 追記 + §14 Validation Strategy に Magi D4-v2 retreat trigger validation 追記。行数増分 ~30 行。
> **v1.3 update overview:** Magi post-MVP UI brainstorm D4 verdict (UI で repo を「開く」: O2 CommandPalette jump 強化採択、3-0 unanimous) と D5 verdict (ブックマーク機能: O4 現状維持 primary + O3 Last opened 採択、3-0 unanimous) を §10.14 / §10.15 (Open Questions) に追記。D4 O2 (CommandPalette jump `Detail: <repoId> を開く` × N + last opened sort) および D5 O3 (Last opened order memory — useLastOpenedRepos hook + FleetSurface "Recently opened" section) の実装完了 status を §6.11 (新節) + §6.1 (D4 O2 完了 mark) に反映。§16 および §14 に retreat 条件 R4-1/R5-1 integration を追記。行数増分 ~70-80 行。
> **v1.2 update overview:** Quill wording polish 5 件 (charter §1 建設的言い換え / charter §6.1 non-substantive exception 境界厳密化 / §6.9 hint overlay Aya-friendly 言い換え / §6.8 TopBar tooltip en/ja / §6.2 `—` hover tooltip trim) を in-place 適用。semantic 不変、行数増分 ~25-65 行。
> **v1.1 update overview:** Echo cognitive walkthrough (16 friction / 14 改善案 / 9 KPI judgment, Aya/Reo/Lin personas) + Magi 3 strategic verdicts (D1 surface name `Fleet` 確定 / D2 charter v1 immutable + non-substantive exception / D3 "build か" は **遅延 / Researcher Go gate 8w hard-cap**) を in-place 統合。Echo MUST 6 件 (S-A1, S-B1, S-B2, S-C1, S-C2, S-D1) を §5.1 / §5.8 / §6.1 / §6.2 / §6.4 / §6.9 (新節) に反映。Magi 3 verdicts を §6.1.1 (新節 retreat 条件) / §7 charter §1, §6 (3 amendment 項目) / §10.7 / §15 / §16 / §17 に反映。新節 §3.4 (JTBD chain), §6.9 (Onboarding hint overlay), §6.10 (Vision Implementation Notes), §6.1.1 (Surface 名 retreat 条件) を追加。Echo は完了済のため §16 next agents から除外、新順序は **[Researcher (8w hard-cap) ‖ Quill] → Magi 再 deliberation → Builder + Artisan (Researcher Go 時のみ)**。
>
> Synthetic demand source: Plea round 5 — Reo (Platform engineer / SRE / 12-20 repo を日常巡回 / on-call で 30 秒で fleet 観測したい)
> `synthetic: true` — このドキュメントは合成ユーザー需要に基づく仮説提案であり、実 SRE 検証前の提案である。
> 上位エージェントチェーン: Plea (synthetic user advocate) → Atlas (架構 handoff) → Vision (UX direction handoff) → Spark v1 (integration) → **Echo (cognitive walkthrough, 完了)** → **Magi (3 strategic verdicts, 完了)** → Spark v1.1 (this document) → Researcher / Quill / Magi 再 deliberation / Builder + Artisan (next, Researcher Go 後).
> 範囲: Refscope の TopBar に **Fleet mode** を追加し、`RTGV_REPOS` 全 repo を 1 surface で同時観測する surface を新設。既存の Detail mode (現行 UI) は無修正で温存。
> 不変契約: 派生情報は禁止。localhost only。team feature ではない。gitRunner allowlist は変更しない。

---

## 0. Summary

- 対象ペルソナ: Reo (12-20 repo を日常巡回する Platform engineer / SRE、on-call 中の高速巡回)。現状感情: 疲労 / 苛立ち / 諦め。
- 解こうとしている job-to-be-done: 「`RTGV_REPOS` で許可した全 repo について、"今 live で動いているか" を 1 つの surface で 30 秒以内に観測したい」。派生分析 (CI / deploy / 依存 / AI 要約) は要らない、live ping の集合だけが欲しい。
- 現状の死角: Refscope は 1 instance = 1 repo。Reo の机にはタブが 7 つ並び、各タブの "今 live で動いているか" は分からない。結局全部 click する。GitHub の Activity tab に戻る理由はそこだけ。
- 提案: Refscope の魂 (calm + observed-only + localhost) を **fleet 化**する 1 surface。TopBar に `[Fleet] [Detail · svc1]` mode toggle、Fleet mode は 1 行 = 1 repo の細い行 (28px) を `RTGV_REPOS` の数だけ並べ、左端の dot が live ping を伝える。
- スコープ強度 3 options:
  - **Option A (観測のみ最薄 MVP):** snapshot polling (30s) のみ。SSE 多重化なし。dot は polling 結果に基づく "差分検知"。最短実装。live 感は薄い。
  - **Option B (Hybrid 推奨, Atlas Decision):** snapshot polling (30s) + `GET /api/fleet/events` SSE 多重化 hybrid。Atlas 推奨案 (C) を 1:1 で実装。Vision の Mode toggle / 8 cells / Quiet+CVD 継承を完全に乗せる。
  - **Option C (Hybrid + 早期 ARI 互換):** Option B + fleet snapshot endpoint を MCP server からも叩ける契約として最初から JSON Schema で固定。ARI (Round 5 別 persona) の AI agent 接続を将来 enable。MCP server は本 RFC では作らない。
- 推奨: **Option B (Hybrid)**。Atlas Decision (C) を遵守、Vision の TopBar mode toggle を遵守、Reo の "live ping の集合" 要求に正面回答。
- 派生禁止 enforcement: 3 層防御 (Schema `additionalProperties:false` + `make verify` grep gate + immutable charter)。本 RFC に charter v1 草案を inline。
- 既存 gitRunner allowlist は **不変** (新 git command 無し)。Magi review skip 可。
- localhost only / SaaS 化 UI 要素禁止 / team feature ではない、を全 option で contract として固定。
- Open questions 9 件、assumptions 8 件を末尾に明示。

---

## 1. Context Read (本提案の前提)

| 参照 | 用途 |
|---|---|
| `CLAUDE.md` (project) | API は ESM JS、`gitRunner` 経由でのみ Git を呼ぶ。command allowlist (`cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`)。`signed:false` / `signatureStatus:"unknown"` 固定。`HOST` default `127.0.0.1`、`RTGV_REPOS` は allowlist Map。 |
| `apps/api/src/http.js` | hand-rolled router、SSE は `GET /api/repos/:repoId/events` で `connected, ref_created, ref_updated, ref_deleted, commit_added, history_rewritten, error` を emit。Fleet も同 router 上に新 route を追加する。 |
| `apps/api/src/gitService.js` | ref 列挙 / 24h commit count / ref move / worktree dirty / unauth detection を組み立てるため、既存 helper 群を再利用する (新 git command なし)。 |
| `apps/api/src/validation.js` | 公開入力の唯一の契約。Fleet 用に `parseFleetIncludeQuery` / `parseFleetWindowQuery` / `parseHost` を新設 (Atlas Decision)。 |
| `apps/ui/src/app/App.tsx` | UI の単一 state owner。`mode: "fleet" \| "detail"` を最上位 state に追加し、TopBar の segmented control で切替。 |
| `apps/ui/src/app/api.ts` | backend 呼び出しの単一 module。`subscribeFleet()` / `fetchFleetSnapshot()` を追加。SSE handling は既存 `subscribeRepoEvents()` のパターンを踏襲。 |
| `docs/spark-period-summary-proposal.md`, `docs/spark-tomo-file-history-proposal.md`, `docs/spark-riku-search-modes-proposal.md` | 既存 Spark proposal の format (層構造 / OST / RICE / Open questions / Risks / Next agents)。本 RFC は同 format に整合。 |
| Plea handoff (Reo verbatim) | 12 項目 AC、synthetic、派生禁止、localhost only、team feature ではない、silence 区別。 |
| Atlas handoff | SSE Hybrid (C) / cost 数値式 / Lens 階層 ADR-Fleet-001 / 3 層防御 / gitRunner 不変 / Validation 6 項目 / Localhost 8 点 / Silence 4 状態。 |
| Vision handoff | Surface 名 `Fleet` / TopBar 左端 segmented control / 28px row / 8 cells / `—` em-dash / 派生禁止語彙 list / Glyph CVD-safe / Quiet 継承 / aria-live coalesce / Forbidden UI elements / Excluded section visual。 |

### 1.1 観察データ (observed facts) として確定的に得られるもの

`gitService.js` の現状実装 + 既存 git command allowlist の範囲で以下は raw observed data として 1 row あたり取得可能:

- `repoId` (RTGV_REPOS map key)
- `headShortSha` (`git rev-parse --short HEAD`)
- `commits24h` (`git log --since="24 hours ago" --format=%H | wc -l` 相当を runner 経由で)
- `refMove1h` (boolean) — 直近 1h で `for-each-ref` の `objectname` が SSE で更新された事実があるか
- `worktreeDirty` (boolean) — `git diff --quiet HEAD` の exit code + `git ls-files --others --exclude-standard` の有無
- `lastEventAt` (ISO timestamp) — 最後に ref/commit event を観測した時刻
- `status` (`ok | timeout | git_error | missing | unauthorized` の enum)

### 1.2 派生 (inferred / interpreted) として **本 RFC では入れないもの** (charter で永久禁止)

- CI / build / deploy 状態 (Refscope は CI を観測しない)
- release readiness / deployment status
- dependency graph / cross-repo 解析
- AI 要約 (LLM narrative)
- score / ranking / severity / priority
- "hot" / "stale" / "trending" / "attention needed" 等の trend ラベル
- share link / public URL / signin / oauth / avatar
- team / organization / workspace / member / invite / role
- presence / live cursors / typing indicator
- email alert / SMS / browser push / webhook outbound

派生禁止語彙の完全 list は §6 charter v1 にある。Layer 2 grep gate でリポジトリレベルで弾く。

---

## 2. Outcome Solution Tree (OST)

```
Outcome:
  Reo が on-call 中、12-20 repo の "今 live で動いた fact" を 1 surface で 30 秒以内に観測できる
  (KPI: fleet view 表示後 detail に潜る率, "今動いた repo を識別" 中央値時間)
   │
   ├─ Opportunity 1: 1 instance = 1 repo 制約で 7 タブ巡回が必要
   │     └─ Solution: TopBar に Fleet mode toggle、1 行 1 repo の listbox
   │
   ├─ Opportunity 2: 各タブの "live か" が分からないので結局全 click
   │     └─ Solution: 左端 dot (live ping)、ref move glyph、wt dirty glyph、last event timestamp
   │
   ├─ Opportunity 3: silence の意味が分からない (Refscope 落ちか repo 静寂か)
   │     └─ Solution: silence 4 状態 (Healthy / SSE down / per-repo timeout / per-repo missing) 区別
   │
   ├─ Opportunity 4: derived view が混入すると "live ping 集合" の純度が落ちる
   │     └─ Solution: 3 層防御 (Schema / grep gate / immutable charter)
   │
   └─ Opportunity 5: 12 repo の購読 cost が unbounded だと自分の machine が重くなる
         └─ Solution: estimated cost を Footer に literal な数値で常時表示 + per-row exclude toggle
```

このうち単一機能としてのまとめは「Fleet observation surface」。本セッションでは AC 12 項目を 1 surface に集約する単一 RFC として扱う。

### 2.1 Reo の AC マッピング (全 option 共通)

| AC# | AC | 設計上の対応 | Option 別差分 |
|---|---|---|---|
| 1 | `RTGV_REPOS` 全 repo を 1 surface で同時観測 | Fleet mode の listbox (1 row = 1 repo) | A/B/C 共通 |
| 2 | 各 repo 1 行 = id / HEAD SHA / 24h commits / 1h ref move / worktree dirty / last event ts、派生禁止 | 8 cells (Vision-locked) | A/B/C 共通 |
| 3 | SSE 多重化 + dot pulse、Quiet 中は静止 / CVD 中は symbol | B/C で SSE 多重化、A は polling 由来の dot のみ | B/C 完全、A 部分 |
| 4 | click で既存 detail UI に切替、mode は TopBar に常時表示 | TopBar segmented control `[Fleet] [Detail · svc1]` | A/B/C 共通 |
| 5 | localhost only、SaaS 化 UI 要素禁止 | `parseHost` で public bind reject、Forbidden UI list を charter 化 | A/B/C 共通 |
| 6 | estimated cost (購読 repo 数 / git poll/min) を fleet view に明示 | Footer に `gitCallsPerMin ≒ 37 × N`、in-flight EventSource = 1、UI mem ≒ 14KB × N を literal で表示 | A は SSE 数値部分なし、B/C 完全 |
| 7 | CI / deploy / 依存 / AI 要約 など派生は一切禁止 | 3 層防御 (Schema / grep gate / charter) | B/C で 3 層全部、A は Layer 1+3 |
| 8 | Quiet / CVD-safe theme を継承 | Vision-locked: dot static / animation 0ms / aria-live coalesce / 4 row state ΔL ≥ 2 OKLCH | A/B/C 共通 |
| 9 | silence の原因 (timeout / repo 移動 / Refscope 障害) を区別表示 | A は 2 区別 (Healthy / config error)、B/C は 4 区別 (Healthy / SSE down / timeout / missing) | A 部分、B/C 完全 |
| 10 | team feature ではない根拠を docs に明示 | Charter v1 §1 "Inviolable principles" + Forbidden UI list | A/B/C 共通 |
| 11 | per-session 除外 toggle (localStorage 永続化) | `refscope.fleet.excluded.v1` (repo id 配列、path は保存しない) | A/B/C 共通 |
| 12 | 既存 lens 階層 (Live / Pulse / Stream) との関係を Vision/Atlas に委ねる | Atlas ADR-Fleet-001: Lens の上位 surface (Mode toggle)、Lens は detail mode 内のみ、`LensId` union 不変 | A/B/C 共通 |

---

## 3. Hypothesis & KPIs (全 option 共通枠)

### 3.1 Hypothesis (testable)

> 「Refscope の TopBar に Fleet mode を追加し、`RTGV_REPOS` 全 repo を 1 surface で 1 行 1 repo 形式で同時観測できれば、Reo のような on-call SRE は 30 秒以内に "今動いた repo" を識別でき、現状の "7 タブ巡回 + GitHub Activity tab への離脱" を排除できる」

### 3.2 KPIs (Refscope はローカル単独運用のため、ローカルで観測可能なものだけを採用)

| KPI | 観測方法 (ローカルで完結) | 目標値 (synthetic) | **Echo v1 walkthrough estimate** |
|---|---|---|---|
| K1: "今動いた repo を識別" 中央値時間 | UI mount 〜 row click まで (in-memory + optional debug overlay) | ≤ 3 秒 | **FAIL likely** (5-10s 推定 / Reo persona、F-A1 + F-B1 影響) |
| K2: Detail → Fleet 戻り中央値時間 | mode toggle click の往復時間 | ≤ 1.5 秒 | **FAIL likely** (2-4s 推定 / F-B1 count badge 不在で戻る動機が薄い) |
| K3: "Refscope 落ちたか repo 静かか" 判別精度 | Echo simulation で post-task survey | ≥ 95% | **FAIL likely** (Reo 60-70% / Aya 30-40% / Lin 50-65%、F-A2 + F-C3 + F-D2 + F-D3) |
| K4: Fleet mount 後 detail へ潜る発火率 | row click count / fleet mount count | ≥ 60% | conditional (Aya は overlay/tooltip 無しで mental model 形成不能 → S-C1 で救済) |
| K5: WCAG 2.2 AA contrast pass 率 | Warden audit | 100% | conditional PASS (定義上 PASS だが UX fail risk、F-D1) |
| K6: Quiet mode 時の active animation count | DevTools performance trace | 0 | **PASS** (Vision-locked) |
| K7: aria-live 12 repo 購読時の発火頻度 | SR test harness | ≤ 1/min (default), ≤ 0.3/min (Quiet) | conditional PASS (SR-fail UX: Quiet 中 180s で alive heartbeat 不在、F-D3) |
| K8: 派生禁止語彙 fleet code 内出現 | grep gate (`make verify`) | 0 | **PASS** (Vision-locked) |
| K9: 新 `--rs-*` token 導入数 | Vision audit | 0 | **PASS** (Vision-locked) |

> Echo v1 walkthrough findings 集計: 3 PASS (K6, K8, K9) / 3 conditional PASS (K4, K5, K7) / 3 FAIL likely (K1, K2, K3)。FAIL likely の救済策は §3.4 JTBD chain と §6.9 Onboarding 新節に対応。本 calibration は Refscope brand voice "self-honesty / observed-only" と整合し、success criteria の楽観バイアスを排除する。
>
> KPI は「ローカル単独で集計可能」を満たすため、telemetry をリモート送信せず `localStorage` または in-memory に置く。Refscope の "no external services" 原則と整合。

### 3.3 Fail Condition (kill criteria)

- 30 日 (Reo 相当 SRE 5 名のローカル試用) で K1 中央値 > 5 秒なら、fleet view が "全 click より速い" 仮説の棄却。Option A への退避を検討。
- K3 < 80% (silence 区別が機能していない) → Silence 4 状態 UI を再設計。3 名で同じ症状なら fleet 全体を opt-out 化。
- 派生禁止語彙 (`ci_status, deployment_status, ai_summary, score_, ranking_, severity_, share_link, login_, avatar, jwt, oauth, presence, ...`) が 1 token でも fleet code 内に出現 → CI fail、PR block。escape hatch なし (Atlas Decision: bypass 不可)。
- `RTGV_REPOS` N=32 cap を超えて起動した瞬間 fast-fail (Atlas Decision: hard-cap)。

### 3.4 JTBD chain (Echo latent needs から抽出, 6 件)

> Echo v1 walkthrough で抽出された 6 つの jobs-to-be-done を、対応する Echo MUST 改善案 (S-A1〜S-D3) と紐付けて記載。各 JTBD は K1-K9 の FAIL likely を救済する設計の根拠となる。

| JTBD | Persona | Job (progress sought) | 対応する改善案 (Echo MUST) |
|---|---|---|---|
| **JTBD-Reo-1** | Reo (on-call SRE) | incident 中、Refscope 自体の状態 (生きてる / 死んでる / repo 静か) を **1 秒で確信** したい — 推測の余地を残さない | **S-A1** (TopBar banner → listbox 全体 dim + center message に強化, §5.8.B) + **S-A2** (Footer SSE → TopBar 移動, SHOULD) |
| **JTBD-Reo-2** | Reo | Detail mode で 1 repo に潜っている間も、**他の repo で何か起きたら気付きたい** — peripheral vision として fleet を残したい | **S-B1** (`[Fleet · N]` count badge, §6.1) + **S-B2** (Detail mode 中も Fleet SSE 維持, §5.1) |
| **JTBD-Aya-1** | Aya (新卒 1 ヶ月目) | Fleet view を**初見で 5 秒以内に**「何が映っているか」理解したい — symbol を覚える前に意味が読めたい | **S-C1** (初回 mount hint overlay 正式仕様化, §6.9 新節) |
| **JTBD-Aya-2** | Aya | symbol (`—` `●` `⊘` `⊗` `✶`) を**覚えなくていい** — hover で答えが出てほしい | **S-C2** (`—` empty cell hover tooltip "no event in window (24h)", §6.2) + **S-C5** (Footer info icon, COULD) |
| **JTBD-Lin-1** | Lin (deuteranomaly + Quiet mode 常時) | color と animation 両方なしでも **shape のみで 5 状態を識別**したい (live / ref-move / wt-dirty / timeout / config-error) | **S-D1** (Glyph 階層 re-design: 3 shape base 分離 circle/square/cross, §6.4) |
| **JTBD-Lin-2** | Lin | Quiet mode で 180s 沈黙 が続く時、**intermittent (5min)** で "alive" の heartbeat が欲しい — "動いていない" 不安を解消 | **S-D3** (Quiet alive heartbeat announce, COULD) — **Magi 再 deliberation 候補** (D3 dissent と関連、§10 Open Question 化) |

JTBD chain と KPI 連関:
- JTBD-Reo-1 / JTBD-Reo-2 は K1, K2, K3 の FAIL likely を直接救済 (§5.8 + §6.1)。
- JTBD-Aya-1 / JTBD-Aya-2 は K4 (detail 潜入率) と K3 (silence 区別) の Aya persona 部分を救済 (§6.9 + §6.2)。
- JTBD-Lin-1 / JTBD-Lin-2 は K3 と K7 の SR-UX fail 部分を救済 (§6.4 + Open Question 追加)。

---

## 4. Feature Options

スコープ / コミット強度のスペクトラムを以下 3 段で並べる。Refscope の house pattern (派生強度別 3 options) は本件では機能しない (派生は禁止されている)。代わりに「実装のコミット深さ」で options 化する。

| Option | コミット強度 | 主な技術 | live 感 | enforcement layer |
|---|---|---|---|---|
| A | 最薄 (MVP) | snapshot polling 30s のみ | 弱 (polling 由来 dot のみ) | Layer 1 (Schema) + Layer 3 (Charter) |
| B | Hybrid (推奨) | snapshot polling 30s + SSE 多重化 | 強 (live ping 即時) | Layer 1+2+3 全部 |
| C | Hybrid + ARI 互換 | B + JSON Schema 固定 (MCP forward-compat) | 強 + 将来 AI agent 接続可 | Layer 1+2+3 全部 + ARI shape 固定 |

---

### 4.1 Option A — 観測のみ最薄 (MVP)

#### 4.1.1 概要

- snapshot endpoint `GET /api/fleet/snapshot` のみを実装。`RTGV_REPOS` 全 repo に対して `Promise.allSettled` で並列に observed facts を集約し、1 ペイロードで返す。
- UI は 30s 間隔で polling。dot は前回 snapshot との差分 (`headShortSha` 変化、`lastEventAt` 更新) に基づき 1 度だけ light up し、Quiet mode 中は静止表示。
- SSE 多重化なし → "live ping" は実質 polling 由来。Reo の "今 live で動いている" 体感は弱い。
- Reo の core demand "live ping の集合" を **最短実装** で出す位置づけ。implementation cost 最小、cost 説明力も最小。

#### 4.1.2 Scope

Reo の AC のうち以下を **完全充足**: 1, 2, 4, 5, 8, 10, 11, 12 (8/12)
**部分充足**: 3 (SSE なし、polling 由来 dot)、6 (estimated cost に SSE 数値部分なし)、9 (silence 区別が 2 状態のみ: Healthy / per-repo error)
**未充足**: なし (12 項目すべて何らかの形で answer)

#### 4.1.3 API contract

```
GET /api/fleet/snapshot?include=svc1,svc2&window=24h
  → 200
{
  "version": 1,
  "generatedAt": "2026-05-03T12:00:00.000Z",
  "window": "24h",
  "repos": [
    {
      "repoId": "svc1",
      "status": "ok",
      "headShortSha": "a1b2c3d",
      "commits24h": 7,
      "refMove1h": false,
      "worktreeDirty": false,
      "lastEventAt": "2026-05-03T11:42:18.000Z"
    },
    {
      "repoId": "svc2",
      "status": "timeout",
      "headShortSha": null,
      "commits24h": null,
      "refMove1h": null,
      "worktreeDirty": null,
      "lastEventAt": null
    }
  ],
  "estimatedCost": {
    "gitCallsPerMin": 24,
    "snapshotIntervalMs": 30000,
    "subscribedRepoCount": 12
  }
}
```

JSON Schema (`apps/api/schemas/fleet-response.schema.json`) は `additionalProperties: false` で固定。

#### 4.1.4 UI scope

- TopBar: segmented control `[Fleet] [Detail · svc1]`。click で `App.tsx` の `mode` state 切替。
- Fleet mode 内: 8 cells × N rows の listbox。
  - `[dot] [id] [HEAD short SHA] [24h commits] [1h ref move] [wt dirty] [last event] [exclude × on hover]`
- 派生禁止語彙 list (Vision-locked) を component 内 i18n string で literal に避ける。
- per-row exclude toggle: hover で右端に `×` 表示、click で `localStorage["refscope.fleet.excluded.v1"]` に追加。
- excluded section: listbox 末尾に separator + opacity 0.35 italic id + `↻` restore + `[Restore all]`。
- Footer: estimated cost を literal で表示 (例: `12 repos · git ~24/min · poll every 30s`)。形容詞禁止。

#### 4.1.5 gitRunner allowlist 影響

**不変**。新 git command なし。`commits24h` は `git log --since="24 hours ago" --format=%H` (既存 `log` allowlist)、`refMove1h` は内部状態 (snapshot の前回値) との比較で導出。`worktreeDirty` は `git diff --quiet HEAD` (既存 `diff`) + `git ls-files --others --exclude-standard` (※ `ls-files` は現状 allowlist になし、Option A では使わず `diff --quiet` のみで判定して `worktreeDirty` の精度を妥協する選択もある)。

> Note: Atlas Decision では `ls-files` を含めて allowlist 不変としているが、これは現行 untracked rendering 機能 (commit b68323d, 90e6775, abadcb3) で `ls-files` が既に gitRunner 経由で使われている前提に依存する。実装時に `gitRunner.js` の allowlist を確認し、もし `ls-files` が現時点で未追加なら、Option A は worktree dirty を `diff --quiet HEAD` のみで判定 (untracked は無視) することで allowlist 不変を維持する。**implementation precondition: lens で確認**。

#### 4.1.6 Estimated cost (Atlas 数値式から N=12 で具体数値)

- `gitCallsPerMin ≒ 37 × N` の根拠: refPoll 2s + snapshot 30s。Option A は SSE 多重化なしのため refPoll 部分が無く、snapshot のみ。
  - Option A: `gitCallsPerMin ≒ (60s / 30s) × git_calls_per_snapshot × N = 2 × ~3 × 12 = 72/min` (snapshot 1 回あたり repo あたり ~3 git command 想定: `rev-parse`, `log --since`, `diff --quiet`)
  - in-flight EventSource = **0** (SSE なし)
  - server side memory ≒ 100 KB / fleet snapshot in-flight
  - UI side memory ≒ 14 KB × N = 168 KB
- Footer 表示: `12 repos · git ~72/min · snapshot 30s · no SSE`

#### 4.1.7 派生禁止 enforcement layer

- **Layer 1 (Schema):** `apps/api/schemas/fleet-response.schema.json` を `additionalProperties: false` で固定。`apps/api/test/fleet-schema.test.js` で CI gate。
- **Layer 2 (grep gate):** Option A は SSE component が無いため code surface が小さく、grep gate なしでも回避可能 — だが **charter v1 で Layer 2 を将来導入する明文化を残す** (B/C にスケールした時の準備)。
- **Layer 3 (Charter):** `docs/fleet-charter.md` を immutable で切る。本 RFC §6 に inline。

#### 4.1.8 Quiet / CVD 継承

- 全 option で必須。Vision-locked: dot static / animation 0ms / halo 削除 / aria-live は listbox 1 つに集約 + 60s coalesce / Quiet 中は 180s + `aria-live="off"`。
- CVD-safe glyph: ● → ◆ (live ping) / ◆ (ref move、bluish-green hue) / ✶ (wt dirty、Wong amber) / ⊘ (timeout) / ⊗ (config error)。新 `--rs-*` token 導入 0、既存 token を再利用。

#### 4.1.9 Silence 区別

Option A は polling のみのため **2 区別** に縮退:
- **A. Healthy silent** (`status:"ok"` + lastObservedAt > 1h): 灰静止 dot
- **B. Per-repo config error** (`status:"timeout"|"missing"|"unauthorized"` を 1 つの red dot に統合): 該当行のみ red dot + tooltip でステータス詳細

Atlas Decision の 4 状態 (Healthy / SSE down / timeout / missing) は B/C で完全実装、A では SSE down が原理的に検出不能 (SSE 無し) のため 2 状態に縮退する。

#### 4.1.10 Pros / Cons

- **Pros:**
  - 実装最小 (server LOC ~150, UI LOC ~250, test LOC ~100)
  - SSE 多重化未実装でも live ping を 30s 単位で出せる (Reo の核要求の 70% は満たす)
  - Refscope の魂を保つ最短ルート (charter v1 を切るタイミングを早期化できる)
  - browser 6-conn 制約を全く触らない (in-flight EventSource = 0)
- **Cons:**
  - "live" 感が薄い (30s polling = on-call 中の体感では遅い)
  - silence 区別が 2 状態のみ (Reo の AC #9 を部分充足のみ)
  - Atlas Decision (Hybrid C) を 1:1 で実装していないため Atlas review で reject されるリスク
  - estimated cost の SSE 数値部分が空欄になり、Reo の AC #6 が部分充足

#### 4.1.11 Implementation cost (相対 estimate)

- Server: ~150 LOC (`apps/api/src/fleetService.js` 新規 + `validation.js` 拡張)
- UI: ~250 LOC (`apps/ui/src/app/components/refscope/FleetSurface.tsx` 新規 + `App.tsx` mode state 追加)
- Test: ~100 LOC (`apps/api/test/fleet-snapshot.test.js`, `fleet-schema.test.js`, `host-bind.test.js`)
- Total: ~500 LOC, 0.5 person-month

#### 4.1.12 Recommended for

急ぎ MVP。Atlas Decision を後追いで遵守する余地を残しつつ、Reo の核要求 (1 surface 観測) を最短で出したい場合。Option B への upgrade path はクリア (snapshot endpoint はそのまま、SSE endpoint を追加するだけ)。

---

### 4.2 Option B — Hybrid 推奨 (Atlas Decision)

#### 4.2.1 概要

- snapshot endpoint `GET /api/fleet/snapshot` (Option A と同一契約) **+** SSE 多重化 endpoint `GET /api/fleet/events`。
- Atlas Decision (C) を 1:1 で実装。比較表: (A) Multiple EventSource は browser 6-conn 制約で致命的、(B) Fleet SSE 単独は 24h 窓 fact が event-stream に乗らず不自然、(C) Hybrid は browser 制約解決 + silence 2 軸検知 + cost 予測容易 → **C を採択**。
- snapshot は 30s 間隔で polling (24h commit count / 1h ref move boolean / worktree dirty boolean を pull)、SSE は ref 系 push (ref_created / ref_updated / ref_deleted を multiplex)。
- Vision-locked decisions (Mode toggle / 8 cells / em-dash / Glyph / Quiet 継承 / aria-live coalesce / Forbidden UI / Excluded section) を完全に乗せる。
- **本 RFC の推奨 option**。

#### 4.2.2 Scope

Reo の AC 12 項目すべてを **完全充足**。

#### 4.2.3 API contract

**Snapshot endpoint** (Option A と同一):
```
GET /api/fleet/snapshot?include=svc1,svc2&window=24h
  → 200
{ version, generatedAt, window, repos[], estimatedCost }
```

**SSE endpoint** (新規):
```
GET /api/fleet/events?include=svc1,svc2
  → 200, text/event-stream
event: connected
data: {"subscribedRepoIds":["svc1","svc2",...],"heartbeatIntervalMs":25000}

event: ref_created
data: {"repoId":"svc1","ref":"refs/heads/feature-x","sha":"a1b2c3d","at":"2026-05-03T12:00:01.000Z"}

event: ref_updated
data: {"repoId":"svc1","ref":"refs/heads/main","sha":"e4f5g6h","at":"2026-05-03T12:00:02.000Z"}

event: ref_deleted
data: {"repoId":"svc1","ref":"refs/heads/old-branch","at":"2026-05-03T12:00:03.000Z"}

event: heartbeat
data: {"at":"2026-05-03T12:00:25.000Z"}

event: error
data: {"repoId":"svc2","status":"timeout","at":"2026-05-03T12:00:04.000Z"}
```

- `event: heartbeat` は既存 single-repo SSE の comment-frame からの **格上げ** (Atlas Decision)。25s 周期 + 5s grace で 30s timeout。既存 single-repo SSE (`GET /api/repos/:repoId/events`) は無修正。
- 既存 single-repo event types (`commit_added`, `history_rewritten`) は fleet には流さない (multiplex すると volume 過剰、Atlas-locked: ref 系 push のみ)。fleet で気づいた後 detail に潜って重い event を見る pattern。
- snapshot と SSE は別 connection。snapshot は 30s 間隔で UI が pull、SSE は常時 1 connection。

JSON Schema は両 endpoint について `apps/api/schemas/fleet-response.schema.json` と `apps/api/schemas/fleet-event.schema.json` を `additionalProperties: false` で固定。

#### 4.2.4 UI scope

Option A と同じ 8 cells, segmented control, exclude toggle, footer estimated cost。**追加で**:

- SSE connection 1 本を mount 時に開き、`ref_created/ref_updated/ref_deleted` を受信したら該当 row の dot を 1 度 light up (Quiet 中は静止表示のまま)。
- `event: heartbeat` を 30s 受信できなければ TopBar に banner ("Refscope SSE disconnected, retrying...") + 全行 gray-out。
- `event: error` で `status:"timeout"|"missing"|"unauthorized"` を per-row 表示 (amber dot ⊘ / red dot ⊗)。
- aria-live は listbox 全体に 1 つだけ + 60s coalesce window (Quiet 中は 180s + `aria-live="off"` 降格、SR 暴走防止)。
- per-row aria-live を置かない (二乗化問題への解、Vision-locked)。

#### 4.2.5 gitRunner allowlist 影響

**不変**。Option A と同じ。SSE event 生成は既存 single-repo SSE と同じ git polling pattern (`for-each-ref` + `rev-parse`) を repo ごとに `Promise.allSettled` で多重化するだけ。新 git command なし。Atlas Decision: Magi review skip 可。

#### 4.2.6 Estimated cost (N=12 で具体数値)

Atlas 数値式 `gitCallsPerMin ≒ 37 × N` を N=12 に当てて:
- `gitCallsPerMin ≒ 37 × 12 = 444/min` (refPoll 2s + snapshot 30s)
  - refPoll: 60s / 2s × 1 call × 12 = 360/min
  - snapshot: 60s / 30s × ~3 calls × 12 = 72/min
  - 合計 ~432/min (Atlas 数値式の round)
- in-flight EventSource = **1** (browser 6-conn の 1/6 のみ消費)
- server side memory ≒ 200 KB / 1 fleet connection
- UI side memory ≒ 14 KB × 12 = 168 KB
- Footer 表示: `12 repos · git ~432/min · poll 30s + SSE multiplex (1 conn)`
- Leverage: per-row exclude (線形減)、snapshot interval toggle (10s/30s/60s/off)、refPoll override (env var)

#### 4.2.7 派生禁止 enforcement layer

- **Layer 1 (Schema):** `apps/api/schemas/fleet-response.schema.json` + `fleet-event.schema.json` を `additionalProperties: false` で固定。`apps/api/test/fleet-schema.test.js` で CI gate。
- **Layer 2 (grep gate):** `scripts/ci/forbid-derived-words.sh` を `make verify` に組み込み。禁止 token 完全 list (charter §2 参照): `ci_status, deployment_status, release_ready, dependency_graph, ai_summary, llm_, openai, anthropic, score_, ranking_, severity_, share_link, public_url, signin, signup, login_, avatar, jwt, oauth, session_token` 等。bypass 不可 (escape hatch を最初から作らない、Atlas Decision)。
- **Layer 3 (Charter):** `docs/fleet-charter.md` を immutable (supersede のみ) で切る。PR template + CODEOWNERS で複数 review 必須。本 RFC §6 に inline。

#### 4.2.8 Quiet / CVD 継承

Option A と同じ。Vision-locked。

#### 4.2.9 Silence 区別 (Atlas Decision 4 状態完全実装)

- **A. Healthy silent** (`status:"ok"` + `lastObservedAt > 1h`): 灰静止 dot
- **B. Refscope SSE down** (heartbeat 30s 未受信): TopBar banner + 全行 gray-out
- **C. Per-repo git timeout** (`status:"timeout"`): 該当行のみ amber dot ⊘ + tooltip "git timeout (last seen: ...)"
- **D. Per-repo missing/unauthorized** (`status:"missing"|"unauthorized"`): 該当行のみ red dot ⊗ + tooltip "repo missing or unauthorized"

#### 4.2.10 Pros / Cons

- **Pros:**
  - Atlas Decision を 1:1 で実装、review コスト最小
  - Reo の "live ping の集合" を即時 push で satisfy
  - browser 6-conn 制約を 1/6 のみ消費
  - silence 4 状態を完全区別 (Reo の AC #9 完全充足)
  - 3 層防御を全部敷ける
  - Refscope の魂 (calm + observed-only + localhost) を保ったまま fleet 化できる
- **Cons:**
  - 実装 LOC が A より大きい (server +150, UI +120, test +200)
  - SSE multiplex の race 条件 / 再接続 / heartbeat の test surface が増える
  - `gitCallsPerMin ≒ 444/min` (N=12) は Reo の machine spec 次第で重い (snapshot interval toggle で leverage 提供)

#### 4.2.11 Implementation cost (相対 estimate)

- Server: ~300 LOC (`apps/api/src/fleetService.js` + SSE multiplex + heartbeat + `validation.js` 拡張)
- UI: ~370 LOC (`FleetSurface.tsx` + SSE handling in `api.ts` + TopBar mode toggle + Quiet/CVD continuity)
- Test: ~300 LOC (`fleet-snapshot.test.js`, `fleet-events.test.js`, `fleet-schema.test.js`, `host-bind.test.js`, `forbid-derived-words.test.js`)
- Total: ~970 LOC, 1.0-1.2 person-month

#### 4.2.12 Recommended for

**本命**。Atlas + Vision の handoff を 1:1 で実装し、Reo の AC 12 項目を完全に satisfy する。本 RFC の推奨 option。

---

### 4.3 Option C — Hybrid + 早期 ARI 互換 (forward-compat)

#### 4.3.1 概要

- Option B の全機能 + fleet snapshot endpoint と event schema を **MCP server からも叩ける契約** として最初から JSON Schema 化 / stable contract 化。
- ARI (Round 5 別 persona、AI agent positioning) との交差を将来 enable できる位置づけ。
- **MVP 範囲を拡げず "shape の固定" だけに留める** (現時点で MCP server は作らない、契約だけ stable に)。
- 将来 `apps/mcp/` ディレクトリが追加されたとき、`/api/fleet/snapshot` の JSON Schema をそのまま MCP tool definition に流用できる契約。
- 本 RFC では実装範囲は Option B と同じ。差分は **schema の意図と version 管理ポリシー** のみ。

#### 4.3.2 Scope

Option B と同じ AC 完全充足 + ARI roadmap 互換性 (将来の MCP 接続のため schema を破壊的変更しないコミット)。

#### 4.3.3 API contract

Option B と同じ。**追加で**:

- `apps/api/schemas/fleet-response.schema.json` の `version` field を `1` で start し、breaking change 時は `version` を bump する semver 戦略を charter §5 に明記。
- `additionalProperties: false` を厳格に維持し、optional な field を後から追加する場合も既存 consumer が壊れない backward-compatible な方針 (新 field は optional + default omitted)。
- MCP tool definition への変換可能性を考慮し、各 field に `description` を schema 内に書く。

#### 4.3.4 UI scope

Option B と同じ。差分なし。

#### 4.3.5 gitRunner allowlist 影響

Option B と同じ (**不変**)。

#### 4.3.6 Estimated cost (N=12)

Option B と同じ。差分なし。

#### 4.3.7 派生禁止 enforcement layer

Option B と同じ 3 層防御 + **追加で**:

- Schema の breaking change を検出する CI step (`apps/api/test/fleet-schema-stability.test.js` 新規)。
- Charter §5 に "schema は ARI/MCP forward-compat、breaking change は new path (`/api/fleet/v2/...`) として導入、v1 は deprecation 6 ヶ月" を明記。

#### 4.3.8 Quiet / CVD 継承

Option B と同じ。

#### 4.3.9 Silence 区別

Option B と同じ 4 状態完全実装。

#### 4.3.10 Pros / Cons

- **Pros:**
  - ARI roadmap がある場合、後から MCP server を生やすコストが minimum (schema 既に stable)
  - schema description が charter の自己文書化として機能
  - `version` field で breaking change を明示できる
- **Cons:**
  - "MCP server 作らないなら schema description は overhead" 議論が起こりうる
  - ARI persona の Plea round 5 demand が確定していない時点で forward-compat にコミットするのは YAGNI 違反のリスク
  - charter §5 を後から追加する手間が発生 (immutable charter の amendment フローが必要)

#### 4.3.11 Implementation cost (相対 estimate)

- Server: ~310 LOC (B + schema description 追加)
- UI: ~370 LOC (B と同じ)
- Test: ~340 LOC (B + schema-stability test)
- Total: ~1020 LOC, 1.1-1.3 person-month (B + ~10%)

#### 4.3.12 Recommended for

ARI roadmap が確定しており、6-12 ヶ月以内に MCP server を生やす計画がある場合。**そうでなければ Option B を選び、ARI が確定した時点で C へ migration** (schema description を後から追加するのは破壊的でない)。

---

## 5. Architecture (Atlas Decisions の再整理)

> 以下は Atlas handoff の locked decisions を proposal の架構レイヤとしてそのまま採用したもの。Spark の判断で変更しない。

### 5.1 SSE 多重化 — Hybrid (C) 採択

| 案 | 評価 | 採否 |
|---|---|---|
| (A) Multiple EventSource (1 connection per repo) | browser 6-conn 制約で 12-32 repo は致命的 | reject |
| (B) Fleet SSE 単独 (24h fact も event-stream に乗せる) | 24h 窓 fact が event-stream に乗らず不自然 | reject |
| (C) Hybrid (snapshot pull + SSE push) | browser 制約解決 + silence 2 軸検知 + cost 予測容易 | **採択** |

実装契約:
- `GET /api/fleet/snapshot` — interval pull (UI が 30s 間隔で叩く)
- `GET /api/fleet/events` — SSE 多重化 (常時 1 connection、ref 系 push のみ)

#### 5.1.1 Detail mode 中も Fleet SSE を維持 (Echo S-B2 + Atlas BLOCKING fix, v1.1)

> **Echo F-B2 Score 4 friction**: v1 proposal は Detail mode 中の Fleet SSE 接続維持を未明示。Builder/Artisan が違う前提で実装すると `[Fleet · N]` count badge (§6.1, S-B1) が動かない / Reo の JTBD-Reo-2 (peripheral vision) を満たせない。

**v1.1 で確定:**
- Detail mode 中も **Fleet SSE 接続は維持** (mount 時 1 connection を生成、Detail mode 切替で close しない)。
- Fleet SSE は `commit_added` (per-repo SSE 専用) は受信しないため、Detail mode 中も volume 過剰にならない (ref 系 push のみ multiplex は §4.2.3 の通り)。
- Detail mode 中の追加コスト: per-repo SSE 1 conn (詳細表示中 repo のみ) + Fleet SSE 1 conn = **browser 6-conn の 2/6 占有** (4/6 余り、十分安全)。
- Footer cost 数値式 (§5.2, §4.2.6) を `gitCallsPerMin ≒ 37 × N + 1 detail SSE` に更新 (Detail mode 中の per-repo SSE 1 本分を加算、`detail SSE` の literal 表記)。
- **実装規律 (Builder/Artisan handoff 必須項目):** `App.tsx` の `mode: "fleet" | "detail"` state 切替で Fleet SSE 接続は cleanup しない。Fleet SSE は repo 切替 (Detail target 変更) でも close しない。Fleet SSE の close 条件は ① unmount、② `mode` を `null` にする (現仕様には無い)、③ user による explicit disable のみ。

### 5.2 estimated cost 数値式

- `gitCallsPerMin ≒ 37 × N_repo` (default: refPoll 2s + snapshot 30s)
- in-flight EventSource = 常に **1** (browser 6-conn の 1/6 のみ消費)
- メモリ概算: server side ≒ 200 KB / 1 fleet connection (N=20)、UI side ≒ 14 KB × N
- Leverage 4 種:
  - per-row exclude (線形減)
  - snapshot interval toggle (10s/30s/60s/off)
  - refPoll override (env var)
  - SSE 切断時 polling fallback
- 表示先: **Footer 1 行**、literal な数値のみ ("軽い"等の形容詞禁止)

### 5.3 Lens 階層 ADR-Fleet-001

**(O2) Lens の上位 surface (Mode toggle)** を採用。`Fleet | Detail` の 2 mode を TopBar に置く。

- Lens (`Live / Pulse / Stream`) は detail mode 内のみ。fleet mode 内には Lens は無い。
- route 分離 (`/fleet`) は v2 で `?fleet=1` query から始める (browser history pollution を最小化)。
- Fitness function: `LensId` union が `'live' | 'pulse' | 'stream'` のまま固定。fleet が Lens に追加されない。

### 5.4 派生禁止 3 層防御

- **Layer 1 (Schema):** `apps/api/schemas/fleet-response.schema.json` + `fleet-event.schema.json` を `additionalProperties: false` で固定。`apps/api/test/fleet-schema.test.js` で CI gate。
- **Layer 2 (grep gate):** `scripts/ci/forbid-derived-words.sh` を `make verify` に組み込み。禁止 token 完全 list:
  ```
  ci_status, deployment_status, release_ready, dependency_graph,
  ai_summary, llm_, openai, anthropic,
  score_, ranking_, severity_,
  share_link, public_url,
  signin, signup, login_, avatar, jwt, oauth, session_token
  ```
  bypass 不可 (escape hatch を最初から作らない)。
- **Layer 3 (Charter):** `docs/fleet-charter.md` を **immutable** (supersede のみ) で切る。PR template + CODEOWNERS で複数 review 必須。

### 5.5 gitRunner allowlist 変更

**不要 (`false`)**。新 git command 無し。Magi review skip 可。

fact ↔ command の literal mapping (完全カバー):

| Fact | Git command (allowlist 内) |
|---|---|
| `headShortSha` | `rev-parse --short HEAD` |
| `commits24h` | `log --since="24 hours ago" --format=%H` |
| `refMove1h` | (内部状態; SSE で受信した ref event の timestamp から導出) |
| `worktreeDirty` | `diff --quiet HEAD` (exit code) + (untracked は既存 `ls-files` 使用ポリシーに従う) |
| `lastEventAt` | (内部状態; SSE event timestamp) |

### 5.6 Validation 強化 6 項目

1. `RTGV_REPOS` N_max = **32** で hard-cap (起動時 fast-fail)
2. realPath 重複拒否 (異 id 同 path の duplicate row 防止)
3. fleet endpoint per-repo timeout + `Promise.allSettled` で partial response 戦略
4. `status` enum 固定 (`ok | timeout | git_error | missing | unauthorized`)
5. `parseFleetIncludeQuery(value)` 新設 (per-session exclude を server に通知)
6. `parseFleetWindowQuery(value)` で window enum 受付 (`1h | 6h | 24h | 7d`)

### 5.7 Localhost only 8 点チェックリスト

- `HOST` default `127.0.0.1` 維持 + `parseHost(value)` で `0.0.0.0`/`::`/public IP を起動時 reject
- escape hatch: `RTGV_BIND_PUBLIC=1` (charter で警告、developer 自由度を残す)
- CORS / CSRF: SSE/snapshot 共に GET only (ADR-Fleet-002 として "Fleet feature is GET only" 固定)
- `tests/integration/host-bind.test.js` で `HOST=0.0.0.0` 拒否を CI 検証
- `RTGV_ALLOWED_ORIGINS=*` の運用は charter で自重を求める (Layer 1 で reject しない、developer 自由度)
- (3-8 は charter §3 を参照)

### 5.8 Silence 4 状態 + heartbeat

- **A. Healthy silent** (`status:"ok"` + lastObservedAt > 1h): 灰静止 dot
- **B. Refscope SSE down** (heartbeat 30s 未受信): **listbox 全体 dim (opacity 0.45) + center message overlay** (Echo S-A1, v1.1) — TopBar banner だけでは Reo の視線が banner に届かないため (Echo F-A2 Score 4 friction "TopBar banner と全行 gray-out の差分が dot レベルで 0")、listbox 全体を dim 化し中央に "Refscope disconnected · retrying..." の message を 1 つ置く。これで Reo の JTBD-Reo-1 (1 秒で確信) を満たす。Vision §5.8.B の "全行 gray-out" を本変更で **上書き**。
- **C. Per-repo git timeout** (`status:"timeout"`): 該当行のみ amber dot + tooltip
- **D. Per-repo missing/unauthorized** (`status:"missing"|"unauthorized"`): 該当行のみ red dot + tooltip

heartbeat: fleet endpoint のみ comment-frame → 明示 `event: heartbeat` event に格上げ (既存 single-repo SSE は無修正)、25s 周期 + 5s grace で 30s timeout。

> **Echo Open question (Magi 再 deliberation 候補):** Quiet mode 中、180s 沈黙が続いた時の "alive heartbeat" announce (S-D3 COULD) — Lin (deuteranomaly + SR + Quiet) JTBD-Lin-2 救済策。Magi D3 verdict (Pathos dissent: "Reo demand への倫理的応答") と関連し、Researcher Go 後の Magi 再 deliberation で扱う (§10 Open Question 拡張参照)。

---

## 6. UX Direction (Vision Decisions の再整理)

> 以下は Vision handoff の locked decisions を proposal の UX レイヤとしてそのまま採用したもの。Spark の判断で変更しない (Vision-flexible 部分のみ Spark が文脈で確定)。

### 6.1 Surface 名 / Position / 行構造

- **Surface 名:** **Fleet** ✅ **Magi D1 verdict 3-0 unanimous (Logos 70 / Pathos 65 / Sophia 75) で v1.1 確定** — 採用根拠: Reo verbatim 尊重 + SRE precedent + brand category creation。Confidence 70/100 (medium)。詳細は §6.1.1 (retreat 条件) 参照。
- **Position:** TopBar の左端 mode toggle、Lens の並列ではない
  - Visual variant (Vision-flexible): **segmented control** `[Fleet] [Detail · svc1]` を採択 (tabs / dropdown より visual weight 軽く、2-mode の choice を即座に伝える)
  - **Detail mode 時の追加 visual (Echo S-B1 BLOCKING fix, v1.1):** `[Fleet · 3] [Detail · svc1]` の **count badge** を Fleet 側に表示。
    - **N の定義:** Detail mode 中に Fleet SSE で受信した ref event の数 (observed fact、`ref_created` + `ref_updated` + `ref_deleted` の累計)。Detail mode に切替えた瞬間 N=0 にリセットし、Fleet mode に戻った瞬間 N=0 にリセット。
    - **派生禁止 charter §1.1 整合:** N は observed event count であり、severity / priority / hotness のような derived label ではない。Echo F-B1 Score 5 friction (Reo が Detail 中に他 repo event を miss する) の救済。Reo JTBD-Reo-2 (peripheral vision) を満たす。
    - **Visual:** 既存 `Excluded (3)` pill (§6.6) と **同 token 再利用**、新 token 0。Fleet mode 中は count badge 非表示 (Fleet view 自体が peripheral vision の役割を担う)。
    - **TopBar tooltip:** "N events received in other repos since you opened this detail view"
- **Row 高:** 28px、mono 12px (既存 BranchRow と同 mental chain)
- **Column 構成 (8 cells):**
  ```
  [dot] [id] [HEAD short SHA] [24h commits] [1h ref move glyph] [wt dirty glyph] [last event] [exclude × on hover]
  ```

### 6.1.1 Surface 名 retreat 条件 (Magi D1 採択前提条件, v1.1 新節)

> Magi D1 verdict (`Fleet` 確定, 3-0 unanimous, Confidence 70/100 medium) は **3 つの retreat 条件**を持つ。以下のいずれかが trigger された場合、`Atrium` rename + charter v2 supersede フローへ移行する。

| Retreat trigger | 条件 | アクション |
|---|---|---|
| **R1: Echo Aya persona walkthrough fail** | Aya persona で 3 名中 ≥2 名 (≥66%) が "Fleet = team feature?" と回答 | `Atrium` rename + charter v2 supersede |
| **R2: Researcher 実 SRE survey fail** | 実 SRE 5 名で ≥3 名が "fleet という言葉から CI/deploy 連動を期待" と回答 | name retain + Footer microcopy 強化 (`"Fleet observes Git refs only — no CI/deploy"` を Footer info icon に追加) |
| **R3: 公開後 6 ヶ月以内に team feature 化要望** | GitHub Issue/Discussion で "Fleet feature の team 化要望" が ≥3 件 | name retain + charter §3 wording 強化 (Forbidden UI vocabulary list の語感を更に強化) |

**Magi D1 採択前提条件 (mandatory):**
1. **TopBar tooltip `"Fleet: your repos, one user, one machine"` (en) / `"Fleet：あなたのリポジトリ専用、1 人・1 台"` (ja) を mandatory** (常時 hover 可能、隠さない、CSS で `pointer-events:none` 等で抑制しない) — Quill v1.2 polish 確定 wording (§6.8 参照)
2. charter §3 Forbidden UI vocabulary list に `Team`, `Organization`, `Workspace`, `Members`, `Invite`, `Role`, `presence` を含める (現草案で OK、§7 §3 で確認済)
3. CommandPalette jump label "Fleet モードに切替" の i18n に "(複数 repo 観測 mode)" 補足を tooltip 併記 (Aya/Lin/non-native English speaker の理解補助)

**Cross-decision dependency (Magi cross-decision):**
- D1 採択は D2 charter §3 forbidden vocabulary を前提 (Team/Organization 禁止で Fleet の team 連想を打ち消し)
- D1 retreat (Atrium) は D2 charter §2/§3 wording 連鎖 amendment trigger (charter v2 supersede)

### 6.2 Empty cell rule

- **`0` ではなく `—` (em-dash)** を使う。
- boolean は `●` / `—` (count ではない)。
- 理由: `0` は "集計判断" を匂わせ、Reo の "派生禁止" 信条に微妙違反。
- **Echo S-C2 hover tooltip (v1.2 polish):** `—` cell に **hover/focus tooltip** を表示。Echo F-C2 Score 5 friction (`—` empty cell が "壊れた" と読める / Aya 70-80%) の救済。Aya JTBD-Aya-2 (symbol を覚えなくていい / hover で答え) を満たす。
  - **tooltip 文言 (Quill v1.2 確定):** `"No Git event observed (24h)"` (25 chars ≤ 40 ✓)
    - window 値は literal で含める: window=`1h` → `"No Git event observed (1h)"`、window=`6h` → `"No Git event observed (6h)"`、window=`7d` → `"No Git event observed (7d)"` (動的置換、最大 30 chars)。
  > **Quill v1.2 polish note:** v1.1 draft was `"no event in window (24h)"` (25 chars). Changes: `no event` → `No Git event` (capitalize for tooltip convention; add `Git` to specify the observation domain, preventing "event" from being read as "error" or "alert"). `in window` → `observed` (active verb form, consistent with §6.9 overlay "no Git event was observed"; shorter). Semantic identical: observed fact, 24h window literal preserved, forbidden vocabulary zero.
  - keyboard accessibility: `tabIndex={0}` + tooltip を aria-label として fall back (Tooltip primitive の既存 pattern 踏襲)。
  - 派生禁止 charter §1.1 整合チェック: "no event observed" は observed fact の literal 言い換えであり、severity / hotness のような derived label ではない。

### 6.3 派生禁止語彙 (Vision Forbidden vocabulary)

完全 list (UI 文言で使用禁止):
```
trend, hot, stale, risky, healthy, attention, ready, recommended,
score, rank, priority, severity, summary, analysis, insight, prediction
```

### 6.4 Glyph 階層 (CVD-safe) — **Echo S-D1 Re-design (v1.1)**

> **Echo F-D1 Score 5 friction:** `●/⊘/⊗` の 3 円形 shape が CVD+Quiet stacked grayscale で混同 (識別 50-65%)。Lin (deuteranomaly + Quiet) JTBD-Lin-1 救済策として、**3 shape base (circle / square / cross) 分離原則**で re-design。

| Glyph | 意味 | Shape base | Hue | v1 → v1.1 変更 |
|---|---|---|---|---|
| ● | live ping (transition on event) | **circle** | (existing token) | 不変 |
| ◆ | live ping CVD-safe variant | (rotated square ≈ circle 系) | (existing token) | 不変 |
| ◆ | ref move | (rotated square) | bluish-green | 不変 |
| ✶ | wt dirty | (asterisk star) | Wong amber | 不変 |
| **`!`** | timeout error (旧 `⊘`) | **square** (status_warning bg) | (existing warn token) | **v1.1 re-design** — 円形 base から離脱 |
| **`×`** | config error / missing / unauthorized (旧 `⊗`) | **cross** (no circle) | (existing error token) | **v1.1 re-design** — 円形 base から離脱 |

**3 shape base 分離原則 (v1.1):**
- **circle / circle-like (●, ◆)** — live / ref-move (positive observed event 系)
- **square (`!`)** — timeout (warning, partial-fail)
- **cross (`×`)** — config error (full-fail / out-of-scope)
- **asterisk-star (✶)** — wt dirty (working tree state, status とは独立軸)

CVD+Quiet stacked grayscale 環境でも shape のみで 4-5 状態を識別可能となる。

**派生禁止 charter §2 抵触チェック (v1.1):**
- shape encoding only。token 不変 (status_warning / status_error の既存 OKLCH token を再利用)。
- glyph 自体は observed fact (timeout / missing) の visual encoding であり、severity / priority / ranking のような derived label ではない。
- ✅ charter §1 / §2 抵触なし。

新 `--rs-*` token 導入 **0**、既存 token を再利用。

### 6.5 Quiet 継承 + aria-live coalesce

- dot は static で残す (光った形跡を保持)、animation 0ms、halo 削除
- aria-live は **listbox 全体に 1 つだけ + 60s coalesce window**
  - Quiet 中は 180s + `aria-live="off"` 降格、SR 暴走防止
- per-row aria-live を置かない (二乗化問題への解、計算量を線形以下に)

### 6.6 Excluded localStorage

- key: `refscope.fleet.excluded.v1`
- value: repo id 配列 (path は保存しない、leak 防止)
- Excluded section visual (Vision-flexible): listbox 末尾に **薄い 1px separator** + 個別 `↻` restore + `[Restore all]`
  - excluded row は opacity 0.35 italic id
  - separator は既存 `--rs-border` token 再利用

### 6.7 Forbidden UI elements (完全 list)

```
login, sign in, sign up, avatar, profile pic, "you" label, "logged in as",
Share, Copy link, Send to..., OG card, @mention,
Assign to, Owner, Watcher, Comment, discussion thread,
Approve, Request review, Merge, Activity feed of users,
Currently viewing, Team, Organization, Workspace navigation, Members, Invite, Role,
Active users, presence, live cursors, typing indicator,
Upgrade to Pro, pricing, billing CTA, Free trial, Demo CTA, usage quota,
telemetry opt-in,
email alert, SMS, browser push, webhook outbound,
sync to cloud, backup
```

### 6.8 Microcopy (Vision-flexible で Spark が確定)

- **TopBar tooltip (Quill v1.2 polish, Magi D1 mandatory):**
  - **en:** `"Fleet: your repos, one user, one machine"` (≤ 50 chars: 38 chars ✓)
  - **ja:** `"Fleet：あなたのリポジトリ専用、1 人・1 台"` (≤ 50 chars: 23 chars ✓)
  > **Quill v1.2 polish note:** v1.1 draft was `"Fleet = your repos, single user, single machine"` (47 chars). Changes: `=` → `:` (colon is the conventional tooltip label separator in UI text); `single user` → `one user` (plainer, consistent with §6.9 overlay "Just you"); `single machine` → `one machine` (same). Semantic identical: single-user/single-machine mental model is preserved. Japanese adds `専用` (dedicated) to reinforce personal-use framing without introducing team vocabulary.
- **Footer (all quiet):** "All quiet · 12 repos observed · last event 14m ago" (literal な事実のみ、形容詞禁止)
- **Excluded pill (hydration tick 一瞬出る問題は Artisan handoff で明記):** `Excluded (3)`
- **CommandPalette jump label (Refscope の i18n pattern に追従):**
  - `Fleet モードに切替` — tooltip "(複数 repo 観測 mode)" 併記 (Magi D1 採択前提条件 #3)
  - `Detail: svc1 を開く` ... × N (12 repo × 2 mode = 24 commands、palette ranking ADR は Open question §10.3)
  - **D4 O2 実装完了 (2026-05-03):** `Detail: <repoId> を開く` × N コマンドを CommandPalette に追加、last opened 順 sort (operation history のみ、派生 score 禁止)。Magi D4 採択前提条件 #1 "CommandPalette §6.8 設計 full 実装" 完了確認 (`apps/ui/src/app/components/refscope/CommandPalette.tsx` +55 LOC)。

### 6.9 Onboarding hint overlay (Echo S-C1, v1.1 新節)

> **Echo F-C5 + 12.3 risk → 正式仕様化 (v1.1):** Aya (新卒 1 ヶ月目 / Git 初学者) JTBD-Aya-1 (初見で 5 秒以内に "何が映っているか" 理解) の救済策。v1 §12.3 で risk 認識 (overlay 自体が Quiet 原則と競合する可能性) のみ記載していたものを、本 v1.1 で **正式仕様化** する。

**仕様 (v1.1 確定):**

- **Trigger:** Fleet mode を初めて mount した瞬間 (`refscope.fleet.intro.dismissed.v1` localStorage key を読み、未 set なら表示)。
- **Persistence:** Quiet mode 中も **persistent until dismiss** (5 秒 auto-dismiss しない、Aya は 5 秒で読み切れない可能性、JTBD-Aya-1 を満たすため)。dismiss 操作 (`×` button or "Got it" button click) で `refscope.fleet.intro.dismissed.v1 = true` を set し、以後表示しない。
- **localStorage key:** `refscope.fleet.intro.dismissed.v1` (value: `"true"` / repo path や id を保存しない)。
- **位置:** Fleet listbox の top の真上に inline overlay (modal ではない、focus を奪わない、SR が listbox 構造を読む邪魔をしない)。
- **文言 (Quill v1.2 polish 確定):**
  ```
  Fleet shows all repos you've registered with Refscope — one row per repo.
  Just you, your machine, your Git repos. Not a team tool.
  A dash (—) means no Git event was observed in the last 24 hours, not that something is broken.
  Click any row to open that repo in detail view. Press Esc to return here.
  ```
  > **Language note (en default):** The overlay defaults to English. If the UI ships i18n support in a future version, a Japanese translation is provided here for reference:
  > ```
  > Fleet は、Refscope に登録したすべてのリポジトリを一覧表示します（1 行 = 1 リポジトリ）。
  > あなた専用・あなたのマシン専用のツールです。チーム機能ではありません。
  > 「—」は過去 24 時間に Git イベントが観測されなかった意味です。壊れているわけではありません。
  > 行をクリックすると詳細ビューが開きます。Esc で Fleet 一覧に戻れます。
  > ```
  > Single-language (en only) is recommended for v1 to avoid i18n infrastructure overhead; Japanese text is a COULD for post-Researcher-Go Artisan phase.

  > **Quill v1.2 polish note (v1.1 draft → v1.2 confirmed):**
  > - v1.1 draft: "Fleet shows all repos at once. Click any row to dive into detail. / Empty cells (—) mean 'no event observed', not 'broken'."
  > - Changes: (1) "all repos at once" → "all repos you've registered with Refscope — one row per repo" (avoids env-var mention per Echo F-C5; adds the literal "one row per repo" mental model for Aya). (2) Added "Just you, your machine, your Git repos. Not a team tool." (single-user mental model in positive framing; no negation of SaaS). (3) "Empty cells (—)" → "A dash (—)" (plain noun for Aya who may not know the typographic term "em-dash"). (4) "no event observed" → "no Git event was observed in the last 24 hours" (literal window, consistent with §6.2 tooltip). (5) Added "Press Esc to return here." (call-to-action). (6) Line count: 4 lines (within 3-5 budget). (7) Forbidden vocabulary check: trend ✗ hot ✗ stale ✗ risky ✗ ranking ✗ score ✗ summary ✗ share ✗ collaborate ✗ team (appears as "Not a team tool" — negation, not affirmation; charter §3 permits negating team in onboarding context) ✗ cloud ✗ sync ✗ — all zero occurrences of affirmative forbidden terms.
- **a11y:**
  - `role="region" aria-label="Fleet introduction"` (modal/dialog ではない)
  - dismiss button `aria-label="Dismiss Fleet introduction (won't show again)"`
  - keyboard accessible (Tab で dismiss button focus、Enter で dismiss)
- **Quiet 整合:** animation 0ms / opacity transition なし (instant show on mount)。
- **派生禁止 charter §1.1 整合チェック:** overlay 文言は "Fleet shows all repos at once" / "Click any row" / "Empty cells mean no event observed" のいずれも observed fact / wording clarification の範疇。severity / priority / hotness のような derived label ではない。✅ 抵触なし。

**Aya JTBD chain 救済 trace:**
- JTBD-Aya-1 (初見 5 秒以内 mental model 形成) ← overlay の "Fleet shows all repos at once. Click any row to dive into detail." が直接答え。
- JTBD-Aya-2 の `—` 部分 ← overlay の 2 行目 "Empty cells (—) mean 'no event observed', not 'broken'." と §6.2 hover tooltip の二段構え。

### 6.10 Vision Implementation Notes (Echo SHOULD 5 件 mention, v1.1 新節)

> Echo SHOULD 5 件は v1.1 proposal では **mention のみ** (詳細実装は Vision/Artisan が確定)。実装フェーズの参照用にここに集約。

| ID | 改善案 | 担当 |
|---|---|---|
| **S-A2** | Footer の "last successful SSE poll" timestamp を **TopBar 右側へ移動** (Reo の視線が Footer まで落ちない問題, F-A1 救済) | Vision audit + Artisan implementation |
| **S-B3** | Esc key handling stack 整理 (CommandPalette open 中の Esc, FullScreen mode の Esc, FileHistoryPrompt の Esc が競合 → priority stack 化, F-B3 救済) | Artisan implementation (既存 Esc handler の refactor) |
| **S-C3** | TopBar `[Fleet]` chip に **2-line tooltip** ("Fleet observes all configured repos at once" / "Single user, single machine, no team feature") (Aya 連想救済, F-C1) | Vision wording + Artisan tooltip primitive |
| **S-C4** | Empty state ( `RTGV_REPOS` 未設定 / 1 個のみ) で Aya 向け instruction 表示 ("Configure RTGV_REPOS env var to observe multiple repos at once") (F-C5 救済) | Vision empty state + Builder env-var doc link |
| **S-D2** | **Healthy silent row stripe** — Healthy silent (status:"ok" + lastObservedAt > 1h) で row 背景に subtle 1px stripe を追加 (SSE down 全行 dim と差別化, F-D2 救済) | Vision visual + Artisan CSS (新 token 0、既存 `--rs-border-subtle` 再利用) |

詳細仕様は Researcher Go 後の Artisan handoff で確定。SHOULD 5 件はすべて新 git command 不要、新 `--rs-*` token 不要、charter §2 抵触なしを v1.1 で確認済。

### 6.11 Last opened repo order memory — **Status: Implemented (2026-05-03, Magi D5 O3)**

> Magi D5 verdict (3-0 unanimous、Logos 80 / Pathos 72 / Sophia 88、Confidence 80/100) で O4 現状維持 primary + **O3 Last opened order memory 採択** → 本 v1.3 で実装完了。

**仕様 (v1.3 確定):**

- **localStorage key:** `refscope.fleet.last_opened.v1`
- **schema:** `Array<{ repoId: string, openedAt: string }>` (ISO timestamp)
  - `repoId` は RTGV_REPOS map key のみ (repo path は保存しない、path leak 防止)
  - `openedAt` は ISO 8601 UTC timestamp (例: `"2026-05-03T12:00:01.000Z"`)
  - 容量上限: **20 entries** (超過分は古い順に削除、FIFO)
  - **defensive localStorage pattern** (JSON.parse try-catch + schema validation + 破損時 default `[]`)
- **"Recently opened (N)" section:** Fleet view 末尾 (Excluded section の上) に additive 表示
  - default order (RTGV_REPOS 設定順) には **影響させない** (additive visual のみ)
  - ranking 表示なし (score / priority / hotness 等の派生 label 禁止 — charter §1.1 抵触回避)
  - N は実際の recently opened entries 数 (localStorage から読む)、0 時は section 非表示
  - section 見出し `"Recently opened (N)"` — literal な operation history 表示、派生禁止 charter §2 抵触チェック: N は observed operation history であり severity / ranking ではない ✅
- **`useLastOpenedRepos` hook 実装** (`apps/ui/src/app/hooks/useLastOpenedRepos.ts`、98 LOC):
  - `recordLastOpened(repoId: string): void` — repo 切替時 (detail mode 遷移時) に呼び出し
  - `lastOpenedRepos: Array<{ repoId: string, openedAt: string }>` — 表示用 state
  - defensive parse: localStorage 読み失敗時 default `[]`、schema validation (repoId string + openedAt ISO string の型チェック)
- **App.tsx integration** (`apps/ui/src/app/App.tsx` +20 LOC): detail mode 遷移時に `recordLastOpened(repoId)` を呼び出し、FleetSurface に `lastOpenedRepos` prop として渡す。
- **派生禁止 charter §1.1 整合チェック:** "Recently opened (N)" は user 自身の operation history (observed fact)、score / priority / CI status 等の derived label ではない ✅ 新 `--rs-*` CSS variable 0、新 npm package 0。

**実装ファイル:**
- `apps/ui/src/app/hooks/useLastOpenedRepos.ts` (新規、98 LOC)
- `apps/ui/src/app/components/refscope/FleetSurface.tsx` (+55 LOC、"Recently opened" section 追加)
- `apps/ui/src/app/App.tsx` (+20 LOC、hook + recordLastOpened integration)

**Magi D5 retreat 条件 (§10.15 参照):** R5-1〜R5-4 が trigger された場合、"Recently opened" section を削除し O4 (現状維持) に完全戻しする。

---

## 7. Charter v1 草案 (`docs/fleet-charter.md` inline)

> 以下は `docs/fleet-charter.md` として切る immutable charter の v1 草案。proposal 採択後に独立ファイルとして commit し、以降は **supersede のみ** (in-place 編集禁止)。

> **派生禁止 charter §1 抵触チェック (v1.1 追加 4 機能):**
> v1.1 で追加された 4 機能 (count badge `[Fleet · N]` / Onboarding hint overlay / `—` empty cell hover tooltip / Glyph re-design `!`/`×`) はすべて以下の理由で charter §1 (Observed-only) 抵触なし:
> - **count badge N**: Fleet SSE で受信した ref event 累計 = observed fact (severity / priority / hotness のような derived label ではない)
> - **Onboarding hint overlay**: wording clarification (機能の説明文、observed/derived の判断は含まない)
> - **`—` hover tooltip "no event in window (24h)"**: observed fact の literal 言い換え (window 値も literal で含める)
> - **Glyph re-design (`!` / `×`)**: shape encoding only、token 不変、observed fact の visual encoding (severity 等の derived label ではない)
>
> 上記 4 項目は Spark v1.1 で内部チェック済、Quill polish 段階で wording 確認 + Magi 再 deliberation 時に最終承認。

```markdown
# Fleet Charter v1

> Status: DRAFT (will be COMMITTED upon Spark proposal acceptance)
> Mutability: IMMUTABLE — supersede only. In-place edits forbidden.
> Owners: CODEOWNERS (multiple reviewers required for any supersede PR).
> Date: 2026-05-03

## §1 Inviolable principles

The Fleet observation surface exists to satisfy a single user voice (Reo, on-call SRE, 12-20 repos). It is governed by 5 inviolable principles. A PR that crosses any of these principles cannot be merged as-is; **the path forward is to supersede this charter via `fleet-charter-v2.md`** (see §6 amendment) — no negotiation or case-by-case waiver is possible under this version.

> **Quill v1.2 polish note:** "rejected without negotiation; the path forward is supersede via fleet-charter-v2.md" (v1.1 draft) → rephrased above to lead with the constructive path ("the path forward is…") while preserving the absolute strictness ("cannot be merged as-is", "no negotiation or case-by-case waiver"). Semantic is unchanged: the rejection fact + supersede pathway + no-negotiate strictness are all present. The 5 principles themselves (numbers, order, scope) are untouched.

1. **Observed-only.** The Fleet surface displays only facts directly readable from the local Git working tree(s). Derived analysis (CI status, deployment status, release readiness, dependency graphs, AI summaries, ranking, severity, scoring, prediction) is forbidden — at the schema layer, the code layer, and the UI vocabulary layer.

2. **Localhost only.** The Fleet feature, like the rest of Refscope, runs on the user's single machine. No outbound network calls. No SaaS-shaped UI elements. Default `HOST=127.0.0.1`. Public bind requires explicit `RTGV_BIND_PUBLIC=1` opt-in with a printed warning.

3. **Single user.** Fleet is not a team feature. There is no concept of "you", "owner", "team", "organization", "workspace", "member", "presence", "shared link", or "@mention". The user is the only consumer of their own Fleet surface.

4. **Calm by default.** Fleet inherits Refscope's Quiet mode and CVD-safe theme. Animations are 0ms in Quiet. Aria-live announcements are coalesced to ≤ 1/min (default) or ≤ 0.3/min (Quiet). The dot lights up once per observed event and stays static.

5. **Cost transparency.** The estimated cost (subscribed repo count, git calls per minute, snapshot interval, in-flight EventSource count) is displayed literally in the Footer. No adjectives ("light", "heavy", "fast"). The user must be able to predict the load on their own machine.

## §2 Forbidden tokens (Layer 2 grep gate)

The following tokens are forbidden in `apps/api/src/fleet*.js`, `apps/ui/src/app/components/refscope/Fleet*.tsx`, `apps/api/schemas/fleet-*.schema.json`, and `apps/ui/src/app/api.ts` (the `fleet` block within). The grep gate (`scripts/ci/forbid-derived-words.sh`, run by `make verify`) MUST fail the CI build on any occurrence.

```
ci_status, deployment_status, release_ready, dependency_graph,
ai_summary, llm_, openai, anthropic,
score_, ranking_, severity_,
share_link, public_url,
signin, signup, login_, avatar, jwt, oauth, session_token
```

There is no escape hatch. If a developer believes a forbidden token is justified, the only path is to supersede this charter (v2), which requires multiple reviewers and a documented rationale.

## §3 Forbidden UI vocabulary

The following terms are forbidden in user-facing strings (i18n catalogs, ARIA labels, button labels, tooltip text) within the Fleet surface code:

```
trend, hot, stale, risky, healthy (as a label, not a status enum),
attention, ready, recommended,
score, rank, priority, severity,
summary, analysis, insight, prediction
```

Forbidden UI elements (do not introduce these into the Fleet surface):

```
login, sign in, sign up, avatar, profile pic, "you" label,
Share, Copy link, Send to..., @mention,
Assign to, Owner, Watcher, Comment, Approve, Merge, Activity feed,
Team, Organization, Workspace, Members, Invite, Role,
presence, live cursors, typing indicator,
pricing, billing, Free trial, Demo CTA,
email alert, SMS, browser push, webhook outbound,
sync to cloud, backup
```

## §4 Enforcement (3 layers)

1. **Schema (Layer 1):** `apps/api/schemas/fleet-response.schema.json` and `fleet-event.schema.json` are validated by `apps/api/test/fleet-schema.test.js` with `additionalProperties: false`. Any new field requires a charter supersede.

2. **Code (Layer 2):** `scripts/ci/forbid-derived-words.sh`, run by `make verify`, greps the fleet code surface for the forbidden tokens of §2. Any match fails the CI build.

3. **Documentation (Layer 3):** This charter is immutable. Any change requires a new file (`docs/fleet-charter-v2.md`) that explicitly supersedes this one, signed by multiple CODEOWNERS reviewers.

## §5 Schema versioning

The Fleet response schema carries a `version` integer field (start: `1`). Breaking changes (field removal, type narrowing, enum reduction) require a new endpoint path (`/api/fleet/v2/...`) and a 6-month deprecation window of the v1 endpoint. Backward-compatible additions (new optional fields) are allowed in v1 without bump.

## §6 Amendment

This charter is immutable. To amend, create a new file (`docs/fleet-charter-vN.md`) that explicitly supersedes the current latest. The supersede PR MUST:

1. Cite the original Reo demand (Plea synthetic round 5) and explain how the amendment preserves the 5 inviolable principles.
2. Be approved by ≥ 2 CODEOWNERS reviewers.
3. Be referenced from a new ADR file (`docs/adr/ADR-Fleet-NNN.md`).
4. Update `scripts/ci/forbid-derived-words.sh` if §2 token list changes.
5. **Include a previous-charter diff summary table** (Magi D2 採択前提条件 #2). The supersede PR MUST contain a markdown table that summarizes the semantic differences from the previous charter (added principles, removed principles, modified wording with semantic shift, token list changes). This is mandatory to track supersede chain ≥ 5 (governance bureaucracy mitigation).

### §6.1 Non-substantive correction exception (Magi D2 採択前提条件 #1)

The following 4 categories of in-place edits are **permitted** without supersede, provided the PR title carries the `[non-substantive]` prefix. Each category is defined with both an **OK** example and a **Not OK** example to allow a 30-second eligibility check.

#### Category 1 — Typo correction
Fix a misspelling or missing punctuation that does not change the meaning of any constraint.

- **OK:** `"invioleable"` → `"inviolable"` (spelling fix, meaning unchanged)
- **OK:** `"Any PR that violates any of these will be rejected"` → `"Any PR that violates any of these will be rejected."` (add trailing period)
- **Not OK:** `"MUST"` → `"must"` — RFC 2119 keyword case change alters normative force; this is a semantic change requiring supersede.
- **Not OK:** `"5 inviolable principles"` → `"5 core principles"` — synonym substitution that weakens the normative label.

#### Category 2 — Dead link repair
Update a URL that has relocated, without changing the anchor text or the resource it refers to.

- **OK:** `https://example.com/old-path` → `https://example.com/new-path` where both resolve to the same document
- **Not OK:** Replacing a link to the original Reo demand report with a link to a newer unrelated report — the resource identity changes.

#### Category 3 — Formatting
Normalize whitespace, fix markdown table column alignment, or fix heading level indentation where the rendered output is semantically identical.

- **OK:** Align `|` characters in a markdown table so columns line up visually
- **Not OK:** Reordering table rows — row order may carry implicit priority meaning; any reorder is substantive.

#### Category 4 — Wording clarity
Rephrase a sentence for readability where **the set of obligations and prohibitions it imposes is provably identical** before and after.

Evaluation rule (apply in order):
1. Identify every normative token in the old text: `MUST`, `SHALL`, `MUST NOT`, `SHALL NOT`, `forbidden`, `inviolable`, `exception`, `escape hatch`, `permitted`, `required`.
2. Confirm every such token and its direct object appear in the new text with the same normative force.
3. Confirm no new obligation or permission is introduced.
4. If all 3 checks pass → wording clarity OK. If any check fails → substantive, requires supersede.

- **OK:** `"No outbound network calls."` → `"The feature makes no outbound network calls."` (same prohibition, fuller subject)
- **OK (synonym within same semantic field):** `"rephrasing for clarity"` → `"rewriting for readability"` — both describe wording improvement without normative weight
- **Not OK:** `"Derived analysis … is forbidden"` → `"Derived analysis … is discouraged"` — normative force drops from absolute prohibition to recommendation; supersede required.
- **Not OK:** Reordering clauses within a principle sentence — reorder changes the emphasis weight readers assign; treat as substantive.

#### `[non-substantive]` PR title and process

PRs claiming this exception MUST:
1. Use the exact prefix `[non-substantive]` (square brackets, lowercase) in the PR title.
2. State the category (1–4) and the rationale for eligibility in the PR description body.
3. Pass the **Layer 2 grep gate semantic-diff check** described below.

Any reviewer may challenge a `[non-substantive]` claim by changing the PR title to remove the prefix; the burden of re-establishing eligibility lies with the author.

#### Layer 2 grep gate — semantic-diff check (pseudo-spec, Builder implementation deferred)

The semantic-diff check is a CI step (`scripts/ci/semantic-diff-check.sh`, to be implemented by Builder) that runs on every `[non-substantive]` PR diff. It flags a diff as **substantive** (failing the check) if any of the following token patterns appear in the changed lines (`+` or `-` in the unified diff):

```
# Normative keyword changes (any RFC 2119 keyword appearing in a changed line)
\bMUST\b, \bSHALL\b, \bMUST NOT\b, \bSHALL NOT\b, \bSHOULD\b, \bMAY\b

# Scope/permission tokens
\bforbidden\b, \binviolable\b, \bexception\b, \bescape hatch\b, \bpermitted\b, \brequired\b

# Structural tokens (principle numbers, section numbers)
^[0-9]+\., ^#{1,4}\s
```

A match on a **changed line** (not a context line) flips the PR to substantive. False positives (e.g., a typo fix that happens to touch a line containing `MUST`) must be resolved by splitting the PR: fix the typo in one commit, and handle the line with the normative token in a separate supersede PR if the token itself is not changing.

> **Quill v1.2 polish note:** The v1.1 draft listed 4 categories without OK/Not-OK examples. This v1.2 polish adds per-category examples and the wording-clarity evaluation rule to enable 30-second eligibility judgment. The Layer 2 grep gate pseudo-spec is a draft for Builder implementation; Quill authored the token list and false-positive policy only. Semantic of the exception itself is unchanged: in-place edits remain permitted for these 4 categories, and normative force of the charter is preserved.

### §6.2 Governance health review (Magi D2 採択前提条件 #4)

This charter SHALL undergo a **6-month governance health review** following its initial commit. The review (named `Fleet Charter Health Review`) MUST evaluate:

1. Number of supersede attempts and their dispositions (accepted / rejected / withdrawn).
2. Number of `[non-substantive]` PRs and any flagged semantic-diff false positives.
3. Layer 2 grep gate hit count and any escape attempts.
4. Whether any of the 5 inviolable principles (§1) has experienced political pressure to weaken.

The review output is a single ADR (`docs/adr/ADR-Fleet-Health-Review-1.md`) that recommends either (i) charter retention as-is, (ii) supersede to v2 with specific principle adjustments, or (iii) escalation to Magi for strategic re-deliberation.

The current latest charter is the only one in force. Older charters are kept for archeological reference but have no governance authority.
```

> 上記 charter は本 RFC 採択後、`docs/fleet-charter.md` として独立 commit する。proposal は draft 形式で持ち、charter は immutable で切り出す。

---

## 8. RICE スコア (3 options)

> Plea synthetic confidence cap **50%** を全 option に適用 (`Never assign RICE Confidence > 50% without evidence`)。

### 8.1 Option A — 観測のみ最薄 (MVP)

| Factor | Value | 根拠 |
|---|---|---|
| Reach | 1.5 (qtr) | Reo (synthetic SRE) 1 名に reach するが、Plea round 5 demand は他 SRE には未検証。Refscope の active user は小チーム前提。 |
| Impact | 2 (medium) | Reo の AC #1, #2, #4, #5, #8, #10, #11, #12 を完全充足、#3, #6, #9 を部分充足 (8 完全 + 3 部分)。 |
| Confidence | 50% | synthetic、cap 適用。 |
| Effort | 0.5 (person-month) | server ~150, UI ~250, test ~100。 |

`(1.5 × 2 × 0.5) / 0.5 = 3.0` — Low (RICE ranking)。MVP 出口戦略向け。

### 8.2 Option B — Hybrid 推奨 (Atlas Decision) **【推奨】**

| Factor | Value | 根拠 |
|---|---|---|
| Reach | 1.5 (qtr) | A と同じ。Plea synthetic、Researcher による N=実 SRE 検証で上方修正余地あり。 |
| Impact | 3 (high) | Reo の AC 12 項目すべてを完全充足。Atlas + Vision の lock-in を 1:1 で実装。Refscope の魂 (calm + observed-only + localhost) を fleet 化する core feature。Impact=3 は ≤20% rule 内に収める (本 RFC は単一の core feature)。 |
| Confidence | 50% | synthetic、cap 適用。Researcher 検証後 70% まで上げる余地。 |
| Effort | 1.1 (person-month) | server ~300, UI ~370, test ~300。 |

`(1.5 × 3 × 0.5) / 1.1 ≈ 2.05` — Low → Medium 境界。但し Reach は synthetic cap、Researcher 検証後に Reach=2.5、Confidence=0.7 で `(2.5 × 3 × 0.7) / 1.1 ≈ 4.77` まで上方可能。

### 8.3 Option C — Hybrid + 早期 ARI 互換

| Factor | Value | 根拠 |
|---|---|---|
| Reach | 1.5 (qtr) | B と同じ + ARI persona (将来) reach は 0 でカウント (現時点で未検証)。 |
| Impact | 3 (high) | B と同じ + ARI 互換性 (将来価値、現時点では 0 加算)。 |
| Confidence | 40% | ARI roadmap が未確定のため B の 50% より下げる (synthetic + 未確定 forward-compat)。 |
| Effort | 1.2 (person-month) | B + 10% (schema description + stability test)。 |

`(1.5 × 3 × 0.4) / 1.2 = 1.5` — Low。ARI roadmap 確定後に再評価。

### 8.4 Option 比較サマリ

| Option | RICE | Recommended for |
|---|---|---|
| A | 3.0 | 急ぎ MVP |
| **B** | **2.05 (本命; Researcher 検証後 ~4.77)** | **本命** |
| C | 1.5 | ARI roadmap 確定時 |

---

## 9. Acceptance criteria trace matrix

> 12 AC × Atlas/Vision section × Option A/B/C カバレッジ (✓ = 完全充足、◐ = 部分充足、✗ = 未充足)。

| AC# | AC 概要 | Atlas § | Vision § | A | B | C |
|---|---|---|---|---|---|---|
| 1 | `RTGV_REPOS` 全 repo を 1 surface | 5.1, 5.6 | 6.1 | ✓ | ✓ | ✓ |
| 2 | 8 cells (id/HEAD/24h/1h ref/wt/last) 派生禁止 | 5.5 (mapping) | 6.1, 6.2 | ✓ | ✓ | ✓ |
| 3 | SSE 多重化 + dot pulse + Quiet 静止 + CVD symbol | 5.1, 5.8 | 6.4, 6.5 | ◐ (SSE 無、polling 由来 dot のみ) | ✓ | ✓ |
| 4 | click で detail 切替、mode は TopBar 常時 | 5.3 | 6.1 | ✓ | ✓ | ✓ |
| 5 | localhost only / SaaS UI 禁止 | 5.7 | 6.7 | ✓ | ✓ | ✓ |
| 6 | estimated cost を Footer literal 表示 | 5.2 | 6.8 | ◐ (SSE 数値部分なし) | ✓ | ✓ |
| 7 | CI / deploy / 依存 / AI 派生禁止 | 5.4 | 6.3 | ◐ (Layer 1+3 のみ、Layer 2 なし) | ✓ | ✓ |
| 8 | Quiet / CVD-safe theme 継承 | 5.8 | 6.4, 6.5 | ✓ | ✓ | ✓ |
| 9 | silence 4 状態区別 | 5.8 | (charter §1) | ◐ (2 状態のみ) | ✓ | ✓ |
| 10 | team feature ではない根拠を docs 明示 | (charter §1.3) | 6.7, 7.§1.3 | ✓ | ✓ | ✓ |
| 11 | per-session 除外 toggle (localStorage) | 5.6.5 | 6.6 | ✓ | ✓ | ✓ |
| 12 | 既存 lens 階層 (Live/Pulse/Stream) との関係 | 5.3 (ADR-Fleet-001) | 6.1 | ✓ | ✓ | ✓ |

**カバレッジ集計:**
- Option A: 8 完全 + 4 部分 = **8/12 完全 (66.7%)**, 12/12 何らかの応答 (100%)
- Option B: **12/12 完全 (100%)**
- Option C: **12/12 完全 (100%)** + ARI 互換性

---

## 10. Open Questions (Atlas + Vision + Spark 追加)

> 各質問は (origin) を明記。blocking / non-blocking を区別。

1. **(Vision §1) Browser history pollution 戦略**: `?fleet=1` query を `replaceState` で扱うか `pushState` で扱うか。Atlas routing ADR に委ねる。Detail から Fleet への戻りで history 1 件食うか否か。**non-blocking** (v2 routing で解決)。

2. **(Vision §2) Fleet mode 中の Quiet toggle 位置**: Quiet は現状 1 toggle (mode に依存しない)。Fleet 専用 Quiet を作るか、global Quiet をそのまま使うか。**Echo walkthrough 必要**。

3. **(Vision §3) CommandPalette jump コマンド数**: 12 repo × 2 mode = 24 コマンド。palette ranking ADR が必要かも。最近開いた detail / 最も dirty な repo / 最近 ref move した repo の優先表示は派生違反か? → 派生違反として却下、最近開いた順 (operation history) のみ allowed。**Spark 自決**: operation history のみ、派生 score 禁止。

4. **(Vision §4) `Excluded (3)` pill の hydration tick 一瞬出る問題**: SSR / CSR 不整合で hydration 時に `Excluded (0)` → `Excluded (3)` の flicker が出る可能性。**Artisan handoff 時に明記**。`useSyncExternalStore` または `useEffect` 後表示 (visibility:hidden 初期) で解決。

5. **(Vision §5) 24h window 固定 vs 設定可能**: Vision 推奨は **固定**、設定可能だと "派生 (期間判断)" を匂わせる。Atlas は `parseFleetWindowQuery` で `1h | 6h | 24h | 7d` enum を許容している。矛盾。**Spark 中立提案**: API は enum 許容、UI は 24h 固定 (デフォルト)、設定変更は env var `RTGV_FLEET_WINDOW=24h` のみ (UI から変更不可) で派生匂いを防ぐ。Magi 裁定推奨。

6. **(Atlas Decision §5.2 leverage)** **snapshot interval toggle (10s/30s/60s/off) を UI に出すか否か**: cost leverage として明示すれば Reo の cost 透明性は向上、しかし toggle 自体が "tuning" の派生匂いを生む。**Spark 中立提案**: UI に出す (Footer の数値が動的に reactive、Reo が自分で leverage 操作可能)、ただし default は 30s で sticky (env var override)。

7. **(Atlas Decision §5.7) `RTGV_BIND_PUBLIC=1` escape hatch を残すか**: charter §1.2 では opt-in escape として残すが、SaaS 化への slippery slope。**v1.1 update:** 本件は Magi 初回 deliberation で扱われず (D1=surface name, D2=charter immutability, D3=build か否か)、escape hatch 単独議題として **次回 Magi 招集 (`devil` recipe で escape hatch 単独審議)** を予定。Researcher Go 後に Magi 再 deliberation で扱う。**non-blocking** (charter v1 で残し、v2 で削除検討)。

8. **(Spark 追加) `RTGV_REPOS` N=32 cap が適切か**: Atlas Decision で hard-cap、escape なし。Reo の verbatim は 12-20 repo、32 は十分余裕。但し Platform engineer が monorepo split で 50-60 repo を持つケース (例: micro-services 大規模組織) では足りない。**Researcher 検証で実 SRE の上限 N を測る**。

9. **(Spark 追加) silence 4 状態の color/glyph が CVD で 4 state ΔL ≥ 2 OKLCH を保てるか**: Vision Success metric (CVD-safe で 4 row state grayscale 識別) が条件。`!` (amber) と `×` (red) と ◆ (bluish-green) と grey static の 4 state ΔL を実測検証 (v1.1 で glyph re-design 済 §6.4)。**Warden audit で確認、Vision audit と並行**。

10. **(v1.1 Echo COULD S-A3) LivePulse mode-aware**: 既存 LivePulse コンポーネント (`mock/src/app/components/refscope/TopBar.tsx` の live pulse 部) が Fleet/Detail mode を認識せず、Detail 中も Fleet と同じ pulse 表示。Detail 中は per-repo SSE のみを反映する mode-aware にすべきか。**non-blocking** (Vision/Artisan 実装 phase で確定)。

11. **(v1.1 Echo COULD S-B4) Focus 復元 visual indicator**: Detail → Fleet 戻り時、focus が listbox 内のどの row に戻るか visual hint を出すか。F-B4 Score 2 friction "focus 復元先未明文" の救済策。**non-blocking**。

12. **(v1.1 Echo COULD S-C5) Footer info icon**: Footer の estimated cost 表示 (`12 repos · git ~432/min · poll 30s + SSE multiplex`) の意味を Aya が理解できない。`(i)` info icon を hover で "What does this mean?" 解説 popover を出すか。**non-blocking**。

13. **(v1.1 Echo COULD S-D3) Quiet alive heartbeat announce** ⚠️ **Magi 再 deliberation 候補**: Lin (deuteranomaly + SR + Quiet) JTBD-Lin-2 救済策。Quiet mode 中、180s 沈黙が続いた時 intermittent (5min interval) で "Refscope alive · last event N minutes ago" を `aria-live="polite"` で announce するか。本件は Magi D3 verdict (遅延) Pathos dissent ("Reo demand への倫理的応答") と関連し、Researcher Go 後の **Magi 再 deliberation で扱う**。Quiet 原則 (silence as a feature) と SR-UX (alive feedback) のトレードオフが core question。

14. **(v1.3 Magi D4 verdict) UI で repo を「開く」動線強化** ✅ **D4 O2 採択 + 実装完了** ~~⛔ **[SUPERSEDED by v1.4 User authority override]**~~: Magi D4 verdict (3-0 unanimous、Logos 82 / Pathos 75 / Sophia 85、Confidence 81/100) — **O2 (CommandPalette jump 強化) + O3 (env var 維持) 採択 / O1 (完全実装) reject / O4 (session-only) reject**。FleetSurface row click → detail mode への動線は既存実装 (click any row) で充足。CommandPalette に `Detail: <repoId> を開く` × N コマンドを追加し last opened 順 sort を実装 (§6.1 / §6.11 参照)。

    > **v1.4 override 注記:** Magi D4 verdict の O1 reject は v1.4 で User authority override により charter v2 supersede pathway を経由して覆された。Real user feedback "CLI から複数リポジトリを設定するより WEB UI でリポジトリを追加できるほうがよい" + user 明示選択 "A) Persistent (file-based)" が trigger。Charter v2 (`docs/fleet-charter-v2.md`) + ADR-Fleet-002 (`docs/adr/ADR-Fleet-002.md`) にて経緯記録済。Magi D4 retreat 条件 R4-1/R4-2/R4-3 は v2 でも有効として保持。新 retreat 条件 R4-v2-sec-incident/R4-v2-corruption/R4-v2-misuse/R4-v2-no-adoption を Magi journal D4-v2 entry に記録。

    **Magi D4 採択前提条件:**
    1. CommandPalette §6.8 設計 full 実装 (`Detail: <repoId> を開く` × N + last opened sort) — **本 v1.3 で完了**
    2. Researcher セッションでの D4 O2 UX 効果検証 (R4-1 / R4-2 trigger 監視)

    **Retreat 条件 (D4):**
    | ID | Trigger 条件 | アクション |
    |---|---|---|
    | **R4-1** | CommandPalette jump が Fleet UX の cognitive load を増やすと実 SRE ≥3/5 名が報告 | CommandPalette の `Detail: <repoId> を開く` コマンドを削除し、O1 (FleetSurface row に明示的 "Open" button 追加) を Magi 再 deliberation に諮る |
    | **R4-2** | Researcher セッションで "CommandPalette を開かずに repo を直接 click する" が ≥4/5 名で自然な行動として観察される | CommandPalette command は維持しつつ、FleetSurface row に hover 時 "Open →" CTA を追加する小規模 UX 補完を Artisan に handoff |
    | **R4-3** | env var `RTGV_REPOS` 管理 UX (O3) の不満が ≥3/5 名から "UI で追加したい" として明示的に挙がる | Magi D4 再 deliberation を招集し O1 full 実装の RICE を再評価 |

15. **(v1.3 Magi D5 verdict) ブックマーク機能** ✅ **D5 O4 現状維持 + O3 Last opened 採択 + 実装完了**: Magi D5 verdict (3-0 unanimous、Logos 80 / Pathos 72 / Sophia 88、Confidence 80/100) — **O4 (現状維持 primary) + O3 (Last opened order memory) 採択 / O1 (完全 bookmark 実装) absolute reject / O2 (pin-to-top) reject**。Last opened order memory を "Recently opened (N)" section として FleetSurface に additive 表示、default order に影響させない (§6.11 参照)。

    **Magi D5 採択前提条件:**
    1. charter §1.1 抵触チェック: "Recently opened" は user operation history (observed fact)、派生 score 禁止 — **本 v1.3 確認済** (make verify fleet-gate PASS)
    2. Researcher セッションでの D5 O3 UX 効果検証 (R5-1〜R5-4 trigger 監視)

    **Retreat 条件 (D5):**
    | ID | Trigger 条件 | アクション |
    |---|---|---|
    | **R5-1** | "Recently opened" section が default order の可読性を下げると実 SRE ≥3/5 名が報告 | section を削除し O4 (現状維持) に完全戻し |
    | **R5-2** | localStorage `refscope.fleet.last_opened.v1` の read/write が 20 entries 超でパフォーマンス問題を発生 (First Paint +100ms 超) | 容量上限を 10 に削減、または section を opt-in (default off) に変更 |
    | **R5-3** | ユーザーから "Recently opened の order を固定したい" (= pin 要求 = O2 の復活) が ≥3 名から明示的に提起 | Magi D5 再 deliberation を招集し O2 pin-to-top の RICE を再評価 (O2 は D5 で reject されたが demand 実証があれば再審)  |
    | **R5-4** | "Recently opened" と "Excluded" section の視覚的重複で Aya (新卒) が ≥66% の割合で "何が違うの?" と混乱 | section 見出しに tooltip "These repos were recently opened in detail view" を追加し混乱を軽減、それでも継続なら Artisan design audit |

---

## 11. Assumptions

1. 本提案は `synthetic: true` (Plea round 5) の仮説であり、実 SRE 検証 (Researcher による定性 + N サイズ実測) の前にロードマップ固定しない。
2. Reo は 12-20 repo を on-call で巡回する想定。N=12 を本 RFC の estimated cost basis、N=32 を hard-cap に置く。
3. `RTGV_REPOS` 全 repo は `RTGV_REPOS=svc1=/path1,svc2=/path2,...` の env var で渡す既存パターンに準拠する (server.js / config.js)。
4. localhost only 原則は Refscope の魂と直結しており、SaaS 化 / team feature 化への slippery slope は charter §1 で固く拒絶する。Refscope の魂を fleet 化する以外の派生は禁止。
5. browser EventSource は HTTP/1.1 上で 6 conn/origin の制約があり、HTTP/2 では緩和される。本 RFC は最悪ケース (HTTP/1.1) を前提に Hybrid (1 SSE + polling) を採択する。HTTP/2 環境でも同戦略は有効。
6. Quiet mode と CVD-safe theme は Refscope に既存。新 token は導入せず既存を再利用する。Vision Success metric の "新 `--rs-*` token 導入数 0" を遵守。
7. `gitRunner` の allowlist は `cat-file, diff, for-each-ref, log, merge-base, rev-list, rev-parse, show` を前提。Atlas Decision の literal mapping (§5.5) はこの範囲で完結する。`ls-files` 利用可否は実装前に lens で確認 (現行 untracked rendering 機能の依存関係から再確認)。
8. ARI persona (Round 5 別 persona、AI agent positioning) は本 RFC では定義しない。Plea round 5 の synthetic demand のうち Reo のみを本 RFC の対象とする。Option C (forward-compat) は ARI roadmap が将来確定した場合の拡張準備。

---

## 12. Risks

### 12.1 Layer 1 schema を後から緩める政治圧力

- **症状:** "便利な derived field 1 つだけ" "ユーザーから要望が来ているから ci_status だけ追加" を主張する PR が出る。
- **対策:**
  - Charter v1 §6 で immutable + supersede only を明文化
  - PR template に "this PR adds a new field — does it require charter supersede? [ ] yes [ ] no" のチェックボックス
  - CODEOWNERS で fleet 関連ファイルに 2 reviewer 必須
- **残存リスク:** charter supersede の hurdle を下げる政治圧力が長期で蓄積する可能性。Lore agent によるメタパターン記録を推奨。

### 12.2 team feature と誤解された UI 要素が PR で混入する可能性

- **症状:** "他のメンバーと共有できると便利" "@mention 機能を" "presence indicator を" の類が出る。
- **対策:**
  - Layer 2 grep gate で `share_link, login_, avatar, oauth, ...` を block
  - Charter §3 Forbidden UI elements list を CODEOWNERS review で機械的に reject
- **残存リスク:** grep gate を回避する命名 (例: `notification_user` → `notification_recipient`) の sneaking。Magi 定期 audit を推奨。

### 12.3 Aya (Round 5 新卒) が Fleet mode を初見で confuse する risk

- **症状:** Fleet と Detail の mode toggle が新卒には mental model が形成されず、Fleet mode で開いて detail 切替が分からないまま挫折。
- **対策:**
  - **Echo walkthrough 必要** (Aya persona で初見 confusion levels を測る)
  - 初回 mount 時に subtle overlay "Fleet shows all repos at once. Click any row to dive into detail." を 5 秒表示 (dismissable, localStorage で 1 度のみ)
- **残存リスク:** overlay 自体が Quiet 原則と競合する可能性。Vision audit が必要。

### 12.4 24h window 固定 vs 設定可能の論争

- **症状:** "1h でも見たい" "7d でも見たい" の要望が出る。Atlas (`parseFleetWindowQuery` enum) と Vision (固定推奨) が矛盾。
- **対策:** §10 Open question #5 の Spark 中立提案 — API enum 許容、UI 固定、env var override のみ
- **残存リスク:** env var override が知られず "UI で変えられないから不便" の不満が積み上がる。Documentation で env var を強調。

### 12.5 32 repo cap が緩すぎる/きつすぎる

- **症状:** 大規模 micro-services 組織 (50+ repo) で起動 fast-fail、または小規模 (5 repo) で 32 cap が overhead 表示。
- **対策:**
  - Researcher で実 SRE の N 分布を測る
  - cap 自体は env var override 可能に (例: `RTGV_FLEET_MAX=64`、charter §1.5 で警告)
  - cost transparency が "literal な数値" であれば、N=64 でも user 自身が判断可能
- **残存リスク:** N=64 で cost が `gitCallsPerMin ≒ 2370/min` になり Reo の machine が重い。snapshot interval toggle で leverage。

### 12.6 SSE multiplex の race / 再接続 / heartbeat の test surface 増大

- **症状:** Option B/C で SSE 多重化の test が複雑化、flake test が増える。
- **対策:**
  - `node:test` で fake EventSource + clock injection を使う既存パターン (Refscope の `subscribeRepoEvents` test) を踏襲
  - heartbeat timeout の境界値 (25s + 5s grace) を明示的に test
- **残存リスク:** real network jitter での flake が CI で再現できない。Researcher で実 SRE 環境の network condition を測る。

---

## 13. Cross-Persona Friction

| Persona | Fleet view との関係 | 緊張点 | 提案の扱い |
|---|---|---|---|
| Reo (本 RFC 主対象) | 主要対象 | live ping 集合を要求、派生は禁止 | Option B で完全応答 |
| Hana (週次テクニカルライター) | 関心薄 | Period summary view (`spark-period-summary-proposal.md`) と機能的に重ならない (fleet は repo 全体集計、period summary は単一 repo の commit 集計) | 並置可、相互妨害なし |
| Tomo (file history) | 関心薄 | file-level history (`spark-tomo-file-history-proposal.md`) は detail mode 内、fleet とは別レイヤー | 並置可、Fleet → Detail → file history のフロー成立 |
| Riku (search modes) | 関心薄 | search mode は detail mode 内、fleet とは別レイヤー | 並置可 |
| Aya (Round 5 新卒) | 初見 confusion risk | mode toggle の mental model が未形成 | §12.3 Risk 対策で Echo walkthrough 必須 |
| ARI (Round 5 AI agent persona) | Option C の forward-compat 対象 | 本 RFC では未定義 | Option C で schema stability のみコミット |

### 13.1 Non-consumption framing

- 競合は「他の Git 観測 tool」ではなく、Reo が現在実際にやっている代替行動 (= "non-consumption"):
  - 7 タブ並びを目視で巡回 (各タブの "live か" は分からない、結局全 click)
  - GitHub Web UI の Activity tab (organization-level、repo を絞れない、SaaS、external)
  - Slack の repo bot 通知 (push のたびに channel に流れる、Quiet にできない、削除権限不明瞭)
- 上記 3 つはすべて「1 surface で fleet 観測できない」「localhost で完結しない」「Quiet にできない」「派生 (CI / deploy / 通知優先度) が混入する」の特徴を持つ。
- Fleet observation surface は上記の "コピペ + 口頭聞き取り + Slack noise" を Refscope 内で完結させる。

---

## 14. Validation Strategy

> **v1.1 update:** Echo walkthrough は **完了済** (16 friction / 14 改善案 / 9 KPI estimate のうち 3 FAIL likely / 3 conditional PASS / 3 PASS) — §3.2 KPIs / §3.4 JTBD / §6.9 Onboarding に反映済。Researcher は v1 時点では未実施で **Magi D3 verdict (遅延 / 8w hard-cap)** で正面化 (§15.1 参照)。

1. **MVP (Option B) リリース後、ローカル KPI を 4 週間収集** (K1–K9)
   - 計測は localStorage に保存、Refscope の "no external services" 原則を破らない
   - debug toggle で同一画面に raw KPI snapshot を出せるようにし、ユーザー自身が確認可能とする (透明性)
2. **Researcher による軽量定性検証** (Magi D3 採択前提条件 #1, **8 週間以内に走らせる hard-cap**): Reo 相当の SRE 5 名 (≥3 年 on-call 経験、12-20 repo 環境) に on-call task を与え、(i) 現状 (タブ 7 枚 + GitHub Activity tab)、(ii) Fleet mode 利用の 2 条件で "今動いた repo を識別" 中央値時間を比較
   - セッション 30-45 分、各 SRE につき 12-20 repo の実環境
   - 質問項目: "silence の意味 (Refscope 落ちか repo 静か) を区別できたか?", "estimated cost の数値を理解したか?", "派生情報 (CI / 要約) が無くて困ったか?", "Fleet という単語から CI/deploy 連動を期待したか? (Magi D1 retreat R2 trigger)", "Fleet view を月 ≥3 回 / 週 ≥1 回 利用したいか? (Magi D3 Go criteria)"
3. **Echo walkthrough** ✅ **v1.1 完了済**: incident 中の fleet → detail → fleet 戻りの cognitive walkthrough、Aya/Reo/Lin persona 16 friction (Score 5×3 / Score 4×8 / Score 3×4 / Score 2×1) 抽出、14 改善案 (MUST 5 / SHOULD 5 / COULD 4) 提示、9 KPI estimate (3 PASS / 3 conditional / 3 FAIL likely) 判定。MUST 6 件は v1.1 §5.1 / §5.8 / §6.1 / §6.2 / §6.4 / §6.9 に反映済、SHOULD 5 件は §6.10 mention、COULD 4 件は §10 Open Questions 拡張 (#10-#13)。
4. **Warden audit**: WCAG 2.2 AA contrast、4 silence state ΔL ≥ 2 OKLCH、Quiet mode 0 active animation
5. **Fail Condition 監視 (kill criteria 再掲)**:
   - K1 (識別中央値時間) > 5 秒 → fleet 凍結し A への退避を検討
   - K3 (silence 区別精度) < 80% → silence 4 状態 UI を再設計、3 名で同症状なら opt-out 化
   - 派生禁止語彙 1 token でも fleet code 出現 → CI fail (escape hatch なし)
6. **Round 6 demand collection**: Plea を再起動し、Fleet mode 公開後の新たな死角 (例: "fleet で push 通知を…" は派生違反、"fleet で repo 順序を customize…" は per-row exclude で代替) を探る
7. **Magi D4/D5 retreat 条件 → Researcher 質問 list integration (v1.3)**: Researcher セッションで §10.14 の retreat 条件 R4-1 ("CommandPalette jump が Fleet UX の cognitive load を増やす" — ≥3/5 名が混乱) と §10.15 の retreat 条件 R5-1 ("Recently opened section が default order の可読性を下げる" — ≥3/5 名が混乱) を質問項目に追加し、D4 O2 / D5 O3 の実装効果を実 SRE 5 名で検証することを推奨。
8. **Magi D4-v2 retreat trigger validation (v1.4)**: Researcher セッション (8w hard-cap 経過後) の質問項目に Magi D4-v2 retreat trigger validation (path traversal incident / repos.json corruption / team-misuse / no-adoption — Magi journal D4-v2 entry の R4-v2-sec-incident/R4-v2-corruption/R4-v2-misuse/R4-v2-no-adoption 参照) を integration し、UI add (persistent) 実装の安全性・採用状況を実 SRE 5 名で検証することを推奨。

### 14.1 セキュリティ / プライバシ追加レビュー項目

- `parseHost(value)` の `0.0.0.0`/`::`/public IP reject が起動時 fast-fail することを `tests/integration/host-bind.test.js` で確認
- `parseFleetIncludeQuery` / `parseFleetWindowQuery` の入力検証境界
- fleet endpoint per-repo timeout の Promise.allSettled が partial response として正しく動作することを test
- Excluded localStorage に repo path を保存していない (id のみ) ことを test
- SSE event payload に sensitive な path / author email / commit message が含まれないことを Schema 検証
- charter §2 forbidden tokens が fleet code に出現しないことを `make verify` で CI gate

---

## 15. Recommendation

### 15.1 推奨: **Option B (Hybrid, Atlas Decision) — ただし Researcher Go gate 必須 (Magi D3 verdict)**

> ⚠️ **Magi D3 verdict (v1.1, 2-1 majority, Confidence 65/100):** **遅延 / Option E "Wait for Researcher with explicit kill criteria"** が採択された。Logos 65 + Sophia 73 が遅延支持、Pathos 68 が "即着手 (Option B)" を支持する dissent。Pathos dissent verbatim:
>
> > "Reo demand への倫理的応答と calm 拡張の信念から、Option B 即着手を推す。Researcher を待つ間に Reo の苛立ちは累積し、Refscope は 'calm な fleet 観測' を提供する歴史的機会を失う。"
>
> v1.1 推奨は Option B (Hybrid) を **technical recommendation として維持**しつつ、**Researcher Go gate を Builder/Artisan 着手の前提条件として正面化**する。Researcher Go 後に Magi 再 deliberation で最終 Go/No-Go 判定。

#### 選定理由 (Researcher Go 時)

- **Reo の AC 12 項目を完全充足** (8 完全 + 4 部分 → 12 完全に upgrade)
- **Atlas Decision (Hybrid C) を 1:1 で実装** — review コスト最小、Atlas との re-arbitration 不要
- **Vision の Mode toggle / 8 cells / Quiet+CVD 継承を完全に乗せる** — Vision audit pass の見込み高
- **派生禁止 3 層防御を全部敷ける** — charter v1 を切るに足る code surface
- **estimated cost を完全な数値で literal 表示** — Reo の cost transparency 要求に正面回答
- **silence 4 状態完全区別** — Reo の "silence の原因" 要求に正面回答
- **v1.1 で Echo MUST 6 件反映済** — Aya/Reo/Lin の cognitive friction を予防的に救済 (S-A1, S-B1, S-B2, S-C1, S-C2, S-D1)

#### Researcher Go criteria (Magi D3 採択前提条件 #2)

**Researcher を最大 8 週間以内に走らせる** (期限付き hard-cap)、対象: 実 SRE 5 名 (≥3 年 on-call 経験、12-20 repo 環境)。

- **Go (即着手 OK):** 5 名中 **≥3 名** が "Fleet view を月 ≥3 回 / 週 ≥1 回 利用したい" + 識別中央値時間 **≥30% 改善見込み** + silence 区別精度要求が proposal §3.2 K3 (≥80%) と integratable
- **Conditional Go (Option A subset MVP):** 5 名中 3 名が "Fleet view を使いたいが SSE は不要" → **Option A scope down**、Option B SSE 多重化を v2 に延期
- **No-Go ("Don't build" 確定):** 5 名中 **≤2 名のみ** Fleet 利用希望 + 派生情報必要 ≥3 名 + 識別改善 < 10% → §15.3 "Don't build" option 採択 (kill criteria 統合)

#### Researcher 中の preparation parallel 作業 (Magi D3 採択前提条件 #5)

- ✅ **Echo (Aya walkthrough): 完了済** (v1.1 で MUST 6 件反映)
- 🟡 **Quill (charter wording polish)**: §7 charter §1 建設的言い換え + §6.1 non-substantive exception の wording 精査 — **parallel 進行可**
- ⛔ **Builder + Artisan: 着手しない** — charter v1 commit 前の implementation は Layer 3 enforcement 違反 (charter が immutable に切られていない状態で fleet code 書くと、charter v1 が後から書かれる時に conflict のリスク)

#### Impact-Effort 分類: **Big Bet** (高インパクト / 中-大実装)

- Impact: Refscope の魂を fleet 化する core feature、SaaS 化への slippery slope を charter で永久拒絶する meta-win も含む
- Effort: server ~300, UI ~370, test ~300, total ~970 LOC, 1.0-1.2 person-month
- **Researcher gate を加算した実時間:** 8w (Researcher hard-cap) + 1.0-1.2 person-month implementation = total ~3 ヶ月の弾道

### 15.2 段階的ロードマップ

| Stage | スコープ | 関連 Option |
|---|---|---|
| MVP | Option A の subset (snapshot endpoint + 8 cells + Quiet/CVD 継承 + Layer 1+3 enforcement) | A |
| v1 | Option B 完全版 (SSE 多重化 + heartbeat + silence 4 状態 + Layer 2 enforcement) | B (推奨) |
| v1.5 | snapshot interval toggle、`RTGV_FLEET_MAX` env var、ARI/Researcher 検証反映 | B + tweaks |
| v2 (条件付) | Option C (schema description + stability test、MCP server forward-compat) | C (ARI roadmap 確定時) |

### 15.4 v1.4 実装完了: UI repo add (persistent) — User authority override + Charter v2 supersede 経緯

> **2026-05-03 delivery:** Real user feedback + user 明示選択により Magi D4 verdict (O1 reject) を user authority で override し、charter v2 supersede pathway (Magi D2 §6 規定) を経由して UI repo add (persistent) を完全実装した。

**実装概要:**
- **Charter v2 supersede** (`docs/fleet-charter-v2.md`): §1 P2 server-side persistence 許可 (repos.json のみ) + §1 P3 UI add list を source of truth に追加 + §3 "Add repository" forbidden list から除外 (team-feature vocab 完全保持)。ADR-Fleet-002 に経緯記録。
- **Backend**: `reposStore.js` (atomic write + chmod 0o600 + .bak fallback) + `config.js` (env+UI list merge, env 優先) + `validation.js` (parsePostBodyJson 4KB cap + validateRepoAddInput abs path + .git check) + `http.js` (POST/DELETE/CSRF origin guard) — gitRunner allowlist 完全不変。
- **Frontend**: `AddRepoDialog.tsx` (305 LOC) + TopBar Add button (Fleet-only) + FleetSurface origin badge (env/ui) + Remove + AlertDialog confirm + api.ts postRepo/deleteRepo + useLastOpenedRepos evictRepo 連動。
- **Tests**: 44 新規 (repos-mutation 25 + reposStore 13 + config 6)、合計 252/252 PASS。make verify fleet-gate PASS。

**Magi D4 retreat 条件 v2 追加 (既存 R4-1/R4-2/R4-3 + 新追加):** R4-v2-sec-incident (path traversal 等 security incident 1 件 → UI add reject) / R4-v2-corruption (repos.json 破損 3 ヶ月 5 件超 → SQLite 移行 or session-only) / R4-v2-misuse (team 共有要望 ≥3 件 → charter §3 強化) / R4-v2-no-adoption (Researcher 後 ≤1 名利用 → deprecate)。詳細は Magi journal D4-v2 entry 参照。

### 15.3 "Don't build" option (Refscope house pattern, Magi D3 No-Go criteria 統合)

Refscope の house pattern として、3 options の最後に "Don't build" の選択肢を置く:

- **Don't build (現状維持):** Reo は引き続きタブ 7 枚 + GitHub Activity tab で巡回。Refscope は 1 instance = 1 repo のままで、fleet 化の魂を持たない。
  - **Pros:**
    - 現状の Refscope 魂 (single-repo focus) を 100% 保つ
    - 実装コスト 0
    - SaaS 化への slippery slope が物理的に存在しない (charter も不要)
  - **Cons:**
    - Reo (synthetic SRE) の core demand 完全棄却
    - GitHub Activity tab に user を取られ続ける
    - Refscope の "calm + observed-only" 価値命題が "single-repo only でしか成立しない" 制約に縛られる
  - **Spark の判断 (v1.1 update):** "Don't build" は Refscope の魂を保つ最も簡単な方法だが、Reo の demand verbatim ("Refscope に fleet view を 1 surface 入れてくれたら、私はそこをホーム画面にします") は **fleet 化が魂の延長として可能か** を問うている。Atlas + Vision の handoff が "可能、かつ 3 層防御で派生 slippery slope を防げる" と判定し、Echo walkthrough が "16 friction 抽出 → MUST 6 件で救済可" と判定している。本 RFC は **technical recommendation として Option B を維持**しつつ、最終 Go 判定は Magi D3 verdict (遅延 / Researcher Go gate) に従う。
  - **採択する条件 (Magi D3 No-Go criteria 統合):**
    - Researcher が実 SRE 5 名で N=12-20 repo の頻度を実測し、**5 名中 ≤2 名のみ Fleet 利用希望** + **派生情報必要 ≥3 名** + **識別改善 < 10%** を確認した場合 → "Don't build" 確定。
    - または Researcher 中に Magi D1 retreat R1/R2 (`Atrium` rename trigger) と "Don't build" trigger が複合発火 → Refscope の魂保護を優先し "Don't build"。
    - 上記 No-Go 確定後は §3.3 fail condition と統合し、Refscope は single-repo 構成のまま v0.5 maintenance に集中する。

---

## 16. Handoff

### Suggested next agents (v1.1 再構成: Echo 完了済を除外、Researcher Go gate を正面化)

> **v1.1 順序:** **[Researcher (8w hard-cap) ‖ Quill] → Magi 再 deliberation (Researcher 結果次第) → Builder + Artisan (Researcher Go 時のみ)**
>
> v1 順序 [Researcher → Echo → Magi → Quill → Builder] から、(1) Echo 完了済のため除外、(2) Researcher と Quill を parallel 化 (Magi D3 採択前提条件 #5)、(3) Magi を最終 deliberation 段階に移動、(4) Builder + Artisan を Researcher Go 後の conditional に変更。

#### Phase 1 (parallel, 0-8 weeks): Researcher ‖ Quill

1. **Researcher** (Reo 実在 SRE 検証、N サイズの実測) — **8 週間以内 hard-cap (Magi D3 採択前提条件 #1)**
   - 対象: 実 SRE 5 名 (≥3 年 on-call 経験、12-20 repo 環境)
   - Go criteria: 5 名中 ≥3 名が "Fleet view を月 ≥3 回 / 週 ≥1 回 利用したい" + 識別中央値時間 ≥30% 改善見込み + silence 区別精度要求が K3 (≥80%) と integratable
   - No-Go criteria: 5 名中 ≤2 名のみ Fleet 利用希望 + 派生情報必要 ≥3 名 + 識別改善 < 10% → §15.3 "Don't build" 確定
   - Conditional Go: 5 名中 3 名が "SSE 不要" → Option A scope down
   - 副質問項目: Magi D1 retreat R2 trigger (Fleet → CI/deploy 期待), §10.5 (24h window), §10.8 (N=32 cap), §10.9 (CVD ΔL)
   - **blocking**: Builder + Artisan 着手 (Magi D3 採択前提条件 #5)

2. **Quill** (charter v1 wording の polish) — **Researcher と parallel**
   - 理由: charter は immutable で supersede only のため、初版 wording の精度が長期コスト
   - 重点項目: §7 charter §1 "rejected without negotiation; the path forward is supersede" の建設的言い換え (Magi D2 採択前提条件 #3) + §6.1 non-substantive correction exception の境界 wording (semantic 不変の判定基準) + §6.9 hint overlay 文言 polish
   - non-blocking (Researcher と並行進行)
   - **着手済前提**: Echo は完了 (v1.1 §3.4 / §6.9 / §6.4 等に反映)、Vision/Atlas は handoff 完了

#### Phase 2 (Researcher 完了後): Magi 再 deliberation

3. **Magi (再 deliberation)** — Researcher 結果を受けた最終 Go/No-Go 判定
   - blocking 項目:
     - **D3 再判定**: Researcher Go criteria を満たすか? Conditional Go なら Option A subset MVP に scope down
     - **D1 retreat 判定**: Researcher で "Fleet → CI/deploy 期待" が ≥3 名の場合 R2 trigger → name retain + microcopy 強化
     - **§10.13 (S-D3 Quiet alive heartbeat) 単独 deliberation**: Pathos D3 dissent と関連、Quiet 原則 vs SR-UX トレードオフ
     - **§10.7 (`RTGV_BIND_PUBLIC` escape hatch)** 単独審議 (`devil` recipe)
   - charter v1 を `docs/fleet-charter.md` として独立 commit する前の最終 review

#### Phase 3 (Magi Go 後のみ): Builder + Artisan

4. **Builder + Artisan** (実装、Option B 採択 + Magi 再 deliberation Go 時のみ)
   - **着手前提条件**: Researcher Go + Magi 再 deliberation Go + charter v1 commit 完了 (Layer 3 enforcement) — この 3 条件未達なら着手禁止
   - Builder: `apps/api/src/fleetService.js` 新規、`validation.js` 拡張、`apps/api/schemas/fleet-*.schema.json` 新規、`scripts/ci/forbid-derived-words.sh` 新規
   - Artisan: `apps/ui/src/app/components/refscope/FleetSurface.tsx` 新規 (count badge `[Fleet · N]` 仕様 §6.1 含む、Onboarding hint overlay §6.9 含む、`—` hover tooltip §6.2 含む、glyph re-design `!`/`×` §6.4 含む)、`api.ts` 拡張、`App.tsx` mode state 追加 + Detail mode 中の Fleet SSE 維持 §5.1.1、TopBar segmented control + count badge、aria-live coalesce、Quiet/CVD 継承
   - SHOULD 5 件 (§6.10) は Researcher Go 後の Vision audit + Artisan implementation で確定
   - **v1.3 完了 (2026-05-03, Magi D4 O2 + D5 O3 — Artisan 実装):**
     - ✅ **D4 O2 (CommandPalette jump)**: `CommandPalette.tsx` に `Detail: <repoId> を開く` × N コマンド + last opened sort 追加 (+55 LOC)
     - ✅ **D5 O3 (Last opened order memory)**: `useLastOpenedRepos.ts` 新規 (98 LOC)、`FleetSurface.tsx` "Recently opened (N)" section 追加 (+55 LOC)、`App.tsx` hook integration (+20 LOC)
     - charter §2/§3 抵触ゼロ確認 (`make verify` fleet-gate PASS)

### Artifacts produced (v1.1)

- `docs/spark-reo-fleet-observation-proposal.md` (this file, v1.0 → v1.1 in-place update)
- `.agents/magi.md` (Magi journal 新規作成、3 verdict entry を含む)
- `.agents/PROJECT.md` (新 entry: Echo + Magi via Nexus による v1.1 update)

### Artifacts produced (v1.3)

- `docs/spark-reo-fleet-observation-proposal.md` (this file, v1.2 → v1.3 in-place update)
- `.agents/magi.md` (Magi D4/D5 entry append)
- `.agents/PROJECT.md` (新 entry: Spark via Nexus による v1.3 update)

### Risks (top 3)

1. **派生 slippery slope** (charter v1 を後から緩める政治圧力) — §12.1
2. **team feature 誤混入** (presence / share / @mention の sneaking) — §12.2
3. **Aya 初見 confusion** (mode toggle の mental model 未形成) — §12.3

---

## 17. LLM Orchestration Prompt (paste-ready)

> ⚠️ **v1.1 update / 重要 fire condition:** 以下の paste-ready prompt は **Researcher Go 判定 + Magi 再 deliberation Go 後にのみ発火する**。Researcher Go 前に Builder/Artisan に prompt を渡すと、Magi D3 採択前提条件 #5 (charter v1 commit 前の implementation は Layer 3 enforcement 違反) と Magi D2 (charter immutable) の双方に違反する。下記 prompt の最終 paste 操作は Magi 再 deliberation の verdict 出力後に行うこと。

> 以下は Builder + Artisan に渡す paste-ready prompt。既存 Spark proposal の format に整合。

```text
You are the Refscope feature implementation team (Builder for API, Artisan for UI).
Implement the Fleet observation surface, Option B (Hybrid), as specified in
docs/spark-reo-fleet-observation-proposal.md.

CONTEXT
- Refscope is a localhost-only Git observation app (apps/api ESM JS + apps/ui Vite/React).
- The Fleet surface satisfies Reo (synthetic on-call SRE, 12-20 repos).
- Atlas + Vision handoffs are locked. Do not rearbitrate.
- Charter v1 is in proposal §7 — commit it as docs/fleet-charter.md as the FIRST step.

INVIOLABLE
1. gitRunner allowlist UNCHANGED. No new git commands.
2. Localhost only. parseHost rejects 0.0.0.0/::/public IPs at startup
   (escape hatch: RTGV_BIND_PUBLIC=1 with printed warning).
3. Forbidden tokens (charter §2) MUST NOT appear in fleet code.
   scripts/ci/forbid-derived-words.sh enforces this in `make verify`.
4. Forbidden UI elements (charter §3) MUST NOT appear in i18n strings or components.
5. JSON Schema (apps/api/schemas/fleet-response.schema.json,
   apps/api/schemas/fleet-event.schema.json) uses additionalProperties:false.
6. No new --rs-* design tokens. Reuse existing Quiet/CVD theme.
7. aria-live: ONE listbox-level region, 60s coalesce default, 180s in Quiet,
   aria-live="off" in Quiet.
8. dot animation 0ms in Quiet. No halo. Static "ghost" of past lights.
9. Empty cells render as `—` (em-dash), never `0`.
10. Footer estimated cost displayed literally (numbers only, no adjectives).

API CONTRACT
- GET /api/fleet/snapshot?include=...&window=24h
  → JSON per proposal §4.2.3. additionalProperties:false.
- GET /api/fleet/events?include=...
  → SSE: connected, ref_created, ref_updated, ref_deleted, heartbeat, error
  → 25s heartbeat + 5s grace → 30s timeout
- Promise.allSettled per repo. status enum: ok|timeout|git_error|missing|unauthorized.
- RTGV_REPOS N_max = 32 hard-cap (fast-fail at startup).
- realPath duplicate IDs rejected.

UI SCOPE
- TopBar: segmented control [Fleet] [Detail · svc1].
- TopBar (Detail mode 時 v1.1): count badge [Fleet · N] — N = Detail mode 中に Fleet SSE で受信した ref event 数, Excluded pill と同 token 再利用 (§6.1).
- Detail mode 中も Fleet SSE 接続を維持 (browser 6-conn の 2/6 占有, §5.1.1).
- Fleet listbox: 28px row, mono 12px, 8 cells per proposal §6.1.
- Glyph CVD-safe per proposal §6.4 (v1.1 re-design: ! for timeout (square base), × for config error (cross), 3 shape base 分離).
- Empty cell `—` に hover/focus tooltip "no event in window (24h)" (v1.1 §6.2).
- 初回 mount 時に Onboarding hint overlay (v1.1 §6.9, key: refscope.fleet.intro.dismissed.v1, persistent until dismiss).
- SSE down (§5.8.B): listbox 全体 dim (opacity 0.45) + center message overlay (v1.1 S-A1, Vision §5.8.B "全行 gray-out" を上書き).
- Excluded section: separator + opacity 0.35 italic + ↻ restore + [Restore all].
- localStorage keys:
  - refscope.fleet.excluded.v1 (repo ids only, never paths)
  - refscope.fleet.intro.dismissed.v1 (boolean, v1.1)
- TopBar tooltip: "Fleet = your repos, single user, single machine" (Magi D1 mandatory)
- CommandPalette "Fleet モードに切替" の i18n に "(複数 repo 観測 mode)" tooltip 併記 (Magi D1 採択前提条件 #3).

ENFORCEMENT
- Layer 1: apps/api/test/fleet-schema.test.js validates additionalProperties:false.
- Layer 2: scripts/ci/forbid-derived-words.sh hooked into `make verify`.
- Layer 3: docs/fleet-charter.md committed FIRST, immutable thereafter.

TESTS
- node:test (no Vitest/Jest in API).
- apps/api/test/fleet-snapshot.test.js
- apps/api/test/fleet-events.test.js (fake EventSource + clock injection)
- apps/api/test/fleet-schema.test.js
- tests/integration/host-bind.test.js (HOST=0.0.0.0 reject)
- forbid-derived-words.sh self-test

DELIVERABLES
- apps/api/src/fleetService.js (~300 LOC)
- apps/api/src/validation.js (extended: parseFleetIncludeQuery, parseFleetWindowQuery, parseHost)
- apps/api/schemas/fleet-response.schema.json
- apps/api/schemas/fleet-event.schema.json
- apps/ui/src/app/components/refscope/FleetSurface.tsx (~370 LOC)
- apps/ui/src/app/api.ts (extended: subscribeFleet, fetchFleetSnapshot)
- apps/ui/src/app/App.tsx (extended: mode: "fleet" | "detail")
- scripts/ci/forbid-derived-words.sh
- docs/fleet-charter.md (charter v1, immutable)
- Tests above.

VERIFICATION (before claiming done)
- `make verify` passes (includes Layer 2 grep gate and host-bind test)
- `make test` passes
- `make build` passes
- All 12 ACs (proposal §9 trace matrix) verified manually with N=2 test repos
- Quiet mode shows 0 active animations (DevTools performance trace)
- aria-live coalesces to ≤ 1/min default (SR test harness)

DO NOT
- Add new git commands to gitRunner allowlist.
- Add CI/deploy/dependency/AI/score/ranking/severity/share/login/avatar/oauth/presence
  fields or UI elements.
- Add per-row aria-live (twoss-quadratic SR storm risk).
- Use `0` for empty count cells (use em-dash `—`).
- Use adjectives in Footer cost ("light", "fast", "heavy" etc).
- Bypass the grep gate with --no-verify or similar.
- Edit charter v1 in place (supersede only).

NEXT
After implementation, hand off to:
- Echo (cognitive walkthrough with Aya persona)
- Warden (WCAG 2.2 AA + CVD ΔL audit)
- Researcher (real SRE N=5 validation, sample size)
```

---

_STEP_COMPLETE:
  Agent: Spark (v1.1 update via Nexus, Echo + Magi feedback 統合)
  Status: SUCCESS
  Output: |
    Fleet observation surface RFC v1.0 → v1.1 in-place update。Echo cognitive walkthrough (16 friction / 14 改善案 / 9 KPI estimate) と Magi 3 strategic verdicts (D1 surface name `Fleet` 確定 / D2 charter immutable + non-substantive exception / D3 build か否か = 遅延 / Researcher Go gate 8w hard-cap) を統合。
    Echo MUST 6 件を §5.1 (S-B2 Detail mode 中も Fleet SSE 維持) / §5.8 (S-A1 listbox dim + center message) / §6.1 (S-B1 count badge `[Fleet · N]`) / §6.2 (S-C2 hover tooltip) / §6.4 (S-D1 glyph re-design `!`/`×` + 3 shape base 分離) / §6.9 (S-C1 onboarding hint overlay 新節) に反映。
    Magi 3 verdicts を §6.1 (D1 確定 + Confidence 70/100) / §6.1.1 新節 (D1 retreat 条件 R1/R2/R3) / §7 charter §1 (D2 建設的言い換え, Quill polish task 化) / §7 charter §6.1 新節 (D2 non-substantive correction exception) / §7 charter §6.2 新節 (D2 6 ヶ月後 governance health review) / §7 charter §6 #5 (D2 previous-charter diff summary table 必須) / §10.7 update (`RTGV_BIND_PUBLIC` 単独 deliberation 予定) / §15.1 (D3 遅延 / Researcher Go gate 正面化, Pathos dissent verbatim 保存) / §16 (next agents 再構成: Echo 完了済除外、Researcher ‖ Quill parallel、Magi 再 deliberation 段階追加) / §17 prompt (Researcher Go 前は発火しない warning + UI scope 4 件追加) に反映。
    新節追加: §3.4 JTBD chain (6 件), §6.1.1 retreat 条件, §6.9 Onboarding hint overlay, §6.10 Vision Implementation Notes (SHOULD 5 件 mention)。
    §3.2 KPIs に "Echo v1 walkthrough estimate" 列追加 — 3 PASS (K6 K8 K9) / 3 conditional (K4 K5 K7) / 3 FAIL likely (K1 K2 K3)。
    派生禁止 charter §1 抵触チェック note を §7 §1 直下に追加 (count badge / hint overlay / `—` tooltip / glyph re-design の 4 件すべて charter §1 抵触なし)。
    §10 Open Questions を 9 件 → 13 件に拡張 (Echo COULD 4 件追加、特に S-D3 Quiet alive heartbeat は Magi 再 deliberation 候補として明記)。
  Artifacts:
    - /Users/simota/repos/github.com/refscope/docs/spark-reo-fleet-observation-proposal.md (v1.0 → v1.1)
    - /Users/simota/repos/github.com/refscope/.agents/magi.md (新規創設、3 verdict entry)
    - /Users/simota/repos/github.com/refscope/.agents/PROJECT.md (新 entry)
  Risks (v1.1 added):
    - 派生 slippery slope (charter を後から緩める政治圧力) — v1.1 で non-substantive exception 追加により wider gate に見えるリスク (semantic-diff check で線引)
    - team feature と誤解された UI 要素が PR で混入する可能性
    - Aya (Round 5 新卒) が Fleet mode を初見で confuse する risk → v1.1 で §6.9 hint overlay により予防的救済
    - 24h window 固定 vs 設定可能の論争 (Atlas enum 許容 vs Vision 固定推奨)
    - 32 repo cap が緩すぎる/きつすぎる
    - SSE multiplex の race / 再接続 / heartbeat の test surface 増大
    - **Magi D1 retreat trigger** (Atrium rename 連鎖 amendment) のリスク — Echo Aya walkthrough は v1.1 完了 (R1 trigger は Researcher Go 前に発火可能)
    - **Researcher 8w hard-cap 内に N=5 SRE が集まらない**リスク → Conditional Go (Option A subset) フローに退避
  Next: [Researcher (8w hard-cap) ‖ Quill (charter wording polish)] → Magi 再 deliberation (Researcher 結果 + S-D3 + RTGV_BIND_PUBLIC 単独審議) → Builder + Artisan (Researcher Go + Magi 再 deliberation Go + charter v1 commit 完了の 3 条件達成時のみ)
  Reason: Echo + Magi 両 handoff を proposal v1 に in-place 統合完了。Magi D3 verdict (遅延) を §15.1 / §16 で正面化し Builder/Artisan の早期着手を ban、Echo MUST 6 件は §5/§6 に反映、charter §6 amendment exception は §7 charter §6.1 新節として追加、Magi journal は新規作成、PROJECT.md に entry 追加。Spark 自身の Pathos 寄り "建てたい" 衝動を抑え、Magi 2-1 majority verdict (遅延) を全面尊重したため SUCCESS。
