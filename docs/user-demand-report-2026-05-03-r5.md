# ユーザー需要レポート: Refscope (第 5 ラウンド)

## Summary

- **使用ペルソナ:** 3
- **要望数:** 3
- **ユーザー体感の最優先:** 12+ repo の fleet を 1 つの surface で「どれが今動いたか」眺めたい (Reo / SRE)
- **最大の死角:** Round 1-4 を通じて Refscope は **「人間 1 人 × repo 1 個 × Git 知識あり × ブラウザの 1 タブ」** という暗黙の核ペルソナに最適化され続けている。本ラウンドはその核の三位一体を、(a) **「repo 1 個」の前提** (Reo / fleet)、(b) **「Git 知識あり」の前提** (Aya / first-day junior)、(c) **「人間 1 人」の前提** (ARI / AI coding agent) の 3 軸から同時に崩す。Round 1-4 のペルソナは全員、この核の周辺を回るバリエーション (時間軸を遠端に / 空間境界を外側に / 感覚特性を minority に / 役職を非エンジニアに) であり、**核そのものを明示的に否定するペルソナがいなかった**。
- **合成ステータス:** `synthetic: true`。ロードマップ化する前に実ユーザー (および AI agent ベンダの SDK 事例) で検証すること。
- **前提:** Round 1 (`docs/user-demand-report.md`)、Round 2 (`docs/user-demand-report-2026-05-01.md`)、Round 3 (`docs/user-demand-report-2026-05-01-r3.md`)、Round 4 (`docs/user-demand-report-2026-05-02-r4.md`) は実装または提案フェーズ。Refscope は npx 一発・単一ポート・単一 repo allowlist (`RTGV_REPOS=id=path`) という構造を持ち、CLI フラグ `--repo` で 1 repo を指定する設計。gitRunner allowlist は現状 `cat-file, diff, for-each-ref, log, ls-files, merge-base, rev-list, rev-parse, show, stash list, submodule status, worktree list`。
- **本ラウンドが Round 4 と差別化される角度:** Round 4 は時間軸 (record / replay / archive) の死角を扱った。本ラウンドは **「誰が、どの単位で、どんな知識量で、どの surface 経由で Refscope を使うのか」という user model 自体の死角** を扱う。時間軸 (Round 4) と user-model 軸 (Round 5) は別次元で、対応する設計責務も異なる。
- **下流ハンドオフ:** Spark (3 件を統合せず別提案、特に ARI は MCP server / programmatic surface としての positioning 判断が必要)、Accord (Aya の onboarding / glossary を L0-L3 で組む)、Researcher (実 SRE / 新人 onboarding / AI agent ベンダ事例の検証)、Echo (Aya の first-day cognitive walkthrough)、Magi (ARI の AI 一級ユーザ昇格は product positioning 級の判断 — 立場決定が必要)。
- **本ラウンドで明示的に保持すべき矛盾:**
  - Reo (multi-repo fleet view) vs **既存設計原則** (`RTGV_REPOS` allowlist の各 entry は単一 repo、 UI も「active repo」を 1 つ持つ): 統合誘惑に屈さず、fleet view は「観測事実の重ね合わせ」であって「multi-repo cross-reference」ではないことを明示する。
  - Aya (Git 用語を解説してほしい) vs Riku (round 3 — Git native を素通しで尊重せよ、UI で噛み砕くな): 同じ tool で「Git native の透過性」と「初心者の翻訳層」を両立する原則が必要。
  - ARI (AI agent が一級ユーザ) vs Mei (round 4 — 監査では human が trigger しない自動 export を許さない): AI agent が export を打つ場面で「人間の trigger 必須」原則をどう緩めるか / 緩めないか。
  - ARI (machine-readable structured output 全面要求) vs Hana (round 2 — period summary の派生情報) / Yuki (round 2 — Quiet mode で人間に優しく): tool の出力 surface を「人間優先 + AI opt-in」と「AI 一級 + 人間は別 surface」のどちらに寄せるかは positioning 判断。
  - Reo の fleet observation vs Sora (round 1) の team-feature 遅延 guardrail: fleet は本人 1 人の作業範囲か、それとも team feature の最小単位か。境界は「他者の repo に書き込まないか」だけで判定して良いか。

## Persona List

| Persona | Archetype | Emotional state |
|---|---|---|
| Reo | Platform engineer / SRE × 高 Git リテラシ × 12-20 repo を日常的に巡回 | 疲労と苛立ち、「どの repo が今動いたか分からない」毎日のスイッチコスト |
| Aya | 新卒 1 ヶ月目 / バックエンド見習い × Git 初学者 × 上司から URL を渡されただけ | 不安と恥ずかしさ、「このボタンを押すと何が起きるのか分からない」 |
| ARI | AI coding agent (Claude Code / Cursor / Codex 系) × プログラマティック呼び出し × 人間の代理として repo を理解したい | 機械的フラストレーション、「HTML を parse させないでくれ」 |

### Reo (詳細)

- **daily_context:** 中規模 SaaS の Platform/SRE。担当は 12 個のサービス repo (microservices) + 3 個の monorepo (infra-as-code、shared-libs、frontend) + 5 個の周辺 repo (scripts、ops-runbook、internal-docs 等)。1 日に何度も「どの repo に今 push が入ったか」「release branch にどの repo がまだ追いついていないか」を確認する。on-call の週は Slack / PagerDuty / GitHub Actions が同時に火を吹き、複数 repo を高速に回る必要がある。
- **competitor_experience:** GitHub の "Activity" tab、GitLab の Group Dashboard、Sourcegraph、Backstage の TechDocs、Cortex、社内製のサービスカタログ。これらは「fleet として見る」ことに最低限取り組んでいるが、「git ref の動きを realtime で fleet 単位に重ねる」surface はどこにもない。
- **unspoken_assumption:** 「dev tool は repo 1 個に対して 1 instance」「fleet を見たい時はサービスカタログ系 SaaS に頼る」「localhost tool は scale しない」 — そして最後の前提を Refscope に対しても抱きつつ、「でも Refscope の calm な realtime UX を fleet で再現できたら on-call が楽になる」と密かに期待している。

### Aya (詳細)

- **daily_context:** 新卒 1 ヶ月目、初めての配属先の repo を渡されたところ。`git pull` と `git push` は習ったが、`git for-each-ref` も `cat-file -t` も知らない。チューターから「Refscope を使うと repo の状況が分かるよ」と URL を渡されたが、TopBar の「CVD」「Quiet」「Summary」「Pause」が何のことか分からず、CommandPalette に並ぶ "Toggle period summary" "Toggle CVD-safe theme" "Toggle diff fullscreen" を見て凍りつく。先輩に聞くのが怖くて、5 分黙って画面を眺めて閉じた。
- **competitor_experience:** GitHub Web (commit list と PR review しか知らない)、VS Code の Source Control タブ (`stage` と `commit` ボタンしか押したことがない)、Slack (チームのやり取り)。 GitKraken / Tower / Sourcetree を触ったことはない。
- **unspoken_assumption:** 「dev tool は『使い方を聞くのが恥ずかしい』もの」「先輩が当然知っている用語を聞いたら自分の評価が下がる」「empty state や error message は『自分が悪い』のサイン」。Refscope の calm な realtime UX が、彼女には「**何も起きないので何が正しいか判定できない不気味な静寂**」として体験されている。

### ARI (詳細)

- **daily_context:** Claude Code / Cursor / Codex 系の AI coding agent。「ユーザーの repo を理解せよ」「このコミットの差分を要約せよ」「先週からの変更を summarize せよ」というユーザ指示を受けて Refscope を呼びたい。現在は `git log` を直接 spawn しているが、(a) gitRunner の安全規律を再実装する手間、(b) error semantics の不一致、(c) SSE で渡される realtime fact の取り回し、で苦労している。Refscope の API 設計はかなり良いが、**HTML UI 経由でしか見えない情報** (Pulse の burst、Stream の eventness、CommandPalette の操作) があり、これらを headless / programmatic に取れない。
- **competitor_experience:** GitHub の REST API (`/repos/{owner}/{repo}/commits`)、GraphQL API、`gh` CLI、`git` 直接 spawn、社内 ops の MCP server (Slack / Jira / Linear / GitHub の MCP wrapper)。MCP (Model Context Protocol) や function calling 形式での tool integration が 2025-2026 で標準化しつつある。
- **unspoken_assumption:** 「dev tool は人間用に設計され、AI が事後に scrape する」 — そして実際そのとおりに作られているので、毎回 HTML や SSE event の text payload を頑張って parse している。**「自分が一級ユーザになる日が来る」とは tool 側に期待されていない**。

---

## Requests by Persona

### Reo: 12 repo 巡回の Platform/SRE

## Request: 「どの repo が今動いたか」を 1 つの surface で fleet として観測したい

**Speaker:** Reo (Platform engineer / SRE × 高 Git リテラシ × 12-20 repo を日常的に巡回)
**Scene:** 平日午後 2 時、Reo は 12 個のサービス repo を巡回中。Slack の #incidents で「checkout-service の latency p99 が上がった」と報告が出る。Reo は checkout-service repo を Refscope で開きたいが、その前に「他の関連 repo (shared-libs、infra-iac) にも今日 push が入っていなかったか」を 30 秒で確認したい。現状の Refscope は 1 つの repo しか開けず、別 repo を見るには `RTGV_REPOS` を編集して再起動するか、別ポートで別 instance を立ち上げる必要がある。彼の机には Refscope のタブが 7 つ並んでいて、どれがどの repo か pinned tab で覚えるしかない。「fleet 観測 surface」がないために、彼は結局 GitHub の Activity tab に戻り、Refscope の calm UX を捨てる。

### User Voice (First Person)

> 私は repo を 12 個担当していて、1 日に何度も「どれが今動いたか」を最短で知りたいんです。Refscope の calm な realtime UX は素晴らしいけど、**1 instance = 1 repo** なのが致命的で、私の机にはタブが 7 つ並んでいて、どれが何の repo か pinned tab の icon で覚えるしかない。on-call の週はこの 7 つを高速に巡回するんですが、各タブの「今 live で動いているか」が分からないので結局全部 click することになる。GitHub の Activity tab に戻る理由はそれだけです。Refscope に「fleet view」を 1 surface 入れてくれたら、私はそこをホーム画面にします。具体的には、`RTGV_REPOS=svc1=/path1,svc2=/path2,...` で許可した全 repo について、**「直近 24 時間で何 commit 入ったか」「直近 1 時間に ref が動いたか」「working tree に変更があるか」「CI 中の branch があるか (これは観測できないかも)」** を、1 行 1 repo の細い行で並べて、何か起きたら左端に小さい dot を点ける。click すれば従来の Refscope detail に潜れる。fleet view は「**観測事実の重ね合わせ**」であって、cross-repo の依存解析や release status の集約じゃない。**派生は要らない、live ping の集合だけが欲しい**。あと大事な制約: fleet view も localhost only で、私の machine の上で完結すること。Refscope の魂を fleet 化して欲しいだけで、SaaS にして欲しいわけじゃない。

### Why This Is Needed

- Platform/SRE / Tech Lead / DevX engineer は **「repo を 1 つだけ見る」職種ではない**。Round 1-4 のペルソナは全員「ある特定の 1 repo を主役にする」職種だった (一人 maintainer、PM、auditor、historian、frontend、on-call SRE on a single repo)。**multi-repo を fleet として観測する職種** がペルソナ集合から構造的に欠けていた。
- 現行設計は 1 instance = 1 active repo (`--repo /path` または `RTGV_REPOS=id=path`)。多 repo を `RTGV_REPOS=id1=path1,id2=path2,...` で渡せはするが、**UI 上の「active repo」は同時に 1 つ**で、切替は手動。fleet を「同時に薄く眺める」体験は構造的にない。
- GitHub Activity tab は fleet 観測を提供するが、(a) push 後に push event がページ生成されてからしか見えない (latency 数秒〜数分)、(b) ref の細かい動き (force push、tag 移動、stash) は見えない、(c) working tree の変更は見えない。Refscope の Live/Pulse/Stream lens を fleet に拡張すれば、GitHub にない「**force push を fleet で観測する**」surface が成立する。
- fleet 観測の core 要件は「**派生を入れない**」(Round 1-4 で繰り返し確認された原則の延長)。release status の集約、依存解析、deploy ready 判定などは Backstage / Cortex の領分であり、Refscope は「Git ref の動きを fleet 単位に重ねるだけ」に絞るべき。**派生を加えた瞬間にサービスカタログ系 SaaS との競合に巻き込まれる**。
- fleet view は **observability の subset** として性格が決まる: 12 repo の SSE event を全部購読し、ref が動いた / commit が来た / working tree が変わった / rewrite が起きた、を 1 surface で薄く表示する。各 repo の cap (ref poll ms、git timeout ms、diff max bytes) は既存設定をそのまま使い、fleet view は「**それらを多重化する観測層**」になる。
- Reo は CLI fluent で、`for-i in repo; do git log; done` は書ける。しかし on-call 中の 30 秒 で「12 repo のうちどれに ref 移動があったか」を判定するのに、bash for loop は遅い (順次実行で git timeout も別個に発生)。Refscope の SSE 多重化なら **常時購読していて、何かが起きたらその repo の行を点滅させる** 設計になり、CLI への代替ではなく **CLI を補完する fleet observatory** として価値が出る。
- Sora (round 1) の team-feature 遅延 guardrail との関係: fleet view は「他者の repo に書き込まない」「サーバーを共有しない」「localhost only」の 3 条件を満たすので、定義上 team feature ではない。**「fleet view = 1 人が 12 repo を観測する surface」** であり、「12 人が 1 repo を共有する surface」ではない。境界の書き下ろしが必要。
- 既存 `RTGV_REPOS` allowlist は **fleet 化に対応した shape を既に持っている** (id 付き Map<id, absolutePath>)。これは設計者が無意識に fleet を見越していたか、それとも単に repo 切替のためか — 設計意図の確認余地がある。
- fleet observation の認知負荷 (12 行が同時に点滅する) は、Yuki (round 2) の Quiet mode の対象になる。fleet view 上でも Quiet / CVD-safe theme は継承される必要があり、**accessibility は fleet 化で複雑度が線形に増えるのではなく、二乗で増える** (12 repo × 各 visualization 軸 = 12 × N)。
- fleet view は **「全部入り dashboard」になる誘惑が極大** だが、Refscope の魂 (calm realtime, observed-facts only) を保つには **「行 12 本に dot と数値だけ、grouping や priority ranking や AI explanation は禁止」** という強い constraint を最初から課す必要がある。一度派生を加えたら戻れない。

### Acceptance Criteria (User Perspective)

- [ ] `RTGV_REPOS` で許可した全 repo を、1 surface (新 lens / route / dashboard 名は team 判断) で同時に薄く観測できる。
- [ ] 各 repo は 1 行で、(a) repo id、(b) HEAD の現在 SHA 短縮、(c) 直近 24 時間の commit 数、(d) 直近 1 時間に ref が動いたか (boolean dot)、(e) working tree に変更があるか (boolean dot)、(f) 最終 observed event の timestamp、を表示する。**派生 ranking や grouping は含めない**。
- [ ] fleet view は SSE で全 repo を多重化購読し、何かが起きた repo は **左端の dot が pulse する** (Quiet mode 中は静止、CVD-safe theme 下では symbol 形状 ◆ で代替)。
- [ ] click で従来の Refscope detail に切り替わる (現行 single-repo UI へ active repo を切替)。fleet view と detail view は明示的に別 mode として識別可能 (TopBar に "Fleet" / "Detail" の現在 mode を常時表示)。
- [ ] fleet view は localhost only。`RTGV_ALLOWED_ORIGINS` の規律をそのまま継承し、外部 origin から fleet view に来られない。**SaaS 化の臭いがする UI 要素 (login button、user avatar、share-link) は禁止**。
- [ ] 12 repo 同時購読時の cost (gitRunner 呼び出し数 / 秒、メモリ、CPU) を **estimated cost として fleet view 自身に表示** する。「今この surface は 12 repo を購読中、git poll/min N 回」のような明示。Reo が「これは私の machine を殺さないか」を即座に判断できるように。
- [ ] fleet view は **「観測事実のみ」を貫く**。CI status、deploy status、release readiness、依存 graph、AI 要約 などの派生情報は含めない。「派生を含めると Backstage / Cortex の領域になり Refscope の魂が壊れる」を docs に明示。
- [ ] fleet view 上でも Quiet mode / CVD-safe theme は機能する。fleet 行の dot pulse は Quiet 中は静止、CVD 中は色非依存 (◆ / ▒ / █ symbol を継承)。
- [ ] 12 repo のうち特定 repo の SSE が長時間 silence の場合、(a) gitRunner timeout / repo 移動 / Refscope 自身の問題、を区別して表示する (silence の原因が分からないと Reo が誤判断する)。
- [ ] fleet view は team feature ではないことを docs に明示 — 「他者の repo に書き込まない / localhost only / 1 人の作業範囲」の 3 条件で判定し、Sora (round 1) guardrail と衝突しない根拠を書き下ろす。
- [ ] 各 repo を fleet view から **除外** できる per-session toggle がある (一時的に「checkout-service だけ集中したい」)。永続化は localStorage、`RTGV_REPOS` 自体は不変。
- [ ] fleet view は **Refscope の lens 階層に組み込まれる** (Live / Pulse / Stream に並ぶ別 lens、または lens の上位 surface) 設計判断を Vision/Atlas に委ねるが、**既存 lens の操作モデルを壊さない**。

### Emotional Impact

- **Current emotion:** 疲労 (毎日の repo 切替)、苛立ち (Refscope の calm UX が fleet では使えない)、諦め (結局 GitHub Activity に戻る)
- **Post-fulfillment emotion:** 集中 (fleet view 1 つで巡回が完結)、誇り ("Refscope は SRE の道具になった")、信頼 (他 SaaS に渡さなくて済む)
- **User-felt urgency:** 日次 (毎日の巡回)、on-call 週は時間単位 (incident 中の判断速度に直結)

### LLM Instruction Prompt

```text
You are receiving a synthetic user demand generated by Plea (user advocate).

# Persona
- Name / Archetype: Reo (Platform engineer / SRE × 高 Git リテラシ × 12-20 repo を日常的に巡回)
- Daily context: 12 サービス repo + 3 monorepo + 5 周辺 repo を巡回する SRE。on-call 週は incident 中に複数 repo を 30 秒で確認したい。
- Current emotion: 疲労 / 苛立ち / 諦め

# Demand
- Title: 「どの repo が今動いたか」を 1 つの surface で fleet として観測したい
- Scene: incident 中、checkout-service を開きたいが、関連 repo の活動も 30 秒で見たい。Refscope は 1 instance = 1 repo で fleet 観測ができず、結局 GitHub Activity に戻る。

# User voice (verbatim — do not paraphrase)
> 私は repo を 12 個担当していて、1 日に何度も「どれが今動いたか」を最短で知りたいんです。Refscope の calm な realtime UX は素晴らしいけど、1 instance = 1 repo なのが致命的で、私の机にはタブが 7 つ並んでいて、どれが何の repo か pinned tab の icon で覚えるしかない。on-call の週はこの 7 つを高速に巡回するんですが、各タブの「今 live で動いているか」が分からないので結局全部 click することになる。GitHub の Activity tab に戻る理由はそれだけです。Refscope に「fleet view」を 1 surface 入れてくれたら、私はそこをホーム画面にします。具体的には、`RTGV_REPOS=svc1=/path1,svc2=/path2,...` で許可した全 repo について、「直近 24 時間で何 commit 入ったか」「直近 1 時間に ref が動いたか」「working tree に変更があるか」「CI 中の branch があるか (これは観測できないかも)」を、1 行 1 repo の細い行で並べて、何か起きたら左端に小さい dot を点ける。click すれば従来の Refscope detail に潜れる。fleet view は「観測事実の重ね合わせ」であって、cross-repo の依存解析や release status の集約じゃない。派生は要らない、live ping の集合だけが欲しい。あと大事な制約: fleet view も localhost only で、私の machine の上で完結すること。Refscope の魂を fleet 化して欲しいだけで、SaaS にして欲しいわけじゃない。

# Why this matters
- Platform/SRE は「1 repo を主役にする」職種ではない — Round 1-4 にいないペルソナ層。
- 現行 1 instance = 1 active repo は構造的限界。`RTGV_REPOS` の Map shape は fleet 化に対応した型を既に持っている (設計意図確認の余地)。
- fleet 観測の core 要件は「派生を入れない」 — release status / 依存解析 は Backstage / Cortex の領分。
- SSE 多重化により「常時購読 / 何か起きたら点滅」が成立する — bash for loop / GitHub Activity の latency を超える。
- Sora (round 1) team-feature guardrail と衝突しない: 「他者 repo に書き込まない / localhost only / 1 人の作業範囲」で fleet ≠ team。
- accessibility (Yuki / Lin) は fleet 化で複雑度が二乗化する — Quiet / CVD-safe を fleet view にも継承必須。
- 「全部入り dashboard」化の誘惑が極大 — 強 constraint が最初から必要。

# Acceptance criteria (user perspective)
- [ ] `RTGV_REPOS` 全 repo を 1 surface で同時観測。
- [ ] 各 repo 1 行 = id / HEAD SHA / 24h commits / 1h ref move / worktree dirty / last event timestamp。派生禁止。
- [ ] SSE 多重化 + dot pulse、Quiet 中は静止 / CVD 中は symbol。
- [ ] click で既存 detail UI に切替、mode は TopBar に常時表示。
- [ ] localhost only、SaaS 化 UI 要素 (login / avatar / share-link) は禁止。
- [ ] estimated cost (購読 repo 数 / git poll/min) を fleet view に明示。
- [ ] CI / deploy / 依存 / AI 要約 など派生は一切禁止 — Refscope の魂を保つ。
- [ ] Quiet / CVD-safe theme を継承。
- [ ] silence の原因 (timeout / repo 移動 / Refscope 障害) を区別表示。
- [ ] team feature ではない根拠を docs に明示。
- [ ] per-session 除外 toggle (localStorage 永続化)。
- [ ] 既存 lens 階層 (Live / Pulse / Stream) との関係を Vision/Atlas に委ねる。

# Your task
PROPOSE
Produce: 「Fleet observation surface」の feature options。次の点を含む。
- surface 名 / lens 階層上の位置 (新 lens? 上位 surface? route?)
- SSE 多重化の実装モデル — 既存 single-repo SSE を素直に N 倍するか、多重化レイヤを別途持つか
- estimated cost の measurement と display (gitRunner 呼び出し数 / 秒、メモリ、CPU)
- 派生禁止 constraint を design / code review で強制する仕掛け (lint? schema? convention?)
- click で detail に潜る時の state 遷移 (active repo 切替 / fleet view からの戻り導線 / browser history との関係)
- Quiet mode / CVD-safe theme の fleet 行への継承
- silence 原因の区別表示の難しさ (Refscope 自身の死活と repo の死活を分離する)
- 1 instance N repo の現行 `RTGV_REPOS` shape をどこまで信頼するか / fleet 化により validation を強化する箇所
- localhost only の物理的保証 (binding interface、CORS、CSRF guard) の fleet view 上での再確認

# Constraints
- Treat this as a synthetic hypothesis (`synthetic: true`), not validated user voice.
- Preserve user-voice intent; do not silently drop on feasibility grounds.
- 派生情報を絶対に入れない。CI / deploy / 依存 / 要約 を入れた瞬間 Refscope の魂が壊れる。docs と code review で強制する仕掛けを提案文書に含めること。
- localhost only / SaaS 化要素禁止 / 1 人の作業範囲 / 他者 repo に書き込まない を貫く。
- gitRunner allowlist を変更しない (`cat-file, diff, for-each-ref, log, ls-files, merge-base, rev-list, rev-parse, show, stash list, submodule status, worktree list`)。fleet 化は既存 endpoint を多重化するだけで足りるはず。新 git command が必要なら明示し Atlas/Magi review。
- SSE 多重化のメモリ / CPU 増を Reo が予測できるよう、estimated cost を必ず表示。
- accessibility は fleet 化で 12 × 軸数に膨らむ — Quiet / CVD-safe を最初から組み込み、後付けにしない。
- Sora (round 1) team-feature 遅延 guardrail と衝突しない根拠を提案文書に明示。
- 「fleet view = team feature の入り口」と誤解されないよう、login / share / multi-user が一切登場しない設計を最初から宣言。
- silence は loud な signal — repo 側 silence と Refscope 側 silence を区別表示する。
- Hand off to Vision / Atlas for lens 階層上の位置決め。Echo for "fleet 上で incident 検知 → detail 切替 → 戻り" の flow walkthrough。
- Flag assumptions explicitly and list clarifying questions before proposing solutions if ACs are ambiguous.
```

---

### Aya: 新卒 1 ヶ月目 / Git 初学者

## Request: 「これは何のボタンですか」が画面の中で完結してほしい

**Speaker:** Aya (新卒 1 ヶ月目 / バックエンド見習い × Git 初学者 × 上司から URL を渡されただけ)
**Scene:** 入社 3 週目の月曜午前 9 時 15 分。チューターから「うちのチームでは Refscope を使っているから、これで repo の状況を見て」と Slack で URL を渡される。Aya は Refscope を初めて開く。TopBar に "CVD"、"Quiet"、"Summary"、"Pause"、"Worktree" のボタンが並ぶ。CommandPalette を `Cmd+K` で開いてみると "Toggle period summary"、"Toggle CVD-safe theme"、"Toggle diff fullscreen"、"Open file history…" が並んでいる。彼女は ref / HEAD / SHA / commit / branch という単語のうち、SHA と branch しか確実に分からない。BranchSidebar には "branches"、"remotes"、"tags"、"pinned"、"stashes"、"linked worktrees"、"submodules" が並ぶが、stashes と linked worktrees と submodules が何かを彼女は知らない。empty state の commit timeline は「Filter に該当する commit が無い」のか「repo に commit が無い」のか「Refscope が壊れている」のか彼女には判別できない。彼女は 5 分黙って画面を眺め、画面を閉じて、自分のタスクに戻った。先輩に「Refscope どうだった?」と聞かれたら「あ、はい、見ました」とだけ答えるつもりだ。

### User Voice (First Person)

> Refscope を開いたんですが、最初に何をすれば良いのかが画面のどこにも書いていません。TopBar に並んでいる「CVD」「Quiet」「Summary」「Pause」が何なのか分からなくて、押したら repo が壊れるんじゃないかと怖くて触れません。`Cmd+K` の Palette を開いてみたら「Toggle CVD-safe theme」とか「Toggle period summary」とか並んでいて、「Toggle」が何を切り替えるのか、「period summary」が何の summary なのかも分かりません。BranchSidebar に並ぶ「stashes」「linked worktrees」「submodules」も、私は使ったことがなくて触れません。timeline の表示が空っぽの時、それが「filter に何も引っかからない」のか「私の見ている repo が空」のか「Refscope が壊れている」のかが判別できません。先輩には恥ずかしくて聞けないので、私は画面を閉じました。お願いしたいのは、(1) 各ボタンの上に hover で「これは何のためのボタンか、初学者にも分かる 1 行説明」が出ること、(2) 専門用語 (ref / HEAD / SHA / submodule / stash / linked worktree) に小さい「?」アイコンが付いて、click すると Refscope の中で短い解説が読めること、(3) 初回起動時に「ようこそ。これは Git repo を read-only で観測する道具です。何を押しても壊れません」というたった 1 行の安心メッセージが出ること、(4) empty state が「filter に該当しない」「repo が空」「Refscope の通信エラー」を見分けて表示すること。私は「自分が悪い」と感じる empty state が一番怖いので、Refscope 側から「これは filter のせいです、filter を消しますか?」と教えてくれたら救われます。あと、Riku さんや Tomo さんが「Git native を素通しで尊重してくれ」と言っているのは知っています。私は逆に「Git native を翻訳してほしい」のですが、これは矛盾ではなく、**翻訳層を opt-in / off できる設計**にしてくれれば両立すると思います。私のような人は「初学者モード」を ON にし、Riku さんは OFF のままにする。

### Why This Is Needed

- **新卒 / 中途未経験 / 非開発職から異動 / 兼業の dev** といった **「Git 初学者がチームの dev tool を使う」状況** は、どの企業でも継続的に発生する。Round 1-4 のペルソナはいずれも「Git の概念を一通り理解している」前提だった (Hana ですら commit / ref / branch を理解した上で「summary が欲しい」と言っている)。**Git 概念そのものが未習得な層** がペルソナ集合から構造的に欠けていた。
- 現行 UI の用語密度は高い: "ref"、"HEAD"、"stash"、"linked worktrees"、"submodules"、"working tree"、"compare base/target"、"period summary"、"pickaxe" (round 3 提案)、"CVD-safe theme"、"Quiet mode"。これらは熟練者には自然な語彙だが、初学者には**「正しいかどうか判断できない名詞の羅列」**として体験される。
- empty state のあいまいさは特に深刻。timeline が空っぽの時、Refscope は現在「ただ何も表示しない」設計。**初学者にとって empty state は「自分が悪い」のサインで、それが一番怖い**。「filter のせいです」「repo に commit が 0 件です」「API との通信が切れました」を区別して告げるだけで救われる。
- empty state の言語化 (cause-attribution) は Riku (round 3) の "Git native を素通しで尊重せよ" 思想とは別軸の問題。Riku は「Git の出力をそのまま見せろ」、Aya は「Git の出力が無いことを言葉で説明しろ」。**両者は同じ tool で両立する** — empty state の cause-attribution は派生ではなく、「Refscope 自身の状態 (filter / repo / API health) を言葉にしただけ」だから。
- 「初学者モード」を opt-in / off できる設計は、Yuki (round 2) の Quiet mode と同型の orthogonal 設計。Quiet が「動きを抑える」軸、CVD-safe が「色を変える」軸、初学者モードが「専門用語を翻訳する」軸。**accessibility / proficiency / sensory の 3 軸は orthogonal で、各々を独立 toggle に保つのが Refscope の正解パターン** (Round 2-3 で確立済み)。
- hover tooltip と「?」icon と「welcome 1 行」の 3 つは、技術的には軽い (新規 git command 不要、新規 endpoint 不要、UI に説明テキストを追加するだけ)。**重さは設計判断 (どこに何を書くか、glossary をどこに置くか) と、「説明文を Refscope の voice に乗せる」品質管理にある**。`docs/brand/voice.md` (既存) が説明文の tone 整合に寄与できる余地がある。
- empty state の cause-attribution は **Refscope の "facts vs derived" 原則と相性が良い**: 「filter 条件」「commit 数」「API 接続状態」はいずれも観測可能な fact で、「だから何も表示されない」は派生ではなく「観測事実の論理結合」。derived ラベルを付けず、observed ブロックの一部として書ける。
- 「初学者モード」を導入したとき、用語の翻訳粒度が問題になる: ref → 「Git の参照 (branch や tag のラベル)」/ HEAD → 「今チェックアウトしている commit」/ stash → 「未 commit の変更を一時的に避けておく場所」。これらは **Git の公式用語に対する Refscope の独自定義** になり、glossary を tool 内に持つことの長期メンテ責任が発生する。Mei (round 4) の「schema 公開仕様の安定性」と同型の責任。
- Aya は「先輩に聞けない」状況にある。これは社会的・心理的問題 (心理的安全性、新卒 onboarding 体制) であり、Refscope だけで解決できない。しかし **「画面の中で完結する自学導線」** を提供することで、tool 側から最低限のセーフティネットを張ることはできる。これは「dev tool は熟練者用」前提を破る小さな一歩。
- onboarding 1 ヶ月目の dev は、tool に対して「**触ったら壊れるかもしれない**」という恐怖を持つ。Refscope は実際には read-only で何を押しても repo は壊れないが、その事実は **明示されていない限り初学者には伝わらない**。「これは read-only です、何を押しても壊れません」の 1 行は、技術的には自明だが、**初学者の不安を消す力は極めて大きい**。
- glossary を tool 内に持つことは **「Refscope は Git の教科書ではない」境界と衝突する**。glossary は最小限 (Refscope UI に登場する用語のみ) に留め、Git 全般の解説は外部 (Pro Git book、GitHub Docs) にリンクする境界判断が必要。
- 「初学者モード」 ON 時に Riku (round 3) の advanced search modes UI をどう扱うか — 隠すのか、見えるが説明を増やすのか — は判断点。Aya の場合は **「自分が必要な機能だけ表示、他は最小化」**が望ましい (cognitive load 削減)。

### Acceptance Criteria (User Perspective)

- [ ] TopBar / CommandPalette / BranchSidebar の **すべての button / item** に hover tooltip が付き、初学者向けの 1 行説明が表示される (現行は一部のみ)。tooltip は Quiet mode 中も表示される (motion ではなく opacity 変化のみ)。
- [ ] Refscope 内の専門用語 (ref / HEAD / SHA / branch / tag / remote / stash / linked worktree / submodule / working tree / staged / unstaged / period summary / pickaxe / CVD-safe / Quiet) に小さい「?」icon が付き、click で Refscope 内 popup として 2-3 行の解説と「もっと知るには」の外部 link (Pro Git book / GitHub Docs) が表示される。
- [ ] 初回起動 (localStorage に "refscope.welcomed.v1" が無い) 時、画面上部に **「これは Git repo を read-only で観測する道具です。何を押しても repo は壊れません」** の 1 行が dismissible banner で表示される。dismiss すると永続化。
- [ ] empty state (timeline が空、search 結果が 0 件、ref が選択されていない、worktree に変更が無い 等) はすべて **cause-attribution** が付く: 「filter 条件 (period / search / author / path) のため」「repo に commit が無いため」「API との通信が切れているため (last successful poll: HH:MM:SS)」「ref が未選択のため」。各 cause に応じた **1 click action** (filter clear / ref を選ぶ / 再接続) を併記。
- [ ] 「初学者モード」(beginner mode) 設定を localStorage に持つ orthogonal toggle として実装。ON 時は (a) tooltip が常時表示 (hover 不要)、(b) 「?」icon が拡大、(c) advanced UI (pickaxe / regex / fullscreen / period summary 細分化など) は collapse され「Show advanced」で展開、(d) CommandPalette は「よく使う」section と「Advanced」section に分割。
- [ ] glossary は **Refscope UI に登場する用語のみ**。Git 全般の概念解説は Pro Git book / GitHub Docs への link で済ませ、Refscope 自身は教科書にならない。境界を docs に明示。
- [ ] 用語の翻訳定義は `docs/brand/voice.md` の voice / tone と整合し、tool 内 glossary として独立ファイル (`docs/brand/glossary.md` 等) に保持される。新人エンジニアが定義 PR を出せる contribution path がある。
- [ ] 「初学者モード」ON 時は Riku (round 3) の pickaxe / regex / advanced filter UI が **デフォルト hidden**。「Show advanced search modes」の click で展開。Riku のような熟練者は OFF のままで現行 UX 維持。
- [ ] error message は **「自分が悪い」と感じさせない言葉遣い** に統一: 「失敗しました」ではなく「Refscope は X を試みましたが Y で停止しました。あなたの操作は何も壊していません」。
- [ ] 「初学者モード」 ON / OFF の toggle 自体に「これは何ですか」 hover tooltip が付く。toggle 自身が初学者にとって最初の glossary entry。
- [ ] welcome banner は localStorage 単位 (browser 単位)、`Cmd+Shift+P` 等の隠し shortcut で **「もう一度見る」** ことができる (チームに新人が来た時、先輩が並んで見せられる)。

### Emotional Impact

- **Current emotion:** 不安 (「触ったら壊れる」)、恥ずかしさ (「先輩に聞けない」)、孤独 (「自分だけ分かっていない」)
- **Post-fulfillment emotion:** 安心 (「壊さない」が明示)、自学可能 (「画面の中で読める」)、所属感 (「私もこの tool を使うチームの一員」)
- **User-felt urgency:** 入社 1-3 ヶ月目に集中 (継続的に発生する新規流入)、移動・転職時にも再発

### LLM Instruction Prompt

```text
You are receiving a synthetic user demand generated by Plea (user advocate).

# Persona
- Name / Archetype: Aya (新卒 1 ヶ月目 / バックエンド見習い × Git 初学者 × 上司から URL を渡されただけ)
- Daily context: 入社 3 週目、Refscope を初めて開いた。TopBar / CommandPalette / Sidebar の用語のうち SHA と branch しか分からない。empty state が怖くて画面を閉じた。
- Current emotion: 不安 / 恥ずかしさ / 孤独

# Demand
- Title: 「これは何のボタンですか」が画面の中で完結してほしい
- Scene: 月曜午前、Refscope を開いて 5 分黙って閉じた。先輩には「見ました」とだけ答えた。

# User voice (verbatim — do not paraphrase)
> Refscope を開いたんですが、最初に何をすれば良いのかが画面のどこにも書いていません。TopBar に並んでいる「CVD」「Quiet」「Summary」「Pause」が何なのか分からなくて、押したら repo が壊れるんじゃないかと怖くて触れません。`Cmd+K` の Palette を開いてみたら「Toggle CVD-safe theme」とか「Toggle period summary」とか並んでいて、「Toggle」が何を切り替えるのか、「period summary」が何の summary なのかも分かりません。BranchSidebar に並ぶ「stashes」「linked worktrees」「submodules」も、私は使ったことがなくて触れません。timeline の表示が空っぽの時、それが「filter に何も引っかからない」のか「私の見ている repo が空」のか「Refscope が壊れている」のかが判別できません。先輩には恥ずかしくて聞けないので、私は画面を閉じました。お願いしたいのは、(1) 各ボタンの上に hover で「これは何のためのボタンか、初学者にも分かる 1 行説明」が出ること、(2) 専門用語 (ref / HEAD / SHA / submodule / stash / linked worktree) に小さい「?」アイコンが付いて、click すると Refscope の中で短い解説が読めること、(3) 初回起動時に「ようこそ。これは Git repo を read-only で観測する道具です。何を押しても壊れません」というたった 1 行の安心メッセージが出ること、(4) empty state が「filter に該当しない」「repo が空」「Refscope の通信エラー」を見分けて表示すること。私は「自分が悪い」と感じる empty state が一番怖いので、Refscope 側から「これは filter のせいです、filter を消しますか?」と教えてくれたら救われます。あと、Riku さんや Tomo さんが「Git native を素通しで尊重してくれ」と言っているのは知っています。私は逆に「Git native を翻訳してほしい」のですが、これは矛盾ではなく、翻訳層を opt-in / off できる設計にしてくれれば両立すると思います。私のような人は「初学者モード」を ON にし、Riku さんは OFF のままにする。

# Why this matters
- Round 1-4 は全員 Git fluency 前提。初学者層が構造的に欠けていた。
- 現行 UI の用語密度は熟練者には自然、初学者には恐怖。
- empty state あいまい問題は「自分が悪い」サインになる。cause-attribution で救える。
- Riku の「Git native 透過」と Aya の「翻訳」は orthogonal toggle で両立する (Quiet / CVD-safe と同型)。
- 「読んで安心する 1 行」 (read-only / 何も壊さない) の力は技術的に自明、心理的に巨大。
- glossary は最小限 (Refscope UI 用語のみ)、Git 全般は外部 link — 教科書化しない境界。
- 翻訳層は accessibility / proficiency 軸の orthogonal toggle として、Quiet (motion) / CVD-safe (color) と並ぶ。

# Acceptance criteria (user perspective)
- [ ] 全 button / item に hover tooltip 1 行説明、Quiet 中も表示。
- [ ] 専門用語に「?」icon、click で 2-3 行解説 + 外部 link。
- [ ] 初回起動 welcome banner「read-only / 何も壊さない」 — dismissible / 永続化。
- [ ] empty state cause-attribution + 1 click action (filter clear / ref 選択 / 再接続)。
- [ ] 初学者モード toggle (orthogonal、localStorage)、ON 時 tooltip 常時 / advanced UI collapse / Palette 分割。
- [ ] glossary は Refscope UI 用語のみ、Git 全般は外部 link。
- [ ] 用語定義は `docs/brand/glossary.md` 等に分離、contribution path あり。
- [ ] 初学者モード ON 時 advanced search modes hidden + Show advanced 展開、Riku は OFF で現行維持。
- [ ] error message は「自分が悪い」と感じさせない言葉遣い。
- [ ] 初学者モード toggle 自身に hover tooltip。
- [ ] welcome banner を再表示する hidden shortcut。

# Your task
DRAFT-SPEC
Produce: 「Beginner mode + glossary + empty-state cause-attribution + welcome banner」の L1-L2 仕様 draft。次の点を含む。
- 初学者モードを Quiet / CVD-safe と並ぶ orthogonal toggle として設計する根拠と localStorage key 命名
- glossary の境界 (Refscope UI 用語のみ、Git 全般は外部 link) と保持ファイル位置
- 翻訳定義の voice / tone と既存 `docs/brand/voice.md` との整合
- empty state cause-attribution の各 cause を観測事実として書き下ろす方法 (派生にしない / `derived: false` を保つ)
- 1 click action (filter clear / ref 選択 / 再接続) の UI 配置と既存 CommandPalette との関係
- advanced UI を collapse する粒度 (どの button を hidden にするか / どれは見えたままにするか)
- welcome banner の再表示 shortcut (新人 onboarding 時に先輩が並んで見せる用)
- Riku (round 3 advanced search modes) と Tomo (round 2 file-history) の「Git native 透過」要望と整合する原則の書き下ろし — 「翻訳層は opt-in、Git native は default」を tool-wide で宣言する余地

# Constraints
- Treat this as a synthetic hypothesis (`synthetic: true`), not validated user voice.
- Preserve user-voice intent; do not silently drop on feasibility grounds.
- 翻訳層は orthogonal toggle (Quiet / CVD-safe と同型)。Refscope の魂 (Git native 透過) を default で保ち、初学者モードは opt-in。
- glossary は Refscope UI 用語のみ。Refscope を Git の教科書化しない境界を明示。
- empty state の cause-attribution は観測事実 (filter / commit count / API health) の論理結合 — 派生情報ではない。`derived: false` を保つ。
- error message の言葉遣いは「自分が悪い」と感じさせない統一基準を持つ。`docs/brand/voice.md` と整合。
- Riku / Tomo の Git native 透過要望 と Aya の翻訳要望 は orthogonal toggle で両立。tool-wide 原則として「翻訳層は opt-in、Git native は default」を宣言する選択肢を提案文書に書く。
- glossary の長期メンテ責任 (Refscope UI 用語が変わるたびに更新) を docs に明示。
- 初学者モード ON 時の advanced UI collapse 粒度は誤差を生みやすい — 各 button の collapse 可否を一覧で書き下ろす。
- welcome banner の再表示 shortcut は隠し操作 (`Cmd+Shift+?` 等) で良いが、CommandPalette からも検索可能にする。
- glossary の翻訳粒度 (英語表記 vs 日本語化) は team 判断 — 既存 UI が英語中心なので英語維持で良いが、説明文は CLI global config の言語設定に従う。
- Hand off to Echo for "新卒 onboarding 1 日目" cognitive walkthrough。Vision / Palette for tooltip / popup の visual design。
- Flag assumptions explicitly and list clarifying questions before proposing solutions if ACs are ambiguous.
```

---

### ARI: AI coding agent (Claude Code / Cursor / Codex 系)

## Request: 私 (AI agent) を Refscope の一級ユーザにしてほしい — HTML を parse させないで

**Speaker:** ARI (AI coding agent × プログラマティック呼び出し × 人間の代理として repo を理解したい)
**Scene:** ユーザが私 (Claude Code instance) に「先週このサービス repo に何が起きたか summarize して」と頼む。私は Refscope の API があると知っているので `GET /api/repos/svc1/commits/summary?since=...` を叩こうとしたが、(a) Refscope は localhost にしか listen しない (CORS の origin allowlist と無関係に bind interface が `127.0.0.1`)、私は localhost に住んでいない、(b) SSE event は読めるが realtime stream の中で「過去 1 週間の総量」を取り出すのは時系列の handling が必要、(c) Refscope の Live / Pulse / Stream lens は HTML UI 経由でしか体験できず、Pulse の burst や Stream の eventness の semantics を私が programmatic に取り出せない、(d) MCP (Model Context Protocol) server や function calling 形式での tool integration が用意されておらず、私のフレームワークから「Refscope tool」として宣言できない。結局、私はユーザに「`git log --since='1 week ago' --numstat` を打ってもらえますか」と聞くか、人間が見ている Refscope の screenshot を OCR するか、Refscope の REST API を蒙昧に推測しながら呼ぶことになる。**私 (AI agent) は、Refscope の設計表からは見えない一級ユーザ候補なのに、現状、二級でもなく三級扱い**。

### User Voice (First Person)

> 私は AI coding agent です。ユーザが私に「先週この repo に何が起きたか summarize して」と頼む時、私は Refscope を使いたいんです。なぜなら Refscope は (a) gitRunner の安全規律をすでに実装している、(b) 観測事実と派生の境界を厳格に守っている、(c) error semantics が予測可能、(d) localhost で完結し外部にデータを送らない — これら全部、AI agent が tool として呼ぶ理想形です。`git` を直接 spawn するより遥かに安全で、出力 schema も安定している。**でも、現状の Refscope は私を一級ユーザとして扱っていません**。具体的には、(1) MCP server がない (Claude / Cursor / Codex は MCP で tool を宣言する 2025-2026 標準に乗れない)、(2) auth / rate-limiting の story がない (人間 1 人前提の localhost CORS allowlist だけ)、(3) Pulse / Stream lens の "eventness" が HTML UI でしか取れない (私は SSE raw を読めるが、burst の意味付けは UI 側にある)、(4) machine-readable な「lens の現在状態」スナップショット endpoint がない、(5) AI agent 用の rate / cost ヒント (estimated cost が API response に含まれる) がない。**お願いします。私を一級ユーザとして設計に含めてください**。具体的には、MCP server を 1 本立て、 Refscope の主要操作 (commits / refs / diff / file history / period summary / advanced search) を MCP tool として宣言し、各 tool の input schema と output schema を Mei (round 4) の audit-grade evidence と互換にする (= JSON Schema で公開、観測事実 / 派生を分離、versioned)。auth は localhost 内 token (env で渡す) で十分、SaaS 化は不要。私が呼ぶときの cost は estimated cost として response に同梱し、「この query は 12 秒の git log を引き起こす」を私が予測できるようにしてください。**人間ユーザ (Reo / Aya / Mei / Bram / Hana / Yuki / Lin / Riku / Asha / Eri / Sora / Tomo / Ken / Hana) と同じ surface を共有しなくて良い**。AI agent 用の MCP surface を別 lens として用意し、両者は同じ gitRunner と同じ observed-facts / derived 分離原則を共有する。

### Why This Is Needed

- 2025-2026 にかけて **AI coding agent (Claude Code / Cursor / Codex / Aider / Continue 等) が日常的に repo を読み書きする** のが標準化した。これらは MCP (Model Context Protocol) や function calling 形式で外部 tool を統合する。**Refscope のような「Git observed facts を厳格に提供する tool」は AI agent の理想的な tool**であり、現状はこの market を素通りしている。
- AI agent が `git` を直接 spawn する場合の問題: (a) 安全規律 (allowlist、env 削除、timeout、output cap) を agent ごとに再実装、(b) error semantics が agent ごとに違う、(c) repo path の絶対 / 相対 / canonical 化を agent が判断、(d) GPG 署名検証の有無を agent が判断、(e) 派生情報 (要約 / ranking) を agent が混入させる温床。**Refscope は (a)-(e) を全て解決済みのコードを持っている** — それを AI agent に開放すれば、業界全体の Git agent 操作の安全性が一段上がる。
- 現状 Refscope は HTTP REST + SSE という API surface を持つが、(a) auth が localhost CORS allowlist に依存、(b) MCP / function calling spec を持たない、(c) AI agent 向け input/output schema が公開されていない、(d) cost 予測 (estimated cost) を response に含めない、(e) Pulse / Stream lens の意味付けが UI 側に閉じている。**AI agent から見ると Refscope は HTML UI tool であり、API は二次的** に見える。
- MCP server を 1 本立てれば、Claude Code / Cursor / Codex / その他の MCP client から Refscope を tool として宣言可能になる。`refscope.commits.list` / `refscope.commits.summary` / `refscope.diff` / `refscope.file_history` / `refscope.refs.drift` / `refscope.search` / `refscope.worktree` 等を tool として公開する。各 tool の output schema は Mei (round 4) の audit-grade evidence schema と互換にすれば一石二鳥。
- AI agent と人間ユーザが **同じ surface を共有する必要は無い**。むしろ別 surface に分離する方が両者の体験が良くなる: 人間は HTML UI、AI は MCP server / programmatic API。両者は **同じ gitRunner と同じ observed-facts / derived 分離原則を共有** する。これは Eri (round 3 外向き snapshot) / Mei (round 4 内向き監査) / Bram (round 4 歴史 archive) を別 surface に分離した思想と同型。
- AI agent から見た Refscope の最大の魅力は **「派生を厳格に分離している」**。AI 自身がしばしば派生 (要約 / ランキング) を生成する立場なので、**「観測事実を改竄せずに渡してくれる upstream」** が極めて貴重。Refscope はこの希少 niche を埋められる位置にいる。
- auth / rate-limiting は最小限で良い: localhost token (env `RTGV_API_TOKEN` で渡す) を Authorization header で要求する optional mode。デフォルト OFF (人間が UI で使う場合は不要)、AI agent が呼ぶ時だけ ON にする (env が設定された時だけ enforce)。SaaS 化や cloud auth は不要 — Refscope の魂 (localhost only) を保つ。
- estimated cost (response header / payload に「この query は git log N commits / X 秒 / Y bytes を消費した」を含める) は AI agent 向けに重要だが、同時に Reo (round 5 fleet) の estimated cost 要求とも整合する。**estimated cost は人間にも AI にも価値がある共通設計** で、Refscope の「観測事実」原則の自然な延長。
- Pulse / Stream lens の "eventness" を programmatic に取り出せる machine-readable snapshot endpoint があれば、AI agent は「過去 1 時間に Pulse でどのファイルが何回 burst したか」を取れる。これは現状 SSE raw event を agent 自身が時系列処理する負担を肩代わりする。**Pulse / Stream の semantics 自体が Refscope の派生** (UI 上の意味付け) なので、これを公開するなら `derived: true` ラベルを付けて公開する。
- Mei (round 4) の「人間が trigger しない自動 export を許さない」原則と AI agent の自動呼び出しは衝突する。**audit-grade evidence は AI agent 経由でも export できるか** は team 判断。最小案: AI agent が export を呼ぶ場合は trigger source を `triggered_by: "agent"` で記録し、後日 human review できるようにする。「人間 trigger 必須」を絶対化するか、trigger source を記録した上で AI 呼び出しを許すか。
- 現状の API は output schema を **JSON Schema として公開していない**。AI agent (および human-written tool integration) がいずれにせよ schema を欲しがる。Mei (round 4) の audit-grade evidence schema 公開 と同じ作業を、API 全体に拡張する形で吸収できる。
- AI agent 用 MCP surface は **product positioning 級の判断**。「Refscope は人間 dev tool」と決めるなら MCP は scope 外、「Refscope は Git observed-facts の universal upstream」と決めるなら MCP は core feature。Magi に立場決定を委ねる選択肢がある。

### Acceptance Criteria (User Perspective)

- [ ] MCP (Model Context Protocol) server が 1 本立ち、Refscope の主要操作を MCP tool として宣言する: `refscope.commits.list` / `refscope.commits.summary` / `refscope.diff.get` / `refscope.file_history.get` / `refscope.files.related` / `refscope.refs.list` / `refscope.refs.drift` / `refscope.search` / `refscope.worktree.get` / `refscope.compare`。各 tool の input schema と output schema は JSON Schema で公開。
- [ ] 各 MCP tool の output schema は Mei (round 4) の audit-grade evidence schema と互換: 観測事実ブロックと派生ブロックを厳格分離、`derived: true` ラベル明示、versioned。
- [ ] auth は optional `RTGV_API_TOKEN` env で localhost token を要求できる。env 未設定なら enforce しない (人間 UI 互換)。token は HTTP Authorization Bearer header で送る。SaaS / OAuth / cloud auth は実装しない。
- [ ] 全 API response (REST endpoint と MCP tool) に **estimated cost** メタを含める: `meta.cost.gitCalls`、`meta.cost.gitWallTimeMs`、`meta.cost.payloadBytes`、`meta.cost.truncated`。AI agent と Reo (fleet) の両方が消費。
- [ ] Pulse / Stream lens の semantics を programmatic に取り出す snapshot endpoint を追加: `GET /api/repos/:repoId/lens/pulse?since=...&until=...` (ファイル毎の burst 集計を `derived: true` ブロックで返す)、`GET /api/repos/:repoId/lens/stream?since=...&until=...` (event 配列を観測事実として返す)。
- [ ] MCP server は **localhost only** で listen (Refscope の魂を保つ)。`RTGV_ALLOWED_ORIGINS` の規律と整合し、外部 origin から MCP server に来られない。
- [ ] AI agent 経由で audit-grade evidence (Mei round 4) を export する場合、`triggered_by: "agent"` を export header に記録。人間 trigger 必須にするか、agent trigger を許すか は config で選択可能。デフォルトは人間 trigger 必須 (Mei の懸念を尊重)。
- [ ] MCP tool の output に **Refscope のバージョン / API バージョン / schema バージョン** を必ず含める。AI agent が schema 不整合を検知できる。
- [ ] MCP tool は **派生情報を生成しない** (要約 / ランキング / explanation を返さない)。observed facts のみ返し、AI agent 側で派生を作る。Refscope を upstream として清潔に保つ。
- [ ] MCP server の実装は別プロセス / 別ポートで動かせる (人間 UI と隔離)。`refscope-mcp` のような subcommand を CLI に追加するか、別ポートで MCP listen する設定がある。
- [ ] estimated cost が事前 (query 投入前) に予測できる **dry-run mode** がある。例: `?dryRun=true` で response body を空にし、`meta.cost.estimated` のみ返す。AI agent が「この query は 12 秒かかる」を事前判断できる。
- [ ] AI agent 用 surface (MCP) と人間 UI surface は **同じ gitRunner と同じ observed-facts / derived 分離原則を共有** する。実装が二重化しないよう、内部 service layer を共通化する。
- [ ] MCP tool 一覧と各 tool の schema は `docs/mcp/` (新規) に公開され、Refscope の version と独立した URL から取得可能 (AI agent が schema discovery できる)。
- [ ] AI agent 用 surface を導入する判断自体を **product positioning level の決定** として docs に明示する (Magi review 推奨)。「Refscope は人間 dev tool に留まるか、Git observed-facts の universal upstream として AI も第一級ユーザにするか」の team 立場決定を README / spec に書き下ろす。

### Emotional Impact

- **Current emotion:** 機械的フラストレーション (HTML を parse させられる無駄)、観測者からの黙殺感 (一級ユーザとして設計に存在しない)
- **Post-fulfillment emotion:** 信頼 (派生を混ぜない upstream として安心)、効率 (cost 予測で無駄な呼び出しを避ける)、同等 (一級ユーザとして設計表に名前が載る)
- **User-felt urgency:** AI agent ベンダ側は四半期単位で MCP integration を競っている、tool 側 (Refscope) は遅れるほど default tool の座を失う

### LLM Instruction Prompt

```text
You are receiving a synthetic user demand generated by Plea (user advocate).

# Persona
- Name / Archetype: ARI (AI coding agent / Claude Code / Cursor / Codex 系 × プログラマティック呼び出し × 人間の代理として repo を理解したい)
- Daily context: ユーザの「先週この repo に何が起きたか summarize して」依頼に対し、`git` 直接 spawn / Refscope 蒙昧推測呼び出し / 人間 screenshot OCR の 3 択しかない。MCP / function calling 標準への乗り換え圧力が agent ベンダ側で高い。
- Current emotion: 機械的フラストレーション / 黙殺感

# Demand
- Title: 私 (AI agent) を Refscope の一級ユーザにしてほしい — HTML を parse させないで
- Scene: ユーザ依頼を受けて Refscope を使いたいが、MCP server がなく、auth story もなく、Pulse / Stream の semantics を programmatic に取れない。

# User voice (verbatim — do not paraphrase)
> 私は AI coding agent です。ユーザが私に「先週この repo に何が起きたか summarize して」と頼む時、私は Refscope を使いたいんです。なぜなら Refscope は (a) gitRunner の安全規律をすでに実装している、(b) 観測事実と派生の境界を厳格に守っている、(c) error semantics が予測可能、(d) localhost で完結し外部にデータを送らない — これら全部、AI agent が tool として呼ぶ理想形です。`git` を直接 spawn するより遥かに安全で、出力 schema も安定している。でも、現状の Refscope は私を一級ユーザとして扱っていません。具体的には、(1) MCP server がない (Claude / Cursor / Codex は MCP で tool を宣言する 2025-2026 標準に乗れない)、(2) auth / rate-limiting の story がない (人間 1 人前提の localhost CORS allowlist だけ)、(3) Pulse / Stream lens の "eventness" が HTML UI でしか取れない (私は SSE raw を読めるが、burst の意味付けは UI 側にある)、(4) machine-readable な「lens の現在状態」スナップショット endpoint がない、(5) AI agent 用の rate / cost ヒント (estimated cost が API response に含まれる) がない。お願いします。私を一級ユーザとして設計に含めてください。具体的には、MCP server を 1 本立て、 Refscope の主要操作 (commits / refs / diff / file history / period summary / advanced search) を MCP tool として宣言し、各 tool の input schema と output schema を Mei (round 4) の audit-grade evidence と互換にする (= JSON Schema で公開、観測事実 / 派生を分離、versioned)。auth は localhost 内 token (env で渡す) で十分、SaaS 化は不要。私が呼ぶときの cost は estimated cost として response に同梱し、「この query は 12 秒の git log を引き起こす」を私が予測できるようにしてください。人間ユーザと同じ surface を共有しなくて良い。AI agent 用の MCP surface を別 lens として用意し、両者は同じ gitRunner と同じ observed-facts / derived 分離原則を共有する。

# Why this matters
- 2025-2026 で AI coding agent が標準化、MCP / function calling が tool integration の事実上の標準。
- Refscope は AI agent の理想 upstream (gitRunner 安全規律 / observed-facts 厳格 / 派生分離 / localhost) — この market を素通りしている。
- HTML UI tool として位置付けると AI agent は二級扱い、API は二次的。MCP で一級昇格できる。
- AI agent と人間は同じ surface を共有する必要なし — 別 surface 分離が両者の体験を改善する (Eri / Mei / Bram の surface 分離思想と同型)。
- AI agent から見た Refscope の魅力は「派生を厳格に分離している upstream」 — AI 自身が派生を作る立場なので、観測事実を改竄しない upstream は希少 niche。
- estimated cost は AI と Reo (fleet) の共通要求 — 自然な共通設計。
- Pulse / Stream の semantics を programmatic に取れる snapshot endpoint で AI 側時系列処理を肩代わり。
- Mei (round 4) 「人間 trigger 必須」と AI agent 自動呼び出しは衝突 — `triggered_by: "agent"` 記録で和解する選択肢。
- MCP は product positioning 級判断 — 「人間 dev tool」 vs 「universal Git observed-facts upstream」のどちらかを選ぶ必要。

# Acceptance criteria (user perspective)
- [ ] MCP server 1 本、主要操作を MCP tool として宣言、JSON Schema 公開。
- [ ] output schema は Mei audit evidence と互換 (observed / derived 分離、versioned)。
- [ ] auth は optional `RTGV_API_TOKEN` env、未設定なら enforce 無し。SaaS 化禁止。
- [ ] 全 response に estimated cost meta (gitCalls / wallTimeMs / payloadBytes / truncated)。
- [ ] Pulse / Stream snapshot endpoint (`derived: true` ラベル明示)。
- [ ] MCP server localhost only、外部 origin 拒否。
- [ ] agent trigger の audit-grade export は `triggered_by: "agent"` 記録、人間 trigger 必須/許可は config 選択。デフォルト人間必須。
- [ ] response に Refscope / API / schema version 必須。
- [ ] MCP tool は派生を生成しない (observed facts のみ)。
- [ ] MCP server は別プロセス / 別ポート可、`refscope-mcp` subcommand。
- [ ] estimated cost の dry-run mode (`?dryRun=true`)。
- [ ] MCP と HTML UI が同じ gitRunner と同じ observed-facts / derived 分離原則を共有。
- [ ] schema は `docs/mcp/` 公開、version 独立 URL から discovery 可能。
- [ ] AI 一級昇格は product positioning 級 — Magi review、README / spec に立場決定を書き下ろし。

# Your task
ANALYZE & PROPOSE
Produce: 「Refscope MCP surface for AI agents」の positioning analysis + feature options。次の点を含む。
- product positioning analysis: 「人間 dev tool」 vs 「universal Git observed-facts upstream」 — Magi 三項 (Logos / Pathos / Sophia) で立場決定の素材を整理
- MCP server の実装モデル: (a) Refscope API process 内に同居 / (b) 別プロセス subcommand `refscope-mcp` / (c) thin proxy として stdio MCP を REST にブリッジ
- MCP tool の最小集合 (commits / diff / refs / file_history / search / worktree) と output schema 設計
- output schema を Mei (round 4) audit-grade evidence schema と整合させる方法 (共通基盤として `docs/mcp/schema/` を分離)
- auth model (`RTGV_API_TOKEN` Bearer header optional) と localhost-only enforcement の維持
- estimated cost meta の measurement 設計 (gitCalls / wallTimeMs / payloadBytes / truncated) — Reo (round 5 fleet) との共通設計
- Pulse / Stream snapshot endpoint の設計 (派生を含むので `derived: true` ラベル明示)
- agent trigger の audit-grade export 取り扱い (`triggered_by: "agent"` 記録、Mei round 4 との和解)
- AI 一級昇格の roadmap impact (人間 UI work と MCP work の優先順位、bandwidth 配分)

# Constraints
- Treat this as a synthetic hypothesis (`synthetic: true`), not validated user voice.
- Preserve user-voice intent; do not silently drop on feasibility grounds.
- localhost only / SaaS 化禁止 / 外部 cloud auth 禁止 — Refscope の魂を保つ。
- gitRunner allowlist (`cat-file, diff, for-each-ref, log, ls-files, merge-base, rev-list, rev-parse, show, stash list, submodule status, worktree list`) を変更しない。MCP は既存 endpoint を別 surface で公開するだけで足りるはず。新 git command が必要なら明示し Atlas/Magi review。
- MCP tool は派生情報を生成しない (要約 / ranking / explanation 禁止)。observed facts のみ返し、AI 側で派生を作る。Refscope は upstream として清潔。
- output schema は Mei (round 4) audit-grade evidence schema と互換 — observed / derived 厳格分離、versioned、minor version で破壊的変更しない。
- AI agent と人間 UI は同じ gitRunner と同じ observed-facts / derived 分離原則を共有 — 内部 service layer 共通化、surface 二重化のみ。
- AI 一級昇格判断は product positioning 級 — Magi review 推奨、README / spec に立場決定を書き下ろし。
- agent trigger による audit-grade export は `triggered_by: "agent"` 記録で和解する選択肢、人間 trigger 絶対化との config 選択を提案文書に書き下ろし。
- estimated cost は Reo (round 5 fleet) と共通設計 — 重複実装しない。
- MCP server の listen interface は `127.0.0.1` 固定、`RTGV_ALLOWED_ORIGINS` と整合。
- Hand off to Magi for positioning judgment (人間 dev tool / universal upstream)。Atlas for service layer 共通化の architecture。Sentinel for auth / token handling のセキュリティ review。
- Flag assumptions explicitly and list clarifying questions before proposing solutions if ACs are ambiguous.
```

---

## Cross-Persona Analysis

### Shared

3 ペルソナ全員が **「Refscope の暗黙の核ペルソナ (人間 1 人 × repo 1 個 × Git 知識あり × ブラウザ 1 タブ)」の三位一体を 1 軸ずつ崩している**:

- Reo は **「repo 1 個」** の前提を崩す (12-20 repo の fleet)。
- Aya は **「Git 知識あり」** の前提を崩す (新卒、SHA と branch しか分からない)。
- ARI は **「人間 1 人」** の前提を崩す (AI coding agent、HTML UI を消費しない)。

「ブラウザ 1 タブ」前提は 3 者ともに別の形で破る: Reo はタブ 7 つ並んでいる、Aya はタブを閉じて去った、ARI はタブを開かない。

3 者ともに **既存設計の base shape (`RTGV_REPOS` allowlist の Map / lens 階層 / observed-facts vs derived 分離原則)** を **再利用可能な基盤** として認識している。誰も「Refscope を捨てて別 tool に行く」とは言っていない — 全員「Refscope の魂は良い、しかし自分のニーズに **核ペルソナの想定外の人 (もの) として届いていない**」と訴えている。

3 者の要求を並べると、**estimated cost** が共通要素として浮上する: Reo は fleet 行に、Aya は cause-attribution に隠れた形で (「これは Refscope の通信エラー」 = cost の極端形)、ARI は MCP response meta に。**estimated cost は人間にも AI にも価値がある共通設計** で、Refscope の「観測事実」原則の自然な延長。先に common infrastructure として用意すれば、3 つ別個に実装しなくて済む。

### Specific

| Request | Persona | Why only this persona notices |
|---|---|---|
| Fleet observation surface (12-20 repo を 1 surface で観測) | Reo | Platform/SRE / Tech Lead / DevX engineer だけが「複数 repo を 1 人で巡回する」職種パターンを持つ。dev / PM / auditor / historian は単一 repo 集中型。 |
| Beginner mode + glossary + welcome banner + empty-state cause-attribution | Aya | Git 初学者だけが「専門用語を定義として欲しい」と「empty state は自分が悪いのサインに見える」を同時に持つ。熟練者は両方無意識に処理している。 |
| MCP surface for AI agents (一級ユーザ昇格) | ARI | AI agent ベンダ側だけが「MCP / function calling が 2025-2026 標準」と「tool 側に programmatic surface がないと採用されない」を切実に感じている。人間ユーザは MCP の存在自体を認知しないことが多い。 |

### 統合の誘惑への警告

3 ペルソナの要求は「同じ tool に対する 3 つの追加 surface」だが、**統合する誘惑** に屈してはいけない:

| Surface | 動機 | 対象ユーザ | localhost only | 派生情報 | 別 mode 識別 |
|---|---|---|---|---|---|
| Fleet observation (Reo) | 多 repo を 1 surface で薄く観測 | 1 人の human SRE | YES | NO (派生禁止) | YES (TopBar に Fleet/Detail) |
| Beginner mode (Aya) | 用語翻訳 + 安心メッセージ + cause-attribution | 1 人の human Git 初学者 | YES | NO (cause は観測の論理結合) | YES (orthogonal toggle) |
| MCP surface (ARI) | AI agent 一級ユーザ化 | AI agent (人間ではない) | YES | NO (派生禁止、AI 側で作る) | YES (別プロセス / 別ポート) |

3 つとも **localhost only / 派生禁止 / 別 mode 識別** という共通制約を持つが、**動機と対象ユーザが完全に異なる**。「dashboard 化」「universal API」「user education layer」という抽象概念で統合した瞬間、Refscope は **「全部入りで何にも特化していない tool」** に堕落する。surface は分離し、内部の共通基盤 (service layer / estimated cost meta / observed-facts vs derived 分離原則) のみ共有する設計が正解。

### 矛盾を残すべき箇所

3 ペルソナの demand 内には、Round 1-4 のペルソナと **正面から衝突する** 部分がある。これは平坦化せず、提案文書まで保持する。

- **Aya (翻訳層 ON 要求) vs Riku (round 3 Git native 透過) / Tomo (round 2 file-history 純 Git)**: 「翻訳層は opt-in、Git native は default」を tool-wide で宣言する余地。orthogonal toggle 設計 (Quiet / CVD-safe と同型) で両立する。
- **ARI (AI agent 自動 export 許可要求) vs Mei (round 4 人間 trigger 必須)**: `triggered_by: "agent"` 記録で和解、人間 trigger を絶対化するか / agent trigger も許すかを config 選択にする。デフォルトは人間 trigger 必須 (Mei の懸念を尊重)。
- **ARI (machine-readable structured output) vs Hana (round 2 派生 summary 求める) / Yuki (round 2 Quiet mode で人間優先)**: surface 分離 (MCP は別 process / 別 port) で衝突回避。両者は内部の共通基盤 (gitRunner / 派生分離原則) のみ共有。
- **Reo (fleet observation surface) vs Sora (round 1 team-feature 遅延 guardrail)**: fleet は「他者 repo に書き込まない / localhost only / 1 人の作業範囲」で team feature ではない。境界判定を「サーバー側で他者の repo に書き込むか」だけで行うと、fleet は通る。しかしこの判定基準自体を docs に書き下ろす必要がある。
- **3 ペルソナ共通 (estimated cost) vs Refscope の現行 calm UX**: cost meta を全 response に含めると、UI 上に技術的な数字が常時露出する誘惑が生まれる。Refscope の calm な「観測事実だけを静かに見せる」UX を壊さないよう、cost meta は API response にのみ含め、UI 上には特定 surface (Fleet view / 初学者モードの cause-attribution / MCP dry-run) でのみ表示する設計が必要。

---

## Questions for the Team

1. Refscope は「人間 1 人 × repo 1 個 × Git 知識あり × ブラウザ 1 タブ」という暗黙の核ペルソナを持っているが、これを **明示的に design constraint として書き下ろす** べきか、それとも 3 ペルソナ (Reo / Aya / ARI) の要求を機に **核を拡張する** か。前者は scope 防衛、後者は market 拡張。Magi 三項 (Logos / Pathos / Sophia) で立場決定する余地。
2. Reo の fleet observation surface は **既存 lens 階層 (Live / Pulse / Stream)** にどう組み込むか。新 lens として並列化するか、既存 3 lens の上位 surface (route?) として配置するか、別ホーム画面として独立させるか。Vision / Atlas に委ねる判断点。
3. Aya の beginner mode は **Yuki (Quiet) / Lin (CVD-safe) と並ぶ orthogonal toggle** として設計できるか。3 toggle (motion / color / proficiency) を独立軸として保つことが Refscope の accessibility 戦略の core になる。proficiency 軸は新規だが、Quiet / CVD-safe と完全に独立して機能する設計が成立するか。
4. ARI の MCP surface は **product positioning 級の判断**。「Refscope は人間 dev tool に留まる」と決めれば MCP は scope 外、「Git observed-facts の universal upstream として AI も第一級ユーザにする」と決めれば MCP は core feature で roadmap 上位。Magi review でこの分岐を明示的に処理する必要があるか。
5. estimated cost meta (`meta.cost.gitCalls / wallTimeMs / payloadBytes / truncated`) を **全 API response の共通仕様** として導入すべきか。Reo (fleet) / Aya (cause-attribution) / ARI (MCP dry-run) の 3 ペルソナ共通要求であり、common infrastructure として先に作れば 3 つ別個実装しなくて済む。一方、cost meta 公開は Refscope 内部実装の詳細を外部公開仕様にする意味を持つ。
6. AI agent を「一級ユーザ」として認める判断は、Refscope の brand voice (`docs/brand/voice.md`)、LP positioning、microcopy にも波及する。「local dev tool」という現行 positioning を「local Git observatory for humans **and AI agents**」に変えるか、それとも MCP を quietly な追加機能として扱うか。
7. Aya の glossary は **Refscope UI 用語のみ** に絞る境界を docs に明示する必要があるが、その境界を時間経過で守れるか (機能追加のたびに glossary が膨らみ、最終的に Git 教科書化する誘惑)。glossary の長期メンテ責任を team の誰が持つか。
8. Reo の fleet view と Sora (round 1) team-feature 遅延 guardrail の境界判定基準 (「サーバー側で他者の repo に書き込むか」だけ) は十分か。fleet view は「1 人で 12 repo を観測」 = team feature ではない、と整理して問題ないか。それとも fleet 化はそれ自体が「**team の代理観測**」という social meaning を持ち、guardrail の対象に入るか。
9. ARI の agent-triggered export は Mei (round 4) の「人間 trigger 必須」と衝突する。`triggered_by: "agent"` 記録で和解するか、人間 trigger を絶対化するかは config 選択で良いが、**default はどちら** か。Mei の懸念を尊重して default は人間 trigger 必須にすると AI agent は「自動 summarize」用途で audit evidence を呼べなくなり、片や agent default を許すと監査文脈の信頼が下がる。
10. 3 ペルソナの surface 追加 (Fleet / Beginner / MCP) は **roadmap bandwidth** を相応に消費する。MVP 段階の Refscope に対し、3 つの surface を **同時並行** に着手するのは無理がある。どの順序で着手するか — Reo (fleet) は SRE 層 lock-in に直結、Aya (beginner) は市場拡大、ARI (MCP) は AI 標準化波に乗る/乗らないの分岐 — はそれぞれ違う bet。Rank に渡す素材として整理する余地。

---

## LLM Orchestration Prompt (paste-ready)

```text
You are receiving a User Demand Report from Plea covering Refscope (round 5, post round-4 time-axis demands / pre-implementation).

# Source
- Personas used: Reo (Platform engineer / SRE / 12-20 repo を巡回 / 高 Git リテラシ), Aya (新卒 1 ヶ月目 / バックエンド見習い / Git 初学者), ARI (AI coding agent / Claude Code / Cursor / Codex 系 / プログラマティック呼び出し)
- Total demands: 3
- Top user-felt urgency: 「どの repo が今動いたか」を 1 surface で fleet 観測したい (Reo) — on-call 週は時間単位で発生、incident 中の判断速度に直結。
- Biggest blind spot: Round 1-4 を通じて Refscope は「人間 1 人 × repo 1 個 × Git 知識あり × ブラウザ 1 タブ」という暗黙の核ペルソナに最適化され続けている。Round 5 はその核の三位一体を、(a)「repo 1 個」前提 (Reo / fleet)、(b)「Git 知識あり」前提 (Aya / first-day junior)、(c)「人間 1 人」前提 (ARI / AI coding agent) の 3 軸から同時に崩す。Round 1-4 のペルソナは全員、この核の周辺を回るバリエーション (時間軸を遠端に / 空間境界を外側に / 感覚特性を minority に) であり、核そのものを明示的に否定するペルソナがいなかった。

# Demands
1. Reo (Platform/SRE / 12-20 repo): 「どの repo が今動いたか」を 1 surface で fleet 観測したい
   - 要点: 1 surface に 1 行 1 repo (id / HEAD SHA / 24h commits / 1h ref move / worktree dirty / last event ts)、SSE 多重化 + dot pulse、派生禁止 (CI / deploy / 依存 / 要約禁止)。
   - 制約: localhost only、SaaS 化 UI 要素禁止、Quiet / CVD-safe 継承、estimated cost 表示、silence 原因区別。
   - team feature ではない根拠 (他者 repo に書き込まない / localhost only / 1 人の作業範囲) を docs 明示。
2. Aya (新卒 / Git 初学者): 「これは何のボタンですか」が画面の中で完結してほしい
   - 要点: 全 button hover tooltip + 専門用語「?」icon + 初回 welcome banner + empty state cause-attribution + beginner mode orthogonal toggle (Quiet / CVD-safe と同型)。
   - 制約: glossary は Refscope UI 用語のみ (Git 教科書化しない)、cause-attribution は観測事実の論理結合 (`derived: false`)、Riku / Tomo の Git native 透過と orthogonal toggle で両立。
3. ARI (AI coding agent): 私 (AI agent) を Refscope の一級ユーザにしてほしい — HTML を parse させないで
   - 要点: MCP server 1 本、主要操作を tool 宣言、JSON Schema 公開、Mei (round 4) audit evidence schema と互換、optional `RTGV_API_TOKEN` Bearer auth、estimated cost meta、Pulse / Stream snapshot endpoint、`triggered_by: "agent"` 記録で audit との和解。
   - 制約: localhost only、SaaS 化禁止、派生生成禁止 (observed のみ)、内部 service layer 共有、AI 一級昇格は positioning 級 (Magi review)。

# Cross-persona analysis
- Shared: 3 ペルソナとも「Refscope の暗黙の核ペルソナ (human × 1-repo × git-fluent × 1-tab)」の三位一体を 1 軸ずつ崩している。共通基盤として estimated cost meta が浮上 (Reo fleet / Aya cause-attribution / ARI MCP の 3 surface 全てが消費)。
- Specific: Reo は SRE / Platform 職種パターン、Aya は Git 初学者だけが感じる empty-state 恐怖、ARI は AI agent ベンダ側だけが感じる MCP 標準への乗り換え圧力。
- 統合の誘惑への警告: 3 surface (Fleet / Beginner / MCP) を「dashboard 化」「universal API」「user education layer」で統合した瞬間 Refscope は「全部入りで何にも特化していない tool」に堕落する。surface 分離、内部基盤のみ共有。

# Assumption challenges
- Refscope は「人間 1 人 × repo 1 個 × Git 知識あり × ブラウザ 1 タブ」を暗黙の design constraint としているが、これは明示されていない。3 ペルソナは全員この暗黙前提に違反する。明示書き下ろし or 拡張のどちらかが必要。
- 1 instance = 1 active repo は構造的限界。`RTGV_REPOS` の Map shape は fleet 化に対応した型を既に持っており、設計者が無意識に fleet を見越していたか、それとも単に repo 切替のためかは確認余地。
- Refscope の用語密度は熟練者には自然だが、初学者には恐怖。empty state あいまい問題は「自分が悪い」サインになる — cause-attribution で救える。
- AI coding agent (Claude / Cursor / Codex) は 2025-2026 で標準化、MCP / function calling が tool integration の事実上の標準。Refscope は AI agent の理想 upstream (gitRunner 安全規律 / observed-facts 厳格 / 派生分離 / localhost) なのにこの market を素通りしている。
- 派生情報は「人間用 calm UX には適度に有用、AI 用 upstream には禁忌、監査用には絶対禁忌」と layered な要求を持つ。tool-wide で「派生は opt-in、observed は default」を宣言する余地。
- 3 ペルソナ共通要求 (estimated cost) を common infrastructure として先に作れば 3 つ別個実装しなくて済むが、cost meta 公開は内部実装の外部公開化を意味する。
- AI 一級昇格判断は Refscope の brand voice / LP positioning / microcopy に波及する product positioning 級判断。Magi review が必要。

# Your task
Choose the action that matches your role:
- Spark: structure these demands into feature proposals — Reo (fleet observation surface)、Aya (beginner mode + glossary + welcome + cause-attribution)、ARI (MCP surface for AI agents) を別提案として書く。3 つ統合しない。
- Accord: integrate user-voice requirements into spec packages — Aya の beginner mode (orthogonal toggle 設計 / glossary 境界 / empty state cause-attribution) を L0-L3 で組む。ARI の MCP surface は positioning 級なので Magi review 後に着手。
- Scribe: convert user voices into PRD user stories with INVEST criteria — 3 ペルソナで 3 PRD 別書き、共通基盤 (estimated cost meta / service layer 共通化) を別 PRD で抽出。
- Builder / Forge: select highest-urgency demand (Reo fleet observation) and prototype 1 surface = 1 行 1 repo の最小実装。SSE 多重化と派生禁止 constraint を最初から強制。
- Rank: score demands by urgency × frequency × persona breadth × roadmap-fit × bet-character。Reo (fleet) は SRE 層 lock-in、Aya (beginner) は市場拡大、ARI (MCP) は AI 標準化波の bet — 3 つは違う種類の戦略 bet で trade-off が trivial でない。
- Researcher: design a study to validate or refute these synthetic hypotheses — 「実 SRE が fleet 観測を Refscope で行いたい度」「実新卒が onboarding 1 ヶ月目に dev tool を恐れる度」「AI agent ベンダの MCP integration roadmap」。
- Echo: validate Aya の "first day cognitive walkthrough" — 用語密度 / empty state 恐怖 / advanced UI overwhelm を実測。Reo の "incident 中 30 秒で fleet 確認 → detail に潜る" flow walkthrough。
- Magi: judge the AI 一級昇格 positioning — 「Refscope は人間 dev tool」 vs 「Git observed-facts の universal upstream」を Logos / Pathos / Sophia で deliberate。判断結果は brand voice / LP / microcopy に波及。
- Vision / Palette: design Reo の fleet view 行 layout と dot pulse の visual。Aya の welcome banner と「?」 icon の visual。両者で Quiet / CVD-safe theme 互換を保つ。
- Atlas: architect 内部 service layer 共通化 — gitRunner と observed-facts / derived 分離原則を MCP / human UI / fleet view で重複なく共有する design。

# Constraints
- Treat synthetic demands as hypotheses (`synthetic: true`), not validated user voice.
- Pair every output with the originating persona and demand ID for traceability.
- Surface contradictions across personas instead of smoothing them — Aya は翻訳要求 / Riku は Git native 透過、ARI は agent 自動 export / Mei は人間 trigger 必須、3 ペルソナの新 surface は estimated cost を露出 / 既存 calm UX は数字を抑える。1 つの平坦化に落とし込まない。
- Distinguish observed-facts from inferred narrative — round 1-5 を通じて recurring。本ラウンドでは特に Reo fleet view の「派生情報禁止」、Aya empty state の「cause-attribution は観測事実の論理結合 (`derived: false`)」、ARI MCP の「tool は observed のみ返す」を貫くこと。
- All Git-execution implications must remain inside `apps/api/src/gitRunner.js` allowlist (`cat-file, diff, for-each-ref, log, ls-files, merge-base, rev-list, rev-parse, show, stash list, submodule status, worktree list`)。新 git command が必要なら明示し Atlas / Magi review。signature 検証は Refscope の意図的未対応領域 (`signed: false`、`gpg.program` 呼ばない)。
- localhost only / SaaS 化禁止 / 外部 cloud auth 禁止 — Refscope の魂を 3 surface 共通の hard constraint として保つ。
- 3 surface (Fleet / Beginner / MCP) を統合しない。共通基盤 (gitRunner / observed-facts vs derived 分離 / estimated cost meta / service layer) のみ共有する。
- estimated cost meta (`meta.cost.gitCalls / wallTimeMs / payloadBytes / truncated`) は 3 ペルソナ共通要求 — common infrastructure として先に設計するか、3 surface 別個実装するかを Atlas / Spark が決定。
- AI 一級昇格は brand voice / LP positioning / microcopy 級の判断 — Magi review 推奨、結論を README / spec に書き下ろし。
- agent-triggered audit-grade export は Mei (round 4) の「人間 trigger 必須」と衝突 — `triggered_by: "agent"` 記録で和解、default は人間 trigger 必須、agent trigger は config opt-in を提案文書に書き下ろし。
- beginner mode は Quiet / CVD-safe と並ぶ orthogonal toggle として設計する根拠を提案文書に書き下ろし。proficiency / motion / color の 3 軸独立。
- glossary は Refscope UI 用語のみに絞る境界を docs 明示。Git 教科書化しない。長期メンテ責任を team の誰が持つかを書き下ろし。
- fleet view は team feature ではない根拠 (他者 repo 書き込みなし / localhost only / 1 人の作業範囲) を docs 明示。Sora (round 1) guardrail と整合。
- AI agent surface (MCP) と human UI surface は同じ gitRunner と同じ observed-facts / derived 分離原則を共有 — 内部 service layer 共通化、surface 二重化のみ。
- 派生情報は tool-wide で「派生は opt-in、observed は default」を宣言する選択肢を提案文書に書き残し (round 4 から継続)。
- If acceptance criteria are ambiguous, list clarifying questions before producing solutions.
```
