import { describe, expect, it } from 'vitest';
import { WRITE_CHUNK_BYTES, WRITE_CHUNK_DOCS, writeChunks } from './import-data';

describe('import draft writes', () => {
  it('IMP-01 drafts are written in chunks of at most 400 documents and 6 MiB, in order', () => {
    const items = Array.from({ length: 1001 }, (_, i) => i);
    const chunks = writeChunks(items, () => 10);
    expect(chunks.map((c) => c.length)).toEqual([WRITE_CHUNK_DOCS, WRITE_CHUNK_DOCS, 201]);
    expect(chunks.flat()).toEqual(items);

    const third = Math.floor(WRITE_CHUNK_BYTES / 3);
    expect(writeChunks([1, 2, 3, 4, 5], () => third).map((c) => c.length)).toEqual([3, 2]);
    // A document larger than a chunk goes alone, never with others.
    expect(writeChunks(['a', 'big', 'b'], (s) => (s === 'big' ? WRITE_CHUNK_BYTES * 2 : 1))).toEqual([
      ['a'],
      ['big'],
      ['b'],
    ]);
  });

  it('IMP-01 no drafts still give one chunk, for the job update', () => {
    expect(writeChunks([])).toEqual([[]]);
  });
});
