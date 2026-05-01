# Refscope

Refscope is a local web application for inspecting Git refs and history updates
as they happen. The repository currently contains the product/architecture
specification, a Vite React mock UI, and the first backend API slice for reading
allowlisted Git repositories.

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

`make dev-self`, `make dev-app`, and `make dev-api` validate the repository
path before starting services. If the path is missing, relative, does not exist,
or is not the Git root containing `.git`, the terminal explains what to fix.

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
Annotated tags are reported with their peeled target commit hash instead of the
tag object hash, keeping branch, remote, and tag refs aligned for commit-history
display.
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
rejected at startup. `RTGV_GIT_TIMEOUT_MS` must also fit Node.js timer bounds
(`1` through `2147483647`), and `RTGV_DIFF_MAX_BYTES` is capped at `16777216`
bytes so Git output remains bounded.

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
- `GET /api/repos/:repoId/compare?base=main&target=feature/refscope`
- `GET /api/repos/:repoId/events`

Commit detail responses include metadata, refs, and a bounded changed-file summary
derived from read-only `git show --numstat` and `git show --name-status`
commands. Full patch text remains available through the separate diff endpoint.
For renamed files, the summary attaches additions and deletions to the
destination path reported by `--name-status`.
The `:hash` path parameter for commit detail and diff endpoints must be a full
40-character hexadecimal commit object ID; abbreviated hashes are rejected before
Git execution to avoid ambiguous object resolution. Full object IDs are also
checked with `git cat-file -t` before detail or diff reads, and non-commit
objects are rejected without returning their contents.
Commit list and detail responses include `signed` and `signatureStatus` fields,
but cryptographic signature verification is intentionally not performed by the
API because Git can invoke repository-configured GPG programs for signed
commits. Until offline signature parsing is implemented, signed commits are
reported as `signed: false` with `signatureStatus: "unknown"`.
Commit list responses include bounded `git log --numstat` aggregate metadata as
`added`, `deleted`, and `fileCount`, which the timeline uses before loading full
commit details.
The optional commit-list `search` parameter is a bounded, case-insensitive,
literal search over commit messages. The optional `author` parameter is a
bounded, case-insensitive literal match against commit authors. Both filters
escape Git regex metacharacters independently so combining them keeps literal
matching semantics. The optional `path` parameter filters commits to a
repository-relative file or directory path and rejects malformed components such
as empty segments, `.`, and `..`.
The optional commit-list `ref` parameter must resolve to a commit before the
history read runs; the API then reads history from the resolved commit object ID.
Missing refs and non-commit object IDs return a public `404` error.
The optional `limit` parameter must be a decimal positive integer; accepted
values are clamped to the API maximum of 200 commits and invalid values return a
public `400` error.
Commit-list query parameters are scalar: duplicate `ref`, `limit`, `search`,
`author`, or `path` parameters return a public `400` error instead of being
silently collapsed to one value.
Compare responses summarize `base..target` with ahead/behind counts,
changed-file totals, added/deleted line totals, merge-base information when
available, and copyable local Git commands for `log`, `diff --stat`, and
`diff`. The copyable commands keep `base` and `target` as separate revision
tokens, while the backend comparison commands read from the resolved commit
object IDs. Both compare revisions must resolve to commits before any comparison
command runs.
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
Rewrite alerts show observed facts (ref, previous hash, current hash, observed
time, and detection source) separately from the interpretation, and include a
copyable incident note for team coordination.
The web UI also marks commits observed through real `commit_added` SSE events as
new in the timeline after the refreshed commit list includes those hashes. The
highlight state is local to the current browser session and clears when
switching repositories.
Live updates can be paused from the top bar or command palette. While paused,
incoming SSE events are counted and announced through a polite live region, but
the timeline is not refreshed until updates are resumed.
The timeline includes a read-only compare bar for pinning a base ref/commit and
target ref, preserving selected commits across ref switches when possible, and
copying local Git comparison commands.
The timeline also includes a commit activity overview with labeled metrics and
mini bars for commit count, additions, deletions, signed commits, merge commits,
and live-update new commits.
If the SSE stream emits a typed `error` event, the web UI surfaces the sanitized
API error message in the timeline instead of silently dropping the event.

## Security constraints

- Repository access is allowlist-only through `RTGV_REPOS`.
- Duplicate `repoId` values in `RTGV_REPOS` are rejected at startup instead of
  being silently overwritten.
- Allowlisted repository paths must be absolute Git working tree roots, not
  arbitrary directories or repository subdirectories.
- The shared Git runner also rejects non-absolute, non-canonical, and non-Git
  working tree root paths before spawning Git, so future internal call sites
  cannot accidentally read directories outside the configured allowlist model.
- Malformed percent-encoded API paths are rejected as public `400` errors before repository lookup.
- Git commands are executed with argument arrays and `shell: false`.
- Git command execution is limited to the read-only command set used by the
  API (`cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`, `rev-list`,
  `rev-parse`, and `show`).
- Git command arguments must start with a command name. Leading Git global
  options such as `-c`, `--git-dir`, `--work-tree`, and `--namespace` are
  rejected before spawn so internal call sites cannot override the hardened
  execution context.
- Git command execution rejects output-file options such as `--output` before
  spawn, so read-only API call sites cannot accidentally write diff output to
  arbitrary filesystem paths.
- Git command execution rejects `--no-index` diff mode before spawn, so diff
  reads stay scoped to the allowlisted repository working tree.
- Git command execution strips inherited `GIT_*` environment variables before
  setting safe runtime overrides, so variables such as `GIT_DIR` cannot redirect
  reads away from the allowlisted repository path.
- Git command execution starts Git with `--no-pager`, rejects explicit pager
  options, and overrides inherited pager environment with `cat`, so API reads do
  not invoke user-configured pagers.
- Git command execution ignores user-global and system Git configuration by
  setting `GIT_CONFIG_GLOBAL` to the null device and `GIT_CONFIG_NOSYSTEM=1`;
  repository-local configuration is still read, with unsafe behaviors disabled
  by explicit command flags where needed.
- Git command execution sets `GIT_ATTR_NOSYSTEM=1`, so system gitattributes do
  not alter API history or diff reads.
- Git command execution sets `GIT_NO_LAZY_FETCH=1` and
  `GIT_TERMINAL_PROMPT=0`, so read-only API commands do not fetch missing
  promisor objects on demand or block waiting for terminal credentials.
- Git command execution strips inherited SSH credential prompt and agent
  variables (`SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `SSH_ASKPASS`, and
  `SSH_ASKPASS_REQUIRE`) so API subprocesses do not receive ambient SSH
  credentials.
- Git command execution strips inherited proxy environment variables
  (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY`, including lowercase
  variants) so local read-only API commands do not receive ambient network proxy
  configuration or credential-bearing proxy URLs.
- Git command execution strips inherited Git Credential Manager environment
  variables (`GCM_*`) so credential-helper interaction, storage, and tracing
  settings are not passed to API subprocesses.
- Git command execution sets `GIT_OPTIONAL_LOCKS=0`, so read-only API commands
  avoid taking optional repository locks while inspecting allowlisted
  repositories.
- Git reads set `GIT_NO_REPLACE_OBJECTS=1`, so repository replacement refs do
  not silently rewrite object resolution for displayed history or diffs.
- Diff and changed-file reads pass `--no-ext-diff` and `--no-textconv`, so
  repository-configured external diff or textconv commands are not executed by
  API reads.
- Git commands have timeouts. Configure with `RTGV_GIT_TIMEOUT_MS`.
- Git command stdout and stderr are bounded before being retained in memory;
  commands that exceed the bound are stopped and reported as truncated.
- The shared Git runner rejects invalid internal timeout and output-bound values
  before spawning Git, so future call sites cannot accidentally disable those
  safeguards with `0`, `Infinity`, timer-overflow values, or output bounds above
  `16777216` bytes.
- Diff output is bounded. Configure with `RTGV_DIFF_MAX_BYTES`.
- Numeric runtime safety settings are parsed only as decimal positive integers;
  exponent and decimal notation are rejected instead of being coerced.
- Public commit search input is trimmed, length-bounded, and rejected when it
  contains control characters before it reaches Git.
- Public ref input accepts `HEAD` and conservative Git ref-like names only,
  rejecting malformed components such as empty segments, leading dots, trailing
  dots, `.lock` suffixes, `..`, and `@{` before Git execution. Transient Git
  pseudo refs such as `AUTO_MERGE`, `BISECT_HEAD`, `CHERRY_PICK_HEAD`,
  `FETCH_HEAD`, `ORIG_HEAD`, `MERGE_HEAD`, `MERGE_AUTOSTASH`, `REBASE_HEAD`,
  `REVERT_HEAD`, and `BISECT_EXPECTED_REV` are rejected for public revision
  input. Stash refs such as `stash` and `refs/stash` are also rejected because
  they can contain unpublished working-tree state. Full `refs/` inputs are limited to the
  advertised `refs/heads/`, `refs/remotes/`, and `refs/tags/` surfaces; other
  namespaces such as `refs/bisect/`, `refs/changes/`, `refs/keep-around/`,
  `refs/notes/`, `refs/original/`, `refs/prefetch/`, `refs/pull/`,
  `refs/replace/`, `refs/rewritten/`, and `refs/worktree/` are rejected before
  Git execution. Same-named branches remain addressable through their full names
  such as `refs/heads/FETCH_HEAD`, `refs/heads/stash`, or `refs/heads/original`.
- Commit-list refs are resolved as commit-ish revisions with Git option parsing
  ended before the log query runs, so blob IDs and missing refs return a public
  error instead of falling through to a generic Git failure. The log query uses
  the resolved commit object ID rather than re-reading the public ref token, and
  ends option parsing before passing that resolved ID to `git log`.
- Compare `base` and `target` revisions use the same commit-ish resolution
  before diff, rev-list, or merge-base commands run, and those comparison
  commands use resolved commit object IDs. Rev-list comparison commands express
  exclusions with separate `--not` arguments instead of caret-prefixed revision
  strings, while diff and merge-base comparison commands end option parsing
  before the resolved commit IDs are passed to Git.
- Public message and author filter inputs use the same trimming, length bound,
  and control character rejection, then escape regex metacharacters before they
  reach Git so combined filters remain literal matches.
- Public path filter input is trimmed, length-bounded, rejected for control
  characters, absolute paths, empty path segments, `.`, `..`, and leading `-`,
  then passed to Git as a literal top-level pathspec after `--`.
- Commit signature verification is not performed by the API; pretty-format
  placeholders that invoke GPG are avoided and history/detail reads pass
  `--no-show-signature`, so repository-configured `gpg.program` commands and
  `log.showSignature=true` do not execute during read-only history requests.
- Commit list file-change totals are read with `git log --numstat` through the
  same allowlisted, argument-array command runner.
- Public commit list `limit` input is rejected unless it is a decimal positive
  integer, then clamped to 200 before reaching Git.
- Duplicate public commit-list query parameters are rejected before Git
  execution so conflicting scalar inputs are not silently ignored.
- Public compare `base` and `target` inputs must be conservative Git ref-like
  names or full 40-character object IDs before any comparison command runs.
- Compare Git commands pass public `base` and `target` revisions as separate
  argument-array entries rather than concatenating them into executable range
  arguments.
- Compare API copyable commands also keep `base` and `target` as separate
  revision tokens instead of returning `base..target` range strings.
- SSE commit range reads pass observed ref hashes as separate `git log`
  revision arguments (`--not from --end-of-options to`) rather than
  concatenating range strings, ending option parsing before the positive ref
  hash is read.
- Public commit detail and diff `:hash` path input must be a full 40-character
  hexadecimal object ID; abbreviated or non-hex values are rejected before Git
  execution, and full object IDs must resolve to commit objects before detail or
  diff output is read.
- Commit object validation uses `git cat-file -t` with option parsing ended
  before the validated object ID is passed to Git.
- Commit detail and diff `git show` commands end option parsing before the
  validated commit object ID is passed to Git.
- Realtime ancestry checks use `git merge-base --is-ancestor` with option
  parsing ended before observed ref hashes are passed to Git.
- Realtime polling reads refs only from allowlisted repositories. Configure interval with `RTGV_REF_POLL_MS`.
- CORS defaults to `http://localhost:5173` and `http://127.0.0.1:5173`.
  Override with `RTGV_ALLOWED_ORIGINS` using comma-separated HTTP(S) origins or
  the exact wildcard value `*`.
