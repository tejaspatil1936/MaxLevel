import { getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { describe, expect, it } from 'vitest';
import { initFileStore } from './firebase';

describe('worker file store', () => {
  it('EXP-03 DATA-09 saves an export file with its type to the Storage bucket the API reads', async () => {
    const files = initFileStore();
    const path = `organizations/org-a/exports/e-${process.pid}`;
    await files.save(path, Buffer.from('﻿Name\r\n', 'utf8'), 'text/csv; charset=utf-8');
    const file = getStorage(getApps()[0]).bucket(`${process.env.GCLOUD_PROJECT}.appspot.com`).file(path);
    expect((await file.download())[0].toString('utf8')).toBe('﻿Name\r\n');
    expect((await file.getMetadata())[0].contentType).toBe('text/csv; charset=utf-8');
    await file.delete();
  });
});
