import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const secret = 'x'.repeat(32);

describe('export link secret', () => {
  it('EXP-03 production refuses to start without EXPORT_LINK_SECRET or with one under 32 bytes', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/EXPORT_LINK_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', EXPORT_LINK_SECRET: '' })).toThrow(/EXPORT_LINK_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', EXPORT_LINK_SECRET: 'x'.repeat(31) })).toThrow(
      /EXPORT_LINK_SECRET/,
    );
    expect(loadConfig({ NODE_ENV: 'production', EXPORT_LINK_SECRET: secret }).exportLinkSecret).toBe(secret);
  });

  it('EXP-03 development and test fall back to a random key of their own', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const a = loadConfig({ NODE_ENV }).exportLinkSecret;
      expect(a, NODE_ENV).toMatch(/^[0-9a-f]{64}$/);
      expect(loadConfig({ NODE_ENV }).exportLinkSecret, NODE_ENV).not.toBe(a);
      expect(loadConfig({ NODE_ENV, EXPORT_LINK_SECRET: secret }).exportLinkSecret, NODE_ENV).toBe(secret);
    }
    expect(loadConfig({}).exportLinkSecret).toMatch(/^[0-9a-f]{64}$/);
  });
});
