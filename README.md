# Realtime Git Viewer

Realtime Git Viewer is a local web application for inspecting Git history updates as they happen. The repository currently contains the product/architecture specification, a Vite React mock UI, and the first backend API slice for reading allowlisted Git repositories.

## Repository layout

- `docs/spec-v0.md`: product and architecture specification.
- `apps/api/`: local Node.js API for safe, read-only Git history access.
- `mock/`: Vite React mock UI.

## Prerequisites

- Node.js 22 or newer.
- Corepack enabled, or pnpm 10.9.0 available on `PATH`.

This repository uses pnpm workspaces from the root. Keep a single root `pnpm-lock.yaml` committed when dependencies are installed or changed.

## Setup

```sh
corepack enable
pnpm install
```

## Development

Start the API and UI for this repository with one command:

```sh
make dev-self
```

Open the UI at `http://127.0.0.1:5173`.

To inspect another Git repository, pass an allowlisted repository path:

```sh
make dev-app RTGV_REPOS=viewer=/absolute/path/to/git/repo
```

Equivalent explicit two-terminal setup:

```sh
RTGV_REPOS=viewer=/absolute/path/to/git/repo pnpm dev:api
VITE_RTGV_API_BASE_URL=http://127.0.0.1:4175 pnpm dev:mock
```

The API listens on `http://127.0.0.1:4175` by default.

The web UI reads the API at `http://127.0.0.1:4175` by default. Override it
when the API runs elsewhere:

```sh
VITE_RTGV_API_BASE_URL=http://127.0.0.1:4175 pnpm dev:mock
```

When multiple repositories are allowlisted, the web UI repository selector switches
the active API repository and reloads refs, commits, details, diffs, and SSE
updates for that repository.
The top-bar ref selector and sidebar can switch the commit timeline between
`HEAD`, API-provided local branches, remote-tracking branches, and tags. Ref
selections are sent to the API as full ref names where available, so a branch
and tag with the same short name do not collide. If the currently selected ref
disappears during realtime polling, the UI reloads the ref list and falls back
to `HEAD` or another remaining ref.
The `Command+K` / `Ctrl+K` command palette uses the same API-provided refs and
selected commit state for ref switching, current-hash copy, and clearing active
timeline filters.

Allowlist format:

```text
RTGV_REPOS=repoId=/absolute/path,otherRepo=/absolute/path
```

Only `repoId` values from `RTGV_REPOS` are accepted by API routes. Each
allowlisted path must resolve to a Git working tree root containing a `.git`
directory or file, and each `repoId` must be unique. Clients never provide raw
repository paths.

Realtime SSE polling interval can be adjusted when needed:

```sh
RTGV_REF_POLL_MS=1000 RTGV_REPOS=viewer=/absolute/path/to/git/repo pnpm dev:api
```

Numeric runtime settings such as `PORT`, `RTGV_GIT_TIMEOUT_MS`,
`RTGV_DIFF_MAX_BYTES`, and `RTGV_REF_POLL_MS` must be decimal positive integer
strings. Values using numeric coercion syntax such as `1e3` or `10.5` are
rejected at startup.

When overriding browser origins for CORS, provide comma-separated HTTP(S)
origins only, or set the whole value to `*` for local unrestricted access:

```sh
RTGV_ALLOWED_ORIGINS=http://localhost:5173,https://viewer.example.test
```

Origins with paths, queries, fragments, credentials, or non-HTTP schemes are
rejected during API startup.

## Build

Build the mock UI from the repository root:

```sh
pnpm build
```

Equivalent explicit command:

```sh
pnpm build:mock
```

Build only the API:

```sh
pnpm build:api
```

## API

Available read-only endpoints:

- `GET /health`
- `GET /api/repos`
- `GET /api/repos/:repoId/refs`
- `GET /api/repos/:repoId/commits?ref=HEAD&limit=50&search=message&author=name&path=src/app.ts`
- `GET /api/repos/:repoId/commits/:hash`
- `GET /api/repos/:repoId/commits/:hash/diff`
- `GET /api/repos/:repoId/events`

Commit detail responses include metadata, refs, and a bounded changed-file summary
derived from read-only `git show --numstat` and `git show --name-status`
commands. Full patch text remains available through the separate diff endpoint.
The `:hash` path parameter for commit detail and diff endpoints must be a full
40-character hexadecimal commit object ID; abbreviated hashes are rejected before
Git execution to avoid ambiguous object resolution.
Commit list and detail responses also include Git signature metadata from
read-only `git log` / `git show` format fields as `signed` and
`signatureStatus`.
Commit list responses include bounded `git log --numstat` aggregate metadata as
`added`, `deleted`, and `fileCount`, which the timeline uses before loading full
commit details.
The optional commit-list `search` parameter is a bounded, case-insensitive,
fixed-string search over commit messages. The optional `author` parameter is a
bounded, case-insensitive literal match against commit authors. The optional
`path` parameter filters commits to a repository-relative file or directory
path and rejects malformed components such as empty segments, `.`, and `..`.
The optional `limit` parameter must be a decimal positive integer; accepted
values are clamped to the API maximum of 200 commits and invalid values return a
public `400` error.
Commit-list query parameters are scalar: duplicate `ref`, `limit`, `search`,
`author`, or `path` parameters return a public `400` error instead of being
silently collapsed to one value.
When message, author, or path filters are active and the API returns no
commits, the web UI shows a filter-specific empty state so a zero-result search
is distinguishable from an unfiltered empty ref.

The SSE endpoint keeps an in-memory ref snapshot per connection, polls the allowlisted repository refs, and emits typed events:

- `connected`
- `ref_created`
- `ref_updated`
- `ref_deleted`
- `commit_added`
- `history_rewritten`
- `error`

The web UI uses `history_rewritten` events for the realtime notice and the
sidebar alert list. The alert list is event-driven and starts empty; it does not
show synthetic rewrite warnings before the API observes one.
The web UI also marks commits observed through real `commit_added` SSE events as
new in the timeline after the refreshed commit list includes those hashes. The
highlight state is local to the current browser session and clears when
switching repositories.
If the SSE stream emits a typed `error` event, the web UI surfaces the sanitized
API error message in the timeline instead of silently dropping the event.

## Security constraints

- Repository access is allowlist-only through `RTGV_REPOS`.
- Duplicate `repoId` values in `RTGV_REPOS` are rejected at startup instead of
  being silently overwritten.
- Allowlisted repository paths must be absolute Git working tree roots, not
  arbitrary directories or repository subdirectories.
- Malformed percent-encoded API paths are rejected as public `400` errors before repository lookup.
- Git commands are executed with argument arrays and `shell: false`.
- Git commands have timeouts. Configure with `RTGV_GIT_TIMEOUT_MS`.
- Diff output is bounded. Configure with `RTGV_DIFF_MAX_BYTES`.
- Numeric runtime safety settings are parsed only as decimal positive integers;
  exponent and decimal notation are rejected instead of being coerced.
- Public commit search input is trimmed, length-bounded, and rejected when it
  contains control characters before it reaches Git.
- Public ref input accepts `HEAD` and conservative Git ref-like names only,
  rejecting malformed components such as empty segments, leading dots, trailing
  dots, `.lock` suffixes, `..`, and `@{` before Git execution.
- Public author filter input uses the same trimming, length bound, and control
  character rejection, then escapes regex metacharacters before it reaches Git.
- Public path filter input is trimmed, length-bounded, rejected for control
  characters, absolute paths, empty path segments, `.`, `..`, and leading `-`,
  then passed to Git as a literal top-level pathspec after `--`.
- Commit signature state is read as metadata only; the application does not run
  trust-changing GPG commands or mutate repository configuration.
- Commit list file-change totals are read with `git log --numstat` through the
  same allowlisted, argument-array command runner.
- Public commit list `limit` input is rejected unless it is a decimal positive
  integer, then clamped to 200 before reaching Git.
- Duplicate public commit-list query parameters are rejected before Git
  execution so conflicting scalar inputs are not silently ignored.
- Public commit detail and diff `:hash` path input must be a full 40-character
  hexadecimal object ID; abbreviated or non-hex values are rejected before Git
  execution.
- Realtime polling reads refs only from allowlisted repositories. Configure interval with `RTGV_REF_POLL_MS`.
- CORS defaults to `http://localhost:5173` and `http://127.0.0.1:5173`.
  Override with `RTGV_ALLOWED_ORIGINS` using comma-separated HTTP(S) origins or
  the exact wildcard value `*`.
