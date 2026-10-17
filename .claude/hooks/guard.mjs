#!/usr/bin/env node
// PreToolUse guard. Blocks writes to protected paths and unsafe git usage.
// Exit 2 = block (stderr goes back to Claude). Exit 0 = allow.
// Shell checks are heuristics; scripts/locks.mjs checksums in verify.sh and CI are the backstop.
import fs from 'node:fs';
import path from 'node:path';

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const tool = input.tool_name || '';
const ti = input.tool_input || {};

function block(msg) {
  process.stderr.write(
    `Blocked by repo guard: ${msg}\n` +
      'See CLAUDE.md. If this is genuinely needed, record it in TEST_CHANGE_REQUESTS.md or BLOCKED.md for the owner.\n',
  );
  process.exit(2);
}
const rel = (p) => path.relative(root, path.resolve(root, p)).split(path.sep).join('/');
const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); } catch { return null; }
};

// Paths Claude never writes. A trailing slash means the whole directory.
const protectedPaths = [
  'legacy/',
  'docs/SYSTEM_DESIGN.md',
  '.claude/hooks/',
  '.claude/settings.json',
  '.claude/harness.lock',
  '.claude/state/',
  '.verify/',
  'tests/acceptance.lock',
];
// Files frozen by `node scripts/locks.mjs harness write`.
const harness = readJson('.claude/harness.lock');
if (harness?.files) protectedPaths.push(...Object.keys(harness.files));
// Locked acceptance phases: the whole phase folder. Page objects in tests/acceptance/pages/ stay editable.
const accept = readJson('tests/acceptance.lock');
if (accept?.phases) for (const ph of Object.keys(accept.phases)) protectedPaths.push(`tests/acceptance/phase-${ph}/`);

const isProtected = (r) =>
  protectedPaths.some((p) => (p.endsWith('/') ? r === p.slice(0, -1) || r.startsWith(p) : r === p));

// ---------- file-editing tools ----------
if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const target = ti.file_path || ti.notebook_path;
  if (!target) process.exit(0);
  const r = rel(target);
  if (r.startsWith('..')) process.exit(0); // outside the repo (scratch files)
  if (isProtected(r)) block(`${r} is protected.`);
  process.exit(0);
}

if (tool !== 'Bash') process.exit(0);
const raw = String(ti.command || '');

// Remove heredoc bodies and quoted strings so commit messages cannot trip the flag checks.
const stripped = raw
  .replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\s*\1\b/g, ' ')
  .replace(/"(?:\\.|[^"\\])*"/g, '""')
  .replace(/'[^']*'/g, "''");

const G = '[^;&|\\n]*'; // stay inside one simple command
const rules = [
  [/\b(LEFTHOOK|HUSKY)\s*=\s*0\b|LEFTHOOK_EXCLUDE|core\.hooksPath|\blefthook\s+uninstall\b|\.git\/hooks/, 'git hooks may not be bypassed.'],
  [new RegExp(`\\bgit\\b${G}\\badd\\b${G}(\\s-A\\b|\\s--all\\b|\\s-u\\b|\\s--update\\b|\\s\\.(?=\\s|$)|\\s\\*(?=\\s|$))`),
    'stage explicit paths: git add <file> ... (never -A, --all, -u, . or *).'],
  [new RegExp(`\\bgit\\b${G}\\bcommit\\b${G}(\\s--no-verify\\b|\\s-n\\b|\\s--amend\\b|\\s--all\\b|\\s-[a-zA-Z]*a[a-zA-Z]*\\b)`),
    'commits must run hooks and be new commits: no -a, --amend or --no-verify.'],
  [new RegExp(`\\bgit\\b${G}\\bpush\\b${G}(\\s--force\\b|\\s--force-with-lease\\b|\\s-f\\b|\\s--no-verify\\b|\\s--delete\\b|\\s--mirror\\b|\\s:\\S)`),
    'no force, delete or hook-skipping pushes.'],
  [new RegExp(`\\bgit\\b${G}\\bpush\\b${G}(\\s|:)(main|master)\\b`), 'never push to main; open a pull request.'],
  [new RegExp(`\\bgit\\b${G}\\b(rebase|filter-branch|filter-repo|update-ref)\\b`), 'history rewriting is not allowed.'],
  [new RegExp(`\\bgit\\b${G}\\breset\\b${G}--hard\\b`), 'git reset --hard is not allowed.'],
  [new RegExp(`\\bgit\\b${G}\\bclean\\b${G}\\s-[a-zA-Z]*f`), 'git clean -f is not allowed.'],
  [new RegExp(`\\bgit\\b${G}\\bbranch\\b${G}\\s-D\\b`), 'force-deleting branches is not allowed.'],
  [new RegExp(`\\bgit\\b${G}\\bstash\\b${G}\\b(drop|clear)\\b`), 'dropping stashes is not allowed.'],
  [new RegExp(`\\bgit\\b${G}\\b(checkout|restore)\\b${G}\\s(--\\s+)?\\.(?=\\s|$)`), 'discarding all working-tree changes is not allowed.'],
  [/\bfirebase\s+deploy\b|\bgcloud\s+run\s+deploy\b|\bgcloud\b[^;&|\n]*\s(delete|deploy)\b|\bvercel\b[^;&|\n]*--prod\b|\bterraform\s+(apply|destroy)\b|\b(npm|pnpm|yarn)\s+publish\b/,
    'deploys, publishes and cloud deletions belong to the owner.'],
  [/\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(\/|~|\$HOME|\.\.)(\s|$|\/)/, 'recursive delete outside the repo is not allowed.'],
];
for (const [re, msg] of rules) if (re.test(stripped)) block(msg);

// Shell commands that would write to a protected path.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const L = `(?:^|[\\s"'=/])(?:\\./)?`;
const R = `(?=[\\s"'/;&|)]|$)`;
for (const p of protectedPaths) {
  const P = esc(p.replace(/\/$/, ''));
  const writeOps = [
    new RegExp(`>{1,2}\\s*["']?(?:\\./)?(?:\\S*/)?${P}${R}`),
    new RegExp(`\\btee\\b${G}${L}${P}${R}`),
    new RegExp(`\\b(sed|perl)\\b${G}\\s-[a-zA-Z]*i${G}${L}${P}${R}`),
    new RegExp(`\\b(mv|cp|rm|rmdir|truncate|chmod|chown|ln|install|touch|unlink|dd|rsync|shred)\\b${G}${L}${P}${R}`),
    new RegExp(`\\bgit\\s+(checkout|restore|rm|mv|stash|apply|am)\\b${G}${L}${P}${R}`),
    new RegExp(`\\b(node|python3?|ruby)\\b${G}\\s-(e|c)\\b${G}${P}`),
    new RegExp(`\\bfind\\b${G}${L}${P}${R}${G}(-delete|-exec)`),
  ];
  if (writeOps.some((re) => re.test(raw))) block(`shell command would modify protected path ${p}.`);
}
process.exit(0);
