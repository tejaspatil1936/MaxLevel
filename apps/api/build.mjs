// Bundles the service into dist/server.js. Workspace packages (@mitaoe/*) are bundled from source;
// every npm dependency stays external and is installed in the image.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
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
