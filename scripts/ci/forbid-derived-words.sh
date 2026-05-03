#!/usr/bin/env bash
# Fleet observation surface — Layer 2 grep gate.
# Fails the build if any forbidden token (charter v1 §2) is found in the Fleet code surface.
# Run by: make verify
# No escape hatch exists. If a token is needed, supersede the charter (docs/fleet-charter-v2.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Token list — literal copy from docs/fleet-charter.md §2.
# IMPORTANT: identifiers in this script MUST NOT use any of these tokens.
tokens=(
  "ci_status"
  "deployment_status"
  "release_ready"
  "dependency_graph"
  "ai_summary"
  "llm_"
  "openai"
  "anthropic"
  "score_"
  "ranking_"
  "severity_"
  "share_link"
  "public_url"
  "signin"
  "signup"
  "login_"
  "avatar"
  "jwt"
  "oauth"
  "session_token"
)

# Files to check — charter §2 scope.
# Test fixtures, docs, and agent journals are excluded per charter §2 annotation.
target_files=()
while IFS= read -r -d '' f; do
  target_files+=("$f")
done < <(
  find "${PROJECT_ROOT}" \
    \( \
      -path "${PROJECT_ROOT}/apps/api/src/fleet*.js" \
      -o -path "${PROJECT_ROOT}/apps/ui/src/app/components/refscope/Fleet*.tsx" \
      -o -path "${PROJECT_ROOT}/apps/api/schemas/fleet-*.schema.json" \
      -o -path "${PROJECT_ROOT}/apps/ui/src/app/api.ts" \
    \) \
    -print0 2>/dev/null
)

if [[ "${#target_files[@]}" -eq 0 ]]; then
  echo "[fleet-gate] No fleet source files found — gate passes (no files to check)." >&2
  exit 0
fi

found=0
for file in "${target_files[@]}"; do
  for token in "${tokens[@]}"; do
    # grep: -n (line numbers), -F (fixed string, not regex), -s (suppress errors)
    matches=$(grep -nF "${token}" "${file}" 2>/dev/null || true)
    if [[ -n "${matches}" ]]; then
      while IFS= read -r line; do
        echo "[fleet-gate] FORBIDDEN TOKEN '${token}' found in ${file}:${line}" >&2
        found=1
      done <<< "${matches}"
    fi
  done
done

if [[ "${found}" -ne 0 ]]; then
  echo "" >&2
  echo "[fleet-gate] FAIL — forbidden token(s) detected in Fleet code surface." >&2
  echo "[fleet-gate] To resolve: supersede docs/fleet-charter.md via docs/fleet-charter-v2.md." >&2
  echo "[fleet-gate] There is no escape hatch." >&2
  exit 1
fi

echo "[fleet-gate] PASS — no forbidden tokens detected." >&2
exit 0
