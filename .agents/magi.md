# Magi Journal

> Append-only journal maintained by the Magi agent (multi-perspective deliberation: Logos / Pathos / Sophia).
> **Discipline:** Append-only. Do NOT edit past entries. New deliberations are added at the bottom as new sections with date + decision IDs.
> **Scope:** Strategic Go/No-Go arbitration, architecture trade-offs, charter governance, persona-conflict reconciliation.
> **Output format:** Each entry contains the decision ID, consensus, confidence, DA (devil's advocate) challenge result, retreat conditions, and cross-decision dependencies.

---

## 2026-05-03 | Fleet observation proposal v1 review (D1 / D2 / D3)

> **Trigger:** Spark proposal v1 (`docs/spark-reo-fleet-observation-proposal.md`, 1163 行) handoff via Nexus chain (Plea → Atlas + Vision + Spark v1 → Echo + Magi). 3 strategic questions raised by Spark v1 §10.5 / §10.7 / §15.3 + persona positioning of "Fleet" surface.
> **Personas deliberated:** Logos (logical / cost-benefit), Pathos (ethical response to Reo demand), Sophia (long-term strategic / brand integrity).
> **DA (devil's advocate) challenge applied to all 3 decisions.**

---

### Decision 1: Surface 名 final

**Question:** Spark v1 §6.1 で `Fleet` 名を仮置きしているが、Aya (新卒) や non-native English speaker が "team feature" と誤解する risk がある。代替案 `Atrium` / `Watch` / `RepoMap` 等を含めて final 名を確定したい。

**Verdict:** **`Fleet` 確定** (Vision 推奨 + Spark v1 を承認)
- **Consensus:** 3-0 unanimous (Logos 70 / Pathos 65 / Sophia 75)
- **Confidence:** **70/100 (medium)**

**採用根拠:**
- Reo verbatim 尊重 (Plea handoff 内で Reo が `fleet` と発話)
- SRE precedent (業界共通: kubectl get pods -l fleet=, fleet management tool, AWS Fleet Manager)
- Brand category creation (Refscope の "calm + observed-only fleet" は新カテゴリの旗印になる)

**DA challenge result:**
- ✅ "anchoring risk" objection: Reo 1 名の verbatim に過度に anchor している → retreat 条件 R1 (Aya walkthrough fail) で部分救済
- ✅ "synthetic 1 voice の重み" objection: Plea synthetic は確証性が低い → retreat 条件 R2 (Researcher 実 SRE survey) で部分救済
- ✅ "team 連想" objection: Forbidden vocabulary list (Team/Organization/Workspace/Members/Invite/Role/presence) で打ち消し可能

**採択前提条件 (mandatory):**
1. TopBar tooltip "Fleet = your repos, single user, single machine" を **mandatory** (常時 hover 可能、隠さない)
2. charter §3 Forbidden UI vocabulary list に `Team`, `Organization`, `Workspace`, `Members`, `Invite`, `Role`, `presence` を含める (現草案で OK)
3. CommandPalette jump label "Fleet モードに切替" の i18n に "(複数 repo 観測 mode)" 補足を tooltip 併記検討

**Retreat 条件 (proposal v1.1 §6.1.1 として明文化済):**
| Trigger | 条件 | アクション |
|---|---|---|
| **R1** | Echo Aya persona walkthrough で 3 名中 ≥2 名 (≥66%) が "Fleet = team feature?" と回答 | `Atrium` rename + charter v2 supersede |
| **R2** | Researcher 実 SRE 5 名で ≥3 名が "fleet という言葉から CI/deploy 連動を期待" | name retain + Footer microcopy 強化 |
| **R3** | 公開 6 ヶ月以内に GitHub Issue/Discussion で "Fleet feature の team 化要望" が ≥3 件 | name retain + charter §3 wording 強化 |

---

### Decision 2: Charter v1 immutable strategy

**Question:** Spark v1 §7 で charter v1 草案を inline で示し、§6 で immutable + supersede only の policy を提案している。本当に完全 immutable で運用するか、それとも軽微な誤字修正等は in-place 編集を許容するか。

**Verdict:** **完全 immutable (supersede only) + non-substantive correction exception**
- **Consensus:** 3-0 unanimous (Logos 80 / Pathos 72 / Sophia 82)
- **Confidence:** **78/100 (medium-high)**

**採用根拠:**
- charter は派生 slippery slope を物理的に防ぐ唯一の architectural device
- 完全 immutable のみだと typo/dead link/formatting の trivial fix で supersede chain を肥大化させる過剰負担が発生
- non-substantive exception を 4 種に限定し、Layer 2 grep gate に semantic-diff check を追加することで wider gate のリスクを線引

**DA challenge result:**
- ✅ "small OSS over-engineering" objection: small project に immutable charter は重すぎる → non-substantive exception で吸収
- ✅ "5y context shift" objection: 5 年後に context が変わって charter が古びる → spec v0 cycle integration (毎 v0 spec update 時に charter health review) で論破
- ✅ "supersede chain bureaucracy" objection: chain 5+ で読みにくい → diff summary table 必須掲載 (§6 #5) で部分緩和

**採択前提条件 (proposal v1.1 §7 charter §6 に追記済):**
1. **non-substantive correction exception** 追記 (§6.1 新節): typo / dead link / formatting / wording clarity (semantic 不変) の 4 種は in-place 編集 OK、PR title `[non-substantive]` prefix 必須、Layer 2 grep gate に semantic diff check 追加
2. **previous charter からの diff summary table 必須掲載** (§6 #5): supersede chain 5+ tracking 対策
3. charter §1 "Any PR that violates ... MUST be rejected" を建設的言い換え ("rejected without negotiation; the path forward is supersede via fleet-charter-v2.md") — Quill polish task 化
4. **6 ヶ月後 governance health review** trigger を §6.2 新節として明記

---

### Decision 3: "Fleet を Refscope に入れるべきか"

**Question:** Spark v1 §15.1 推奨は Option B (Hybrid) だが、§15.3 "Don't build" option も house pattern として末尾にある。Refscope のミッション (calm + observed-only + single-repo) 整合性と Reo demand への倫理的応答とのトレードオフをどう判断するか。

**Verdict:** **遅延 (Option E / "Wait for Researcher with explicit kill criteria")**
- **Consensus:** 2-1 majority (Logos 65 遅延 / Sophia 73 遅延 / **Pathos 68 入れる** 反対)
- **Confidence:** **65/100 (medium)**

**Pathos dissent verbatim 保存:**

> "Reo demand への倫理的応答と calm 拡張の信念から、Option B 即着手を推す。Researcher を待つ間に Reo の苛立ちは累積し、Refscope は 'calm な fleet 観測' を提供する歴史的機会を失う。"

**採用根拠 (Logos + Sophia majority):**
- Plea synthetic は単一 voice であり、Researcher 実証なしで 1 person-month の implementation を投入するのは Confidence ≤ 50% 違反 (RICE guardrail)
- Refscope 魂 (single-repo focus, calm) を fleet 化する meta-decision は、Researcher No-Go 確定後に "Don't build" で Refscope の魂を保護する選択肢を残す重要性が、Pathos の "倫理的応答" に勝る
- 遅延期間中の Reo の苛立ち累積は、Refscope の brand integrity 棄損のリスクを下回る

**採択前提条件 (proposal v1.1 §15 / §16 に反映済):**

1. **Researcher を最大 8 週間以内に走らせる** (期限付き hard-cap)、対象: 実 SRE 5 名 (≥3 年 on-call 経験、12-20 repo 環境)
2. **Go criteria (即着手):** 5 名中 ≥3 名が "Fleet view を月 ≥3 回 / 週 ≥1 回 利用したい" + 識別中央値時間 ≥30% 改善見込み + silence 区別精度要求が proposal §3.2 K3 (≥80%) と integratable
3. **No-Go criteria ("Don't build" 確定):** 5 名中 ≤2 名のみ Fleet 利用希望 + 派生情報必要 ≥3 名 + 識別改善 < 10%
4. **Conditional Go (Option A subset MVP):** 5 名中 3 名が "Fleet view を使いたいが SSE は不要" → Option A scope down、Option B SSE 多重化を v2 に延期
5. **Researcher 中の preparation parallel 作業:**
   - ✅ **Echo (Aya walkthrough): 完了済** (16 friction + 14 改善案 + 9 KPI estimate, proposal v1.1 §3.4 / §6.9 / §6.4 に反映)
   - 🟡 **Quill (charter wording polish)**: parallel 進行可
   - ⛔ **Builder + Artisan: 着手しない** (charter v1 commit 前の implementation は Layer 3 enforcement 違反)

---

### Cross-decision dependencies (Magi 内部 audit)

- **D1 → D2:** D1 採択 (`Fleet` retain) は D2 charter §3 forbidden vocabulary を前提 (Team/Organization 禁止で Fleet の team 連想を打ち消し)
- **D1 retreat → D2 trigger:** D1 retreat (Atrium rename) は D2 charter §2/§3 wording 連鎖 amendment trigger (charter v2 supersede)
- **D3 中 D2 + D1 parallel:** D3 遅延期間中、D2 (Quill polish) と D1 (Echo Aya walkthrough — 完了済) を parallel 進行
- **D3 No-Go → 全 decision suspended:** Researcher No-Go 確定 → §15.3 "Don't build" → D1 / D2 は archeological reference へ

---

### Magi proposal v1.1 update リスト (10 箇所、Spark に handoff 済)

1. **§6.1 (Surface 名)**: Magi 3-0 verdict で `Fleet` 確定を追記、retreat 条件を新節 §6.1.1 として追加
2. **§7 charter §6 Amendment**: non-substantive correction exception 追加 (§6.1)
3. **§7 charter §6 Amendment**: previous charter からの diff summary table 必須掲載 を追加 (§6 #5)
4. **§7 charter §1**: "Any PR that violates ... MUST be rejected" 建設的言い換え (Quill polish task 化と明記)
5. **§7 charter §6 末尾**: 6 ヶ月後 governance health review trigger 追記 (§6.2)
6. **§10.7 Open Question (`RTGV_BIND_PUBLIC` escape hatch)**: 次回 Magi 招集 (`devil` recipe で escape hatch 単独審議) を明記
7. **§15 Recommendation**: §15.1 "推奨: Option B" に **"Researcher Go 判定後に Option B 着手" の前提条件付与** を明記。"Don't build" option (§15.3) の kill criteria を Researcher No-Go 条件と integration
8. **§16 Handoff next agents 順序**: 現 [Researcher → Echo → Magi → Quill → Builder] を **[Researcher (8w hard-cap) ‖ Quill] → Magi 再 deliberation (Researcher 結果次第) → Builder + Artisan (Go 時のみ)** に再構成 (Echo は完了済)
9. **§17 LLM Orchestration Prompt**: Researcher Go 前は paste-ready prompt を **発火しない** ことを明記
10. **§14 Validation Strategy**: Echo walkthrough 完了 (16 friction / 14 改善案 / 9 KPI のうち 3 FAIL likely) を section 内に追記

---

### Magi 再 deliberation 候補 (Researcher Go 後に開く)

- **D3 再判定**: Researcher Go criteria を満たすか? Conditional Go なら Option A subset MVP に scope down
- **D1 retreat 判定**: Researcher で "Fleet → CI/deploy 期待" が ≥3 名の場合 R2 trigger → name retain + microcopy 強化
- **§10.13 (Echo S-D3 Quiet alive heartbeat) 単独 deliberation**: Pathos D3 dissent と関連、Quiet 原則 vs SR-UX トレードオフの core question
- **§10.7 (`RTGV_BIND_PUBLIC` escape hatch)** 単独審議 (`devil` recipe)

---

### Magi 自己 audit notes

- **synthetic source bias** ⚠️: 本 deliberation の input 90% は Plea synthetic (Reo) + Echo synthetic walkthrough であり、real user data 0%。D3 verdict (遅延) はこの bias を正面から認めた結果である。
- **Pathos dissent recording** ✅: 2-1 majority を保存し、verbatim 形式で proposal v1.1 §15.1 に反映 (dissent suppression を防ぐ)
- **Confidence calibration** ✅: D1 70 / D2 78 / D3 65 — D2 が最も高い (charter governance は Magi の core competency に近い)、D3 が最も低い (build か否かは ultimately user research に依存し、Magi 単独で決められない)
- **Cross-decision dependency check** ✅: D1 / D2 / D3 の 3 つの間に正の dependency と retreat trigger を確認済
- **Next Magi invocation 準備**: Researcher 完了通知後に再 deliberation を予約 (8w hard-cap 内に発火、`magi` skill via Nexus で自動呼び出し)

---

## 2026-05-03 (追記) | post-MVP UI brainstorm 2 strategic decisions (D4 / D5)

> **Trigger:** Fleet observation MVP (Steps 1-7) 完了後の post-MVP UI brainstorm。Builder verification gate (Step 7) 完了後、Artisan が実装可能な post-MVP UX 改善候補 2 件 (D4: UI で repo を「開く」動線強化 / D5: ブックマーク機能) を Magi に諮問。
> **Personas deliberated:** Logos (logical / cost-benefit)、Pathos (ethical response to Reo demand)、Sophia (long-term strategic / brand integrity)。
> **DA (devil's advocate) challenge 適用済。**

---

### Decision 4: UI で repo を「開く」動線強化

**Question:** FleetSurface row click → detail mode への動線は既存実装で "充足" しているが、Reo の "30 秒以内に fleet 観測 → 目的の repo を即 detail 開く" JTBD に対し、さらなる動線強化を行うか。4 options: O1 = FleetSurface row に明示的 "Open →" button + CommandPalette jump 両方実装 / O2 = CommandPalette jump 強化のみ (row click は現行維持) / O3 = env var `RTGV_REPOS` 管理 UX を改善 (現行維持と組み合わせ) / O4 = session-only 一時追加 (localStorage なし)。

**Verdict:** **O2 (CommandPalette jump 強化) + O3 (env var 維持) 採択** / O1 完全実装 reject / O4 session-only reject
- **Consensus:** 3-0 unanimous (Logos 82 / Pathos 75 / Sophia 85)
- **Confidence:** **81/100 (medium-high)**

**採用根拠:**
- O1 完全実装: FleetSurface row に "Open →" button を追加すると 28px row の情報密度が過剰になり、Reo の "1 秒で全 repo 状態を把握" JTBD を妨げる。UI 実装コストが O2 の約 2 倍。Sophia: "small is beautiful" 原則に反する。
- O2 CommandPalette jump: 既存 CommandPalette 設計 (§6.8) に `Detail: <repoId> を開く` × N コマンドを追加するだけで、row の視覚的シンプルさを保ちつつ keyboard-first 操作者 (Reo はキーボード派 SRE) に最速ルートを提供。last opened 順 sort は operation history (observed fact) であり派生 score ではない。
- O3 env var 維持: `RTGV_REPOS` は起動時設定であり、UI からの動的追加は charter §1.2 (localhost only + explicit user action) 趣旨と整合する範囲内。別途 UX 改善の余地はあるが MVP 後で十分。
- O4 session-only: localStorage を使わない一時追加は UX メリット薄く、reload でリセットされる不完全 UX になる。reject。

**DA challenge result:**
- ✅ "O2 は keyboard-first 前提で mouse 派 SRE を排除する" 異議: row click は現行維持のため mouse 操作は変わらない。CommandPalette はキーボードの追加チャネル (非排他)。
- ✅ "last opened sort は派生スコア違反" 異議: operation history (自分がいつ開いたか) は observed fact であり、CI status や popularity ranking のような derived label ではない。charter §1.1 整合確認済。
- ✅ "N=32 repo で CommandPalette が 32 コマンド増えてノイズ増大" 異議: palette は fuzzy search で絞り込み可能、かつ `Detail: ` prefix を付与することで namespace 分離済。

**採択前提条件:**
1. CommandPalette §6.8 設計 full 実装 (`Detail: <repoId> を開く` × N + last opened sort) — **Artisan 担当**
2. last opened sort のデータソースは §6.11 `useLastOpenedRepos` hook と共有 (D5 O3 と連動)
3. Researcher セッションで D4 O2 UX 効果検証 (R4-1 / R4-2 trigger 監視)

**Retreat 条件:**
| ID | Trigger 条件 | アクション |
|---|---|---|
| **R4-1** | CommandPalette jump が Fleet UX の cognitive load を増やすと実 SRE ≥3/5 名が報告 | `Detail: <repoId> を開く` コマンドを削除し O1 (FleetSurface row に "Open" button) を Magi 再 deliberation に諮る |
| **R4-2** | Researcher セッションで "CommandPalette を開かずに repo を直接 click する" が ≥4/5 名で自然な行動として観察される | CommandPalette command は維持しつつ FleetSurface row に hover 時 "Open →" CTA を追加する小規模 UX 補完を Artisan に handoff |
| **R4-3** | env var `RTGV_REPOS` 管理 UX の不満が ≥3/5 名から "UI で追加したい" として明示的に挙がる | Magi D4 再 deliberation を招集し O1 full 実装の RICE を再評価 |

---

### Decision 5: ブックマーク機能

**Question:** 頻繁に参照する repo を "ブックマーク" または "お気に入り" として固定表示する機能を追加するか。4 options: O1 = full bookmark 実装 (star icon + starred section + localStorage) / O2 = pin-to-top (ドラッグ or 矢印で行順序変更) / O3 = Last opened order memory (直近開いた順を "Recently opened" section で表示) / O4 = 現状維持 (RTGV_REPOS 設定順のまま)。

**Verdict:** **O4 現状維持 primary + O3 (Last opened order memory) 採択** / O1 完全 bookmark 実装 absolute reject / O2 pin-to-top reject
- **Consensus:** 3-0 unanimous (Logos 80 / Pathos 72 / Sophia 88)
- **Confidence:** **80/100 (medium-high)**

**採用根拠:**
- O1 full bookmark: star icon を追加すると "重要度のスコアリング" (どの repo が重要か) という派生 label を UI に導入することになる。charter §1.1 "score / ranking / priority / severity 禁止" に抵触。Sophia: "ブックマーク = この repo は重要 というラベル付け、観測事実ではない"。absolute reject。
- O2 pin-to-top: ドラッグ or 矢印で row 順序変更はユーザー自身が "重要度の順序" を表現する派生行為になる。charter §3 "rank, priority" 禁止と同質の問題。また drag+drop は 28px row 間での実装複雑度が高い (特に keyboard accessibility)。reject。
- O3 Last opened order memory: "最後に開いた順" は user 自身の operation history (observed fact)。"Recently opened (N)" として FleetSurface 末尾 (Excluded section の上) に additive 表示し、default order (RTGV_REPOS 設定順) に影響させない。Backlog 案だったが本 chain で実装可能と判断し採択。
- O4 現状維持: RTGV_REPOS 設定順は user が起動時に決定した explicit order であり、それ自体が user の意図を表している。O3 と組み合わせることで "default は自分の設定順、recently opened は additive に見える" の two-layer 構造が成立。

**DA challenge result:**
- ✅ "O3 も 'よく開く repo を上に' という暗示的な ranking を生む" 異議: Recently opened は timestamp-based operation history の literal 表示であり、frequency や importance の集計ではない。"1 回しか開いていない repo が最上位になる" という反例が示す通り、O3 は ranking ではなく chronological history。charter §1.1 整合確認済。
- ✅ "O4 のみで十分では" 異議: RTGV_REPOS 設定順は起動時設定であり、on-call 中の "今日よく開いた repo" を一瞬で把握する動線がない。O3 は on-call 中の context switch を軽減する実用的 UX 補完。
- ✅ "Recently opened section が Excluded section と視覚的に混乱する" 異議: 見出し `"Recently opened (N)"` と `"Excluded (N)"` は semantic が異なる (前者は operation history、後者は user の explicit 除外)。tooltip で補足可能 (R5-4 退避条件)。

**採択前提条件:**
1. charter §1.1 抵触チェック: "Recently opened" は user operation history (observed fact)、派生 score 禁止 — Artisan 実装前に grep gate 確認必須
2. localStorage key `refscope.fleet.last_opened.v1` は repoId + openedAt のみ (path leak 防止、容量上限 20 entries)
3. Researcher セッションで D5 O3 UX 効果検証 (R5-1〜R5-4 trigger 監視)

**Retreat 条件:**
| ID | Trigger 条件 | アクション |
|---|---|---|
| **R5-1** | "Recently opened" section が default order の可読性を下げると実 SRE ≥3/5 名が報告 | section を削除し O4 (現状維持) に完全戻し |
| **R5-2** | localStorage `refscope.fleet.last_opened.v1` の read/write が 20 entries 超でパフォーマンス問題を発生 (First Paint +100ms 超) | 容量上限を 10 に削減、または section を opt-in (default off) に変更 |
| **R5-3** | ユーザーから "Recently opened の order を固定したい" (= pin 要求 = O2 の復活) が ≥3 名から明示的に提起 | Magi D5 再 deliberation を招集し O2 pin-to-top の RICE を再評価 (O2 は D5 で reject されたが demand 実証があれば再審) |
| **R5-4** | "Recently opened" と "Excluded" section の視覚的重複で Aya (新卒) が ≥66% の割合で "何が違うの?" と混乱 | section 見出しに tooltip "These repos were recently opened in detail view" を追加し混乱を軽減、それでも継続なら Artisan design audit |

---

### Cross-decision dependencies (D4 / D5 内部 audit)

- **D4 O2 ↔ D5 O3 連動:** D4 の CommandPalette `Detail: <repoId> を開く` last opened sort と D5 の `useLastOpenedRepos` hook は同一 localStorage key `refscope.fleet.last_opened.v1` を共有。D4 コマンド実行で `recordLastOpened()` が発火し D5 section にも反映される。実装は 1 hook で双方を賄う (DRY 原則)。
- **D4 retreat R4-1 → D5 への影響:** D4 O2 を削除しても D5 O3 (Recently opened section) は独立して機能する。D5 の localStorage は D4 の CommandPalette が存在しなくても App.tsx の `handleSelectRepo()` から `recordLastOpened()` を呼び出す設計のため影響なし。
- **D5 retreat R5-1 → D4 への影響:** D5 の "Recently opened" section を削除しても D4 の CommandPalette `Detail: <repoId> を開く` コマンドは last opened sort のデータソースがあれば機能し続ける。section 削除 = localStorage 削除ではないため D4 には影響なし。ただし R5-1 が trigger された場合は UX 一貫性のため D4 の last opened sort も plain alphabetical sort にフォールバックすることを Artisan handoff で明記する。

---

### Magi 自己 audit notes (D4/D5)

- **Post-MVP bias** ⚠️: D4/D5 は MVP 実装完了後の brainstorm であり、charter v1 commit 済の状態での deliberation。D3 とは異なり "build か否か" ではなく "どう build するか" の arbitration であるため Confidence が D3 より高い (D4: 81 / D5: 80 vs D3: 65)。
- **charter §1.1 抵触チェック (D4 / D5 双方)** ✅: D4 O2 (operation history sort) も D5 O3 (Recently opened timestamp-based) もいずれも observed fact であり、severity / ranking / priority のような derived label ではない。grep gate で `score_, ranking_, severity_` がヒットしないことを Artisan 実装後に `make verify` で確認必須。
- **Unanimity (3-0) の意義:** D3 の 2-1 と異なり D4/D5 ともに 3-0 unanimous。これは "観測事実 vs 派生" の境界が明確なケース (D4/D5) では Pathos も Logos/Sophia と同意見に収束しやすいことを示す。Pathos dissent は "build か否か" のような価値倫理的問いで最も顕在化する。
- **Retreat 条件設計原則:** R4-1〜R5-4 の trigger はいずれも "実 SRE N 名以上が報告" という観測ベースの条件。numeric threshold と specific user behavior pattern で定義し、主観的 "なんとなく不評" での rollback を防ぐ。
- **Next Magi invocation:** D4/D5 の retreat 条件は Researcher セッション (8w hard-cap 内) の結果で trigger 可能。Researcher 完了後の Magi 再 deliberation アジェンダに D4/D5 retreat 判定を追加する。

---

**Implementation status (2026-05-03):** D4 O2 = CommandPalette jump 実装完了 (`apps/ui/src/app/components/refscope/CommandPalette.tsx` +55 LOC、`Detail: <repoId> を開く` × N + last opened sort)、D5 O3 = Last opened order memory 実装完了 (`apps/ui/src/app/hooks/useLastOpenedRepos.ts` 新規 98 LOC + `apps/ui/src/app/components/refscope/FleetSurface.tsx` +55 LOC "Recently opened (N)" section + `apps/ui/src/app/App.tsx` +20 LOC hook integration)、charter 抵触ゼロ確認 (`make verify` fleet-gate PASS)。

---

## 2026-05-03 (追記) | D4-v2 — User authority override implementation completed (charter v2 supersede)

> **Trigger:** Real user feedback "CLI から複数リポジトリを設定するより WEB UI でリポジトリを追加できるほうがよい" + user 明示選択 "A) Persistent (file-based)" → Magi D4 verdict (3-0 unanimous で O1 reject) を user authority で override。
> **Pathway compliance:** Magi D2 §6 supersede pathway 遵守 (charter v1 IMMUTABLE 規律違反なし)、charter v2 を `docs/fleet-charter-v2.md` で新規作成、ADR-Fleet-002 で経緯記録。
> **Implementation status (2026-05-03):** Steps 1-7 完了 (charter v2 + reposStore + validation + POST/DELETE/CSRF + tests + UI Dialog + api wiring)、252/252 tests PASS、charter v2 §3 team-feature vocab 完全保持確認済。
> **Authority for ≥2 reviewers exception:** User authority override により charter §6 amendment process #2 ("≥2 CODEOWNERS reviewers") を 1 reviewer (user 自身) に縮退、ADR-Fleet-002 内に明示記録。

### Implementation summary

| File | Change | LOC |
|------|--------|-----|
| docs/fleet-charter-v2.md | C (supersede) | 201 |
| docs/adr/ADR-Fleet-002.md | C | 67 |
| docs/fleet-charter.md | M (SUPERSEDED 注釈) | +3 |
| apps/api/src/reposStore.js | C (persistence) | 241 |
| apps/api/src/config.js | M (merge + mutation) | +130 |
| apps/api/src/validation.js | M (parsePostBodyJson + validateRepoAddInput) | +90 |
| apps/api/src/http.js | M (POST/DELETE/CSRF/CORS) | +150 |
| apps/api/src/gitService.js | M (wiring + origin) | +40 |
| apps/api/test/repos-mutation.test.js | C | 300 |
| apps/api/test/reposStore.test.js | C | 210 |
| apps/api/test/config.test.js | M | +30 |
| apps/ui/src/app/components/refscope/AddRepoDialog.tsx | C | 305 |
| apps/ui/src/app/components/refscope/TopBar.tsx | M | +35 |
| apps/ui/src/app/components/refscope/FleetSurface.tsx | M (origin badge + Remove) | +160 |
| apps/ui/src/app/components/refscope/FleetOnboardingOverlay.tsx | M (1 行追加) | +5 |
| apps/ui/src/app/api.ts | M (postRepo + deleteRepo) | +50 |
| apps/ui/src/app/hooks/useLastOpenedRepos.ts | M (evictRepo) | +15 |
| apps/ui/src/app/App.tsx | M (handleAddRepo + handleRemoveRepo) | +30 |
| apps/ui/src/app/components/refscope/data.ts | M (Repository.origin) | +1 |
| **Total** | | **~2063 LOC** |

### Magi D4-v2 retreat 条件 (新追加、Magi journal Sherpa-decompose で list 済を再掲)

| ID | Trigger | アクション |
|---|---|---|
| R4-v2-sec-incident | UI add 実装後 6 ヶ月以内に path traversal / arbitrary file read / CSRF bypass 等の security incident が 1 件でも発生 | charter v3 で UI add を再 reject、CommandPalette jump 単独に retreat |
| R4-v2-corruption | repos.json 破損 fallback (.bak rename) が user の操作と無関係に 3 ヶ月で 5 件以上発生 | 永続化を SQLite 移行 or session-only に degrade |
| R4-v2-misuse | "repos.json を team で共有して使う" 等の team-feature 化要望が GitHub Issue で ≥3 件 | charter §3 wording を強化、UI に "1 user 1 machine" 警告を再表示 |
| R4-v2-no-adoption | Researcher セッション (8w hard-cap 経過後) で UI add を使う実 SRE が 5 名中 ≤1 名 | 機能 deprecate を Magi 再 deliberation に諮り、env var 単独に retreat |

既存 R4-1/R4-2/R4-3 + R5-1〜R5-4 は v2 でも完全有効。

### 次回 Magi 招集 D6 議題候補
- "supersede pathway 濫用防止策" (User authority override が今後も口実化されないよう ADR-Fleet-002 + Magi journal で precedent 化)
- v1.5+ Out-of-MVP scope (完全 CSRF token / in-UI git clone / path autocomplete / repos.json 暗号化 / Export-Import 機能)

> 代筆: Sherpa-verify (Magi 不在の auto mode chain 中) — Magi 自身の 3 賢者 deliberation を経ていない、本 entry は Sherpa による情報整理のみ。次回実 Magi 招集時に formal verdict 補完が望ましい。
