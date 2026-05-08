# Code Connect Activation Runbook

> Status: scaffold (2026-05-08, Round 7 D3 partial). Not yet active.

This file documents how to take the Code Connect scaffold from "files exist" to "publishing mappings to Figma." It is the activation runbook a designer or release engineer follows when the Refscope design-system Figma file is ready.

## What ships in the scaffold

| File | Purpose | Activation state |
|------|---------|------------------|
| `figma.config.json` (repo root) | Code Connect config: include glob, parser, label. | ✅ committed |
| `apps/ui/src/app/components/ui/badge.figma.tsx` | Maps shadcn `Badge` primitive (4 variants). | ⚠️ placeholder Figma URL |
| `apps/ui/src/app/components/ui/button.figma.tsx` | Maps shadcn `Button` primitive (6 variants × 4 sizes). | ⚠️ placeholder Figma URL |
| `scripts/tokens/export-figma-variables.mjs` | One-way export of `tokens.json` to Figma Variables payload. | ✅ runnable today |
| `apps/api/test/tokensParity.test.js` | CI invariant: light/dark token key parity. | ✅ part of `make test` |

The two scaffold `.figma.tsx` files contain `// @ts-expect-error` on the `@figma/code-connect` import. That is intentional — it suppresses the type error today and will start producing a real "expected error not found" diagnostic the moment the package is installed, which is the cue to remove the directive in the same PR.

## What's deferred to Phase 2

| Component | Why deferred | Unblocks when |
|-----------|--------------|---------------|
| `LensHeader` | The primitive does not exist yet. D4 (Plea round 7) extracts it. | Phase 2 (after Researcher calibration ≥70% Supported). |
| Status pill / Refscope status badge | The current implementation is an inline `rs-chip` CSS class plus shadcn `Badge` variants — there is no extracted component to map. Extracting a `RefscopeStatusBadge` belongs alongside the LensHeader extraction so they share the same primitive-extraction sprint. | Phase 2, same sprint as LensHeader. |

Do **not** create `LensHeader.figma.tsx` or `status-badge.figma.tsx` as scaffolds before the components exist — the Code Connect file references the React component by import, and a placeholder import would either fail to type-check or silently resolve to nothing.

## Activation steps (when the Figma file is ready)

1. **Add the dependency** to the UI workspace:
   ```sh
   pnpm --filter @realtime-git-viewer/ui add -D @figma/code-connect
   ```
2. **Remove the `// @ts-expect-error` directives** in `badge.figma.tsx` and `button.figma.tsx`. The diagnostic should now resolve cleanly. If it does not, the package version may have changed the export shape — re-read `node_modules/@figma/code-connect/README.md`.
3. **Replace `PLACEHOLDER_NODE_URL`** in each scaffold with the real Figma file/node URL. Confirm the variant enum names in the Figma component property panel match the keys in the `figma.enum(...)` map exactly (case-sensitive).
4. **Run a dry publish** to verify the mappings:
   ```sh
   pnpm --filter @realtime-git-viewer/ui exec figma connect publish --dry-run
   ```
5. **Authenticate and publish**:
   ```sh
   FIGMA_ACCESS_TOKEN=… pnpm --filter @realtime-git-viewer/ui exec figma connect publish
   ```
6. **Verify in Figma**: open the Badge/Button components in Dev Mode and confirm the Refscope React snippets appear in the inspector.

## Activation steps for `tokens.json` → Figma Variables

The export script writes a JSON payload that Figma's Variables import flow accepts. There are two delivery paths:

### Path A — Manual import (recommended for first sync)

```sh
node scripts/tokens/export-figma-variables.mjs
# writes docs/brand/figma-variables.export.json
```

Then in Figma: open the design-system file → Variables panel → import JSON. This path lets a designer review the diff before applying.

### Path B — REST API (recommended once trust is established)

The output JSON is shaped to match `POST /v1/files/:file_key/variables`. A future
`scripts/tokens/sync-figma-variables.mjs` could `fetch` against the Figma API
with an env-supplied token. **That script is intentionally not in this scaffold**
— it is a one-way write to a shared design artifact and should be gated by an
explicit human review at first.

## Maintenance contract

- Do not add a `.figma.tsx` file for a component that does not yet exist in `apps/ui/src/app/components/`.
- The `figma.enum(...)` keys must match the Figma component's property option names exactly. If the Figma file changes, update the scaffold in the same PR.
- Run `node scripts/tokens/export-figma-variables.mjs` whenever `docs/brand/tokens.json` changes; commit the resulting `docs/brand/figma-variables.export.json` so a designer can diff it without re-running the script.
- The `tokensParity.test.js` invariant must stay green. If a new semantic color group is added (e.g., `color.semantic.note`), add `.light` and `.dark` simultaneously, never one before the other.

## Known limitations of the export

The script intentionally does **not** export:

- `elevation.*` (multi-stop box-shadow strings — Figma cannot represent these as variables).
- `motion.easing.*` (cubic-bezier arrays — same reason).
- `typography.font-family.*` (font-family arrays — Figma variables don't accept arrays).

These appear under `$meta.skipped` in the output JSON with their reasons. They are not failures; they are "use the design-token doc instead" boundaries.
