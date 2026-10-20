import { FieldPath, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

/** The IDs of every organization, one page of `batchSize` at a time, in ID order. */
export async function* orgIdPages(db: Firestore, batchSize: number): AsyncGenerator<string[]> {
  let after: string | null = null;
  for (;;) {
    let q = db.collection('organizations').orderBy(FieldPath.documentId()).select().limit(batchSize);
    if (after !== null) q = q.startAfter(after);
    const ids = (await q.get()).docs.map((d) => d.id);
    if (ids.length) yield ids;
    if (ids.length < batchSize) return;
    after = ids[ids.length - 1]!;
  }
}

/**
 * The records of one organization's collection (ORG-03: orgId first), one page of `batchSize` at a time in ID order,
 * with only the named fields read.
 */
export async function* orgCollectionPages(
  db: Firestore,
  orgId: string,
  collection: string,
  fields: string[],
  batchSize: number,
): AsyncGenerator<QueryDocumentSnapshot[]> {
  const col = db.collection(`organizations/${orgId}/${collection}`);
  let after: string | null = null;
  for (;;) {
    let q = col
      .orderBy(FieldPath.documentId())
      .select(...fields)
      .limit(batchSize);
    if (after !== null) q = q.startAfter(after);
    const docs = (await q.get()).docs;
    if (docs.length) yield docs;
    if (docs.length < batchSize) return;
    after = docs[docs.length - 1]!.id;
  }
}
