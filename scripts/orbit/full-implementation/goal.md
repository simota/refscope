# Goal

## Objective

Implement Realtime Git Viewer as a working local web application, using the existing spec and mock as the product baseline.

## Why

The repository currently has a specification and Vite mock. The next milestone is an executable product slice that can read an allowlisted Git repository, expose Git history through an API, and render live commit updates in the UI.

## Acceptance Criteria

1. A backend service exposes repository, branch/ref, commit list, commit detail, diff, and SSE event endpoints.
2. Git command execution is safe: allowlisted repositories only, argument-array execution, no shell string concatenation for user input, command timeouts, and bounded diff output.
3. The UI consumes real API data instead of static mock data for the main repository/branch/commit flows, with loading, error, and empty states.
4. Realtime updates detect new commits and history rewrites through ref snapshot comparison, then publish typed SSE events.
5. Documentation explains setup, repository allowlist configuration, development commands, and security constraints.
6. Verification passes with `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm audit --audit-level high`, and any test script added during implementation.

## Out of Scope

- Hosted production deployment.
- GitHub/GitLab webhook integration.
- AI summarization.
- Multi-user collaboration.
- Write operations such as checkout, cherry-pick, fetch, or push from the UI.

## Verification Command

```sh
bash scripts/orbit/full-implementation/verify.sh
```

