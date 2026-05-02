# refscope

An observatory for Git refs and history. Local, read-only, allowlist-scoped.

`refscope` starts a single Node.js process that serves both the inspection API
and the bundled web UI on one port, then opens your browser at it. There is
nothing to install, configure, or clone first.

## Usage

Refscope is published from GitHub, not the npm registry, so the package
identifier is the repository itself.

```sh
cd /path/to/your/repo
npx -y github:simota/refscope
```

In whatever directory you run it, Refscope opens an observatory for that
repository. By default, Refscope observes the current working directory,
binds to `127.0.0.1:4175`, and opens your browser to that URL. Press
`Ctrl+C` to stop.

To observe a different repository without changing directories:

```sh
npx -y github:simota/refscope --repo /absolute/path/to/another/repo
```

To pin a specific revision instead of the default branch, append a tag or
commit:

```sh
npx -y github:simota/refscope#v0.0.1
```

The first run downloads the repository, runs `npm install`, and triggers
the `prepare` script, which copies the API source into `bundled-api/` and
builds the bundled UI. Subsequent invocations use the npx cache.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `--repo <path>` | current directory | Git working tree to observe. Must contain a `.git` directory or file. |
| `--port <number>` | `4175` | Port to listen on. |
| `--host <hostname>` | `127.0.0.1` | Host interface to bind. |
| `--no-open` | (off) | Do not open a browser window on startup. |
| `--ref-poll <ms>` | `2000` | Ref polling interval for live updates. |
| `--git-timeout <ms>` | `5000` | Per-Git-command timeout. |
| `--diff-max-bytes <bytes>` | `4000000` | Maximum diff payload retained in memory. |
| `-h`, `--help` | | Show usage and exit. |
| `-v`, `--version` | | Show version and exit. |

All numeric options accept decimal positive integers only. Exponent and
decimal notation (`1e3`, `10.5`) are rejected at startup.

## What it shows

- Branches, tags, remote-tracking refs, stashes, linked worktrees, and
  submodules.
- Commit history per ref with bounded `--numstat` aggregates.
- Commit detail, diff, file history, and co-change overview.
- Compare view with ahead/behind counts and copyable Git commands.
- Live ref updates over Server-Sent Events: `ref_created`, `ref_updated`,
  `ref_deleted`, `commit_added`, `history_rewritten`, `error`.

## How it runs

`refscope` is a single Node.js HTTP server. Requests for `/api/*` and
`/health` are dispatched to the inspection API; everything else is served
from the bundled UI as static files. The UI talks to the API through
relative paths, so there is only ever one origin to think about.

```
        Browser (auto-opened)
            │
            ▼
   http://127.0.0.1:4175
            │
   ┌────────┴────────┐
   │ refscope        │  Single Node.js process
   │  http.Server    │
   ├─────────────────┤
   │ if /api/* or    │  → API handler (read-only Git)
   │    /health      │
   ├─────────────────┤
   │ else            │  → Static UI (bundled at publish time)
   └─────────────────┘
```

## Security model

The inspection API is read-only by construction. `refscope` inherits every
guarantee of the underlying Refscope API:

- Git execution goes through a hardened runner with an allowlist of
  commands (`cat-file`, `diff`, `for-each-ref`, `log`, `merge-base`,
  `rev-list`, `rev-parse`, `show`, `stash list`, `submodule status`,
  `worktree list`).
- Git is invoked with `spawn` and `shell: false`, never through a shell.
- Inherited `GIT_*`, `SSH_*`, proxy, and Git Credential Manager environment
  variables are stripped before subprocesses run.
- `--no-pager`, `GIT_NO_LAZY_FETCH=1`, `GIT_TERMINAL_PROMPT=0`,
  `GIT_OPTIONAL_LOCKS=0`, and `GIT_NO_REPLACE_OBJECTS=1` are set so reads
  cannot block on credentials, fetch missing objects on demand, take
  optional locks, or follow replacement refs.
- User-global and system Git configuration is ignored
  (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`,
  `GIT_ATTR_NOSYSTEM=1`).
- Diff and changed-file reads pass `--no-ext-diff` and `--no-textconv`, so
  repository-configured external diff drivers do not execute.
- Cryptographic signature verification is intentionally not performed.
  Signed commits are reported as `signed: false` with
  `signatureStatus: "unknown"` so repository-configured `gpg.program`
  binaries cannot be invoked.
- Public ref input rejects malformed components, transient pseudo-refs,
  stash refs, and namespaces outside `refs/heads/`, `refs/remotes/`, and
  `refs/tags/`.
- Numeric runtime limits (`--port`, `--ref-poll`, `--git-timeout`,
  `--diff-max-bytes`) are parsed only as decimal positive integers.
- Git command stdout and stderr are bounded; commands that exceed the
  bound are stopped and reported as truncated.

For the full list, see the project README at
<https://github.com/simota/refscope#security-constraints>.

## Workspace development

Inside the `refscope` monorepo, the CLI lives at `apps/cli/`. Build and run
it locally without publishing:

```sh
pnpm install
pnpm --filter refscope build
node apps/cli/bin/refscope.mjs --repo "$(pwd)" --no-open
```

`pnpm --filter refscope build` copies `apps/api/src/*.js` into
`apps/cli/src/bundled-api/` and builds the UI with
`VITE_RTGV_API_BASE_URL=""` into `apps/cli/src/static/`. The same script
runs as `prepublishOnly`, so the published tarball is self-contained and
has no workspace dependencies.

## License

MIT — see [LICENSE](./LICENSE).
