# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

Refscope is a local web app that inspects Git refs and history in real time. The repo is a pnpm workspace (`pnpm-workspace.yaml`) with two runtimes:

- `apps/api/` — Node 22+ HTTP API. Plain ESM JavaScript, no framework, no TypeScript toolchain. Uses `node:http` directly.
- `apps/ui/` — Vite + React 18 UI (the product's main interface). Tailwind v4, Radix UI primitives, shadcn-style components.
- `apps/web/` — Astro 5 public landing page (GitHub Pages target). Static, no runtime API calls.
- `apps/cli/` — `npx`-runnable launcher that ships the bundled API + UI as static assets.
- `docs/spec-v0.md` and `docs/user-demand-report.md` carry product/architecture intent.
- `.agents/` holds per-agent journals; `scripts/orbit/full-implementation/` runs an autonomous Codex implementation loop (not invoked by Claude — only via `make orbit`).

The UI talks to the API over HTTP/SSE. There is no shared package between them.

## Commands

Run from the repository root unless noted. The `Makefile` is the canonical entry point and validates inputs before delegating to pnpm.

- `make dev-self` — start API + UI against this repository (the simplest happy path).
- `make dev-app RTGV_REPOS=viewer=/absolute/path` — start both against another allowlisted repo. `RTGV_REPOS` must be a comma list of `id=/absolute/git/root` entries; the helper `scripts/dev/validate-repos.sh` rejects relative paths, missing paths, or non-Git roots before anything starts.
- `make dev-api RTGV_REPOS=...` / `make dev-ui` — start one side only.
- `make build` — `pnpm build:api && pnpm build:ui && pnpm build:web`. The API "build" is just `node --check` against each source file (there is no transpile step). `pnpm build:ui` runs `vite build`.
- `make test` — runs `pnpm --filter @realtime-git-viewer/api test`, which is `node --test` against `apps/api/test/`. The UI has no test suite.
- Single API test: `node --test apps/api/test/gitRunner.test.js` (or filter with `--test-name-pattern`).
- `make verify` — full Orbit verification gate (`scripts/orbit/full-implementation/verify.sh`). Use this before claiming a non-trivial change is done.
- `make audit` — `pnpm audit --audit-level high`.

Useful env knobs (also see `README.md` for the full list):

- `VITE_RTGV_API_BASE_URL` — UI's API origin (default `http://127.0.0.1:4175`).
- `RTGV_REF_POLL_MS`, `RTGV_GIT_TIMEOUT_MS`, `RTGV_DIFF_MAX_BYTES`, `PORT`, `HOST` — must be decimal positive integers; `1e3` / `10.5` are rejected at startup.
- `RTGV_ALLOWED_ORIGINS` — comma-separated HTTP(S) origins or the literal `*`.

## API architecture

`apps/api/src/server.js` wires the pieces:

```
loadConfig() → createGitService(config) → createRequestHandler(config, gitService)
```

- `config.js` parses and validates env (`RTGV_REPOS`, origins, numeric limits). Repository allowlist is a `Map<repoId, absolutePath>`; duplicate IDs are rejected at startup.
- `gitRunner.js` is the **only** sanctioned way to invoke Git. It enforces:
  - An allowlist of commands (`cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`, `rev-parse`, `show`).
  - Argument-array `spawn` with `shell: false`, `--no-pager`, bounded stdout/stderr, timeouts, and `GIT_*` env scrubbing (no inherited `GIT_DIR`, pagers, SSH, proxies, GCM, replace-objects, lazy fetch, terminal prompt, optional locks, ext-diff/textconv).
  - Rejection of dangerous flags (`-c`, `--git-dir`, `--work-tree`, `--namespace`, `--output`, `--no-index`, pager options) before spawn.
  - Repo path must be an absolute, canonical Git working-tree root.
  - Never bypass this runner. New call sites must go through `runGit`, not `spawn` directly.
- `validation.js` is the public-input contract: `isValidGitRef`, `isValidObjectId`, `parseSearchQuery`, `parseAuthorQuery`, `parsePathQuery`, `parseLimitQuery`, `isValidRepoId`. Any new public input must reuse or extend these — do not write ad-hoc validators in `http.js` or `gitService.js`.
- `gitService.js` resolves public refs to commit object IDs first (`rev-parse` + `cat-file -t`), then runs `log` / `diff` / `show` against the resolved IDs with option parsing terminated (`--end-of-options` / `--`). For compare, `base` and `target` stay as separate revision tokens — never concatenate `base..target` into a single arg.
- `http.js` is a hand-rolled router; SSE lives at `GET /api/repos/:repoId/events` and emits typed events: `connected`, `ref_created`, `ref_updated`, `ref_deleted`, `commit_added`, `history_rewritten`, `error`.

Cryptographic signature verification is intentionally **not** performed — `signed: false`, `signatureStatus: "unknown"`, `--no-show-signature` everywhere. Don't add `gpg.program` or pretty-format placeholders that would invoke GPG.

## UI architecture

- `apps/ui/src/app/App.tsx` is the single state owner: active repo, selected ref, commit list, selected commit, filters, pause state, SSE subscription. Children in `apps/ui/src/app/components/refscope/` (`TopBar`, `BranchSidebar`, `CommitTimeline`, `DetailPanel`, `CommandPalette`) receive props and emit callbacks — they don't fetch.
- `apps/ui/src/app/api.ts` is the only place that calls the backend; SSE handling is colocated.
- `apps/ui/src/app/components/ui/` holds shadcn-style primitives over Radix; reuse these for new UI rather than introducing another component library.
- The command palette (`Cmd/Ctrl+K`) operates on the same live state as the rest of the UI — it must not maintain a parallel ref/commit list.

## Conventions

- API code is **JavaScript ESM**, not TypeScript. Don't introduce a TS build step in `apps/api/`. Use JSDoc if types are valuable.
- Tests use `node:test` + `node:assert/strict`. No Vitest/Jest in the API.
- The root `pnpm-lock.yaml` is the only lockfile; never add a nested one in `apps/*`.
- Commits follow conventional-commit prefixes (`feat`, `fix`, `chore`, `docs`) as visible in recent history.
- Agent journals (`.agents/*.md`, `.agents/PROJECT.md`) are append-only logs maintained by named agents (Plea, Nexus, Orbit, Builder). Don't edit them unless the task is explicitly journal maintenance.
