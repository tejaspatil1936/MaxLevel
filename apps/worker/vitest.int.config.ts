import { createHash } from 'node:crypto';
import { defineConfig } from 'vitest/config';

// Like the API's integration config: the worker's tests run on the Firestore emulator in a project of their own per
// checkout, so they never clear data an end-to-end run (demo-mitaoe) or the API's integration tests are using.
const project = `demo-int-wk-${createHash('sha1')
  .update(new URL('../../', import.meta.url).pathname)
  .digest('hex')
  .slice(0, 8)}`;

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./src/test-support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      GCLOUD_PROJECT: project,
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
      METADATA_SERVER_DETECTION: 'none',
    },
  },
});
