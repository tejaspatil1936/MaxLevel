import type { AccommodationInput, Accommodations, WhitelistStatus } from '@mitaoe/shared';
import { FieldPath, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { normalizeEmail, toMillis } from './keys';
import { writer, type Tx } from './tx';

export interface StudentRecord {
  id: string;
  uid: string | null;
  email: string;
  /** Profile fields are empty between first sign-in and profile completion. */
  name: string | null;
  prn: string | null;
  departmentId: string | null;
  graduationYear: number | null;
  status: WhitelistStatus;
  consentAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Standing accommodations by series ID (OPS-07); `{}` when the student has none. */
  accommodations: Accommodations;
}

export function studentsData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/students`);
  const toStudent = (d: FirebaseFirestore.DocumentSnapshot): StudentRecord => ({
    id: d.id,
    uid: d.get('uid') ?? null,
    email: d.get('email'),
    name: d.get('name'),
    prn: d.get('prn'),
    departmentId: d.get('departmentId'),
    graduationYear: d.get('graduationYear'),
    status: d.get('status'),
    consentAt: d.get('consentAt') ? toMillis(d.get('consentAt')) : null,
    createdAt: toMillis(d.get('createdAt')),
    updatedAt: toMillis(d.get('updatedAt')),
    accommodations: d.get('accommodations') ?? {},
  });
  return {
    async linkStudentUid(orgId: string, studentId: string, uid: string): Promise<void> {
      await col(orgId).doc(studentId).update({ uid });
    },

    async listStudents(
      orgId: string,
      filter: { departmentId?: string; graduationYear?: number; status?: WhitelistStatus } = {},
    ): Promise<StudentRecord[]> {
      let q: FirebaseFirestore.Query = col(orgId);
      if (filter.departmentId) q = q.where('departmentId', '==', filter.departmentId);
      if (filter.graduationYear) q = q.where('graduationYear', '==', filter.graduationYear);
      if (filter.status) q = q.where('status', '==', filter.status);
      return (await q.get()).docs.map(toStudent);
    },

    async getStudent(orgId: string, studentId: string): Promise<StudentRecord | null> {
      const d = await col(orgId).doc(studentId).get();
      return d.exists ? toStudent(d) : null;
    },

    /** A student holding this PRN other than `exceptId` (STU-02: PRNs are unique within an org). */
    async findStudentByPrn(orgId: string, prn: string, exceptId?: string): Promise<StudentRecord | null> {
      const snap = await col(orgId).where('prn', '==', prn.trim()).limit(2).get();
      const other = snap.docs.find((d) => d.id !== exceptId);
      return other ? toStudent(other) : null;
    },

    async findStudentByEmail(orgId: string, email: string): Promise<StudentRecord | null> {
      const snap = await col(orgId).where('email', '==', normalizeEmail(email)).limit(1).get();
      return snap.docs[0] ? toStudent(snap.docs[0]) : null;
    },

    /** Generates the studentId here (DATA-01): a manually added student has no Firebase user yet. */
    createStudent(orgId: string, tx: Tx, input: Omit<StudentRecord, 'id' | 'accommodations'>): string {
      const ref = col(orgId).doc();
      // uid and consentAt stay absent until the student signs in and agrees (DATA-01, SEC-08).
      const { uid, consentAt, ...rest } = input;
      writer(tx).create(ref, {
        orgId,
        ...rest,
        ...(uid ? { uid } : {}),
        ...(consentAt ? { consentAt } : {}),
        email: normalizeEmail(input.email),
        accommodations: {},
      });
      return ref.id;
    },

    updateStudent(
      orgId: string,
      tx: Tx,
      studentId: string,
      patch: Partial<Omit<StudentRecord, 'id' | 'accommodations'>>,
    ): void {
      writer(tx).update(col(orgId).doc(studentId), { ...patch });
    },

    /**
     * OPS-07: stores the student's accommodation for a series, replacing any earlier one, or removes it (`null`). The
     * series ID is one field path segment, so no character in it can reach another field.
     */
    setAccommodation(orgId: string, tx: Tx, studentId: string, seriesId: string, a: AccommodationInput | null): void {
      writer(tx).update(col(orgId).doc(studentId), new FieldPath('accommodations', seriesId), a ?? FieldValue.delete());
    },

    deleteStudent(orgId: string, tx: Tx, studentId: string): void {
      writer(tx).delete(col(orgId).doc(studentId));
    },

    setDepartmentOf(orgId: string, tx: Tx, studentId: string, departmentId: string, now: number): void {
      writer(tx).update(col(orgId).doc(studentId), { departmentId, updatedAt: now });
    },
  };
}
