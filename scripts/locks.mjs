#!/usr/bin/env node
// Checksum locks for acceptance tests and harness files.
//   node scripts/locks.mjs acceptance write --phase N   lock tests/acceptance/phase-N/**/*.spec.ts (new phases only)
//   node scripts/locks.mjs acceptance check             fail if any locked test changed, vanished or was added
//   node scripts/locks.mjs harness write                freeze harness files (only if no lock exists yet)
//   node scripts/locks.mjs harness check                fail if a frozen harness file changed
// Only the owner unlocks: edit or delete the lock file by hand.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ACCEPT_LOCK = 'tests/acceptance.lock';
const HARNESS_LOCK = '.claude/harness.lock';
const HARNESS_FILES = [
  'scripts/verify.sh',
  'scripts/req-coverage.mjs',
  'scripts/locks.mjs',
  'scripts/check-commit.mjs',
  'scripts/loop.sh',
  'scripts/session-start.sh',
  'lefthook.yml',
  'docs/req-matrix.json',
  '.github/workflows/ci.yml',
];

const [kind, action, ...rest] = process.argv.slice(2);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const walk = (dir) =>
  !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.posix.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const fail = (msg) => { console.error(msg); process.exit(1); };

if (kind === 'acceptance') {
  const lock = readJson(ACCEPT_LOCK, { phases: {} });
  if (action === 'write') {
    const i = rest.indexOf('--phase');
    const phase = i >= 0 ? rest[i + 1] : undefined;
    if (!phase || !/^\d+$/.test(phase)) fail('usage: locks.mjs acceptance write --phase N');
    if (lock.phases[phase]) fail(`Phase ${phase} is already locked. Only the owner can change it.`);
    const files = walk(`tests/acceptance/phase-${phase}`).filter((f) => f.endsWith('.spec.ts')).sort();
    if (!files.length) fail(`No spec files in tests/acceptance/phase-${phase}/`);
    lock.phases[phase] = Object.fromEntries(files.map((f) => [f, sha(f)]));
    fs.writeFileSync(ACCEPT_LOCK, JSON.stringify(lock, null, 2) + '\n');
    console.log(`Locked ${files.length} acceptance files for phase ${phase}`);
  } else if (action === 'check') {
    const problems = [];
    for (const [phase, files] of Object.entries(lock.phases)) {
      for (const [f, h] of Object.entries(files)) {
        if (!fs.existsSync(f)) problems.push(`missing: ${f}`);
        else if (sha(f) !== h) problems.push(`changed: ${f}`);
      }
      for (const f of walk(`tests/acceptance/phase-${phase}`)) if (!files[f]) problems.push(`added to locked phase ${phase}: ${f}`);
    }
    if (problems.length) fail('LOCKED ACCEPTANCE TESTS CHANGED\n' + problems.join('\n'));
    console.log(`Acceptance lock OK (${Object.keys(lock.phases).length} phase(s) locked)`);
  } else fail('usage: locks.mjs acceptance write --phase N | check');
} else if (kind === 'harness') {
  if (action === 'write') {
    if (fs.existsSync(HARNESS_LOCK)) fail('Harness lock exists. Only the owner can change it.');
    const files = HARNESS_FILES.filter((f) => fs.existsSync(f));
    const missing = HARNESS_FILES.filter((f) => !fs.existsSync(f));
    if (missing.length) fail('Create these first: ' + missing.join(', '));
    fs.writeFileSync(HARNESS_LOCK, JSON.stringify({ files: Object.fromEntries(files.map((f) => [f, sha(f)])) }, null, 2) + '\n');
    console.log(`Harness locked (${files.length} files)`);
  } else if (action === 'check') {
    const lock = readJson(HARNESS_LOCK, null);
    if (!lock) { console.log('Harness not locked yet'); process.exit(0); }
    const changed = Object.entries(lock.files).filter(([f, h]) => !fs.existsSync(f) || sha(f) !== h).map(([f]) => f);
    if (changed.length) fail('HARNESS CHANGED\n' + changed.join('\n'));
    console.log('Harness lock OK');
  } else fail('usage: locks.mjs harness write | check');
} else fail('usage: locks.mjs <acceptance|harness> <write|check> [--phase N]');
