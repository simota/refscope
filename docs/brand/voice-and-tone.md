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

## 7. Observation phrase vs. interpretation phrase

Principle 4 ("Honest, not alarmist") establishes the *what* — facts before meaning. This section codifies the *how* — the syntactic patterns that distinguish an observation phrase from an interpretation phrase, in both English and Japanese, so that any reviewer can tell at a glance which kind a given string is.

Refscope's USP is that **observation and interpretation are visually and lexically separated**. If a string blurs the two, the USP leaks at the microcopy layer.

### 7.1 The two phrase types

| Type | What it claims | Required form (EN) | Required form (JA) | Required adjacency |
|------|----------------|---------------------|---------------------|-------------------|
| **Observation phrase** | A fact directly read from Git (hash, count, ref name, timestamp, parent count, exit code). | Plain declarative, present or simple past, no hedge. | 平叙文。体言止め可。推測語を含めない。 | None — stands alone. |
| **Interpretation phrase** | A pattern, label, or recovery hint inferred from one or more observations. | Hedged: must use one of the *interpretation markers* (§7.3) **and** sit adjacent to its evidence row. | 推測マーカー (§7.3) を必ず付け、根拠の観測行と隣接させる。 | Required — never appears without the observation it derives from. |

### 7.2 Examples (paired with the same evidence)

| Evidence (observation) | Wrong (interpretation written as observation) | Right (interpretation marked) |
|---|---|---|
| `Previous tip a8f2... is not reachable from 9f3c1a2.` | ❌ `History was rewritten.` | ✅ `Pattern matches: history rewritten.` |
| `Ref appeared at 12:04:33Z. Source: SSE remote-ref-update.` | ❌ `Force-pushed.` | ✅ `Pattern matches: force-pushed (source: remote update).` |
| `12 commits ahead of \`main\`, 0 commits behind.` | ❌ `Branch is ready to merge.` | ✅ — (no interpretation; show the count and let the reader judge). |
| 観測: `以前の tip a8f2 は 9f3c1a2 から到達できません。` | ❌ `履歴が書き換えられました。` | ✅ `観測パターン: 履歴の書き換え。` |

### 7.3 Interpretation markers (the only allowed forms)

Use one of these — never a bare declarative — to flag an inference.

**English markers (in priority order):**
1. `Pattern matches: …` — preferred. Names the inference category without claiming certainty about the cause.
2. `This looks like … because <evidence>.` — when the cause must be named (e.g. "force-pushed").
3. `Likely …` / `Appears to be …` — short variants for inline labels (≤ 4 words).

Banned in interpretation: a bare past tense ("rewritten", "force-pushed") *unless* the surface is a normalized status badge from `microcopy.md` §2 — those badges are typographically separated from running text and rely on adjacency to the fact row.

**Japanese markers (in priority order):**
1. `観測パターン: 〜` — preferred (mirrors `Pattern matches`).
2. `〜のように見えます (根拠: <observation>)` — when the cause must be named.
3. `〜の可能性があります` / `〜と考えられます` — inline. Avoid stronger forms like `〜です`, `〜と判断しました`.

Banned: 断定形 (「〜です」「〜が起きました」) を根拠なしに使う。「警告」「危険」は §6 の禁止語と二重で禁止。

### 7.4 Evidence linking (interpretation strings)

Every interpretation phrase must be **adjacent to a verifiable observation**. "Adjacent" means one of:

- Same card / panel / list row, within 80 characters of vertical space.
- Linked by `Based on:` / `Evidence:` / `根拠:` followed by hash, count, timestamp, or `git` command.
- Inside a fact row whose siblings are pure observations (e.g. the `Observation log` panel in `microcopy.md` §3.2).

If the surface cannot show the evidence, the string must downgrade from interpretation to observation, or it must not ship.

### 7.5 Tag mark for review

Every string in `microcopy.md` carries one of three tags so reviewers and lint rules can mechanically check it:

- `[obs]` — observation phrase.
- `[interp]` — interpretation phrase. Must include or link to its evidence (§7.4).
- `[ui]` — neutral UI scaffolding (button labels, navigation, generic empty-state instructions). Not a claim, so neither obs nor interp.

A new string may not be added to `microcopy.md` without one of these tags. The tag also appears in code comments next to the string in TSX, when the string is more than a single label, so reviewers can find evidence at the call site.

### 7.6 Failure modes (where the rule has historically leaked)

These are the patterns reviewers have caught after the fact; treat them as recurring red flags.

- **Status badges drifting into running text** ("rewritten" written as a verb in a sentence rather than as the §2 status label).
- **Inference disguised as a verb tense** ("history was rewritten" reads like an observation but the rewrite *judgment* is an inference from the prev/curr hash mismatch).
- **Recovery hints that assume the cause** ("To undo the force-push, …") — name the recovery without naming the cause when the cause is inferred.
- **Localized bare past tense** (Japanese 「書き換えました」 reads more declarative than English "rewritten" because the JA past tense lacks the EN passive-voice ambiguity — be stricter in JA).

---

## 8. Governance

- Any new user-facing string must be checked against sections 3, 4, 5, 6, and 7 before it ships.
- Every new string in `microcopy.md` must carry an `[obs]`, `[interp]`, or `[ui]` tag (§7.5). PRs that introduce untagged strings should be returned for re-tagging.
- Status labels (`new`, `rewritten`, `force-pushed`, `merge`, `signature unknown`, `error`) are governed in `microcopy.md` section "Status badges". They are normalized vocabulary; do not invent synonyms in code.
- When a string fails the voice check, propose the rewrite alongside the original; do not silently change strings that may be referenced elsewhere.
- The replacement mapping at the end of `microcopy.md` is the canonical migration list for existing strings in `apps/ui/src/app/components/refscope/`.
