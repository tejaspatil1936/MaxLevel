import { describe, expect, it } from 'vitest';
import { createData } from '.';

// ORG-03: every data-access function takes orgId as its first parameter. Only bootstrap lookups by email
// (identity) and super-admin cross-org views (platform) are exempt.
const EXEMPT = new Set(['identity', 'platform']);

describe('data-access layer', () => {
  it('ORG-03 every org-scoped data function takes orgId first', () => {
    const data = createData({ collection: () => ({}), doc: () => ({}) } as never) as Record<
      string,
      Record<string, unknown>
    >;
    const offenders: string[] = [];
    let checked = 0;
    for (const [module, fns] of Object.entries(data)) {
      if (EXEMPT.has(module)) continue;
      for (const [name, fn] of Object.entries(fns)) {
        if (typeof fn !== 'function') continue;
        checked++;
        const params = fn.toString().match(/^[^(]*\(([^)]*)\)/)?.[1] ?? '';
        if (params.split(',')[0]?.trim() !== 'orgId') offenders.push(`${module}.${name}(${params})`);
      }
    }
    expect(checked).toBeGreaterThan(3);
    expect(offenders).toEqual([]);
  });
});
