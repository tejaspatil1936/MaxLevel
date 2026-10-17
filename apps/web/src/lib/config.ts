// Build-time configuration (NEXT_PUBLIC_* are inlined by Next). See docs/TEST_ENV.md for the test values.
export const config = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'demo-key',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-mitaoe',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'demo-mitaoe.firebaseapp.com',
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  },
  authEmulatorHost: process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST,
  databaseEmulatorHost: process.env.NEXT_PUBLIC_DATABASE_EMULATOR_HOST,
} as const;
