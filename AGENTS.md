# Repository Guidelines

## Project Structure & Module Organization

This repository currently contains the specification for a realtime Git log viewer.

- `docs/spec-v0.md`: initial architecture and product design.
- `AGENTS.md`: contributor and agent guidance for future work.

When implementation begins, separate source code by runtime:

- `apps/web/` for the browser UI.
- `apps/api/` or `server/` for the Git-reading backend.
- `tests/` or colocated `*.test.ts` files for automated tests.
- `docs/` for specifications, architecture notes, and operational guidance.

## Build, Test, and Development Commands

No build system is configured yet. Do not invent commands without adding project files.

Once a stack is introduced, document canonical commands here:

- `npm install`: install JavaScript dependencies.
- `npm run dev`: start the local development server.
- `npm test`: run automated tests.
- `npm run lint`: run formatting and lint checks.

Prefer one package manager per implementation area and commit the matching lockfile.

## Coding Style & Naming Conventions

Use TypeScript for web/API code unless the project adopts another language. Prefer clear names over abbreviations.

- Components: `PascalCase`, for example `CommitTimeline.tsx`.
- Hooks: `useSomething`, for example `useGitEvents.ts`.
- Utilities and services: `camelCase` exports in descriptive files, for example `gitCommandRunner.ts`.
- Documentation files: lowercase kebab-case, for example `security-model.md`.

Keep comments focused on why a choice exists, especially around Git edge cases and diff limits.

## Testing Guidelines

Add tests with the first implementation code. Prioritize coverage for Git command parsing, ref snapshot comparison, event classification, and API input validation.

Suggested naming:

- Unit tests: `*.test.ts`
- Integration tests: `*.integration.test.ts`

Include fixtures for representative Git histories: fast-forward commits, merge commits, rewritten branches, deleted refs, and large diffs.

## Commit & Pull Request Guidelines

This repository has no commit history yet, so no local convention is established. Use concise, imperative messages:

- `Add initial API server scaffold`
- `Implement ref snapshot comparison`
- `Document SSE event contract`

Pull requests should include a short summary, verification steps, linked issue or task when available, and screenshots for UI changes. Call out security-sensitive changes, especially repository path handling, command execution, authentication, and private data display.

## Security & Configuration Tips

Never accept arbitrary repository paths from clients. Resolve `repoId` through a server-side allowlist. Run Git commands with argument arrays, timeouts, and bounded output. Do not log secrets, tokens, private repository contents, or unnecessary author email data.
