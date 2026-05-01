# Orbit Full Implementation Loop

This directory contains a Codex-powered Orbit loop for driving Realtime Git Viewer from the current mock/spec state toward a complete implementation.

## Usage

From the repository root:

```sh
bash scripts/orbit/full-implementation/bootstrap.sh
bash scripts/orbit/full-implementation/run-loop.sh
```

Start a fresh loop and archive previous runtime evidence:

```sh
bash scripts/orbit/full-implementation/bootstrap.sh --new-loop
```

Useful overrides:

```sh
MAX_ITERATIONS=60 ITER_TIMEOUT=900 bash scripts/orbit/full-implementation/run-loop.sh
AUTOCOMMIT=true bash scripts/orbit/full-implementation/run-loop.sh
CODEX_MODEL=gpt-5.4 AUTOCOMMIT=true bash scripts/orbit/full-implementation/run-loop.sh
```

Defaults are intentionally conservative:

- `codex exec --full-auto -s workspace-write`
- `AUTOCOMMIT=false`
- `MAX_ITERATIONS=50`
- `ITER_TIMEOUT=900`
- `CIRCUIT_THRESHOLD=3`
- `SKIP_PREFLIGHT=false`

The runner stops only when Codex emits `NEXUS_LOOP_STATUS: DONE`, `done.md` exists, and `verify.sh` passes. It also preserves a dirty-baseline list so `AUTOCOMMIT=true` does not stage unrelated pre-existing edits.

If `state.env` has `NEXT_ITERATION` above `MAX_ITERATIONS`, the runner exits with a `MAX_ITER` block instead of silently reporting a confusing `Iteration N/M` summary. For a continuation loop, raise `MAX_ITERATIONS`; for a new implementation loop, run `bootstrap.sh --new-loop` so `NEXT_ITERATION` starts at `1`.
