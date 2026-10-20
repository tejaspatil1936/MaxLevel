#!/usr/bin/env bash
# Verification gate, and the only writer of .verify/ (CLAUDE.md decision policy 6).
#   scripts/verify.sh fast               locks, coverage, typecheck, lint, format, unit, integration and rules tests
#   scripts/verify.sh feature <id>       fast, production builds, then only that feature's acceptance file
#   scripts/verify.sh full [--phase N]   fast, production builds, Playwright for every locked phase (up to N),
#                                        regression and smoke tests, production hygiene, Semgrep, gitleaks,
#                                        pnpm audit, knip, and the no-retries / no-fixed-waits checks
# Writes .verify/status.json and .verify/VERIFICATION.md. The last line printed is exactly
# "VERIFY <mode> PASS <full HEAD hash>" or "VERIFY <mode> FAIL".
# Starts the Firebase emulators when they are not running (and leaves them running).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
[ -d /opt/node24/bin ] && export PATH=/opt/node24/bin:$PATH

MODE=${1:-}
FEATURE=""
PHASE=""
usage() { echo 'usage: scripts/verify.sh fast | feature <id> | full [--phase N]'; echo "VERIFY ${MODE:-unknown} FAIL"; exit 2; }
case "$MODE" in
  fast) ;;
  feature) FEATURE=${2:-}; [[ "$FEATURE" =~ ^F-[0-8]\.[0-9]{2}$ ]] || usage ;;
  full)
    if [ -n "${2:-}" ]; then
      [ "$2" = "--phase" ] && [[ "${3:-}" =~ ^[0-8]$ ]] || usage
      PHASE=$3
    fi ;;
  *) usage ;;
esac

OUT=.verify
RES=$OUT/results
rm -rf "$OUT"
mkdir -p "$RES"
HEAD=$(git rev-parse HEAD)
START=$(date +%s)
FAILED=()
export VERIFY_ROOT=$PWD

dirty() { git status --porcelain --untracked-files=all | grep -v ' \.verify/' || true; }
DIRTY_START=$(dirty)

step() {
  local name=$1
  shift
  local t0=$(date +%s)
  printf '== %-22s ' "$name"
  if "$@" > "$RES/$name.log" 2>&1; then
    echo "ok ($(( $(date +%s) - t0 ))s)"
  else
    echo "FAILED ($(( $(date +%s) - t0 ))s, $RES/$name.log)"
    tail -n 40 "$RES/$name.log" | sed 's/^/   | /'
    FAILED+=("$name")
  fi
}

# ---------- steps ----------
deps() { [ -d node_modules ] || pnpm install --frozen-lockfile; }
typecheck() { pnpm turbo run typecheck --output-logs=errors-only && pnpm exec tsc -p tests/tsconfig.json; }
lint() { pnpm turbo run lint --output-logs=errors-only && pnpm exec eslint --max-warnings=0 tests playwright.config.ts scripts; }
format() { pnpm exec prettier --check . --log-level warn; }
emulators() { scripts/emulators.sh start; }

# Runs every package's Vitest suite of one kind with a JSON report per package.
vitest_kind() {
  local kind=$1 cfg=$2 status=0 dir name
  for dir in apps/* packages/*; do
    [ -f "$dir/package.json" ] || continue
    [ -f "$dir/$cfg" ] || continue
    name=$(basename "$dir")
    echo "-- $dir ($kind)"
    (cd "$dir" && pnpm exec vitest run --config "$cfg" --passWithNoTests \
      --reporter=default --reporter=json --outputFile="$VERIFY_ROOT/$RES/vitest-$kind-$name.json") || status=1
  done
  return $status
}
unit() { vitest_kind unit vitest.config.ts; }
integration() { vitest_kind int vitest.int.config.ts; }

web_env() { grep -v '^#' tests/web.env | grep -v '^$'; }
build_prod_web() {
  # Production hygiene: built without emulator variables, the bundle must not contain test-only code.
  env -u NEXT_PUBLIC_AUTH_EMULATOR_HOST -u NEXT_PUBLIC_DATABASE_EMULATOR_HOST \
    $(web_env | grep -v EMULATOR) pnpm --filter @mitaoe/web build || return 1
  if grep -rlE '__e2e|127\.0\.0\.1:9099|__test/' apps/web/out; then
    echo 'Test-only code found in the production web bundle (files above)'
    return 1
  fi
}
build_test() { env $(web_env) pnpm turbo run build --output-logs=errors-only; }
prod_api() {
  # The test-only API must be absent when NODE_ENV=production, even with a secret set.
  local port=4097 pid code
  NODE_ENV=production TEST_API_SECRET=x PORT=$port METADATA_SERVER_DETECTION=none LOG_LEVEL=silent \
    GCLOUD_PROJECT=demo-mitaoe node apps/api/dist/server.js &
  pid=$!
  for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$port/health" > /dev/null && break; read -r -t 0.25 <> <(:) || true; done
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'x-test-secret: x' "http://127.0.0.1:$port/__test/clock")
  kill $pid 2> /dev/null
  echo "GET /__test/clock in production: $code"
  [ "$code" = 404 ]
}

free_ports() {
  # Fresh API, worker and web servers for every run; emulators are reused.
  local p
  for p in 4000 4001 3000; do fuser -k "$p/tcp" > /dev/null 2>&1 || true; done
}
playwright() {
  free_ports
  local runner=()
  command -v xvfb-run > /dev/null && runner=(xvfb-run -a)
  PLAYWRIGHT_JSON_OUTPUT_NAME="$RES/e2e.json" "${runner[@]}" pnpm exec playwright test --reporter=list,json,html \
    --pass-with-no-tests "$@"
}
locked_phase_dirs() {
  node -e '
    const fs = require("fs");
    const lock = fs.existsSync("tests/acceptance.lock") ? JSON.parse(fs.readFileSync("tests/acceptance.lock", "utf8")) : { phases: {} };
    const max = process.argv[1] === "" ? 8 : Number(process.argv[1]);
    console.log(Object.keys(lock.phases).map(Number).filter((p) => p <= max).sort((a, b) => a - b).map((p) => `tests/acceptance/phase-${p}`).join(" "));
  ' "$PHASE"
}
e2e_full() {
  local dirs=$(locked_phase_dirs) d
  for d in tests/regression tests/smoke; do ls "$d"/*.spec.ts > /dev/null 2>&1 && dirs="$dirs $d"; done
  echo "Playwright on: ${dirs:-nothing}"
  [ -n "$dirs" ] || return 0
  # shellcheck disable=SC2086
  playwright $dirs
}
e2e_feature() {
  local file
  file=$(ls tests/acceptance/phase-*/"$FEATURE".spec.ts 2> /dev/null | head -1)
  # A feature proved only by unit or integration tests has no acceptance file; it still needs a passing test.
  [ -n "$file" ] || { echo "No acceptance file for $FEATURE; judged by its unit and integration tests"; return 0; }
  playwright "$file"
}
semgrep_scan() {
  # Application code only; scripts/ is local tooling that never runs in production.
  semgrep scan --config p/default --config p/typescript --error --metrics=off --quiet \
    --exclude 'node_modules' --exclude '*.test.ts' --exclude '*.test.tsx' --exclude '*.stories.tsx' apps packages
}
gitleaks_scan() { gitleaks git --redact --no-banner; }
audit() { pnpm audit --prod --audit-level=high; }
knip_check() { pnpm exec knip --no-progress; }
test_rules() {
  local bad=0
  if ! grep -Eq '^\s*retries:\s*0,' playwright.config.ts || grep -E '^\s*retries:' playwright.config.ts | grep -vqE 'retries:\s*0,'; then
    echo 'playwright.config.ts must set retries: 0 and nothing else'
    bad=1
  fi
  if grep -rnE 'waitForTimeout|\.retries\(|test\.describe\.configure\(\{[^}]*retries' tests apps packages \
    --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=out; then
    echo 'Tests may not use fixed waits or retries (lines above)'
    bad=1
  fi
  return $bad
}

# ---------- run ----------
echo "verify $MODE${FEATURE:+ $FEATURE}${PHASE:+ --phase $PHASE} on ${HEAD:0:12}"
step deps deps
step harness-lock node scripts/locks.mjs harness check
step acceptance-lock node scripts/locks.mjs acceptance check
step coverage node scripts/req-coverage.mjs
step typecheck typecheck
step lint lint
step format format
step emulators emulators
step unit unit
step integration integration

if [ "$MODE" = feature ]; then
  step build build_test
  step e2e-feature e2e_feature
fi
if [ "$MODE" = full ]; then
  step build-prod-web build_prod_web
  step build build_test
  step prod-api prod_api
  step e2e e2e_full
  step semgrep semgrep_scan
  step gitleaks gitleaks_scan
  step audit audit
  step knip knip_check
  step test-rules test_rules
fi

DIRTY_END=$(dirty)

# ---------- report: .verify/status.json and .verify/VERIFICATION.md ----------
FEATURE_OK=$(MODE="$MODE" FEATURE="$FEATURE" PHASE="$PHASE" HEAD="$HEAD" FAILED="${FAILED[*]:-}" \
  DIRTY="$DIRTY_START$DIRTY_END" node --input-type=module - << 'NODE'
import fs from 'node:fs';
import path from 'node:path';

const RES = '.verify/results';
const { MODE, FEATURE, PHASE, HEAD, FAILED, DIRTY } = process.env;
const matrix = JSON.parse(fs.readFileSync('docs/req-matrix.json', 'utf8'));
const features = JSON.parse(fs.readFileSync('feature_list.json', 'utf8'));
const ID = /(?<![A-Z0-9-])(US-[A-Z]{2}-\d{2}|[A-Z][A-Z0-9]{0,5}-\d{2})(?![0-9])/g;
const tests = [];

const add = (title, file, kind, status, evidence = []) => {
  const ids = [...new Set([...title.matchAll(ID)].map((m) => m[1]).filter((id) => matrix[id]))];
  tests.push({ title, file, kind, status, ids, evidence });
};

for (const f of fs.readdirSync(RES).filter((f) => /^vitest-.*\.json$/.test(f))) {
  const kind = f.startsWith('vitest-int-') ? 'integration' : 'unit';
  const j = JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'));
  for (const file of j.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      const status = a.status === 'passed' ? 'pass' : a.status === 'failed' ? 'fail' : 'skip';
      add(a.fullName ?? a.title, path.relative(process.cwd(), file.name), kind, status);
    }
  }
}

const e2eFile = path.join(RES, 'e2e.json');
if (fs.existsSync(e2eFile)) {
  const j = JSON.parse(fs.readFileSync(e2eFile, 'utf8'));
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const status = t.status === 'expected' ? 'pass' : t.status === 'skipped' ? 'skip' : 'fail';
        const evidence = (t.results ?? []).flatMap((r) => (r.attachments ?? []).map((a) => a.path).filter(Boolean));
        add(`${spec.title} [${t.projectName}]`, spec.file ?? file, 'e2e', status, evidence.map((p) => path.relative(process.cwd(), p)));
      }
    }
    for (const s of suite.suites ?? []) walk(s, s.file ?? file);
  };
  for (const s of j.suites ?? []) walk(s, s.file);
}

const featureStatus = {};
for (const f of features) {
  const mine = tests.filter((t) => t.ids.some((id) => f.req_ids.includes(id)) && t.status !== 'skip');
  featureStatus[f.id] = mine.length > 0 && mine.every((t) => t.status === 'pass');
}
const failedSteps = FAILED ? FAILED.split(' ').filter(Boolean) : [];
const featureOk = MODE !== 'feature' || featureStatus[FEATURE] === true;
const clean = !DIRTY.trim();
const result = failedSteps.length === 0 && clean && featureOk ? 'PASS' : 'FAIL';
fs.writeFileSync(
  '.verify/status.json',
  JSON.stringify({ commit: HEAD, mode: MODE, ...(PHASE ? { phase: Number(PHASE) } : {}), ...(FEATURE ? { feature: FEATURE } : {}),
    result, failedSteps, cleanTree: clean, generatedAt: new Date().toISOString(), features: featureStatus }, null, 2) + '\n',
);

const log = (name) => (fs.existsSync(path.join(RES, `${name}.log`)) ? fs.readFileSync(path.join(RES, `${name}.log`), 'utf8') : '');
const harness = /Harness lock OK/.test(log('harness-lock')) ? 'unchanged (lock OK)' : /not locked yet/.test(log('harness-lock')) ? 'not locked yet' : 'CHANGED';
const accept = /Acceptance lock OK/.test(log('acceptance-lock')) ? `unchanged (${log('acceptance-lock').match(/\((.*)\)/)?.[1] ?? 'lock OK'})` : 'CHANGED';
const lock = fs.existsSync('tests/acceptance.lock') ? JSON.parse(fs.readFileSync('tests/acceptance.lock', 'utf8')) : { phases: {} };
const locked = new Set(Object.keys(lock.phases).map(Number));
const manual = fs.existsSync('docs/MANUAL_CHECKS.md') ? fs.readFileSync('docs/MANUAL_CHECKS.md', 'utf8') : '';

const rows = [];
for (const [id, e] of Object.entries(matrix)) {
  const mine = tests.filter((t) => t.ids.includes(id));
  if (!mine.length && !locked.has(e.phase)) continue;
  let res;
  if (mine.length) res = mine.some((t) => t.status === 'fail') ? 'FAIL' : mine.every((t) => t.status === 'skip') ? 'skipped' : 'pass';
  else if (e.status !== 'agreed') res = 'proposed, not built';
  else if (['static', 'manual', 'infra'].includes(e.verify)) res = manual.includes(id) ? 'manual check (docs/MANUAL_CHECKS.md)' : 'MISSING manual entry';
  else res = 'no test in this run';
  const names = mine.map((t) => `${t.status === 'pass' ? '✓' : t.status === 'skip' ? '–' : '✗'} ${t.title.replace(/\|/g, '/')}`).join('<br>');
  const ev = [...new Set(mine.flatMap((t) => t.evidence))].map((p) => `[${path.basename(p)}](../${p})`).join(' ');
  rows.push(`| ${id} | ${e.phase} | ${e.verify} | ${res} | ${names || ' '} | ${ev || ' '} |`);
}
const skipped = tests.filter((t) => t.status === 'skip');
const md = [
  `Harness files: ${harness}. Locked acceptance tests: ${accept}.`,
  '',
  `# Verification: ${MODE}${FEATURE ? ` ${FEATURE}` : ''}${PHASE ? ` --phase ${PHASE}` : ''} — ${result}`,
  '',
  `Commit ${HEAD}. Failed steps: ${failedSteps.length ? failedSteps.join(', ') : 'none'}. Working tree clean: ${clean ? 'yes' : 'no'}.`,
  `Tests: ${tests.filter((t) => t.status === 'pass').length} passed, ${tests.filter((t) => t.status === 'fail').length} failed, ${skipped.length} skipped.`,
  '',
  '## Features',
  '',
  '| Feature | Phase | Passing |',
  '| --- | --- | --- |',
  ...features.filter((f) => !PHASE || f.phase <= Number(PHASE)).map((f) => `| ${f.id} ${f.title} | ${f.phase} | ${featureStatus[f.id] ? 'yes' : 'no'} |`),
  '',
  '## Requirements',
  '',
  '| REQ | Phase | Kind | Result | Tests | Evidence |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows,
  '',
  ...(skipped.length ? ['## Skipped tests', '', ...skipped.map((t) => `- ${t.title} (${t.file})`), ''] : []),
  '## Start the stack for manual checks',
  '',
  '```bash',
  'scripts/stack.sh start     # emulators, base seed, API :4000, worker :4001, web :3000 (built with tests/web.env)',
  'scripts/stack.sh stop',
  '```',
  '',
  'Sign in at http://localhost:3000 with any seeded account from docs/TEST_ENV.md (the Auth emulator account chooser',
  'opens in the sign-in popup). Reseed with `pnpm seed`. Playwright traces: `pnpm exec playwright show-trace <trace.zip>`.',
  '',
].join('\n');
fs.writeFileSync('.verify/VERIFICATION.md', md);
process.stdout.write(featureOk ? 'yes' : 'no');
NODE
)

echo "== took $(( $(date +%s) - START ))s; report in $OUT/VERIFICATION.md"
if [ -n "$DIRTY_START$DIRTY_END" ]; then
  echo "Refusing PASS: the working tree has changes outside .verify/:"
  printf '%s\n%s\n' "$DIRTY_START" "$DIRTY_END" | sort -u | sed '/^$/d; s/^/   /'
fi
[ "$MODE" = feature ] && [ "$FEATURE_OK" != yes ] && echo "Feature $FEATURE is not passing (no passing test names its REQ IDs, or one failed)"
if [ ${#FAILED[@]} -eq 0 ] && [ -z "$DIRTY_START$DIRTY_END" ] && { [ "$MODE" != feature ] || [ "$FEATURE_OK" = yes ]; }; then
  echo "VERIFY $MODE PASS $HEAD"
  exit 0
fi
echo "VERIFY $MODE FAIL"
exit 1
