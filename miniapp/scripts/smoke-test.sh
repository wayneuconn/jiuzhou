#!/usr/bin/env bash
# Smoke tests for cloud functions.
# Distinguishes runtime bugs (TypeError/ReferenceError) from expected errors (document not found, auth errors).
# Usage: bash scripts/smoke-test.sh [--env <envId>]
# Requires: tcb CLI logged in (`tcb login`)

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_ID="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

PASS=0
FAIL=0
ERRORS=()

invoke() {
  local fn="$1"
  local params="$2"
  if [[ -n "$ENV_ID" ]]; then
    tcb fn invoke "$fn" --params "$params" --env "$ENV_ID" 2>&1
  else
    tcb fn invoke "$fn" --params "$params" 2>&1
  fi
}

# Returns 0 (ok) if output contains a JS runtime error, 1 otherwise.
is_runtime_error() {
  echo "$1" | grep -qiE "(TypeError|ReferenceError|SyntaxError|is not a function|Cannot read propert|is not defined)"
}

check() {
  local label="$1"
  local fn="$2"
  local params="$3"
  # Optional 4th arg: regex that output must NOT match (runtime-error guard is always applied)
  local must_not="${4:-}"

  echo -n "  $label ... "
  local out
  out=$(invoke "$fn" "$params" 2>&1) || true

  if is_runtime_error "$out"; then
    echo "FAIL (runtime error)"
    ERRORS+=("$label: runtime error — $out")
    ((FAIL++))
    return
  fi

  if [[ -n "$must_not" ]] && echo "$out" | grep -qE "$must_not"; then
    echo "FAIL (unexpected output)"
    ERRORS+=("$label: unexpected pattern '$must_not' in: $out")
    ((FAIL++))
    return
  fi

  echo "ok"
  ((PASS++))
}

echo ""
echo "=== Cloud Function Smoke Tests ==="
echo ""

# ── getAnnouncements ────────────────────────────────────────────────────────
echo "getAnnouncements"
check "no params (cold call)" getAnnouncements '{}'

# ── getMatches ──────────────────────────────────────────────────────────────
echo "getMatches"
check "no params" getMatches '{}'

# ── getMatchDetail ──────────────────────────────────────────────────────────
# Expected: document not found / match not found — NOT a TypeError
echo "getMatchDetail"
check "missing matchId" getMatchDetail '{"matchId":"smoke-test-nonexistent-id"}'

# ── registerForMatch ────────────────────────────────────────────────────────
# Expected: auth error (no OPENID in server-side invoke) or match-not-found — NOT TypeError
echo "registerForMatch"
check "missing matchId" registerForMatch '{"matchId":"smoke-test-nonexistent-id"}'

# ── withdrawFromMatch ───────────────────────────────────────────────────────
echo "withdrawFromMatch"
check "missing matchId" withdrawFromMatch '{"matchId":"smoke-test-nonexistent-id"}'

# ── confirmSpot ─────────────────────────────────────────────────────────────
echo "confirmSpot"
check "missing matchId" confirmSpot '{"matchId":"smoke-test-nonexistent-id"}'

# ── updateMatchStatus ───────────────────────────────────────────────────────
echo "updateMatchStatus"
check "setStatus (no auth)" updateMatchStatus '{"matchId":"smoke-test-nonexistent-id","status":"ready"}'
check "assignTeam (no auth)" updateMatchStatus '{"action":"assignTeam","matchId":"smoke-test-nonexistent-id","uid":"u1","team":"A"}'
check "toggleTag (no auth)"  updateMatchStatus '{"action":"toggleTag","matchId":"smoke-test-nonexistent-id","uid":"u1","tags":["late"]}'
check "setCaptain (no auth)" updateMatchStatus '{"action":"setCaptain","matchId":"smoke-test-nonexistent-id","slot":"captainA","uid":"u1"}'

# ── updateProfile ───────────────────────────────────────────────────────────
echo "updateProfile"
check "no params" updateProfile '{}'

# ── getCurrentUser ──────────────────────────────────────────────────────────
echo "getCurrentUser"
check "no params" getCurrentUser '{}'

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo "Failures:"
  for e in "${ERRORS[@]}"; do
    echo "  ✗ $e"
  done
  echo ""
  exit 1
fi
