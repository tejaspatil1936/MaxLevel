#!/usr/bin/env node
// commit-msg hook: enforces granular, traceable commits.
//   type(scope): summary          header, max 72 chars, lowercase start, no trailing period
//   Refs: EX-10, EX-11            required for feat, fix, test, perf (IDs must exist in docs/req-matrix.json)
//   Size: max 300 changed lines and 12 files, excluding lockfiles, docs, snapshots and binaries.
//   Large-Change: <reason>        trailer that allows a bigger commit (scaffolding, generated code)
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const TYPES = ['feat', 'fix', 'test', 'refactor', 'perf', 'docs', 'build', 'ci', 'chore', 'style', 'revert'];
const SCOPES = ['web', 'api', 'worker', 'shared', 'ui', 'config', 'e2e', 'infra', 'harness', 'docs', 'deps', 'repo'];
const NEEDS_REFS = ['feat', 'fix', 'test', 'perf'];
const MAX_LINES = 300;
const MAX_FILES = 12;
const EXCLUDE = [
  /(^|\/)pnpm-lock\.yaml$/, /(^|\/)package-lock\.json$/, /\.snap$/, /__snapshots__\//, /^docs\//, /\.md$/,
  /^feature_list\.json$/, /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|y4m|mp4|webm|tflite|task|wasm|pdf|xlsx)$/i,
  /(^|\/)generated\//, /^legacy\//,
];
const ID = /^(US-[A-Z]{2}-\d{2}|[A-Z][A-Z0-9]{0,5}-\d{2})$/;

const msg = fs.readFileSync(process.argv[2], 'utf8');
const lines = msg.split('\n').filter((l) => !l.startsWith('#'));
const header = (lines[0] || '').trim();
if (/^(Merge |Revert ")/.test(header) || /^(fixup|squash|amend)! /.test(header)) process.exit(0);

const errors = [];
const m = header.match(/^([a-z]+)\(([a-z0-9-]+)\)(!)?: (.+)$/);
if (!m) {
  errors.push(`Header must look like "type(scope): summary". Got: "${header}"`);
} else {
  const [, type, scope, , subject] = m;
  if (!TYPES.includes(type)) errors.push(`Type "${type}" not allowed. Use: ${TYPES.join(', ')}`);
  if (!SCOPES.includes(scope)) errors.push(`Scope "${scope}" not allowed. Use: ${SCOPES.join(', ')}`);
  if (header.length > 72) errors.push(`Header is ${header.length} chars; max 72.`);
  if (/^[A-Z]/.test(subject)) errors.push('Summary starts lowercase.');
  if (/\.$/.test(subject)) errors.push('Summary has no trailing period.');
  if (lines.length > 1 && lines[1].trim() !== '') errors.push('Leave a blank line after the header.');

  const refsLine = lines.find((l) => /^Refs:\s*/.test(l));
  if (NEEDS_REFS.includes(type) && !refsLine) errors.push(`"${type}" commits need a trailer line: Refs: EX-10, EX-11`);
  if (refsLine) {
    const ids = refsLine.replace(/^Refs:\s*/, '').split(/[,\s]+/).filter(Boolean);
    const bad = ids.filter((id) => !ID.test(id));
    if (bad.length) errors.push(`Refs has malformed IDs: ${bad.join(', ')}`);
    if (fs.existsSync('docs/req-matrix.json')) {
      const matrix = JSON.parse(fs.readFileSync('docs/req-matrix.json', 'utf8'));
      const unknown = ids.filter((id) => ID.test(id) && !matrix[id]);
      if (unknown.length) errors.push(`Refs IDs not in docs/req-matrix.json: ${unknown.join(', ')}`);
    }
  }
}

const large = lines.find((l) => /^Large-Change:\s*\S.{8,}/.test(l));
let numstat = '';
try { numstat = execSync('git diff --cached --numstat', { encoding: 'utf8' }); } catch { /* no index */ }
let changed = 0;
let fileCount = 0;
for (const row of numstat.split('\n').filter(Boolean)) {
  const [a, d, file] = row.split('\t');
  if (EXCLUDE.some((re) => re.test(file))) continue;
  fileCount++;
  changed += (Number(a) || 0) + (Number(d) || 0);
}
if (!large && (changed > MAX_LINES || fileCount > MAX_FILES)) {
  errors.push(
    `Commit too large: ${changed} lines in ${fileCount} files (max ${MAX_LINES} lines, ${MAX_FILES} files). ` +
      'Split it (schema, data access, route, UI, tests), or add "Large-Change: <reason>" for scaffolding or generated code.',
  );
}

if (errors.length) {
  console.error('Commit rejected:\n- ' + errors.join('\n- '));
  process.exit(1);
}
