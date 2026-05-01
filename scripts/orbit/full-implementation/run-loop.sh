#!/usr/bin/env bash
# Orbit runner for Realtime Git Viewer full implementation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LOOP_DIR="${LOOP_DIR:-${SCRIPT_DIR}}"

MAX_ITERATIONS="${MAX_ITERATIONS:-50}"
RETRY_LIMIT="${RETRY_LIMIT:-3}"
RETRY_BACKOFF_BASE="${RETRY_BACKOFF_BASE:-2}"
ITER_TIMEOUT="${ITER_TIMEOUT:-900}"
LOOP_TIMEOUT="${LOOP_TIMEOUT:-0}"
TOOL_TIMEOUT="${TOOL_TIMEOUT:-120}"
AUTOCOMMIT="${AUTOCOMMIT:-false}"
COMMIT_MSG_PREFIX="${COMMIT_MSG_PREFIX:-loop}"
MAX_LOG_SIZE="${MAX_LOG_SIZE:-5242880}"
STRUCTURED_LOG="${STRUCTURED_LOG:-true}"
SKIP_PREFLIGHT="${SKIP_PREFLIGHT:-false}"
CIRCUIT_BREAKER="${CIRCUIT_BREAKER:-true}"
CIRCUIT_THRESHOLD="${CIRCUIT_THRESHOLD:-3}"
CIRCUIT_COOLDOWN="${CIRCUIT_COOLDOWN:-300}"
DEDUP_WINDOW="${DEDUP_WINDOW:-5}"
CONVERGENCE_WINDOW="${CONVERGENCE_WINDOW:-3}"
CONVERGENCE_THRESHOLD="${CONVERGENCE_THRESHOLD:-0.85}"
CODEX_MODEL="${CODEX_MODEL:-}"
CODEX_SANDBOX="${CODEX_SANDBOX:-workspace-write}"
AUTOCOMMIT_PATHS="${AUTOCOMMIT_PATHS:-apps mock docs scripts package.json pnpm-lock.yaml pnpm-workspace.yaml README.md AGENTS.md .agents}"

STATE_FILE="${LOOP_DIR}/state.env"
PROGRESS_FILE="${LOOP_DIR}/progress.md"
GOAL_FILE="${LOOP_DIR}/goal.md"
PROMPT_FILE="${LOOP_DIR}/codex-prompt.md"
RUNNER_LOG="${LOOP_DIR}/runner.log"
JSONL_LOG="${LOOP_DIR}/runner.jsonl"
LOCK_FILE="${LOOP_DIR}/.run-loop.lock"
CIRCUIT_FILE="${LOOP_DIR}/.circuit-state"
ACTION_LOG="${LOOP_DIR}/actions.log"
DIRTY_BASELINE_FILE="${LOOP_DIR}/dirty-baseline.txt"

cd "${PROJECT_ROOT}"

portable_timeout() {
  local secs="$1"
  shift
  if [[ "${secs}" == "0" ]]; then
    "$@"
  elif command -v timeout >/dev/null 2>&1; then
    timeout "${secs}" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${secs}" "$@"
  else
    perl -e '
      use POSIX ":sys_wait_h";
      my $timeout = shift @ARGV;
      my $pid = fork // die "fork: $!";
      if ($pid == 0) { exec @ARGV; die "exec: $!" }
      local $SIG{ALRM} = sub { kill "TERM", $pid; waitpid($pid, 0); exit 124 };
      alarm $timeout;
      waitpid($pid, 0);
      alarm 0;
      exit($? >> 8);
    ' "${secs}" "$@"
  fi
}

emit_log() {
  [[ "${STRUCTURED_LOG}" == "true" ]] || return 0
  local level="$1"
  local event="$2"
  shift 2
  local ts json
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  json="{\"timestamp\":\"${ts}\",\"level\":\"${level}\",\"event\":\"${event}\",\"iteration\":${ITER:-0}"
  while [[ "$#" -gt 1 ]]; do
    json="${json},\"$1\":\"$2\""
    shift 2
  done
  echo "${json}}" >> "${JSONL_LOG}"
}

atomic_state_write() {
  local next_iteration="$1"
  local status="$2"
  local tmp
  tmp="$(mktemp "${STATE_FILE}.XXXXXX")"
  cat > "${tmp}" <<STATE
CONTRACT_VERSION=1.1.0
NEXT_ITERATION=${next_iteration}
LAST_STATUS=${status}
LAST_UPDATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TOTAL_TOKENS=${TOTAL_TOKENS:-0}
TOTAL_API_CALLS=${TOTAL_API_CALLS:-0}
ESTIMATED_COST_USD=${ESTIMATED_COST_USD:-0}
STATE
  mv "${tmp}" "${STATE_FILE}"
  shasum -a 256 "${STATE_FILE}" | awk '{print $1}' > "${STATE_FILE}.sha256"
}

preflight_check() {
  if [[ "${SKIP_PREFLIGHT}" == "true" ]]; then
    echo "[PREFLIGHT] Skipped (SKIP_PREFLIGHT=true)"
    return 0
  fi
  mkdir -p "${LOOP_DIR}"
  for required in "${GOAL_FILE}" "${PROGRESS_FILE}" "${PROMPT_FILE}" "${LOOP_DIR}/verify.sh"; do
    if [[ ! -f "${required}" ]]; then
      echo "[PREFLIGHT:FAIL] Missing ${required}"
      return 1
    fi
  done
  if ! command -v codex >/dev/null 2>&1; then
    echo "[PREFLIGHT:FAIL] codex CLI is not available on PATH"
    return 1
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "[PREFLIGHT:FAIL] pnpm is not available on PATH"
    return 1
  fi
  local avail_kb
  avail_kb="$(df -k "${LOOP_DIR}" | awk 'NR==2{print $4}')"
  if [[ "${avail_kb}" -lt 102400 ]]; then
    echo "[PREFLIGHT:FAIL] Disk space below 100MB"
    return 1
  fi
  if [[ -f "${LOCK_FILE}" ]]; then
    local lock_pid
    lock_pid="$(cat "${LOCK_FILE}")"
    if kill -0 "${lock_pid}" 2>/dev/null; then
      echo "[PREFLIGHT:FAIL] Active lock held by PID ${lock_pid}"
      return 1
    fi
    rm -f "${LOCK_FILE}"
  fi
  if [[ -d .git/rebase-merge || -d .git/rebase-apply ]]; then
    echo "[PREFLIGHT:FAIL] Git rebase is in progress"
    return 1
  fi
  echo "[PREFLIGHT] All checks passed"
}

capture_dirty_baseline() {
  if [[ -f "${DIRTY_BASELINE_FILE}" ]]; then
    return 0
  fi
  git status --short --untracked-files=all | awk '{print $2}' > "${DIRTY_BASELINE_FILE}"
}

is_dirty_baseline_path() {
  local candidate="$1"
  [[ -s "${DIRTY_BASELINE_FILE}" ]] || return 1
  grep -Fxq "${candidate}" "${DIRTY_BASELINE_FILE}"
}

stage_loop_changes() {
  local path staged_any=false
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    case "${path}" in
      node_modules/*|mock/node_modules/*|mock/dist/*|.DS_Store|scripts/orbit/full-implementation/runner.log*|scripts/orbit/full-implementation/runner.jsonl|scripts/orbit/full-implementation/state.env|scripts/orbit/full-implementation/state.env.sha256|scripts/orbit/full-implementation/.circuit-state|scripts/orbit/full-implementation/actions.log)
        continue
        ;;
    esac
    if is_dirty_baseline_path "${path}"; then
      echo "[AUTOCOMMIT:SKIP] dirty-baseline path: ${path}" | tee -a "${RUNNER_LOG}"
      continue
    fi
    git add -- "${path}"
    staged_any=true
  done < <(git status --short --untracked-files=all ${AUTOCOMMIT_PATHS} | awk '{print $2}')

  [[ "${staged_any}" == "true" ]]
}

run_codex_iteration() {
  local prompt_tmp="$1"
  local output_tmp="$2"
  local cmd=(codex exec --full-auto -s "${CODEX_SANDBOX}" -C "${PROJECT_ROOT}")
  if [[ -n "${CODEX_MODEL}" ]]; then
    cmd+=(-m "${CODEX_MODEL}")
  fi
  cmd+=("$(cat "${prompt_tmp}")")
  portable_timeout "${ITER_TIMEOUT}" "${cmd[@]}" 2>&1 | tee -a "${RUNNER_LOG}" | tee "${output_tmp}"
}

parse_loop_status() {
  local output_file="$1"
  local parsed
  parsed="$(grep -E '^NEXUS_LOOP_STATUS: (CONTINUE|DONE)$' "${output_file}" | tail -1 | awk '{print $2}' || true)"
  if [[ "${parsed}" == "DONE" || "${parsed}" == "CONTINUE" ]]; then
    echo "${parsed}"
    return 0
  fi
  echo "CONTINUE"
}

rotate_log() {
  if [[ -f "${RUNNER_LOG}" ]]; then
    local log_size
    log_size="$(wc -c < "${RUNNER_LOG}" 2>/dev/null || echo 0)"
    if [[ "${log_size}" -gt "${MAX_LOG_SIZE}" ]]; then
      mv "${RUNNER_LOG}" "${RUNNER_LOG}.prev"
      echo "[LOG] Rotated runner.log"
    fi
  fi
}

load_circuit_state() {
  CB_STATE="CLOSED"
  CB_FAIL_COUNT=0
  CB_LAST_SIGNATURE=""
  CB_LAST_UPDATED=0
  if [[ -f "${CIRCUIT_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${CIRCUIT_FILE}"
  fi
}

save_circuit_state() {
  local tmp
  tmp="$(mktemp "${CIRCUIT_FILE}.XXXXXX")"
  cat > "${tmp}" <<CB
CB_STATE=${CB_STATE:-CLOSED}
CB_FAIL_COUNT=${CB_FAIL_COUNT:-0}
CB_LAST_SIGNATURE=${CB_LAST_SIGNATURE:-}
CB_LAST_UPDATED=$(date +%s)
CB
  mv "${tmp}" "${CIRCUIT_FILE}"
}

check_circuit() {
  [[ "${CIRCUIT_BREAKER}" == "true" ]] || return 0
  load_circuit_state
  if [[ "${CB_STATE}" == "OPEN" ]]; then
    local now elapsed
    now="$(date +%s)"
    elapsed=$((now - CB_LAST_UPDATED))
    if [[ "${elapsed}" -ge "${CIRCUIT_COOLDOWN}" ]]; then
      CB_STATE="HALF_OPEN"
      save_circuit_state
      return 0
    fi
    return 1
  fi
}

record_failure() {
  local signature="$1"
  [[ "${CIRCUIT_BREAKER}" == "true" ]] || return 0
  load_circuit_state
  if [[ "${signature}" == "${CB_LAST_SIGNATURE}" ]]; then
    CB_FAIL_COUNT=$((CB_FAIL_COUNT + 1))
  else
    CB_FAIL_COUNT=1
    CB_LAST_SIGNATURE="${signature}"
  fi
  if [[ "${CB_FAIL_COUNT}" -ge "${CIRCUIT_THRESHOLD}" || "${CB_STATE}" == "HALF_OPEN" ]]; then
    CB_STATE="OPEN"
  fi
  save_circuit_state
}

record_success() {
  [[ "${CIRCUIT_BREAKER}" == "true" ]] || return 0
  CB_STATE="CLOSED"
  CB_FAIL_COUNT=0
  CB_LAST_SIGNATURE=""
  save_circuit_state
}

check_dedup() {
  local action="$1"
  touch "${ACTION_LOG}"
  if tail -n "${DEDUP_WINDOW}" "${ACTION_LOG}" | grep -Fxq "${action}"; then
    echo "[DEDUP:BLOCKED] Duplicate action in recent window: ${action}"
    return 1
  fi
  echo "${action}" >> "${ACTION_LOG}"
}

check_convergence() {
  [[ -f "${ACTION_LOG}" ]] || return 0
  local unique_count
  unique_count="$(tail -n "${CONVERGENCE_WINDOW}" "${ACTION_LOG}" | sort -u | wc -l | tr -d ' ')"
  if [[ "${unique_count}" == "1" ]] && [[ "$(wc -l < "${ACTION_LOG}")" -ge "${CONVERGENCE_WINDOW}" ]]; then
    echo "[CONVERGENCE:BLOCKED] Same action repeated for ${CONVERGENCE_WINDOW} iterations"
    return 1
  fi
}

build_iteration_prompt() {
  local prompt_tmp="$1"
  {
    cat "${PROMPT_FILE}"
    echo ""
    echo "## Current iteration"
    echo "${ITER}"
    echo ""
    echo "## Goal"
    sed -n '1,220p' "${GOAL_FILE}"
    echo ""
    echo "## Recent progress"
    tail -120 "${PROGRESS_FILE}"
  } > "${prompt_tmp}"
}

cleanup() {
  rm -f "${LOCK_FILE}"
}
trap cleanup EXIT

if ! preflight_check; then
  echo "NEXUS_LOOP_STATUS: CONTINUE"
  echo "NEXUS_LOOP_SUMMARY: Preflight failed; fix reported issue before running the loop."
  exit 1
fi

echo "$$" > "${LOCK_FILE}"
rotate_log
capture_dirty_baseline

if [[ ! -f "${STATE_FILE}" ]]; then
  atomic_state_write 1 READY
elif [[ -f "${STATE_FILE}.sha256" ]]; then
  EXPECTED_SHA="$(cat "${STATE_FILE}.sha256")"
  ACTUAL_SHA="$(shasum -a 256 "${STATE_FILE}" | awk '{print $1}')"
  if [[ "${EXPECTED_SHA}" != "${ACTUAL_SHA}" ]]; then
    echo "[STATE:WARN] checksum mismatch; running recover.sh"
    bash "${LOOP_DIR}/recover.sh"
  fi
fi

# shellcheck disable=SC1090
source "${STATE_FILE}"
ITER="${NEXT_ITERATION:-1}"
STATUS="${LAST_STATUS:-READY}"

if [[ "${STATUS}" != "DONE" && "${ITER}" -gt "${MAX_ITERATIONS}" ]]; then
  STATUS="BLOCKED"
  atomic_state_write "${ITER}" BLOCKED
  {
    echo ""
    echo "## Iteration ${ITER} - BLOCKED"
    echo "- Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "- MAX_ITER: NEXT_ITERATION=${ITER} exceeds MAX_ITERATIONS=${MAX_ITERATIONS}."
    echo "- Recovery: rerun with a higher MAX_ITERATIONS value, or inspect progress.md and mark DONE if all acceptance criteria are satisfied."
    echo "- Decision: CONTINUE"
  } >> "${PROGRESS_FILE}"
  echo "[MAX_ITER:BLOCKED] NEXT_ITERATION=${ITER} exceeds MAX_ITERATIONS=${MAX_ITERATIONS}" | tee -a "${RUNNER_LOG}"
  echo ""
  echo "NEXUS_LOOP_STATUS: CONTINUE"
  echo "NEXUS_LOOP_SUMMARY: MAX_ITER reached at iteration ${ITER}; raise MAX_ITERATIONS or close the loop with done.md evidence."
  exit 1
fi

while [[ "${STATUS}" != "DONE" && "${ITER}" -le "${MAX_ITERATIONS}" ]]; do
  if ! check_circuit; then
    STATUS="BLOCKED"
    atomic_state_write "${ITER}" BLOCKED
    echo "[CIRCUIT:OPEN] Execution blocked by circuit breaker" | tee -a "${RUNNER_LOG}"
    break
  fi

  if ! check_convergence; then
    STATUS="BLOCKED"
    atomic_state_write "${ITER}" BLOCKED
    break
  fi

  ITER_START="$(date +%s)"
  PROGRESS_SHA="$(shasum -a 256 "${PROGRESS_FILE}" | awk '{print $1}')"
  ACTION="codex-exec-progress-${PROGRESS_SHA}"
  check_dedup "${ACTION}" || {
    STATUS="BLOCKED"
    atomic_state_write "${ITER}" BLOCKED
    break
  }

  prompt_tmp="$(mktemp "${LOOP_DIR}/prompt.${ITER}.XXXXXX")"
  output_tmp="$(mktemp "${LOOP_DIR}/output.${ITER}.XXXXXX")"
  build_iteration_prompt "${prompt_tmp}"

  echo "=== Iteration ${ITER}/${MAX_ITERATIONS} ===" | tee -a "${RUNNER_LOG}"
  EXEC_SUCCESS=false
  LAST_EXIT_CODE=0
  RETRY_COUNT=0

  while [[ "${RETRY_COUNT}" -lt "${RETRY_LIMIT}" ]]; do
    LAST_EXIT_CODE=0
    run_codex_iteration "${prompt_tmp}" "${output_tmp}" || LAST_EXIT_CODE=$?
    TOTAL_API_CALLS=$((TOTAL_API_CALLS + 1))
    if [[ "${LAST_EXIT_CODE}" -eq 0 ]]; then
      EXEC_SUCCESS=true
      record_success
      break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    record_failure "codex_exit_${LAST_EXIT_CODE}"
    if [[ "${RETRY_COUNT}" -lt "${RETRY_LIMIT}" ]]; then
      BACKOFF=$((RETRY_BACKOFF_BASE ** RETRY_COUNT))
      echo "[RETRY] Codex failed with exit=${LAST_EXIT_CODE}; sleeping ${BACKOFF}s" | tee -a "${RUNNER_LOG}"
      sleep "${BACKOFF}"
    fi
  done
  rm -f "${prompt_tmp}"

  if [[ "${EXEC_SUCCESS}" != "true" ]]; then
    rm -f "${output_tmp}"
    STATUS="BLOCKED"
    {
      echo ""
      echo "## Iteration ${ITER} - BLOCKED"
      echo "- Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
      echo "- TOOL_FAILURE: Codex exited with ${LAST_EXIT_CODE}"
      echo "- Decision: CONTINUE"
    } >> "${PROGRESS_FILE}"
    atomic_state_write "${ITER}" BLOCKED
    break
  fi

  VERIFY_RESULT="FAIL"
  if bash "${LOOP_DIR}/verify.sh" 2>&1 | tee -a "${RUNNER_LOG}"; then
    VERIFY_RESULT="PASS"
  fi

  if [[ "${AUTOCOMMIT}" == "true" ]]; then
    stage_loop_changes || true
    if ! git diff --cached --quiet; then
      git commit -m "${COMMIT_MSG_PREFIX}(iter-${ITER}): advance implementation [verify=${VERIFY_RESULT}]"
    fi
  fi

  CODEX_STATUS="$(parse_loop_status "${output_tmp}")"
  rm -f "${output_tmp}"

  if [[ "${CODEX_STATUS}" == "DONE" && -f "${LOOP_DIR}/done.md" && "${VERIFY_RESULT}" == "PASS" ]]; then
    STATUS="DONE"
  else
    STATUS="CONTINUE"
  fi

  ITER_END="$(date +%s)"
  ITER_DURATION=$((ITER_END - ITER_START))
  emit_log "INFO" "iteration_complete" "status" "${STATUS}" "verify" "${VERIFY_RESULT}" "duration" "${ITER_DURATION}" "retries" "${RETRY_COUNT}"

  NEXT_ITER=$((ITER + 1))
  atomic_state_write "${NEXT_ITER}" "${STATUS}"
  echo "[ITER ${ITER}] status=${STATUS} verify=${VERIFY_RESULT} duration=${ITER_DURATION}s"
  ITER="${NEXT_ITER}"
done

if [[ "${STATUS}" == "DONE" ]]; then
  FINAL_STATUS="DONE"
else
  FINAL_STATUS="CONTINUE"
fi

echo ""
echo "NEXUS_LOOP_STATUS: ${FINAL_STATUS}"
echo "NEXUS_LOOP_SUMMARY: Iteration ${ITER}/${MAX_ITERATIONS}, status=${STATUS}"
