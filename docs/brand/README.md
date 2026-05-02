# Refscope Brand & Design System

> **Refscope is the observatory that turns your repository's history into something you can quietly trust.**

このディレクトリは Refscope のブランディング・世界観・デザインシステムの一次定義です。プロダクト判断（製品文言、UI 実装、マーケティング、競合対応、ロゴ制作の発注）はすべてここを参照してください。

## ファイル構成

| ファイル | 内容 | 主な参照タイミング | 担当 |
|---|---|---|---|
| **`narrative.md`** | コアメタファー（観測所）、ブランドエッセンス、パーソナリティ、ナラティブ三幕、トーテム、避けるトーン、タグライン候補 | 製品の方向性判断、新機能の "らしさ" 検証、対外コミュニケーション全般 | Saga |
| **`positioning.md`** | 競合比較表、差別化軸、ポジショニングステートメント、避ける positioning trap、Refscope ならではの場面、カテゴリ宣言 | README / LP / pitch 文言、競合対応、機能優先順位の判断 | Compete |
| **`visual-direction.md`** | ビジュアル原則、カラー戦略、タイポグラフィ、レイアウト、モーション、アイコン、アクセシビリティ targets、ロゴ案 | UI 実装の判断、デザインレビュー、外部デザイナー発注 | Vision |
| **`tokens.json`** | DTCG v2025.10 準拠のデザイントークン（color / typography / spacing / radius / elevation / motion / z-index、light/dark 両モード） | コンポーネント実装、Figma → コード連携、トークン更新 | Muse |
| **`tailwind-theme.css`** | Tailwind v4 `@theme` 用 CSS 変数定義。`apps/ui/src/styles/` への配置候補 | Tailwind v4 設定、`apps/ui/` 移行 | Muse |
| **`tokens-rationale.md`** | 各トークン群の意図、コントラスト比検証表、使用ガイド | トークン変更時の影響評価、アクセシビリティ監査 | Muse |
| **`voice-and-tone.md`** | Voice 原則、状況別 tone shift、言葉選び decision rules、英日文体ガイド、avoid words list、命名規約 | 全テキスト記述、エラーメッセージ設計、ドキュメント執筆 | Prose |
| **`microcopy.md`** | empty state / status badge / rewrite notice / error message / CORS 救済 / pause / command palette / first-run / README 1-liner — 英日併記。末尾に既存実装の置換マッピング | UI 実装、文言レビュー、i18n 整備 | Prose |

## 一目でわかる Refscope の核

| 軸 | 確定事項 |
|---|---|
| **コアメタファー** | 観測所 (Observatory) — 警報を鳴らさず、観測を記録する場所 |
| **トーテム** | 観測台帳 (observation log) — 事実は事実欄、解釈は解釈欄、書き換え不可 |
| **エッセンス** | The observatory that turns your repository's history into something you can quietly trust |
| **パーソナリティ** | Calm not flashy / Precise not pedantic / Patient not slow / Honest not alarmist / Quiet not invisible |
| **ポジショニング** | Real-time **ref observer** — Git GUI / TUI / IDE 拡張のいずれとも異なる新カテゴリ |
| **差別化の核** | (A) 履歴改変の信頼検出 / (B) 観測事実 vs 解釈の分離 |
| **基調色** | Cool-neutral monochrome (OKLCH hue ~250) + 単色 cyan-teal accent (hue ~200) |
| **書体** | Inter (UI) + JetBrains Mono (mono、ligatures OFF) |
| **モード** | Light / Dark とも first-class、AAA 狙い (body text 14.96:1 / 17.35:1) |
| **モーション** | State change のみ。reduced-motion で完全停止 |
| **意味保証** | 色 + 形 + テキスト の三層 |

## ブランドの「やってはいけない」(quick reference)

このリストに違反するコミットは ブランディングに関する PR レビューで reject 対象。

- ターミナル風 green-on-black / hacker culture トーン
- 戦争メタファー (war room, shield, guard, kill switch, alert!)
- AI 万能感 (intelligent, magic, AI-powered, smart insights)
- 警報の煽り (赤い点滅、ALERT!、DANGER!、効果音)
- "time travel" / "rewrite the past" のロマン化比喩
- 色だけで意味を伝える badge / status
- 自動スクロールでフォーカスを奪う live update
- light モードを後付けで追加すること（最初から両モード first-class）
- bold 以外の重み (light / extra-light) の使用
- 5/7/11px のような irregular spacing

## このガイドの維持

- **変更は narrative → positioning → visual-direction → tokens → voice-and-tone → microcopy の順に伝播する**。上流の変更は下流の見直しを伴う。
- トークンの変更は `tokens-rationale.md` に変更理由とコントラスト比再検証を必ず記す。
- マイクロコピーの変更は `microcopy.md` の置換マッピング表に追記する。
- 新ペルソナ / 新ユースケース / 新競合が登場したら `positioning.md` を更新する。
- 大きな世界観変更 (コアメタファーの差し替え等) は `.agents/PROJECT.md` への記録を推奨。

## 次の推奨ステップ

| 優先度 | 担当候補 | アクション |
|---|---|---|
| 高 | Artisan | `microcopy.md` §12 の置換マッピングを `apps/ui/src/app/components/refscope/` に適用 |
| 高 | Artisan / Forge | `tailwind-theme.css` を `apps/ui/src/styles/` に統合し、既存トークンを Refscope トークンに移行 |
| 中 | Echo | Aki ペルソナでのスクリーンリーダー読み上げ検証 (微コピー全 10 種) |
| 中 | Vision / 外部デザイナー | ロゴ第一候補「同心円のレチクル」の制作と favicon (16/32/180px) 出力 |
| 中 | Showcase | Storybook で Refscope コンポーネントカタログを構築し、token 適用を視覚検証 |
| 低 | Saga / Prose | タグライン 5 候補から 1 つを A/B または社内投票で確定 |

---

**Source**: Nexus orchestration (Compete + Saga + Vision + Muse + Prose)
**Status**: v0 — 確定
**Last updated**: 2026-05-02
