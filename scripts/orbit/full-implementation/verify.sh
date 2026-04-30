#!/usr/bin/env bash
# Orbit verification gate for Realtime Git Viewer full implementation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${PROJECT_ROOT}"

PASS=0
FAIL=0

run_check() {
  local name="$1"
  shift
  echo "[CHECK] ${name}"
  if "$@"; then
    echo "[PASS] ${name}"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] ${name}"
    FAIL=$((FAIL + 1))
  fi
}

has_script() {
  local script_name="$1"
  node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['${script_name}'] ? 0 : 1)"
}

run_optional_script() {
  local script_name="$1"
  if has_script "${script_name}"; then
    pnpm "${script_name}"
  else
    echo "[SKIP] package script '${script_name}' is not configured"
  fi
}

run_check "Root package manifest exists" test -f package.json
run_check "Workspace manifest exists" test -f pnpm-workspace.yaml
run_check "Goal contract exists" test -f scripts/orbit/full-implementation/goal.md
run_check "Dependencies install from lockfile" pnpm install --frozen-lockfile
run_check "Build succeeds" pnpm build
run_check "No high-severity dependency advisories" pnpm audit --audit-level high
run_check "Tests pass when configured" run_optional_script test
run_check "Lint passes when configured" run_optional_script lint

echo ""
TOTAL=$((PASS + FAIL))
echo "=== Verification: ${PASS}/${TOTAL} passed, ${FAIL} failed ==="

if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi

