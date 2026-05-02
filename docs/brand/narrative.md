# Refscope ブランドナラティブ

> このドキュメントは Refscope の世界観・コアメタファー・ブランドパーソナリティの一次定義です。後続の `visual-direction.md` / `voice-and-tone.md` / `microcopy.md` / `tokens.json` はすべてここから派生します。

## 1. コアメタファー: 観測所 (Observatory)

Refscope は「観測所」である。望遠鏡や顕微鏡という「単一の装置」ではなく、装置を備え、観測者が常駐し、観測ログを淡々と更新し続ける**場所**。

### 採用の根拠

- **常駐性** — ローカル Web アプリとして開きっぱなしで使われる性質と、観測所が「常時開いている」性質が一致する。
- **事実と解釈の分離** — 天文台は「何が観測されたか」（座標、光度、時刻）と「それが何を意味するか」（新星か、既知天体か、誤検出か）を厳密に分けて記録する。Refscope の "観測された事実 / 解釈" の核と同型。
- **書き換えの検知** — 天文台の本業のひとつは「以前と違う」を発見すること。force push / rebase / reset の検知はまさに天体写真の差分検出と同じ営み。
- **退屈なくらい信頼できる** — 観測所は派手に光らない。日々同じ手順で観測し、ログを残す。地味さが信頼の根拠になる。
- **態度の純度** — 「監視 (surveillance)」「警報 (alert)」「ガード (guard)」のような防衛的・敵対的トーンを避けつつ、観測の科学性は保てる。

### 比喩を pure に守る運用ルール

- Refscope は **警報を鳴らす** のではなく **観測を記録する**。
- Refscope は **侵入を防ぐ** のではなく **変化を見届ける**。
- Refscope は **判定する** のではなく **観測根拠と解釈を分けて並べる**。

## 2. ブランドエッセンス

> **Refscope is the observatory that turns your repository's history into something you can quietly trust.**
>
> （Refscope は、あなたのリポジトリの履歴を、静かに信頼できるものに変える観測所です。）

## 3. ブランドパーソナリティ

5 つの形容詞 — それぞれ "○○ではない" を伴う:

| Is | Is Not |
|---|---|
| **Calm** — 穏やか | flashy — けばけばしい |
| **Precise** — 精密 | pedantic — 衒学的 |
| **Patient** — 辛抱強い | slow — 鈍重 |
| **Honest** — 正直 | alarmist — 煽る |
| **Quiet** — 静か | invisible — 存在感がない |

## 4. ナラティブの三幕

### (A) ユーザーが直面する世界の現実

履歴は、見えないところで書き換えられる。force push、rebase、reset、reflog の expiry — 昨日まであった commit が今日には別物になり、誰がそれをやったのか、何が失われたのかが、誰の目にも触れずに通り過ぎていく。Mina は混乱し、Ren は苛立ち、Aki は不安になり、Sora は疑い始める。Git 自体は嘘をつかないが、Git の状態を「見る」ための道具のほとんどは、変化が起きた瞬間を捉えない。

### (B) Refscope が登場することで起きる変化

Refscope はリポジトリのそばに静かに開いて、refs と commits を観測し続ける。ref が動けば記録する。書き換えが起きれば、それを「観測された事実」として淡々と提示し、「これが何を意味するか」は別のレイヤーに分けて並べる。煽らず、推測でラベルを貼らず、何が分かっていて何が分かっていないかを区別する。色だけで意味を伝えない。更新が走っている最中でも、ユーザーが画面を読んでいるならフォーカスを奪わない。

### (C) ユーザーが到達する状態

Mina は、自分の認識と履歴のあいだに齟齬がないと知って安心する。Ren は、何が起きたかを確かめる手段を持っていることで、自分が制御できているという感覚を取り戻す。Aki は、自分の作業が静かに観測されていると分かって安全だと感じる。Sora は、Refscope が誇張も省略もしないことを繰り返し確認したのち、信頼を預ける。誰も Refscope のことを話題にしなくなる ── それが成功の形である。

## 5. ブランド・トーテム: 観測台帳 (the observation log)

旧式の天体観測所には、観測者が手書きで記録する台帳がある。観測時刻、対象、座標、観測条件、観測者の名前。そこには「美しい星雲を見た」とは書かれない。書かれるのは `03:14 UTC, RA 05h35m, Dec -05°23', seeing 2.1"` だけだ。解釈は別ノートに、別の手で書かれる。台帳そのものが嘘をつかないことに、観測所の科学性すべてが懸かっている。

Refscope はこの台帳を体現する。事実は事実として、解釈は解釈として、それぞれの欄に置かれる。台帳は派手ではない。だが、何十年経っても参照できる ── それが Refscope が目指す存在の形である。

## 6. 避けるべき世界観のトーン

| Anti-pattern | Why |
|---|---|
| **Hacker culture のかっこよさ** — green-on-black ターミナル、ASCII art、反体制トーン | Refscope は反体制ではなく科学者である |
| **DevOps の戦争メタファー** — war room, shield, guard, kill switch | Refscope は防衛装置ではなく観測装置。敵はいない |
| **AI 万能感 / 魔法トーン** — intelligent insights, magically detect, AI-powered | Refscope は推測しない。観測したことしか言わない |
| **警報装置の煽り** — 赤い点滅、ALERT!、DANGER!、効果音 | 事実を淡々と置くだけ |
| **ロマン化された "歴史 / タイムマシン" 比喩** — travel back in time, rewrite the past | Git の現実（履歴は本当に書き換わる）を曖昧にし、ユーザーを誤導する |

## 7. タグライン候補

採用順位は `README.md` の選定議論を待つ。現時点の候補:

1. **Quietly, your history is watched.**
2. **An observatory for your refs.**
3. **What was observed, and what it means — kept apart.**
4. **Boring trust for the history that matters.**
5. **The log that does not blink.**

---

**Source agent**: Saga
**Status**: 確定 (v0)
**Downstream**: `visual-direction.md`, `voice-and-tone.md`, `microcopy.md`, `tokens.json` がここから派生
