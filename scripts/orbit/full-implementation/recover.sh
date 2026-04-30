#!/usr/bin/env bash
# Orbit recovery script. Rebuilds state.env from progress.md evidence.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOOP_DIR="${LOOP_DIR:-${SCRIPT_DIR}}"
PROGRESS_FILE="${LOOP_DIR}/progress.md"
STATE_FILE="${LOOP_DIR}/state.env"

if [[ ! -f "${PROGRESS_FILE}" ]]; then
  echo "[RECOVER:FAIL] Missing ${PROGRESS_FILE}"
  exit 1
fi

LATEST_ITER="$(grep -oE 'Iteration [0-9]+' "${PROGRESS_FILE}" | grep -oE '[0-9]+' | tail -1 || true)"
if [[ -z "${LATEST_ITER}" ]]; then
  LATEST_ITER=0
fi

TAIL_CONTENT="$(tail -40 "${PROGRESS_FILE}")"
if echo "${TAIL_CONTENT}" | grep -q "Decision: DONE"; then
  RECOVERED_STATUS="DONE"
elif echo "${TAIL_CONTENT}" | grep -qiE "BLOCKED|FAIL|TOOL_FAILURE|CIRCUIT_OPEN"; then
  RECOVERED_STATUS="BLOCKED"
else
  RECOVERED_STATUS="CONTINUE"
fi

NEXT_ITER=$((LATEST_ITER + 1))
state_tmp="$(mktemp "${STATE_FILE}.XXXXXX")"
cat > "${state_tmp}" <<STATE
CONTRACT_VERSION=1.1.0
NEXT_ITERATION=${NEXT_ITER}
LAST_STATUS=${RECOVERED_STATUS}
LAST_UPDATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
RECOVERED_FROM=progress_evidence
TOTAL_TOKENS=0
TOTAL_API_CALLS=0
ESTIMATED_COST_USD=0
STATE
mv "${state_tmp}" "${STATE_FILE}"
shasum -a 256 "${STATE_FILE}" | awk '{print $1}' > "${STATE_FILE}.sha256"

{
  echo ""
  echo "## Recovery - $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- Latest iteration found: ${LATEST_ITER}"
  echo "- Recovered status: ${RECOVERED_STATUS}"
  echo "- Rebuilt state.env with NEXT_ITERATION=${NEXT_ITER}"
  echo "- Decision: CONTINUE"
} >> "${PROGRESS_FILE}"

echo "[RECOVER:OK] state.env rebuilt from progress evidence"

