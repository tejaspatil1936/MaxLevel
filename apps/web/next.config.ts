import type { NextConfig } from 'next';

// Static export only (WEB-01): no route handlers, server actions or middleware.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  transpilePackages: ['@mitaoe/shared', '@mitaoe/ui'],
};

export default config;
