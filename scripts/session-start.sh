#!/usr/bin/env bash
# SessionStart hook: runs whenever a session starts or resumes (cloud and local). Idempotent.
# Whatever it prints is shown to Claude at the start of the session.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Use Node 24 from the cloud setup script, for this hook and every later command in the session.
if [ -d /opt/node24/bin ]; then
  export PATH=/opt/node24/bin:$PATH
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo 'export PATH=/opt/node24/bin:$PATH' >> "$CLAUDE_ENV_FILE"
fi

# Git hooks: without these, commit rules are not enforced.
if command -v lefthook >/dev/null 2>&1; then
  lefthook install >/dev/null 2>&1 || echo "WARNING: lefthook install failed; commits are not being checked."
else
  echo "WARNING: lefthook is not installed; commits are not being checked. See scripts/cloud-setup.sh."
fi

# Dependencies and the Playwright browser matching the project's Playwright version.
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 || echo "pnpm install failed: run it and read the error."
  if pnpm exec playwright --version >/dev/null 2>&1; then
    pnpm exec playwright install chromium >/dev/null 2>&1 \
      || echo "Playwright browser download failed: check the environment's allowed domains (README section 1)."
  fi
fi

echo "Node $(node -v 2>/dev/null). $(bash scripts/loop.sh status 2>/dev/null || echo 'Loop off')."
[ -f BLOCKED.md ] && echo "BLOCKED.md exists: read it before doing anything else."
exit 0
