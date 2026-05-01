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
- 教訓: visualization の追加 demand を出すときは、対になる「抑制 / 静音」demand も同時に検討する。後追いで accessibility 圧力として返ってくる。
