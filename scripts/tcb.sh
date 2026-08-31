#!/usr/bin/env bash
# CloudBase CLI, pinned to this project's own credential store.
#
# tcb keeps exactly one login in ~/.config/.cloudbase, so logging in for
# another project silently knocks this one out. Overriding HOME gives each
# project its own store, and the two never see each other.
#
#   ./scripts/tcb.sh login                       # once, per machine
#   ./scripts/tcb.sh fn deploy getLeaderboard -e "$JIUZHOU_ENV" --force
set -euo pipefail
export HOME="${TCB_HOME_ROOT:-$HOME/.tcbhome}/jiuzhou"
mkdir -p "$HOME"
exec command tcb "$@"
