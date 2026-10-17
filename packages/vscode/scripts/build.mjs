// Bundles the extension and the core (with its YAML parser) into one file, so the packaged
// extension has no runtime dependencies.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL('src/extension.ts', root))],
  outfile: fileURLToPath(new URL('dist/extension.js', root)),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  // Resolve the core from its TypeScript source so no separate core build is needed.
  alias: {
    '@manifestlens/core': fileURLToPath(new URL('../core/src/index.ts', root)),
  },
  sourcemap: false,
  minify: true,
  logLevel: 'info',
});
