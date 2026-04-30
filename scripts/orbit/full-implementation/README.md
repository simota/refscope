# Orbit Full Implementation Loop

This directory contains a Codex-powered Orbit loop for driving Realtime Git Viewer from the current mock/spec state toward a complete implementation.

## Usage

From the repository root:

```sh
bash scripts/orbit/full-implementation/run-loop.sh
```

Useful overrides:

```sh
MAX_ITERATIONS=10 ITER_TIMEOUT=900 bash scripts/orbit/full-implementation/run-loop.sh
AUTOCOMMIT=true bash scripts/orbit/full-implementation/run-loop.sh
```

Defaults are intentionally conservative:

- `EXEC_ENGINE=codex`
- `AUTOCOMMIT=false`
- `MAX_ITERATIONS=20`
- `ITER_TIMEOUT=900`
- `CIRCUIT_THRESHOLD=3`

The runner stops only when `done.md` exists and `verify.sh` passes, or when a guardrail blocks execution.

