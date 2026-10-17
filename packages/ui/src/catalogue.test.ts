import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('./components/', import.meta.url);
const files = readdirSync(dir);
const stories = files.filter((f) => f.endsWith('.stories.tsx')).map((f) => readFileSync(new URL(f, dir), 'utf8'));
const preview = readFileSync(new URL('../.storybook/preview.tsx', import.meta.url), 'utf8');

describe('component catalogue', () => {
  it('UI-14 every component module has a Storybook story', () => {
    const modules = files
      .filter((f) => f.endsWith('.tsx') && !f.endsWith('.stories.tsx'))
      .map((f) => f.replace('.tsx', ''));
    expect(modules.length).toBeGreaterThan(5);
    const missing = modules.filter((m) => !stories.some((s) => s.includes(`from './${m}'`)));
    expect(missing).toEqual([]);
  });

  it('UI-14 every story renders in light, dark and high contrast', () => {
    for (const theme of ["'data-theme': 'light'", "'data-theme': 'dark'", "'data-contrast': 'high'"])
      expect(preview).toContain(theme);
    expect(preview).toMatch(/decorators:\s*\[inAllThemes\]/);
  });
});
