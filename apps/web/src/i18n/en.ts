// English messages (A11Y-23). Every interface string lives here and is read through t().
export const en = {
  'app.name': 'MITAOE Prep',
  'signIn.title': 'Sign in',
  'signIn.lead': 'Placement exams for your college. Sign in with the Google account your placement cell added.',
} as const;

export type MessageKey = keyof typeof en;
