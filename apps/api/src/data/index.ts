import type { Firestore } from 'firebase-admin/firestore';
import { adminsData } from './admins';
import { attemptsData } from './attempts';
import { auditData } from './audit';
import { departmentsData } from './departments';
import { entitlementsData } from './entitlements';
import { idempotencyData } from './idempotency';
import { identityData } from './identity';
import { orgsData } from './orgs';
import { platformData } from './platform';
import { preferencesData } from './preferences';
import { questionsData } from './questions';
import { seriesData } from './series';
import { studentsData } from './students';
import { testsData } from './tests';
import { usageData } from './usage';
import { whitelistData } from './whitelist';

/** The data-access layer. Every org-scoped function takes orgId as its first argument (ORG-03). */
export function createData(db: Firestore) {
  return {
    identity: identityData(db),
    idempotency: idempotencyData(db),
    orgs: orgsData(db),
    admins: adminsData(db),
    attempts: attemptsData(db),
    audit: auditData(db),
    students: studentsData(db),
    entitlements: entitlementsData(db),
    departments: departmentsData(db),
    whitelist: whitelistData(db),
    platform: platformData(db),
    preferences: preferencesData(db),
    series: seriesData(db),
    tests: testsData(db),
    questions: questionsData(db),
    usage: usageData(db),
  };
}
export type Data = ReturnType<typeof createData>;
