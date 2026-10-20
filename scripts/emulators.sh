#!/usr/bin/env bash
# Runs the Firebase CLI for the local emulators.
#   scripts/emulators.sh start          start all emulators in the background (no-op if already up); waits until ready
#   scripts/emulators.sh run            run them in the foreground (Playwright webServer)
#   scripts/emulators.sh stop           stop them
#   scripts/emulators.sh status         print which emulator ports are open
#   scripts/emulators.sh exec "<cmd>"   run a command with the emulators up, then stop them
# firebase-tools sends every request through HTTPS_PROXY and ignores NO_PROXY, so its calls to the emulators on
# 127.0.0.1 would go to the session proxy. The emulators only ever talk to localhost (demo-mitaoe is offline by
# design), so the proxy variables are cleared for these processes only.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PORTS=(9099 8080 9000 9199)
LOG=.emulators.log
PIDFILE=.emulators.pid
fb() { env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy firebase --project demo-mitaoe "$@"; }
up() { for p in "${PORTS[@]}"; do (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null || return 1; done; }
# Emulator JVMs can outlive a killed CLI and keep their ports; stop them all by name.
kill_all() {
  # Bracketed first letters keep the patterns from matching a shell whose command line merely contains them.
  pkill -f '[f]irebase --project demo-mitaoe emulators:start' 2>/dev/null || true
  pkill -f '[e]mulators/(cloud-firestore-emulator|firebase-database-emulator|cloud-storage-rules-runtime)' 2>/dev/null || true
  rm -f "$PIDFILE"
}

case "${1:-status}" in
  start)
    if up; then echo "Emulators already running"; exit 0; fi
    kill_all
    nohup env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
      firebase --project demo-mitaoe emulators:start --only auth,firestore,database,storage > "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 240); do
      if grep -q "All emulators ready" "$LOG" 2>/dev/null; then echo "Emulators ready"; exit 0; fi
      if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "Emulators failed to start:"; tail -20 "$LOG"; exit 1; fi
      read -r -t 0.5 <> <(:) || true
    done
    echo "Emulators did not become ready in 120 s"; tail -20 "$LOG"; exit 1 ;;
  run)
    exec env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
      firebase --project demo-mitaoe emulators:start --only auth,firestore,database,storage ;;
  stop)
    kill_all
    echo "Emulators stopped" ;;
  status)
    for p in "${PORTS[@]}"; do (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && echo "$p open" || echo "$p closed"; done ;;
  exec)
    shift; fb emulators:exec --only auth,firestore,database,storage "$*" ;;
  *) echo 'usage: scripts/emulators.sh start | run | stop | status | exec "<cmd>"'; exit 1 ;;
esac
