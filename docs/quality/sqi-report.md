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

## 4. After — commit `511fd1b` (same rubric, weights and conditions)

### 4.1 Score comparison

| Index | Before | After | Δ (points) | Verdict | Coverage | Evidence (after) |
|---|---:|---:|---:|---|---:|---|
| DQI: design | 57 | 66 | +9 | Improved | 100% | E2: D3, D6. E1: D1, D2, D4, D5, D7 |
| AQI: architecture | 68 | 76 | +8 | Improved | 100% | E2: A1, A4, A5, A6. E1: the rest |
| VQI: visual | 50 | 69 | +19 | Improved | 100% | E2: V1–V6. E1: V7 |
| UXQI: UI/UX | 62 | 72 | +10 | Improved | 100% | E2: U1, U6, U7. E1: U2–U5 |
| **SQI** | **59.25** | **70.75** | **+11.5** | **Improved** | 100% | |

No item scored lower than its baseline. No item was left unverified (E0), so
every coverage figure is 100%. Several items are still E1 (expert reading),
and those remain provisional.

### 4.2 Item-level comparison

Weighted Δ = W × (after − before) ÷ 5.

**DQI**

| Item | W | Before | After | Weighted Δ | Evidence for the change |
|---|---:|---:|---:|---:|---|
| D1 Separation | 20 | 3 | 3 | 0 | Tokens moved out of `App.tsx` (3 029 → 2 632 LOC), but `gitService.js` (5 225 LOC) still mixes ≥5 concerns, so the 3 anchor still applies. |
| D2 Cohesion | 15 | 3 | 3 | 0 | Removed: the duplicate `isGitWorkingTreeRoot`, 5 ad-hoc object-id regexes (M6 5 → 0) and the double `refFlightEvents` limit parse. Still present: symbolHistory is validated in both layers, and the `read*Query` near-duplicates remain. |
| D3 Contracts | 15 | 2 | 4 | +6 | Strict `tsc` gate over the UI with 0 errors (none was possible before). The fleet↔gitService contract is fixed and guarded by a production-wiring test. Token references are guarded by `uiTokens.test.js`. |
| D4 Changeability | 15 | 3 | 3 | 0 | The silent-failure classes (token typos, UI type errors, fleet wiring) are now guarded, but typical changes still touch 3–4 files. |
| D5 Readability | 10 | 3 | 3 | 0 | Two files are still over 2.5k LOC. |
| D6 Testability | 15 | 3 | 4 | +3 | The UI has its first automated tests (8 on pure helpers). API tests no longer write to the real `~/.config`; a regression test proves it. Component and DOM logic is still untested, so this is not a 5. |
| D7 Invariants / errors | 10 | 3 | 3 | 0 | Unexpected 500s and fleet fallbacks are now logged. Uncommented fs-probe swallows in `gitService.js` remain, so the 4 anchor is not met. |

**AQI**

| Item | W | Before | After | Weighted Δ | Evidence |
|---|---:|---:|---:|---:|---|
| A1 Boundaries | 20 | 4 | 4 | 0 | 0 cycles. `child_process` is only imported by the runner. |
| A2 Layering / data flow | 15 | 4 | 4 | 0 | The token layer is now CSS (decoupled from the React tree). Otherwise unchanged. |
| A3 Locality | 15 | 3 | 3 | 0 | The god modules were not decomposed (out of scope; risk). |
| A4 Contracts / integrity | 15 | 2 | 4 | +6 | Fleet endpoint: every repo returned `git_error` before; it now returns `ok` with real data, verified end to end and by test. Repo-store reads and writes now target the same file, by test. |
| A5 Fault tolerance | 10 | 4 | 4 | 0 | Unchanged. |
| A6 Security boundary | 10 | 5 | 5 | 0 | Unchanged and not weakened. The control-character pattern is semantically identical (validation tests pass). |
| A7 Observability | 10 | 2 | 3 | +2 | `console.error` for unexpected API errors and for fleet probe failures. |
| A8 Scalability | 5 | 3 | 3 | 0 | Unchanged. |

**VQI**

| Item | W | Before | After | Weighted Δ | Evidence |
|---|---:|---:|---:|---:|---|
| V1 Hierarchy | 20 | 3 | 4 | +4 | Drift quadrant labels and the Hotspot legend are visible again (`screenshots/drift-*`, `hotspot-legend-*`). |
| V2 Consistency | 20 | 2 | 4 | +8 | Undefined token uses 106 → 0, guarded by a test. Primitives follow the product palette (`screenshots/context-menu-*`: white → dark menu). |
| V3 Typography | 15 | 2 | 2 | 0 | 163 sizes below 11px remain (not changed: a broad visual change that needs design sign-off). |
| V4 Layout / responsive | 15 | 2 | 3 | +3 | 390px page overflow 382px → 0; panes stack below 768px (`screenshots/mobile-*`). Desktop top bar is pixel-identical at 1440 and 1024px. |
| V5 Interaction states | 10 | 3 | 4 | +2 | Focusables without an indicator: 12 → 0 (dev), 22 → 0 (prod build). |
| V6 Colour / contrast | 10 | 3 | 4 | +2 | axe color-contrast nodes: 27 → 0 (dev), 30 → 0 (prod). |
| V7 Spacing / density | 10 | 3 | 3 | 0 | Unchanged. |

**UXQI**

| Item | W | Before | After | Weighted Δ | Evidence |
|---|---:|---:|---:|---:|---|
| U1 Task completion | 25 | 3 | 4 | +5 | Keyboard-only pass (`keyboard-pass.cjs`): 3/6 steps on the pre-change build → 6/6. Fleet overview (a primary multi-repo task) shows real data instead of errors. |
| U2 Discoverability | 15 | 3 | 3 | 0 | Mixed Japanese/English labels unchanged (product-copy decision). |
| U3 Predictability | 15 | 4 | 4 | 0 | The "hide sidebar" preference now survives reload (it silently reverted before), and the working-tree row uses the same semantics as commit rows. Already at 4. |
| U4 Feedback | 10 | 3 | 4 | +2 | `role=status/alert` added to 15 loading/error/empty blocks from the audit list. Not screen-reader verified (that would be a 5). |
| U5 Error prevention / recovery | 10 | 3 | 3 | 0 | Unchanged. |
| U6 Accessibility | 15 | 2 | 3 | +3 | axe 382 → 4 (dev) and 376 → 4 (prod). The remaining 4 are recharts' own unnamed `role=img` scatter layers in Drift (third-party), so the 4 anchor (0 nodes) is not met. |
| U7 Perceived performance | 10 | 4 | 4 | 0 | Unchanged within noise (see §4.3). |

### 4.3 Objective measurements (before → after)

All UI numbers come from `ui-audit.cjs` on the same data. "prod" rows serve
the pre-change build from a `git worktree` at `cec5c37` (port 4181) and the
new build (port 4180) through the CLI static server, side by side.

| Area | Metric | Before | After |
|---|---|---:|---:|
| Design | Undefined `--rs-*` token uses | 106 | 0 |
| Design | Ad-hoc object-id regexes outside `validation.js` | 5 | 0 |
| Design | Duplicated `isGitWorkingTreeRoot` | 2 copies | 1 |
| Design | UI strict type errors (React 18 types) | not checkable (21 when probed) | 0, gated |
| Design | Automated tests | 549 (API 542, CLI 7, UI 0) | 560 (API 545, CLI 7, UI 8) |
| Architecture | API import cycles / `child_process` outside runner | 0 / 0 | 0 / 0 |
| Architecture | Fleet snapshot repos reported `ok` (this repo) | 0 / 1 | 1 / 1 |
| Architecture | Tests writing to the real `~/.config` | yes | no (regression test) |
| Architecture | UI runtime dependencies (unused) | 13 unused | 0 unused; 76 lockfile packages removed |
| Architecture | `pnpm audit` high / critical | 28 / 2 | 26 / 2 (remainder pre-existing, build-time tooling: astro, tailwind, vite) |
| Visual | axe color-contrast nodes (dev / prod) | 27 / 30 | 0 / 0 |
| Visual | Focusables without a focus indicator (dev / prod) | 12 / 22 | 0 / 0 |
| Visual | Horizontal page overflow at 390px | 382 px | 0 px |
| Visual | Font sizes below 11px | 163 | 163 |
| UX | axe WCAG 2.x A/AA nodes, 14 views (dev / prod) | 382 / 376 | 4 / 4 |
| UX | Keyboard-only pass (T6), prod builds | 3 / 6 | 6 / 6 |
| UX | Hidden-sidebar preference after reload | lost | kept |
| Perf | Time to commit list, prod, median of 7 (two rounds) | 1.12 s / 1.15 s | 1.07 s / 1.10 s (within noise) |
| Perf | API p50 `/commits?limit=50` (two rounds, 40 req) | 430.0 / 423.9 ms | 431.3 / 430.6 ms (within noise) |
| Perf | API p50 `/refs` | 6.0 / 6.7 ms | 6.3 / 7.1 ms (within noise) |
| Perf | Initial JS / CSS (gzip) | 253.8 / 15.0 kB | 250.5 / 16.8 kB (tokens moved from JS to CSS; total −1.5 kB) |

Measurement noise:
- The prod timing medians overlap across rounds (before: 1.12–1.15 s, after: 1.07–1.10 s). This is reported as "no regression", not as a speed-up.
- The API p50 differences are below 2% and change sign between rounds.

### 4.4 Changed files

| File(s) | Change | Purpose / indices | Compatibility |
|---|---|---|---|
| `apps/api/src/gitService.js` | Expose the 3 fleet probes on the service object. Reuse `isValidObjectId` (5×). | Functional fix. A4, D3, D2 | Additive. The fleet API contract is now honoured. |
| `apps/api/src/config.js` | Persist add/remove through the env `loadConfig` read. Share `isGitWorkingTreeRoot`. | Integrity, test isolation. A4, D6 | Production uses `process.env`, so behaviour is identical. |
| `apps/api/src/fleetService.js`, `http.js` | Log unexpected errors. Drop the duplicate limit parse (same 400 response). | A7, D7, D2 | Response bodies unchanged. |
| `apps/api/src/validation.js` | `\u` escapes instead of raw control bytes in the regex. | D5 (tooling saw the file as binary) | Same character class; validation tests pass. |
| `apps/api/src/gitRunner.js` | Export `isGitWorkingTreeRoot`. | D2 | Additive. |
| `apps/api/test/fleet-snapshot.test.js`, `reposStore.test.js`, `uiTokens.test.js` | Three regression tests. | D3, D6, V2 | Each fails on the pre-fix code. |
| `apps/ui/src/styles/refscope.css` (new), `index.css`, `App.tsx` | Token stylesheet moved out of `App.tsx`. shadcn tokens mapped. Muted text 62% → 65%. Compare-select focus ring. | V2, V6, D1 | Visual: primitives turn dark (intended). |
| 20 component files in `components/refscope/` | Undefined tokens fixed. Inline `outline:none` removed. Labels, roles and keyboard handlers. Badge fills. 24px targets. | V1, V5, V6, U4, U6 | No API or behaviour change other than the a11y fixes. |
| `CommandPalette.tsx`, `ShortcutHelp.tsx` | Dialog name, combobox semantics, focus move and restore. | U6 | Same commands and shortcuts. |
| `App.tsx`, `use-mobile.ts`, `LensSwitcher.tsx`, `TopBar.tsx` | Sidebar-preference fix. Stacked panes below 768px. Scrollable tab strip and top bar. | U3, V4 | Desktop top bar pixel-identical. Saved desktop ratios untouched by narrow layouts. |
| `apps/ui/tsconfig.json`, `package.json`, `pnpm-lock.yaml`, `Makefile`, `verify.sh`, root `package.json` | Strict type check. UI test script. 13 unused dependencies removed. | D3, D6, A6 | Production `dist/` byte-identical after the dependency removal. |
| `apps/ui/test/lib.test.ts` (new) | 8 unit tests on pure helpers. | D6 | — |
| `apps/cli/src/bundled-api/*`, `apps/cli/src/static/*` | Regenerated bundle. | Ships the fixes via `npx` | `bundled-api` identical to `apps/api/src`. |
| `CLAUDE.md` | Document the test, typecheck and token entry points. | Maintainability | — |
| `scripts/quality/*`, `docs/quality/*` | Measurement scripts, this report, and the screenshots. | Reproducibility | — |

### 4.5 Quality assurance

| Check | Result |
|---|---|
| `pnpm test` | API 545/545, CLI 7/7, UI 8/8 pass (0 failures) |
| `pnpm typecheck` (new) | 0 errors (strict) |
| `pnpm build` (api `node --check`, ui `vite build`, web `astro build`) | Pass |
| `pnpm audit --audit-level high` | Fails, as it did before. No new advisories; 2 high removed. |
| `scripts/ci/forbid-derived-words.sh` | Pass |
| axe-core 4.10.2, 14 views | 4 nodes, all third-party (recharts in Drift) |
| Keyboard-only pass | 6/6 |
| Lint | No linter is configured in the repository, so lint was not run (not "passed"). |

## 5. Residual risks and unverified items

- **No real-user or screen-reader testing.**
  - U1–U6 are scripted or expert assessments.
  - Live-region announcements (U4) were checked in the DOM only, not with NVDA or VoiceOver.
- **Not changed, by choice:**
  - 163 font sizes below 11px (V3). Raising them is a product-wide density decision.
  - Mixed Japanese/English UI copy (U2).
  - Decomposing `gitService.js` and `App.tsx` (D1, A3). This is high-risk with no behaviour gain.
- **Known remaining defects:**
  - Recharts adds an unnamed `role=img` to each Drift scatter point (4 axe nodes).
  - The hand-built palette and help dialogs move and restore focus, but do not trap Tab.
  - The Stream author avatar initial (aria-hidden, 8px) uses arbitrary HSL colours with white text.
  - In Chromium, the first Tab on load lands on a commit row rather than the skip link. This also happens on the pre-change build, and the link is reachable with Shift+Tab.
- **Dependency advisories:** `pnpm audit` still reports 26 high and 2 critical, all pre-existing. They sit in build-time tooling (astro, tailwind/oxide `tar`, vite/postcss) and need upgrades that were out of scope.
- **Mobile:** the stacked layout removes page overflow and keeps every control reachable, but it is not a purpose-built small-screen design (V4 stays at 3).
- **E1 items** (D1, D2, D4, D5, D7, A2, A3, A7, A8, V7, U2–U5) are expert judgements and could differ by ±1 under another assessor.

### Reproducing

```bash
make dev-self                                    # API :4175 + UI :5173
node scripts/quality/static-metrics.mjs
AXE_PATH=<axe-core>/axe.min.js OUT_DIR=/tmp/out node scripts/quality/ui-audit.cjs after
node scripts/quality/keyboard-pass.cjs http://127.0.0.1:5173/
# pre-change build for side-by-side runs:
git worktree add /tmp/base cec5c37
node /tmp/base/apps/cli/bin/refscope.mjs --repo . --port 4181 --no-open
```
