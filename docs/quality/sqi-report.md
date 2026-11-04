# SQI — Software Quality Improvement Index report

This report scores Refscope's design, architecture, visual design and UI/UX
on a fixed rubric **before** and **after** an improvement pass. The rubric,
weights, measurement procedures and target screens below were fixed before
any product code was changed. They were not edited afterwards.

> SQI is a rubric-based expert assessment. It is **not** a physical
> measurement. Measured values (test counts, axe-core nodes, pixel overflow,
> timings) are reported separately in §4 and are the more objective evidence.
> No real-user testing was performed. Every UX score is an expert/scripted
> assessment (E1/E2), never a user-study result.

## 1. Scope and fixed conditions

| Item | Fixed value |
|---|---|
| Surfaces in scope | `apps/api` (DQI, AQI); `apps/ui` (DQI, AQI, VQI, UXQI). `apps/web` (static landing page) and `apps/cli` (packaging copy of api+ui) are out of scope for scoring, but they are rebuilt and regression-tested. |
| Weights | SQI = 0.25·DQI + 0.25·AQI + 0.25·VQI + 0.25·UXQI. All four domains apply (the UI exists). |
| Dataset | This repository (`RTGV_REPOS=viewer=<repo root>`), `make dev-self` equivalent. |
| Viewports | Desktop 1440×900; mobile 390×844. Chromium (Playwright), `colorScheme: dark`, `locale: en-US`. The product ships a single dark theme. |
| Screens | Live (default), Stream, Hotspot, Risk Trend, Risk Heatmap, Co-change, Drift, Outbox, Digest, Rescue, Symbol, Command palette (Ctrl+K), Shortcut help (?). |
| Representative tasks | T1 open the app and see the commit list for HEAD. T2 select a commit and read its diff. T3 filter commits by text. T4 compare two refs. T5 switch to an analysis lens. T6 do T1–T5 by keyboard only. |
| Tools | `node --test` (API + CLI), `vite build`, `tsc --noEmit` (UI, when present), `scripts/quality/static-metrics.mjs`, `scripts/quality/ui-audit.cjs` (axe-core 4.10.2 with WCAG 2.0/2.1/2.2 A+AA tags, a focus-indicator probe and a mobile overflow probe). |

### Evidence levels

E0 = unverified (not scored) · E1 = code/screen observation · E2 = reproducible
static analysis, automated test or scripted check · E3 = measurement under
real conditions or independent corroboration.

### Common 0–5 scale

0 fatal / requirement essentially unmet · 1 several serious defects ·
2 basic structure exists, problems recur · 3 meets basic needs, practically
fine · 4 consistently high quality · 5 exceptional, edge cases covered and
proven by E2+ evidence. A 5 requires E2+ evidence. Domain score =
Σ(weight × score ÷ 5).

## 2. Rubric (fixed before changes)

Each item lists what is required for 2 / 3 / 4 / 5. A score of 1 means the
item falls below the "2" anchor in several places, and 0 means it is absent.

### DQI — design quality

| Item | W | 2 | 3 | 4 | 5 |
|---|---:|---|---|---|---|
| D1 Separation of responsibilities | 20 | Boundaries are routinely ignored | Module-level boundaries exist and are respected, but ≥1 module combines ≥5 unrelated concerns | No module has more than ~3 concerns, and presentation, style and data are separated | As 4, and enforced by a test or lint rule |
| D2 Cohesion | 15 | Helpers are scattered or duplicated widely | Core modules are cohesive, with some duplicated helpers or validation split across layers | No duplicated helpers, and each public input is validated in exactly one place | As 4, proven by a check |
| D3 Interface / contract clarity | 15 | Contracts exist but are not mechanically enforced, **and** at least one cross-module contract violation exists | Contracts are documented, with no known violation, but enforcement is partial | Contracts are mechanically enforced (type check or contract test) on the main boundaries, with no known violation | Every boundary is enforced, including the API↔UI wire contract |
| D4 Changeability | 15 | Typical changes touch many unrelated files | Typical changes touch 3–4 files, but some changes fail silently (no guard) | Typical changes are local, and mistakes are caught by a guard (test or type) | Every scenario is local and guarded |
| D5 Readability | 10 | Naming or structure obscures intent | Clear naming and comments, but very large files (>3k LOC) hinder navigation | No file exceeds ~1.5k LOC without an internal structure | Exemplary |
| D6 Testability | 15 | Few tests, or a hard-to-isolate design | One runtime is well tested, but another has **no** automated tests, or tests leak into the host environment | Both runtimes have automated tests for their logic, and tests are hermetic | As 4, plus coverage of failure paths on both sides |
| D7 Invariants / error handling | 10 | Errors are swallowed broadly | Inputs are validated, but unexpected errors are swallowed or turned into 500s without any log | Unexpected errors are always surfaced (log or response), and intentional swallows are commented | As 4, plus tests for the failure paths |

### AQI — architecture quality

| Item | W | 2 | 3 | 4 | 5 |
|---|---:|---|---|---|---|
| A1 Module boundaries / dependency direction | 20 | Cycles, or boundary bypasses | No cycles, but ≥1 boundary bypass | No cycles and no bypass (git only through the runner; network only through `api.ts`), with at most minor upward calls | As 4, enforced by a test |
| A2 Layering / data flow | 15 | State is duplicated across owners | Mostly one-way flow, with some parallel state | One state owner and one-way props/callbacks; style and runtime layers are decoupled | As 4, and documented |
| A3 Locality of change | 15 | Most features touch the god modules plus many others | Features are routed through 1–2 god modules (>3k LOC) | God modules have been decomposed by concern | Proven by low change fan-out over history |
| A4 Inter-system contracts / data integrity | 15 | A shipped endpoint or persistence path violates its own contract | No known violation, but contracts lack integration tests | Contracts are covered by integration tests that use the real wiring (no mocks at the seam that broke) | As 4, plus schema/contract tests on both client and server |
| A5 Fault tolerance / isolation | 10 | No timeouts or bounds | Timeouts and bounds on most paths | Timeouts, output bounds, per-repo isolation and SSE cleanup; failures are contained per request or repo | As 4, plus caps or backpressure on long-lived streams and fault-injection tests |
| A6 Security / privacy boundary | 10 | Bypassable | Boundary exists but is not adversarially tested | Central enforcement and tests | Central enforcement, adversarial tests, scrubbed environment and an allowlist (E2) |
| A7 Observability / operability | 10 | Failures are invisible: unexpected 500s and fallback paths leave no trace | Unexpected server errors are logged | Structured request/error logs and a meaningful health check | Metrics as well |
| A8 Scalability | 5 | Unbounded growth | Bounded caches, but per-client linear git load | Shared pollers per repo | Measured under load |

### VQI — visual quality

| Item | W | 2 | 3 | 4 | 5 |
|---|---:|---|---|---|---|
| V1 Hierarchy / priority | 20 | Key information is not distinguishable | Hierarchy is clear on the main view, but some elements are invisible or mis-emphasised | Clear hierarchy on every screen, with no invisible or misrendered elements | As 4, validated with users (E3) |
| V2 Component / style consistency | 20 | ≥1 class of style reference is broken (undefined tokens) **or** two competing token systems render inconsistently | One token system, with a few deviations | No broken references, primitives follow the product tokens, and this is guarded by a check | As 4, with no ad-hoc colours |
| V3 Typography / readability | 15 | >100 text styles below 11px | 20–100 below 11px | <20 below 11px | Type scale tokenised |
| V4 Layout / responsiveness | 15 | Breaks at the mobile viewport (horizontal page overflow) | No page-level overflow at 390px, though dense | Purpose-built small-screen layout | As 4, plus verified at 200% zoom |
| V5 Interaction-state visibility | 10 | Focus or selection is invisible on many controls | Focus is invisible on a few controls (1–15 HTML focusables in the probe) | Every HTML focusable shows focus in the probe, with hover/selected/disabled distinct | As 4, plus forced-colors verified |
| V6 Colour / contrast / meaning | 10 | >50 axe colour-contrast nodes | 1–50 nodes, and alternative palettes exist | 0 nodes on the audited screens | As 4, plus an independent contrast audit (E3) |
| V7 Spacing / density | 10 | Cluttered | Dense but consistent | Rhythm is tokenised | Exemplary |

### UXQI — UI/UX quality

| Item | W | 2 | 3 | 4 | 5 |
|---|---:|---|---|---|---|
| U1 Task completion / efficiency | 25 | A primary task is not completable | T1–T5 completable on desktop, but T6 or some step is blocked | T1–T6 completable on desktop in ≤3 actions each (scripted) | As 4, plus a real-user success rate (E3) |
| U2 Discoverability / cognitive load | 15 | Main actions are hidden | Palette and help exist; mixed-language labels and jargon add load | Consistent labels | User-validated |
| U3 Predictability / consistency | 15 | Surprising navigation | Mostly consistent | Consistent, with destructive actions distinguished | Validated |
| U4 Feedback | 10 | No loading/error feedback | Visual feedback present, but ≥5 loading/error states not announced to AT | Every loading/error state is announced (role=status/alert) | As 4, verified with a screen reader (E3) |
| U5 Error prevention / recovery | 10 | Errors are dead ends | Validation and retry exist on main paths | Retry or recovery everywhere | Undo where meaningful |
| U6 Accessibility | 15 | Several blocking issues: unlabeled inputs, invisible focus, keyboard-inoperable controls, unnamed dialogs, axe serious/critical > 0 | Blocking keyboard issues fixed; axe residuals only from third-party markup | axe clean (0 nodes) on the audited screens, plus a manual keyboard pass | Screen-reader verified (E3) |
| U7 Perceived performance | 10 | >3 s to first content locally | 1.5–3 s | <1.5 s to the commit list and lazy-loaded heavy views | As 4, measured on low-end hardware |

## 3. Baseline (before) — commit `cec5c37`

### Measured baseline (§4 has the full table)

- Tests: API 542/542 and CLI 7/7 pass. `vite build` passes.
- UI type check: **none possible**. There is no `tsconfig`, no `typescript` and no `@types/react` in `apps/ui`. When probed with React 18 types under `strict`, there are 21 errors.
- Static metrics (`static-metrics.mjs`):
  - 106 uses of 5 undefined `--rs-*` tokens.
  - 13 inline `outline:none` declarations.
  - 163 font sizes below 11px.
  - 0 `child_process` imports outside the runner.
  - 0 API import cycles.
  - 5 ad-hoc object-id regexes.
- UI audit (`ui-audit.cjs`, desktop dark):
  - **382 axe nodes**: svg-img-alt 317, color-contrast 27, target-size 20, nested-interactive 7, listitem 5, aria-required-children 3, scrollable-region-focusable 2, aria-input-field-name 1.
  - **12** HTML focusables with no focus indicator.
  - Mobile 390px: `scrollWidth` 772 (**382px horizontal overflow**).
  - Time to commit list: 1.33 s (median of 3 runs: 1.27 / 1.33 / 1.41 s).
- Functional defects found by audit and confirmed by running the code:
  1. `GET /api/fleet/snapshot` returns `status:"git_error"` for **every** repo in production. `fleetService` calls `getHeadShortSha`, `getCommits24hCount` and `getWorktreeDirtyBoolean` on the `createGitService()` object, which does not expose them. Unit tests injected mocks at exactly this seam, so the defect went unnoticed.
  2. `loadConfig(env)` reads the persisted repo store from `env`, but `addRepository` / `removeRepository` write through `process.env`. Running `pnpm test` wrote a temp repo into the real `~/.config/refscope/repos.json`.
  3. The undefined `--rs-text` makes SVG `fill` fall back to black. On the dark canvas this makes the Drift quadrant labels and the Hotspot "recent" legend dot invisible (seen in the screenshot).

### Baseline scores

| Domain | Item scores (W) | Score | Coverage |
|---|---|---:|---:|
| DQI | D1 3 (20) · D2 3 (15) · D3 2 (15) · D4 3 (15) · D5 3 (10) · D6 3 (15) · D7 3 (10) | **57** | 100% |
| AQI | A1 4 (20) · A2 4 (15) · A3 3 (15) · A4 2 (15) · A5 4 (10) · A6 5 (10) · A7 2 (10) · A8 3 (5) | **68** | 100% |
| VQI | V1 3 (20) · V2 2 (20) · V3 2 (15) · V4 2 (15) · V5 3 (10) · V6 3 (10) · V7 3 (10) | **50** | 100% |
| UXQI | U1 3 (25) · U2 3 (15) · U3 4 (15) · U4 3 (10) · U5 3 (10) · U6 2 (15) · U7 4 (10) | **62** | 100% |
| **SQI** | | **59.25** | |

Baseline rationale, with evidence level in brackets:

- **D1 = 3** [E1/E2]
  - The API pipeline `config → gitService → http` is clean, and `gitRunner` is the sole Git boundary (M4 = 0).
  - `gitService.js` (5 219 LOC) mixes about 8 concerns.
  - `App.tsx` (3 029 LOC) mixes state, helpers and a ~420-line design-token stylesheet injected as a React `<style>` component.
- **D2 = 3** [E1]
  - `isGitWorkingTreeRoot` is duplicated in `config.js` and `gitRunner.js`.
  - The `refFlightEvents` limit is parsed in both `http.js` and `gitService.js`.
  - There are 5 ad-hoc 40-hex regexes instead of `isValidObjectId`.
- **D3 = 2** [E2] The UI's TypeScript is not checked by anything, and the fleet↔gitService contract is violated (defect 1).
- **D4 = 3** [E1] Adding a colour token means editing a template string in `App.tsx`. Mistyped token names fail silently (106 such uses exist).
- **D5 = 3** [E1] Naming and comments are strong, but there are two files over 3k LOC.
- **D6 = 3** [E2]
  - The API has 542 hermetic-looking tests, but they leak into `~/.config` (defect 2).
  - The UI has zero automated tests.
- **D7 = 3** [E1]
  - `handleError` returns 500 without logging.
  - fleetService's "unknown error" branch silently converts a `TypeError` into `git_error`, which is what hid defect 1.
- **A1 = 4** [E2] There are 0 cycles and 0 `child_process` bypasses. `fetch` is only in `api.ts`. `gitService → config` mutation is a minor upward call.
- **A2 = 4** [E1] `App.tsx` is the single state owner. Tokens are a React-rendered stylesheet, so the style layer depends on the component tree; this is minor.
- **A3 = 3** [E1] Most features route through the two god modules.
- **A4 = 2** [E2] Defect 1 is a shipped endpoint violating its contract. Defect 2 is a persistence path inconsistency.
- **A5 = 4** [E2] Timeouts, output bounds, a per-repo fleet deadline and SSE cleanup exist. There is no SSE client cap and no backpressure handling.
- **A6 = 5** [E2] There is an allowlist, a hardened runner with env scrubbing, dangerous-flag rejection and filter/fsmonitor neutralisation, and `gitService.hardening.test.js`.
- **A7 = 2** [E1] There is no error log for 500s or for fleet fallbacks, and `/health` is static.
- **A8 = 3** [E1] Caches are bounded. Each SSE client polls on its own.
- **V1 = 3** [E2] Hierarchy is good on the main view, but there are invisible SVG labels (defect 3).
- **V2 = 2** [E2]
  - There are 106 broken token references.
  - The shadcn primitives still carry the light-theme tokens (for example the Hotspot tab `muted-foreground` #717182 on #11161e, contrast 3.79).
- **V3 = 2** [E2] 163 font sizes are below 11px.
- **V4 = 2** [E2] There is 382px of page overflow at 390px, and the panes collapse to unusable widths.
- **V5 = 3** [E2] 12 focusables have no indicator.
- **V6 = 3** [E2] 27 colour-contrast nodes; the CVD-safe and quiet palettes exist.
- **V7 = 3** [E1] Dense but consistent spacing.
- **U1 = 3** [E2 scripted] T1–T5 work. T6 is partially blocked: the directory nodes in `ChangedFilesTree` and the heatmap cells cannot be operated by keyboard, and focus is invisible on 12 controls.
- **U2 = 3** [E1] The palette and `?` help exist. Labels mix Japanese and English across lenses.
- **U3 = 4** [E1] Behaviour is consistent.
- **U4 = 3** [E1] About 15 loading/error blocks have no `role=status/alert`.
- **U5 = 3** [E1] Validation and retry exist on main paths.
- **U6 = 2** [E2]
  - Two unlabeled inputs (BranchSidebar prefix, command palette).
  - An unnamed palette dialog.
  - Invisible focus.
  - Keyboard-inoperable tree and heatmap controls.
  - axe reports 382 nodes.
- **U7 = 4** [E2] 1.33 s to the commit list, with heavy views lazy-loaded.

> Note: V1 and U1 were first drafted at 4. They were set to 3 before any
> product change, by applying the anchors as written: invisible elements cap
> V1 at 3, and a blocked T6 caps U1 at 3.

## 4. After

_Filled in after the improvement pass; see below._
