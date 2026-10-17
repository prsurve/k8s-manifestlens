import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests and the web app use the core's TypeScript source directly, with no build step.
    alias: {
      '@manifestlens/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      // The extension tests run against a small fake of the VS Code API.
      vscode: fileURLToPath(new URL('./packages/vscode/test/vscode-mock.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
  },
});
