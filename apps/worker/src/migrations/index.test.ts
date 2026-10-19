import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIGRATION_ID, MIGRATIONS, migrationVersion } from './index';
import type { Migration } from './types';

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir)
  .filter((f) => /^\d{4}-.*\.ts$/.test(f) && !f.endsWith('.test.ts'))
  .sort();

describe('migration registry', () => {
  it('CI-04 every migration has a unique NNNN-kebab ID, versions ascend from 1 with no gap', () => {
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{4}-[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(ids.map(migrationVersion)).toEqual(ids.map((_, i) => i + 1));
    expect(ids[0]).toBe('0001-student-accommodations');
  });

  it('CI-04 each migration file holds the migration of its own name, and every file is in the list', async () => {
    expect(files.map((f) => f.replace(/\.ts$/, ''))).toEqual(MIGRATIONS.map((m) => m.id));
    for (const f of files) {
      const mod = (await import(new URL(f, dir).href)) as { migration: Migration };
      expect(mod.migration.id, f).toBe(f.replace(/\.ts$/, ''));
      expect(MIGRATIONS).toContain(mod.migration);
    }
  });

  it('CI-04 migration IDs of another shape have no version', () => {
    for (const bad of ['1-x', '0001_x', '0001-X', '0001-', 'abcd-x', '0001-a--b']) {
      expect(migrationVersion(bad), bad).toBeNull();
      expect(MIGRATION_ID.test(bad), bad).toBe(false);
    }
    expect(migrationVersion('0012-a-b2')).toBe(12);
  });
});
