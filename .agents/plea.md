# Plea Journal

合成ユーザー需要生成で見つかった、継続的に参照するパターン。

## 観測事実と派生 / 推測の分離は、ラウンドを越えて再発する死角

- 2026-04-30 (round 1): Sora が rewrite alert に対して「why so?」を求め、observed Git facts と inferred explanations の分離が必要とされた。
- 2026-05-01 (round 2): Hana (期間サマリ)、Ken (起動時 recap)、Yuki (visual summary の意味付け) でも同型の死角が現れた。
- 教訓: Refscope のような「Git facts を観測して見せる」プロダクトでは、UI 上のあらゆるサマリ・要約・通知に対して、ユーザーは「これは観測か、推測か」を聞く。新しい demand を生成するときは、観測 / 派生の分離可否を AC に含めると死角を 1 つ封じやすい。
- 適用先: Spark / Accord への handoff prompt に「Distinguish observed-facts from inferred narrative」を constraint として標準で書くと良い。

## 「開きっぱなし」前提を崩すペルソナを 1 つ以上必ず混ぜる

- ローカル開発 tool は「ユーザーが座って眺めている」前提に流れやすい。
- round 2 で Hana (週次)、Ken (5 分) を入れることで、SSE / live updates 中心の設計仮説を揺さぶる demand が抽出できた。
- 適用先: 同類のローカル / dashboard 系プロダクトを扱う Plea セッションでは、「intermittent / event-driven user」を 1 ペルソナ確保するとカバレッジが上がる。

## visual summary を量産すると、抑制装置が同時に必要になる

- round 1 demand に応えて activity overview / ref map / change graph / live pulse / file status mix などが追加された結果、round 2 で Yuki が「全部止めたい」を持ち込んだ。
- round 3 では Prism syntax highlighting (round 2 末期に追加) が新たな hue 軸の衝突を生み、color-blind の Lin が「Quiet mode (彩度) では救えない、orthogonal な hue 介入が必要」を持ち込んだ。
- 教訓: visualization の追加 demand を出すときは、対になる「抑制 / 静音」demand も同時に検討する。さらに、その visual がどの軸 (motion / saturation / hue / contrast) を増やしたかを記録すると、次ラウンドで該当軸の accessibility demand が来る予測が立つ。

## 「自分のマシンの画面の中で完結する」前提は、dev tool でも頻発する死角

- round 3 で Eri (Slack 受信 PM) と Asha (multi-client screen share contractor) が、独立した persona から同じ構造の死角を指摘した: Refscope の利用面が「他者の画面」「他者の受信箱」「保存画像」の境界外側に頻繁に出る。
- 既存設計 (live、localhost only、author email を含む raw display) はこの境界の外側で何が起きるかを扱っていない。
- 教訓: 「local dev tool」と自己定義する product でも、実利用は screen share / screenshot / 共有 URL を経由する。Plea セッションで「受信側 / 共有環境 / 撮影前提」のペルソナを 1 つは混ぜると、観測 → 派生 → 表示層加工 → 境界外露出 の 4 段階目を可視化できる。
- 適用先: Spark / Accord への handoff で「UI layer transform は境界の外側 (clipboard / export / screenshot) にも一貫適用するか」を constraint に標準で書くと良い。

## 観測面が増えるほど、「意思決定単位」への再構成が必要になる

- 2026-05-03 (round 5 別セッション計画): working tree、stash、linked worktree、submodule、repo operation、related files が揃うと、個別観測は豊富になる一方で、Nao (PR 前)、Priya (release 前)、Mateo (review 前) が共通して「次に何を判断すべきか」を求めた。
- 教訓: Git surface を増やす demand / 実装の後には、必ず「PR-ready」「release-check」「review-order」のようなユーザーの意思決定単位へ再構成する demand が現れる。これは推測を混ぜるリスクがあるため、observed facts と derived suggestion の境界をより強く出す必要がある。
- 適用先: Spark / Accord への handoff では「decision-level synthesis must expose evidence and uncertainty」を constraint に入れると良い。Builder に渡す場合は read-only checklist から始め、Git 状態変更操作は含めない。
- 注: このパターンは別セッションで journal に記録されたが、対応する demand report ファイルは未作成のまま。round 6 として復活させる候補。

## ラウンドを重ねると「核ペルソナの三位一体」が浮上する

- 2026-05-03 (round 5、`docs/user-demand-report-2026-05-03-r5.md`): round 1-4 のペルソナは全員、Refscope の暗黙の核ペルソナ (人間 1 人 × repo 1 個 × Git 知識あり × ブラウザ 1 タブ) の **周辺バリエーション** として機能していた。時間軸を遠端に (Bram)、空間境界を外側に (Eri / Asha)、感覚特性を minority に (Yuki / Lin)、役職を非エンジニアに (Hana / Mei)、深度を power-user に (Riku / Tomo)。
- round 5 (Reo / Aya / ARI) でようやく「核そのものを 1 軸ずつ否定する」ペルソナ (Reo: repo 1 個を否定 / Aya: Git 知識ありを否定 / ARI: 人間 1 人を否定) に到達した。
- 教訓: 4-5 ラウンド以降の Plea セッションは、これまでのペルソナを並べて **核ペルソナの暗黙前提一覧 (人 / 物 / 環境 / 知識量 / surface 種類 / 数)** を抽出し、各前提を 1 軸ずつ否定するペルソナを意図的に配置すると、後発ラウンドのカバレッジが質的に上がる。
- 適用先: ラウンド 4 以降は最初に「核ペルソナの暗黙前提一覧」を書き出し、各前提に対する「否定ペルソナ」が既存ラウンドに居るかを確認する。居なければそれが次ラウンドの第一候補。

## 複数ペルソナの共通要求は internal common infrastructure を炙り出す

- round 5 で Reo (fleet)、Aya (cause-attribution)、ARI (MCP dry-run) が **estimated cost meta** という共通要素を別の言語で要求した。
- 別 surface への要求として登場するが、内部実装としては **同じ measurement を共有する** べき infrastructure。
- 教訓: 複数ペルソナが「別 surface」「別言語」で同じものを要求した時、それは internal common infrastructure (service layer / metadata schema / cross-cutting concern) の設計圧が需要側から浮上した signal。提案を別個に立てる前に「共通基盤として先に作るか、それとも N 個別個に作るか」を Atlas / Spark に渡す。
- 適用先: Cross-Persona Analysis の "Shared" セクションで「動機は違うが要求の形が似ている」項目を抽出し、internal infrastructure 候補として handoff prompt に書く。

## AI agent を一級ペルソナとして扱う判断は product positioning 級

- round 5 で初めて AI coding agent (ARI) を人間ペルソナと同列に扱った。これは dev tool としては「人間 dev tool に留まる」 vs 「AI も第一級ユーザにする」の brand positioning 級判断を要する。
- 「AI agent を user として扱う」と決めた瞬間、surface 設計 (MCP / function calling)、auth model (token vs OAuth)、output format (JSON Schema 公開)、brand voice (LP / microcopy)、roadmap bandwidth 配分 にすべて波及する。技術的決定ではなく positioning 決定。
- 教訓: AI agent ペルソナを Plea で扱う時は、handoff prompt で必ず Magi (positioning judgment) を経由するよう constraint に書く。Spark / Accord に直接渡すと positioning 決定を skip して実装議論に流れ、「AI 対応を quietly に追加」してから brand voice との不整合に後で気づくパターンに陥る。
- 適用先: AI ペルソナを含む round の Output Routing には Magi を必ず含める。Acceptance Criteria の最後に「product positioning level の決定 (Magi review 推奨) を README / spec に書き下ろし」を入れる。
