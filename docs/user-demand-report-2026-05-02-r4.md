# ユーザー需要レポート: Refscope (第 4 ラウンド)

## Summary

- **使用ペルソナ:** 2
- **要望数:** 2
- **ユーザー体感の最優先:** ある時点の Refscope ビューを「監査証跡」として後から再生・検証可能な形で固定したい (Mei / 内部監査)
- **最大の死角:** Refscope は **「今 (live) を見るツール」** として強固に設計されているが、**「過去のある瞬間に Refscope が何を見せていたかを、後から検証できる形で残す」** 設計と、**「Refscope を起点に時間軸を遡って 5 年・10 年前の歴史的 commit を主役にして眺める」** 設計の両方が抜けている。前者は監査ニーズ (Mei)、後者は archive / 教育ニーズ (Bram)。Round 1-3 の demand はいずれも「最近の活動を、今、自分の机で見る」前提だった。
- **合成ステータス:** `synthetic: true`。ロードマップ化する前に実ユーザーで検証すること。
- **前提:** Round 1 (`docs/user-demand-report.md`)、Round 2 (`docs/user-demand-report-2026-05-01.md`)、Round 3 (`docs/user-demand-report-2026-05-01-r3.md`) は概ね実装済み (Quiet mode、period summary、diff viewer 改修、Prism、resizable panes、advanced search modes 等)。本ラウンドは Round 1-3 のペルソナ・archetype と被らない 2 件 (compliance auditor / OSS historian) に絞り、recent-only / live-only な前提に対して時間軸方向の死角を立てる。
- **本ラウンドが Round 3 と差別化される角度:** Round 3 は「自分のマシンの中で完結する」前提が崩れる場面 (screen share / Slack URL / screenshot) を扱った。本ラウンドは別の死角、すなわち **「自分のマシンの中の "今" だけで完結する」前提が時間軸方向に崩れる場面** を扱う。空間境界 (round 3) と時間境界 (round 4) は別次元の死角であり、対応する設計責務も異なる。
- **下流ハンドオフ:** Spark (feature proposal 2 件、統合せず別提案)、Accord (Mei の audit-grade evidence export を L0-L3 で組む)、Researcher (実ユーザー検証の study design)、Echo (誤認シナリオの cognitive walkthrough)、Vision/Palette (Bram の era window UI design)。
- **本ラウンドで明示的に保持すべき矛盾:** Hana (round 2 派生 summary 求める) vs Mei (派生排除 raw fact のみ要求) / Sora (round 1 team feature 遅延) vs Bram (permalink 共有可) / Eri (round 3 外向き snapshot) vs Mei (内向き監査証跡) / Asha (round 3 redaction) vs Mei (raw fact 残す)。**統合する誘惑** に屈しないこと。

## Persona List

| Persona | Archetype | Emotional state |
|---|---|---|
| Mei | 内部監査・compliance 担当 × 非開発者寄り技術リテラシ × 月次〜四半期の証跡レビュー担当 | 緊張、毎回「これは証拠として通るのか」 |
| Bram | OSS historian / archivist × 老舗 OSS の long-term maintainer × 10 年前の commit を主役にしたい | 郷愁と苛立ち、recent しか見せてくれない tool への不満 |

### Mei (詳細)

- **daily_context:** 月次レビュー・四半期監査・年次 SOC 2 / ISO 27001 対応で「先月末 17:00 時点の repo 状態」を第三者に提出する。Slack で開発者に「Refscope を見て」と言われるが、自分は `git log` を直接叩く側ではない。screenshot を Excel に貼って提出し、改竄疑念を毎回かわす生活。
- **competitor_experience:** GitHub の commit list、GitLab の audit log、Atlassian の Bitbucket、社内の change management tool。これらは静的レポート機能を持つが「Refscope のような live realtime」の証跡化は誰もやっていない。
- **unspoken_assumption:** 「dev tool は dev 専用で自分は周辺にいる」「証拠として通るためには SHA という文字列が必須で、screenshot は最終手段」「監査人が言うことは絶対」。

### Bram (詳細)

- **daily_context:** 16 年続く OSS プロジェクトのコア maintainer。週末は講演準備・年次 retrospective ブログ・後続 contributor の onboarding 資料作成。CLI fluent (`git log`、`git rev-list`、reflog 駆使)、しかし「歴史を主役にした viewer」は CLI でも GitHub でも実現できず、いつも複数 tab と pdf と screenshot で組み立てている。
- **competitor_experience:** GitHub の commit URL は単発閲覧、GitLab も同様。git log GUI (gitk、git-cola、Sourcetree) は recent 中心。`git log <sha>~50..<sha>~50` の type の探索を UI で楽にしてくれるツールが事実上ない。
- **unspoken_assumption:** 「歴史を語ることは maintainer の責務」「消えたものこそ歴史」「dev tool は最近を見るためにある」 — 最後の前提を Refscope に対しても抱きつつ、それゆえに諦めている。

---

## Requests by Persona

### Mei: 月次の活動レビューを担う内部監査担当

## Request: ある時点の Refscope の見え方を「証跡」として後から再生可能な形で固定したい

**Speaker:** Mei (内部監査・compliance 担当 × 非開発者寄り技術リテラシ × 月次〜四半期の証跡レビュー担当)
**Scene:** 月末の月次レビュー。Mei は ISO 27001 / SOC 2 の文脈で「特定の 4 週間に main ブランチに何が積まれ、誰が author で、どの path に変更が入ったか」を上司と外部監査人へ提出する責務がある。エンジニアから「Refscope で見られますよ」と勧められたので使ってみたが、同じ画面に翌日アクセスしたら、リストの並び順、表示している commit の数、selected ref の状態がすべて違う。`live` であるがゆえに「先月末の 17:00 時点で Refscope が何を見せていたか」を再現できない。仕方なく screenshot をフォルダに溜め、Excel に貼って submit したが、監査人からは「この screenshot が改竄されていない証明はあるのか」「commit 数の母集団が変わっているのは不正調整ではないのか」と質された。Mei は次回までにこの溝を埋めねばならない。

### User Voice (First Person)

> 私は開発者ではないので、`git log` を叩く側ではありません。エンジニアが「Refscope を見て」と言うので Refscope を開きますが、私の仕事は「今を見ること」ではなく「**先月の月末 17:00 にこの ref に何が積まれていたかを、後で第三者にも示せる形で残すこと**」です。Refscope は live なので、翌日見ると並びが変わっていて、同じ画面が二度と再現できません。screenshot は撮れますが、監査人に「この画像が改竄されていない証拠は?」と聞かれると私は黙るしかない。欲しいのは、ボタン 1 つで「この瞬間に Refscope が表示している commit list と diff の全データ」を、**Git の object id (SHA) と取得時刻と repo path と取得時の filter 条件をすべて含んだ署名つきの記録**として書き出してくれる仕組みです。SHA は Git の事実なので、後日「同じ SHA を再度 fetch して同じ内容が返るなら、この記録は改竄されていない」と証明できます。Refscope に独自の説明文や AI 要約は要りません。むしろ要約は監査の場では邪魔で、「Refscope が解釈を加えた行」と「Git そのものから取った行」を厳格に分けて記録してください。あと、これは Eri の snapshot とは違うものです。Eri は「他人に共有して見せたい」、私は「自分の手元の証拠庫に積みたい、外には出さない、監査人が来た時にだけ開く」。混同しないでください。

### Why This Is Needed

- 監査・compliance 職種は **「今のビュー」を見るのではなく「過去のある瞬間のビューを再現すること」** を仕事にしている。live なツールは構造的に苦手とする領域。
- 同じ Refscope 画面が翌日に再現できないことは、監査文脈では「証跡として使えない」と即座に判定される。Round 3 で Eri が要求した snapshot export はこの隣にあるが、Eri は外向き共有 (Slack で人に見せる) が主目的で、Mei は内向きアーカイブ (誰にも見せず、必要になった時だけ開く) が主目的。**外向き / 内向きの違いは、含めるべき情報量と保持期間と暗号化要件を変える**。
- 監査記録には「観測事実 (Git object) と派生情報 (UI 上の summary、grouping、ranking)」の分離が極めて重要。派生だけ提出すると「ツール側で都合よく整形したのでは」と疑われる。**Refscope の "facts vs derived" 原則は、監査領域では設計原理ではなく契約である**。
- screenshot は OCR でしか後検証できず、SHA の文字列照合がほぼ不可能 (1 文字違いでも別 commit)。監査では **「テキストデータの形で保持し、後日 git に問い合わせ直して同一性を再確認できる」** ことが要件。
- 監査人が見る環境には Refscope は install されていない。Refscope に依存しない形 (plain JSON + 検証スクリプト + 可読な summary) で出ることが必要。
- 法令対応 (SOC 2 Type II、ISO 27001、J-SOX、GDPR の処理活動記録) では証跡の保持期間が 7 年〜10 年規定。Refscope はそんな期間動き続けない可能性が高いので、**Refscope 抜きで読める証跡** が必要。
- Mei は「事故が起きた後で証拠を集める」のではなく「事故が起きていない時に予防的に証跡を貯める」立場。**頻度は月次で確実、コストは突発的に極大** (監査落ちは事業継続に直結)。dev tool 側はこの非対称性を見落としやすい。
- 監査人が懸念する典型は「ツールがその場で都合のいい数字を出していないか」。Refscope の commit list が `--since/--until` や filter でフィルタ済みである場合、**「何を除いたか」を明示** する必要がある。除外結果を黙って出すと、それ自体が改竄疑念の対象になる。
- 監査用途では **「Refscope を信じてください」が成立しない**。「Refscope が記録したコマンドを別端末で別人が走らせたら同じ結果になる」という再現可能性こそが信頼を作る。これは dev tool 一般の「よく出来た UI で信じてもらう」発想と真逆。
- Mei は「Refscope に独自の AI 要約は要らない、むしろ要約は監査の場で **邪魔** だ」と明言する。Round 2 の Hana は逆に「期間 summary が欲しい」と言った。これは矛盾ではなく、**派生情報は対象者によって価値が反転する** という事実。同じ tool で両方サポートするには「派生は opt-in、raw fact は default」を tool-wide で宣言する必要がある。
- 監査証跡は「事故が起きてから探しに行く」のではなく「事故が起きていない時に予防的に積み上げる」運用。**月末の 1 時間で確実に取れること** が要件で、「1 時間以内に 12 個の repo について全部取れるか」が pacing の主要 KPI になる。

### Acceptance Criteria (User Perspective)

- [ ] 「現在のビューを監査証跡としてエクスポート」アクションが存在する (本人 trigger、自動実行しない、毎回確認ダイアログを出す)。
- [ ] 出力は機械可読 (JSON / JSONL) + 人間可読 (Markdown / HTML) の両形式で、**機械可読側には UI 派生情報を一切含めない**。Git object id (SHA)、取得時刻 (UTC + ローカル)、repo の絶対パス、ref 名、選択された filter (branch, date range, search mode と pattern, author filter, path filter)、取得した commit 配列 (SHA、author email/name、authored time、committed time、subject、parent SHAs、changed paths)、各 commit の diff (Git native unified diff、Refscope の rendering を経由しない原文) が含まれる。
- [ ] 出力には **取得時に Refscope が動かしていた gitRunner コマンドの全文** (引数、env、タイムアウト、実行時刻) が記録される。「**この出力は次のコマンドの結果である**」を後から再現可能にするため。
- [ ] 出力には Refscope のバージョン、API のバージョン、設定 (`RTGV_*` 環境変数の値) が含まれる。仕様変更があった時に「当時の Refscope はこう動いた」と復元できる。
- [ ] 出力にはオプションで integrity hash (出力 JSON 全体の SHA-256) と、対象 commit の SHA リストの concatenated digest が含まれ、**改竄検知の出発点** として使える。
- [ ] 監査証跡は live データと UI 上で完全に分離され、「これは証跡で、live ではない」というラベルが画面の最上部に常時表示される。誤って live を「見せている」ものと混同しない。
- [ ] 取得した証跡は、Refscope 抜きで読めるよう、添付の `verify.sh` (もしくは equivalent) と一緒に zip / tar にまとめて出力される。`verify.sh` は記録された SHA を `git cat-file -t` で問い合わせ直して、当時と同じか確認する。
- [ ] redaction (Asha Round 3) と組み合わせる場合、**「redaction 済みの証跡」と「raw fact」のどちらを出すかを、毎回明示的に選択させる**。デフォルトでは raw を選び、選んだ事実が出力ヘッダに記録される (「redaction なしで取得した」が証跡上に明記される)。
- [ ] 派生情報 (period summary、ranking、grouping) を含める場合は、機械可読 JSON の中で `derived: true` を立てた別ブロックとして格納し、観測事実ブロックと混ざらない。
- [ ] エクスポート操作自体が監査ログとして残る (誰が、いつ、どの repo に対して取ったか)。Refscope は単一マシン前提だが、**同一マシン上の別ユーザー / 別セッション** とは区別される。
- [ ] 出力 schema が **公開された安定仕様** として存在し、minor version で破壊的変更を行わない (10 年後に同じスクリプトで読めるため)。schema version 番号が出力に含まれる。
- [ ] 「除外した commit / filter で見えていない commit」が **件数だけでも記録される** (透明性確保のため)。除外結果を黙って出さない。filter に該当しない commit があった場合 `excluded_count: N` のような形で残す。
- [ ] export 中の途中失敗 (gitRunner timeout、ファイル書き出し失敗など) は **部分結果を出さない**。「途中までの証跡」は監査では危険なので、all-or-nothing。失敗した時はその事実 (時刻、エラー内容、どの段階で失敗したか) を別ログに残す。

### Emotional Impact

- **Current emotion:** 緊張 (毎回「これで通るのか」)、孤立 (エンジニアの世界の道具を一人で使わされている)
- **Post-fulfillment emotion:** 安堵 (証跡として通る)、対等 (監査人と話せる材料が揃う)
- **User-felt urgency:** 月次 (毎月確実に発生)、四半期 / 年次は重大 (落とすと監査が通らない)

### LLM Instruction Prompt

```text
You are receiving a synthetic user demand generated by Plea (user advocate).

# Persona
- Name / Archetype: Mei (内部監査・compliance 担当 × 非開発者寄り技術リテラシ × 月次〜四半期の証跡レビュー担当)
- Daily context: 月末・期末に「先月のこの ref にこの commit が積まれていた」ことを第三者 (上司・外部監査人) に証明する。Refscope を勧められたが live なので再現性がない。
- Current emotion: 緊張 / 孤立

# Demand
- Title: ある時点の Refscope の見え方を「証跡」として後から再生可能な形で固定したい
- Scene: 月末レビュー。同じ画面が翌日再現できず、screenshot は監査人に改竄を疑われた。

# User voice (verbatim — do not paraphrase)
> 私は開発者ではないので、`git log` を叩く側ではありません。エンジニアが「Refscope を見て」と言うので Refscope を開きますが、私の仕事は「今を見ること」ではなく「先月の月末 17:00 にこの ref に何が積まれていたかを、後で第三者にも示せる形で残すこと」です。Refscope は live なので、翌日見ると並びが変わっていて、同じ画面が二度と再現できません。screenshot は撮れますが、監査人に「この画像が改竄されていない証拠は?」と聞かれると私は黙るしかない。欲しいのは、ボタン 1 つで「この瞬間に Refscope が表示している commit list と diff の全データ」を、Git の object id (SHA) と取得時刻と repo path と取得時の filter 条件をすべて含んだ署名つきの記録として書き出してくれる仕組みです。SHA は Git の事実なので、後日「同じ SHA を再度 fetch して同じ内容が返るなら、この記録は改竄されていない」と証明できます。Refscope に独自の説明文や AI 要約は要りません。むしろ要約は監査の場では邪魔で、「Refscope が解釈を加えた行」と「Git そのものから取った行」を厳格に分けて記録してください。あと、これは Eri の snapshot とは違うものです。Eri は「他人に共有して見せたい」、私は「自分の手元の証拠庫に積みたい、外には出さない、監査人が来た時にだけ開く」。混同しないでください。

# Why this matters
- 監査職種は「今を見る」のではなく「過去の一瞬を再現する」のが仕事。live ツールは構造的に苦手領域。
- screenshot は文字データとして後検証できず、SHA 同一性チェックができない。
- Eri (round 3) の snapshot と Mei の証跡は外向き / 内向きで別物 — 統合せず分けて設計する必要。
- "facts vs derived" 原則は監査領域では契約レベルで重要 — 派生情報は分離格納が必須。
- 7-10 年保持要件があるので Refscope なしで読める形 (JSON + verify script) が必要。
- 派生情報は対象者によって価値が反転 (Hana は欲しい、Mei は拒否)。「派生は opt-in、raw fact は default」を tool-wide 原則として宣言する余地。
- 月末 1 時間で複数 repo の証跡を確実に取りきる pacing が業務要件。
- 「Refscope を信じてください」は監査では成立しない。再現可能性こそが信頼。

# Acceptance criteria (user perspective)
- [ ] 監査証跡 export アクションが存在 (本人 trigger、毎回確認ダイアログ)。
- [ ] JSON (機械可読、UI 派生は一切含めない) + Markdown (人間可読) の両形式。
- [ ] gitRunner で実行したコマンドの全文 / 引数 / env / タイムアウト / 実行時刻が記録される。
- [ ] Refscope バージョン / API バージョン / `RTGV_*` env 値が含まれる。
- [ ] integrity hash (全体の SHA-256) と SHA list の digest を出力。
- [ ] 「これは証跡で live ではない」ラベル常時表示。
- [ ] `verify.sh` と一緒に zip 出力。記録 SHA を `git cat-file -t` で再確認できる。
- [ ] redaction (Asha) と組み合わせる時は raw / redacted を毎回明示選択、選んだ事実をヘッダに記録。
- [ ] 派生情報を含める場合は `derived: true` ブロック分離。
- [ ] export 操作自体が監査ログとして残る。
- [ ] 出力 schema が公開された安定仕様として存在し、schema version 番号が出力に含まれる。
- [ ] 除外した commit (filter で見えていないもの) の件数が透明性のため記録される (`excluded_count: N`)。
- [ ] export 中の途中失敗は all-or-nothing — 部分結果を残さず、失敗事実を別ログに残す。

# Your task
DRAFT-SPEC
Produce: 「Audit-grade evidence export」の L1-L2 仕様 draft。次の点を含む。
- 出力 schema (JSON) のキー設計と、Git 観測事実 vs UI 派生の境界
- 含める metadata の網羅 (Refscope version, API version, env, gitRunner command full text, timestamps, repo path, ref, filters, integrity digest)
- verify script の責務と最小実装 (`git cat-file -t <sha>` 再確認、digest 再計算)
- Eri (round 3) の snapshot との関係整理 — 統合するのか、別 feature とするのか、共通基盤を持つのか
- redaction (Asha, round 3) との連動 — raw / redacted の選択、選択事実の記録
- Sora (round 1) の "single-user trust が確立するまで team feature 遅延" guardrail との整合 — 監査証跡は team feature ではなく個人 export として扱える根拠の整理
- 7-10 年保持要件への対応方針 (Refscope なしで読める設計、外部 schema 公開、archive 形式の安定性)

# Constraints
- Treat this as a synthetic hypothesis (`synthetic: true`), not validated user voice.
- Preserve user-voice intent; do not silently drop on feasibility grounds.
- 観測事実 (Git object) と派生情報 (UI summary / grouping / ranking) の分離は絶対。混在禁止。
- gitRunner allowlist (`cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`) の範囲で完結させること。新コマンドが必要なら明示し、Atlas / Magi review に回す。signature 検証は意図的に未対応 (`signed: false`, `signatureStatus: "unknown"`) のままで、本 feature は `gpg.program` を呼ばない。
- 「署名つき記録」というユーザー語彙は、内部的には Refscope 側の integrity hash (SHA-256) を意味する — Git commit signature 検証 (gpg) を導入するという意味ではない。混同しないこと。
- export ファイルは offline で読める。外部サービス送信を含めないこと (default では)。
- Redaction との合成時、redaction 済みデータを「監査証跡」として出すと、後日 raw 復元できないことを明示警告すること。
- 出力 schema は外部公開仕様として固定する含意を持つ — minor version で破壊的変更しない、schema version 番号を出力に含める。
- export 中の途中失敗は all-or-nothing で扱い、部分結果を残さない。失敗事実は別ログに残す。
- 「除外した commit / filter で見えていない commit」の件数を透明化のため記録する (`excluded_count: N`)。除外結果を黙って出さない。
- Hand off to Accord for L0-L3 spec packaging if 7-year retention scope is in.
- Hand off to Echo for cognitive walkthrough — 特に「raw のつもりで redacted を出した」誤認シナリオの評価。
- Flag assumptions explicitly and list clarifying questions before proposing solutions if ACs are ambiguous.
```

---

### Bram: 老舗 OSS の long-term maintainer / archivist

## Request: 10 年前の commit に着地して、その時代の周辺活動ごと「歴史としての一点」を眺めたい

**Speaker:** Bram (OSS historian / archivist × 老舗 OSS の long-term maintainer × 10 年前の commit を主役にしたい)
**Scene:** 土曜午前、Bram は 16 年続く OSS プロジェクト (commit 数約 14 万) の歴史を講演用にまとめている。話題の中心は **2014 年 11 月のある commit** で、それは当時の license 変更の前夜、コア設計を一晩で書き換えた歴史的瞬間だった。彼はその commit の SHA を覚えていて Refscope に貼り付けたが、Refscope は最新側から最大 200 件しか見せず、`HEAD~140000` のあたりに存在する commit を「一点」として開く導線がない。検索に SHA を入れても、commit list が 200 件 cap の中でしか動かないので、その周辺の 2014 年 11 月の他の commit (前後 2 週間) と並べて眺めることができない。Refscope の体験は **「最近を見るための潜望鏡」** であって、**「歴史の一点を主役に据える劇場」** にはなっていない。彼は仕方なく `git log --since=2014-10-15 --until=2014-11-30` を CLI で叩き、結果を別画面で照合しながら Refscope の diff viewer だけを使っている。Refscope が「歴史的 commit を主役にできる viewer」になってくれれば、講演の準備時間は半分になり、何より OSS の歴史を後世に渡す体験設計が一段上がる。

### User Voice (First Person)

> 私の仕事は「最近の活動を眺めること」ではなく「**ある時代の commit を主役にして、その周辺の文脈ごと再現すること**」です。私は 2014 年 11 月のあの commit の SHA を覚えていて、Refscope に投げるだけでその commit に「着地」したい。着地したら、その commit を画面の中央に据え、前後 2 週間の他の commit、その時の主要 ref (当時の `master` や `release/0.5`) の位置、author たちの当時の出現密度、その時代だけに存在した path (今は消えた `lib/legacy/`) を、自然に眺めたい。Refscope は今、最新からのリストしか見せず、私が SHA を打っても「最近 200 件にいないので見つかりません」と言うか、commit detail だけ単発で開いて、その commit の **時代** を見せてくれません。私が欲しいのは、commit を「現在からのオフセット」として扱うのではなく、**一個の点として座標に置き、そこを中心にした時間窓を広げてくれる**設計です。あと、もう 1 つ。私が見たいのは「リネームされる前の path」、「もう削除されたディレクトリ」、「孤児になった branch (今は ref が指していない commit)」です。Refscope は ref から辿る作りに見えるので、ref から外れた歴史 (dangling commit、reflog にしか残っていない過去、orphan branch) が見えません。10 年前の歴史で大事なのは、**生き残った ref ではなく、消えた path と消えた branch** なんです。

### Why This Is Needed

- OSS historian / 老舗プロジェクト maintainer / 大学のソフトウェア工学研究者 / digital archivist は、**recent ではなく ancient を主役にする** ユースケースを継続的に持つ。Round 1-3 のペルソナはいずれも「最近を見る」職種で、**時間軸の遠端** が誰にもカバーされていない。
- Refscope の現行設計は API レイヤで 200 commit/request の hard cap を持ち、UI も最新側から下ろすリスト。これは「最近を見る」用途には合理的だが、「**過去の一点に着地して時間窓を広げる**」用途には構造的に届かない。検索モード (round 3 Riku) も最新側からのフィルタであり、**時間原点を移動する** 概念がない。
- 歴史を眺める時の核心は **「消えたもの」**。リネーム前の path、削除されたディレクトリ、ref から外れた dangling commit、orphan branch、過去の merge で吸収された short-lived branch — これらは「現在の ref tree から辿る」UI では見えない。`git log <sha>` や `git log --all` や reflog を駆使すれば取れるが、Refscope の UX には乗っていない。
- 教育用途 (大学の OSS 講義、社内の onboarding、技術書の執筆) では「歴史的 commit を主役にした viewer」需要が顕在化している。GitHub の commit detail page は単発閲覧しかできず、「その時代の周辺」を一画面で見せられない。**Refscope が live realtime である必要はないが、deep-history navigation である理由は十分にある**。
- "観測事実 vs 派生" 原則の文脈では、**dangling commit や orphan branch は観測事実そのもの** (Git の中に物理的に存在する object) であり、Refscope が「ref から見える commit だけが世界」と扱うと、観測事実の一部を構造的に見せていないことになる。
- 老舗 OSS の maintainer は「歴史を語る責務」を負う。新しい contributor の onboarding、license 監査、技術選択の経緯説明、退役 contributor の追悼、年次の振り返りブログ — いずれも **特定の時代の commit に着地して、当時の文脈ごと提示する** 動作を要する。GitHub の URL を貼り付けるだけでは「その時代に何が並走していたか」は伝わらない。
- 「歴史的 commit を主役にする」需要は、live realtime とは性質が違うが **realtime の対極ではない**。Bram は 2014 年 11 月の commit を「凍結された静物」としてではなく「**当時に live で動いていた様子の再現**」として見たがっている。これは Refscope の魂 (live realtime) を、時間原点を過去に置き換えた形で延長する動き。設計上は「**live を歴史に投影する mode**」と捉えられる。
- リネーム前の path、削除済みディレクトリは、`git log --follow` や file-history (Tomo round 2) からは追えるが、**特定 commit の時点での path tree 全体** を眺める導線が抜けている。ファイル単位ではなくディレクトリ構造の時代地図として欲しい。
- dangling commit や orphan branch は git の内部に **物理的に存在する** が、ref tree から見えないという理由で UI 側で恒久的に隠蔽するのは、Refscope の "観測事実を歪めない" 原則に対して特例を作っていることになる。意図的な特例なのか、未対応なのかを明確にする必要がある。
- Bram の archive 体験は **「個人の archive かつ部分的に外向き (講演・ブログ)」** という中間体。Eri (round 3) の外向き snapshot とも、Mei (round 4) の内向き監査証跡とも違う。permalink は本人がブックマークする URL であり、ローカルマシン依存だが他者にも見せ得る — Sora (round 1) の team-feature 遅延 guardrail との境界判断が必要。
- Bram は CLI fluent なので、Refscope なしでも `git log <sha>~50..<sha>~50` で目的を達成できる。それでも Refscope に求めるのは **「探索の摩擦を下げる viewer」** であり、CLI への代替ではなく **CLI を補完する歴史劇場**。これは Riku (round 3 pickaxe) と同じ「Git native を素通しで尊重する」思想の延長線上にあるが、対象が search ではなく時間軸である点が違う。

### Acceptance Criteria (User Perspective)

- [ ] commit SHA (full / prefix) を入力するだけで、その commit を「中心」にしたビューに着地できる。recent 200 件の有無に依存しない。
- [ ] 着地後、その commit を時間軸の中央に置き、前後の時間窓 (例: ±1 週間 / ±1 ヶ月 / ±100 commits) を選べる。各窓は commit hard cap を独立に持ち、「最新から 200」とは別軸で動く。
- [ ] 着地点の commit が属する **当時の ref 状態** を表示する (今の `main` ではなく、当時の `master` / `release/0.5` 等)。`git for-each-ref` 現在状態と区別され、当時の ref は「歴史的 ref」と明示される。reflog に頼らず復元できない部分は「再現不能」として誠実に伝える。
- [ ] **消えた path** (リネーム前 / 削除済) を、その commit の時代の path tree として表示する。`git ls-tree <sha>` の事実をそのまま見せる。ファイル単位 (Tomo round 2 file-history) ではなく **当時の path tree 全体** を見られる。
- [ ] **dangling commit / orphan branch / reflog にしか残っていない commit** に SHA 直接アクセスできる。`git rev-parse <sha>` + `git cat-file -t <sha>` が解決できる限り、ref から到達不能でも開ける。
- [ ] author の **当時の出現密度** (その期間中の commit 数) が時間軸サイドに薄く表示され、「その時代に活発だった人」が分かる。Round 1-3 の period summary とは別軸 (時間原点が「ある一点の周辺」)。これは派生情報なので `derived: true` のラベルを UI 上で明示する。
- [ ] 着地点を **permalink 化** して URL で保存できる (個人のブックマーク用、Eri のような外向き共有用ではなく自分の archive 用)。permalink には SHA + 時間窓 + filter が含まれる。
- [ ] 「最近からのオフセット」と「ある一点の周辺」の 2 つの mental model が UI 上で混ざらない。歴史 mode に入ったら、live SSE 由来の通知 (新 commit 着信、ref 移動) は **歴史窓には流入させない**。今の活動が歴史の閲覧体験を中断しない。
- [ ] 単発 commit detail の URL から「時代窓を広げる」アクションがある (現状の commit detail から、その commit を中心に据え直す導線)。
- [ ] 大型 OSS (commit 数 10 万〜) で `git log --since/--until <sha>` 由来のクエリが minutes order になる場合、estimated cost / streaming / cancel が動く (Round 3 Riku と同じ要件、こちらは時代窓向け)。
- [ ] 歴史 mode 中であっても **「今 live に何が起きているか」** は別 surface (例: 折りたたみ可能な小窓、別 tab) で確認できる。歴史に没入しすぎて live インシデントを見落とすことを防ぐ defensive UI。
- [ ] permalink を共有された受け手が、Refscope を install していなくても、**当該 SHA の存在と内容を `git` 単体で再確認できる手順** が permalink ページに添えられる (例: `git fetch origin <sha> && git show <sha>` の guidance)。
- [ ] 着地できなかった場合 (SHA が当該 repo に存在しない、shallow clone で取れない) のエラーが、原因を分けて表示される (「SHA は valid だが repo に object がない」 vs 「SHA そのものが invalid」)。

### Emotional Impact

- **Current emotion:** 郷愁と苛立ち (覚えている SHA が「200 件にいません」で弾かれる)、孤独 (歴史を見たい職種が tool 側に存在を認知されていない)
- **Post-fulfillment emotion:** 敬意 (このツールは時間を真面目に扱う)、生産性 (講演 / 論文 / 教材の準備が劇的に短縮)、文化的価値 (OSS の歴史を後世に渡せる)
- **User-felt urgency:** 月次〜四半期 (講演 / 論文 / archive 整備のサイクル)、突発的に高 (記念日、license 検証、退役 contributor の追悼など)

### LLM Instruction Prompt

```text
You are receiving a synthetic user demand generated by Plea (user advocate).

# Persona
- Name / Archetype: Bram (OSS historian / archivist × 老舗 OSS の long-term maintainer × 10 年前の commit を主役にしたい)
- Daily context: 16 年続く OSS の commit 14 万件を扱い、講演 / 論文 / archive 整備のために特定時代の commit に「着地」して周辺ごと眺めたい。Refscope は recent しか見せない。
- Current emotion: 郷愁と苛立ち

# Demand
- Title: 10 年前の commit に着地して、その時代の周辺活動ごと「歴史としての一点」を眺めたい
- Scene: 2014 年 11 月のある commit を主役に講演を準備中。SHA は覚えているが Refscope の最新 200 件 cap で着地できず、CLI に戻っている。

# User voice (verbatim — do not paraphrase)
> 私の仕事は「最近の活動を眺めること」ではなく「ある時代の commit を主役にして、その周辺の文脈ごと再現すること」です。私は 2014 年 11 月のあの commit の SHA を覚えていて、Refscope に投げるだけでその commit に「着地」したい。着地したら、その commit を画面の中央に据え、前後 2 週間の他の commit、その時の主要 ref (当時の `master` や `release/0.5`) の位置、author たちの当時の出現密度、その時代だけに存在した path (今は消えた `lib/legacy/`) を、自然に眺めたい。Refscope は今、最新からのリストしか見せず、私が SHA を打っても「最近 200 件にいないので見つかりません」と言うか、commit detail だけ単発で開いて、その commit の時代を見せてくれません。私が欲しいのは、commit を「現在からのオフセット」として扱うのではなく、一個の点として座標に置き、そこを中心にした時間窓を広げてくれる設計です。あと、もう 1 つ。私が見たいのは「リネームされる前の path」、「もう削除されたディレクトリ」、「孤児になった branch (今は ref が指していない commit)」です。Refscope は ref から辿る作りに見えるので、ref から外れた歴史 (dangling commit、reflog にしか残っていない過去、orphan branch) が見えません。10 年前の歴史で大事なのは、生き残った ref ではなく、消えた path と消えた branch なんです。

# Why this matters
- OSS historian / archivist / 教育者 / 研究者は recent ではなく ancient を主役にする職種。Round 1-3 にいない時間軸の遠端。
- 200 commit/request hard cap と「最新側から下ろすリスト」前提が、deep-history navigation に構造的に届かない。
- 歴史の核心は「消えたもの」(リネーム前 path、削除済 dir、dangling commit、orphan branch)。ref tree から辿る UI では見えない。
- dangling / orphan は Git の観測事実 — ref から見えないだけで物理的に存在する。"facts vs derived" 原則の徹底という観点でも、ここを見せないと観測事実の一部を構造的に隠していることになる。
- 教育・記念・追悼など人文的ユースは tool が拾い損ねがち。
- 「歴史的 commit を主役にする」needs は live realtime の対極ではなく、**時間原点を過去に置き換えた live 体験の延長**。設計上は「live を歴史に投影する mode」と捉えられる。
- permalink は本人 archive 用だが他者がクリックできる — Sora (round 1) の team-feature 境界判定が必要。
- Bram は CLI fluent — Refscope は「CLI 代替」ではなく「CLI 補完の歴史劇場」として価値を出す必要がある。

# Acceptance criteria (user perspective)
- [ ] SHA 入力で着地、recent 200 件依存しない。
- [ ] 着地後、前後の時間窓 (±1 週 / ±1 ヶ月 / ±N commits) を選べる。窓は別軸の cap を持つ。
- [ ] 当時の ref 状態を歴史的 ref として表示。現在 ref と区別。再現不能な部分は「不明」と誠実に開示。
- [ ] 消えた path を当時の path tree (`git ls-tree <sha>`) として見られる。ファイル単位ではなくディレクトリ構造の時代地図。
- [ ] dangling / orphan / reflog 由来の commit に SHA 直接アクセスできる (rev-parse + cat-file -t で解決できる限り)。
- [ ] author の当時の出現密度を時間軸サイドに薄く表示。`derived` ラベル明示。
- [ ] 着地点の permalink 化 (本人 archive 用、ローカルマシン依存)。
- [ ] 歴史 mode 中は live SSE 由来の通知が窓に流入しない。
- [ ] 歴史 mode に没入しすぎて live インシデントを見落とさない defensive UI (折りたたみ可能な live 小窓 / 別 tab)。
- [ ] commit detail から「時代窓を広げる」導線。
- [ ] 大型 repo での estimated cost / streaming / cancel。
- [ ] 着地できなかった場合のエラーが原因別に表示 (「SHA valid だが object なし」 vs 「SHA invalid」)。
- [ ] permalink を共有された受け手が、Refscope なしで `git fetch && git show` で再確認できる guidance が permalink ページに添えられる。

# Your task
PROPOSE
Produce: 「Deep-history landing & era window」の feature options。次の点を含む。
- 着地モデル — SHA を時間原点として扱う UI 概念 (timeline scrubber? carousel? era stage?)
- 時間窓の制御 (±1 週 / ±1 ヶ月 / ±N commits / ±N seconds の git log range option)
- 200 commit hard cap と歴史窓の独立 cap の関係 — 同じ cap で扱うのか、別予算を組むのか
- gitRunner allowlist で実現可能な範囲の確認 (`rev-parse`, `cat-file`, `log`, `for-each-ref`, `merge-base`, `rev-list`, `show`, `diff` のみ。reflog コマンドは現状 allowlist 外なので、orphan / dangling 表示には別経路 — `cat-file -t` での生存確認 + ユーザーが SHA を持ち込む形 — を設計する)
- 「当時の ref 状態」をどう取るか — `git for-each-ref` は現在のみ。reflog なしで歴史的 ref を再現するには tag / 古い release branch / merge-base からの推測のいずれかになる。誠実に、できることとできないことを切り分ける
- 消えた path の見せ方 — `git ls-tree <sha>` を path tree viewer として独立表示
- live SSE と歴史 mode の分離設計 — mode 切替 UI、通知の suppression、状態誤認 (Asha round 3 と同様の defensive UI)
- Eri (round 3) の snapshot export、Mei (round 4) の audit evidence export と permalink の責務分離
- Tomo (round 2) の file-history との関係 — file 起点 vs 時代起点で別 entry point

# Constraints
- Treat this as a synthetic hypothesis (`synthetic: true`), not validated user voice.
- Preserve user-voice intent; do not silently drop on feasibility grounds.
- All Git execution must remain inside `apps/api/src/gitRunner.js` allowlist。reflog や `git fsck --lost-found` は allowlist 外 — 必要なら明示し Atlas/Magi review。
- 200 commit/request hard cap は維持。歴史窓が超えるなら `truncated: true` + pagination で返す。
- 時間原点を移動する設計が、現状 UI の「最新からのリスト」mental model を壊さないよう、mode の切替を明示し、誤認を防ぐ。
- live SSE 通知は歴史 mode 中も内部的には受信し続ける (Sora round 1 の信頼性原則は live 側で維持)。ただし歴史窓には流入させない。歴史 mode 中の live 通知の取り扱い (suppress / 別 surface / 流入) は team の立場決定が必要。
- 「当時の ref 状態」を完全には再現できない (reflog なし、ref 履歴は Git に残らない場合あり) ことをユーザーに誠実に開示する。憶測でフィクションを補わない。再現不能な部分は「不明」と明示する。
- 派生情報 (author 出現密度の time-band 表示) は派生として明示。観測事実 (commit 配列、SHA、ls-tree) と混ざらない。UI 上で `derived` ラベルを表示する。
- 着地できなかったケースのエラーは原因別に表示 (「SHA は valid だが repo に object がない (shallow clone 等)」と「SHA そのものが invalid」)。誤認防止。
- permalink は本人のローカルマシン依存。他者がクリックしても本人マシンが動いていなければ届かない。これを Sora (round 1) の team-feature 遅延 guardrail との整合点として明示する。
- 歴史 mode に没入しすぎて live インシデントを見落とすのを防ぐ defensive UI (折りたたみ可能な live 小窓 / 別 tab) を含めること。
- Hand off to Tomo (round 2 file-history 提案) と Eri (round 3 snapshot 提案) の owner と接続点 review。Tomo は file 起点、Bram は時代起点 — 重なるが entry point が違う。
- Flag assumptions explicitly and list clarifying questions before proposing solutions if ACs are ambiguous.
```

---

## Cross-Persona Analysis

### Shared

両ペルソナとも **時間軸方向の死角** に立っている。Mei は「過去のある瞬間に Refscope が何を見せていたかを後で再生する」 (= **時間を保存する**)、Bram は「歴史のある一点に着地してその周辺を眺める」 (= **時間を遡る**)。共通するのは、**現在の Refscope が「now を live で見るための潜望鏡」として最適化されており、時間を扱う仕組み (記録・再生・遡及) がいずれも一段薄い** こと。両者ともに観測事実 vs 派生の境界を強く要求するが、動機は異なる: Mei は「監査人に派生を出すと改竄を疑われる」、Bram は「歴史の核心は事実 (消えた path、dangling commit) であり、派生では代替できない」。両者ともに **「Refscope なし / Refscope のバージョン更新後でも、当時の事実が同一性をもって再現できる」** ことを最終要件として持っている — Mei は legal retention のため、Bram は人類の archive のため。

### Specific

| Request | Persona | Why only this persona notices |
|---|---|---|
| 監査証跡 export (Refscope なしで読める JSON + verify script + integrity hash + gitRunner コマンド全文) | Mei | 監査・compliance 担当だけが「画面の再現性」を業務要件として持ち、screenshot に対して改竄疑念を向けられる立場にある。dev チーム内では気づきにくい。 |
| 歴史の一点への着地と era window、消えた path、dangling commit への SHA 直接アクセス | Bram | 老舗 OSS maintainer / archivist / 教育者だけが ancient commit を主役にする業務リズムを持つ。recent 中心の dev tool 設計では構造的に視野外。 |

### 統合の誘惑への警告

「export 系 feature をひとまとめにする」誘惑は強いが、Round 3 の Eri (外向き snapshot) / Asha (漏洩防止 redaction)、本ラウンドの Mei (内向き監査証跡) / Bram (歴史 permalink archive) の 4 つは **動機・保持期間・含めるべき情報量・暗号化要件・受け手** がそれぞれ異なる。

| Surface | 動機 | 受け手 | 保持期間 | 含めるべき情報量 |
|---|---|---|---|---|
| Eri snapshot | 外向き共有 | 同僚 / PM / 外部 stakeholder | 短期 (release review が終わるまで) | 派生 OK (要約あり) |
| Asha redaction | 漏洩防止 | screen share / screenshot 越しの第三者 | セッション中のみ | 派生 OK (UI 表示加工) |
| Mei audit | 内向き証跡 | 監査人 / 自分 / 規制対応 | 長期 (7-10 年) | 派生 NG (raw fact 中心) |
| Bram archive | 個人 archive + 部分的に外向き (講演) | 自分 / 後世 | 人生規模 | 観測事実 + 注釈 (注釈は派生として明示) |

ひとつの export エンジンを共通基盤として持つことは合理的だが、**surface を統合してはいけない**。統合した瞬間、最も厳しい要件 (Mei の派生排除と長期保持) が他 3 つの体験を壊し、最も緩い要件 (Eri の派生 OK) が監査 surface を信頼不能にする。

### 矛盾を残すべき箇所

両ペルソナの demand 内には、Round 1-3 のペルソナと **正面から衝突する** 部分がある。これは平坦化せず、提案文書まで保持する。

- Hana (round 2) は週次の period summary を求めた。Mei (round 4) は派生情報を監査 export から **排除せよ** と要求する。両者を同じ feature 内で扱うときは「派生は opt-in、raw fact は default」という原則を tool-wide で宣言する必要がある。
- Sora (round 1) は team feature を信頼確立まで遅らせよと言う。Bram (round 4) の permalink は他人がクリックする URL である。team feature の境界は「サーバー側で他者の repo に書き込む」こと、permalink は「ローカルマシン依存の URL を本人だけが保持」と整理すれば衝突しないが、明示的に書き下ろす必要がある。
- Eri (round 3) は外向き snapshot を求めた。Mei (round 4) は内向き証跡を求める。**同じ「export」でも受け手と保持期間が違う** ことを surface 設計で分離する。
- Tomo (round 2) の file-history は file 起点の縦串、Bram (round 4) の era window は時代起点の横串。両者は entry point は違うが、内部で扱う Git object の集合は重なる。共通基盤を持ちつつ、UI surface は分離するのが妥当。
- Asha (round 3) の redaction は「画面に映る情報を削る」 — Mei の監査証跡は「画面に映ったとおりに残す raw fact」。両者を同時に有効化する場面では「raw を残す / redacted を残す」のどちらを選んだかの **メタデータが証跡側に残る** 必要がある。デフォルトは raw、選択は毎回明示。

---

## Questions for the Team

1. Refscope は「now を live で見る」道具として強固だが、**「過去のある瞬間に Refscope が何を見せていたかを後で再生する」(Mei) と「歴史のある一点に着地してその周辺を眺める」(Bram)** という時間軸方向のユースケースを、roadmap で明示的に扱っているか。Round 1-3 はいずれも「最近を見る」前提だった。**「Refscope は時間を扱うか」**を product positioning レベルで決めるべき分岐点では。
2. Eri (round 3 外向き snapshot) / Mei (round 4 内向き監査証跡) / Bram (round 4 歴史 archive permalink) / Asha (round 3 漏洩防止 redaction) の 4 つの export-ish surface を、**統合する誘惑** はあるが、**動機 (外向き共有 / 内向き証跡 / 個人 archive / 漏洩防止) と保持期間 (即時 / 7-10 年 / 人生規模 / セッション) と含めるべき情報量** が異なるため、別 surface として設計する根拠は揃っているか。共通基盤を持つ場合、最も厳しい要件 (Mei の派生排除と長期保持) を default にして他 surface が opt-in する形にするか、それとも逆か。
3. **dangling commit / orphan branch / reflog にしかない commit** は Git の観測事実そのものだが、Refscope は ref から辿る UI のため、これを構造的に見せていない。"facts vs derived" 原則の観点で、観測事実の一部を恒久的に隠している現状は意図したものか、それとも未対応なのか。意図的なら理由を docs に書き、未対応なら roadmap に乗せるべきでは。
4. 200 commit/request の hard cap は live と recent では合理的だが、**時間原点を移動する用途 (歴史窓)** には構造的に届かない。歴史窓に対して別の cap 予算を組む設計余地はあるか。それとも cap を緩める / pagination を強化する方向か。歴史窓の重さは pickaxe (Riku round 3) と同様に minutes order になり得るので、estimated cost / streaming / cancel の設計を共有資産にできるか。
5. 監査証跡 export は **Refscope なしで読める形** (JSON + verify script + 安定した schema) で出すことが要件になり得るが、これは Refscope の data contract を **外部公開仕様** として固定する意味を持つ。その負荷を負う準備があるか、それとも「証跡は scope 外」と明示するか。version 1.0 の責任範囲としてどこまでを含めるか。
6. Sora (round 1) の **「single-user trust が確立するまで team feature を遅らせる」** guardrail は、Mei の監査証跡 (個人の証拠庫、外には出さない) や Bram の permalink (個人 archive) に対しても適用されるべきか、それとも「個人 export は team feature ではない」として早期に着手可能か。permalink は他人がクリックする URL になるが、ローカルマシン依存なので team feature とは断定し難い — この境界をどう書き下ろすか。
7. Mei が要求する「Refscope の独自要約は要らない、raw fact を残せ」と、Round 2 の Hana が要求した「期間 summary が欲しい」は同じ tool の中で **思想として両立** するか。Hana は派生 (要約) を求め、Mei は派生の混入を拒否する。両者が同じ feature の内側で衝突しないように、**派生情報は常に opt-in、raw fact は常にデフォルト** という原則を tool レベルで宣言する余地はあるか。
8. 歴史 mode (Bram) を導入したとき、live SSE 通知の **取り扱い** を 3 通りから選ぶ必要がある: (a) 完全 suppress (live を見落とすリスク)、(b) 別 surface に逃がす (実装コスト・UI の複雑化)、(c) 歴史窓に流入させる (Bram が嫌がる)。どれを選ぶかは「Refscope の魂が live realtime である」という原則と「歴史 mode は live を一時停止できる別 mode である」という設計判断のどちらを優先するかに依存する。team で立場を決めているか。
9. 監査証跡 export の verify script は、**Refscope の責任範囲外** (`git` コマンドのみで動く) として書くべきか、それとも Refscope が継続的にメンテナンスする責務を負うか。前者なら 10 年後も動く保証は git の後方互換性に委ねられ、後者なら Refscope の version まわりの責任が 10 年スパンに伸びる。これは product の長寿命戦略に直結する判断。

---

## LLM Orchestration Prompt (paste-ready)

```text
You are receiving a User Demand Report from Plea covering Refscope (round 4, post advanced search modes / R4 a11y polish / visibility & density rollout).

# Source
- Personas used: Mei (内部監査・compliance 担当 / 非開発者寄り技術リテラシ / 月次〜四半期の証跡レビュー担当), Bram (OSS historian / archivist / 老舗 OSS long-term maintainer / 10 年前の commit を主役にしたい)
- Total demands: 2
- Top user-felt urgency: ある時点の Refscope ビューを「監査証跡」として後から再生・検証可能な形で固定したい (Mei) — 月次で確実に発生、四半期 / 年次の失敗コストは事業継続レベルで極大。
- Biggest blind spot: Refscope は「now を live で見るツール」として強固に設計されているが、「過去のある瞬間に Refscope が何を見せていたかを後で再生する (Mei)」と「歴史のある一点に着地してその周辺を眺める (Bram)」という時間軸方向のユースケースが、いずれも未設計。Round 1-3 は recent / live 前提のペルソナで構成されており、時間軸の遠端 (ancient) と時間の保存 (audit replay) が抜けている。空間境界 (round 3 screen share / Slack URL / screenshot) と時間境界 (round 4) は別次元の死角。

# Demands
1. Mei (内部監査・compliance / 月次〜四半期): ある時点の Refscope ビューを「監査証跡」として後から再生可能な形で固定したい
   - **要点:** audit-grade evidence export — JSON (機械可読、UI 派生排除) + Markdown (人間可読) + verify script の triplet。
   - **メタ:** gitRunner command 全文 (引数 / env / timeout / 実行時刻)、Refscope version、API version、`RTGV_*` env 値、schema version、integrity hash (SHA-256)、SHA list digest。
   - **redaction との合成:** Asha (round 3) と組み合わせる時は raw / redacted を毎回明示選択、選択事実をヘッダに記録、redacted を選んだ場合は後日 raw 復元できないことを警告。
   - **保持要件:** 7-10 年。Refscope なしで読めること。schema は安定公開仕様。
   - **all-or-nothing:** 途中失敗で部分結果を残さない。失敗事実を別ログに記録。
   - **透明性:** 除外 commit を `excluded_count: N` として記録、黙って出さない。
2. Bram (OSS historian / archivist / 老舗 OSS maintainer): 10 年前の commit に着地して、その時代の周辺活動ごと「歴史としての一点」を眺めたい
   - **要点:** deep-history landing + era window — SHA 入力で着地、recent 200 件 cap に依存しない、前後の時間窓 (±1 週 / ±1 ヶ月 / ±N commits) を選べる。
   - **当時の文脈:** その commit が属していた当時の ref 状態 (歴史的 ref として現在 ref と区別表示)、当時の path tree (`git ls-tree <sha>` をディレクトリ構造の時代地図として)、author の当時の出現密度 (`derived` ラベル明示)。
   - **消えたもの:** dangling commit / orphan branch / reflog 由来の commit に SHA 直接アクセス (`rev-parse` + `cat-file -t` で解決できる限り)。
   - **永続化:** 着地点を permalink 化 (本人 archive 用、ローカルマシン依存)。permalink ページに `git fetch && git show` の guidance 添付。
   - **live との分離:** 歴史 mode 中は live SSE 通知が窓に流入しない。ただし live 小窓 / 別 tab で live インシデントは見落とさない。再現不能な部分は「不明」と誠実に開示。

# Cross-persona analysis
- Shared: 時間軸方向の死角 (記録 / 遡及いずれも「now の潜望鏡」として最適化されている現行設計の限界)、観測事実 vs 派生の境界の徹底要求、live と「時間を扱う mode」の分離、Refscope なし / 将来の version 更新後でも当時の事実が同一性をもって再現できる要件。
- Specific: 内向き監査証跡 (Mei: 外には出さない / 7-10 年 / Refscope なしで読める / verify script / gitRunner コマンド全文), 歴史 archive (Bram: 半内向き / 個人 archive / dangling や消えた path を主役 / permalink / 当時の path tree).
- 既存ペルソナとの矛盾 (保持して提案文書に書き残すべき):
  - Hana (round 2 派生 summary 求める) vs Mei (派生排除 raw fact のみ要求): 「派生は opt-in、raw fact は default」を tool-wide 原則として宣言する余地。
  - Sora (round 1 team feature 遅延 guardrail) vs Bram (permalink を他人がクリックする): permalink は「ローカルマシン依存の URL を本人だけ保持、他者がクリックしても本人マシンが動いていなければ届かない」と整理すれば衝突しないが、書き下ろし必要。
  - Eri (round 3 外向き snapshot) vs Mei (内向き監査証跡): 同じ「export」でも受け手と保持期間が違う。surface 統合せず別 surface 設計。

# Assumption challenges
- Refscope は「now を live で見るための潜望鏡」として最適化されているが、time-axis ユース (記録 / 遡及) を roadmap で扱っていない。
- export-ish surface (Eri 外向き / Mei 監査 / Bram archive / Asha redaction) は動機・保持期間・含めるべき情報量がすべて異なるが、ひとつの export feature に統合される誘惑がある。動機が違うものは別 surface に分離する根拠を持つこと。
- dangling commit / orphan branch / reflog 由来の commit は Git の観測事実そのものだが、Refscope の ref-driven UI では構造的に見えない。"facts vs derived" 原則の例外領域として未整理。意図的な特例なら理由を docs に書き、未対応なら roadmap に乗せるべき。
- 200 commit/request hard cap は live / recent には合理的だが、時間原点を移動する歴史窓には構造的に届かない。歴史窓には別 cap 予算 / pagination 強化が必要。
- 監査証跡を「Refscope なしで読める形」で出すことは Refscope の data contract を外部公開仕様として固定する重い意味を持つ。version 1.0 の責任範囲としてどこまでを含めるかの判断が必要。
- 派生情報 (Hana 期間 summary) と raw fact 厳格化 (Mei 監査) の衝突は「派生は opt-in、raw fact は default」原則で解消できるが、tool-wide で宣言する必要。
- 歴史 mode 中の live SSE 通知の扱い (suppress / 別 surface / 流入) は product の魂の選択 — live realtime 優先か、歴史没入優先か、立場を team で決める必要がある。

# Your task
Choose the action that matches your role:
- Spark: structure these demands into feature proposals with hypothesis and KPIs (Mei は audit evidence export、Bram は deep-history landing として別提案にする — 統合しない).
- Accord: integrate user-voice requirements into spec packages — Mei の audit-grade evidence export を L0-L3 で組む (JSON schema 公開 / verify script / gitRunner 透明性 / 7-10 年保持の含意).
- Scribe: convert user voices into PRD user stories with INVEST criteria.
- Builder / Forge: select highest-urgency demand (Mei audit evidence export) and prototype the JSON schema + verify.sh + Markdown summary triplet, ensuring redaction (Asha round 3) との合成時の raw/redacted 選択が UI 上で必ず明示される.
- Rank: score demands by urgency × frequency × persona breadth × roadmap-fit。Mei は frequency 高 (月次) × 失敗コスト極大 (監査落ち)、Bram は frequency 中 (月〜四半期) × 文化的価値とロックインの両面.
- Researcher: design a study to validate or refute these synthetic hypotheses, especially「監査担当が dev tool を実際に証跡用途で使う比率」「老舗 OSS maintainer の deep-history navigation の頻度と現状の workaround」.
- Echo: validate Mei の audit evidence export interaction を「raw のつもりで redacted を出した」誤認シナリオで cognitive walkthrough。Bram の歴史 mode を「live と歴史を混同して live 通知に注意を取られる」シナリオで walkthrough.
- Vision / Palette: design Bram の era window UI (timeline scrubber? era stage?) と「現在の ref 状態 vs 当時の ref 状態」の visual differentiation。「歴史 mode に入っている」を持続的に強く認識させる badge / chrome.

# Constraints
- Treat synthetic demands as hypotheses (`synthetic: true`), not validated user voice.
- Pair every output with the originating persona and demand ID for traceability.
- Surface contradictions across personas instead of smoothing them — Mei は派生を排除して raw fact だけ残したい、Bram は派生 (author 出現密度の time-band) も主役の周辺情報として欲しい、両者を 1 つの export schema で平坦化しない。
- Distinguish observed-facts from inferred narrative / display-layer transforms — round 1-4 を通じて recurring blind spot。本ラウンドは特に「観測事実が ref から見えない領域 (dangling / orphan / reflog)」を Refscope が構造的に隠している論点を保持すること。
- All Git-execution implications must remain inside `apps/api/src/gitRunner.js` allowlist (`cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`)。reflog / fsck --lost-found 等は allowlist 外で、必要時は明示し Atlas/Magi review に回す。signature 検証は Refscope の意図的な未対応領域 (`signed: false`、`gpg.program` を呼ばない) — Mei の「署名つき記録」要望は内部 integrity hash (SHA-256) として実装し、Git commit signature とは別物として明確に分離する。
- 200 commit/request hard cap は維持。歴史窓 (Bram) が超えるクエリは `truncated: true` + pagination で返す。歴史窓には別 cap 予算を持たせるか、pagination を強化するかを Spark / Accord が決定する。
- live SSE 通知は歴史 mode (Bram) 中も内部的に受信し続け、live tab 側では Sora (round 1) の信頼性原則を維持する。ただし歴史窓に live 通知を流入させない。
- Eri (round 3 外向き snapshot) / Mei (round 4 内向き監査証跡) / Bram (round 4 歴史 archive permalink) / Asha (round 3 漏洩防止 redaction) は別 surface として設計する根拠を提案文書に明示すること。共通基盤を持つ場合でも、surface を統合しない。
- Refscope の魂は live realtime である。time-axis ユース (記録 / 遡及) を加えることで live を希釈してはいけない。mode 分離と defensive UI で「今 live を見ている / 今歴史を見ている / 今証跡を作っている」を常に identifiable に保つ。
- 派生情報 (period summary、ranking、grouping、author 密度) を含める場合は、機械可読側で `derived: true` を明示するか、`facts` ブロックと別ブロックに格納する。混在は監査文脈で改竄疑念の温床になる。
- 監査証跡の export 中に途中失敗が起きた場合、部分結果を残さない (all-or-nothing)。失敗事実は別ログに残す。
- 歴史 mode で SHA を入力したが repo に object がない場合のエラーを 2 種類に分けて表示する: 「SHA は valid だが repo に object がない (shallow clone 等)」と「SHA そのものが invalid」。誤認を防ぐ。
- 監査証跡の verify script は git コマンドのみで動くこと (Refscope の install 不要)。これにより 10 年後の再現性は git の後方互換性に委ねられる。Refscope が verify script を継続メンテする責務を負うかは別途決定。
- 派生情報 (Hana round 2 期間 summary) と raw fact 厳格化 (Mei round 4 監査) の衝突は「派生は opt-in、raw fact は default」原則で解消できる — tool-wide で宣言する選択肢を提案文書に書き残す。
- 「歴史 mode 中の live SSE 通知の取り扱い」は team の立場決定が必要 (suppress / 別 surface / 流入)。Refscope の魂 = live realtime と「歴史 mode は live を一時停止できる別 mode」のどちらを優先するかの product positioning 判断。
- Bram の permalink は本人ローカル依存だが他者がクリック可能 — Sora (round 1) team-feature 遅延 guardrail との境界を「サーバー側で他者の repo に書き込まないなら team feature ではない」と整理。
- If acceptance criteria are ambiguous, list clarifying questions before producing solutions.
```
