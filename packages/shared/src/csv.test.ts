import { describe, expect, it } from 'vitest';
import { csvField, csvLine, neutraliseFormula } from './csv';

describe('spreadsheet-safe cells', () => {
  it('SEC-06 EXP-01 text a spreadsheet would run as a formula gets a leading single quote', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      const value = `${lead}HYPERLINK("http://evil.example")`;
      expect(neutraliseFormula(value)).toBe(`'${value}`);
      expect(csvField(value).replace(/^"|"$/g, '')).toMatch(/^'/);
    }
    expect(csvLine(['=1+1', 'plain', '-5', '@SUM(A1)'])).toBe("'=1+1,plain,'-5,'@SUM(A1)");
  });

  it('SEC-06 EXP-01 numbers are written as numbers, ordinary text is unchanged and quoting follows RFC 4180', () => {
    expect(csvLine([-0.5, 17.5, 0, 2027])).toBe('-0.5,17.5,0,2027');
    expect(neutraliseFormula('Asha Patil')).toBe('Asha Patil');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=1,2')).toBe(`"'=1,2"`);
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });
});
