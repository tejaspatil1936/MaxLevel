import { defineConfig } from '@playwright/test';
import { stackEnv } from './tests/env';

// Acceptance, regression and smoke tests against the static export, the built API and worker, and the emulators
// (docs/TEST_ENV.md). No retries and one worker: the test clock and emulators are shared.
const reuse = process.env.PW_REUSE_STACK === '1';
const camera = (clip: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=tests/fixtures/camera/${clip}`,
];

export default defineConfig({
  testDir: 'tests',
  testMatch: ['acceptance/phase-*/**/*.spec.ts', 'regression/**/*.spec.ts', 'smoke/**/*.spec.ts'],
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results',
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  },
  projects: [
    {
      name: 'desktop',
      grepInvert: /@exam|@phone|@lockdown/,
      use: { viewport: { width: 1280, height: 800 }, launchOptions: { args: camera('no-face.y4m') } },
    },
    {
      name: 'exam',
      grep: /@exam/,
      use: { viewport: { width: 1024, height: 768 }, launchOptions: { args: camera('no-face.y4m') } },
    },
    {
      name: 'phone',
      grep: /@phone/,
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, launchOptions: { args: camera('no-face.y4m') } },
    },
    {
      // Real focus, visibility and fullscreen changes need a headed browser; verify.sh runs it under xvfb-run.
      name: 'lockdown',
      grep: /@lockdown/,
      use: { viewport: { width: 1024, height: 768 }, headless: false, launchOptions: { args: camera('no-face.y4m') } },
    },
  ],
  webServer: [
    { command: 'scripts/emulators.sh run', port: 9099, reuseExistingServer: true, timeout: 180_000, stdout: 'ignore' },
    {
      command: 'node apps/api/dist/server.js',
      url: 'http://127.0.0.1:4000/health',
      env: { ...stackEnv, PORT: '4000' },
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
    {
      command: 'node apps/worker/dist/server.js',
      url: 'http://127.0.0.1:4001/health',
      env: { ...stackEnv, PORT: '4001' },
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
    {
      command: 'node scripts/serve-web.mjs',
      url: 'http://localhost:3000/',
      reuseExistingServer: reuse,
      timeout: 30_000,
    },
  ],
});
