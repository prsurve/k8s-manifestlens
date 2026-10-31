import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Bundle the core from its TypeScript source, so the web app needs no separate core build.
    alias: {
      '@k8s-manifestlens/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
    },
  },
  build: { target: 'es2022' },
});
