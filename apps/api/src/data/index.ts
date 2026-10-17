import type { Firestore } from 'firebase-admin/firestore';
import { adminsData } from './admins';
import { identityData } from './identity';
import { orgsData } from './orgs';
import { studentsData } from './students';

/** The data-access layer. Every org-scoped function takes orgId as its first argument (ORG-03). */
export function createData(db: Firestore) {
  return {
    identity: identityData(db),
    orgs: orgsData(db),
    admins: adminsData(db),
    students: studentsData(db),
  };
}
export type Data = ReturnType<typeof createData>;
