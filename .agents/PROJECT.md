# Agent Project Log

| Date | Agent | Action | Files | Outcome |
|---|---|---|---|---|
| 2026-04-30 | Plea | 合成ユーザー需要レポートを作成 | `docs/user-demand-report.md` | setup、信頼性、アクセシビリティ、team review に関する需要仮説を抽出 |
| 2026-04-30 | Builder | Mina/D1 の 1 コマンド起動診断を補強 | `scripts/dev/validate-repos.sh`, `Makefile`, `README.md` | `make dev-app` / `make dev-api` の前に repo path を検査し、未指定・相対 path・存在しない path・Git root ではない path を平易に説明 |
| 2026-04-30 | Nexus | timeline に activity overview を追加 | `mock/src/app/components/refscope/CommitTimeline.tsx` | commit 数、追加/削除、signed、merge、new をラベル付きメトリクスとミニバーで可視化 |
| 2026-04-30 | Nexus | sidebar に ref map を追加 | `mock/src/app/components/refscope/BranchSidebar.tsx` | branches、remotes、tags の分布と選択中 ref をラベル付き SVG/バーで可視化 |
| 2026-04-30 | Nexus | detail panel に change graph を追加 | `mock/src/app/components/refscope/DetailPanel.tsx` | 選択 commit の additions/deletions 比率とファイル別変更量をラベル付きバーで可視化 |
| 2026-04-30 | Nexus | compare mode に graph を追加 | `mock/src/app/components/refscope/CommitTimeline.tsx` | ahead/behind と added/deleted をラベル付きバーで可視化 |
| 2026-04-30 | Nexus | top bar に live pulse を追加 | `mock/src/app/components/refscope/TopBar.tsx` | realtime status と pause 中 pending updates を pulse bar で可視化 |
| 2026-04-30 | Nexus | rewrite alert に flow visual を追加 | `mock/src/app/components/refscope/BranchSidebar.tsx` | previous hash から current hash への rewrite flow を SVG とラベルで可視化 |
| 2026-04-30 | Nexus | activity overview に author graph を追加 | `mock/src/app/components/refscope/CommitTimeline.tsx` | 表示中 commits の author distribution をラベル付きバーで可視化 |
| 2026-04-30 | Nexus | detail panel に file status mix を追加 | `mock/src/app/components/refscope/DetailPanel.tsx` | changed files の status 構成を分割バーと凡例で可視化 |
| 2026-05-01 | Plea | 第 2 ラウンドの合成ユーザー需要を生成 | `docs/user-demand-report-2026-05-01.md`, `.agents/plea.md` | Hana (週次 / 非エンジニア)、Tomo (大規模 OSS)、Yuki (sensory-sensitive)、Ken (on-call) の 4 demand を抽出。死角は「開きっぱなし前提」「観測事実と派生の分離不徹底」「visual summary の抑制装置欠如」 |
| 2026-05-01 | Spark (via Nexus) | Hana demand に対する「期間サマリビュー」proposal | `docs/spark-period-summary-proposal.md` | 派生強度別 3 options (Observed-only / Rule-based 推奨 / LLM narrative opt-in)。Option B は新コマンド不要 (`log --since --until --name-status --numstat`) で `validation.js` 拡張のみ。RICE / Open questions 7 / Assumptions 6 含む。Next: Rank |
| 2026-05-01 | Rank (via Nexus) | round 2 demand 4 件の priority scoring | `docs/rank-round2-priority.md` | RICE / WSJF / MoSCoW / ICE 横断。推奨順序 Yuki (Must, 横串先行) → Hana (Should, Spark readiness) → Ken (Should + Spike, reflog allowlist 追加要 Atlas/Magi review) → Tomo (Could, MVP 範囲外 v2)。synthetic confidence cap 45-60%、Researcher 検証必須は Ken と Tomo |
| 2026-05-01 | Artisan (via Nexus) | D-Yuki Quiet mode 実装 | `mock/src/app/hooks/useQuietMode.ts` (新規), `mock/src/app/App.tsx`, `mock/src/app/components/refscope/TopBar.tsx`, `mock/src/app/components/refscope/CommandPalette.tsx` | `data-quiet` root attribute + CSS で transition / animation を 0ms 化し OKLCH chroma を縮小 (lightness 維持で WCAG 2.2 AA contrast 確保)。manual pause (`livePaused`) と Quiet 由来 auto pause (`isQuiet`) を独立保持し合成、SSE event は両者で pending キューに流れ Quiet 解除時に polite live region で告知 (focus 移動なし)。`prefers-reduced-motion` 同期、localStorage 永続化、aria-pressed / aria-live / accessible name 完備。build と API tests 通過。ブラウザ目視は未実施 |
