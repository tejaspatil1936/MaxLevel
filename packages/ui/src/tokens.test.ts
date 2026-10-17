import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
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

function block(selector: string): string {
  const start = css.indexOf(selector);
  return css.slice(start, css.indexOf('}', start));
}

describe('tokens.css', () => {
  it.each(["[data-theme='light']", "[data-theme='dark']", "[data-contrast='high']"])(
    '%s defines every colour token',
    (sel) => {
      const b = block(sel);
      for (const c of COLORS) expect(b, c).toMatch(new RegExp(`--${c}: #[0-9a-f]{6};`));
    },
  );
});
