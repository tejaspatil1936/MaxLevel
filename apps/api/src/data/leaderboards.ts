import type { Firestore } from 'firebase-admin/firestore';

/** A stored leaderboard row (spec 10.1); series rows also keep each test's counted score (null = not counted). */
export interface StoredBoardRow {
  studentId: string;
  name: string;
  departmentId: string;
  score: number;
  rank: number;
  timeSec: number;
  scores?: Record<string, number | null>;
}

export interface StoredBoard {
  computedAt: number;
  total: number;
  rows: StoredBoardRow[];
}

/**
 * Leaderboards as the worker's recompute stores them (LB-03, DATA-04): `leaderboards/{boardId}` holds `computedAt`,
 * `total`, `pageCount` and the first page of rows; pages 1 and on are `leaderboards/{boardId}/pages/{n}`.
 */
export function leaderboardsData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/leaderboards`);
  return {
    /** A board with every row in rank order, or null while it has not been computed. */
    async getLeaderboard(orgId: string, boardId: string): Promise<StoredBoard | null> {
      const ref = col(orgId).doc(boardId);
      const head = await ref.get();
      if (!head.exists) return null;
      const first = (head.get('rows') as StoredBoardRow[] | undefined) ?? [];
      const pageCount = (head.get('pageCount') as number | undefined) ?? 1;
      const more =
        pageCount > 1
          ? await db.getAll(
              ...Array.from({ length: pageCount - 1 }, (_, i) => ref.collection('pages').doc(String(i + 1))),
            )
          : [];
      const rows = [...first, ...more.flatMap((d) => (d.get('rows') as StoredBoardRow[] | undefined) ?? [])];
      return {
        computedAt: head.get('computedAt') as number,
        total: (head.get('total') as number | undefined) ?? rows.length,
        rows,
      };
    },
  };
}
