import { describe, expect, it, vi } from 'vitest';
import { showBlob } from './files';

describe('showBlob', () => {
  it('IMP-11 gives a blob: URL for the blob and revokes it on cleanup', () => {
    const set = vi.fn();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const stop = showBlob(new Blob(['png']), set);
    const url = set.mock.calls[0]![0] as string;
    expect(url).toMatch(/^blob:/);
    expect(revoke).not.toHaveBeenCalled();
    stop();
    expect(revoke).toHaveBeenCalledWith(url);
    revoke.mockRestore();
  });

  it('IMP-11 gives null without a blob', () => {
    const set = vi.fn();
    showBlob(null, set)();
    expect(set).toHaveBeenCalledWith(null);
  });
});
