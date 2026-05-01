# Builder Journal

## 2026-05-02 — Hunk timeline (file history) feature

### Task scope
Magi-approved feature: per-file commit history view that stacks each commit's
literal diff hunks in time order. Entry point: a "History" icon button on each
changed-file row in DetailPanel.

### Domain decisions

- **Observed vs derived boundary** (load-bearing for refscope's identity):
  - The API ships the **raw `git log --patch --follow` text** as `entry.patch`.
    The UI feeds it into the existing `parseUnifiedDiff` AST builder — same
    code path as the per-commit DiffViewer. No second AST representation, no
    server-side rename re-judgment.
  - Git's literal `R<NN>` similarity marker stays inside the patch string and
    is surfaced in the UI as "Git reported rename — similarity NN%". We never
    invent or recompute that number.
  - Truncation is an explicit boundary: read `limit + 1`, slice to `limit`,
    set `truncated: true`. UI surfaces "Showing first N commits" badge.

- **Hard caps**:
  - `FILE_HISTORY_DEFAULT_LIMIT = 20`, `FILE_HISTORY_MAX_LIMIT = 50`.
  - `parseLimitQuery` clamps over-cap input to `max` (no error). Matches the
    existing `listCommits` behavior.

- **Path is required**: Empty path → 400 "Missing path parameter". An empty
  pathspec would degrade to a full commit log — the wrong contract for "file
  history". Surfaced explicitly rather than silently degraded.

### gitRunner contract preserved

- Allowlist unchanged. `log` was already permitted; `--follow` is not on the
  dangerous-flag rejection list (verified in `gitRunner.js`).
- `formatLiteralPathspec(value)` reused → `:(literal,top)<path>` so renamed-to
  paths are matched literally, not as glob.
- `--end-of-options` between flags and `<revision>`; `--` between revision
  and pathspec. Same hardening surface as `commitSummaryLogArgs`.
- All `--no-show-signature`, `--no-ext-diff`, `--no-textconv`, `--no-color`
  flags retained.

### Implementation surface

API:
- `apps/api/src/gitService.js`:
  - new method `getFileHistory(repo, query)` on the service object
  - new exports `FILE_HISTORY_DEFAULT_LIMIT`, `FILE_HISTORY_MAX_LIMIT`,
    `fileHistoryLogArgs`, `parseFileHistoryRecords`
  - new helper `readFileHistoryQuery(query)` (private)
- `apps/api/src/http.js`:
  - new route `GET /api/repos/:repoId/files/history` dispatching to
    `gitService.getFileHistory`

UI:
- `mock/src/app/api.ts`: `FileHistoryEntry`, `FileHistoryResponse`,
  `fetchFileHistory(repoId, params, signal)`
- `mock/src/app/components/refscope/FileHistoryView.tsx` (new):
  - modal-ish overlay (role="dialog" aria-modal, Esc close, focus
    restore, body scroll lock — pattern lifted from DiffViewer fullscreen)
  - per-commit card: shortHash · subject · author · date · rename banner
  - hunk renderer reuses `parseUnifiedDiff` and the `.rs-diff-*` classes so
    CVD-safe theme inherits automatically; per-hunk collapse toggle
- `mock/src/app/components/refscope/DetailPanel.tsx`:
  - new `History` icon button on each changed-file row, aria-label
    `Open file history for <path>`
  - new props `repoId`, `refName`
  - local state `historyPath` controls overlay open/close
- `mock/src/app/App.tsx`: passes `selectedRepo` / `selectedRef` into
  `<DetailPanel>`

### Skipped (with reason)

- **CommandPalette command** ("Open file history (current first file)"):
  spec marked it optional. Implementing required lifting the `historyPath`
  state from DetailPanel into App.tsx and threading the open-callback through
  the palette prop chain. The marginal user benefit didn't justify the new
  cross-cutting state owner. The History button on each file row already
  covers the discovery path.

### Verification

- `pnpm --filter @realtime-git-viewer/api test`: **119 / 119 PASS**
  (was 85, +34 sub-tests across 8 new top-level cases — including the
  rename-via-`git mv` integration that asserts `--follow` connects history
  across the rename and the patch surfaces literal `similarity index NN%`)
- `pnpm build`: **PASS** (api `node --check` + vite mock build)
- `make verify`: **8/8 PASS**
- Live smoke against the refscope repo itself: returned the literal
  `gitRunner.js` history (2 commits, hashes match the real history).

### Decisions worth remembering

- The same `RECORD_SEPARATOR + NUL field separator` parser pattern is used
  by `parseSummaryRecords`, `parseFileHistoryRecords`, and `parseCommitRecords`.
  When extending: the metadata is one line, the rest is per-format payload
  (numstat lines, or in this case raw patch). Strip leading newlines from
  the rest because Git emits a blank line between `--format=...` and the
  patch body.
- `backgroundColor` (longhand) is required for diff line styling instead of
  the `background` shorthand — the CVD-safe theme attaches a stripe pattern
  via `background-image`, and the shorthand would wipe it. Documented in
  DiffViewer.tsx and reproduced in FileHistoryView.tsx.


## 2026-05-02 — Branch Drift Halo (★2)

### Task scope
BranchSidebar の各 ref に対して指定 base ref からの ahead/behind を 2 数値 + halo (mini bar) として常時表示し、SSE で自動更新する。

### Key decisions
- Single batched endpoint (`/api/repos/:repoId/refs/drift`) instead of per-ref N+1 — server fans out to `Promise.all` over `compareRevListArgs(refHash, baseHash)` / `compareRevListArgs(baseHash, refHash)` / `compareMergeBaseArgs(baseHash, refHash)` per ref. 3N git calls per request, capped at limit=50 (max 100).
- Tags are filtered out at the wire layer, not the UI — drift against an anchored ref dilutes the signal.
- Short-circuit: when ref.hash === baseHash, skip the three git calls and emit `{ahead:0, behind:0, mergeBase: baseHash}` directly. Big savings on a sidebar where most branches share HEAD.
- The only derivation in this feature is the halo bar pixel length (normalised against max(ahead+behind) across visible refs). Raw counts always reach the screen reader via aria-label and tooltip.
- gitRunner allowlist NOT touched — `for-each-ref`, `rev-list`, `merge-base` were already permitted. `--end-of-options` discipline maintained, base/target stay as separate tokens (no triple-dot revision).
- Debounce SSE refetch at 500ms — coalesces rapid burst of `ref_*` events without making the halo feel stale.

### Verification
- `pnpm --filter @realtime-git-viewer/api test`: 126/126 PASS (was 119, +7 refsDrift tests covering ahead/behind correctness, base switch, tag exclusion, truncated:true, limit cap, malformed query 400, unknown base 404).
- `pnpm build:mock`: PASS (vite build).
- `pnpm build:api`: PASS (node --check).
- `make verify`: 8/8 PASS.

### Files touched
- `apps/api/src/gitService.js` (+`getRefDrift`, `readRefDriftQuery`, `computeRefDrift`, hard-cap constants)
- `apps/api/src/http.js` (+`refsDrift` route, ordered before generic `/refs` per spec convention)
- `apps/api/test/refsDrift.test.js` (new, 7 tests)
- `mock/src/app/api.ts` (+`fetchRefDrift`, `RefDriftEntry`, `RefDriftResponse`)
- `mock/src/app/components/refscope/BranchSidebar.tsx` (+`DriftHalo`, `computeDriftScale`, drift props on `BranchRow`)
- `mock/src/app/App.tsx` (+`driftMap` state, `refreshDrift` / `scheduleDriftRefresh`, SSE hook integration)

## 2026-05-02 — Related files (co-change) panel

### Decision: 2-step git log, no N+1

Per-commit `git show` would have meant `N` syscalls for `N` target-touching commits. Instead:
1. `git log --follow --format=%H ... -- <pathspec>` — 1 call, returns hash list (limit+1 for truncation detection)
2. `git log --no-walk --name-only --format=<sep>%H%x00%aI ... <hash1> ... <hashN>` — 1 call, returns name-only blocks for the named commits

`--no-walk` is the magic primitive: git prints the literally-named commits without following parents, so the second call cost is independent of repo depth and proportional only to `limit` (≤50). Total: 2 git calls fixed, regardless of co-change count.

### Path normalization

Reused `normalizeNumstatPath` (it already handles `path/{old => new}` notation that surfaces from rename diffs). `--name-only` itself emits one path per line, but the normalizer is invariant on plain paths — keeping it for safety + parity with summary aggregation.

### Sorting + tie-breaking

- Primary: `coChangeCount` desc
- Secondary: `lastCoChangeAt` desc (string comparison on Git's ISO-8601 — sufficient for ordering)
- Tertiary: `path.localeCompare()` for deterministic order across runs

Top-K = 20 hardcoded at `RELATED_FILES_TOP_K`. The wire `truncated` flag refers to the **commit scan** truncation, not the top-K slice — those are separate observations.

### Props naming caution

Last fix-up I let `ref` collide with React's reserved prop name. This time the UI prop is `refName` (already in place) and the new prop is `onSwitchFile` — verified via `grep -n "onSwitchFile\|RelatedFilesPanel\|fetchRelatedFiles\|RelatedFileEntry\|RelatedFilesResponse" mock/src/app/ -r` returns only the new declarations.

### Files touched

- `apps/api/src/gitService.js` (+`getRelatedFiles`, `relatedFilesHashLogArgs`, `relatedFilesNameLogArgs`, `parseRelatedFilesRecords`, `readRelatedFilesQuery`, +3 constants)
- `apps/api/src/http.js` (+route `/files/related`)
- `apps/api/test/relatedFiles.test.js` (new, 14 tests)
- `mock/src/app/api.ts` (+`fetchRelatedFiles`, `RelatedFileEntry`, `RelatedFilesResponse`)
- `mock/src/app/components/refscope/FileHistoryView.tsx` (+`RelatedFilesPanel`, +`onSwitchFile` prop)
- `mock/src/app/App.tsx` (+`onSwitchFile={submitFileHistoryPath}` at FileHistoryView render site)

### Verification

- `pnpm --filter @realtime-git-viewer/api test`: 148/148 PASS (+14)
- `pnpm build:api` (node --check): PASS
- `pnpm build:mock` (vite build): PASS
- `make verify`: 8/8 PASS
- Live curl of `/api/repos/viewer/files/related?path=apps/api/src/gitRunner.js` returns expected co-change rows; target itself absent; 400 / 404 envelopes match spec
