// English messages (A11Y-23). Every interface string lives here and is read through t().
export const en = {
  'app.name': 'MITAOE Prep',
  'app.skipToContent': 'Skip to main content',
  'app.loading': 'Loading',
  'app.signOut': 'Sign out',

  'signIn.title': 'Sign in',
  'signIn.lead': 'Placement exams for your college. Sign in with the Google account your placement cell added.',
  'signIn.google': 'Sign in with Google',
  'signIn.failed': 'Sign-in did not finish. Check your connection and try again.',
  'signIn.chooseOrg': 'Choose the organization to sign in to',
  'signIn.chooseOrgLead': 'Your account is on more than one list. You can switch later by signing in again.',

  'nav.main': 'Main',
  'nav.overview': 'Overview',
  'nav.organizations': 'Organizations',
  'nav.tests': 'Tests',

  'platform.title': 'Organizations',
  'platform.lead': 'Every organization on the platform, with its status and usage.',
  'admin.title': 'Overview',
  'admin.lead': "Today's and upcoming exams, and recent activity in {org}.",
  'admin.workspace': 'Workspace',
  'student.title': 'Your tests',
  'student.lead': 'Live, upcoming and completed tests will appear here.',
} as const;

export type MessageKey = keyof typeof en;
