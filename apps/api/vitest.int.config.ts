import { createHash } from 'node:crypto';
import { defineConfig } from 'vitest/config';

// Each checkout (main tree or a git worktree) gets its own emulator project, so integration runs never clear data
// that a concurrent end-to-end run or another checkout is using. The e2e stack uses demo-mitaoe.
const project = `demo-int-${createHash('sha1')
  .update(new URL('../../', import.meta.url).pathname)
  .digest('hex')
  .slice(0, 8)}`;

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
      GCLOUD_PROJECT: project,
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000',
      FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
      TEST_API_SECRET: 'local-test-secret',
      METADATA_SERVER_DETECTION: 'none',
    },
  },
});
