const rawDbUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
const resolvedDbUrl = rawDbUrl?.includes('test-prep-e4d7f-default-rtdb.firebaseio.com')
  ? 'https://test-prep-e4d7f-default-rtdb.asia-southeast1.firebasedatabase.app'
  : rawDbUrl;

export const config = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'demo-key',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-mitaoe',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'demo-mitaoe.firebaseapp.com',
    databaseURL: resolvedDbUrl,
  },
  authEmulatorHost: process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST,
  databaseEmulatorHost: process.env.NEXT_PUBLIC_DATABASE_EMULATOR_HOST,
  /** A11Y-22: the mailbox on the public accessibility statement; a placeholder until the owner sets it (OWNER_SETUP 0.8). */
  accessibilityEmail: process.env.NEXT_PUBLIC_ACCESSIBILITY_EMAIL || 'accessibility@mitaoe.example',
} as const;
