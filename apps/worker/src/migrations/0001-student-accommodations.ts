import { orgCollectionPages, orgIdPages } from './pages';
import type { Migration } from './types';

/**
 * Student records written before phase 5 have no `accommodations` field. Every student of every organization without
 * it gets `accommodations: {}`; records that have it are not written. Each write is conditional on the record being
 * unchanged since it was read, so an edit in between makes the run fail and retry instead of being overwritten.
 */
export const migration: Migration = {
  id: '0001-student-accommodations',
  async run({ db, batchSize }) {
    let changed = 0;
    for await (const orgIds of orgIdPages(db, batchSize)) {
      for (const orgId of orgIds) {
        for await (const page of orgCollectionPages(db, orgId, 'students', ['accommodations'], batchSize)) {
          const old = page.filter((d) => !('accommodations' in d.data()));
          if (!old.length) continue;
          const batch = db.batch();
          for (const d of old) batch.update(d.ref, { accommodations: {} }, { lastUpdateTime: d.updateTime });
          await batch.commit();
          changed += old.length;
        }
      }
    }
    return changed;
  },
};
