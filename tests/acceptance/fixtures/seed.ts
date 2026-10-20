// The `base` seed loaded by POST /__test/reset (docs/TEST_ENV.md, "Seed data").

export type Role = 'superAdmin' | 'admin' | 'student';

export interface SeedOrg {
  id: string;
  slug: string;
  name: string;
  departments: string[];
}

export const ORG_A: SeedOrg = {
  id: 'org-a',
  slug: 'mitaoe',
  name: 'MIT Academy of Engineering',
  departments: ['Computer', 'IT', 'ENTC', 'Mechanical'],
};

export const ORG_B: SeedOrg = {
  id: 'org-b',
  slug: 'coep',
  name: 'College of Engineering Pune',
  departments: ['Computer', 'Civil'],
};

export interface SeedAccount {
  email: string;
  /** Display name used for the Google account on the Auth emulator. */
  name: string;
  /** Role bootstrap must resolve; null for an account on no list. */
  role: Role | null;
  /** Organization the claims must hold (super admins have none of their own). */
  orgId?: string;
}

const two = (n: number) => String(n).padStart(2, '0');

/** Display names of seeded students 01 to 20, the same in both orgs (docs/TEST_ENV.md, "Display names"). */
export const STUDENT_NAMES = [
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
] as const;

const studentName = (n: number) => STUDENT_NAMES[n - 1]!;

export const accounts = {
  superAdmin: { email: 'super@platform.test', name: 'Platform Super', role: 'superAdmin' },
  adminA: { email: 'admin1@a.test', name: 'Admin 1', role: 'admin', orgId: ORG_A.id },
  adminA2: { email: 'admin2@a.test', name: 'Admin 2', role: 'admin', orgId: ORG_A.id },
  adminB: { email: 'admin1@b.test', name: 'Admin 1', role: 'admin', orgId: ORG_B.id },
  adminB2: { email: 'admin2@b.test', name: 'Admin 2', role: 'admin', orgId: ORG_B.id },
  studentA: { email: 'student01@a.test', name: 'Aarav Kulkarni', role: 'student', orgId: ORG_A.id },
  studentB: { email: 'student01@b.test', name: 'Aarav Kulkarni', role: 'student', orgId: ORG_B.id },
  invitedA: { email: 'invited01@a.test', name: 'Invited A01', role: 'student', orgId: ORG_A.id },
  multi: { email: 'multi@both.test', name: 'Multi Both', role: 'student' },
  unlisted: { email: 'nobody@outside.test', name: 'Nobody Outside', role: null },
} as const satisfies Record<string, SeedAccount>;

/** Registered org A student number n (1 to 20). */
export const studentOfA = (n: number): SeedAccount => ({
  email: `student${two(n)}@a.test`,
  name: studentName(n),
  role: 'student',
  orgId: ORG_A.id,
});

/** Registered org B student number n (1 to 20). */
export const studentOfB = (n: number): SeedAccount => ({
  email: `student${two(n)}@b.test`,
  name: studentName(n),
  role: 'student',
  orgId: ORG_B.id,
});

/** Org created by the `empty-org` test scenario (docs/testids/phase-1.md, "Test-only scenarios"). */
export const ORG_C: SeedOrg = {
  id: 'org-c',
  slug: 'empty',
  name: 'Empty College of Engineering',
  departments: [],
};

/** The admin of org C, created by the `empty-org` scenario. */
export const adminC: SeedAccount = { email: 'admin1@c.test', name: 'Admin 1', role: 'admin', orgId: ORG_C.id };

/** Whitelisted, never-signed-in org A student n (1 to 5); invited01 has PRN A-PRN-901 on its entry. */
export const invitedOfA = (n: number): SeedAccount => ({
  email: `invited${two(n)}@a.test`,
  name: `Invited A${two(n)}`,
  role: 'student',
  orgId: ORG_A.id,
});

/** PRN on invited01@a.test's whitelist entry (STU-02). */
export const INVITED01_PRN = 'A-PRN-901';

/** Seeded record facts for registered student n (1 to 20) of an org (docs/TEST_ENV.md). */
export function seededStudent(org: SeedOrg, n: number) {
  const department = org.departments[(n - 1) % org.departments.length]!;
  return {
    id: `stu-${org.id}-${two(n)}`,
    email: `student${two(n)}@${org.id === ORG_A.id ? 'a' : 'b'}.test`,
    name: studentName(n),
    prn: `${org.id === ORG_A.id ? '' : 'B'}220101${two(n)}`,
    department,
    departmentId: departmentId(org, department),
    graduationYear: n % 2 === 1 ? 2026 : 2027,
  };
}

/** Seeded department ID, `dept-<orgId>-<lowercase name>`. */
export const departmentId = (org: SeedOrg, name: string) => `dept-${org.id}-${name.toLowerCase()}`;
