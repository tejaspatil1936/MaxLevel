import type { Department } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { writer, type Tx } from './tx';

export function departmentsData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/departments`);
  return {
    async listDepartments(orgId: string): Promise<Department[]> {
      const [depts, students] = await Promise.all([
        col(orgId).get(),
        db.collection(`organizations/${orgId}/students`).select('departmentId').get(),
      ]);
      const counts = new Map<string, number>();
      for (const s of students.docs) counts.set(s.get('departmentId'), (counts.get(s.get('departmentId')) ?? 0) + 1);
      return depts.docs
        .map((d) => ({
          id: d.id,
          name: d.get('name') as string,
          status: d.get('status') as Department['status'],
          studentCount: counts.get(d.id) ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    /** Department names by ID, for records that keep only the ID (leaderboard rows, DECISIONS Q28). */
    async departmentNames(orgId: string): Promise<Map<string, string>> {
      const snap = await col(orgId).select('name').get();
      return new Map(snap.docs.map((d) => [d.id, d.get('name') as string]));
    },

    async getDepartment(orgId: string, deptId: string): Promise<Omit<Department, 'studentCount'> | null> {
      const d = await col(orgId).doc(deptId).get();
      return d.exists ? { id: d.id, name: d.get('name'), status: d.get('status') } : null;
    },

    async findDepartmentByName(orgId: string, name: string): Promise<string | null> {
      const all = await col(orgId).get();
      return all.docs.find((d) => (d.get('name') as string).toLowerCase() === name.trim().toLowerCase())?.id ?? null;
    },

    createDepartment(orgId: string, tx: Tx, name: string): string {
      const ref = col(orgId).doc();
      writer(tx).create(ref, { orgId, name: name.trim(), status: 'active' });
      return ref.id;
    },

    updateDepartment(
      orgId: string,
      tx: Tx,
      deptId: string,
      patch: { name?: string; status?: 'active' | 'archived' },
    ): void {
      writer(tx).update(col(orgId).doc(deptId), { ...patch });
    },

    deleteDepartment(orgId: string, tx: Tx, deptId: string): void {
      writer(tx).delete(col(orgId).doc(deptId));
    },

    async studentIdsInDepartment(orgId: string, deptId: string): Promise<string[]> {
      const snap = await db
        .collection(`organizations/${orgId}/students`)
        .where('departmentId', '==', deptId)
        .select()
        .get();
      return snap.docs.map((d) => d.id);
    },
  };
}
