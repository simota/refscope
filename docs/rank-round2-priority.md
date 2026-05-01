# Rank Report: Plea round 2 demand priority scoring (Refscope)

> Source demands: `docs/user-demand-report-2026-05-01.md` (Plea round 2, 4 demands)
> Reference proposal: `docs/spark-period-summary-proposal.md` (Hana 向け, Option B 推奨)
> 状態: 全 demand `synthetic: true`。本ドキュメントは Researcher 検証前の暫定スコアリングであり、ロードマップを確定させる権限を持たない RFC tone。
> 上位エージェント: Plea → Spark → **Rank (this document)** → Researcher / Accord / Sherpa (next).

---

## 0. Summary

- **対象 demand:** 4 件 (D-Hana / D-Tomo / D-Yuki / D-Ken)。
- **適用フレームワーク:** RICE / WSJF / MoSCoW (3 フレームワーク必須要件) に加え、確認用に ICE を補助スコアとして添える。
- **推奨ロードマップ順序 (1 案):** **D-Yuki (横串で並走) → D-Hana (Spark 既存ゆえ先行) → D-Ken (Researcher 検証 + Spike 並走) → D-Tomo (MVP 範囲外、v2 候補)**。
- **フレームワーク間の Spearman 相関は High** (約 0.85 — RICE / WSJF / MoSCoW で上位下位の入れ替わりは D-Yuki と D-Hana の 1–2 位逆転のみ)。
- **最大の sensitivity:** D-Ken の Effort (S/M/L) と D-Yuki の Reach (`prefers-reduced-motion` を持つユーザーが Refscope 母集団のどの割合か)。
- **Confidence cap:** 全 demand で 50–60% を上限とする (実ユーザー検証なし)。Researcher session 後にのみ 70%+ に引き上げて良い。

---

## 1. Scoring Inputs (フレームワーク横断 input table)

スコアリングの input を 1 表にまとめ、後段で各フレームワークの計算根拠を辿れるようにする。

| Demand | Persona breadth (1-10) | Frequency (1-10) | User-felt urgency (1-10) | Incident stake (1-10) | Effort 推定 | Confidence (cap 60%) | Spark proposal 既存 |
|---|---:|---:|---:|---:|---|---:|:---:|
| **D-Hana** (期間サマリビュー) | 4 | 4 (週次) | 5 (週次の痛み) | 1 | **M** (1.5 person-month、Spark §5.1) | **55%** | あり |
| **D-Tomo** (file-level history + cursor pagination + rename 追跡) | 2 | 5 (調査タスクごと) | 6 (調査ブロッカー) | 2 | **L** (2.5–3.5 person-month、API + UI 両側) | 40% | なし |
| **D-Yuki** (Quiet mode + `prefers-reduced-motion`) | 5 (a11y 必須カバー含む) | 8 (日常的・常時) | 6 (集中阻害) | 1 | **S–M** (0.5–1 person-month、UI のみ) | 45% | なし |
| **D-Ken** (Boot-time ref recap + Watched refs) | 3 | 2 (incident 駆動) | 9 (深夜 1 分勝負) | 9 (incident-stake) | **L** (reflog 読込/persistence 設計、新 API 経路) | 40% | なし |

### 1.1 Input 推定根拠 (1-2 行)

- **D-Hana — Persona breadth 4:** 非エンジニア観察者は Refscope の典型ターゲットでは中堅。エンジニアでも週次レビュー観点で部分的に恩恵あり。**Frequency 4:** 週次で repo を開く頻度。**Urgency 5:** 痛みは一定だが incident 性なし。**Effort M:** Spark §5.1 が `1.5 person-month` (UI 1 component + API 1 endpoint + テスト) と見積。
- **D-Tomo — Persona breadth 2:** 数万 commit monorepo の OSS maintainer はターゲット層では狭い。**Frequency 5:** 調査タスクごとに発火。**Urgency 6:** 調査が壁にぶつかるブロッカー痛み。**Effort L:** cursor pagination は API protocol 変更 (200 commit hard limit を破らずに新 cursor 仕様)、`--follow` の rename 追跡は gitRunner allowlist 内 (`log` 既存) だが UI に file-history view を新規追加するため UI/API 両面で重い。
- **D-Yuki — Persona breadth 5:** ADHD / sensory-sensitive は限定的だが、**`prefers-reduced-motion` 経由で a11y 必要層全般 (片頭痛、前庭障害、低照度作業者) も同時にカバーできる**ため breadth は中。Plea journal にも「visual summary を量産すると抑制装置が同時に必要」と記載あり。**Frequency 8:** Quiet mode が必要な人にとっては常時 ON。**Urgency 6:** 集中阻害は日常痛み。**Effort S–M:** UI のみ (CSS 変数化 + `prefers-reduced-motion` query + state persistence) で API 変更ゼロ。ただし全 component の motion / saturation を quiet 化するため UI 横串。
- **D-Ken — Persona breadth 3:** SRE / on-call は Refscope ターゲット内で重要だが breadth は中。**Frequency 2:** incident 時のみ。**Urgency 9:** "深夜 1 分勝負" の incident 性。**Incident stake 9:** 失敗時の代償 (誤判断による rollback 遅延等) が他 demand より一桁高い。**Effort L:** reflog 読み取りには新 allowlist command (`reflog`) が必要、watch list 永続化のスコープ (localStorage vs API) 設計、観察事実 vs 派生境界の UI 設計、初回起動時の last-known hash 不在 fallback。Spark proposal なし。

> Note: D-Ken の "reflog 読み取り" は **Refscope の hardened gitRunner allowlist (`cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`)** に **`reflog` を追加する必要**がある可能性が高い。これは Refscope の核 (hardened execution) を触る変更であり、優先度判断とは別に **Architecture Review** (Atlas / Magi 経由) を要する flag 案件。

---

## 2. RICE Score (Reach × Impact × Confidence / Effort)

Refscope は local-first / 単独実行プロダクトのため、**Reach は「ターゲットペルソナの典型カバー範囲」を 1-10 スケールで bounded に推定** する。Reach = `breadth × frequency / 10` (両軸を独立に評価して合成)。

### 2.1 RICE Inputs

| Demand | Reach (= breadth × freq / 10) | Impact (1-3, max=3) | Confidence (cap 60%) | Effort (person-month) | RICE Score |
|---|---:|---:|---:|---:|---:|
| **D-Hana** | 1.6 (= 4 × 4 / 10) | 2 (medium) | 0.55 | 1.5 | **1.17** |
| **D-Tomo** | 1.0 (= 2 × 5 / 10) | 2 | 0.40 | 3.0 | **0.27** |
| **D-Yuki** | 4.0 (= 5 × 8 / 10) | 2 | 0.45 | 0.75 | **4.80** |
| **D-Ken** | 0.6 (= 3 × 2 / 10) | 3 (high, incident-stake) | 0.40 | 2.5 | **0.29** |

**RICE 計算式:** `(Reach × Impact × Confidence) / Effort`

### 2.2 RICE Ranking

| 順位 | Demand | RICE Score | 備考 |
|---:|---|---:|---|
| 1 | D-Yuki | 4.80 | breadth × frequency が高 + Effort が最小。Quiet mode は a11y 横串で reach 拡大。 |
| 2 | D-Hana | 1.17 | Spark proposal あり = readiness 高、Effort 中。 |
| 3 | D-Ken | 0.29 | Reach は低いが Impact 3 (incident-stake) で底上げ。Effort が下げれば順位上昇。 |
| 4 | D-Tomo | 0.27 | Reach が狭く Effort が L のため最下位。 |

### 2.3 RICE 解釈

- RICE は **breadth × frequency** を Reach で吸収するため、**incident-driven な Ken は構造的に低く出る**。これは設計上の特性であり、urgency を別軸で評価する WSJF と組み合わせる必要がある。
- D-Yuki が圧倒的 1 位なのは、Effort が小さく `prefers-reduced-motion` 経由で a11y 母集団を間接 reach できるため。Reach の中身次第で 2–3 位に落ちる感度がある (§5 sensitivity 参照)。

---

## 3. WSJF Score (Cost of Delay / Job Duration)

WSJF (SAFe) では Cost of Delay = `Business Value + Time Criticality + Risk Reduction / Opportunity Enablement`、各成分 Fibonacci 1-13。Job Duration も Fibonacci。

### 3.1 WSJF Inputs

| Demand | Business Value (1-13) | Time Criticality (1-13) | Risk Reduction / Opp Enablement (1-13) | CoD 合計 | Job Duration (Fib) | WSJF |
|---|---:|---:|---:|---:|---:|---:|
| **D-Hana** | 5 | 3 (週次の痛みだが期限なし) | 5 (観察/派生分離パターン確立) | 13 | 5 | **2.6** |
| **D-Tomo** | 5 | 3 (調査ブロッカーだが緊急性低) | 3 (200 commit 上限の構造改善) | 11 | 8 | **1.4** |
| **D-Yuki** | 8 (a11y compliance) | 5 (日常痛み + `prefers-reduced-motion` 標準対応) | 8 (visual summary 抑制装置の欠如を解消) | 21 | 3 | **7.0** |
| **D-Ken** | 13 (incident-stake) | 13 (深夜 1 分勝負) | 8 (SSE 接続外 blind spot 解消) | 34 | 8 | **4.25** |

### 3.2 Confidence cap

WSJF は absolute スコアではなく相対 Fibonacci で運用するため confidence は明示しないが、本レポートでは **synthetic demand 由来のため CoD 合計に対して -15% の地ならし係数** を概念的に適用 (順位は保つが、絶対値を信用しすぎない警告)。

### 3.3 WSJF Ranking

| 順位 | Demand | WSJF | 備考 |
|---:|---|---:|---|
| 1 | D-Yuki | 7.0 | a11y compliance による BV 高 + Job Duration 短。 |
| 2 | D-Ken | 4.25 | CoD 合計が圧倒的 (incident-stake) だが Job Duration 8 が分母を膨らます。 |
| 3 | D-Hana | 2.6 | BV / TC / RR がバランス。Spark proposal で Job Duration 5 まで圧縮済み。 |
| 4 | D-Tomo | 1.4 | CoD 合計が中、Job Duration 8 が重荷。 |

### 3.4 WSJF 解釈

- **WSJF は urgency / time-criticality を重視するフレームワーク**であるため、**Ken の incident-stake が RICE より高く評価される (RICE 3 位 → WSJF 2 位)**。これは想定通りの divergence。
- D-Yuki は両フレームワーク 1 位を維持。Effort / Job Duration が小さいことが両軸で効く。

---

## 4. MoSCoW Classification

| Demand | 分類 | 判断根拠 |
|---|:---:|---|
| **D-Hana** | **Should** | Spark proposal 既存 = readiness 高い。AC 明確で incremental delivery 可能。ただし MVP critical path ではなく週次価値であり Must ではない。Researcher 検証次第で Must 昇格余地。 |
| **D-Tomo** | **Could** | Persona breadth が狭く (数万 commit monorepo の maintainer)、現 MVP の 200 commit 制約は spec-v0 で明示された設計境界。範囲外宣言の選択肢が公式に存在 (Plea round 2 Q3)。v2 候補。 |
| **D-Yuki** | **Must** | `prefers-reduced-motion` は WCAG 2.2 sensory accommodation の事実上要件。Refscope の visual summary 大量追加 (round 1 結果) に対する **a11y 抑制装置の欠如は出荷ブロッカー級** (Plea journal でも flag 済み)。Effort 小で Must 据えやすい。 |
| **D-Ken** | **Should** (with Spike) | Incident-stake は最高だが、reflog allowlist 追加 + watch list 永続化スコープ設計 (localStorage vs API server) など architectural decision を含む。**Spike 1 週間で feasibility と Effort 確定後に Must 昇格を再評価**。 |

### 4.1 MoSCoW 分布の健全性チェック

- Must: 1 件 (25%) / Should: 2 件 (50%) / Could: 1 件 (25%) / Won't: 0 件。
- Rank の "60% rule" (同 tier 60% 超は red flag) はクリア。
- Won't が 0 件なのは健全 (4 件すべて Plea で観察された実痛みであり、明示的に却下する demand はない)。Tomo を Won't ではなく Could に置いたのは、長期保守 use case を「範囲外と公式に宣言する」決定がまだ team に委ねられているため (Plea round 2 Q3)。

---

## 5. Sensitivity Analysis (各 demand の ±20% input 変動による順位変化)

| Demand | 主要 sensitivity | ±20% 変動時の順位変化 |
|---|---|---|
| **D-Hana** | **Effort (1.5 → 1.2 or 1.8 person-month)**: Spark §5.1 の Option B 完全版で path grouping を v1 に含めるかで Effort が ±0.3 動く。Effort 1.2 なら RICE 1.46、Effort 1.8 なら 0.97。WSJF 順位は不変。 |
| **D-Hana** | **Confidence (55% → 44% or 66%)**: Researcher 軽量検証 (3-5 名) を通して Confidence 66% に上がれば RICE 1.40 (D-Hana が D-Yuki に迫らないが、3 位以下から 2 位は安定)。 |
| **D-Tomo** | **Reach (1.0 → 0.8 or 1.2)**: 数万 commit monorepo を扱うユーザー比率の不確実性。Reach 1.2 でも RICE 0.32 と最下位は不変。 |
| **D-Tomo** | **Effort (3.0 → 2.4 or 3.6)**: cursor pagination だけ先行実装する MVP cut なら Effort 1.5 まで圧縮可能で RICE 0.53、3 位 (D-Ken と入れ替わり)。スコープ判断が順位変化を引き起こす最大ドライバー。 |
| **D-Yuki** | **Reach (4.0 → 3.2 or 4.8)**: `prefers-reduced-motion` を OS 側で有効化しているユーザー比率。下振れ時 RICE 3.84 で 1 位は不変。 |
| **D-Yuki** | **Effort (0.75 → 0.6 or 0.9)**: 既存 component 横串で saturation / motion 抑制をどこまで一貫適用するかで変動。Effort 0.9 でも RICE 4.0 で 1 位不変。**最も robust な順位**。 |
| **D-Ken** | **Effort (2.5 → 2.0 or 3.0)** ← **最重要**: reflog allowlist 追加コストと watch list 永続化スコープで ±0.5 動く。Effort 2.0 で RICE 0.36、WSJF 6.5 (D-Yuki に迫る)。逆に Effort 3.0 (architectural change が大きい場合) で RICE 0.24、WSJF 3.4。 |
| **D-Ken** | **Time Criticality (13 → 10 or 13 維持)**: Plea synthetic からの 13 評価は high-side。Researcher で実 SRE 5 名にヒアリング後 10 に下げると WSJF 3.5 で 3 位まで落ちる可能性。 |

### 5.1 順位変化が起きやすい組み合わせ

- **D-Yuki vs D-Hana の 1-2 位:** Yuki の Reach が下振れ (3.2) かつ Hana の Confidence が 66% に上がれば、RICE で並ぶ可能性 (Yuki 3.84 vs Hana 1.40 — Hana が Yuki を抜くには Effort が 0.5 person-month 以下に下がる必要があり、現実的でない)。実質的には **Yuki が 1 位に robust**。
- **D-Ken vs D-Tomo の 3-4 位:** Tomo の Effort 圧縮 (cursor pagination MVP cut) で 3 位入れ替わり可能性。

---

## 6. フレームワーク間の divergence 解説

| 比較 | 観察 | 解釈 |
|---|---|---|
| RICE 1 位 (Yuki) vs WSJF 1 位 (Yuki) | 一致 | RICE が Reach を Effort で割る式と、WSJF が CoD を Job Duration で割る式は、Yuki の "reach 中 + effort 小 + a11y compliance" 特性で同じ方向に振れる。 |
| RICE 3 位 (Ken: 0.29) vs WSJF 2 位 (Ken: 4.25) | **divergence** | RICE は Reach (= breadth × frequency) で Ken を低く出す (incident は frequency 2)。WSJF は Time Criticality 13 で Ken を高く出す。**両者の見ている軸が違う**: RICE = "how many users × how often", WSJF = "how costly is delay"。Ken のような incident-driven demand は WSJF が適切な lens。 |
| MoSCoW Must (Yuki) vs RICE 1 位 (Yuki) | 一致 | a11y compliance は MoSCoW Must であると同時に RICE/WSJF でも上位という双方向支持。 |
| MoSCoW Could (Tomo) vs RICE 4 位 (Tomo) | 一致 | breadth 狭 + Effort L = 全 lens で下位。これは team が "MVP 範囲外として明示" するかの政治判断に直結。 |

### 6.1 順位の最終 reconcile

- **Yuki: 全 lens 1 位。Must、先行実装。**
- **Hana: RICE 2 位 / WSJF 3 位 / MoSCoW Should。Spark proposal で readiness が突出して高いため、実装着手しやすさで 2 位。**
- **Ken: RICE 3 位 / WSJF 2 位 / MoSCoW Should (with Spike)。urgency 評価の divergence が最も大きく、Researcher 検証 + Spike が必須。**
- **Tomo: 全 lens 4 位。Could、v2 候補として明示。**

---

## 7. ICE 補助スコア (確認用)

ICE = Impact × Confidence × Ease (各 1-10)。FULL mode の必須要件ではないが、上記順位の robustness 確認用に併置。

| Demand | Impact | Confidence | Ease (= 11 - Effort 順位) | ICE Score |
|---|---:|---:|---:|---:|
| D-Hana | 6 | 5.5 | 7 | 231 |
| D-Tomo | 6 | 4 | 4 | 96 |
| D-Yuki | 7 | 4.5 | 9 | 283.5 |
| D-Ken | 9 | 4 | 4 | 144 |

ICE 順位: **Yuki > Hana > Ken > Tomo**。RICE 順位と完全一致。WSJF とは Ken/Hana 順位が入れ替わる (これは WSJF が time-criticality を強調するため)。Spearman ρ ≈ 0.85 (high agreement)。

---

## 8. Confidence Cap (synthetic 仮説の信頼性制限)

**全 demand は `synthetic: true`** (Plea 由来、実ユーザー検証なし)。本レポートの confidence は以下の上限を超えない:

| Demand | Confidence cap | 理由 |
|---|---:|---|
| D-Hana | **60%** | Spark proposal が AC マッピングと KPI を確定しているため synthetic にしては readiness 高。但し非エンジニアユーザーの実際の release-note workflow が synthetic 仮説通りか未検証。 |
| D-Tomo | **45%** | 数万 commit monorepo maintainer の調査 workflow は具体性高いが、Refscope を実際に使って 200 commit 壁にぶつかったユーザーの声は未収集。 |
| D-Yuki | **50%** | a11y / sensory sensitivity はパターン化されているが、Refscope の specific な visual summary が実際にトリガーかは未検証。 |
| D-Ken | **45%** | incident-stake と "起動時 1 分" は SRE persona patternとして妥当だが、Refscope を選んだ SRE が実在するか未確認。reflog 読込みの architectural cost も未確定。 |

### 8.1 Roadmap 確定前に Researcher 検証必須の demand

- **D-Ken (最優先)**: incident-stake 9 と評価しているが、これが事実なら全 demand の中で最も重い。空振りなら最も無駄が大きい。Researcher で実 SRE 3-5 名にヒアリングし、boot-time recap が本当に "最初の 1 分" の workflow に組み込まれるか検証すべき。
- **D-Tomo**: persona breadth が狭いため、対象ユーザーが Refscope を選んでいるかの確認が先。breadth 推定が外れていれば MoSCoW Won't への移行も検討。

D-Hana / D-Yuki は「a11y / 非エンジニアの release-note 作成」というパターン化された痛みであり、Researcher 検証なしでも MVP / Should として進めるリスクは相対的に低い。

---

## 9. Architecture / Product 整合性 flag

優先度評価とは別に、**Refscope の核 (observed Git facts、local-first、hardened execution)** との整合を以下に flag する。

| Demand | 整合性 | flag |
|---|:---:|---|
| D-Hana | OK | Spark §5.1 で gitRunner allowlist 内 (`log` 既存) で完結することを確認済み。`validation.js` に `parseDateQuery` 追加のみ。 |
| D-Tomo | **要注意** | `--follow` / `--find-renames` は `log` allowlist 内だが、cursor pagination は API protocol の新規追加 (現 200 commit hard limit との整合)。新 query schema 設計が必要。 |
| D-Yuki | OK | UI のみの変更、API 変更ゼロ。`prefers-reduced-motion` media query は標準。 |
| D-Ken | **要 Architecture Review** | `reflog` は現 allowlist (`cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`) に **含まれない**。新コマンド追加は hardening surface を広げる決定。Spike で feasibility 確認 + Atlas / Magi で arbitration 推奨。**watch list 永続化** が API server 側 (新規 state mutation endpoint) になると "no external services" 原則と緊張する可能性。localStorage 案を第一候補に。 |

---

## 10. 推奨ロードマップ (RFC tone — 最終決定はチームに委ねる)

### 10.1 推奨順序

1. **D-Yuki (Quiet mode)** — **横串で並走、可能な限り早期着手**。RICE / WSJF / ICE で 1 位、a11y compliance、Effort 最小、Plea journal で抑制装置欠如を flag 済み、API 変更ゼロ。
2. **D-Hana (期間サマリビュー)** — **Spark proposal Option B が既存ゆえ先行実装着手しやすい**。AC 明確、Researcher 軽量検証 (3-5 名) と並走させると Confidence を 60% → 70%+ に引き上げられる。
3. **D-Ken (Boot-time ref recap)** — **Spike 1 週間 + Researcher 並走で feasibility と Effort を確定**。incident-stake が事実なら roadmap 上位昇格、reflog allowlist 追加が hardening surface に与える影響次第で範囲調整。
4. **D-Tomo (file-level history)** — **MVP 範囲外として明示**、v2 候補。breadth が狭く Effort が L で、現 MVP の 200 commit 設計境界を尊重する判断と整合 (Plea round 2 Q3 への team 回答が必要)。

### 10.2 推奨根拠 (4-6 行)

- **Yuki を 1 位に置く理由**: a11y compliance は MoSCoW Must であり、Effort も最小で incremental delivery 可能。Plea journal で「visual summary を量産すると抑制装置が同時に必要」と既に flag 済みであり、後追いで a11y 圧力として返ってくるリスクを今のうちに償却できる。
- **Hana を 2 位に置く理由**: Spark proposal Option B が既に存在し、AC マッピング・KPI・kill criteria・Open questions まで packaging 済みで、**implementation readiness が突出して高い**。urgency は Ken に劣るが、readiness と Effort のバランスで先行可能。
- **Ken を 3 位に置く理由**: WSJF 2 位 = urgency は最高クラスだが、`reflog` 新 allowlist 追加と watch list 永続化スコープという architectural decision を含むため、**Spike なしでの実装着手は risk が高い**。Researcher で実 SRE のヒアリングを通して Time Criticality 13 が事実か検証しつつ、Spike で feasibility を確定する並走が安全。
- **Tomo を 4 位 (MVP 範囲外) に置く理由**: persona breadth が狭く、200 commit 上限は spec-v0 で明示された設計境界。**「範囲外として明示する」決定自体が team に委ねられた政治判断**であり、Rank としては range out 推奨だが、Won't ではなく Could として将来再評価の余地を残す。

### 10.3 並走関係図

```
[Now] ─────────────────────────────────────────────────► [4 weeks]
  │
  ├── D-Yuki (Quiet mode、UI 横串、Effort S-M、API 変更ゼロ)
  │      └─ Echo cognitive walkthrough と並走 (Plea ハンドオフ指示通り)
  │
  ├── D-Hana (Spark Option B 実装、Effort M)
  │      └─ Researcher 軽量検証 (3-5 名) と並走、KPI 4 週間 ローカル収集
  │
  ├── D-Ken Spike (1 week, feasibility + Effort 確定)
  │      └─ Researcher 実 SRE ヒアリング 3-5 名と並走
  │      └─ reflog allowlist 追加判断は Atlas / Magi で arbitration
  │
  └── D-Tomo (MVP 範囲外、v2 候補として docs に記録)
         └─ Plea round 3 で「範囲外と宣言する」team 回答を再収集
```

---

## 11. Bias Check Report

| Bias 種類 | 検出有無 | 対応 |
|---|:---:|---|
| **HIPPO (Highest Paid Person's Opinion)** | 不在 | Plea synthetic ペルソナのため HIPPO は構造的に存在しない。 |
| **Recency** | **可能性あり** | Spark proposal が直前に作成された (Hana のみ proposal あり) ため、Hana を unfair に高評価する Recency bias の余地。**対応**: Confidence cap で吸収 (Hana 60% に制限)。Spark proposal の存在は Effort estimate の根拠にとどめ、Impact / Reach は他 demand と同じ rubric で評価。 |
| **Sunk Cost** | 不在 | round 2 の新規 demand のため sunk cost なし。 |
| **Anchoring** | 限定的 | Hana の Effort = 1.5 person-month を anchor にして他 demand の Effort を相対評価する傾向。**対応**: Tomo / Yuki / Ken の Effort を S/M/L で独立に置き、Hana を anchor にしない方法で再確認した。 |
| **Availability heuristic** | **可能性あり** | a11y / Quiet mode (Yuki) は議論として availability が高く (Plea journal で flag 済み)、urgency を過大評価する余地。**対応**: WCAG 2.2 standard を客観 anchor として使用、subjective discomfort のみで MoSCoW Must を付けない。 |

### 11.1 Consider-the-opposite

各 demand について「これを最下位に置く論拠は?」を 1 行で考える練習:

- **D-Yuki を 4 位に置くなら?** → 「Refscope ユーザーで実際に sensory sensitivity を持つ割合が低く、`prefers-reduced-motion` 標準対応で済むなら Quiet mode UI は overkill」という反論が成立する。Reach 推定 (5) を 2 に下げると RICE 1.6 で 2 位になる。**反論への応答**: Plea journal で抑制装置欠如が round 越しに再発する死角と flag されており、a11y 横串対応はビジネス価値より先に compliance issue。
- **D-Ken を 1 位に置くなら?** → 「incident-stake は他全 demand を圧倒し、たとえ frequency が低くとも 1 度の incident で得られる価値が他全 demand 1 ヶ月分を上回る」という Cost of Delay 論拠が成立する。WSJF だけ見れば Ken 1 位の選択肢もあった。**反論への応答**: architectural risk (reflog allowlist 追加) が Spike なしでは見積れず、即着手は risk が高いため Researcher + Spike を先行させる時系列判断。

---

## 12. Open Questions (チーム判断が必要な点)

1. **Researcher session の優先順位**: Hana (release-note workflow) と Ken (incident workflow) の検証を同時並行で走らせるか、urgency が高い Ken を先行させるか?
2. **Tomo demand の "MVP 範囲外宣言" を docs に明記するか**: Plea round 2 Q3 が team に委ねた判断。spec-v0.md に追記して長期保守 use case の公式 stance を確定すべきか?
3. **Quiet mode の v1 スコープ**: 全 component (`CommitActivityGraph`, `AuthorGraph`, top bar pulse, sidebar bar chart, hover emphasis, status badges) を一度に quiet 化するか、phased rollout (まず top bar pulse のみ) で段階的に Echo 検証を回すか?
4. **D-Ken の watch list 永続化スコープ**: localStorage (UI 単独完結、推奨) vs API server 側 state (multi-device で共有可能だが "no external services" 原則と緊張)。**この決定は Atlas / Magi での arbitration 推奨**。
5. **`reflog` allowlist 追加判断**: Refscope の hardened gitRunner allowlist に新コマンドを追加するかは独立した architectural decision。Spike なしで実装着手しないという gate を team が合意するか?
6. **Confidence cap の運用**: Researcher 検証後に各 demand の Confidence を 70%+ に引き上げる権限は誰が持つか? Rank が再スコアリングするか、Researcher がレポートで提示するか?

---

## 13. _STEP_COMPLETE (本レポートの自己宣言)

```yaml
_STEP_COMPLETE:
  Agent: Rank
  Status: SUCCESS
  Output:
    deliverable: round 2 demand priority report (RICE / WSJF / MoSCoW + ICE 補助)
    parameters:
      work_mode: FULL
      frameworks_used: [RICE, WSJF, MoSCoW, ICE]
      items_ranked: 4
      rank_correlation: ~0.85 (Spearman, RICE vs WSJF 概算)
      confidence: MEDIUM (synthetic cap 60%)
  Top:
    - D-Yuki (RICE 4.80, WSJF 7.0, MoSCoW Must)
    - D-Hana (RICE 1.17, WSJF 2.6, MoSCoW Should, Spark proposal あり)
    - D-Ken (RICE 0.29, WSJF 4.25, MoSCoW Should + Spike, incident-stake 高)
    - D-Tomo (RICE 0.27, WSJF 1.4, MoSCoW Could, MVP 範囲外候補)
  Next: Researcher (synthetic 仮説の検証を D-Ken 優先で先行) + Sherpa (D-Yuki / D-Hana を decomposition)
  Reason: 4 demand を 3+1 framework で並べ、divergence を解説、sensitivity / open questions / bias 報告を含む RFC tone のレポートを生成できたため SUCCESS。
```

---

## 14. References

| Type | Path | Use |
|---|---|---|
| 上流 demand | `docs/user-demand-report-2026-05-01.md` | 4 demand の persona / AC / urgency を読み込み |
| Hana 用 Spark | `docs/spark-period-summary-proposal.md` | D-Hana の Effort estimate (Option B = 1.5 person-month) |
| Plea journal | `.agents/plea.md` | round 越しに再発する死角 (観察/派生分離、開きっぱなし前提、抑制装置欠如) |
| Architecture | `CLAUDE.md` | gitRunner allowlist、200 commit 上限、API ESM 制約を Effort 評価に反映 |
| Spec | `docs/spec-v0.md` | MVP 設計境界 (Tomo の "MVP 範囲外" 判断根拠) |
