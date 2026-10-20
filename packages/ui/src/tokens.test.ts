import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
const COLORS = [
  'sheet',
  'surface',
  'surface-sunken',
  'ink',
  'graphite',
  'rule',
  'dropout',
  'dropout-faint',
  'ballpoint',
  'ballpoint-wash',
  'highlighter',
  'redpen',
  'redpen-wash',
  'tick',
  'tick-wash',
];

/** Declarations of the first rule whose selector list starts with `selector`. */
function vars(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const root = vars(':root,');
const themes = {
  light: root,
  dark: vars("[data-theme='dark']"),
  'high contrast': { ...root, ...vars("[data-contrast='high']") },
};
const layout = vars(':root {');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

describe('colour tokens', () => {
  it.each(Object.keys(themes))('UI-13 %s defines every colour token as a CSS variable', (name) => {
    const t = themes[name as keyof typeof themes];
    for (const c of COLORS) expect(t[c], c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('UI-13 the Tailwind theme exposes every colour token', () => {
    for (const c of COLORS) expect(theme).toContain(`--color-${c}: var(--${c});`);
  });

  it.each(['light', 'dark'] as const)(
    'UI-01 text colours reach 4.5:1 on sheet and surface in %s, dropout 3:1',
    (name) => {
      const t = themes[name];
      for (const fg of ['ink', 'graphite', 'ballpoint', 'redpen', 'tick'])
        for (const bg of ['sheet', 'surface'])
          expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.dropout!, t.surface!), 'dropout on surface').toBeGreaterThanOrEqual(3);
    },
  );

  it('UI-01 ballpoint reaches about 7:1 in light mode', () => {
    expect(contrast(root.ballpoint!, root.surface!)).toBeGreaterThanOrEqual(6.5);
  });

  it.each(Object.keys(themes))('A11Y-13 %s: text 4.5:1 and outlines 3:1', (name) => {
    const t = themes[name as keyof typeof themes];
    for (const fg of ['ink', 'graphite', 'ballpoint', 'redpen', 'tick'])
      for (const bg of ['sheet', 'surface', 'surface-sunken'])
        expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['highlighter-ink']!, t.highlighter!), 'text on highlighter').toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['on-ballpoint']!, t.ballpoint!), 'text on ballpoint').toBeGreaterThanOrEqual(4.5);
    for (const wash of ['redpen-wash', 'tick-wash', 'ballpoint-wash'])
      expect(contrast(t.ink!, t[wash]!), `ink on ${wash}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.redpen!, t['redpen-wash']!), 'redpen on its wash').toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.tick!, t['tick-wash']!), 'tick on its wash').toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.dropout!, t.surface!), 'outlines').toBeGreaterThanOrEqual(3);
  });

  it('A11Y-13 high contrast is pure black text on white with 2 px borders', () => {
    const hc = vars("[data-contrast='high']");
    expect([hc.ink, hc.surface, hc.dropout, hc['border-width']]).toEqual(['#000000', '#ffffff', '#000000', '2px']);
  });
});

describe('scale tokens', () => {
  it('UI-05 body text measure is 72 characters', () => {
    expect(layout['measure-body']).toBe('72ch');
    expect(theme).toContain('--container-measure: var(--measure-body);');
  });

  it('UI-07 spacing scale and layout widths', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => layout[`space-${i}`])).toEqual([
      '4px',
      '8px',
      '12px',
      '16px',
      '24px',
      '32px',
      '48px',
      '64px',
      '96px',
    ]);
    expect([layout['width-admin'], layout['width-student'], layout.gutter]).toEqual(['1280px', '1120px', '24px']);
    expect(theme).toContain('--spacing: 4px;');
  });

  it('UI-08 corner radius follows hierarchy', () => {
    expect([layout['radius-sheet'], layout['radius-control'], layout['radius-panel'], layout['radius-full']]).toEqual([
      '2px',
      '4px',
      '8px',
      '9999px',
    ]);
    expect(theme).toContain('--radius-*: initial;');
  });

  it('UI-09 one overlay shadow token and no other shadows', () => {
    expect(layout['shadow-overlay']).toBe('0 12px 32px -8px rgb(20 26 51 / 0.24)');
    expect(theme).toContain('--shadow-*: initial;');
    expect([...theme.matchAll(/--shadow-[\w-]+:/g)].map((m) => m[0])).toEqual(['--shadow-overlay:']);
  });

  it('UI-10 motion durations and easing', () => {
    expect([layout['duration-small'], layout['duration-standard'], layout['duration-drawer']]).toEqual([
      '120ms',
      '200ms',
      '320ms',
    ]);
    expect(layout['ease-standard']).toBe('cubic-bezier(0.2, 0.7, 0.1, 1)');
  });
});

describe('no decorative effects', () => {
  const ROOTS = ['../../ui/src', '../../../apps/web/app', '../../../apps/web/src'].map(
    (p) => new URL(p, import.meta.url).pathname,
  );
  const files = (dir: string): string[] => {
    try {
      return readdirSync(dir).flatMap((e) => {
        const p = join(dir, e);
        return statSync(p).isDirectory() ? files(p) : /\.(css|tsx?)$/.test(e) && !e.endsWith('.test.ts') ? [p] : [];
      });
    } catch {
      return [];
    }
  };

  it('UI-03 no gradients, glass or blur in any stylesheet or component', () => {
    const offenders = ROOTS.flatMap(files).filter((f) =>
      /gradient\(|backdrop-filter|backdrop-blur|blur\(|bg-gradient|from-\[|filter:\s*blur/.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe('destructive buttons', () => {
  it('A11Y-13 text on the red pen fill reaches 4.5:1 in every theme', () => {
    for (const [name, t] of Object.entries(themes)) {
      const on = t['on-redpen'] ?? root['on-redpen'];
      expect(contrast(on!, t.redpen!), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
