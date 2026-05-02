# Capture script — Refscope LP media

`scripts/capture.mjs` records the hero PNG and the five demo scenes from
the running UI, then composes the OGP card. Output goes to
`apps/web/public/media/` and `apps/web/public/og-card.png`.

The script is best-effort: each scene is wrapped in its own try/catch so a
single missing affordance does not abort the run.

## Prerequisites

- The UI must be running locally:

  ```sh
  make dev-self
  ```

  This starts the API at `http://127.0.0.1:4175` and the UI at
  `http://127.0.0.1:5173`. The capture script polls the UI URL for up to
  30 seconds before giving up.

- Playwright browsers must be installed once per machine:

  ```sh
  pnpm --filter @realtime-git-viewer/web exec playwright install chromium
  ```

  This downloads ~150MB and is intentionally **not** part of the install
  step — running it is the operator's choice.

## Run

```sh
# Both themes (default)
pnpm --filter @realtime-git-viewer/web capture

# Dark only
THEME=dark pnpm --filter @realtime-git-viewer/web capture

# Custom UI URL (e.g. when running the UI on a different port)
UI_URL=http://127.0.0.1:5174 pnpm --filter @realtime-git-viewer/web capture
```

## What each scene captures

| Scene | Slug                  | Action                                                                                       |
| ----- | --------------------- | -------------------------------------------------------------------------------------------- |
| Hero  | `hero-timeline`       | Full viewport of the UI in steady state.                                                     |
| 01    | `rewrite-detection`   | Sidebar / notices region (looks for `aside`, `[data-testid=sidebar]`, etc.).                 |
| 02    | `commit-timeline`     | Main timeline pane.                                                                          |
| 03    | `compare-bar`         | Clicks the Compare toggle if present, then captures the compare region.                      |
| 04    | `pause-live-updates`  | Clicks the Pause button if present, then captures the top bar.                               |
| 05    | `command-palette`     | Sends Cmd+K (mac) / Ctrl+K, waits for the palette dialog, captures full viewport.            |
| OGP   | `og-card.png`         | Composes a 1200×630 dark card in a fresh context — does not depend on the UI being up.       |

## Reduced motion

All capture contexts request `reducedMotion: "reduce"` so the static PNGs
double as the `prefers-reduced-motion: reduce` fallback in `<picture>`
elements.

## Known limitations

- **Light theme**: the UI may not yet implement a light theme. When
  applying `theme=light` is a no-op, the resulting `*-light.png` will look
  identical to the dark capture. The LP's `<picture>` source list still
  selects the right file by media query, so this is harmless until the
  UI ships light styles.
- **Videos**: v0 is **PNG only**. WebM capture via
  `context.recordVideo` is feasible but not wired — adding it would
  require trimming, looping, and per-scene scenario scripts. Tracked as a
  follow-up in the LP's Beyond MVP section (it is not promised).
- **Selectors** are heuristic. The UI has no stable `data-testid`
  attributes today; the script tries a small candidate list and falls
  back to a full-viewport capture so something useful always lands on
  disk.

## Re-running after UI changes

The output PNGs are gitignored (`apps/web/public/media/*.png`). The
expected workflow is:

1. Make a change to the UI.
2. `make dev-self` (terminal A).
3. `pnpm --filter @realtime-git-viewer/web capture` (terminal B).
4. `pnpm --filter @realtime-git-viewer/web build` to verify the LP picks
   up the new images.
