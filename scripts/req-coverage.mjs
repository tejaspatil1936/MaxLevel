#!/usr/bin/env node
// Requirement coverage.
//   node scripts/req-coverage.mjs --matrix-only   every ID in the design is in docs/req-matrix.json, and nothing else is
//   node scripts/req-coverage.mjs                 plus: every agreed REQ of every LOCKED phase has proof
// Proof by "verify" kind:
//   e2e          ID appears in tests/acceptance/phase-*/ (test titles start with REQ IDs)
//   integration  ID appears in an *.int.test.ts / *.rules.test.ts file, or in tests/
//   unit         ID appears in any *.test.ts(x) file
//   static|manual|infra   ID appears in docs/MANUAL_CHECKS.md
// Phases are enforced only after `locks.mjs acceptance write --phase N`, so earlier prompts are never blocked.
import fs from 'node:fs';
import path from 'node:path';

const DESIGN = 'docs/SYSTEM_DESIGN.md';
const MATRIX = 'docs/req-matrix.json';
const MANUAL = 'docs/MANUAL_CHECKS.md';
const KINDS = ['e2e', 'integration', 'unit', 'static', 'manual', 'infra'];
const matrixOnly = process.argv.includes('--matrix-only');
const fail = (lines) => { console.error(lines.join('\n')); process.exit(1); };

const design = fs.readFileSync(DESIGN, 'utf8');
const designIds = new Map(); // id -> 'agreed' | 'proposed'
for (const m of design.matchAll(/\*\*([A-Z][A-Z0-9]{0,5}-\d{2})( \(Proposed\))?\*\*/g)) designIds.set(m[1], m[2] ? 'proposed' : 'agreed');
for (const m of design.matchAll(/^\|\s*(US-[A-Z]{2}-\d{2})( \(Proposed\))?\s*\|/gm)) designIds.set(m[1], m[2] ? 'proposed' : 'agreed');

if (!fs.existsSync(MATRIX)) fail([`${MATRIX} does not exist yet. Run docs/prompts/01-audit.md.`]);
const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
const errors = [];
for (const [id, st] of designIds) {
  const e = matrix[id];
  if (!e) { errors.push(`missing from matrix: ${id}`); continue; }
  if (!Number.isInteger(e.phase) || e.phase < 0 || e.phase > 8) errors.push(`${id}: phase must be 0-8`);
  if (!KINDS.includes(e.verify)) errors.push(`${id}: verify must be one of ${KINDS.join(', ')}`);
  if (st === 'proposed' && !['proposed', 'approved'].includes(e.status)) errors.push(`${id}: Proposed in the design; status must be "proposed" or "approved" (approved only with a DECISIONS.md line)`);
  if (st === 'agreed' && e.status !== 'agreed') errors.push(`${id}: status must be "agreed"`);
}
for (const id of Object.keys(matrix)) if (!designIds.has(id)) errors.push(`in matrix but not in design: ${id}`);
if (errors.length) fail(['REQ MATRIX FAIL', ...errors]);
console.log(`Matrix OK: ${designIds.size} IDs (${[...designIds.values()].filter((s) => s === 'proposed').length} proposed)`);
if (matrixOnly) process.exit(0);

// ---------- coverage of locked phases ----------
const lock = fs.existsSync('tests/acceptance.lock') ? JSON.parse(fs.readFileSync('tests/acceptance.lock', 'utf8')) : { phases: {} };
const locked = new Set(Object.keys(lock.phases).map(Number));
if (!locked.size) { console.log('Coverage: no phase locked yet, nothing to enforce'); process.exit(0); }

const SKIP = new Set(['node_modules', 'legacy', '.next', 'out', 'dist', '.turbo', '.git', '.verify', 'coverage', 'playwright-report', 'test-results']);
const walk = (dir) =>
  !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const p = path.posix.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const files = walk('.').map((f) => f.replace(/^\.\//, ''));
const read = (f) => fs.readFileSync(f, 'utf8');
const corpus = {
  e2e: files.filter((f) => /^tests\/acceptance\/phase-\d+\/.*\.spec\.ts$/.test(f)).map(read).join('\n'),
  integration: files.filter((f) => /\.(int|rules)\.test\.tsx?$/.test(f) || /^tests\/.*\.(spec|test)\.ts$/.test(f)).map(read).join('\n'),
  unit: files.filter((f) => /\.test\.tsx?$/.test(f)).map(read).join('\n'),
  doc: fs.existsSync(MANUAL) ? read(MANUAL) : '',
};
const has = (text, id) => new RegExp(`(^|[^A-Z0-9-])${id}(?![0-9])`).test(text);

const missing = [];
let checked = 0;
for (const [id, e] of Object.entries(matrix)) {
  if (!locked.has(e.phase) || e.status === 'proposed') continue;
  checked++;
  const where = { e2e: 'e2e', integration: 'integration', unit: 'unit' }[e.verify] || 'doc';
  if (!has(corpus[where], id)) missing.push(`${id} (phase ${e.phase}, ${e.verify}): no ${where === 'doc' ? `entry in ${MANUAL}` : `${where} test naming it`}`);
}
if (missing.length) fail([`REQ COVERAGE FAIL: ${missing.length} of ${checked} uncovered`, ...missing]);
console.log(`Coverage OK: ${checked} REQs in locked phases ${[...locked].sort().join(', ')}`);
