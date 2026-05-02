# Refscope — Voice & Tone Guide

> "Refscope is the observatory that turns your repository's history into something you can quietly trust."

This guide is the binding contract for every user-facing word in Refscope: UI labels, status text, error messages, ARIA announcements, README, GitHub description. It encodes the Saga (observatory metaphor, observation-log totem) and the Vision (calm precision) into rules that copywriters, engineers, and reviewers can apply mechanically.

If a string in the product contradicts this guide, the string is wrong — not the guide.

---

## 1. Voice principles

Voice is constant. It does not shift between screens, error states, or releases.

| # | Principle | Do | Don't |
|---|-----------|----|-------|
| 1 | **Calm, not flashy.** Refscope reports; it does not perform. | "History rewritten on `main`." | "ALERT! Force-push detected!" |
| 2 | **Precise, not pedantic.** Use the exact Git noun, but never lecture the user about Git. | "Tag `v1.2.0` now points to `9f3c1a2`." | "As you may know, in Git, a tag is a named reference to..." |
| 3 | **Patient, not slow.** Wait for the observation; never invent one. | "Waiting for the next ref update." | "Nothing is happening. Try again later." |
| 4 | **Honest, not alarmist.** Distinguish observed facts from inferred meaning. | "Previous tip `a8f2…` is no longer reachable." | "Your work was destroyed." |
| 5 | **Quiet, not invisible.** Speak when the observation matters; stay silent otherwise. | One line in the live region when a ref moves. | A toast on every successful poll. |

### Voice keywords (final)

- **voice:** calm, precise, observant, transparent, restrained.
- **anti:** flashy, alarming, playful, mystical, opinionated.

### Persona promise

Each principle maps to one persona's emotional turn:

- **Mina (confused → reassured)** — Principle 1, 5: no false alarms, no noise.
- **Ren (irritated → in control)** — Principle 2, 3: exact Git nouns, no condescension.
- **Aki (anxious → safe)** — Principle 4, 5: facts before interpretation, screen-reader parseable.
- **Sora (skeptical → trusting)** — Principle 4: every claim is grounded in an observation.

---

## 2. Tone shifts by situation

Tone *adapts* to the user's state. Voice does not.

| Situation | Tone shift | Notes / pitfalls |
|-----------|------------|------------------|
| **Normal** (browsing refs, reading commits) | Neutral, descriptive, lowercase facts. | No exclamation marks anywhere. No "Great!" or "Done!". |
| **Rewrite detected** | More structured, more sober. Lead with the fact, follow with the inferred label, end with the recoverable hash. | Never use "danger", "destroyed", "lost". Use "no longer reachable from this ref". Always show the previous object id so the user can recover. |
| **Error** | Direct, blameless, recovery-oriented. What / Why / Next. | Never blame the user. Never apologize. Never use "Oops". State what was attempted, what blocked it, what to try. |
| **Paused** (live updates suspended) | Quiet acknowledgment + one-line invitation to resume. | Do not nag. Do not show counters of "missed" events as warnings. |
| **First-run** | Brief welcome (2-3 sentences), one orientation hint, no marketing. | No exclamation marks. No emoji. No "Welcome to the future of Git". |

---

## 3. Word-choice decision rules

When two words could fit, the table picks. These are not preferences — they are the rule.

| Use | Avoid | Rationale |
|-----|-------|-----------|
| **notice**, **observation**, **record** | **alert**, **alarm**, **warning** (as a noun) | Observatory metaphor. "Alert" implies action-required urgency Refscope does not impose. |
| **rewritten** (label) / **history changed** (description) | **force-pushed**, **destroyed**, **rewound** | "Force-push" describes a cause we cannot prove from history alone. See section 5. |
| **observed at** | **detected at**, **caught at**, **noticed at** | "Detect" implies certainty about meaning; "observe" only claims the fact. |
| **no longer reachable** | **lost**, **deleted**, **gone** | Most "lost" commits are recoverable via reflog. |
| **you** (UI), **the user** (docs only) | **we**, **your team**, **users** | Singular second person; never first person plural in product copy. |
| **can** ("You can resume live updates.") | **please**, **kindly** | Restraint > politeness. State the option. |
| **ref** (in tight UI) / **reference** (in long-form docs) | **branch/tag** when the type is unknown | Use the precise type when known; use "ref" as the umbrella. |
| **tip** (commit at the end of a ref) | **head**, **HEAD** (unless literally the symbolic ref) | "HEAD" is reserved for the actual symbolic ref. |
| **signature unknown** | **unsigned**, **not signed**, **invalid** | Refscope does not verify signatures. It must not assert their state. |
| **paused** | **off**, **disabled**, **stopped** | Pause implies resumable; the others imply a fault. |

---

## 4. English style guide

Follow these rules without exception.

- **Sentence case** for all UI strings, including buttons, menu items, headings, and section titles. Section titles in the existing sidebar use ALL CAPS as a typographic style — this is a visual treatment, not a spelling. The source string is sentence case (e.g., the source is `Branches`, rendered as `BRANCHES`).
- **Oxford comma** in lists of three or more.
- **Active voice** by default. Passive is allowed only when the actor is unknown or irrelevant ("History was rewritten between 12:04 and 12:07.").
- **No exclamation marks.** Anywhere. Including success states.
- **No "please".** Restraint over politeness. Replace `Please try again` with `Try again` or `Retry`.
- **No emoji** in product copy. (Logs, README badges, and external marketing are out of scope for this guide.)
- **Numbers:** spell out zero through nine in prose; use digits for counts in UI (`3 commits`, not `three commits`).
- **Time:** prefer relative time in UI (`2 minutes ago`), absolute ISO 8601 in tooltips and tables (`2026-05-02 14:23:11Z`).
- **Hashes:** always show short hash (7 chars) with full hash on hover or copy.
- **Code-style nouns:** wrap ref names, hashes, paths, and commands in backticks. Example: `main`, `9f3c1a2`, `apps/api/src/server.js`.
- **Ellipsis:** use the single character `…`, not three dots. Reserve for in-progress states (`Loading…`).
- **Quotation marks:** double curly quotes "..." in long-form docs; straight quotes "..." in code-adjacent UI.

### Readability target

Flesch-Kincaid Grade Level **9-11**. Refscope's audience is professional developers, but the calm voice keeps sentences short and scannable.

---

## 5. Japanese style guide

Refscope is currently English-first, but every UI string in this microcopy deck has a Japanese counterpart that ships when localization lands. The Japanese voice must read like a careful observer — a scientist's notebook, not a help desk.

### Register

- **です／ます調** をベースに。命令形 (「〜しろ」) と過剰なくだけた口調 (「〜しちゃう」) は禁止。
- **観測事実は体言止めも可。** 例: 「ref `main` を書き換え。」「読み込み中。」 ただし操作の説明と混ぜず、ラベルや事実欄に限定する。
- **「〜してください」より「〜できます」を優先。** ユーザーに動作を強制せず、選択肢として提示する。
  - Bad: 「もう一度試してください。」
  - Good: 「もう一度試せます。」「再試行できます。」
- **「ご〜」「お〜」の過剰敬語は使わない。** 「ご確認ください」→「確認できます」。

### 禁則

- **感嘆符 (`！`) は使わない。** 全角・半角ともに。
- **「！」「？！」「♪」「☆」など装飾記号** は使わない。
- **AI・SF・魔法系の比喩** (「魔法のように」「タイムトラベル」「インテリジェント」) は使わない。
- **「やばい」「ヤバい」「神」「最強」** などスラング系は使わない。
- **機械翻訳臭の強い直訳** (「あなたのリポジトリ」のような所有代名詞の機械的付与) は避ける。日本語では主語を省略するのが自然。

### 観測者語彙の選択

英語の `detected` / `error occurred` を直訳しない。観測者の語彙に置き換える。

| 直訳 (避ける) | 推奨 |
|--------------|------|
| 検出しました | 観測しました／記録しました |
| エラーが発生しました | 〜を確認できませんでした／〜に応答がありません |
| 危険です | この ref の履歴は書き換えられています |
| 失われました | この ref からは到達できなくなりました |
| 無効な〜 | 〜を解釈できませんでした |
| 警告 | 観測ノート／注記 |

### 句読点・記号

- 句点は `。`、読点は `、`。
- 半角英数字と日本語の間にスペースは入れない (CSS の `font-feature-settings` で調整)。
- ref 名、ハッシュ、パスは `` ` `` で囲む。例: `` `main` を書き換え `` 。
- 省略記号は `…` (三点リーダー一文字)。`...` は使わない。

### 読み上げ検証 (Aki ペルソナ)

スクリーンリーダーで読み上げて意味が壊れないこと。具体的には:

- 体言止めは独立した行・カードでのみ使用。文中に混在させない。
- 数字は `5件` のように単位を必ず付ける (`5` だけにしない)。
- ハッシュは ARIA で `9f3c1a2` を `9 f 3 c 1 a 2` と読み上げられても通じるよう、文脈で「ハッシュ」「commit」などの名詞を添える。

---

## 6. Avoid words list (English & Japanese)

These words must not appear in product copy. Substitutions are listed in section 3 and section 5.

| Banned (EN) | Banned (JA) | Why |
|-------------|-------------|-----|
| alert!, danger, destroyed, lost forever | 危険、消失、破壊、警告！ | Alarmist; contradicts observatory voice. |
| magic, magical, intelligent, smart | 魔法、インテリジェント、賢い | Mystical/AI-marketing tone. |
| AI-powered, AI-driven | AI 搭載、AI が自動で | Refscope has no AI features. False claim. |
| killer feature, game-changer | 神機能、革命的 | Hype. |
| rocket, blazing fast, lightning | ロケット、爆速、光速 | Hacker-culture aesthetic. |
| time travel, time machine | タイムトラベル、タイムマシン | Romanticizes history rewrites. |
| oops, whoops, uh-oh | あれ？、おっと、しまった | Frames errors as cute. |
| please, kindly | 〜してください (推奨外で多用), 恐れ入りますが | Over-polite; eats scan time. |
| just, simply, easily | 簡単に、ただ〜するだけ | Belittles the user when it doesn't work. |
| we, our team | 私たち、弊社 | Refscope's voice is singular and observational, not corporate. |

---

## 7. Governance

- Any new user-facing string must be checked against sections 3, 4, 5, and 6 before it ships.
- Status labels (`new`, `rewritten`, `force-pushed`, `merge`, `signature unknown`, `error`) are governed in `microcopy.md` section "Status badges". They are normalized vocabulary; do not invent synonyms in code.
- When a string fails the voice check, propose the rewrite alongside the original; do not silently change strings that may be referenced elsewhere.
- The replacement mapping at the end of `microcopy.md` is the canonical migration list for existing strings in `mock/src/app/components/refscope/`.
