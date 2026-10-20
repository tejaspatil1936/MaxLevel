import { describe, expect, it } from 'vitest';
import { scrubForAudit } from './audit';

describe('scrubForAudit', () => {
  it('AUD-01 removes answer keys, explanations and tokens at any depth', () => {
    expect(
      scrubForAudit({
        prompt: 'p',
        correctOptionIds: ['a'],
        explanation: 'e',
        options: [{ id: 'a', token: 't' }],
        nested: { idToken: 'x', ok: 1 },
      }),
    ).toEqual({ prompt: 'p', options: [{ id: 'a' }], nested: { ok: 1 } });
  });
});
