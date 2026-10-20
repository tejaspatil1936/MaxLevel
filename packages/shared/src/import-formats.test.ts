import { describe, expect, it } from 'vitest';
import {
  IMPORT_FORMATS,
  IMPORT_MESSAGES,
  importFormatOf,
  isTemplateHeader,
  signatureMatches,
  usesModel,
  type ImportFormat,
} from './import-formats';

const bytes = (...parts: Array<string | number[]>) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'utf8')] : p)));
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const MZ = bytes('MZ', Array<number>(30).fill(0x90));

describe('importFormatOf', () => {
  it('IMP-01 each accepted extension, in any case, names its format', () => {
    for (const f of IMPORT_FORMATS) {
      expect(importFormatOf(`paper.${f}`)).toBe(f);
      expect(importFormatOf(`PAPER.${f.toUpperCase()}`)).toBe(f);
    }
    expect(importFormatOf('notes.v2.Md')).toBe('md');
  });

  it('IMP-01 other extensions and names without one are refused', () => {
    for (const name of ['notes.docx', 'diagram.png', 'README', 'archive.zip', 'paper.pdf.exe', 'json'])
      expect(importFormatOf(name)).toBeNull();
  });
});

describe('signatureMatches', () => {
  const real: Record<ImportFormat, Uint8Array> = {
    pdf: bytes('%PDF-1.4\n'),
    xlsx: bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0]),
    json: bytes('  \n{"questions": []}'),
    csv: bytes('Question,Option A\n'),
    txt: bytes('What is 2 + 2? (a) 3 (b) 4\n'),
    md: bytes('# Reasoning\n\nचतुर्थ प्रश्न'),
  };

  it('SEC-06 the real bytes of each format match', () => {
    for (const f of IMPORT_FORMATS) expect(signatureMatches(f, real[f]), f).toBe(true);
    expect(signatureMatches('json', bytes('[1, 2]'))).toBe(true);
  });

  it('SEC-06 a PNG and an MZ executable match no format, whatever the name says', () => {
    for (const f of IMPORT_FORMATS) {
      expect(signatureMatches(f, Uint8Array.from(PNG)), `PNG as ${f}`).toBe(false);
      expect(signatureMatches(f, MZ), `MZ as ${f}`).toBe(false);
    }
  });

  it('SEC-06 text formats allow a UTF-8 BOM but no NUL byte; JSON starts with { or [ after whitespace', () => {
    for (const f of ['csv', 'txt', 'md', 'json'] as const) {
      expect(signatureMatches(f, bytes([0xef, 0xbb, 0xbf], '{"a": 1}')), `BOM ${f}`).toBe(true);
      expect(signatureMatches(f, bytes('{"a": 1}', [0], 'x')), `NUL ${f}`).toBe(false);
    }
    expect(signatureMatches('json', bytes('questions: []'))).toBe(false);
    expect(signatureMatches('json', bytes(''))).toBe(false);
    expect(signatureMatches('txt', bytes([0xc3, 0x28]))).toBe(false);
  });

  it('SEC-06 a multi-byte character cut off at the end of the first 64 KB still matches', () => {
    expect(signatureMatches('txt', bytes('naïve ', [0xe0, 0xa4]))).toBe(true);
    expect(signatureMatches('pdf', bytes('%PDF'))).toBe(false);
    expect(signatureMatches('xlsx', bytes([0x50, 0x4b]))).toBe(false);
  });
});

describe('usesModel and isTemplateHeader', () => {
  it('IMP-08 the model reads PDF, TXT, MD and sheets outside the template, never JSON', () => {
    expect(usesModel('json', false)).toBe(false);
    for (const f of ['pdf', 'txt', 'md'] as const) expect(usesModel(f, false)).toBe(true);
    for (const f of ['csv', 'xlsx'] as const) {
      expect(usesModel(f, true)).toBe(false);
      expect(usesModel(f, false)).toBe(true);
    }
  });

  it('IMP-01 a template header has Question, Option A, Option B and Correct, ignoring case and spaces', () => {
    expect(isTemplateHeader([' question ', 'OPTION A', 'Option b', 'correct', 'Tags'])).toBe(true);
    expect(isTemplateHeader(['Question', 'Option A', 'Option B'])).toBe(false);
    expect(isTemplateHeader(['Q', 'Choices', 'Answer'])).toBe(false);
  });
});

describe('IMPORT_MESSAGES', () => {
  it('IMP-02 the limit messages state the limit, with en-IN numbers', () => {
    expect(IMPORT_MESSAGES.tooLarge).toBe('This file is larger than 25 MB. Split it into smaller files.');
    expect(IMPORT_MESSAGES.tooManyPages(101)).toBe('This PDF has 101 pages. The limit is 100 pages.');
    expect(IMPORT_MESSAGES.tooManyRows(5001)).toBe('This sheet has 5,001 rows. The limit is 5,000 rows.');
    expect(IMPORT_MESSAGES.mismatch('pdf')).toBe("This file isn't a real PDF file. Check the file and try again.");
  });

  it('REL-06 the model failure messages are exact', () => {
    expect(IMPORT_MESSAGES.llmUnavailable).toBe("The AI service didn't answer.");
    expect(IMPORT_MESSAGES.llmGaveUp).toBe("The AI service didn't answer after 4 tries.");
  });
});
