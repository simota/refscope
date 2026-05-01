# Nexus Journal

| Date | Task | Chain | Mode | Decision |
|---|---|---|---|---|
| 2026-04-30 | グラフィカルな要素を追加 | Nexus internal -> frontend patch | AUTORUN_FULL | 単一 UI 改善のためサブエージェントは使わず、timeline に commit activity overview を追加 |
| 2026-04-30 | sidebar に ref map を追加 | Nexus internal -> frontend patch | AUTORUN_FULL | 既存 refs data だけで branches/remotes/tags の分布と選択 ref を SVG で可視化 |
| 2026-04-30 | detail panel に change graph を追加 | Nexus internal -> frontend patch | AUTORUN_FULL | 既存 changed-file stats だけで additions/deletions の比率とファイル別変更量を可視化 |
| 2026-04-30 | compare mode に graph を追加 | Nexus internal -> frontend patch | AUTORUN_FULL | compare result の ahead/behind と added/deleted をラベル付きバーで可視化 |
| 2026-04-30 | top bar に live pulse を追加 | Nexus internal -> frontend patch | AUTORUN_FULL | realtime status と paused pending updates を小さな pulse bar で可視化 |
| 2026-04-30 | rewrite alert に flow visual を追加 | Nexus internal -> frontend patch | AUTORUN_FULL | previous hash から current hash への rewrite flow を SVG とラベルで可視化 |
| 2026-04-30 | activity overview に author graph を追加 | Nexus internal -> frontend patch | AUTORUN_FULL | 表示中 commits の author distribution をラベル付きバーで可視化 |
| 2026-04-30 | detail panel に file status mix を追加 | Nexus internal -> frontend patch | AUTORUN_FULL | changed files の status 構成を分割バーと凡例で可視化 |
| 2026-05-01 | Plea Hana demand に対する PROPOSE 提案 | Nexus -> Spark | AUTORUN_FULL | minimum viable chain (Spark 単独 spawn, opus) で「期間サマリビュー」3 options を生成。観察 / 派生境界を rewrite alert 語彙で再利用する Option B を推奨。Next: Rank |
| 2026-05-01 | Plea round 2 demand 4 件の priority scoring | Nexus -> Rank | AUTORUN_FULL | minimum viable chain (Rank 単独 spawn, opus) で RICE / WSJF / MoSCoW / ICE 横断スコア。推奨順序 Yuki → Hana → Ken (Spike 並走) → Tomo (v2)。Ken の reflog allowlist 追加は Architecture review が必要と flag。Next: Researcher (Ken 検証) + Sherpa (Yuki/Hana decomposition) の並走 |
| 2026-05-01 | D-Yuki Quiet mode 実装 (Rank 1 位の先行実装) | Nexus -> Artisan | AUTORUN_FULL | minimum viable chain (Artisan 単独 spawn, opus)。`useQuietMode` hook を新規追加し、`data-quiet` root attribute + CSS で全体抑制、`livePaused` (manual) と `isQuiet` (auto) を独立保持して effective pause を合成。`prefers-reduced-motion` 同期、localStorage 永続化、polite live region で missed event 告知。`pnpm build:mock` ✓ / API tests 58/58 ✓。UI のブラウザ動作確認は未実施 — Next: dev server smoke + Echo cognitive walkthrough |
