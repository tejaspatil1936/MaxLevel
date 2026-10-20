import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);

beforeEach(async () => {
  await clearEmulators();
});

describe('exports data access', () => {
  it('EXP-03 ORG-03 stores an export in a batch under its organization and reads it only there', async () => {
    const id = data.exports.newExportId('org-a');
    const rec = {
      id,
      scope: 'test' as const,
      refId: 't1',
      format: 'csv' as const,
      status: 'queued' as const,
      filePath: `organizations/org-a/exports/${id}/results-t1.csv`,
      filename: 'results-t1.csv',
      createdBy: 'uid-1',
      createdAt: 5,
    };
    const batch = db.batch();
    data.exports.addExport('org-a', batch, rec);
    expect(await data.exports.getExport('org-a', id), 'nothing before the commit').toBeNull();
    await batch.commit();
    expect(await data.exports.getExport('org-a', id)).toEqual({ ...rec, orgId: 'org-a' });
    expect(await data.exports.getExport('org-b', id)).toBeNull();
  });
});
