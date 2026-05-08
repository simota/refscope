# Researcher Calibration Plan — Round 7 Designer-Lens Demands

> 2026-05-08 / Researcher / Phase 2 必須ゲート (R7-6 mitigation)
>
> **Purpose:** Plea round 7 の 8 demand × 6 ペルソナはすべて synthetic hypothesis (Magi verdict R7-6 で Severity H 登録)。Phase 2 (Lens taxonomy 統合 + DetailPanel typography) 着手前に、実在するデザイナー 1-2 名のインタビューで仮説の支持/不支持を確認する。
>
> **Source:** `docs/user-demand-report-2026-05-08-r7-designer.md` (Plea), `docs/magi-verdict-2026-05-08-r7-designer.md` (Magi)
>
> **Stop condition (early termination):**
> - 仮説の >50% が "Refuted" → Phase 2 を hold、Plea round 8 を再起動 (R7-retreat-1)
> - 仮説の >70% が "Supported" → Phase 2 着手承認、Atlas hand-off へ
> - 中間 (50-70% supported) → Magi 再招集で部分採用範囲を再 deliberation

---

## 1. Research Questions (RQ)

優先順序つき。RQ1-3 が Phase 2 の go/no-go を決める critical path、RQ4-5 は実装方針を refine する secondary。

| ID | Research Question | Critical for | Priority |
|----|-------------------|--------------|----------|
| **RQ1** | デザイナーが Refscope を初見で触る時、Lens 11+ の認知負荷は実際に "落ち着かない / 読めない" として現れるか? | Phase 2 全体 (Cluster A 着手判断) | **Critical** |
| **RQ2** | "観測 vs 解釈" の brand axis は実装層 (typography rhythm / microcopy / status badge / motion) で perceptible か? | D2 + D5 + D6 の効果検証 | **Critical** |
| **RQ3** | デザイナー contributor は "Refscope は engineer-first" の positioning に違和感を持つか? それとも selective adoption (= designer pain は救うが first-class 化はしない) で十分か? | P1 verdict 検証 | **Critical** |
| **RQ4** | tokens.json と Figma variables の drift は **実際に** デザイナーの daily workflow をブロックするか、それとも quarterly audit で吸収可能か? | D3 投資判断 (Phase 3 影響) | High |
| **RQ5** | デザイナー間で "観測 vs 解釈" 分離原則は **理解可能** か? それとも product-level 内部ロジックで designer には伝わらないか? | D6 microcopy 改訂効果検証 | Medium |

---

## 2. Recruitment Criteria

### Sample size

- **目標 N = 2** (内部 1 + 外部 1 を理想)。
- **最低 N = 1** (内部 OR 外部いずれか)。
- **上限 N = 4** (saturation / time budget の天井; 5 名以上は本フェーズの判断材料としてオーバースペック)。

### 必須要件 (knockout criteria)

| # | Criterion | 確認方法 |
|---|-----------|---------|
| K1 | 直近 2 年で web product UI を 1 個以上 ship した実務経験 | LinkedIn / portfolio review |
| K2 | Figma を主要 design tool として日次使用 | recruitment screener (Yes/No) |
| K3 | Git の基本操作 (clone / branch / commit / push) を理解、ただし internals (rebase / reflog / GPG) は問わない | screener: "Have you used `git rebase` in the last 30 days?" を **No** で回答する候補を半数は含める (Jin persona 再現のため) |
| K4 | Refscope に過去 6 ヶ月で触れた経験が **ない** (priming 回避) | direct ask |

### 推奨多様性 (target sampling)

可能であれば以下のいずれかを最低 1 名カバー:

- **Persona resonance**: Mira (Senior Product / Linear-comparison) または Devi (Design System Lead) のいずれかに resonate する候補
- **Accessibility lens**: Saoirse 軸検証として、 reduced-motion を OS で常用するか、過去 a11y audit を実施した経験を持つ候補 (1 名で十分、必須ではない)
- **Boundary persona**: Iris (LP custodian) 軸検証として、自社の OSS / SaaS の LP / OG / README hero を担当した経験を持つ候補 (任意)

### 補償

- 外部候補: 1 時間 90-120 分セッションに対して市場相場 (例: Tokyo $150-250 USD / 米国 $200-350 USD 相当)
- 内部候補: 業務時間内、追加補償なし

---

## 3. Interview Method & Format

### Type
**Semi-structured remote interview, 75 分**, screen share + think-aloud protocol。

### Materials
- 共有用 Refscope local instance (allowlist に検証用 dummy repo を 1 つ登録、開発履歴のある実 OSS repo を推奨 — 例: `react`, `vue`, `astro` など fork)
- Figma file mockup (なし — Refscope の現状 UI そのまま)
- 録画 (オプトイン、文字起こしは Otter / Whisper 等で post-hoc)

### Structure (75 min)

| 区間 | 時間 | 目的 | RQ |
|---|---|---|---|
| 0. Intro & consent | 5 min | NDA / 録画同意 / "right answer はない" 強調 | — |
| 1. Background calibration | 5 min | 経歴 / Git 慣熟度 / Figma usage frequency | knockout 確認 |
| 2. Cold first impression (priming-free) | 10 min | 「Refscope を初見で触ってください、何でも声に出して」think-aloud | RQ1 |
| 3. Lens navigation task | 10 min | 「DriftLens / OutboxLens / DigestLens / HotspotLens を順に見てください、各 Lens が何を見せていると思うか教えてください」 | RQ1, RQ5 |
| 4. Observation vs interpretation prompt | 10 min | rewrite alert を発生させ、「画面上のどれが観測事実で、どれが推測ですか?」を聞く。文字を見せず読み上げるパターンも 1 回試す | RQ2, RQ5 |
| 5. Status badge surface check | 5 min | force-pushed / rewritten / signature unknown badge を見せ、文字情報なしでアイコン+色だけから意味を推測してもらう | RQ2 |
| 6. Positioning question | 10 min | 「あなたが Refscope の design refresh を任されたら、最初に変えるのはどこ?」 → 「次に、もし Refscope が 'デザイナーも対象 user' だと公言したら、どう変わるべき?」 | RQ3 |
| 7. Token / Figma workflow | 10 min | tokens.json と Figma variables を並べ、「実務で同期は手動 / 自動 / 監査どれで運用していますか?」 | RQ4 |
| 8. Wrap-up / unprompted reflection | 5 min | 「今日触って一番印象に残った friction は?」 (open-ended、demand 仮説外も拾う) | all |
| 9. Researcher debrief notes | 5 min | (interview 直後の自記録、対象者なし) | analysis prep |

### Facilitation rules
- **Leading 禁止**: 「これは落ち着かないですよね?」のような誘導をしない。代わりに「見ていて何を感じますか?」
- **Plea ペルソナ名は出さない**: Mira / Jin 等の名前で対比しない
- **Demand 仮説そのものを開示しない**: 候補者が自由連想して仮説に到達するか、それとも別の friction を出すかが重要
- **沈黙を許容**: 5 秒以上の沈黙は介入せず待つ (think-aloud の rich data ポイント)

---

## 4. Persona-Claim ↔ Interview Question Matrix

各 Plea persona の中核 claim を 1 つずつ、interview 内のどの prompt で検証するかをマップ。Matrix は coverage check 用 — 全 claim が最低 1 prompt で testable であることを保証。

| Persona | Plea claim | Tested by | Expected signal (Supported) | Expected signal (Refuted) |
|---|---|---|---|---|
| **Mira** | "Lens 切替で自分の現在地を見失う、空間として読めない" | §3 Lens navigation | 切替後 "あれ、今どこにいるんだろう" / "前の Lens は何だっけ" 系の発話 ≥1 件 / Lens 名と機能の照合に 5 秒以上 | スムーズに 4 Lens を navigate、現在地語彙に困らない |
| **Mira** | "DetailPanel の情報が同じ重みで降ってくる" | §4 Observation vs interpretation prompt | 「どれを先に読めばいいかわからない」 / 視線が anchor を失う think-aloud | "primary は hash、次に message" と層を即答 |
| **Devi** | "tokens.json と Figma variables が一致してる証拠がない" | §7 Token / Figma workflow | "drift は実際あって困る" / "quarterly audit してる" の自発発言 | "気にしない / Figma 側は手動で十分 / drift しても気づける" |
| **Devi** | "LensHeader を毎回手書きで再発明している" | §3 Lens navigation の派生質問 | 「これ component primitive ありますよね?」「padding が Lens ごとに違って気になる」 | header の差異に気づかない / "気にならない" |
| **Saoirse** | "calm by default は『多数派にとっての calm』、reduced-motion でも pulse が見える" | §2 Cold first impression + screen reader / reduced-motion 候補のみ §5 status badge | reduced-motion 環境で motion の残存を指摘、forced-colors mode で badge の意味喪失を体感 | reduced-motion を使わない / badge は色なしでも問題なし |
| **Theo** | "観測か推測か文体だけでは区別できない" | §4 Observation vs interpretation prompt (読み上げモード含む) | 文字を見せず読み上げると 50% 以上の string で観測/推測を誤認 | 文字なしでも 80% 以上正答 |
| **Iris** | "LP / OG / Figma Make export と product UI の drift を自分では観測できない" | §7 Token / Figma workflow の追加質問 | "screenshot 古くなって困った経験ある" / "OG は半年放置してる" | "drift しても気づけるし運用で吸収できてる" |
| **Jin** | "Lens 名 metaphor が onboarding なしに読み取れない" | §3 Lens navigation | 各 Lens 名を見て "何を見せるか想像つかない" の発話 ≥3 件 / glossary を欲しがる | Lens 名から機能を 50% 以上正答推測 |

### Coverage gap notes

- **Mira の "spatial map" 提案**: 直接の selection prompt は §3 のみ。fallback として §6 positioning question で「Lens を再構成するなら?」を open-ended で拾う。
- **Iris の "境界外シェア" 仮説**: 直接の prompt がない (LP custodian は recruitment 上ニッチ)。§8 wrap-up で "screenshot を Slack / Discord でシェアした経験" を 1 question で軽くタッチ。
- **AI agent persona 再来 (round 5 ARI 系)**: 本 round では recruitment 範囲外。 RQ3 positioning 質問で MCP / API surface 要望が自発的に出るかは monitor。

---

## 5. Analysis Plan

### Coding rubric (per claim)

各 claim に対し、以下の 5 段階で coding する。

| Code | 定義 | 集計 |
|---|---|---|
| **Strongly Supported** | 候補者が Plea claim と同じ pain を **自発的に** (誘導なしに) 言語化 | `supported` |
| **Supported** | 誘導質問への yes 回答 + 1 件以上の具体例 | `supported` |
| **Partial** | yes だが具体例なし / no だが類似 friction は別経路で surface | `partial` |
| **Refuted** | 具体的な反証 ("私はそう感じない、なぜなら…") | `refuted` |
| **Inconclusive** | 質問が届かなかった / 候補者の expertise 範囲外 | `inconclusive` |

### Aggregation

- **Per-claim**: N=2 で両者 Supported → "Supported by interviews"。1 名 Supported + 1 名 Partial → "Partial". 1 名以上 Refuted → "Refuted by interviews".
- **Per-cluster** (Cluster A / B / C / D):
  - Cluster A (taxonomy) は 4 claim (Mira×2 / Devi×1 / Jin×1) — 過半数 Supported で **Cluster Go**
  - Cluster B (a11y) は 1 claim (Saoirse) — 1 名でも Supported なら Phase 1 結果と整合 (もう実装済み、検証は事後 retro)
  - Cluster C (typography + microcopy) は 2 claim (Mira / Theo) — 過半数 Supported で Phase 2 内 D2 着手
  - Cluster D (token + screenshot) は 2 claim (Devi / Iris) — Devi Supported で Phase 3 D3 着手、Iris Refuted で D7 silent DEFER 維持確定

### Decision matrix (Stop condition への mapping)

| Aggregate result | Action | 理由 |
|---|---|---|
| **>70% Supported** (8 claim 中 6+ Supported) | Phase 2 着手 → Atlas hand-off | Magi verdict P3 stop condition 満たす |
| **50-70% Supported** | Magi 再招集 (部分採用範囲を再 deliberation) | Mixed signal、cluster 単位の judgement を要する |
| **<50% Supported** | Phase 2 hold、R7-retreat-1 trigger、Plea round 8 起動 | Synthetic 仮説と現実の乖離が大きい |

### Negative findings handling

仮説外で surface した friction は **必ず separate file** で記録 (`docs/researcher-r7-emergent-findings.md` 等)。これらは新たな Plea round の seed 材料で、本 audit の合否判定には混ぜない。

### Bias mitigation

- **Confirmation bias**: coding は 2 名 reviewer で行うことが理想 (実 N が小さいため)。1 名 coder の場合、coding 後 24 時間空けて再 review (recall bias 防止)
- **Anchoring**: claim 順序を candidate 間で randomize (§3 / §4 / §5 / §6 / §7 のうち §3 を先頭にしない candidate を 1 名は配置)
- **Sycophancy**: 候補者が "好かれたい" バイアスから supported に倒す可能性 — facilitator が中立姿勢を強調 + 反証 prompt ("逆にここは大丈夫だな、と思った場所は?") を挿入

---

## 6. Deliverable Format

セッション完了後 1 週間以内に以下を生成。

### 6.1 Per-candidate transcript summary
- File: `docs/researcher-r7-candidate-{N}-transcript.md` (録画は外部保管、本ファイルには直接 quote のみ)
- 構造: 各 RQ ごとに supporting / refuting quotes + 5 段階 coding 判定

### 6.2 Aggregate audit report
- File: `docs/researcher-r7-calibration-result.md`
- 構造:
  - Executive summary (1 段落): Cluster ごとの Supported / Refuted / Mixed 判定
  - Per-claim aggregate table (8 row × N candidates)
  - Phase 2 go/no-go recommendation (Decision matrix と整合)
  - Emergent findings (本 audit の合否とは分離)
  - Magi 再招集が必要な open question リスト

### 6.3 Magi handoff prompt (paste-ready)
- もし aggregate が 50-70% Mixed の場合、Magi 再 deliberation 用 prompt を生成
- format: `references/handoffs.md` 互換の `RESEARCHER_TO_MAGI` token

---

## 7. Timeline & Owner

| Step | Owner | Estimated time | Trigger |
|---|---|---|---|
| Recruit candidates | User (内部) + 任意で external recruiter | 1-2 週間 | この plan 承認後すぐ |
| Pilot 1 session (内部 1 名) | Researcher facilitator | 75 min + 30 min debrief | recruit 完了後 |
| Refine guide based on pilot | Researcher | 30 min | pilot 直後 |
| Run 1-3 additional sessions | Researcher facilitator | 75 min × N + post-session note 30 min × N | refine 完了後 |
| Aggregate analysis | Researcher | 4 時間 | 全セッション完了後 |
| Hand off to Magi or Atlas | Researcher → next agent | — | aggregate 完了後 |

**Total elapsed**: 2-4 週間 (recruitment 律速)。本 plan が "Phase 2 開始前必須ゲート" であるため、recruitment 開始タイミングが Phase 2 着手日を直接決定する。

---

## 8. Risks (本 calibration plan 自体の risk)

| ID | Risk | Mitigation |
|---|---|---|
| RC-1 | N=1 で運用、1 名の意見が exaggerated weight を持つ | aggregate 判定を "1 名は Mixed signal" として扱う、1 名 Refuted は確定とせず Magi 再招集ゲート |
| RC-2 | candidate が Refscope を見て "面白い" と感じ、 sycophancy で supported に倒す | facilitator が反証 prompt 挿入、coding で "自発的か誘導か" を区別 |
| RC-3 | Saoirse claim (a11y) は recruitment 上カバー困難 (impairment を持つ候補者の招集は別 protocol) | Phase 1 で D5 は実装済み、本 calibration では事後 retro として 1 candidate に reduced-motion ON で軽く確認するに留める。深いカバーは別 round の専用 audit |
| RC-4 | "engineer-first / designer selective" の P1 verdict は positioning level、1-2 名のデザイナーで決めるには weak | RQ3 は **brand 級判断の echo check** であり最終判定ではない。デザイナーが engineer-first に違和感を持つかどうかを情報として記録、Magi に戻す |
| RC-5 | Plea ペルソナ名 (Mira / Jin) を candidate に出してしまうリスク | facilitator script 厳守、コードネーム不使用 |

---

## 9. Open Decisions for User

本 plan を実行に移す前にユーザーが決める必要があるのは以下:

1. **Recruitment**: 内部デザイナーをアサインできるか、外部 recruiter を使うか、両方併用か
2. **Pilot vs Full**: 1 名で pilot → refine → 残りという段階的か、 同時に 2 名分予約して並走か
3. **Compensation budget**: 外部候補に補償を出せるか、 OSS contributor に "thank you note + acknowledgement in changelog" のみで募集するか
4. **Recording**: 録画 + 文字起こしを行うか、メモのみか (録画なしの場合 RC-2 mitigation が弱まる)
5. **本 plan の execution owner**: User 自身か、内部の他メンバーか、外部リサーチャーか

これらが決まれば即時 recruitment フェーズに移行可能。decisions が揃うまで Phase 2 implementation (Atlas / Vision / Showcase) は hold。

---

## Appendix A: Facilitator Script (抜粋、セッション開始時)

```
こんにちは、本日はお時間をいただきありがとうございます。

これから 75 分かけて、Refscope という Git ref の観測ツールを触っていただきます。
私は研究者として、あなたが画面を見て感じたこと・考えたことをそのまま聞きたいです。

3 点だけ強調させてください:
1. これはあなたの能力テストではなく、製品の評価です。
   「わからない」「ピンとこない」もすべて重要な情報です。
2. 私 (researcher) の希望する答えはありません。良いも悪いも全部聞きたいです。
3. 思いついたことは声に出していただけると助かります。
   "ここは何だろう" 程度のつぶやきも大切です。

途中で席を立つ・休憩する・終了する、いずれも自由です。
録画について: 同意書の通り、録画は外部に出しません。同意なしで録画しません。

何か質問はありますか?
```

(以下、§3 / §4 / §5 / §6 / §7 / §8 の prompt 集は本 plan 承認後に separate file で展開)

---

## Status

- **Plan version**: v1
- **Approved by**: pending user review
- **Execution status**: ready to recruit (上記 §9 decisions 待ち)
- **Linked artifacts**:
  - `docs/user-demand-report-2026-05-08-r7-designer.md`
  - `docs/magi-verdict-2026-05-08-r7-designer.md`
- **Phase 2 dependency**: 本 plan の aggregate result が **>70% Supported** で初めて Atlas hand-off (Lens metadata schema 設計) に進む
