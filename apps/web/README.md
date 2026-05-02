# @realtime-git-viewer/web

Refscope's public landing page. Astro 5 (static output) + Tailwind v4
(via the official `@tailwindcss/vite` plugin), wired to the brand tokens
in `docs/brand/tailwind-theme.css`.

The page is intended for GitHub Pages and is deployed by a separate
workflow (not part of this package). The build is fully static; nothing
in the page calls back to a server at runtime.

## Commands

Run from the repository root or with `--filter @realtime-git-viewer/web`.

| Command | Description |
| --- | --- |
| `pnpm --filter @realtime-git-viewer/web dev` | Astro dev server on `http://127.0.0.1:4321`. |
| `pnpm --filter @realtime-git-viewer/web build` | Static build into `dist/`. |
| `pnpm --filter @realtime-git-viewer/web preview` | Serve `dist/` for local verification. |
| `pnpm --filter @realtime-git-viewer/web capture` | Capture demo media from a running UI. See `scripts/README.md`. |

Root-level shortcuts (defined in the workspace `package.json`):
`pnpm dev:web`, `pnpm build:web`, `pnpm capture:web`.

## GitHub Pages configuration

`astro.config.mjs` reads two env vars at build time:

```sh
PUBLIC_SITE_URL=https://owner.github.io \
PUBLIC_BASE_PATH=/refscope \
pnpm --filter @realtime-git-viewer/web build
```

Defaults assume project pages at `https://owner.github.io/refscope/`.
Override both for user/organisation pages or a custom domain.

The deployment workflow itself (e.g. `.github/workflows/pages.yml`) is
not part of this package — Nexus or Pipe will add it when the deploy
target is decided.

## Brand tokens

`src/styles/tailwind-theme.css` is a verbatim copy of
`docs/brand/tailwind-theme.css`. Keep them in sync manually for now; if
they diverge, the version in `docs/brand/` is canonical.

## Files this package will not touch

- `apps/api/`, `apps/ui/` — separate packages.
- The root `Makefile` — Nexus owns target additions.
