// Bundles the service into dist/server.js (and the seed CLI into dist/seed.js). Workspace packages (@mitaoe/*) are bundled from source;
// every npm dependency stays external and is installed in the image.
import { build } from 'esbuild';

await build({
  entryPoints: { server: 'src/server.ts', seed: 'src/seed-cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'warning',
  plugins: [
    {
      name: 'externals',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@mitaoe/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
