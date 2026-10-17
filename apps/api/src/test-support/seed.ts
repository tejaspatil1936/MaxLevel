import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

// Base seed (docs/TEST_ENV.md): orgs A and B, a super admin, two admins per org, departments, 20 registered
// students per org, invited entries, one email in both orgs.

export const emailKey = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

const NAMES = [
  'Aarav Kulkarni',
  'Ishita Deshmukh',
  'Rohan Patil',
  'Sneha Joshi',
  'Vihaan Shinde',
  'Ananya Pawar',
  'Arjun Jadhav',
  'Kavya Gaikwad',
  'Siddharth More',
  'Pooja Chavan',
  'Aditya Bhosale',
  'Riya Kale',
  'Omkar Sawant',
  'Tanvi Mane',
  'Pranav Kadam',
  'Shruti Naik',
  'Yash Salunkhe',
  'Neha Wagh',
  'Kunal Thorat',
  'Aditi Bendre',
];

interface OrgSeed {
  id: string;
  name: string;
  slug: string;
  domain: string;
  prnPrefix: string;
  departments: string[];
}

const ORGS: OrgSeed[] = [
  {
    id: 'org-a',
    name: 'MIT Academy of Engineering',
    slug: 'mitaoe',
    domain: 'a.test',
    prnPrefix: '2201',
    departments: ['Computer', 'IT', 'ENTC', 'Mechanical'],
  },
  {
    id: 'org-b',
    name: 'College of Engineering Pune',
    slug: 'coep',
    domain: 'b.test',
    prnPrefix: 'B22',
    departments: ['Computer', 'Civil'],
  },
];

export const SEED = {
  superAdmin: 'super@platform.test',
  orgA: 'org-a',
  orgB: 'org-b',
  multiOrg: 'multi@both.test',
  nobody: 'nobody@outside.test',
} as const;

export async function seedBase(db: Firestore, now: number): Promise<void> {
  const batch = db.batch();
  const emailOrgs = new Map<string, string[]>();
  const index = (email: string, orgId: string) => emailOrgs.set(email, [...(emailOrgs.get(email) ?? []), orgId]);

  batch.set(db.doc('plans/standard'), { name: 'Standard', features: {}, limits: {} });
  batch.set(db.doc('superAdmins/sa-1'), { email: SEED.superAdmin, uid: null, addedAt: now });

  for (const org of ORGS) {
    const o = db.doc(`organizations/${org.id}`);
    batch.set(o, {
      orgId: org.id,
      name: org.name,
      slug: org.slug,
      status: 'active',
      timezone: 'Asia/Kolkata',
      logoPath: null,
      planId: 'standard',
      featureOverrides: {},
      limitOverrides: {},
      profileLocked: false,
      createdAt: now,
    });
    for (const n of [1, 2]) {
      const email = `admin${n}@${org.domain}`;
      batch.set(o.collection('admins').doc(`adm-${org.id}-${n}`), {
        orgId: org.id,
        email,
        name: `Admin ${n}`,
        uid: null,
        status: 'active',
        addedBy: 'seed',
        addedAt: now,
      });
      index(email, org.id);
    }
    const deptIds = org.departments.map((name) => {
      const id = `dept-${org.id}-${name.toLowerCase()}`;
      batch.set(o.collection('departments').doc(id), { orgId: org.id, name, status: 'active' });
      return id;
    });
    for (let i = 1; i <= 20; i++) {
      const nn = String(i).padStart(2, '0');
      const email = `student${nn}@${org.domain}`;
      const studentId = `stu-${org.id}-${nn}`;
      const prn = `${org.prnPrefix}01${nn}`;
      batch.set(o.collection('students').doc(studentId), {
        orgId: org.id,
        uid: null,
        email,
        name: NAMES[i - 1],
        prn,
        departmentId: deptIds[(i - 1) % deptIds.length],
        graduationYear: i % 2 === 0 ? 2027 : 2026,
        status: 'registered',
        accommodations: {},
        consentAt: now,
        createdAt: now,
        updatedAt: now,
      });
      batch.set(o.collection('whitelist').doc(emailKey(email)), {
        orgId: org.id,
        email,
        prn,
        note: null,
        status: 'registered',
        studentId,
        source: 'upload',
        addedBy: 'seed',
        addedAt: now,
      });
      index(email, org.id);
    }
    if (org.id === 'org-a') {
      for (let i = 1; i <= 5; i++) {
        const email = `invited0${i}@a.test`;
        batch.set(o.collection('whitelist').doc(emailKey(email)), {
          orgId: org.id,
          email,
          prn: i === 1 ? 'A-PRN-901' : null,
          note: null,
          status: 'invited',
          studentId: null,
          source: 'upload',
          addedBy: 'seed',
          addedAt: now,
        });
        index(email, org.id);
      }
    }
    batch.set(o.collection('whitelist').doc(emailKey(SEED.multiOrg)), {
      orgId: org.id,
      email: SEED.multiOrg,
      prn: null,
      note: null,
      status: 'invited',
      studentId: null,
      source: 'single',
      addedBy: 'seed',
      addedAt: now,
    });
    index(SEED.multiOrg, org.id);
  }
  for (const [email, orgIds] of emailOrgs) batch.set(db.doc(`emailIndex/${emailKey(email)}`), { orgIds });
  await batch.commit();
}
