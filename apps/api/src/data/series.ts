import type { DailyWindow, EligibilityRules, SeriesDefaults, SeriesStatus } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { toMillis } from './keys';
import { writer, type Tx } from './tx';

/** A series as stored under organizations/{orgId}/series (spec 5.1, PLAN `Series`). */
export interface SeriesRecord {
  id: string;
  title: string;
  description?: string;
  status: SeriesStatus;
  startDate: string;
  endDate: string;
  dailyWindow?: DailyWindow;
  defaults: SeriesDefaults;
  eligibility: EligibilityRules;
  createdAt: number;
  updatedAt: number;
}

export type SeriesInput = Omit<SeriesRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'>;
export type SeriesUpdate = Partial<Omit<SeriesRecord, 'id' | 'createdAt'>> & { updatedAt: number };

const rules = (r: Partial<EligibilityRules> | undefined): EligibilityRules => ({
  departmentIds: r?.departmentIds ?? [],
  graduationYears: r?.graduationYears ?? [],
  include: r?.include ?? [],
  exclude: r?.exclude ?? [],
});

/** Firestore refuses undefined values; optional fields are left out instead. */
const present = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export function seriesData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/series`);
  const toSeries = (d: FirebaseFirestore.DocumentSnapshot): SeriesRecord => ({
    id: d.id,
    title: d.get('title'),
    ...(d.get('description') ? { description: d.get('description') as string } : {}),
    status: d.get('status'),
    startDate: d.get('startDate'),
    endDate: d.get('endDate'),
    ...(d.get('dailyWindow') ? { dailyWindow: d.get('dailyWindow') as DailyWindow } : {}),
    defaults: d.get('defaults') ?? {},
    eligibility: rules(d.get('eligibility')),
    createdAt: toMillis(d.get('createdAt')),
    updatedAt: toMillis(d.get('updatedAt')),
  });

  return {
    /** Every series of the org, newest start date first (title breaks ties). */
    async listSeries(orgId: string, filter: { status?: SeriesStatus } = {}): Promise<SeriesRecord[]> {
      let q: FirebaseFirestore.Query = col(orgId);
      if (filter.status) q = q.where('status', '==', filter.status);
      return (await q.get()).docs
        .map(toSeries)
        .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.title.localeCompare(b.title));
    },

    async getSeries(orgId: string, seriesId: string): Promise<SeriesRecord | null> {
      const d = await col(orgId).doc(seriesId).get();
      return d.exists ? toSeries(d) : null;
    },

    /** Tests per series, for the list's Tests column. */
    async countTestsBySeries(orgId: string): Promise<Map<string, number>> {
      const snap = await db.collection(`organizations/${orgId}/tests`).select('seriesId').get();
      const counts = new Map<string, number>();
      for (const t of snap.docs) counts.set(t.get('seriesId'), (counts.get(t.get('seriesId')) ?? 0) + 1);
      return counts;
    },

    /** A new series is a draft (SER-02). */
    createSeries(orgId: string, tx: Tx, input: SeriesInput, now: number): string {
      const ref = col(orgId).doc();
      writer(tx).create(ref, { orgId, ...present(input), status: 'draft', createdAt: now, updatedAt: now });
      return ref.id;
    },

    updateSeries(orgId: string, tx: Tx, seriesId: string, patch: SeriesUpdate): void {
      writer(tx).update(col(orgId).doc(seriesId), present(patch));
    },
  };
}
