#!/usr/bin/env bash
# Stop hook: during a build loop, Claude may stop only when the fast gate passes.
# Inactive outside a loop (no .claude/state/loop), so audits and chats are never blocked.
# Never exits early on stop_hook_active; the attempt counter is the escape valve.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
S=.claude/state
[ -f "$S/loop" ] || exit 0
[ -f BLOCKED.md ] && exit 0
[ -x scripts/verify.sh ] || exit 0

key=$(cat "$S/feature" 2>/dev/null || git rev-parse HEAD 2>/dev/null || echo none)
out=$(scripts/verify.sh fast 2>&1); code=$?
if [ "$code" -eq 0 ]; then rm -f "$S/stop-fails"; exit 0; fi

read -r prev_key prev_n < "$S/stop-fails" 2>/dev/null || { prev_key=""; prev_n=0; }
if [ "$prev_key" = "$key" ]; then n=$((prev_n + 1)); else n=1; fi
echo "$key $n" > "$S/stop-fails"

if [ "$n" -ge 5 ]; then
  {
    echo "# BLOCKED"
    echo
    echo "The fast gate failed $n times in a row on $key."
    echo
    echo '```'
    printf '%s\n' "$out" | tail -n 40
    echo '```'
  } > BLOCKED.md
  echo "Fast gate failed $n times on $key. Wrote BLOCKED.md; stopping is now allowed." >&2
  exit 0
fi

echo "Fast gate failed (attempt $n of 5 on $key). Fix it before stopping:" >&2
printf '%s\n' "$out" | tail -n 30 >&2
exit 2
