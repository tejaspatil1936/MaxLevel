#!/usr/bin/env bash
# Local production stack for manual checks and the qa-explorer (docs/TEST_ENV.md).
#   scripts/stack.sh start   build (web with tests/web.env), start emulators, load the base seed, start API :4000,
#                            worker :4001 and web :3000 in the background
#   scripts/stack.sh stop    stop API, worker and web (emulators keep running; scripts/emulators.sh stop ends them)
#   scripts/stack.sh status
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
LOGS=.stack
mkdir -p "$LOGS"
stack_env() { grep -v '^#' tests/stack.env | grep -v '^$'; }
wait_url() { for _ in $(seq 1 120); do curl -sf "$1" > /dev/null && return 0; read -r -t 0.5 <> <(:) || true; done; echo "timeout waiting for $1"; return 1; }

case "${1:-status}" in
  start)
    env $(grep -v '^#' tests/web.env | grep -v '^$') pnpm turbo run build --output-logs=errors-only
    scripts/emulators.sh start
    for p in 4000 4001 3000; do fuser -k "$p/tcp" > /dev/null 2>&1 || true; done
    nohup env $(stack_env) PORT=4000 node apps/api/dist/server.js > "$LOGS/api.log" 2>&1 &
    nohup env $(stack_env) PORT=4001 node apps/worker/dist/server.js > "$LOGS/worker.log" 2>&1 &
    nohup node scripts/serve-web.mjs > "$LOGS/web.log" 2>&1 &
    wait_url http://127.0.0.1:4000/health
    wait_url http://127.0.0.1:4001/health
    wait_url http://localhost:3000/
    curl -sf -X POST -H 'content-type: application/json' -H "x-test-secret: $(grep TEST_API_SECRET tests/stack.env | cut -d= -f2)" \
      -d '{"seed":"base"}' http://127.0.0.1:4000/__test/reset > /dev/null
    echo "Stack up: web http://localhost:3000, API http://localhost:4000, worker http://localhost:4001 (base seed loaded)" ;;
  stop)
    for p in 4000 4001 3000; do fuser -k "$p/tcp" > /dev/null 2>&1 || true; done
    echo "Stack stopped (emulators still running)" ;;
  status)
    for u in http://127.0.0.1:4000/health http://127.0.0.1:4001/health http://localhost:3000/; do
      curl -sf "$u" > /dev/null && echo "up   $u" || echo "down $u"
    done
    scripts/emulators.sh status ;;
  *) echo 'usage: scripts/stack.sh start | stop | status'; exit 1 ;;
esac
