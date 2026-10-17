#!/usr/bin/env bash
# Turns the Stop gate on and off for a phase build loop.
#   scripts/loop.sh start <phase>     gate on
#   scripts/loop.sh feature <id>      record the feature being built (attempt counter key)
#   scripts/loop.sh stop              gate off; only if the phase passes on HEAD or BLOCKED.md exists
#   scripts/loop.sh status
# The owner can always switch the gate off by hand: rm .claude/state/loop
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
S=.claude/state
mkdir -p "$S"

phase_done() {
  node -e '
    const fs = require("fs");
    const phase = Number(process.argv[1]);
    const head = require("child_process").execSync("git rev-parse HEAD").toString().trim();
    let st; try { st = JSON.parse(fs.readFileSync(".verify/status.json", "utf8")); } catch { console.log("no .verify/status.json yet"); process.exit(1); }
    const feats = JSON.parse(fs.readFileSync("feature_list.json", "utf8")).filter(f => f.phase === phase);
    const failing = feats.filter(f => st.features?.[f.id] !== true).map(f => f.id);
    if (st.mode !== "full" || st.result !== "PASS" || st.commit !== head) { console.log(`last verify is ${st.mode} ${st.result} on ${String(st.commit).slice(0,8)}, HEAD is ${head.slice(0,8)}`); process.exit(1); }
    if (failing.length) { console.log("failing: " + failing.join(", ")); process.exit(1); }
  ' "$1"
}

case "${1:-status}" in
  start)
    [ -n "${2:-}" ] || { echo "usage: scripts/loop.sh start <phase>"; exit 1; }
    echo "$2" > "$S/loop"; rm -f "$S/feature" "$S/stop-fails"
    echo "Stop gate on for phase $2" ;;
  feature)
    [ -n "${2:-}" ] || { echo "usage: scripts/loop.sh feature <id>"; exit 1; }
    echo "$2" > "$S/feature"; echo "Current feature $2" ;;
  stop)
    [ -f "$S/loop" ] || { echo "No loop running"; exit 0; }
    if [ -f BLOCKED.md ] || phase_done "$(cat "$S/loop")"; then
      rm -f "$S/loop" "$S/feature" "$S/stop-fails"; echo "Stop gate off"
    else
      echo "Refusing: phase $(cat "$S/loop") is not passing on HEAD and BLOCKED.md does not exist"; exit 1
    fi ;;
  status)
    if [ -f "$S/loop" ]; then echo "Loop on: phase $(cat "$S/loop"), feature $(cat "$S/feature" 2>/dev/null || echo none)"; else echo "Loop off"; fi ;;
  *) echo "usage: scripts/loop.sh start <phase> | feature <id> | stop | status"; exit 1 ;;
esac
