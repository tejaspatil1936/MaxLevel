import { defineConfig } from 'vitest/config';

// Integration and rules tests run against the Firebase emulators (docs/TEST_ENV.md), one file at a time.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts', 'src/**/*.rules.test.ts'],
    globalSetup: ['./src/test-support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      GCLOUD_PROJECT: 'demo-mitaoe',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000',
      FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
      TEST_API_SECRET: 'local-test-secret',
      METADATA_SERVER_DETECTION: 'none',
    },
  },
});
