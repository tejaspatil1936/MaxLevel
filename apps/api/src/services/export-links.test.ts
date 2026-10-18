import { TestClock } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { exportLinks } from './export-links';

const T0 = 1_793_592_000_000;
const query = (url: string) => {
  const u = new URL(url);
  return {
    org: u.searchParams.get('org')!,
    expires: Number(u.searchParams.get('expires')),
    sig: u.searchParams.get('sig')!,
  };
};

describe('export download links', () => {
  it('EXP-03 a link is absolute, works for 15 minutes on the Clock and then expires', () => {
    const clock = new TestClock();
    clock.set(T0);
    const links = exportLinks('s'.repeat(32), clock);
    const { url, expiresAt } = links.issue('http://localhost:4000', 'org-a', 'e1');
    expect(expiresAt).toBe(T0 + 900_000);
    expect(url.startsWith('http://localhost:4000/v1/exports/e1/file?org=org-a&expires=')).toBe(true);
    expect(links.verify('e1', query(url))).toBe('ok');
    clock.set(T0 + 899_999);
    expect(links.verify('e1', query(url))).toBe('ok');
    clock.set(T0 + 900_000);
    expect(links.verify('e1', query(url))).toBe('expired');
  });

  it('EXP-03 ORG-05 a link signed for one export, organization or expiry opens nothing else', () => {
    const clock = new TestClock();
    clock.set(T0);
    const links = exportLinks('s'.repeat(32), clock);
    const q = query(links.issue('http://api', 'org-a', 'e1').url);
    expect(links.verify('e2', q)).toBe('invalid');
    expect(links.verify('e1', { ...q, org: 'org-b' })).toBe('invalid');
    expect(links.verify('e1', { ...q, expires: q.expires + 60_000 })).toBe('invalid');
    expect(links.verify('e1', { ...q, sig: 'zz' })).toBe('invalid');
    expect(exportLinks('t'.repeat(32), clock).verify('e1', q), 'another secret').toBe('invalid');
  });
});
