import { describe, expect, it } from 'vitest';
import { csvField, csvLine } from './files';

describe('CSV exports', () => {
  it('SEC-06 cells that a spreadsheet would run as a formula are prefixed with a single quote', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      const value = `${lead}HYPERLINK("http://evil.example")`;
      expect(csvField(value).replace(/^"|"$/g, '')).toMatch(/^'/);
    }
    expect(csvLine(['=1+1', 'plain', '-5'])).toBe("'=1+1,plain,'-5");
  });

  it('SEC-06 ordinary values are unchanged and quoting still follows RFC 4180', () => {
    expect(csvField('student01@a.test')).toBe('student01@a.test');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField(null)).toBe('');
  });
});
