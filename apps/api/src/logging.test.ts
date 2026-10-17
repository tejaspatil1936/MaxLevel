import { describe, expect, it } from 'vitest';
import { logSink } from './test-support/app';
import { hashId as hash } from './logging';

describe('log redaction', () => {
  it('SEC-07 emails and PRNs are hashed, answers and tokens dropped', () => {
    const { lines, logger } = logSink();
    logger.info(
      { email: 'Student01@A.test', student: { prn: '22010101' }, answers: { q1: 'b' }, optionId: 'b', token: 't' },
      'x',
    );
    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain('student01@a.test');
    expect(line).not.toContain('Student01');
    expect(line).not.toContain('22010101');
    expect(lines[0]).toMatchObject({
      email: hash('student01@a.test'),
      student: { prn: hash('22010101') },
      answers: '[redacted]',
      optionId: '[redacted]',
      token: '[redacted]',
    });
  });

  it('SEC-07 the same identifier always hashes to the same value', () => {
    expect(hash(' A@B.test ')).toBe(hash('a@b.test'));
  });

  it('SEC-07 authorization headers never reach the log', () => {
    const { lines, logger } = logSink();
    logger.info({ req: { headers: { authorization: 'Bearer secret-token' } } }, 'r');
    expect(JSON.stringify(lines[0])).not.toContain('secret-token');
  });
});
