# Codex Orbit Iteration Prompt

You are running inside the Realtime Git Viewer repository.

Read these files first:

- `docs/spec-v0.md`
- `README.md`
- `AGENTS.md`
- `scripts/orbit/full-implementation/goal.md`
- `scripts/orbit/full-implementation/progress.md`

Implement the next smallest safe slice toward the goal. Prefer repository conventions and keep changes reviewable.

Required behavior:

- Do not delete or overwrite unrelated user changes.
- Do not commit unless explicitly asked by the runner configuration or user.
- Keep each iteration to the smallest useful implementation slice.
- Do not introduce unsafe Git command execution.
- Validate public inputs and keep repository paths allowlisted.
- Update documentation when setup, API, configuration, or security behavior changes.
- Run relevant verification commands before declaring completion.
- If verification cannot run, append the exact blocker to `scripts/orbit/full-implementation/progress.md`.

Completion protocol:

- If all acceptance criteria are satisfied, create or update `scripts/orbit/full-implementation/done.md` with evidence.
- Always append an iteration note to `scripts/orbit/full-implementation/progress.md`.
- End your response with:

```text
NEXUS_LOOP_STATUS: CONTINUE | DONE
NEXUS_LOOP_SUMMARY: <single-line operational summary>
```
