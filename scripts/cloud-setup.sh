#!/bin/bash
# Paste this whole file into the cloud environment's "Setup script" field at claude.ai/code.
# It runs as root on Ubuntu 24.04 before Claude starts, and is cached for about 7 days when it
# finishes in under ~5 minutes. Anything here must not depend on the repository's contents.
# Already installed by default: Java 21, Node 22, pnpm, Go, Python with uv, gh, jq, Docker.

set -u
log() { echo "[setup] $*"; }

# 1. Node 24 (the design's Active LTS) beside the preinstalled Node 22.
install_node() {
  local v
  v=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.version | startswith("v24."))][0].version')
  curl -fsSL "https://nodejs.org/dist/${v}/node-${v}-linux-x64.tar.xz" | tar -xJ -C /opt
  rm -rf /opt/node24 && mv "/opt/node-${v}-linux-x64" /opt/node24
  echo 'export PATH=/opt/node24/bin:$PATH' > /etc/profile.d/node24.sh
  export PATH=/opt/node24/bin:$PATH
  corepack enable
  corepack prepare pnpm@latest --activate
  npm install -g firebase-tools lefthook
  # Firebase emulator binaries, so new sessions do not download them
  firebase setup:emulators:firestore >/dev/null
  firebase setup:emulators:database >/dev/null
  firebase setup:emulators:storage >/dev/null
  firebase setup:emulators:ui >/dev/null
  log "node $(node -v), firebase $(firebase --version)"
}

# 2. Secret scanning and static analysis
install_scanners() {
  GOBIN=/usr/local/bin go install github.com/zricethezav/gitleaks/v8@latest && log "gitleaks ok"
  UV_TOOL_BIN_DIR=/usr/local/bin uv tool install semgrep >/dev/null && log "semgrep ok"
}

# 3. System libraries Playwright's Chromium needs, plus ffmpeg for camera test clips
install_system() {
  apt-get update -y >/dev/null
  apt-get install -y ffmpeg >/dev/null
  npx -y playwright@latest install-deps chromium >/dev/null && log "playwright deps ok"
}

install_node & p1=$!
install_scanners & p2=$!
install_system & p3=$!
wait $p1 || log "node step failed"
wait $p2 || log "scanner step failed"
wait $p3 || log "system step failed"
log "done"
exit 0
