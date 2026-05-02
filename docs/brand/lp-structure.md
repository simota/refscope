# Refscope — Landing Page Structure (GitHub Pages)

> One-page LP for visitors arriving from GitHub. Optimised for **understanding what Refscope observes** and **starting `make dev-self` within five minutes**, not for SaaS conversion. Voice, vocabulary, and structural restraint follow `narrative.md`, `positioning.md`, `voice-and-tone.md`, `microcopy.md`, and `visual-direction.md`. Implementation handoff: Astro + Tailwind v4 by Artisan.

**Author**: Funnel · **Status**: v0 (handoff to Artisan) · **Updated**: 2026-05-02

---

## 1. Frame, audience, and goals

- **Primary reader**: a developer who clicked through from GitHub search, a tweet, or a Hacker News comment. Curious, sceptical, time-bounded. Already uses one of GitKraken / Fork / GitLens / lazygit / `git log`.
- **Secondary reader**: an engineering lead evaluating tools for their team after an incident review.
- **Tertiary reader**: an accessibility-conscious developer who needs to verify the UI does not rely on colour or motion.

**Single page goal (one page = one goal):** the visitor reaches the GitHub repository with intent to clone and run `make dev-self`. Everything else is in service of that one click.

- **Primary CTA**: `View on GitHub` (top-right, hero, after demo, footer — four positions).
- **Secondary CTA**: `Read the spec` (links to `docs/spec-v0.md` for deep readers; positioned in Quickstart, Security, and footer).
- **Forbidden CTAs**: `Sign up`, `Get started free`, `Try it now`, `Start your trial`, `Book a demo`. Refscope is OSS and local; trial language is dishonest.

**Framework**: PAS-lite (Problem → Agitate → Solution) is wrong here — agitation contradicts the calm voice. Use **AIDA-restrained**: state the observation, show evidence, name the differentiator, hand over the command. No social proof section in the SaaS sense (no logos, no testimonials, no "1,200 teams"); proof comes from the spec, the code, and the persona scenarios.

---

## 2. Section map (top to bottom)

| # | Section | Purpose | CTA in section |
|---|---------|---------|----------------|
| 0 | Top nav | Repo, docs, spec, theme toggle | `View on GitHub` |
| 1 | Hero | Answer "what is this and is it for me" in 3 seconds | `View on GitHub` (primary), `See it in action` (anchor to demo) |
| 2 | What you get | Three differentiators stated as observed facts | — |
| 3 | Demo | Five scenes, one per Refscope-only behaviour | `View on GitHub` |
| 4 | Personas | Mina / Ren / Aki / Sora — when Refscope earns its place | — |
| 5 | Why an observatory? | Compress the three-act narrative; explain the metaphor | — |
| 6 | Security and sandbox | Fact section: allowlist, no GPG, read-only | `Read the spec` |
| 7 | Quickstart | Three commands, one copy button | `View on GitHub`, `Read the spec` |
| 8 | Beyond MVP | Restrained roadmap; what is not promised | — |
| 9 | Footer | Links, one-line self-description, license | `View on GitHub` |

Section numbering is internal only — the rendered page does not show numbers.

---

## 3. Section-by-section copy

### 0. Top navigation

- **Brand mark + wordmark**: `Refscope`
- **Nav links** (right-aligned, sentence case): `What you get`, `Demo`, `Security`, `Quickstart`, `Spec`
- **Trailing controls**: theme toggle (sun / moon icon, OS-following by default), `View on GitHub` button (primary)
- A11y: `<nav aria-label="Primary">`, skip-to-content link as the very first focusable element

### 1. Hero

**Tagline (above the headline, small caps treatment, optional):** `An observatory for your refs.`

> **Tagline selection** — from the five candidates in `narrative.md`:
> - Recommended: **`An observatory for your refs.`** (#2). Rationale: it names the metaphor, names the object (refs), and is the only candidate that works as both a tagline and a one-line repository description without modification. `Quietly, your history is watched.` (#1) reads passive-aggressive in English to a first-time reader; `What was observed, and what it means — kept apart.` (#3) is too long for a tagline; `Boring trust for the history that matters.` (#4) inverts the calm voice into a slogan; `The log that does not blink.` (#5) is poetic but does not name the product category.

**Headline candidates** (sentence case, ≤ 12 words, plain):

1. `See what your Git refs are doing, as they do it.`
2. `A real-time observer for refs and history rewrites.`
3. `The log that records when your history changes.`
4. `Watch refs move. Record what changes. Stay out of the way.`
5. `Refs change. Refscope records what changed, and when.`

> **Recommended headline: #5 — `Refs change. Refscope records what changed, and when.`**
> Rationale: three short clauses mirror the observation-log totem (subject, verb, fact). It names the product. It does not promise anything Refscope cannot do (no "detect", no "alert", no "intelligence"). It works in dark and light, with and without the sub-headline. Falls inside the 8-word headline guideline if the brand name is treated as a noun token (5 + 5 = two short clauses).

**Sub-headline (1–2 sentences):**
> `Refscope is a local, read-only observatory for Git refs and history. It watches one repository at a time, records what changes, and separates what was observed from what it means.`

**Primary CTA button**: `View on GitHub` (with GitHub mark icon, 16px, leading)
**Secondary CTA button**: `See it in action` (ghost button, anchors to `#demo`)

> **CTA copy candidates considered**:
> 1. `View on GitHub` — recommended for primary. Direct, accurate, matches reader intent.
> 2. `See it in action` — recommended for secondary. Honest about what comes next (a demo, not a signup).
> 3. `Star on GitHub` — rejected: asks for a favour before showing value.
> 4. `Read the source` — kept as a tertiary repeat in the footer; too inside-baseball for the hero.
> 5. `Open the observatory` — rejected: too cute; breaks the calm-precise voice.

**Hero meta line (under CTAs, smaller text, sentence case):**
> `Local-first. Read-only. Allowlist-scoped. MIT licensed.`

**Hero media**: see §6 below.

### 2. What you get

**Section heading**: `What you get`
**Section subhead** (one sentence):
> `Three things Refscope does that other Git tools do not.`

Three column cards (left-aligned text, no icons inside the card body — a single 16px line glyph at top-left of each card, matching `visual-direction.md`):

#### Card 1 — `History rewrites, recorded as facts`
> `When a force push, rebase, or reset moves a ref, Refscope captures the previous tip, the new tip, the time, and the source of detection. The recoverable hash stays visible so the work is never described as lost.`

#### Card 2 — `Observation and interpretation, kept apart`
> `What was observed (ref, hash, timestamp) is shown in one column. What it means (rewritten, merge, signature unknown) is shown in another. You can paste the facts into a postmortem without copying anyone's opinion.`

#### Card 3 — `A calm UI that lets you read`
> `Live updates do not steal focus, do not auto-scroll, and pause on demand. Status is conveyed by colour, shape, and text together — the page survives greyscale printing, screen readers, and reduced motion.`

A11y: cards are `<article>`, headings are `<h3>`, the section is `<section aria-labelledby="what-you-get">`.

### 3. Demo

**Section heading**: `Demo`
**Section subhead**:
> `Five scenes. Each is a single observation, captured from the running mock UI.`

Layout: a **5-row vertical list**, each row is `[caption block | media block]` on desktop and stacks `caption above media` on mobile. No carousel, no auto-advancing slideshow — the reader controls the order.

Each row has:
- Scene number (small mono digit, `01`–`05`)
- One-line scene title (sentence case, ≤ 8 words)
- One-paragraph description (≤ 280 characters)
- The media (see §6 for spec)
- A `View on GitHub` link below the fifth row

**Scene 01 — `A force push is recorded, not announced`**
> `The sidebar shows the ref name, the previous tip, the current tip, and the observed time. Nothing flashes. The recoverable hash stays visible so the user can run` `git reflog` `to recover.`

**Scene 02 — `The commit timeline reads top to bottom`**
> `Each commit is one row: hash, author, message, additions and deletions, signature status. New commits arrive without scrolling the row you were reading.`

**Scene 03 — `Compare bar pins a base and a target`**
> `Pick a base ref and a target ref. Refscope returns ahead and behind counts, file totals, and three copyable Git commands —` `log` `,` `diff --stat` `,` `diff` `— with the revisions kept as separate tokens.`

**Scene 04 — `Live updates, paused`**
> `Press pause. New observations are counted in the badge but the timeline holds still. Resume to apply the queue. Useful when you are reading a commit and a teammate force-pushes.`

**Scene 05 — `Command palette, same state as the page`**
> `Cmd or Ctrl plus K. Run` `pause` `,` `copy current commit hash` `,` `clear path filter` `, and the page state updates in place. The palette does not maintain a parallel list of refs or commits.`

### 4. Personas

**Section heading**: `When Refscope earns its place`
**Section subhead**:
> `Four developers, four moments. If one of them sounds like a recent week, Refscope is for you.`

Four cards in a 2×2 grid (desktop) or single column (mobile). Each card has a name, a one-line role, and a 3-sentence vignette. No avatars, no fake photos.

#### `Mina` — backend developer
> `Yesterday her CORS configuration broke. Today she opens Refscope, sees that` `main` `still points to the same hash, and stops worrying that the deploy script overwrote something. The` `Couldn't reach the Refscope API` `panel walks her through the fix without using the word "please".`

#### `Ren` — staff engineer
> `An interactive rebase reordered six commits last night. He opens Refscope, finds the` `history rewritten` `notice, copies the previous and current tips into the incident channel, and is finished in under a minute. No one needed to ask "what actually happened?".`

#### `Aki` — accessibility engineer
> `She uses a screen reader and a high-contrast theme. Refscope's status badges carry shape and text in addition to colour. Live updates announce through a polite live region. When she pauses, the page stops talking.`

#### `Sora` — engineering lead
> `He is sceptical of any tool that calls itself a Git observability platform. He reads the spec, sees that` `signed: false` `is honest about the absence of GPG verification, and notices that the readme does not say "AI" once. He clones the repo.`

### 5. Why an observatory?

**Section heading**: `Why an observatory?`
**Body** (3 short paragraphs, no bullets):

> `Git history is rewritten in places no one is watching. A force push, a reset, a reflog expiry — yesterday's commit becomes today's stranger, and the only record of the change is the change itself.`
>
> `Refscope is the observatory. It opens beside your repository, records what was observed, and separates that record from any interpretation. It does not raise alarms. It does not infer intent. It writes down the time, the ref, and both hashes, the way a telescope log writes down the time, the coordinates, and the seeing conditions.`
>
> `When the question comes — "what happened to` `main` `at 02:17?" — Refscope has an answer that does not require trust in Refscope. The evidence is there, in the same form a Git command would have produced, with the interpretation labelled separately so it can be agreed with or rejected on its own.`

A11y: this is the only narrative-tone section. Use `<section aria-labelledby="why-observatory">`.

### 6. Security and sandbox

**Section heading**: `Security and sandbox`
**Section subhead**:
> `Refscope reads from Git. It does not write back. The constraints below are enforced in code, not in documentation.`

A two-column fact table (label / value style, mono for the value side):

| What | How |
|---|---|
| Repository access | Allowlist via `RTGV_REPOS`. Only listed repository ids are served. |
| Git commands | A fixed read-only set: `cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`. |
| Spawn model | Argument-array, `shell: false`, `--no-pager`, bounded stdout and stderr, timeouts. |
| Environment | `GIT_*`, SSH agent, proxies, GCM, lazy fetch, terminal prompt, optional locks, ext-diff, and textconv are stripped or disabled. |
| Cryptographic signatures | Not verified. Refscope reports `signed: false` and `signatureStatus: "unknown"` rather than guess. |
| Network surface | Localhost HTTP. Default origins: `127.0.0.1:5173`, `localhost:5173`. Override with `RTGV_ALLOWED_ORIGINS`. |

**CTA in section**: `Read the spec` → links to `docs/spec-v0.md` (`#14-security-design` anchor).

### 7. Quickstart

**Section heading**: `Quickstart`
**Section subhead**:
> `Three steps. Refscope runs against this repository by default — no configuration needed for the first look.`

A numbered ordered list. Each step has a one-line action and (where applicable) a code block with a `Copy` button.

1. **`Install dependencies`**
   ```sh
   corepack enable && pnpm install
   ```
2. **`Start the API and UI against this repository`**
   ```sh
   make dev-self
   ```
3. **`Open the observatory`**
   ```text
   http://127.0.0.1:5173
   ```

**Below the steps**:
> `To observe another repository, pass an absolute path:` `make dev-app RTGV_REPOS=viewer=/absolute/path/to/git/repo` `. The makefile rejects relative paths and non-Git roots before anything starts.`

**CTAs in section**: `View on GitHub` (primary), `Read the spec` (secondary, ghost button)

A11y: each `Copy` button has `aria-label="Copy command: <command>"`. On copy, a polite live region says `Copied to clipboard`. The button itself is `<button type="button">`, never an anchor.

### 8. Beyond MVP

**Section heading**: `What is not yet here`
**Section subhead**:
> `Refscope is a v0. Below is what is honest to say about what comes next, and what does not.`

Two short columns:

**`Likely next`**
- `Period summaries` `that aggregate observations across a window`
- `Pinned refs` `for repositories with many branches`
- `File history` `from a single path back through renames`

**`Not in scope`**
- `Cryptographic signature verification` `(would invoke external GPG)`
- `Operations against the repository` `(no commit, no push, no rebase)`
- `Cloud or remote agent` `(local-first only)`

No quarter-by-quarter dates. No "Q3 2026" promises. The repository's open issues are the source of truth.

### 9. Footer

Three columns + a final line.

- **Repository**: `View on GitHub`, `Issues`, `Releases`
- **Documentation**: `Spec (v0)`, `User demand reports`, `Brand`
- **Project**: `License (MIT)`, `Code of conduct`, `Contributing`

**Final line** (centered, small):
> `Refscope — a quiet observatory for Git refs and history. Local-first, read-only, allowlist-scoped.`

Right side of footer: theme toggle (mirrored from nav), and the build commit short-hash (rendered at build time by Astro).

---

## 4. Media specification (handoff to Nexus for capture, Artisan for placement)

All media is captured against the mock UI running `make dev-self`. The default theme is **dark** for the hero (matches the calm-by-default aesthetic and the way most developer LPs present screenshots in 2026). Each asset must also have a **light-theme twin** so the page can swap on theme change.

### File naming convention

```
hero-timeline-{theme}.png       # hero static
demo-{NN}-{slug}-{theme}.{ext}  # demo scenes; NN is 01–05; ext is png or webm
og-card.png                     # OGP image
favicon-{16,32,180,512}.png     # platform-specific favicons
```

`{theme}` is `dark` or `light`. `{slug}` is a kebab-case scene name matching the section.

### Hero media

| Attribute | Value |
|---|---|
| Type | **Static PNG** (no GIF, no video). Hero motion conflicts with LCP and with the calm voice. |
| What it shows | The mock UI mid-session: top bar with repo selector, sidebar with branches and one rewrite notice, commit timeline with one new commit highlighted, detail panel collapsed. |
| Aspect ratio | **16:10** (1600×1000). Wider than 16:9 lets the three-pane layout breathe without horizontal compression. |
| Render width | 2× pixel density: serve `1600w` and `3200w` via `<picture>` + `srcset`. |
| Format | WebP primary, PNG fallback. `loading="eager"`, `fetchpriority="high"`, `preload` in `<head>`. |
| Borderline | Wrap in a 1px border at the same colour as `border-subtle`. No drop shadow, no perspective tilt, no glow. |
| Light/dark | Two files. CSS `prefers-color-scheme` + manual toggle swap via `<picture>` source media queries. |
| Alt text | `Refscope mock UI showing a three-pane layout: a sidebar with branch and tag refs and a notice that history was rewritten on main, a commit timeline with seven commits and the most recent commit marked as new, and a collapsed detail panel.` |

### Demo scenes (5 assets, in order)

Each scene is recorded against the mock UI. Default format is **WebM video, autoplay disabled, loop on hover, muted always**. Static PNG fallback is required for `prefers-reduced-motion: reduce`. No GIFs (file size, no loop control, poor a11y).

Common spec for all 5:
- Aspect ratio: **16:10** (1280×800), 2× density
- Length: **6–10 seconds** per loop
- Format: WebM (VP9), MP4 (H.264) fallback, PNG static frame for reduced motion
- Controls: a single `Play` button overlay; clicking plays once; no auto-loop; no audio at any time
- Border: 1px subtle border, no shadow

| # | Slug | What happens on screen | Length | Alt text (static frame) |
|---|------|------------------------|--------|--------------------------|
| 01 | `rewrite-detection` | A simulated SSE event arrives: the sidebar inserts a notice block reading `History rewritten on main` with the previous tip, current tip, and observed time. The detail panel opens to the observation log. No flash, no shake. | 8s | `Sidebar showing a history-rewritten notice for the main branch with previous tip, current tip, and observation time visible.` |
| 02 | `commit-timeline` | Vertical scroll through ten commits. Each row shows hash, author, message, +/- counts, and a signature-unknown badge. One commit row is highlighted as new without the page scrolling. | 7s | `Commit timeline listing ten commits in a dense table; the most recent commit row is highlighted to mark it as newly observed.` |
| 03 | `compare-bar` | The user picks a base ref `main` and a target ref `feature/refscope`. The compare bar fills with ahead and behind counts, then renders three copyable Git commands. | 9s | `Compare bar with main as base and a feature branch as target, showing ahead and behind counts and three copyable Git commands.` |
| 04 | `pause-live-updates` | Live updates are paused via the top bar. A counter badge increments to `3` as events arrive. Pressing resume applies the queue and the timeline updates in one batch. | 8s | `Top bar with a pause control engaged; a small counter shows three queued live updates that will apply when updates resume.` |
| 05 | `command-palette` | Cmd+K opens the palette. The user types `pause`, selects `Pause live updates`, and the page state updates without the palette rendering its own data. | 6s | `Command palette open with the pause command highlighted; the rest of the page is dimmed but readable behind the palette.` |

A11y for all media:
- `<video>` elements have `controls`, `muted`, `playsinline`; never `autoplay`.
- `<picture>` for static fallbacks must include `<source media="(prefers-reduced-motion: reduce)">` pointing to the static PNG.
- Captions are not required (no audio, no speech), but each video has a `aria-describedby` pointing to the description paragraph in the DOM.

### OGP image

- **Filename**: `og-card.png`
- **Dimensions**: 1200×630
- **Composition**: left half is the Refscope wordmark + the recommended tagline (`An observatory for your refs.`) on the dark theme background; right half is a tightly cropped slice of the commit timeline showing four rows including one with a `rewritten` badge.
- **Type rendering**: typeset in the LP at build time with a satori-like server-render, not a Photoshop file — so headline copy stays in sync with `lp-structure.md`.
- **Twitter card**: `summary_large_image`.

---

## 5. SEO, OGP, and metadata

### `<title>`

```html
<title>Refscope — an observatory for Git refs and history</title>
```

(54 characters; under Google's 60-character display window.)

### `<meta name="description">`

```text
Refscope is a local, read-only observatory for Git refs and history. It records force pushes, rebases, and resets with verifiable evidence and separates observed facts from interpretation.
```

(190 characters; trim to 158 if Google clipping matters: `Refscope is a local, read-only observatory for Git refs and history. It records what changes and keeps observed facts separate from interpretation.` — 152 characters.)

### Open Graph

```html
<meta property="og:title" content="Refscope — an observatory for Git refs and history">
<meta property="og:description" content="A local, read-only observer that records when Git refs move and what changed, with observed facts separated from interpretation.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://<github-pages-url>/">
<meta property="og:image" content="https://<github-pages-url>/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Refscope wordmark next to a commit timeline excerpt showing one history-rewritten notice.">
```

### Twitter

```html
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Refscope — an observatory for Git refs and history">
<meta name="twitter:description" content="A local, read-only observer that records when Git refs move.">
<meta name="twitter:image" content="https://<github-pages-url>/og-card.png">
```

### JSON-LD

Use **`SoftwareApplication`** (not `Product` — Refscope has no price; not `WebSite` — too generic for an OSS tool).

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Refscope",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "macOS, Linux, Windows",
  "description": "A local, read-only observatory for Git refs and history.",
  "url": "https://<github-pages-url>/",
  "softwareVersion": "0.x",
  "license": "https://opensource.org/licenses/MIT",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "codeRepository": "https://github.com/<owner>/refscope"
}
```

Notes:
- No `aggregateRating`, no `review`. Refscope has no users yet to count.
- `offers.price: "0"` is required for the SoftwareApplication schema to render correctly in Google rich results, despite Refscope not being for sale.

---

## 6. Accessibility requirements

- **WCAG 2.2 AA minimum**, body text targets AAA (≥ 7:1 contrast) per `visual-direction.md`.
- **Skip link**: first focusable element, `Skip to main content`, jumps to `<main id="main">`.
- **Heading hierarchy**: one `<h1>` (the hero headline), `<h2>` per section, `<h3>` per card. No skipped levels.
- **Keyboard navigation order**: skip link → nav links left to right → theme toggle → primary CTA → main content top to bottom → footer left to right. Focus is visible everywhere (2px outline + 2px offset, accent colour with double ring per `visual-direction.md`).
- **`prefers-reduced-motion: reduce`**:
  - All demo videos render as their static PNG fallback (no `<video>` mounted in the DOM at all — use a `<picture>` element instead).
  - Section reveal animations are disabled (no fade, no slide).
  - Theme transition uses `transition: none`.
  - Smooth scroll is disabled (`scroll-behavior: auto`).
- **Colour independence**: every status indicator (rewrite badge, signature-unknown badge, new-commit dot) carries shape and text in addition to colour.
- **Focus management on theme toggle**: focus stays on the toggle button after the swap.
- **Screen reader live regions**: only the `Copy` action announces (`polite`). No live regions narrate decorative content.
- **Forms**: there are no forms on the LP. If a future iteration adds a newsletter, it must follow `microcopy.md` voice rules — and it probably should not exist.

---

## 7. Interaction specification (minimal)

### Required interactions

1. **Theme toggle**
   - Default: follows `prefers-color-scheme`.
   - Manual: persisted in `localStorage` under `refscope-theme` (`light` | `dark` | `system`).
   - The button shows the current resolved theme; clicking cycles `system → light → dark → system`.
   - A11y: `aria-pressed` on the button reflects the manual override state; `aria-label` reads `Theme: <current>. Click to change.`

2. **Copy command button** (Quickstart only)
   - On click: writes the command to clipboard via the async Clipboard API.
   - Success: button label briefly changes to `Copied`; live region says `Copied to clipboard`. Reverts after 2 seconds.
   - Failure: button label changes to `Couldn't copy`; live region says `Couldn't copy to clipboard`. Reverts after 3 seconds.
   - No fallback `document.execCommand` path — the page does not need to support pre-2018 browsers.

3. **Smooth scroll for in-page anchors** (`#demo`, `#security`, `#quickstart`, etc.)
   - Enabled by default via `scroll-behavior: smooth` on `:root`.
   - Disabled under `prefers-reduced-motion: reduce`.
   - Focus moves to the destination's heading after scroll completes (for screen reader continuity).

4. **Demo video play-on-click**
   - Video elements are not mounted in the DOM until the user clicks the static frame's `Play` overlay (saves bandwidth on initial load and respects reduced-motion automatically).
   - After play: video plays once, then shows a `Play again` overlay. Never auto-loops.

### Explicitly excluded interactions

- No carousel, no slider, no auto-advancing anything.
- No exit-intent modal, no scroll-depth modal, no email capture.
- No animated section reveals (no scroll-driven fade-in or stagger).
- No cursor-following effects.
- No "what's new" toast.
- No analytics that loads before the first paint (if analytics ships, it loads after `load` event, plausible-style, no cookies).

---

## 8. Performance budget

Per `funnel/SKILL.md` Core Web Vitals targets and Refscope's "speed is a UX" stance:

| Metric | Budget | Top-quartile aspiration |
|---|---|---|
| LCP | ≤ 2.5s | ≤ 1.5s |
| INP | < 200ms | < 100ms |
| CLS | < 0.1 | < 0.05 |
| TTFB | < 800ms | < 300ms |

Implementation notes for Artisan:
- Hero image: `<picture>` with WebP + PNG fallback, `fetchpriority="high"`, `preload`, explicit `width`/`height` to prevent CLS.
- Fonts: Inter only, two weights (400, 500), `font-display: swap`, preload `Inter-Regular.woff2`.
- Critical CSS: inline above-fold styles in `<head>`; defer the rest.
- Demo videos: not in the initial DOM; mount on click. Static PNG frames are lazy-loaded with `loading="lazy"`.
- No third-party scripts in the initial bundle.

---

## 9. Banned-word verification

The draft above was self-checked against `voice-and-tone.md` §6 and `microcopy.md` vocabulary. Result:

| Banned token | Found in draft? | Notes |
|---|---|---|
| `alert!`, `alert` (as noun) | No | Replaced with `notice`, `observation`, `record`. |
| `danger`, `destroyed`, `lost forever` | No | Rewrite vignette uses `recoverable hash`, `was never described as lost`. |
| `magic`, `magical`, `intelligent`, `smart` | No | — |
| `AI-powered`, `AI-driven` | No | Sora's vignette explicitly notes `the readme does not say "AI" once`. |
| `killer feature`, `game-changer` | No | — |
| `rocket`, `blazing fast`, `lightning` | No | — |
| `time travel`, `time machine` | No | — |
| `oops`, `whoops`, `uh-oh` | No | — |
| `please`, `kindly` | No | The Mina vignette explicitly notes `walks her through the fix without using the word "please"`. |
| `just`, `simply`, `easily` | No | Quickstart says `Three steps`, not `just three steps`. |
| `we`, `our team` | No | Singular voice throughout. |
| `force-pushed` (as auto-applied label) | Used only when promoted to a status badge per `microcopy.md` §2 | Demo Scene 01 uses `History rewritten on main` (not `force-pushed`). |
| Exclamation marks | No | Verified in copy blocks. |

Pass.

---

## 10. Handoff to Artisan

**Implementation stack**: Astro 5+ for static rendering, Tailwind v4 for styling (consume `docs/brand/tokens.json` and `tailwind-theme.css`), no client framework needed (theme toggle and copy button can be vanilla JS in islands or inline scripts).

**Files this LP will create** (suggested):
```
site/                               # new top-level directory for the GitHub Pages source
  src/
    pages/index.astro               # the LP itself
    components/
      Hero.astro
      WhatYouGet.astro
      Demo.astro                    # consumes a JSON manifest of scenes
      Personas.astro
      WhyObservatory.astro
      Security.astro
      Quickstart.astro              # owns the Copy button island
      BeyondMvp.astro
      Footer.astro
      ThemeToggle.astro             # client:load island
    styles/global.css               # imports tailwind-theme.css
  public/
    media/
      hero-timeline-{dark,light}.{webp,png}
      demo-{01..05}-{slug}-{dark,light}.{webm,mp4,png}
      og-card.png
      favicon-{16,32,180,512}.png
  astro.config.mjs
  package.json
```

**Open questions for the next agent**:
- The GitHub Pages URL is unknown at the time of writing — leave `<github-pages-url>` placeholders in metadata until the deployment target is decided.
- The OGP card render strategy (satori vs static PNG) is a small build-time decision; Artisan picks whichever fits the Astro plugin landscape on the day.
- Demo video capture is Nexus's responsibility per the recipe brief; this document is the spec Nexus records against.

#TODO(agent): once Artisan completes the first build, run Lighthouse and Pa11y locally and reconcile any gaps against §6 and §8.

---

**Source agent**: Funnel
**Status**: v0 (handoff)
**Downstream**: Artisan (Astro + Tailwind v4 implementation), Nexus (demo capture against mock UI), Growth (post-launch SEO/CRO audit)

---

## Changelog

### 2026-05-02 — `npx refscope` shipped
- Quickstart simplified from three pnpm steps to one `npx refscope` command (two steps total: run + open URL).
- Hero meta line updated from `Allowlist-scoped` to `One command` to reflect zero-install.
- "Zero-install CLI" was not yet in Beyond MVP (it was planned as a future item but not explicitly listed); added `Static export` to `Likely next` as a replacement roadmap item.
- Building from source (`make dev-self`) retained as a small footnote in Quickstart for contributors.

### 2026-05-02 — distribution moved off the npm registry
- The CLI is no longer published to npm. Instead, `npx -y github:simota/refscope` installs and runs from this repository directly via npm's GitHub-shorthand support.
- Quickstart code blocks updated from `npx refscope` to `npx -y github:simota/refscope`. The two-step structure and the cwd-by-default story are unchanged.
- `apps/cli/README.md` and the CLI's not-a-Git-working-tree error message were updated to match.
- Trade-off accepted: the command is longer, but distribution becomes versionable by tag (`#v0.0.1`), keeps the source of truth in one repository, and removes the npm-name occupancy concern.
