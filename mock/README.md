# Realtime Git Viewer Mock

This package contains the Vite React UI for Realtime Git Viewer. It keeps the
original mock visual baseline, but the main repository, ref, commit, detail, and
diff flows now read from the local API service.

## Running from the repository root

Install dependencies with the root workspace:

```sh
pnpm install
```

Start the mock UI:

```sh
pnpm dev:mock
```

By default the UI reads `http://127.0.0.1:4175`. Start the API separately with
an allowlisted repository:

```sh
RTGV_REPOS=viewer=/absolute/path/to/git/repo pnpm dev:api
VITE_RTGV_API_BASE_URL=http://127.0.0.1:4175 pnpm dev:mock
```

The `RTGV_REPOS` path must be an absolute Git working tree root containing a
`.git` directory or file; repository subdirectories and ordinary directories are
rejected before the API starts. Duplicate `repoId` entries are also rejected so
the repository selector cannot point at an accidentally overwritten allowlist
entry.
If the UI is served from a different origin, configure the API with
comma-separated HTTP(S) origins in `RTGV_ALLOWED_ORIGINS`; origins with paths,
queries, fragments, credentials, or non-HTTP schemes are rejected during API
startup.

If `RTGV_REPOS` contains multiple entries, use the repository selector in the top
bar to switch the active repository without restarting the UI.
Use the top-bar ref selector or sidebar to switch the timeline between `HEAD`,
API-provided local branches, remote-tracking branches, and tags. The UI sends
full ref names to the API when available, which avoids ambiguity between refs
that share the same short name. If the selected ref is removed while realtime
polling is connected, the UI reloads refs and falls back to `HEAD` or another
remaining ref.
The `Command+K` / `Ctrl+K` command palette is backed by the same real UI state:
it switches to API-provided refs, copies the selected commit hash, and clears
active message, author, or path filters.

Use the top-bar search field to filter the commit timeline by commit message,
the author field to filter by commit author, and the path field to filter by a
repository-relative file or directory path. The UI sends these terms to the API
as bounded scalar text queries; malformed path components and duplicate
commit-list query parameters are rejected by the API rather than silently
collapsed. When active filters return no commits, the timeline shows a
filter-specific empty state instead of the generic empty-ref message.

When the API reports commit signature metadata, the timeline and detail panel
show a signature badge for signed commits.
The timeline also uses API-provided `added`, `deleted`, and `fileCount`
metadata so commit rows show change totals before full commit details load.
The commit detail panel can copy the selected commit hash or a local
`git show --stat --patch <hash>` command to the clipboard without running any
Git command from the browser.
The sidebar alert section starts empty and is populated from real
`history_rewritten` SSE events instead of static mock warnings.
Commits first observed through real `commit_added` SSE events are highlighted as
new in the timeline after the UI refreshes from the API. The highlight is kept
only in browser state and clears when switching repositories.
Typed SSE `error` events from the API are shown in the timeline as sanitized
API errors, while ordinary connection failures still update the live status.

Build the mock UI:

```sh
pnpm build:mock
```

The repository keeps dependency resolution in the root `pnpm-lock.yaml`; do not add package-manager lockfiles inside this package.
