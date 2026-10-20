import type { NextConfig } from 'next';

// Static export only (WEB-01): no route handlers, server actions or middleware.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  transpilePackages: ['@mitaoe/shared', '@mitaoe/ui'],
  // Always inline the emulator variables (empty in production builds), so the emulator-only code paths are removed
  // by dead-code elimination instead of being left behind a runtime check (docs/TEST_ENV.md).
  env: {
    NEXT_PUBLIC_AUTH_EMULATOR_HOST: process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST ?? '',
    NEXT_PUBLIC_DATABASE_EMULATOR_HOST: process.env.NEXT_PUBLIC_DATABASE_EMULATOR_HOST ?? '',
  },
};

export default config;
