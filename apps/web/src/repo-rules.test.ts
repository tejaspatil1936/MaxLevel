// Static rules for the web app and the repository, checked on every run (docs/MANUAL_CHECKS.md lists them too).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WEB = join(ROOT, 'apps/web');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SKIP = new Set([
  'node_modules',
  '.next',
  'out',
  '.git',
  '.turbo',
  'legacy',
  'dist',
  'test-results',
  'playwright-report',
  '.verify',
  'storybook-static',
  '.stack',
]);
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    if (SKIP.has(e)) return [];
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('static export', () => {
  it('WEB-01 next.config exports static files with unoptimized images', () => {
    const cfg = read('apps/web/next.config.ts');
    expect(cfg).toMatch(/output:\s*'export'/);
    expect(cfg).toMatch(/images:\s*\{\s*unoptimized:\s*true\s*\}/);
  });

  it('WEB-01 no route handlers, middleware or server actions exist', () => {
    const files = walk(WEB);
    const offenders = files.filter((f) => /[\\/](route|middleware|proxy)\.(t|j)sx?$/.test(f));
    const serverActions = files.filter(
      (f) => /\.(t|j)sx?$/.test(f) && /^\s*['"]use server['"]/m.test(readFileSync(f, 'utf8')),
    );
    expect([...offenders, ...serverActions].map((f) => relative(ROOT, f))).toEqual([]);
  }, 15_000);

  it('WEB-02 no dynamic path segments; IDs travel in search params', () => {
    const dirs = walk(join(WEB, 'app')).map((f) => relative(join(WEB, 'app'), f));
    expect(dirs.filter((p) => /\[[^\]]+\]/.test(p))).toEqual([]);
  });
});

describe('security headers', () => {
  const vercel = JSON.parse(read('apps/web/vercel.json')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const all = Object.fromEntries(
    vercel.headers.find((h) => h.source === '/(.*)')!.headers.map((h) => [h.key, h.value]),
  );

  it('WEB-04 vercel.json sets CSP, Permissions-Policy for the camera, Referrer-Policy and HSTS', () => {
    expect(all['Content-Security-Policy']).toContain("default-src 'self'");
    expect(all['Permissions-Policy']).toContain('camera=(self)');
    // Voice detection needs the microphone on the app's own pages.
    expect(all['Permissions-Policy']).toContain('microphone=(self)');
    expect(all['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(all['Strict-Transport-Security']).toMatch(/max-age=\d{8,}/);
  });

  it('WEB-04 the CSP allows WebAssembly for MediaPipe but never eval, objects or framing', () => {
    const csp = all['Content-Security-Policy']!;
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toMatch(/'unsafe-eval'/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('PR-15 REL-05 the CSP lets Realtime Database connect over WebSocket and its long-polling fallback', () => {
    const directive = (name: string) =>
      all['Content-Security-Policy']!.split(';')
        .map((d) => d.trim().split(/\s+/))
        .find(([n]) => n === name)!
        .slice(1);
    for (const host of ['https://*.firebaseio.com', 'https://*.firebasedatabase.app']) {
      expect(directive('script-src'), 'long-polling loads scripts').toContain(host);
      expect(directive('frame-src'), 'long-polling sends through an iframe').toContain(host);
      expect(directive('connect-src')).toContain(host);
      expect(directive('connect-src')).toContain(host.replace('https:', 'wss:'));
    }
  });
});

describe('data fetching', () => {
  it('WEB-05 query keys are built only by the org-scoped key helper', () => {
    const src = walk(join(WEB, 'src'))
      .concat(walk(join(WEB, 'app')))
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'));
    const raw = src.filter((f) => !f.endsWith('query-keys.ts') && /queryKey:\s*\[/.test(readFileSync(f, 'utf8')));
    expect(raw.map((f) => relative(ROOT, f))).toEqual([]);
    const direct = src.filter((f) => /\bfetch\(/.test(readFileSync(f, 'utf8')) && !/src[\\/]lib[\\/]/.test(f));
    expect(
      direct.map((f) => relative(ROOT, f)),
      'components call the API through src/lib',
    ).toEqual([]);
  });
});

describe('accessibility tooling', () => {
  it('A11Y-23 interface text must come from the translation layer', () => {
    expect(read('packages/config/eslint.config.js')).toMatch(/'react\/jsx-no-literals':\s*\[\s*'error'/);
    expect(read('apps/web/eslint.config.js')).toContain('...react');
    expect(existsSync(join(WEB, 'src/i18n/en.ts'))).toBe(true);
  });

  it('A11Y-21 the axe helper fails on serious and critical issues and CI runs the suite', () => {
    const axe = read('tests/acceptance/fixtures/axe.ts');
    expect(axe).toMatch(/serious/);
    expect(axe).toMatch(/critical/);
    expect(read('.github/workflows/ci.yml')).toContain('scripts/verify.sh full');
  });
});

describe('repository hygiene', () => {
  it('SEC-01 no service account keys or private keys are committed', () => {
    // Files git would commit (tracked, plus untracked ones not ignored); reading the whole tree took over 5 s on a busy
    // machine.
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT })
      .toString('utf8')
      .split('\0')
      .filter((f) => f && !f.startsWith('legacy/') && existsSync(join(ROOT, f)))
      .map((f) => join(ROOT, f))
      .filter((f) => !/[\\/]docs[\\/]/.test(f) && !/\.(png|jpe?g|woff2?|y4m|wasm|tflite|ico)$/.test(f));
    const offenders = files.filter((f) => {
      if (/service-account.*\.json$|credentials.*\.json$/i.test(f)) return true;
      const text = readFileSync(f, 'utf8');
      return (
        /-----BEGIN (RSA )?PRIVATE KEY-----|"private_key":\s*"|FIREBASE_PRIVATE_KEY\s*=/.test(text) &&
        !f.endsWith('repo-rules.test.ts')
      );
    });
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  }, 15_000);

  it('SEC-09 Renovate is configured and every dependency is pinned by version', () => {
    expect(JSON.parse(read('renovate.json')).lockFileMaintenance.enabled).toBe(true);
    const manifests = [
      'package.json',
      ...['apps', 'packages'].flatMap((d) => readdirSync(join(ROOT, d)).map((p) => `${d}/${p}/package.json`)),
    ].filter((p) => existsSync(join(ROOT, p)));
    const loose = manifests.flatMap((m) => {
      const pkg = JSON.parse(read(m)) as Record<string, Record<string, string> | undefined>;
      return Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
        .filter(([, v]) => !/^(\d+\.\d+\.\d+|workspace:\*)$/.test(v))
        .map(([k, v]) => `${m}: ${k}@${v}`);
    });
    expect(loose).toEqual([]);
    expect(existsSync(join(ROOT, 'pnpm-lock.yaml'))).toBe(true);
  });

  it('CI-02 CI runs lint, typecheck, unit, emulator integration and Playwright on pull requests', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/on:\s*\n\s*pull_request:/);
    expect(ci).toContain('scripts/verify.sh full');
    expect(ci).toContain('playwright install');
    expect(ci).toContain('setup-java');
  });
});
