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
