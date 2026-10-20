import type { Role } from '@mitaoe/shared';

/** Landing path for each role (PLAN section 7). */
export function homeFor(role: Role): string {
  return { superAdmin: '/platform/', admin: '/admin/', student: '/student/', device: '/pair/' }[role];
}
