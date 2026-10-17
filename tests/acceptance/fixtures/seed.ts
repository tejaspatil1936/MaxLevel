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
