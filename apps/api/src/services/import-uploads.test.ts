import { TestClock } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { exportLinks } from './export-links';
import { importUploadLinks } from './import-uploads';

const T0 = 1_792_476_000_000;
const SECRET = 's'.repeat(32);
const query = (url: string) => {
  const u = new URL(url);
  return {
    org: u.searchParams.get('org')!,
    expires: Number(u.searchParams.get('expires')),
    sig: u.searchParams.get('sig')!,
  };
};

describe('import upload links', () => {
  it('IMP-01 a link is absolute and works until its expiry on the Clock', () => {
    const clock = new TestClock();
    clock.set(T0);
    const links = importUploadLinks(SECRET, clock);
    const url = links.url('http://127.0.0.1:4000', 'org-a', 'j1', T0 + 900_000);
    expect(url.startsWith('http://127.0.0.1:4000/v1/imports/j1/upload?org=org-a&expires=')).toBe(true);
    expect(links.verify('j1', query(url))).toBe('ok');
    clock.set(T0 + 900_000);
    expect(links.verify('j1', query(url))).toBe('expired');
  });

  it('IMP-01 ORG-05 a link signed for one job or organization uploads nothing else, nor opens a download', () => {
    const clock = new TestClock();
    clock.set(T0);
    const links = importUploadLinks(SECRET, clock);
    const q = query(links.url('http://h', 'org-a', 'j1', T0 + 900_000));
    expect(links.verify('j2', q)).toBe('invalid');
    expect(links.verify('j1', { ...q, org: 'org-b' })).toBe('invalid');
    expect(links.verify('j1', { ...q, expires: q.expires + 1 })).toBe('invalid');
    expect(links.verify('j1', { ...q, sig: 'zz' })).toBe('invalid');
    expect(exportLinks(SECRET, clock).verify('j1', q), 'not an export download link').toBe('invalid');
  });
});
