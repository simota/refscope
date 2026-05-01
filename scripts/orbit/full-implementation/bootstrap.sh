#!/usr/bin/env bash
# Bootstrap the Codex-powered Orbit loop without overwriting existing evidence.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LOOP_DIR="${LOOP_DIR:-${SCRIPT_DIR}}"
STATE_FILE="${LOOP_DIR}/state.env"
PROGRESS_FILE="${LOOP_DIR}/progress.md"
RESET_LOOP=false

case "${1:-}" in
  --new-loop|--reset-loop)
    RESET_LOOP=true
    ;;
  "" )
    ;;
  * )
    echo "Usage: $0 [--new-loop|--reset-loop]"
    exit 2
    ;;
esac

cd "${PROJECT_ROOT}"
mkdir -p "${LOOP_DIR}"

if [[ "${RESET_LOOP}" == "true" ]]; then
  archive_dir="${LOOP_DIR}/archive/$(date -u +"%Y%m%dT%H%M%SZ")"
  mkdir -p "${archive_dir}"
  for artifact in \
    progress.md \
    done.md \
    state.env \
    state.env.sha256 \
    runner.log \
    runner.log.prev \
    runner.jsonl \
    actions.log \
    dirty-baseline.txt \
    .circuit-state; do
    if [[ -e "${LOOP_DIR}/${artifact}" ]]; then
      mv "${LOOP_DIR}/${artifact}" "${archive_dir}/${artifact}"
    fi
  done
  echo "[BOOTSTRAP] Archived previous runtime state to ${archive_dir}"
fi

if [[ ! -f "${PROGRESS_FILE}" ]]; then
  cat > "${PROGRESS_FILE}" <<PROGRESS
# Orbit Progress

## Bootstrap - $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- Initialized Codex full-implementation loop.
- Runtime state: $([[ "${RESET_LOOP}" == "true" ]] && echo "new loop reset" || echo "existing loop bootstrap")
- Decision: CONTINUE
PROGRESS
fi

if [[ ! -f "${STATE_FILE}" ]]; then
  state_tmp="$(mktemp "${STATE_FILE}.XXXXXX")"
  cat > "${state_tmp}" <<STATE
CONTRACT_VERSION=1.1.0
NEXT_ITERATION=1
LAST_STATUS=READY
LAST_UPDATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TOTAL_TOKENS=0
TOTAL_API_CALLS=0
ESTIMATED_COST_USD=0
STATE
  mv "${state_tmp}" "${STATE_FILE}"
  shasum -a 256 "${STATE_FILE}" | awk '{print $1}' > "${STATE_FILE}.sha256"
fi

chmod +x "${LOOP_DIR}/run-loop.sh" "${LOOP_DIR}/recover.sh" "${LOOP_DIR}/verify.sh"

echo "[BOOTSTRAP:OK] Codex Orbit loop is ready"
echo "NEXUS_LOOP_STATUS: READY"
echo "NEXUS_LOOP_SUMMARY: Run bash scripts/orbit/full-implementation/run-loop.sh"
