// Bundles the action, the core and every dependency into one file. GitHub runs dist/index.js
// directly, so it is committed, and CI fails if it is out of date.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

await build({
  entryPoints: [fileURLToPath(new URL('src/index.ts', root))],
  outfile: fileURLToPath(new URL('dist/index.js', root)),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Resolve the core from its TypeScript source so no separate core build is needed.
  alias: { '@manifestlens/core': fileURLToPath(new URL('../core/src/index.ts', root)) },
  define: { __VERSION__: JSON.stringify(version) },
  legalComments: 'none',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});
