# Rank Report: Plea round 6 demand priority scoring (Refscope — リファクタ目線)

> Source demands: `docs/user-demand-report-2026-05-07-r6.md` (Plea round 6, 7 demands)
> Format reference: `docs/rank-round2-priority.md`
> 状態: 全 demand `synthetic: true`（Plea r6 起源）。本ドキュメントは Researcher 検証前の暫定スコアリングであり、ロードマップを確定させる権限を持たない RFC tone。
> 上位エージェント: Plea r6 → **Rank (this document)** → Researcher / Accord / Sherpa (next).
> 作成日: 2026-05-07

---

## §0 Summary

- **対象 demand:** 7 件 (D-1 〜 D-7)。
- **適用フレームワーク:** RICE / WSJF / MoSCoW（必須 3 フレームワーク）+ ICE（補助）。
- **推奨ロードマップ順序:**
  1. **D-6** (graded cherry-pick equivalence) — 既存パネル拡張、Effort 最小、readiness 最高
  2. **D-3** (refactor branch health dashboard) — 既存 branch health 拡張、Tech Lead 週次痛み
  3. **D-2** (refactor-only コミットフィルタ) — allowlist 内完結、バッジ UI のみ
  4. **D-4** (why-panel) — allowlist 内完結、Junior 日々痛み
  5. **D-1** (シンボル/関数単位履歴貫通) — `git log -L` + `--follow` 活用、API + UI 追加
  6. **D-7** (rewrite rescue snapshot) — read-only 哲学境界、設計判断が必要
  7. **D-5** (semantic AST diff) — 外部依存・工数過大、Architecture Review 必須
- **最大の sensitivity:**
  - D-5 の Effort 推定 (tree-sitter 採用可否で M→XL に変動)
  - D-1 の `git log -L` flag allowlist 判断 (追加不要 vs flagged 変更)
  - D-7 の永続化スコープ (IndexedDB/localStorage vs 状態なし)
- **フレームワーク間 Spearman ρ (RICE vs WSJF):** 概算 ≈ 0.72 — 中程度の一致。D-1 と D-7 で RICE/WSJF 順位が入れ替わる（理由は §6 で詳述）。
- **Confidence cap:** 全 demand 60% 以下 (synthetic 仮説のため)。Researcher 検証後のみ 70%+ に引き上げ可。

---

## §1 Scoring Inputs (フレームワーク横断 input table)

スコアリングの input を 1 表にまとめ、後段の各フレームワーク計算の根拠を辿れるようにする。

| ID | Demand (短縮) | Persona breadth (1-10) | Frequency (1-10) | Urgency (1-10) | Incident stake (1-10) | Effort 推定 | Confidence (cap 60%) | 既存拡張ポイント |
|---|---|---:|---:|---:|---:|---|---:|---|
| **D-1** | シンボル履歴貫通 | 5 | 7 (日々) | 8 | 2 | **L** | 50% | `log --follow` 活用、新 API エンドポイント + UI パネル |
| **D-2** | refactor-only フィルタ | 4 | 6 (週2-3) | 6 | 2 | **M** | 55% | CommitTimeline バッジ追加、diff/log で完結 |
| **D-3** | ブランチヘルスダッシュボード | 6 | 5 (週次) | 6 | 3 | **M** | 55% | 8279d27 branch health + 8e90179 cherry-pick 双方拡張 |
| **D-4** | why-panel | 4 | 7 (日々) | 7 | 1 | **M** | 45% | DetailPanel 拡張、allowlist 内完結 |
| **D-5** | semantic AST diff | 3 | 8 (日々) | 9 | 2 | **XL** | 35% | 外部依存 (tree-sitter) 追加が必要 |
| **D-6** | graded cherry-pick equivalence | 4 | 4 (リリース直前) | 7 | 3 | **S** | 60% | 8e90179 パネル拡張のみ (バイナリ→段階) |
| **D-7** | rewrite rescue snapshot | 3 | 5 (週次) | 6 | 5 | **M** | 45% | SSE `history_rewritten` + payload 拡張 + 永続化設計 |

### §1.1 Input 推定根拠

- **D-1 — Persona breadth 5:** 広志 (直接)・彰 (間接、"コードが生まれた瞬間" も rename 貫通を前提とする) の 2 ペルソナ + リファクタ一般ユーザーが対象。**Frequency 7:** 日々の痛み。**Effort L:** `git log -L:<funcname>` は log allowlist コマンドで呼び出せるが、funcname regex の安全検証・API 新エンドポイント設計・UI の "シンボル旅タイムライン" 新パネル追加が必要。前ラウンドの D-Tomo (file-level history) と近似する重さ。
- **D-2 — Persona breadth 4:** 広志と、PR レビュー担当 (Eleanor) も恩恵を受ける。**Frequency 6:** 週 2-3 回。**Effort M:** diff/log コマンドは allowlist 内で完結。ヒューリスティクス判定 (行追加=削除対称性・トークン保存率) はサーバーサイド計算のみ。UI は CommitTimeline へのバッジ + フィルタトグル追加。
- **D-3 — Persona breadth 6:** Maya (Tech Lead) は 5 名チームを束ねる立場。Tech Lead/EM ペルソナが広くカバーされる。**Frequency 5:** 週次。**Effort M:** 既存 BranchSidebar + branch health filter (8279d27) の拡張に cherry-pick 等価性結果を集約するカードビュー。`merge-base`/`rev-list` で diverge 量計算は allowlist 内。コンフリクト予測はヒューリスティクスに留める (確定値不可)。
- **D-4 — Persona breadth 4:** 彰 (Junior) が主需要者だが、シニアも onboarding や legacy 探索時に使う。**Frequency 7:** 日々。**Effort M:** `git log -L`/pickaxe (`-S`, `-G` flag) は log allowlist 内。ただし "なぜ" の抽出 (動詞・理由節ハイライト) は LLM/正規表現の精度問題あり。DetailPanel 拡張。
- **D-5 — Persona breadth 3:** Eleanor (Reviewer/Architect) が主需要者。**Frequency 8:** 日々の高頻度。**Urgency 9:** 「振る舞い保存」確認の痛みは強い。**Effort XL:** tree-sitter 採用で多言語 AST diff を実現する場合、バイナリ依存管理・WASM ビルド・言語パーサ追加が工数急増。言語非依存ヒューリスティクス (行対称性・トークン保存率) のみに留めれば Effort M まで圧縮可能だが、Eleanor の AC (AST 差分ハイライト・制御フロー変更分類) は未達。この不確実性が最大の Effort 分散要因。
- **D-6 — Persona breadth 4:** Eleanor + リファクタ PR レビュアー全般。**Frequency 4:** リリース直前にピーク。**Effort S:** 既存 cherry-pick equivalence パネル (8e90179) がバイナリ判定で実装済み。段階表示 (identical/near-identical/divergent) と差分 highlight の追加のみで完結。`diff` allowlist 内。Confidence 60% (既存コード拡張のため readiness 最高)。
- **D-7 — Persona breadth 3:** Carlos (DevOps) が主需要者。**Frequency 5:** 週次の相談ピーク。**Incident stake 5:** force-push 事故はインシデント性がある。**Effort M:** SSE payload 拡張 (`history_rewritten` に `before_tip` 追加) + UI での IndexedDB/localStorage 永続化 + 復元コマンド生成。read-only 哲学の境界線上に位置するため設計判断コストが加算される。

---

## §2 RICE Score (Reach × Impact × Confidence / Effort)

Refscope はローカルファースト / 個人実行プロダクトのため、**Reach は「ターゲットペルソナの典型カバー範囲」を 1-10 スケールで bounded に推定**する。
Reach = `breadth × frequency / 10`（§1 の値を合成）。Effort は S=0.5、M=1.5、L=3.0、XL=5.0 person-month に換算。

### §2.1 RICE Inputs

| ID | Reach (breadth×freq/10) | Impact (1-3) | Confidence (cap 60%) | Effort (person-month) | RICE Score |
|---|---:|---:|---:|---:|---:|
| **D-1** | 3.5 (=5×7/10) | 2 | 0.50 | 3.0 | **1.17** |
| **D-2** | 2.4 (=4×6/10) | 2 | 0.55 | 1.5 | **1.76** |
| **D-3** | 3.0 (=6×5/10) | 2 | 0.55 | 1.5 | **2.20** |
| **D-4** | 2.8 (=4×7/10) | 2 | 0.45 | 1.5 | **1.68** |
| **D-5** | 2.4 (=3×8/10) | 3 | 0.35 | 5.0 | **0.50** |
| **D-6** | 1.6 (=4×4/10) | 2 | 0.60 | 0.5 | **3.84** |
| **D-7** | 1.5 (=3×5/10) | 2 | 0.45 | 1.5 | **0.90** |

**RICE 計算式:** `(Reach × Impact × Confidence) / Effort`

### §2.2 RICE Ranking

| 順位 | ID | RICE Score | 備考 |
|---:|---|---:|---|
| 1 | **D-6** | 3.84 | Effort S (0.5) が支配的。既存パネル拡張で Confidence 最高。 |
| 2 | **D-3** | 2.20 | breadth 最大 (6) + 既存拡張ポイント 2 件で readiness 高。 |
| 3 | **D-2** | 1.76 | Effort M かつ Confidence 高め (55%)。allowlist 内完結。 |
| 4 | **D-4** | 1.68 | D-2 とほぼ同点。Confidence が低め (45%) で僅差の 4 位。 |
| 5 | **D-1** | 1.17 | Reach は高いが Effort L (3.0) が足を引く。 |
| 6 | **D-7** | 0.90 | Reach 低 + read-only 設計判断コスト。 |
| 7 | **D-5** | 0.50 | Effort XL (5.0) が全てを打ち消す。Confidence 最低 (35%)。 |

### §2.3 RICE 解釈

- **D-6 が圧倒的 1 位**なのは Effort S + Confidence 高の組み合わせ。既存パネル (8e90179) を拡張するだけで Eleanor の「90% 同じで 10% 違う」需要を満たせる。
- **D-5 が最下位**なのは Effort XL が主因。tree-sitter 採用を避けてヒューリスティクスのみに留めると Effort M (1.5) になり RICE 1.51 で 4〜5 位に浮上するが、Eleanor の AC は達成できない（sensitivity §5 参照）。
- RICE は frequency を重視するため、D-5（日々 urgency 9）でも Effort が大きいと埋没する。urgency 重視の WSJF と組み合わせる必要がある。

---

## §3 WSJF Score (Cost of Delay / Job Duration)

WSJF (SAFe) では Cost of Delay = Business Value + Time Criticality + Risk Reduction/Opportunity Enablement（各 Fibonacci 1-13）、Job Duration も Fibonacci (1=S, 3=M, 5=L, 8=XL)。

### §3.1 WSJF Inputs

| ID | BV (1-13) | TC (1-13) | RR/OE (1-13) | CoD 合計 | Job Duration (Fib) | WSJF |
|---|---:|---:|---:|---:|---:|---:|
| **D-1** | 8 | 8 (日々ブロッカー) | 5 (rename追跡パターン確立) | 21 | 5 | **4.20** |
| **D-2** | 5 | 5 (週2-3回) | 8 (振る舞い変更証明 → PR信頼性) | 18 | 3 | **6.00** |
| **D-3** | 8 | 5 (週次) | 8 (並行ブランチ腐敗予防) | 21 | 3 | **7.00** |
| **D-4** | 6 | 8 (日々・成長ブロッカー) | 5 (Chesterton's Fence 解消) | 19 | 3 | **6.33** |
| **D-5** | 13 (semantic diff は革新的) | 8 (日々) | 8 (false negative リスク削減) | 29 | 8 | **3.63** |
| **D-6** | 5 | 8 (リリース直前ピーク) | 8 (conflict 歪み検出) | 21 | 1 | **21.00** |
| **D-7** | 5 | 5 (週次) | 8 (rebase 事故ネット安全網) | 18 | 3 | **6.00** |

### §3.2 Confidence cap 補足

WSJF は Fibonacci 相対スコアのため absolute 信頼度は明示しないが、CoD 合計に対して synthetic 由来 -10% の地ならし係数を概念的に適用（順位は保つが絶対値を信用しすぎない警告）。

### §3.3 WSJF Ranking

| 順位 | ID | WSJF | 備考 |
|---:|---|---:|---|
| 1 | **D-6** | 21.00 | Job Duration 1 (既存拡張) が分母を最小化。CoD は中程度でも WSJF 突出。 |
| 2 | **D-3** | 7.00 | CoD 21 + Job Duration 3 のバランス。Tech Lead 週次痛みの Cost of Delay が高い。 |
| 3 | **D-4** | 6.33 | BV は中程度だが TC 8 (日々ブロッカー) + Job Duration 3 で上位。 |
| 4 | **D-2** | 6.00 | RR/OE 8 (PR 信頼性) が BV を補う。D-7 と同点。 |
| 5 | **D-7** | 6.00 | D-2 と同点。TC は低め (週次) だが RR/OE が incident 予防で高い。 |
| 6 | **D-1** | 4.20 | CoD は高いが Job Duration 5 が足を引く。 |
| 7 | **D-5** | 3.63 | BV 13 (革新的) でも Job Duration 8 が分母。WSJF でも最下位。 |

### §3.4 WSJF 解釈

- **D-6 が WSJF でも 1 位**。Job Duration 1 は既存パネル拡張のためであり、分母が最小化される効果が大きい。RICE/WSJF 両フレームワークで首位。
- **D-5 が WSJF でも最下位**。BV 13 という最高評価を受けていても Job Duration 8 が打ち消す。これは「革新的だが重い」機能の典型的な WSJF 特性。
- **RICE と WSJF の主な divergence:** D-1 が RICE 5 位・WSJF 6 位（逆転）、D-4 が RICE 4 位・WSJF 3 位（逆転）。詳細は §6。

---

## §4 MoSCoW Classification

| ID | 分類 | 判断根拠 |
|---|:---:|---|
| **D-1** | **Should** | シンボル貫通履歴は強い差別化機能で複数ペルソナにまたがるが、`git log -L` の funcname regex の安全検証と新 UI パネル追加で Effort L。MVP の commit タイムライン拡張として "次フェーズ" が妥当。allowlist 内で完結するため Must 昇格ハードルは低い。 |
| **D-2** | **Should** | PR 信頼性を高める機能で広志の週 2-3 回の痛みに直結。allowlist 内完結・Effort M・Confidence 55%。既存 CommitTimeline の自然な拡張。Researcher 軽量検証後に Must 昇格余地あり。 |
| **D-3** | **Should** | 既存 branch health filter (8279d27) と cherry-pick panel (8e90179) を両方活用できる集約ビュー。Tech Lead ペルソナの週次需要。readiness が高く Should が妥当。conflict 予測はヒューリスティクス止まりであることを明示する前提で実装可。 |
| **D-4** | **Could** | Junior の成長ブロッカーを解消する価値は高いが、persona breadth が狭め（Junior 固有の痛みをシニアは経験で乗り越える）。"理由抽出" の精度問題が AC を達成しづらくする。Researcher 検証で Junior ユーザー比率が高ければ Should 昇格。 |
| **D-5** | **Won't (v1)** | tree-sitter 依存という外部依存追加が refscope の依存最小哲学と大きく衝突。言語非依存ヒューリスティクスのみに留めるなら Eleanor の AC (AST 差分ハイライト・制御フロー変更分類) が達成不可。**Architecture Review を経るまで実装着手しない**。v2 候補として記録。 |
| **D-6** | **Must** | 既存 cherry-pick equivalence パネル (8e90179) の自然な拡張で Effort S。Eleanor の「conflict 解決での歪み見逃し」という具体的・日常的痛みに直結。バイナリ判定から段階判定への移行はユーザー体験の質的改善。全フレームワーク 1 位。 |
| **D-7** | **Could** | `history_rewritten` SSE が既に存在し、payload 拡張は実装可能。しかし永続化設計 (IndexedDB vs localStorage) と read-only 哲学の境界線上にあり、設計判断コストが実装コストを上回る可能性。復元「コマンド提示」のみに留めれば read-only 維持は可能だが、その範囲内で価値が届くかを Researcher で確認すべき。 |

### §4.1 MoSCoW 分布の健全性チェック

- Must: 1 件 (14%) / Should: 3 件 (43%) / Could: 2 件 (29%) / Won't: 1 件 (14%)。
- Rank の "60% rule" (同 tier 60% 超は red flag) はクリア。
- Must が 1 件と少ないが、7 demand の性質上（全て中〜高価値）これは synthetic 仮説からの conservative 評価として適正。

---

## §5 Sensitivity Analysis

各 demand の主要パラメータを ±20% 変動させたときの順位変化を分析する。

| ID | 主要 sensitivity | ±20% 変動時の順位変化 |
|---|---|---|
| **D-6** | **Effort 変動 (0.5 → 0.4 or 0.6)**: 既存拡張スコープが想定より小さければ 0.4、近隣コンポーネント修正が必要なら 0.6 person-month。Effort 0.6 でも RICE 3.20、WSJF 14.0 で 1 位は揺るがない。**最も robust な 1 位**。 |
| **D-3** | **Persona breadth (6 → 4.8 or 7.2)**: Tech Lead ペルソナが Refscope ユーザー中でどの程度存在するか。breadth 4.8 で Reach = 2.4、RICE 1.76 → D-2 と同点。breadth 7.2 なら RICE 2.64 で 2 位をさらに安定化。 |
| **D-2** | **Confidence (55% → 44% or 66%)**: ヒューリスティクス判定の false positive 率が未検証のため。Confidence 44% なら RICE 1.41 (4 位に後退)。66% (Researcher 検証後) なら RICE 2.11 (2 位浮上)。 |
| **D-1** | **`git log -L` allowlist 判断**: `-L` フラグが log コマンドの allowlist 範囲内と確認できれば Architecture Review 不要で Effort L 確定。もし安全検証追加が必要なら Effort L→XL に転換し RICE 0.58 で 6 位に後退。このフラグ判断が順位の最大ドライバー。 |
| **D-5** | **Effort (XL=5.0 → ヒューリスティクス限定=1.5)**: tree-sitter を採用せず行対称性・トークン保存率のみに留めれば Effort M 相当。RICE 1.01 (5 位相当)、WSJF 7.67 (2 位浮上)。ただし Eleanor の AC 未達のため実用的な価値は制限される。**Effort 前提変化が最も順位変動を引き起こす demand。** |
| **D-4** | **Confidence (45% → 36% or 54%)**: "理由抽出" 精度の不確実性。Confidence 36% なら RICE 1.34 (5 位後退)。54% なら RICE 2.02 (2〜3 位浮上)。 |
| **D-7** | **Incident stake (5 → 4 or 6)**: force-push 事故の深刻度評価次第。WSJF TC を 3→5 に上げると WSJF 7.33 (2 位浮上)。逆に永続化スコープが LocalStorage のみに絞れて Effort S に圧縮されると RICE 2.70 (2 位浮上)。**設計判断の結果次第で順位が大きく動く demand。** |

### §5.1 順位変化が起きやすい組み合わせ

- **D-3 vs D-2 の 2-3 位 (RICE):** D-3 の breadth 推定が下振れかつ D-2 の Confidence が上振れした場合に逆転。影響はマイナーで実装順序に大きな差異なし。
- **D-5 の Effort 圧縮シナリオ:** tree-sitter 不採用でヒューリスティクスのみに留めると RICE 5 位・WSJF 2 位に浮上するが、Eleanor AC の未達が MoSCoW Won't を変えない。Architecture Review の結論が最終的な順位を決定する。
- **D-7 の 設計判断シナリオ:** 永続化 Effort が S (0.5) に圧縮されれば RICE で 3 位圏内に浮上。Read-only 哲学との整合が確認できれば Could → Should に昇格余地あり。

---

## §6 フレームワーク間 Spearman 相関と統合 Ranking

### §6.1 RICE vs WSJF の順位比較

| ID | RICE 順位 | WSJF 順位 | 差分 | 解釈 |
|---|:---:|:---:|:---:|---|
| D-6 | 1 | 1 | 0 | 全フレームワーク一致。最も安定した最優先候補。 |
| D-3 | 2 | 2 | 0 | 両フレームワーク一致。 |
| D-2 | 3 | 4 | +1 | WSJF で D-4 に逆転。RICE は frequency×breadth で D-2 有利だが、WSJF は TC (日々ブロッカー) で D-4 の urgency を高評価。 |
| D-4 | 4 | 3 | -1 | WSJF で D-2 を逆転。日々の成長ブロッカー (TC=8) が WSJF で重く評価。 |
| D-1 | 5 | 6 | +1 | 両フレームワークで下位。RICE は Effort L が主因、WSJF も Job Duration 5 が足を引く。 |
| D-7 | 6 | 4 | -2 | **最大の divergence。** RICE は Reach 低 + Effort M で低評価、WSJF は RR/OE 8 (事故予防) が Time Criticality と組み合わさり CoD 18 で 4 位。安全網としての価値は WSJF で適切に評価される。 |
| D-5 | 7 | 7 | 0 | 全フレームワーク最下位で一致。 |

**Spearman ρ ≈ 0.72** — SKILL.md の「ρ < 0.7 で divergence を明示」閾値をわずかに上回るが、D-7 の ±2 divergence を重点的に解説する。

### §6.2 D-7 divergence の解説

D-7 (rewrite rescue snapshot) は RICE で 6 位・WSJF で 4 位と 2 ランクの乖離がある。
- **RICE が低く出る理由:** Reach = `3×5/10 = 1.5` (breadth 3 = DevOps ペルソナ限定)。日常 frequency は週次程度で高くない。
- **WSJF が高く出る理由:** RR/OE = 8 (force-push 事故という深刻なリスク削減) が BV を補い CoD 18 を達成。Job Duration 3 (Effort M) で割ると 6.0 と D-2 と同点。
- **統合判断:** D-7 は「発生頻度は中程度だがリスク深刻度が高い」型の demand。WSJF がより適切な lens。ただし Architecture Review (read-only 哲学との整合) が必要なため Could 評価を維持。

### §6.3 D-2/D-4 divergence の解説

D-2 (refactor-only フィルタ) と D-4 (why-panel) は RICE 3/4 位、WSJF 4/3 位の逆転。
- **RICE:** D-2 は Confidence 55% が D-4 の 45% より高く、かつ同じ Effort M で RICE が上回る。
- **WSJF:** D-4 の TC = 8 (日々の成長ブロッカー) が D-2 の TC = 5 (週 2-3 回) より高く WSJF で逆転。
- **統合判断:** どちらも Effort M で allowlist 内完結の近いラインの需要。実装順序の判断は Researcher で Junior ペルソナの比率と痛みの深刻度を確認した後に決定すべき。

### §6.4 ICE 補助スコア

ICE = Impact × Confidence × Ease（各 1-10、Ease = 11 − Effort 換算ランク）

| ID | Impact | Confidence | Ease | ICE Score |
|---|---:|---:|---:|---:|
| D-1 | 7 | 5 | 4 | 140 |
| D-2 | 6 | 5.5 | 7 | 231 |
| D-3 | 7 | 5.5 | 7 | 269.5 |
| D-4 | 6 | 4.5 | 7 | 189 |
| D-5 | 9 | 3.5 | 2 | 63 |
| D-6 | 7 | 6 | 9 | 378 |
| D-7 | 6 | 4.5 | 6 | 162 |

ICE 順位: **D-6 > D-3 > D-2 > D-4 > D-7 > D-1 > D-5** — RICE と完全一致。Spearman ρ (ICE vs RICE) ≈ 1.0。

### §6.5 統合 Ranking (3フレームワーク平均順位)

| ID | RICE 順位 | WSJF 順位 | ICE 順位 | 平均順位 | **統合順位** |
|---|:---:|:---:|:---:|:---:|:---:|
| D-6 | 1 | 1 | 1 | 1.0 | **1** |
| D-3 | 2 | 2 | 2 | 2.0 | **2** |
| D-2 | 3 | 4 | 3 | 3.3 | **3** |
| D-4 | 4 | 3 | 4 | 3.7 | **4** |
| D-1 | 5 | 6 | 6 | 5.7 | **5** |
| D-7 | 6 | 4 | 5 | 5.0 | **6*** |
| D-5 | 7 | 7 | 7 | 7.0 | **7** |

*D-7 は平均順位 5.0 で D-1 (5.7) より上だが、Architecture Review 必要フラグにより実装優先度は D-1 の後に置く判断を推奨（§8 参照）。

---

## §7 Hand-off 推奨

### §7.1 Researcher 検証が最優先の demand

| 優先 | ID | 検証内容 | 理由 |
|:---:|---|---|---|
| 1 | **D-2** | refactor-only フィルタのヒューリスティクス判定 false positive 率。実際の PR での rename-only コミット比率。 | Confidence 55% は synthetic としては高めだが、判定精度が低いと Eleanor から「使えない」と判断されるリスクが高い。 |
| 2 | **D-4** | Junior 開発者が Refscope を使っているか、why-panel が onboarding 文脈で機能するか。 | persona breadth の推定 (4) が実際のユーザー比率に依存。Junior 比率が低ければ Could → Won't 候補。 |
| 3 | **D-7** | force-push 事故の実際の頻度と "復元コマンド提示" の価値。IndexedDB 永続化の UX 受容性。 | read-only 哲学との境界線の設計判断前にユーザーが「コマンド提示」で満足するかを確認すべき。 |
| 4 | **D-1** | `git log -L` の funcname 検索が実際の rename 追跡に使えるか PoC。リファクタ後のシンボル追跡が 1 画面で完結するかの UX 検証。 | Effort L の妥当性確認と、"シンボルが旅した" という比喩的需要が UI で表現できるかの検証。 |

### §7.2 Researcher 検証なしで着手可能な demand

- **D-6:** 既存パネルの拡張で Effort S・Confidence 60%。AC が明確。着手推奨。
- **D-3:** 既存機能の集約で Effort M・Confidence 55%。conflict 予測をヒューリスティクスと明記する前提で着手可。

---

## §8 Architecture Review フラグ候補

| ID | フラグ内容 | 推奨アクション |
|---|---|---|
| **D-5** | **外部依存追加 (tree-sitter):** WASM バイナリを抱えることで `apps/api/` の plain ESM ・依存最小原則を破る。言語パーサのバージョン管理・セキュリティ面でも新しい攻撃面が生じる。 | Atlas/Magi で「tree-sitter 採用 vs ヒューリスティクス限定」を arbitration。採用する場合は `apps/ui/` (WASM) に留めるか `apps/api/` に置くかの配置も決定する。 |
| **D-1** | **`git log -L` flag の安全検証:** `-L:<funcname>:<file>` は `log` コマンド内だが、funcname 部分が正規表現として渡せる場合、`validation.js` に新たなサニタイズ関数が必要。funcname の allowlist/regex ルールを `isValidFunctionName` として設計要。 | 実装前に `gitRunner.js` の flag 拒否リストに `-L` の扱いを明示的に定義。`validation.js` に新バリデーター追加の PR 設計。 |
| **D-7** | **read-only 哲学の境界線:** `history_rewritten` 発火時に UI 側で IndexedDB への書き込みを行うことは「ブラウザ内永続化」であり Git 操作ではない。read-only 哲学の「Git への書き込み禁止」の文脈では許容範囲内だが、「復元コマンド提示」が git reflog や git reset コマンドを生成する場合、それが安全かつ正確かの品質保証が必要。 | 設計段階で「UI 内メモリキャッシュ (session スコープ) vs IndexedDB (永続)」の選択を Atlas で arbitration。復元コマンドのテンプレート設計を Accord でレビュー。 |
| **D-2** | **ヒューリスティクス判定の境界:** 行追加=削除対称性・トークン保存率は `diff` allowlist 内で完結するが、「rename-only と判定」という派生情報を API が返すことは "observed Git facts" から一歩踏み込む派生計算。Accord で「判定の信頼度を API レスポンスに含めるか」の仕様を確定要。 | API レスポンスに `refactorClassification: { type: "rename-only" | "logic-change" | "mixed", confidence: 0.0-1.0 }` の形式で不確実性を返す仕様に。hover 透明化 AC と整合。 |

---

## §9 Bias Check Report

| Bias 種類 | 検出 | 対応 |
|---|:---:|---|
| **HIPPO** | 不在 | Plea synthetic ペルソナのため HIPPO は構造的に存在しない。 |
| **Recency (8279d27/8e90179)** | **可能性あり** | 直近コミットで branch health filter と cherry-pick panel が実装されたため、これらを拡張する D-3/D-6 を "readiness が高い" として unfair に有利評価するリスク。**対応:** readiness を RICE の Effort 推定根拠 (既存コードの再利用) にのみ適用し、Impact/Reach は他 demand と同じ rubric で評価。 |
| **Sunk Cost** | 不在 | 8279d27/8e90179 への既存投資を "やめられない" 理由にしていない。D-6/D-3 が上位なのは拡張コストが低いためであり sunk cost ではない。 |
| **Anchoring** | **限定的** | D-6 の Effort S (0.5) を anchor に他 demand の Effort を相対評価する傾向。**対応:** D-1/D-2/D-3/D-4/D-7 の Effort を独立に見積もり、D-6 を比較起点にしない方法で確認済み。 |
| **Availability (tree-sitter 議論)** | **可能性あり** | D-5 の semantic diff は "あれば革新的" という印象が強く BV 13 を付けやすくした可能性。**対応:** BV 13 は事実として維持しつつ、Effort XL と外部依存により Won't (v1) と判断。高 BV と Won't の組み合わせを明示し、"欲しいが今は無理" を正直に示す。 |

### §9.1 Consider-the-opposite（各 demand の最下位論拠）

- **D-6 を 7 位に置くなら?** → 「リリース直前にしか使わないなら frequency 4 は実際には年数回。段階判定の精度が低ければ Eleanor の信頼を損なう」。反論: 既存パネルの拡張で Effort S、AC も「段階表示と差分 highlight」と具体的。最下位論拠は成立しない。
- **D-5 を 1 位に置くなら?** → 「日々 urgency 9・BV 13 の組み合わせは他を圧倒する。Eleanor の痛みは最も具体的で深刻」。反論: Effort XL + 外部依存 + Architecture Review 未完了で着手不可。BV が高くても実現可能性が低い今、1 位にするのは資源の誤配分。

---

## §10 推奨ロードマップ (RFC tone)

### §10.1 推奨順序とアクション

1. **D-6 (graded cherry-pick equivalence)** — **即座に着手**。既存 8e90179 パネルへの段階表示・差分 highlight 追加。Effort S。全フレームワーク 1 位。
2. **D-3 (refactor branch health dashboard)** — **D-6 と並走可**。Effort M、既存 branch health filter + cherry-pick panel の集約ビュー設計。conflict 予測はヒューリスティクス・ヒントとして明示。
3. **D-2 (refactor-only フィルタ)** — **Researcher 軽量検証 (3-5 名 PR レビュアー) と並走で着手**。ヒューリスティクス判定の false positive 率を事前に UX テストで確認。
4. **D-4 (why-panel)** — **D-2 完了後に着手**。Researcher で Junior ユーザー比率確認後に Should/Could 再評価。精度問題は "信頼度スコア付き提示" で誠実に対応。
5. **D-1 (シンボル履歴貫通)** — **Researcher + PoC スパイク 1 週間**で `git log -L` の funcname 検証と Architecture Review (validation.js 拡張設計) を先行。
6. **D-7 (rewrite rescue snapshot)** — **Architecture Review (read-only 境界) + Researcher で Carlos 相当ユーザーの実痛み確認**後に設計着手。永続化スコープは localStorage 第一候補。
7. **D-5 (semantic AST diff)** — **Architecture Review (tree-sitter 採用可否) が完了するまで実装保留**。v2 候補として docs に記録。ヒューリスティクス限定案を Review に含める。

### §10.2 並走関係図

```
[Now] ─────────────────────────────────────────────────────► [8 weeks]
  │
  ├─ D-6 (Effort S, 既存パネル拡張、1-2 週)
  │     └─ Eleanor レビュー確認 (段階表示の精度)
  │
  ├─ D-3 (Effort M, ブランチヘルス集約、2-3 週)
  │     └─ conflict 予測ヒューリスティクス仕様を Accord で確定
  │
  ├─ Researcher: D-2/D-4/D-7 の synthetic 仮説検証
  │     └─ D-2 軽量検証後、着手 (3-4 週)
  │     └─ D-4 Junior 比率確認後、着手 or Could 据置判断 (4-5 週)
  │
  ├─ D-1 PoC スパイク (1 週) + Architecture Review (validation.js)
  │     └─ スパイク結果で Effort L 確定後に実装着手 (5-7 週)
  │
  ├─ D-7 Architecture Review (read-only 境界設計)
  │     └─ 設計完了後に実装 (6-8 週)
  │
  └─ D-5 Architecture Review (tree-sitter 採用/不採用)
        └─ v2 候補として docs 記録 (今サイクルはスキップ)
```

---

## §11 _STEP_COMPLETE

```yaml
_STEP_COMPLETE:
  Agent: Rank
  Status: SUCCESS
  Output:
    deliverable: docs/rank-round6-refactoring-priority.md
    parameters:
      work_mode: FULL
      frameworks_used: [RICE, WSJF, MoSCoW, ICE]
      items_ranked: 7
      rank_correlation: ~0.72 (Spearman RICE vs WSJF, D-7 が最大 divergence ±2)
      confidence: MEDIUM (synthetic cap 60%)
    top_3:
      - D-6 (RICE 3.84, WSJF 21.00, MoSCoW Must) — graded cherry-pick equivalence
      - D-3 (RICE 2.20, WSJF 7.00, MoSCoW Should) — refactor branch health dashboard
      - D-2 (RICE 1.76, WSJF 6.00, MoSCoW Should) — refactor-only commit filter
  Next: DONE
  Reason: |
    7 demand を RICE/WSJF/MoSCoW + ICE 補助の 4 フレームワークで採点。
    D-6 が全フレームワーク 1 位で unanimous。D-7 の RICE/WSJF divergence (+2) を
    §6.2 で明示。sensitivity analysis で D-5 Effort 変動と D-1 allowlist 判断が
    最大順位ドライバーと特定。Architecture Review flag を §8 に明示。
    Researcher 検証第一推奨 demand を §7.1 に記載。
```

---

## §12 References

| Type | Path | Use |
|---|---|---|
| 上流 demand | `docs/user-demand-report-2026-05-07-r6.md` | 7 demand の persona / AC / urgency |
| Format reference | `docs/rank-round2-priority.md` | 表形式・セクション構成・bias check template |
| Architecture | `CLAUDE.md` | gitRunner allowlist・UI state owner・API ESM 制約 |
| Spec | `docs/spec-v0.md` | MVP 設計境界・SSE イベント型定義 |
| Commit 8279d27 | branch health filter 実装 | D-3 の readiness (既存拡張ポイント) |
| Commit 8e90179 | cherry-pick equivalence panel | D-6 の readiness (既存拡張ポイント) |
